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
  profilesRevision: counter("1"),
  trustRevision: counter("1"),
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
    const updateProfile = vi.fn().mockRejectedValue({
      code: "PROFILES_REVISION_CONFLICT",
      message: "stale",
      retryable: true,
    });
    const host = {
      snapshot: snapshotCall,
      subscribe,
      updateProfile,
    } as unknown as SshForwardHost;
    await renderHarness(host);
    await act(async () => {});
    await expect(
      act(async () =>
        latest!.updateProfile("profile", counter("1"), {} as never),
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
});
