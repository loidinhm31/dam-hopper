// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  type ApiClient,
  type ConsentDecisionRequest,
  type ConsentDecisionResponse,
  type IdleSuspendStatusV1,
  type UiConnectionFrame,
} from "@/api/client.js";
import {
  __setConnectionSnapshotForTests,
  resetConnections,
} from "@/api/connections.js";
import type { Transport } from "@/api/transport.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useAgentStatusStore, beginAgentStatusConnection, installAgentStatusSnapshot } from "@/stores/agent-status.js";
import { HostSleepConsentHost } from "./HostSleepConsentHost.js";

const mockProfilesState = vi.hoisted(() => ({
  profiles: [] as Array<{ id: string; name: string; url: string; authType: "token" }>,
  activeProfileId: "prof-a",
  listeners: new Set<(event: { type: "profileListChanged" }) => void>(),
}));

vi.mock("@/api/server-config.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getProfiles: () => mockProfilesState.profiles,
    getActiveProfileId: () => mockProfilesState.activeProfileId,
    subscribeToProfileChanges: (cb: (event: { type: "profileListChanged" }) => void) => {
      mockProfilesState.listeners.add(cb);
      return () => mockProfilesState.listeners.delete(cb);
    },
  };
});

function makeAgentFreeStatus(
  overrides: Partial<IdleSuspendStatusV1> = {},
): IdleSuspendStatusV1 {
  const now = 1726010805000;
  return {
    version: 1,
    statusRevision: 10,
    state: "watching",
    automaticPolicy: "agent-free",
    enabled: true,
    timingMutable: true,
    timingMutableReason: null,
    capabilityCode: "systemd",
    currentEpoch: 1,
    quietPeriodSeconds: 10800,
    wakeAfterSeconds: 600,
    minQuietPeriodSeconds: 10800,
    maxQuietPeriodSeconds: 10800,
    minWakeAfterSeconds: 60,
    maxWakeAfterSeconds: 86400,
    fleetSnapshot: {
      generation: 1,
      liveCount: 1,
      creatingCount: 0,
      restartPendingCount: 0,
      disposing: false,
      handoffActive: false,
    },
    armDeadlineMs: null,
    lastOutcome: null,
    detail: null,
    activity: null,
    agentFree: {
      phase: "awaitingConsent",
      scope: "managed-terminals",
      inventoryState: "consistent",
      inventoryRevision: 2,
      semanticRevision: 5,
      idleCount: 2,
      blockedCount: 1,
      workingCount: 0,
      unknownCount: 0,
      freeSinceMs: now - 10805000,
      eligibleAtMs: now - 5000,
      deferredUntilMs: null,
      reasonCode: "allFree",
    },
    clientPresence: {
      connectionCount: 2,
      pendingUpgradeCount: 0,
      revision: 3,
      available: true,
    },
    consent: {
      requestId: "11111111-1111-4000-8000-111111111111",
      requestRevision: 1,
      state: "pending",
      requestedAtMs: now - 5000,
      expiresAtMs: now + 55000,
      decision: null,
      wakeAfterSeconds: 600,
    },
    timestampMs: now,
    ...overrides,
  };
}

function setupMockProfile(options: {
  profileId: string;
  name: string;
  url: string;
  generation?: number;
  receipt?: UiConnectionFrame | null;
  status: IdleSuspendStatusV1;
  submitConsentDecision?: (req: ConsentDecisionRequest) => Promise<ConsentDecisionResponse>;
}) {
  const generation = options.generation ?? 1;
  let currentReceipt: UiConnectionFrame | null =
    options.receipt !== undefined
      ? options.receipt
      : {
          kind: "host:uiConnection",
          version: 1,
          connectionId: `conn-${options.profileId}-g${generation}`,
          decisionCapability: `cap-${options.profileId}-g${generation}`,
        };
  let currentStatus = options.status;
  const receiptListeners = new Set<(r: UiConnectionFrame | null) => void>();

  const idleSuspendStatus = vi.fn(async () => currentStatus);
  const submitConsentDecision = vi.fn(
    options.submitConsentDecision ??
      (async (req: ConsentDecisionRequest): Promise<ConsentDecisionResponse> => ({
        version: 1,
        requestId: req.requestId,
        decision: req.decision,
        statusRevision: currentStatus.statusRevision + 1,
        settled: true,
      })),
  );

  const transport: Partial<Transport> = {
    getUiConnectionReceipt: () => currentReceipt,
    subscribeUiConnection: (cb) => {
      receiptListeners.add(cb);
      cb(currentReceipt);
      return () => receiptListeners.delete(cb);
    },
  };

  if (!mockProfilesState.profiles.some((p) => p.id === options.profileId)) {
    mockProfilesState.profiles = [
      ...mockProfilesState.profiles,
      { id: options.profileId, name: options.name, url: options.url, authType: "token" },
    ];
    mockProfilesState.listeners.forEach((l) => l({ type: "profileListChanged" }));
  }

  __setConnectionSnapshotForTests(
    options.profileId,
    {
      status: "connected",
      intent: true,
      serverUrl: options.url,
      owner: { profileId: options.profileId, generation },
      api: {
        system: {
          idleSuspendStatus,
          submitConsentDecision,
        },
      } as unknown as ApiClient,
    },
    transport as Transport,
  );

  return {
    idleSuspendStatus,
    submitConsentDecision,
    setStatus(next: IdleSuspendStatusV1) {
      currentStatus = next;
    },
    setReceipt(next: UiConnectionFrame | null) {
      currentReceipt = next;
      receiptListeners.forEach((cb) => cb(currentReceipt));
    },
  };
}

describe("HostSleepConsentHost & useHostSleepConsent", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resetConnections();
    useCognitoModeStore.getState().reset();
    useAgentStatusStore.setState({ profiles: new Map() });
    mockProfilesState.profiles = [];
    mockProfilesState.activeProfileId = "prof-a";
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
      root = null;
    });
    container?.remove();
    container = null;
    resetConnections();
    useCognitoModeStore.getState().reset();
    useAgentStatusStore.setState({ profiles: new Map() });
  });

  async function renderHost() {
    await act(async () => {
      root?.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(HostSleepConsentHost),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("prompts for an inactive connected profile with Host Resources closed and routes Allow sleep to the exact captured owner after active profile switch", async () => {
    setupMockProfile({
      profileId: "prof-a",
      name: "Primary Server",
      url: "https://primary.example.com",
      status: makeAgentFreeStatus({ consent: null }),
    });
    const secondary = setupMockProfile({
      profileId: "prof-b",
      name: "Secondary Build Host",
      url: "https://secondary.example.com",
      generation: 3,
      status: makeAgentFreeStatus(),
    });

    await renderHost();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Automatic Host Sleep Request");
    });

    expect(document.body.textContent).toContain(
      "Target host: Secondary Build Host (https://secondary.example.com)",
    );
    expect(document.body.textContent).toContain(
      "Tracks DamHopper terminals only; external work does not block sleep",
    );

    // Switch active profile before clicking Allow sleep
    mockProfilesState.activeProfileId = "prof-a";

    const allowBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Allow sleep"),
    );
    expect(allowBtn).toBeDefined();

    await act(async () => {
      allowBtn?.click();
      await Promise.resolve();
    });

    expect(secondary.submitConsentDecision).toHaveBeenCalledTimes(1);
    expect(secondary.submitConsentDecision).toHaveBeenCalledWith({
      requestId: "11111111-1111-4000-8000-111111111111",
      requestRevision: 1,
      connectionId: "conn-prof-b-g3",
      decisionCapability: "cap-prof-b-g3",
      decision: "approve",
    });

    // Transitions to settled waiting state and closes Allow/Do not sleep action controls
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        "Decision settled: Approved — Waiting for server / final safety checks.",
      );
    });
    expect(
      Array.from(document.body.querySelectorAll("button")).some((b) =>
        b.textContent?.includes("Allow sleep"),
      ),
    ).toBe(false);

    // Clicking Close on settled dialog closes presentation WITHOUT sending a second POST
    const closeBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Close",
    );
    expect(closeBtn).toBeDefined();
    await act(async () => {
      closeBtn?.click();
      await Promise.resolve();
    });

    expect(secondary.submitConsentDecision).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("Automatic Host Sleep Request");
  });

  it("discards stale generation responses and never sends replacement-socket approval on reconnect", async () => {
    let resolveDecision!: (val: ConsentDecisionResponse) => void;
    const host = setupMockProfile({
      profileId: "prof-a",
      name: "Host A",
      url: "https://host-a.example.com",
      generation: 1,
      status: makeAgentFreeStatus(),
      submitConsentDecision: () =>
        new Promise<ConsentDecisionResponse>((resolve) => {
          resolveDecision = resolve;
        }),
    });

    await renderHost();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Automatic Host Sleep Request");
    });

    const allowBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Allow sleep"),
    );
    await act(async () => {
      allowBtn?.click();
    });
    expect(host.submitConsentDecision).toHaveBeenCalledTimes(1);

    // Replace connection generation while POST is in flight
    const replacement = setupMockProfile({
      profileId: "prof-a",
      name: "Host A",
      url: "https://host-a.example.com",
      generation: 2,
      status: makeAgentFreeStatus({
        consent: {
          requestId: "11111111-1111-4000-8000-111111111111",
          requestRevision: 1,
          state: "pending",
          requestedAtMs: 1726010800000,
          expiresAtMs: 1726010860000,
          decision: null,
          wakeAfterSeconds: 600,
        },
      }),
    });

    await act(async () => {
      resolveDecision({
        version: 1,
        requestId: "11111111-1111-4000-8000-111111111111",
        decision: "approve",
        statusRevision: 15,
        settled: true,
      });
      await Promise.resolve();
    });

    // Replacement generation was never auto-approved and remains pending
    expect(replacement.submitConsentDecision).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(
        Array.from(document.body.querySelectorAll("button")).some((b) =>
          b.textContent?.includes("Allow sleep"),
        ),
      ).toBe(true);
    });
  });

  it("queues multiple hosts deterministically and only deduplicates aliases with proven serverEpoch + UUID", async () => {
    const reqUuid = "22222222-2222-4000-8000-222222222222";
    setupMockProfile({
      profileId: "prof-late",
      name: "Late Host",
      url: "https://late.example.com",
      status: makeAgentFreeStatus({
        consent: {
          requestId: "33333333-3333-4000-8000-333333333333",
          requestRevision: 1,
          state: "pending",
          requestedAtMs: 1726010810000,
          expiresAtMs: 1726010870000,
          decision: null,
          wakeAfterSeconds: 600,
        },
      }),
    });
    setupMockProfile({
      profileId: "prof-early-1",
      name: "Early Alias 1",
      url: "https://early-1.example.com",
      status: makeAgentFreeStatus({
        consent: {
          requestId: reqUuid,
          requestRevision: 1,
          state: "pending",
          requestedAtMs: 1726010800000,
          expiresAtMs: 1726010860000,
          decision: null,
          wakeAfterSeconds: 600,
        },
      }),
    });
    setupMockProfile({
      profileId: "prof-early-2",
      name: "Early Alias 2",
      url: "https://early-2.example.com",
      status: makeAgentFreeStatus({
        consent: {
          requestId: reqUuid,
          requestRevision: 1,
          state: "pending",
          requestedAtMs: 1726010800000,
          expiresAtMs: 1726010860000,
          decision: null,
          wakeAfterSeconds: 600,
        },
      }),
    });

    // Without serverEpoch, Early Alias 1 and Early Alias 2 remain separate (3 total hosts)
    await renderHost();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Host 1 of 3 (2 other pending host requests queued)");
    });
    expect(document.body.textContent).toContain("Target host: Early Alias 1");

    // Install matching serverEpoch = 777 for Early Alias 1 and Early Alias 2
    await act(async () => {
      beginAgentStatusConnection({ profileId: "prof-early-1", generation: 1 });
      installAgentStatusSnapshot(
        { profileId: "prof-early-1", generation: 1 },
        { version: 1, serverEpoch: 777, revision: 1, availability: "ready", terminals: [] },
      );
      beginAgentStatusConnection({ profileId: "prof-early-2", generation: 1 });
      installAgentStatusSnapshot(
        { profileId: "prof-early-2", generation: 1 },
        { version: 1, serverEpoch: 777, revision: 1, availability: "ready", terminals: [] },
      );
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Host 1 of 2 (1 other pending host request queued)");
    });
    expect(document.body.textContent).toContain("Aliases: Early Alias 1, Early Alias 2");
  });

  it("handles 409 decisionAlreadySettled by refetching status, closing action controls, and showing settled decision", async () => {
    const host = setupMockProfile({
      profileId: "prof-a",
      name: "Host A",
      url: "https://host-a.example.com",
      status: makeAgentFreeStatus(),
      submitConsentDecision: async () => {
        host.setStatus(
          makeAgentFreeStatus({
            consent: {
              requestId: "11111111-1111-4000-8000-111111111111",
              requestRevision: 1,
              state: "approved",
              requestedAtMs: 1726010800000,
              expiresAtMs: 1726010860000,
              decision: "approve",
              wakeAfterSeconds: 600,
            },
          }),
        );
        throw new ApiRequestError(
          "consent decision already settled",
          409,
          "decisionAlreadySettled",
        );
      },
    });

    await renderHost();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Automatic Host Sleep Request");
    });

    const denyBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Do not sleep"),
    );
    await act(async () => {
      denyBtn?.click();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        "Decision was already settled by another session.",
      );
    });
    expect(document.body.textContent).toContain(
      "Decision settled: Approved — Waiting for server / final safety checks.",
    );
    expect(host.submitConsentDecision).toHaveBeenCalledTimes(1);
    expect(
      Array.from(document.body.querySelectorAll("button")).some((b) =>
        b.textContent?.includes("Do not sleep"),
      ),
    ).toBe(false);
  });

  it("sends one deny on Escape while pending, does not fabricate success on 503 failure, and hides/isolates during Cognito mode without answering", async () => {
    let shouldFail503 = true;
    const host = setupMockProfile({
      profileId: "prof-a",
      name: "Host A",
      url: "https://host-a.example.com",
      status: makeAgentFreeStatus(),
      submitConsentDecision: async (req) => {
        if (shouldFail503) {
          throw new ApiRequestError("service unavailable", 503, "consentUnavailable");
        }
        return {
          version: 1,
          requestId: req.requestId,
          decision: req.decision,
          statusRevision: 12,
          settled: true,
        };
      },
    });

    await renderHost();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Automatic Host Sleep Request");
    });

    // Activate Cognito mode: dialog is hidden and isolated without sending any answer
    await act(async () => {
      useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    });
    expect(document.body.textContent).not.toContain("Automatic Host Sleep Request");
    expect(host.submitConsentDecision).not.toHaveBeenCalled();

    // Deactivate Cognito mode: dialog returns
    await act(async () => {
      useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    });
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Automatic Host Sleep Request");
    });

    // Press Escape while pending -> sends deny once; 503 failure keeps dialog open and shows uncertainty
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });
    expect(host.submitConsentDecision).toHaveBeenCalledTimes(1);
    expect(host.submitConsentDecision).toHaveBeenLastCalledWith(
      expect.objectContaining({ decision: "deny" }),
    );
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain(
        "Outcome uncertain due to timeout or server unavailability.",
      );
    });
    expect(document.body.textContent).toContain("Automatic Host Sleep Request");

    // Next Escape when server accepts deny -> closes dialog
    shouldFail503 = false;
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
    });
    expect(host.submitConsentDecision).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => {
      expect(document.body.textContent).not.toContain("Automatic Host Sleep Request");
    });
  });
});
