import { beforeEach, describe, expect, it, vi } from "vitest";
const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
import { createNativeSshForwardHost, NATIVE_SSH_FORWARD_COMMANDS } from "./native-ssh-forward-host";

const context = { desktopInstanceId: "11111111-1111-4111-8111-111111111111", managerSessionId: "22222222-2222-4222-8222-222222222222", clientEpoch: "10" };
const scopeId = "33333333-3333-4333-8333-333333333333";
const profileId = "44444444-4444-4444-8444-444444444444";
const opened = { context, activationTokenFloor: "9", activeScopeId: scopeId, scopeGeneration: "1" };
const activation = { context, activationToken: "10", scopeId, scopeGeneration: "1", snapshot: null };
const snapshot = { context, activationToken: "10", scopeId, scopeGeneration: "1", profilesRevision: "1", trustRevision: "1", profiles: [], runtimes: [], hostKeyChallenges: [] };
const restartError = { code: "MANAGER_SESSION_MISMATCH", message: "restart", retryable: true };
describe("native ssh forwarding host", () => {
  beforeEach(() => { invoke.mockReset(); listen.mockReset(); listen.mockResolvedValue(vi.fn()); });
  it("maps exactly the twelve Rust command names", () => {
    expect(Object.values(NATIVE_SSH_FORWARD_COMMANDS)).toEqual(["ssh_forward_open_client", "ssh_forward_activate_scope", "ssh_forward_snapshot", "ssh_forward_create_profile", "ssh_forward_update_profile", "ssh_forward_delete_profile", "ssh_forward_start", "ssh_forward_stop", "ssh_forward_restart", "ssh_forward_list_keys", "ssh_forward_approve_host", "ssh_forward_purge_scope"]);
    expect(Object.keys(NATIVE_SSH_FORWARD_COMMANDS)).toHaveLength(12);
  });
  it("does zero Tauri calls unless the Windows capability is enabled", () => {
    for (const platform of ["android", "ios", "linux", "macos", "unknown"]) expect(createNativeSshForwardHost(platform)).toBeNull();
    expect(createNativeSshForwardHost("windows", false)).toBeNull();
    expect(invoke).not.toHaveBeenCalled(); expect(listen).not.toHaveBeenCalled();
  });
  it("installs listener before open and sends canonical incremented activation", async () => {
    invoke.mockResolvedValueOnce(opened).mockResolvedValueOnce(activation);
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [scopeId] }); await host.activateScope(scopeId);
    expect(listen).toHaveBeenCalledBefore(invoke);
    expect(invoke.mock.calls[1]).toEqual(["ssh_forward_activate_scope", { input: { context, activationToken: "10", scopeId } }]);
  });
  it("rejects malformed errors and mismatched activation responses", async () => {
    invoke.mockRejectedValueOnce({ code: "NOT_ALLOWLISTED", message: "raw", retryable: true, raw: "secret" });
    await expect(createNativeSshForwardHost("windows")!.openClient({ status: "available", ids: [] })).rejects.toMatchObject({ code: "IPC_UNAVAILABLE" });
    invoke.mockReset(); invoke.mockResolvedValueOnce(opened).mockResolvedValueOnce({ ...activation, scopeGeneration: "wrong" });
    const host = createNativeSshForwardHost("windows")!; await host.openClient({ status: "available", ids: [scopeId] });
    await expect(host.activateScope(scopeId)).rejects.toMatchObject({ code: "IPC_UNAVAILABLE" });
  });
  it("rejects superseded A after B and C without publishing A's scope", async () => {
    let resolveA!: (value: typeof activation) => void;
    const scopeB = "55555555-5555-4555-8555-555555555555";
    invoke.mockResolvedValueOnce(opened).mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }))
      .mockResolvedValueOnce({ ...activation, activationToken: "11", scopeId: scopeB })
      .mockResolvedValueOnce({ ...activation, activationToken: "12", scopeId: null });
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [scopeId, scopeB] });
    const a = host.activateScope(scopeId);
    await host.activateScope(scopeB);
    await host.activateScope(null);
    resolveA(activation);
    await expect(a).rejects.toMatchObject({ code: "ACTIVATION_SUPERSEDED" });
  });
  it("rejects a command result from an old client epoch", async () => {
    let resolveSnapshot!: (value: typeof snapshot) => void;
    invoke.mockResolvedValueOnce(opened).mockResolvedValueOnce(activation).mockImplementationOnce(() => new Promise((resolve) => { resolveSnapshot = resolve; }))
      .mockResolvedValueOnce({ ...opened, context: { ...context, clientEpoch: "11" }, activationTokenFloor: "10" });
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [scopeId] }); await host.activateScope(scopeId);
    const stale = host.snapshot();
    await host.openClient({ status: "available", ids: [scopeId] });
    resolveSnapshot(snapshot);
    await expect(stale).rejects.toMatchObject({ code: "IPC_UNAVAILABLE" });
  });
  it("does not replay mutations after a manager restart", async () => {
    invoke.mockResolvedValueOnce(opened).mockResolvedValueOnce(activation).mockRejectedValueOnce(restartError)
      .mockResolvedValueOnce({ ...opened, context: { ...context, managerSessionId: "55555555-5555-4555-8555-555555555555" }, activationTokenFloor: "10" })
      .mockResolvedValueOnce({ context: { ...context, managerSessionId: "55555555-5555-4555-8555-555555555555" }, activationToken: "11", scopeId, scopeGeneration: "1", snapshot: null })
      .mockResolvedValueOnce({ ...snapshot, context: { ...context, managerSessionId: "55555555-5555-4555-8555-555555555555" }, activationToken: "11" });
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [scopeId] }); await host.activateScope(scopeId);
    await expect(host.start(profileId, "1")).rejects.toEqual(restartError);
    expect(invoke.mock.calls.filter(([command]) => command === NATIVE_SSH_FORWARD_COMMANDS.start)).toHaveLength(1);
  });
  it("accepts one hint refresh and coalesces duplicate/reordered hints", async () => {
    let handler: ((event: { payload: unknown }) => void) | undefined;
    listen.mockImplementation(async (_name, next) => { handler = next; return vi.fn(); });
    let resolveSnapshot!: (value: typeof snapshot) => void;
    invoke.mockResolvedValueOnce(opened).mockResolvedValueOnce(activation).mockResolvedValueOnce(snapshot).mockImplementationOnce(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    const host = createNativeSshForwardHost("windows")!;
    await host.openClient({ status: "available", ids: [scopeId] }); await host.activateScope(scopeId); await host.snapshot();
    const hint = { desktopInstanceId: context.desktopInstanceId, managerSessionId: context.managerSessionId, clientEpoch: context.clientEpoch, activationToken: "10", scopeId, scopeGeneration: "1", profilesRevision: "10", trustRevision: "1", reason: "profilesChanged" };
    handler!({ payload: hint }); handler!({ payload: hint }); handler!({ payload: { ...hint, profilesRevision: "9" } });
    expect(invoke.mock.calls.filter(([command]) => command === NATIVE_SSH_FORWARD_COMMANDS.snapshot)).toHaveLength(2);
    resolveSnapshot({ ...snapshot, profilesRevision: "10" }); await Promise.resolve(); await Promise.resolve();
    expect(invoke.mock.calls.filter(([command]) => command === NATIVE_SSH_FORWARD_COMMANDS.snapshot)).toHaveLength(2);
  });
  it("dispose only unlistens", async () => { const unlisten = vi.fn(); listen.mockResolvedValue(unlisten); invoke.mockResolvedValue(opened); const host = createNativeSshForwardHost("windows")!; await host.openClient({ status: "available", ids: [] }); host.dispose(); expect(unlisten).toHaveBeenCalledOnce(); expect(invoke).toHaveBeenCalledTimes(1); });
});
