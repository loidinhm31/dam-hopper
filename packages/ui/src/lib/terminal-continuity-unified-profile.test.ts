import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  registerTerminal,
  getTerminal,
  removeTerminal,
  hasTerminal,
} from "./terminal-registry.js";
import {
  rememberTerminalSessionIncarnation,
  latestTerminalSessionIncarnation,
  acceptsTerminalSessionIncarnation,
  resetTerminalSessionIncarnations,
} from "./terminal-incarnation-state.js";
import {
  markTerminalOutput,
  getTerminalOutputActivitySnapshot,
  setTerminalStreamReady,
} from "./terminal-output-activity.js";
import {
  recordCommand,
  getHistory,
  searchHistory,
  clearHistory,
} from "./command-history.js";
import { deriveTerminalAutoAttachState } from "./terminal-auto-attach.js";
import { resolveWorkflowTerminalReveal } from "./workflow-workspace-integration.js";
import {
  dispatchTerminalNotificationSelection,
  subscribeToTerminalNotificationSelection,
} from "./terminal-notification-navigation.js";
import { filterClientDiagnosticsSnapshot } from "./diagnostics-export.js";
import type { TerminalRef } from "@/api/ownership.js";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("Phase 04 — Terminal continuity, workflow, and owner-directed navigation", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorage());
    localStorage.clear();
    resetTerminalSessionIncarnations();
    clearHistory();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.unstubAllGlobals();
  });
  describe("04A: Qualified registry, incarnation, and activity maps", () => {
    it("preserves separate registry entries for identical session IDs across profiles", () => {
      const refA: TerminalRef = { profileId: "profile-a", id: "shared-session" };
      const refB: TerminalRef = { profileId: "profile-b", id: "shared-session" };

      const mockTermA = { dispose: vi.fn() } as unknown as Parameters<typeof registerTerminal>[1];
      const mockTermB = { dispose: vi.fn() } as unknown as Parameters<typeof registerTerminal>[1];
      const fitAddon = { fit: vi.fn() } as unknown as Parameters<typeof registerTerminal>[2];
      const findController = { dispose: vi.fn() } as unknown as Parameters<typeof registerTerminal>[3];

      registerTerminal(refA, mockTermA, fitAddon, findController, undefined, refA);
      registerTerminal(refB, mockTermB, fitAddon, findController, undefined, refB);

      expect(hasTerminal(refA)).toBe(true);
      expect(hasTerminal(refB)).toBe(true);

      const entryA = getTerminal(refA);
      const entryB = getTerminal(refB);
      expect(entryA?.terminal).toBe(mockTermA);
      expect(entryB?.terminal).toBe(mockTermB);
      expect(entryA?.terminalRef).toEqual(refA);
      expect(entryB?.terminalRef).toEqual(refB);

      // Removing A does not affect B
      removeTerminal(refA);
      expect(hasTerminal(refA)).toBe(false);
      expect(hasTerminal(refB)).toBe(true);
      expect(getTerminal(refB)?.terminal).toBe(mockTermB);

      removeTerminal(refB);
      expect(hasTerminal(refB)).toBe(false);
    });

    it("isolates session incarnation state across profiles with colliding session IDs", () => {
      const refA: TerminalRef = { profileId: "profile-a", id: "colliding-pty" };
      const refB: TerminalRef = { profileId: "profile-b", id: "colliding-pty" };

      rememberTerminalSessionIncarnation(refA, 10);
      rememberTerminalSessionIncarnation(refB, 20);

      expect(latestTerminalSessionIncarnation(refA)).toBe(10);
      expect(latestTerminalSessionIncarnation(refB)).toBe(20);

      // Profile A rejects stale incarnation 5, while Profile B still tracks 20
      expect(acceptsTerminalSessionIncarnation(refA, 5)).toBe(false);
      expect(acceptsTerminalSessionIncarnation(refB, 25)).toBe(true);
      expect(latestTerminalSessionIncarnation(refB)).toBe(25);
      expect(latestTerminalSessionIncarnation(refA)).toBe(10);

      // Resetting profile A only does not clear profile B
      resetTerminalSessionIncarnations("profile-a");
      expect(latestTerminalSessionIncarnation(refA)).toBeUndefined();
      expect(latestTerminalSessionIncarnation(refB)).toBe(25);
    });

    it("isolates terminal stream activity markers for colliding session IDs", () => {
      const refA: TerminalRef = { profileId: "profile-a", id: "task-stream" };
      const refB: TerminalRef = { profileId: "profile-b", id: "task-stream" };

      setTerminalStreamReady(refA, true);
      markTerminalOutput(refA);

      expect(getTerminalOutputActivitySnapshot(refA).recentOutput).toBe(true);
      expect(getTerminalOutputActivitySnapshot(refB).recentOutput).toBe(false);
      expect(getTerminalOutputActivitySnapshot(refB).streamReady).toBe(false);
    });

    it("isolates terminal entry by qualified ref and refuses unqualified raw lookup on collision", () => {
      const refA: TerminalRef = { profileId: "profile-a", id: "raw-lookup-pty" };
      const refB: TerminalRef = { profileId: "profile-b", id: "raw-lookup-pty" };
      const mockTermA = { dispose: vi.fn() } as unknown as Parameters<typeof registerTerminal>[1];
      const mockTermB = { dispose: vi.fn() } as unknown as Parameters<typeof registerTerminal>[1];
      const fitAddonA = { fit: vi.fn() } as unknown as Parameters<typeof registerTerminal>[2];
      const fitAddonB = { fit: vi.fn() } as unknown as Parameters<typeof registerTerminal>[2];
      const findControllerA = { dispose: vi.fn() } as unknown as Parameters<typeof registerTerminal>[3];
      const findControllerB = { dispose: vi.fn() } as unknown as Parameters<typeof registerTerminal>[3];

      registerTerminal(refA, mockTermA, fitAddonA, findControllerA, undefined, refA);
      registerTerminal(refB, mockTermB, fitAddonB, findControllerB, undefined, refB);

      // Must be resolvable by qualified TerminalRef but refuse unqualified raw string lookup on collision
      expect(getTerminal(refA)?.terminal).toBe(mockTermA);
      expect(getTerminal(refB)?.terminal).toBe(mockTermB);
      expect(getTerminal("raw-lookup-pty")).toBeUndefined();
      expect(hasTerminal("raw-lookup-pty")).toBe(false);

      removeTerminal(refA);
      removeTerminal(refB);
      expect(getTerminal(refA)).toBeUndefined();
      expect(getTerminal(refB)).toBeUndefined();
    });

    it("auto-attach preserves Profile A tab and creates Profile B tab when session IDs collide", () => {
      const profileATab = {
        sessionId: "shared-task",
        label: "Profile A Task",
        profileId: "profile-a",
        terminalRef: { profileId: "profile-a", id: "shared-task" },
        session: { id: "shared-task", alive: true } as any,
      };

      const profileBSession = {
        id: "shared-task",
        alive: true,
        startedAt: Date.now(),
        project: "web",
        name: "Profile B Task",
        command: "bash",
      } as any;

      const nextState = deriveTerminalAutoAttachState({
        sessions: [profileBSession],
        openTabs: [profileATab],
        mountedSessions: [{
          sessionId: "shared-task",
          project: "web",
          command: "bash",
          profileId: "profile-a",
        }],
        activeTab: "shared-task",
        profileSessionIds: new Set(),
        freeTerminalIndexMap: new Map(),
        profileId: "profile-b",
      });

      // Both tabs must be preserved with their respective profiles
      expect(nextState.openTabs.length).toBe(2);
      expect(nextState.openTabs[0].profileId).toBe("profile-a");
      expect(nextState.openTabs[1].profileId).toBe("profile-b");
      expect(nextState.openTabs[1].sessionId).toBe("shared-task");

      // Mounted sessions must preserve both
      expect(nextState.mountedSessions.length).toBe(2);
      expect(nextState.mountedSessions[0].profileId).toBe("profile-a");
      expect(nextState.mountedSessions[1].profileId).toBe("profile-b");
    });
  });

  describe("04C: Profile-scoped command history", () => {
    it("records and searches commands scoped by profileId", () => {
      recordCommand("cargo check", "server", "profile-a");
      recordCommand("cargo build --release", "server", "profile-b");
      recordCommand("npm test", "web", "profile-a");

      const histA = getHistory("profile-a");
      expect(histA.map((h) => h.command).sort()).toEqual(["cargo check", "npm test"]);
      const histB = getHistory("profile-b");
      expect(histB.map((h) => h.command)).toEqual(["cargo build --release"]);

      const searchA = searchHistory("cargo", 5, "profile-a");
      expect(searchA.map((r) => r.entry.command)).toEqual(["cargo check"]);

      const searchB = searchHistory("cargo", 5, "profile-b");
      expect(searchB.map((r) => r.entry.command)).toEqual(["cargo build --release"]);
    });
  });

  describe("04D: Workflow links, notifications, and diagnostics", () => {
    it("navigates workflow terminal links using profile, terminal ID, and authoritative incarnation", () => {
      const sessionMap = new Map([
        ["term-1", { alive: true, incarnation: 3 }],
      ]);

      // Matching profile and matching incarnation
      const okResult = resolveWorkflowTerminalReveal({
        sessionId: "term-1",
        activeProfileId: "prof-1",
        currentProfileId: "prof-1",
        sessionMap,
        expectedIncarnation: 3,
      });
      expect(okResult.canReveal).toBe(true);
      expect(okResult.sessionId).toBe("term-1");

      // Incarnation mismatch rejects navigation
      const staleResult = resolveWorkflowTerminalReveal({
        sessionId: "term-1",
        activeProfileId: "prof-1",
        currentProfileId: "prof-1",
        sessionMap,
        expectedIncarnation: 2,
      });
      expect(staleResult.canReveal).toBe(false);
      expect(staleResult.reason).toBe("incarnation_mismatch");

      // Profile mismatch rejects navigation
      const crossProfile = resolveWorkflowTerminalReveal({
        sessionId: "term-1",
        activeProfileId: "prof-1",
        currentProfileId: "prof-2",
        sessionMap,
        expectedIncarnation: 3,
      });
      expect(crossProfile.canReveal).toBe(false);
      expect(crossProfile.reason).toBe("profile_mismatch");
    });

    it("dispatches notification selection events with qualified profileId and terminalRef", () => {
      const target = new EventTarget();
      const listener = vi.fn();

      const unsubscribe = subscribeToTerminalNotificationSelection(
        listener,
        target,
      );

      const terminalRef: TerminalRef = { profileId: "prof-1", id: "term-xyz" };
      dispatchTerminalNotificationSelection(
        "term-xyz",
        target,
        "prof-1",
        terminalRef,
      );

      expect(listener).toHaveBeenCalledWith("term-xyz", "prof-1", terminalRef);
      unsubscribe();
    });

    it("filters diagnostics export bundle to the requested owner profile", () => {
      const snapshot = {
        manifest: {
          schemaVersion: 1 as const,
          storageKey: "test",
          retentionMinutes: 60,
          maxEntries: 100,
          maxStorageBytes: 1000,
          entryCount: 2,
        },
        logs: [
          {
            timestamp: new Date().toISOString(),
            timestampMs: Date.now(),
            type: "log" as const,
            scope: "terminal",
            message: "command started on profile-a",
            metadata: { profileId: "profile-a" },
          },
          {
            timestamp: new Date().toISOString(),
            timestampMs: Date.now(),
            type: "log" as const,
            scope: "terminal",
            message: "command started on profile-b",
            metadata: { profileId: "profile-b" },
          },
        ],
        browserErrors: [],
        currentRoute: null,
        profile: null,
        transportStatus: null,
      };

      const filteredA = filterClientDiagnosticsSnapshot(snapshot, {
        profileId: "profile-a",
      });

      expect(filteredA.logs.length).toBe(1);
      expect(filteredA.logs[0].message).toBe("command started on profile-a");

      const filteredB = filterClientDiagnosticsSnapshot(snapshot, {
        profileId: "profile-b",
      });
      expect(filteredB.logs.length).toBe(1);
      expect(filteredB.logs[0].message).toBe("command started on profile-b");
    });
  });
});
