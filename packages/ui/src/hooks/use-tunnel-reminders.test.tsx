// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionRef } from "@/api/ownership.js";
import type { TunnelInfo } from "@/api/client.js";
import { profileTunnelsQueryKey } from "@/api/query-client.js";
import { resetTunnelReminderDismissals } from "@/lib/tunnel-reminder-dismissal.js";
import { useTunnelReminders, type TunnelReminderController } from "./use-tunnel-reminders.js";
type Event = { data: unknown; profileId?: string; generation?: number };
const listeners = new Map<string, (event: Event) => void>();
const connectionListeners = new Set<() => void>();
const invoke = vi.fn();
let profiles = [{ id: "a" }, { id: "b" }];
let generations: Record<string, number> = { a: 1, b: 1 };
let connected: Record<string, boolean> = { a: true, b: true };
let snapshots: Record<string, TunnelInfo[]> = {};

vi.mock("@/api/server-config.js", () => ({
  getProfiles: () => profiles,
  subscribeToProfileChanges: () => () => {},
}));
vi.mock("@/api/connections.js", () => ({
  getConnectionSnapshot: (profileId: string) => ({
    owner: { profileId, generation: generations[profileId] },
    status: connected[profileId] ? "connected" : "disconnected",
  }),
  isCurrentConnection: (owner: ConnectionRef) => connected[owner.profileId] && generations[owner.profileId] === owner.generation,
  getTransport: (owner: ConnectionRef) => {
    if (!connected[owner.profileId] || generations[owner.profileId] !== owner.generation) throw new Error("stale connection");
    return { invoke: (method: string, payload?: unknown) => invoke(owner, method, payload) };
  },
  subscribeConnections: (listener: () => void) => {
    connectionListeners.add(listener);
    return () => connectionListeners.delete(listener);
  },
}));
vi.mock("./use-sse.js", () => ({
  subscribeIpc: (channel: string, listener: (event: Event) => void) => {
    listeners.set(channel, listener);
    return () => listeners.delete(channel);
  },
}));

const due: TunnelInfo = {
  id: "same", port: 3000, label: "web", driver: "cloudflared", status: "ready",
  url: "https://example.trycloudflare.com", startedAt: 1000, reminderDue: true,
};
function Harness() { current = useTunnelReminders(); return null; }
let current: TunnelReminderController;
describe("tunnel reminder boundaries", () => {
  let root: Root;
  let container: HTMLDivElement;
  let queryClient: QueryClient;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    sessionStorage.clear();
    resetTunnelReminderDismissals();
    profiles = [{ id: "a" }, { id: "b" }];
    generations = { a: 1, b: 1 };
    connected = { a: true, b: true };
    snapshots = { a: [due], b: [due] };
    listeners.clear();
    connectionListeners.clear();
    invoke.mockReset().mockImplementation((owner: ConnectionRef, method: string) =>
      Promise.resolve(method === "tunnel:list" ? snapshots[owner.profileId] : undefined),
    );
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });
  async function mount() {
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Harness)));
    });
  }
  async function expectProfiles(ids: string[]) {
    await vi.waitFor(() => expect(current.reminders.map((r) => r.profileId)).toEqual(ids));
  }

  it("catches up from REST and excludes fresh or failed tunnels", async () => {
    snapshots.a = [due, { ...due, id: "fresh", reminderDue: false }, { ...due, id: "failed", status: "failed" }];
    await mount();
    await expectProfiles(["a", "b"]);
  });

  it("dismisses only its profile without stopping and preserves that dismissal after remount", async () => {
    await mount();
    await expectProfiles(["a", "b"]);
    await act(async () => current.dismissReminder(current.reminders[0]));
    await expectProfiles(["b"]);
    await act(async () => { root.unmount(); root = createRoot(container); });
    await mount();
    await expectProfiles(["b"]);
    expect(invoke.mock.calls.filter(([, method]) => method === "tunnel:stop")).toEqual([]);
  });

  it("ignores stale and ownerless push events but accepts the current generation", async () => {
    snapshots.a = [{ ...due, reminderDue: false }];
    snapshots.b = [];
    await mount();
    await vi.waitFor(() => expect(queryClient.getQueryData(profileTunnelsQueryKey({ profileId: "a", generation: 1 }))).toEqual(snapshots.a));
    await act(async () => {
      listeners.get("tunnel:reminder")!({ data: { id: "same" }, profileId: "a", generation: 0 });
      listeners.get("tunnel:reminder")!({ data: { id: "same" } });
    });
    await expectProfiles([]);
    snapshots.a = [due];
    await act(async () => listeners.get("tunnel:reminder")!({ data: { id: "same" }, profileId: "a", generation: 1 }));
    await expectProfiles(["a"]);
  });

  it("does not query a disconnected profile and catches it up on reconnect", async () => {
    connected.b = false;
    await mount();
    await expectProfiles(["a"]);
    expect(invoke.mock.calls.some(([owner]) => owner.profileId === "b")).toBe(false);
    await act(async () => {
      connected.b = true;
      generations.b = 2;
      for (const listener of connectionListeners) listener();
    });
    await expectProfiles(["a", "b"]);
    expect(current.reminders[1].capturedOwner).toEqual({ profileId: "b", generation: 2 });
  });

  it("rejects a captured Stop after reconnect instead of rebinding it", async () => {
    await mount();
    await expectProfiles(["a", "b"]);
    const captured = current.reminders[1];
    generations.b = 2;
    await expect(current.stopTunnel(captured)).rejects.toThrow();
    expect(invoke.mock.calls.filter(([, method]) => method === "tunnel:stop")).toEqual([]);
  });

  it("stops only the selected profile when tunnel IDs match", async () => {
    await mount();
    await expectProfiles(["a", "b"]);
    await act(async () => current.stopTunnel(current.reminders[1]));
    await expectProfiles(["a"]);
    expect(queryClient.getQueryData(profileTunnelsQueryKey({ profileId: "a", generation: 1 }))).toEqual([due]);
    expect(queryClient.getQueryData(profileTunnelsQueryKey({ profileId: "b", generation: 1 }))).toEqual([]);
  });

  it("does not patch a new connection when an older Stop finishes late", async () => {
    await mount();
    await expectProfiles(["a", "b"]);
    let resolveStop!: () => void;
    invoke.mockImplementation((owner: ConnectionRef, method: string) => method === "tunnel:stop"
      ? new Promise<void>((resolve) => { resolveStop = resolve; })
      : Promise.resolve(snapshots[owner.profileId]));
    const pending = current.stopTunnel(current.reminders[1]);
    await act(async () => {
      generations.b = 2;
      queryClient.setQueryData(profileTunnelsQueryKey({ profileId: "b", generation: 2 }), [due]);
      for (const listener of connectionListeners) listener();
      resolveStop();
      await pending;
    });
    expect(queryClient.getQueryData(profileTunnelsQueryKey({ profileId: "b", generation: 2 }))).toEqual([due]);
  });

  it("does not let a delayed pre-reminder REST response erase the due transition", async () => {
    profiles = [{ id: "a" }];
    const key = profileTunnelsQueryKey({ profileId: "a", generation: 1 });
    queryClient.setQueryData(key, [{ ...due, reminderDue: false }]);
    let resolveOld!: (value: TunnelInfo[]) => void;
    invoke.mockImplementationOnce(() => new Promise<TunnelInfo[]>((resolve) => { resolveOld = resolve; }));
    await mount();
    await vi.waitFor(() => expect(resolveOld).toBeDefined());
    await act(async () => {
      snapshots.a = [due];
      await listeners.get("tunnel:reminder")!({ data: { id: "same" }, profileId: "a", generation: 1 });
      resolveOld([{ ...due, reminderDue: false }]);
    });
    await expectProfiles(["a"]);
    expect(queryClient.getQueryData<TunnelInfo[]>(key)?.[0].reminderDue).toBe(true);
  });

  it("does not resurrect a stopped tunnel from a delayed pre-stop REST response", async () => {
    profiles = [{ id: "a" }];
    await mount();
    await expectProfiles(["a"]);
    let resolveOld!: (value: TunnelInfo[]) => void;
    invoke.mockImplementationOnce(() => new Promise<TunnelInfo[]>((resolve) => { resolveOld = resolve; }));
    const refetch = queryClient.invalidateQueries({ queryKey: profileTunnelsQueryKey({ profileId: "a", generation: 1 }), exact: true });
    await vi.waitFor(() => expect(resolveOld).toBeDefined());
    await act(async () => {
      snapshots.a = [];
      await current.stopTunnel(current.reminders[0]);
      resolveOld([due]);
      await refetch;
    });
    await expectProfiles([]);
  });
});
