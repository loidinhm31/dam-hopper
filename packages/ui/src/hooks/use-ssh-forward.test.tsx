// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SshForwardHostProvider } from "@/contexts/SshForwardHostContext.js";
import {
  parseWireCounter,
  type DesktopClientContext,
  type SshForwardHost,
  type SshForwardHostEvent,
  type SshForwardSnapshot,
} from "@/lib/ssh-forward-host.js";
import { useSshForward } from "./use-ssh-forward.js";

const counter = (value: string) => parseWireCounter(value)!;
const context: DesktopClientContext = {
  desktopInstanceId: "11111111-1111-4111-8111-111111111111",
  managerSessionId: "22222222-2222-4222-8222-222222222222",
  clientEpoch: counter("1"),
};
const snapshot: SshForwardSnapshot = {
  context,
  activationToken: counter("1"),
  scopeId: "33333333-3333-4333-8333-333333333333",
  scopeGeneration: counter("1"),
  connectionsRevision: counter("1"),
  rulesRevision: counter("1"),
  profilesRevision: counter("1"),
  trustRevision: counter("1"),
  connections: [],
  rules: [],
  connectionRuntimes: [],
  ruleRuntimes: [],
  credentialStates: [],
  profiles: [],
  runtimes: [],
  hostKeyChallenges: [],
};
let root: Root | null = null;
let latest: ReturnType<typeof useSshForward> | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  latest = null;
});

describe("useSshForward", () => {
  function renderHarness(host: SshForwardHost) {
    const container = document.createElement("div");
    root = createRoot(container);
    function Harness() {
      const state = useSshForward();
      const { refresh } = state;
      React.useEffect(() => {
        latest = state;
      }, [state]);
      React.useEffect(() => {
        void refresh();
      }, [refresh]);
      return null;
    }
    return act(async () =>
      root?.render(
        <SshForwardHostProvider
          host={host}
          environment={{ kind: "nativeDesktop" }}
        >
          <Harness />
        </SshForwardHostProvider>,
      ),
    );
  }

  it("uses an adapter-provided accepted snapshot without a second refresh", async () => {
    let listener!: (event: SshForwardHostEvent) => void;
    const snapshotCall = vi
      .fn<() => Promise<SshForwardSnapshot>>()
      .mockResolvedValue(snapshot);
    const subscribe = vi.fn((next: (event: SshForwardHostEvent) => void) => {
      listener = next;
      return () => {};
    });
    const host = {
      snapshot: snapshotCall,
      subscribe,
    } as unknown as SshForwardHost;
    await renderHarness(host);
    await act(async () => {});
    snapshotCall.mockClear();
    const hint = {
      desktopInstanceId: context.desktopInstanceId,
      managerSessionId: context.managerSessionId,
      clientEpoch: context.clientEpoch,
      activationToken: snapshot.activationToken,
      scopeId: snapshot.scopeId,
      scopeGeneration: snapshot.scopeGeneration,
      connectionsRevision: snapshot.connectionsRevision,
      rulesRevision: snapshot.rulesRevision,
      profilesRevision: snapshot.profilesRevision,
      trustRevision: snapshot.trustRevision,
      reason: "profilesChanged" as const,
    };
    await act(async () => listener({ type: "changed", hint, snapshot }));
    expect(snapshotCall).not.toHaveBeenCalled();
  });

  it("refreshes authoritative state after a revision conflict", async () => {
    const refreshed = { ...snapshot, profilesRevision: counter("2") };
    const snapshotCall = vi
      .fn<() => Promise<SshForwardSnapshot>>()
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(refreshed);
    const subscribe = vi.fn(() => () => {});
    const updateConnection = vi.fn().mockRejectedValue({
      code: "PROFILES_REVISION_CONFLICT",
      message: "stale",
      retryable: true,
    });
    const host = {
      snapshot: snapshotCall,
      subscribe,
      updateConnection,
    } as unknown as SshForwardHost;
    await renderHarness(host);
    await act(async () => {});
    await expect(
      act(async () =>
        latest!.updateConnection("connection", counter("1"), {} as never),
      ),
    ).rejects.toMatchObject({ code: "PROFILES_REVISION_CONFLICT" });
    expect(snapshotCall).toHaveBeenCalledTimes(2);
  });

  it("refreshes only hints matching the current context, token, and scope", async () => {
    let listener!: (event: SshForwardHostEvent) => void;
    const snapshotCall = vi
      .fn<() => Promise<SshForwardSnapshot>>()
      .mockResolvedValue(snapshot);
    const subscribe = vi.fn((next: (event: SshForwardHostEvent) => void) => {
      listener = next;
      return () => {};
    });
    const host = {
      snapshot: snapshotCall,
      subscribe,
    } as unknown as SshForwardHost;
    await renderHarness(host);
    await act(async () => {});
    snapshotCall.mockClear();
    const hint = {
      desktopInstanceId: context.desktopInstanceId,
      managerSessionId: context.managerSessionId,
      clientEpoch: counter("2"),
      activationToken: snapshot.activationToken,
      scopeId: snapshot.scopeId,
      scopeGeneration: snapshot.scopeGeneration,
      connectionsRevision: snapshot.connectionsRevision,
      rulesRevision: snapshot.rulesRevision,
      profilesRevision: snapshot.profilesRevision,
      trustRevision: snapshot.trustRevision,
      reason: "profilesChanged" as const,
    };
    await act(async () => listener({ type: "changed", hint }));
    expect(snapshotCall).not.toHaveBeenCalled();
    await act(async () =>
      listener({
        type: "changed",
        hint: { ...hint, clientEpoch: context.clientEpoch },
      }),
    );
    expect(snapshotCall).toHaveBeenCalledOnce();
  });

  it("defers hint refreshes until a lifecycle mutation settles", async () => {
    const refreshed = { ...snapshot, profilesRevision: counter("2") };
    let resolveStart!: (value: SshForwardSnapshot) => void;
    const snapshotCall = vi
      .fn<() => Promise<SshForwardSnapshot>>()
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(refreshed);
    const subscribe = vi.fn(() => () => {});
    const connect = vi.fn(
      () =>
        new Promise<SshForwardSnapshot>((resolve) => {
          resolveStart = resolve;
        }),
    );
    const host = {
      snapshot: snapshotCall,
      subscribe,
      connect,
    } as unknown as SshForwardHost;
    await renderHarness(host);
    await act(async () => {});
    snapshotCall.mockClear();

    const lifecycle = latest!.connect("connection", counter("0"));
    await act(async () => latest!.refresh());
    expect(snapshotCall).not.toHaveBeenCalled();

    resolveStart(refreshed);
    await act(async () => lifecycle);
    await act(async () => {});
    expect(snapshotCall).toHaveBeenCalledOnce();
  });

  it("uses the v2 rule toggle without loading or replaying credentials", async () => {
    const setRuleEnabled = vi.fn().mockResolvedValue(snapshot);
    const listKeys = vi.fn();
    const loadPassword = vi.fn();
    const loadKey = vi.fn();
    const subscribe = vi.fn(() => () => {});
    const host = {
      snapshot: vi
        .fn<() => Promise<SshForwardSnapshot>>()
        .mockResolvedValue(snapshot),
      subscribe,
      setRuleEnabled,
      listKeys,
      loadPassword,
      loadKey,
    } as unknown as SshForwardHost;
    await renderHarness(host);
    await act(async () => {});
    await act(async () =>
      latest!.setRuleEnabled(
        "connection",
        counter("3"),
        "rule",
        counter("4"),
        true,
      ),
    );
    expect(setRuleEnabled).toHaveBeenCalledWith(
      "connection",
      counter("3"),
      "rule",
      counter("4"),
      true,
    );
    expect(listKeys).not.toHaveBeenCalled();
    expect(loadPassword).not.toHaveBeenCalled();
    expect(loadKey).not.toHaveBeenCalled();
  });

  it("serializes concurrent native mutations", async () => {
    const updated = { ...snapshot, connectionsRevision: counter("2") };
    let resolveFirst!: (value: SshForwardSnapshot) => void;
    const updateConnection = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<SshForwardSnapshot>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(updated);
    const host = {
      snapshot: vi
        .fn<() => Promise<SshForwardSnapshot>>()
        .mockResolvedValue(snapshot),
      subscribe: vi.fn(() => () => {}),
      updateConnection,
    } as unknown as SshForwardHost;
    await renderHarness(host);
    await act(async () => {});

    const first = latest!.updateConnection(
      "connection",
      counter("1"),
      {} as never,
    );
    const second = latest!.updateConnection(
      "connection",
      counter("1"),
      {} as never,
    );
    await act(async () => {});
    expect(updateConnection).toHaveBeenCalledTimes(1);

    resolveFirst(updated);
    await act(async () => first);
    await act(async () => second);
    expect(updateConnection).toHaveBeenCalledTimes(2);
  });

  it("does not replace a newer snapshot with a stale mutation result", async () => {
    const stale = { ...snapshot, connectionsRevision: counter("0") };
    const updateConnection = vi.fn().mockResolvedValue(stale);
    const host = {
      snapshot: vi
        .fn<() => Promise<SshForwardSnapshot>>()
        .mockResolvedValue(snapshot),
      subscribe: vi.fn(() => () => {}),
      updateConnection,
    } as unknown as SshForwardHost;
    await renderHarness(host);
    await act(async () => {});

    await act(async () =>
      latest!.updateConnection("connection", counter("1"), {} as never),
    );
    await act(async () => {});
    expect(latest!.snapshot?.connectionsRevision).toBe(
      snapshot.connectionsRevision,
    );
  });

  it("does not publish a stale mutation error after the scope generation changes", async () => {
    let listener!: (event: SshForwardHostEvent) => void;
    let rejectConnect!: (error: unknown) => void;
    const connect = vi.fn(
      () =>
        new Promise<SshForwardSnapshot>((_resolve, reject) => {
          rejectConnect = reject;
        }),
    );
    const host = {
      snapshot: vi
        .fn<() => Promise<SshForwardSnapshot>>()
        .mockResolvedValue(snapshot),
      subscribe: vi.fn((next: (event: SshForwardHostEvent) => void) => {
        listener = next;
        return () => {};
      }),
      connect,
    } as unknown as SshForwardHost;
    await renderHarness(host);
    await act(async () => {});

    const pending = latest!.connect("connection", counter("1"));
    await act(async () => {});
    expect(connect).toHaveBeenCalledOnce();
    const nextSnapshot = { ...snapshot, scopeGeneration: counter("2") };
    await act(async () =>
      listener({
        type: "changed",
        hint: {
          desktopInstanceId: context.desktopInstanceId,
          managerSessionId: context.managerSessionId,
          clientEpoch: context.clientEpoch,
          activationToken: snapshot.activationToken,
          scopeId: snapshot.scopeId,
          scopeGeneration: nextSnapshot.scopeGeneration,
          connectionsRevision: snapshot.connectionsRevision,
          rulesRevision: snapshot.rulesRevision,
          profilesRevision: snapshot.profilesRevision,
          trustRevision: snapshot.trustRevision,
          reason: "runtimeChanged",
        },
        snapshot: nextSnapshot,
      }),
    );
    rejectConnect({
      code: "AUTH_FAILED",
      message: "stale authentication failure",
      retryable: false,
    });
    await expect(act(async () => pending)).rejects.toMatchObject({
      code: "AUTH_FAILED",
    });
    expect(latest!.error).toBeNull();
  });
});
