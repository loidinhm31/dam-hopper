// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SshForwardHostProvider,
  SshForwardScopeBridge,
  useSshForwardHost,
} from "./SshForwardHostContext.js";
import { useSshForward } from "@/hooks/use-ssh-forward.js";
import type { SshForwardHost } from "@/lib/ssh-forward-host.js";
import type { ServerProfileChange } from "@/api/server-config.js";

const { profileChanges, activeProfileId } = vi.hoisted(() => ({
  profileChanges: new Set<(event: ServerProfileChange) => void>(),
  activeProfileId: { value: "33333333-3333-4333-8333-333333333333" },
}));
vi.mock("@/api/server-config.js", () => ({
  getActiveProfileId: () => activeProfileId.value,
  readServerProfiles: () => ({
    status: "available",
    profiles: [{ id: "33333333-3333-4333-8333-333333333333" }],
  }),
  subscribeToProfileChanges: (
    listener: (event: ServerProfileChange) => void,
  ) => {
    profileChanges.add(listener);
    return () => profileChanges.delete(listener);
  },
}));

let root: Root | null = null;
const host = (): SshForwardHost => ({
  openClient: vi.fn().mockResolvedValue({}),
  activateScope: vi
    .fn()
    .mockResolvedValue({ scopeId: "33333333-3333-4333-8333-333333333333" }),
  snapshot: vi.fn(),
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  deleteProfile: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  restart: vi.fn(),
  listKeys: vi.fn(),
  loadKey: vi.fn(),
  loadPassword: vi.fn(),
  approveHost: vi.fn(),
  purgeScope: vi.fn().mockResolvedValue({}),
  subscribe: vi.fn(() => () => {}),
  dispose: vi.fn(),
});
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  profileChanges.clear();
  activeProfileId.value = "33333333-3333-4333-8333-333333333333";
});

describe("SshForwardScopeBridge", () => {
  it("waits for client opening and scope activation before the first snapshot", async () => {
    const value = host();
    const open = deferred<Awaited<ReturnType<SshForwardHost["openClient"]>>>();
    const activation =
      deferred<Awaited<ReturnType<SshForwardHost["activateScope"]>>>();
    const snapshot = vi.mocked(value.snapshot).mockResolvedValue({} as never);
    vi.mocked(value.openClient).mockReturnValue(open.promise);
    vi.mocked(value.activateScope).mockReturnValue(activation.promise);
    const container = document.createElement("div");
    root = createRoot(container);
    const refreshRef: { current: (() => Promise<unknown>) | null } = {
      current: null,
    };
    function Harness() {
      const forwarding = useSshForward();
      const { readiness } = useSshForwardHost();
      React.useEffect(() => {
        refreshRef.current = forwarding.refresh;
      }, [forwarding.refresh]);
      return (
        <output>
          {readiness}:{forwarding.snapshot ? "ready" : "waiting"}
        </output>
      );
    }

    await act(async () =>
      root?.render(
        <SshForwardHostProvider
          host={value}
          environment={{ kind: "nativeDesktop" }}
        >
          <SshForwardScopeBridge>
            <Harness />
          </SshForwardScopeBridge>
        </SshForwardHostProvider>,
      ),
    );
    expect(value.activateScope).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    await act(async () => {
      await refreshRef.current?.();
    });
    expect(snapshot).not.toHaveBeenCalled();

    open.resolve({} as never);
    await act(async () => {
      await Promise.resolve();
    });
    expect(value.activateScope).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(snapshot).not.toHaveBeenCalled();

    activation.resolve({} as never);
    await act(async () => {
      await Promise.resolve();
    });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("ready:ready");
  });

  it("reopens the native client after an initialization failure", async () => {
    const value = host();
    const retryRef: { current: (() => Promise<void>) | null } = {
      current: null,
    };
    const container = document.createElement("div");
    root = createRoot(container);
    vi.mocked(value.openClient)
      .mockRejectedValueOnce({
        code: "IPC_UNAVAILABLE",
        message: "unavailable",
        retryable: true,
      })
      .mockResolvedValueOnce({} as never);
    vi.mocked(value.activateScope).mockResolvedValue({} as never);
    vi.mocked(value.snapshot).mockResolvedValue({} as never);
    function Harness() {
      const { readiness, retryInitialization } = useSshForwardHost();
      React.useEffect(() => {
        retryRef.current = retryInitialization;
      }, [retryInitialization]);
      return <output>{readiness}</output>;
    }

    await act(async () =>
      root?.render(
        <SshForwardHostProvider
          host={value}
          environment={{ kind: "nativeDesktop" }}
        >
          <SshForwardScopeBridge>
            <Harness />
          </SshForwardScopeBridge>
        </SshForwardHostProvider>,
      ),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toBe("failed");

    await act(async () => {
      await retryRef.current?.();
    });
    expect(value.openClient).toHaveBeenCalledTimes(2);
    expect(value.activateScope).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("ready");
  });

  it("deactivates an active deletion before purging with known scopes", async () => {
    const value = host();
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <SshForwardHostProvider
          host={value}
          environment={{ kind: "nativeDesktop" }}
        >
          <SshForwardScopeBridge>ok</SshForwardScopeBridge>
        </SshForwardHostProvider>,
      ),
    );
    await act(async () => {});
    activeProfileId.value = null;
    await act(async () => {
      for (const listener of profileChanges)
        listener({
          type: "deleted",
          deletedProfileId: "33333333-3333-4333-8333-333333333333",
          knownProfileIds: { status: "available", ids: [] },
        });
    });
    expect(value.activateScope).toHaveBeenLastCalledWith(null);
    expect(value.purgeScope).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
      { status: "available", ids: [] },
    );
  });
  it("does not purge when known profiles are unavailable", async () => {
    const value = host();
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <SshForwardHostProvider
          host={value}
          environment={{ kind: "nativeDesktop" }}
        >
          <SshForwardScopeBridge>ok</SshForwardScopeBridge>
        </SshForwardHostProvider>,
      ),
    );
    await act(async () => {
      for (const listener of profileChanges)
        listener({
          type: "deleted",
          deletedProfileId: "other",
          knownProfileIds: { status: "unavailable" },
        });
    });
    expect(value.purgeScope).not.toHaveBeenCalled();
  });
});
