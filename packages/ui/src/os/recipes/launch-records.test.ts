import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canRetryStep,
  createLaunchRecord,
  dismissLaunchStep,
  getLaunchRecord,
  loadAllLaunchRecords,
  persistLaunchRecord,
  reconcileOutcomeUnknownStep,
  recoverDurableLaunchRecordsOnStartup,
  stepTransitionConfirmed,
  stepTransitionDispatched,
  stepTransitionFailed,
  stepTransitionOutcomeUnknown,
  withRecipeLaunchLock,
  RECIPE_LAUNCHES_STORAGE_KEY,
} from "./launch-records.js";
import type { RecipeV1 } from "./types.js";

function sampleRecipe(): RecipeV1 {
  return {
    version: 1,
    id: "recipe-demo",
    name: "Demo Recipe",
    profileId: "server-a",
    project: "dam-hopper",
    terminalSteps: [
      {
        key: "term-1",
        name: "Terminal 1",
        command: "cargo test",
      },
      {
        key: "term-2",
        name: "Terminal 2",
        command: "pnpm dev",
      },
    ],
    appSteps: [
      {
        key: "app-files",
        appId: "files",
      },
    ],
    layout: {
      tree: null,
      floating: [],
    },
    createdAt: 1000,
    updatedAt: 1000,
  };
}

describe("launch-records durable state machine and Web Locks", () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("Web Locks fail-closed behavior", () => {
    it("fails closed when navigator.locks is missing", async () => {
      vi.stubGlobal("navigator", {});

      await expect(
        withRecipeLaunchLock("launch-123", async () => "result"),
      ).rejects.toThrow("Web Locks API (navigator.locks) is unavailable");
    });

    it("runs exclusive callback under navigator.locks when available", async () => {
      const mockRequest = vi.fn().mockImplementation((name, options, cb) => cb());
      vi.stubGlobal("navigator", {
        locks: { request: mockRequest },
      });

      const res = await withRecipeLaunchLock("launch-123", async () => "success");
      expect(res).toBe("success");
      expect(mockRequest).toHaveBeenCalledWith(
        "dam-hopper:recipe-launch:launch-123",
        { mode: "exclusive" },
        expect.any(Function),
      );
    });
  });

  describe("Step State Machine Transitions", () => {
    it("initializes pending steps with reserved UUIDs and saves to storage", () => {
      const recipe = sampleRecipe();
      const record = createLaunchRecord({
        recipe,
        desktopId: "desktop-1",
        serverEpoch: 100,
      });

      expect(record.version).toBe(1);
      expect(record.steps["term-1"].status).toBe("pending");
      expect(record.steps["term-1"].terminalId).toMatch(/^term-/);
      expect(record.steps["app-files"].status).toBe("pending");

      persistLaunchRecord(record);
      const loaded = getLaunchRecord(record.launchId);
      expect(loaded).toBeDefined();
      expect(loaded?.recipeId).toBe("recipe-demo");
    });

    it("transitions pending -> dispatched before remote network effect", () => {
      const record = createLaunchRecord({
        recipe: sampleRecipe(),
        desktopId: "desktop-1",
        serverEpoch: 100,
      });

      const dispatched = stepTransitionDispatched(record, "term-1", 100);
      expect(dispatched.steps["term-1"].status).toBe("dispatched");
      expect(dispatched.steps["term-1"].dispatchedAt).toBeDefined();
    });

    it("transitions dispatched -> confirmed on authoritative completion", () => {
      const record = createLaunchRecord({
        recipe: sampleRecipe(),
        desktopId: "desktop-1",
        serverEpoch: 100,
      });
      stepTransitionDispatched(record, "term-1", 100);

      const confirmed = stepTransitionConfirmed(record, "term-1", {
        terminalId: "term-123",
        incarnation: 1,
      });

      expect(confirmed.steps["term-1"].status).toBe("confirmed");
      expect(confirmed.steps["term-1"].incarnation).toBe(1);
      expect(confirmed.steps["term-1"].evidence).toContain("authoritative-success");
    });

    it("transitions to outcomeUnknown upon timeout or lost response", () => {
      const record = createLaunchRecord({
        recipe: sampleRecipe(),
        desktopId: "desktop-1",
        serverEpoch: 100,
      });
      stepTransitionDispatched(record, "term-1", 100);

      const unknown = stepTransitionOutcomeUnknown(
        record,
        "term-1",
        "Connection timed out waiting for spawn ack",
      );

      expect(unknown.steps["term-1"].status).toBe("outcomeUnknown");
      expect(unknown.steps["term-1"].error).toContain("timed out");
    });

    it("dismisses step retaining unresolved durable tombstone without clearing identity", () => {
      let record = createLaunchRecord({
        recipe: sampleRecipe(),
        desktopId: "desktop-1",
        serverEpoch: 100,
      });
      record = stepTransitionOutcomeUnknown(record, "term-1", "Lost response");

      const dismissed = dismissLaunchStep(record, "term-1");
      expect(dismissed.steps["term-1"].dismissed).toBe(true);
      expect(dismissed.steps["term-1"].status).toBe("outcomeUnknown");
      expect(dismissed.steps["term-1"].terminalId).toBeDefined();
    });
  });

  describe("F1 Authoritative Reconciliation", () => {
    it("adopts exact late completion if session is observed live with matching identity", () => {
      let record = createLaunchRecord({
        recipe: sampleRecipe(),
        desktopId: "desktop-1",
        serverEpoch: 100,
      });
      const termId = record.steps["term-1"].terminalId!;
      record = stepTransitionOutcomeUnknown(record, "term-1", "Lost response");

      const hostContext = {
        currentServerEpoch: 100,
        aliveSessionsOnHost: [
          {
            id: termId,
            incarnation: 1,
            alive: true,
          },
        ],
      };

      const result = reconcileOutcomeUnknownStep(record, "term-1", hostContext);
      expect(result.reconciled).toBe(true);
      expect(result.status).toBe("confirmed");
      expect(result.record.steps["term-1"].status).toBe("confirmed");
      expect(result.record.steps["term-1"].evidence).toContain("exact-late-adoption");
    });

    it("proves failure if serverProcess restarted (changed serverEpoch)", () => {
      let record = createLaunchRecord({
        recipe: sampleRecipe(),
        desktopId: "desktop-1",
        serverEpoch: 100,
      });
      record = stepTransitionOutcomeUnknown(record, "term-1", "Lost response");

      const hostContext = {
        currentServerEpoch: 101, // Epoch changed! Server restarted.
        aliveSessionsOnHost: [],
      };

      const result = reconcileOutcomeUnknownStep(record, "term-1", hostContext);
      expect(result.reconciled).toBe(true);
      expect(result.status).toBe("failed");
      expect(result.record.steps["term-1"].status).toBe("failed");
      expect(result.record.steps["term-1"].evidence).toContain("server-epoch-changed");
    });

    it("remains outcomeUnknown if session is merely absent from list with same serverEpoch", () => {
      let record = createLaunchRecord({
        recipe: sampleRecipe(),
        desktopId: "desktop-1",
        serverEpoch: 100,
      });
      record = stepTransitionOutcomeUnknown(record, "term-1", "Lost response");

      const hostContext = {
        currentServerEpoch: 100, // Same epoch!
        aliveSessionsOnHost: [], // Absent from list does NOT prove failure!
      };

      const result = reconcileOutcomeUnknownStep(record, "term-1", hostContext);
      expect(result.reconciled).toBe(false);
      expect(result.status).toBe("outcomeUnknown");
      expect(result.record.steps["term-1"].status).toBe("outcomeUnknown");
    });
  });

  describe("canRetryStep rules", () => {
    it("disallows retry for outcomeUnknown, dispatched, and confirmed steps", () => {
      const record = createLaunchRecord({
        recipe: sampleRecipe(),
        desktopId: "desktop-1",
        serverEpoch: 100,
      });

      expect(canRetryStep(record.steps["term-1"])).toBe(true); // Initial pending can be retried

      const dispatched = stepTransitionDispatched(record, "term-1", 100);
      expect(canRetryStep(dispatched.steps["term-1"])).toBe(false);

      const unknown = stepTransitionOutcomeUnknown(dispatched, "term-1", "timeout");
      expect(canRetryStep(unknown.steps["term-1"])).toBe(false);

      const confirmed = stepTransitionConfirmed(record, "term-2", { terminalId: "t-2", incarnation: 1 });
      expect(canRetryStep(confirmed.steps["term-2"])).toBe(false);

      const failedWithEvidence = stepTransitionFailed(
        record,
        "term-1",
        "400 Bad Request",
        "authoritative-rejection",
      );
      expect(canRetryStep(failedWithEvidence.steps["term-1"])).toBe(true);
    });
  });

  describe("recoverDurableLaunchRecordsOnStartup", () => {
    it("converts in-flight dispatched steps to outcomeUnknown upon reload", () => {
      const record = createLaunchRecord({
        recipe: sampleRecipe(),
        desktopId: "desktop-1",
        serverEpoch: 100,
      });
      stepTransitionDispatched(record, "term-1", 100);

      // Verify dispatched in storage
      expect(getLaunchRecord(record.launchId)?.steps["term-1"].status).toBe("dispatched");

      // Browser restarts / reloads
      recoverDurableLaunchRecordsOnStartup();

      const recovered = getLaunchRecord(record.launchId);
      expect(recovered?.steps["term-1"].status).toBe("outcomeUnknown");
      expect(recovered?.steps["term-1"].error).toContain("restarted while dispatch was in-flight");
    });
  });
});
