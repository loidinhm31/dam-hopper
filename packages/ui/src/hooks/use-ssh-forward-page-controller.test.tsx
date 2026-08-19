// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SshConnectionProfile,
  SshForwardRule,
  SshForwardSnapshot,
} from "@/lib/ssh-forward-host.js";
import { useSshForwardPageController } from "./use-ssh-forward-page-controller.js";

const mocks = vi.hoisted(() => ({
  host: {
    value: {
      host: {} as never,
      environment: { kind: "nativeDesktop" as const },
      readiness: "unmanaged" as const,
      readinessError: null,
      retryInitialization: vi.fn().mockResolvedValue(undefined),
    },
  },
  forwarding: { value: null as Record<string, unknown> | null },
}));

vi.mock("@/contexts/SshForwardHostContext.js", () => ({
  useSshForwardHost: () => mocks.host.value,
}));
vi.mock("@/hooks/use-ssh-forward.js", () => ({
  useSshForward: () => mocks.forwarding.value,
}));

const counter = (value: string) => value as never;
const connection: SshConnectionProfile = {
  id: "22222222-2222-4222-8222-222222222222",
  scopeId: "11111111-1111-4111-8111-111111111111",
  name: "Bastion",
  sshHost: "bastion.example",
  sshPort: 22,
  sshUser: "operator",
  auth: { mode: "agent" },
  createdAt: "2026-08-10T12:34:56.789Z" as never,
  updatedAt: "2026-08-10T12:34:56.789Z" as never,
};
const rule: SshForwardRule = {
  id: "33333333-3333-4333-8333-333333333333",
  scopeId: connection.scopeId,
  connectionProfileId: connection.id,
  name: "metrics",
  localPort: 15432,
  targetHost: "127.0.0.1",
  targetPort: 5432,
  desiredEnabled: false,
  reconnect: { enabled: true, maxAttempts: 5 },
  createdAt: connection.createdAt,
  updatedAt: connection.updatedAt,
};

function snapshot(
  state: "disconnected" | "authenticating" | "established",
  errorCode?: "AUTH_REQUIRED" | "AUTH_FAILED",
): SshForwardSnapshot {
  return {
    context: {
      desktopInstanceId: "11111111-1111-4111-8111-111111111111",
      managerSessionId: "22222222-2222-4222-8222-222222222222",
      clientEpoch: counter("1"),
    },
    scopeId: connection.scopeId,
    activationToken: counter("1"),
    scopeGeneration: counter("1"),
    connectionsRevision: counter("1"),
    rulesRevision: counter("1"),
    profilesRevision: counter("1"),
    trustRevision: counter("1"),
    connections: [connection],
    rules: [],
    connectionRuntimes: [
      {
        connectionProfileId: connection.id,
        generation: counter("1"),
        state,
        retryAttempt: 0,
        activeChannels: 0,
        stateChangedAt: connection.updatedAt,
        ...(errorCode ? { errorCode } : {}),
      },
    ],
    ruleRuntimes: [],
    credentialStates: [{ connectionProfileId: connection.id, status: "none" }],
    profiles: [],
    runtimes: [],
    hostKeyChallenges: [],
  };
}

let root: Root | null = null;
let latest: ReturnType<typeof useSshForwardPageController> | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  latest = null;
});

describe("useSshForwardPageController", () => {
  beforeEach(() => {
    const base = snapshot("disconnected");
    mocks.forwarding.value = {
      snapshot: base,
      error: null,
      pending: false,
      pendingAction: null,
      refresh: vi.fn().mockResolvedValue(base),
      createConnection: vi.fn().mockResolvedValue(base),
      updateConnection: vi.fn().mockResolvedValue(base),
      deleteConnection: vi.fn().mockResolvedValue(base),
      createRule: vi.fn().mockResolvedValue(base),
      updateRule: vi.fn().mockResolvedValue(base),
      deleteRule: vi.fn().mockResolvedValue(base),
      connect: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(base),
      setRuleEnabled: vi.fn().mockResolvedValue(base),
      listKeys: vi.fn().mockResolvedValue({
        context: base.context,
        scopeId: base.scopeId,
        scopeGeneration: base.scopeGeneration,
        keys: [
          {
            keyId: "id_ed25519",
            label: "id_ed25519",
            algorithm: "ed25519",
            fingerprint: "SHA256:test",
            encrypted: true,
            source: "local",
          },
        ],
      }),
      loadKey: vi.fn().mockResolvedValue(base),
      loadPassword: vi.fn(),
      approveHost: vi.fn().mockResolvedValue(base),
      forgetCredential: vi.fn().mockResolvedValue(base),
    };
  });

  it("keeps the credential prompt open when a replacement credential also fails", async () => {
    const authRequired = snapshot("authenticating", "AUTH_REQUIRED");
    const authFailed = snapshot("authenticating", "AUTH_FAILED");
    const established = snapshot("established");
    const forwarding = mocks.forwarding.value!;
    const connect = forwarding.connect as ReturnType<typeof vi.fn>;
    const listKeys = forwarding.listKeys as ReturnType<typeof vi.fn>;
    const loadPassword = forwarding.loadPassword as ReturnType<typeof vi.fn>;
    connect
      .mockResolvedValueOnce(authRequired)
      .mockResolvedValueOnce(authFailed)
      .mockResolvedValueOnce(established);
    loadPassword
      .mockResolvedValueOnce(authFailed)
      .mockResolvedValueOnce(established);
    mocks.forwarding.value = forwarding;

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    function Harness() {
      const controller = useSshForwardPageController();
      React.useEffect(() => {
        latest = controller;
      }, [controller]);
      return null;
    }
    await act(async () => root?.render(<Harness />));

    await act(async () => {
      await latest!.connect(connection);
    });
    await act(async () => {});
    expect(latest!.passphraseTarget?.connection.id).toBe(connection.id);

    await act(async () => {
      await latest!.submitPassword("operator", "first-secret", 30);
    });
    await act(async () => {});
    expect(loadPassword).toHaveBeenCalledTimes(1);
    expect(latest!.passphraseTarget?.connection.id).toBe(connection.id);
    expect(latest!.passphraseError).toContain("SSH authentication failed");

    await act(async () => {
      await latest!.submitPassword("operator", "second-secret", 30);
    });
    expect(loadPassword).toHaveBeenCalledTimes(2);
    expect(latest!.passphraseTarget).toBeNull();
    expect(listKeys).toHaveBeenCalledTimes(2);
  });

  it("clears transient forms when the native host identity changes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    function Harness() {
      const controller = useSshForwardPageController();
      React.useEffect(() => {
        latest = controller;
      }, [controller]);
      return null;
    }
    await act(async () => root?.render(<Harness />));
    act(() => latest!.openNewConnection());
    expect(latest!.connectionFormOpen).toBe(true);

    mocks.host.value = {
      ...mocks.host.value,
      host: {} as never,
    };
    await act(async () => root?.render(<Harness />));
    await act(async () => {});
    expect(latest!.connectionFormOpen).toBe(false);
    expect(latest!.notice).toBeNull();
  });

  it("allows child rule mutations while the SSH connection is disconnected", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    function Harness() {
      const controller = useSshForwardPageController();
      React.useEffect(() => {
        latest = controller;
      }, [controller]);
      return null;
    }
    await act(async () => root?.render(<Harness />));

    act(() => latest!.openNewRule(connection));
    expect(latest!.ruleFormOpen).toBe(true);

    act(() => latest!.openEditRule(connection, rule));
    expect(latest!.ruleFormOpen).toBe(true);
    expect(latest!.ruleFormExisting?.id).toBe(rule.id);

    act(() =>
      latest!.requestDeleteRule(connection, { ...rule, desiredEnabled: true }),
    );
    expect(latest!.confirmation?.kind).toBe("deleteRule");

    const setRuleEnabled = mocks.forwarding.value!.setRuleEnabled as ReturnType<
      typeof vi.fn
    >;
    await act(async () => {
      latest!.setRuleEnabled(connection, rule, true);
    });
    expect(setRuleEnabled).toHaveBeenCalledWith(
      connection.id,
      "1",
      rule.id,
      "0",
      true,
    );
  });
});
