import { beforeEach, describe, expect, it, vi } from "vitest";
const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
import {
  createNativeSshForwardHost,
  NATIVE_SSH_FORWARD_COMMANDS,
} from "./native-ssh-forward-host";

const context = {
  desktopInstanceId: "11111111-1111-4111-8111-111111111111",
  managerSessionId: "22222222-2222-4222-8222-222222222222",
  clientEpoch: "10",
};
const scopeId = "33333333-3333-4333-8333-333333333333";
const profileId = "44444444-4444-4444-8444-444444444444";
const opened = {
  context,
  activationTokenFloor: "9",
  activeScopeId: scopeId,
  scopeGeneration: "1",
};
const activation = {
  context,
  activationToken: "10",
  scopeId,
  scopeGeneration: "1",
  snapshot: null,
};
const snapshot = {
  context,
  activationToken: "10",
  scopeId,
  scopeGeneration: "1",
  connectionsRevision: "1",
  rulesRevision: "1",
  profilesRevision: "1",
  trustRevision: "1",
  connections: [],
  rules: [],
  connectionRuntimes: [],
  ruleRuntimes: [],
  credentialStates: [],
  profiles: [],
  runtimes: [],
  hostKeyChallenges: [],
};
const legacyProfile = {
  id: profileId,
  scopeId,
  name: "metrics",
  sshHost: "bastion.example",
  sshPort: 22,
  sshUser: "operator",
  auth: { mode: "agent" },
  localPort: 3001,
  targetHost: "127.0.0.1",
  targetPort: 3001,
  autoStart: false,
  reconnect: { enabled: false, maxAttempts: 0 },
  createdAt: "2026-08-15T17:51:28.376Z",
  updatedAt: "2026-08-15T19:10:52.954Z",
};
const restartError = {
  code: "MANAGER_SESSION_MISMATCH",
  message: "restart",
  retryable: true,
};
describe("native ssh forwarding host", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
    listen.mockResolvedValue(vi.fn());
  });
  it("maps exactly the eighteen Rust command names", () => {
    expect(Object.values(NATIVE_SSH_FORWARD_COMMANDS)).toEqual([
      "ssh_forward_open_client",
      "ssh_forward_activate_scope",
      "ssh_forward_snapshot",
      "ssh_forward_create_connection",
      "ssh_forward_update_connection",
      "ssh_forward_delete_connection",
      "ssh_forward_create_rule",
      "ssh_forward_update_rule",
      "ssh_forward_delete_rule",
      "ssh_forward_connect",
      "ssh_forward_disconnect",
      "ssh_forward_set_rule_enabled",
      "ssh_forward_list_keys",
      "ssh_forward_load_key",
      "ssh_forward_load_password",
      "ssh_forward_forget_credential",
      "ssh_forward_approve_host",
      "ssh_forward_purge_scope",
    ]);
    expect(Object.keys(NATIVE_SSH_FORWARD_COMMANDS)).toHaveLength(18);
  });
  it("does zero Tauri calls unless the Windows capability is enabled", () => {
    for (const platform of ["android", "ios", "linux", "macos", "unknown"])
      expect(createNativeSshForwardHost(platform)).toBeNull();
    expect(createNativeSshForwardHost("windows", false)).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });
  it("installs listener before open and sends canonical incremented activation", async () => {
    invoke.mockResolvedValueOnce(opened).mockResolvedValueOnce(activation);
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [scopeId] });
    await host.activateScope(scopeId);
    expect(listen).toHaveBeenCalledBefore(invoke);
    expect(invoke.mock.calls[1]).toEqual([
      "ssh_forward_activate_scope",
      { input: { context, activationToken: "10", scopeId } },
    ]);
  });
  it("rejects malformed errors and mismatched activation responses", async () => {
    invoke.mockRejectedValueOnce({
      code: "NOT_ALLOWLISTED",
      message: "raw",
      retryable: true,
      raw: "secret",
    });
    await expect(
      createNativeSshForwardHost("windows")!.openClient({
        status: "available",
        ids: [],
      }),
    ).rejects.toMatchObject({ code: "IPC_UNAVAILABLE" });
    invoke.mockReset();
    invoke
      .mockResolvedValueOnce(opened)
      .mockResolvedValueOnce({ ...activation, scopeGeneration: "wrong" })
      .mockResolvedValueOnce({ ...activation, activationToken: "11" });
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [scopeId] });
    await expect(host.activateScope(scopeId)).rejects.toMatchObject({
      code: "IPC_UNAVAILABLE",
    });
    await host.activateScope(scopeId);
    expect(invoke.mock.calls[2]).toEqual([
      "ssh_forward_activate_scope",
      { input: { context, activationToken: "11", scopeId } },
    ]);
  });
  it("rejects non-UUID scope IDs before sending them to Rust", async () => {
    invoke.mockResolvedValueOnce(opened);
    const host = createNativeSshForwardHost("windows")!;

    await host.openClient({ status: "available", ids: [] });
    await expect(
      host.activateScope("phase5-runtime-profile"),
    ).rejects.toMatchObject({
      code: "IPC_UNAVAILABLE",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("rejects superseded A after B and C without publishing A's scope", async () => {
    let resolveA!: (value: typeof activation) => void;
    const scopeB = "55555555-5555-4555-8555-555555555555";
    invoke
      .mockResolvedValueOnce(opened)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveA = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ...activation,
        activationToken: "11",
        scopeId: scopeB,
      })
      .mockResolvedValueOnce({
        ...activation,
        activationToken: "12",
        scopeId: null,
      });
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [scopeId, scopeB] });
    const a = host.activateScope(scopeId);
    await host.activateScope(scopeB);
    await host.activateScope(null);
    resolveA(activation);
    await expect(a).rejects.toMatchObject({ code: "ACTIVATION_SUPERSEDED" });
  });
  it("rejects Rust-incompatible numeric shorthand hosts", async () => {
    const malformed = {
      ...snapshot,
      connections: [
        {
          id: profileId,
          scopeId,
          name: "metrics",
          sshHost: "1",
          sshPort: 22,
          sshUser: "operator",
          auth: { mode: "agent" },
          createdAt: "2026-08-15T17:51:28.376Z",
          updatedAt: "2026-08-15T19:10:52.954Z",
        },
      ],
      credentialStates: [{ connectionProfileId: profileId, status: "none" }],
    };
    invoke
      .mockResolvedValueOnce(opened)
      .mockResolvedValueOnce(activation)
      .mockResolvedValueOnce(malformed);
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [scopeId] });
    await host.activateScope(scopeId);
    await expect(host.snapshot()).rejects.toMatchObject({
      code: "IPC_UNAVAILABLE",
    });
  });
  it("rejects a command result from an old client epoch", async () => {
    let resolveSnapshot!: (value: typeof snapshot) => void;
    invoke
      .mockResolvedValueOnce(opened)
      .mockResolvedValueOnce(activation)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSnapshot = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ...opened,
        context: { ...context, clientEpoch: "11" },
        activationTokenFloor: "10",
      });
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [scopeId] });
    await host.activateScope(scopeId);
    const stale = host.snapshot();
    await host.openClient({ status: "available", ids: [scopeId] });
    resolveSnapshot(snapshot);
    await expect(stale).rejects.toMatchObject({ code: "IPC_UNAVAILABLE" });
  });
  it("does not let an older concurrent snapshot regress accepted freshness", async () => {
    let resolveOld!: (value: typeof snapshot) => void;
    let resolveNew!: (value: typeof snapshot) => void;
    const newer = { ...snapshot, connectionsRevision: "2" as const };
    invoke
      .mockResolvedValueOnce(opened)
      .mockResolvedValueOnce(activation)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNew = resolve;
          }),
      );
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [scopeId] });
    await host.activateScope(scopeId);
    const old = host.snapshot();
    const current = host.snapshot();
    await vi.waitFor(() => {
      expect(resolveOld).toEqual(expect.any(Function));
      expect(resolveNew).toEqual(expect.any(Function));
    });
    resolveNew(newer);
    await expect(current).resolves.toEqual(newer);
    resolveOld(snapshot);
    await expect(old).resolves.toEqual(newer);
  });
  it("accepts a persisted profile snapshot with trust-repair metadata", async () => {
    const persisted = {
      ...snapshot,
      profilesRevision: "9",
      profiles: [
        {
          id: profileId,
          scopeId,
          name: "metrics",
          sshHost: "bastion.example",
          sshPort: 22,
          sshUser: "operator",
          auth: { mode: "agent" },
          localPort: 3001,
          targetHost: "127.0.0.1",
          targetPort: 3001,
          autoStart: false,
          reconnect: { enabled: false, maxAttempts: 0 },
          createdAt: "2026-08-15T17:51:28.376Z",
          updatedAt: "2026-08-15T19:10:52.954Z",
        },
      ],
      runtimes: [
        {
          profileId,
          generation: "1",
          state: "stopped",
          bindHost: "127.0.0.1",
          localPort: 3001,
          retryAttempt: 0,
          activeChannels: 0,
          autoStartDisposition: "notRequested",
          stateChangedAt: "2026-08-15T19:10:22.712Z",
        },
      ],
      trustRepair: {
        trustPath: "C:\\temp\\known-hosts.toml",
        executablePath: "C:\\temp\\dam-hopper-native.exe",
      },
    };
    invoke
      .mockResolvedValueOnce(opened)
      .mockResolvedValueOnce(activation)
      .mockResolvedValueOnce(persisted);
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [scopeId] });
    await host.activateScope(scopeId);
    await expect(host.snapshot()).resolves.toEqual(persisted);
  });
  it("accepts local and agent key sources from the native inventory", async () => {
    const keys = {
      context,
      scopeId,
      scopeGeneration: "1",
      keys: [
        {
          keyId: "agent-0",
          label: "Agent identity 1",
          algorithm: "ssh-ed25519",
          fingerprint: `SHA256:${"A".repeat(43)}`,
          encrypted: false,
          source: "agent",
        },
        {
          keyId: "key-local",
          label: "work (passphrase required)",
          algorithm: "ssh-ed25519",
          fingerprint: `SHA256:${"B".repeat(43)}`,
          encrypted: true,
          source: "local",
        },
      ],
    };
    invoke
      .mockResolvedValueOnce(opened)
      .mockResolvedValueOnce(activation)
      .mockResolvedValueOnce(keys);
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [scopeId] });
    await host.activateScope(scopeId);
    await expect(host.listKeys()).resolves.toEqual(keys);
  });
  it("does not replay mutations after a manager restart", async () => {
    invoke
      .mockResolvedValueOnce(opened)
      .mockResolvedValueOnce(activation)
      .mockRejectedValueOnce(restartError)
      .mockResolvedValueOnce({
        ...opened,
        context: {
          ...context,
          managerSessionId: "55555555-5555-4555-8555-555555555555",
        },
        activationTokenFloor: "10",
      })
      .mockResolvedValueOnce({
        context: {
          ...context,
          managerSessionId: "55555555-5555-4555-8555-555555555555",
        },
        activationToken: "11",
        scopeId,
        scopeGeneration: "1",
        snapshot: null,
      })
      .mockResolvedValueOnce({
        ...snapshot,
        context: {
          ...context,
          managerSessionId: "55555555-5555-4555-8555-555555555555",
        },
        activationToken: "11",
      });
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [scopeId] });
    await host.activateScope(scopeId);
    await expect(host.start(profileId, "1")).rejects.toEqual(restartError);
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === NATIVE_SSH_FORWARD_COMMANDS.connect,
      ),
    ).toHaveLength(1);
  });
  it("accepts one hint refresh and coalesces duplicate/reordered hints", async () => {
    let handler: ((event: { payload: unknown }) => void) | undefined;
    listen.mockImplementation(async (_name, next) => {
      handler = next;
      return vi.fn();
    });
    let resolveSnapshot!: (value: typeof snapshot) => void;
    invoke
      .mockResolvedValueOnce(opened)
      .mockResolvedValueOnce(activation)
      .mockResolvedValueOnce(snapshot)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSnapshot = resolve;
          }),
      );
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [scopeId] });
    await host.activateScope(scopeId);
    await host.snapshot();
    const hint = {
      desktopInstanceId: context.desktopInstanceId,
      managerSessionId: context.managerSessionId,
      clientEpoch: context.clientEpoch,
      activationToken: "10",
      scopeId,
      scopeGeneration: "1",
      connectionsRevision: "10",
      rulesRevision: "1",
      profilesRevision: "10",
      trustRevision: "1",
      reason: "profilesChanged",
    };
    handler!({ payload: hint });
    handler!({ payload: hint });
    handler!({ payload: { ...hint, profilesRevision: "9" } });
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(
          ([command]) => command === NATIVE_SSH_FORWARD_COMMANDS.snapshot,
        ),
      ).toHaveLength(2),
    );
    resolveSnapshot({ ...snapshot, profilesRevision: "10" });
    await Promise.resolve();
    await Promise.resolve();
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === NATIVE_SSH_FORWARD_COMMANDS.snapshot,
      ),
    ).toHaveLength(2);
  });
  it("refreshes runtime hints even when scope revisions are unchanged", async () => {
    let handler: ((event: { payload: unknown }) => void) | undefined;
    listen.mockImplementation(async (_name, next) => {
      handler = next;
      return vi.fn();
    });
    const runningSnapshot = {
      ...snapshot,
      profiles: [legacyProfile],
      runtimes: [
        {
          profileId,
          generation: "1",
          state: "failed",
          bindHost: "127.0.0.1",
          localPort: 3001,
          retryAttempt: 0,
          activeChannels: 0,
          autoStartDisposition: "notRequested",
          stateChangedAt: "2026-08-15T19:10:22.712Z",
          errorCode: "AGENT_UNAVAILABLE",
        },
      ],
    };
    invoke
      .mockResolvedValueOnce(opened)
      .mockResolvedValueOnce(activation)
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(runningSnapshot);
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [scopeId] });
    await host.activateScope(scopeId);
    await host.snapshot();
    handler!({
      payload: {
        desktopInstanceId: context.desktopInstanceId,
        managerSessionId: context.managerSessionId,
        clientEpoch: context.clientEpoch,
        activationToken: "10",
        scopeId,
        scopeGeneration: "1",
        connectionsRevision: "1",
        rulesRevision: "1",
        profilesRevision: "1",
        trustRevision: "1",
        profileId,
        generation: "1",
        reason: "runtimeChanged",
      },
    });
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(
          ([command]) => command === NATIVE_SSH_FORWARD_COMMANDS.snapshot,
        ),
      ).toHaveLength(2),
    );
  });
  it("defers hint snapshots while a connection command is in flight", async () => {
    let handler: ((event: { payload: unknown }) => void) | undefined;
    listen.mockImplementation(async (_name, next) => {
      handler = next;
      return vi.fn();
    });
    const failedSnapshot = {
      ...snapshot,
      profiles: [legacyProfile],
      runtimes: [
        {
          profileId,
          generation: "1",
          state: "failed",
          bindHost: "127.0.0.1",
          localPort: 3001,
          retryAttempt: 0,
          activeChannels: 0,
          autoStartDisposition: "notRequested",
          stateChangedAt: "2026-08-15T19:10:22.712Z",
          errorCode: "AGENT_UNAVAILABLE",
        },
      ],
    };
    let resolveConnect!: (value: typeof failedSnapshot) => void;
    invoke
      .mockResolvedValueOnce(opened)
      .mockResolvedValueOnce(activation)
      .mockResolvedValueOnce(snapshot)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveConnect = resolve;
          }),
      )
      .mockResolvedValueOnce(failedSnapshot);
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [scopeId] });
    await host.activateScope(scopeId);
    await host.snapshot();
    const connect = host.connect(profileId, "0");
    handler!({
      payload: {
        desktopInstanceId: context.desktopInstanceId,
        managerSessionId: context.managerSessionId,
        clientEpoch: context.clientEpoch,
        activationToken: "10",
        scopeId,
        scopeGeneration: "1",
        connectionsRevision: "1",
        rulesRevision: "1",
        profilesRevision: "1",
        trustRevision: "1",
        profileId,
        generation: "1",
        reason: "runtimeChanged",
      },
    });
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === NATIVE_SSH_FORWARD_COMMANDS.snapshot,
      ),
    ).toHaveLength(1);
    resolveConnect(failedSnapshot);
    await expect(connect).resolves.toEqual(failedSnapshot);
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(
          ([command]) => command === NATIVE_SSH_FORWARD_COMMANDS.snapshot,
        ),
      ).toHaveLength(2),
    );
  });
  it("dispose only unlistens", async () => {
    const unlisten = vi.fn();
    listen.mockResolvedValue(unlisten);
    invoke.mockResolvedValue(opened);
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [] });
    host.dispose();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
