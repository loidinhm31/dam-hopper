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

const {
  profileChanges,
  activeProfileId,
  profileIds,
  nativeScopeAliases,
  retireNativeScopeId,
  completeNativeScopeDeletion,
} = vi.hoisted(() => ({
  profileChanges: new Set<(event: ServerProfileChange) => void>(),
  activeProfileId: {
    value: "33333333-3333-4333-8333-333333333333" as string | null,
  },
  profileIds: {
    value: ["33333333-3333-4333-8333-333333333333"],
  },
  nativeScopeAliases: new Map<string, string>(),
  retireNativeScopeId: vi.fn((profileId: string) => {
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        profileId,
      )
    )
      return profileId;
    const nativeScopeId = nativeScopeAliases.get(profileId) ?? null;
    if (nativeScopeId) nativeScopeAliases.delete(profileId);
    return nativeScopeId;
  }),
  completeNativeScopeDeletion: vi.fn(
    (profileId: string, nativeScopeId: string) => {
      if (nativeScopeAliases.get(profileId) === nativeScopeId)
        nativeScopeAliases.delete(profileId);
      return true;
    },
  ),
}));
vi.mock("@/api/server-config.js", () => ({
  getActiveProfileId: () => activeProfileId.value,
  getExistingNativeScopeId: (profileId: string) =>
    nativeScopeAliases.get(profileId) ??
    (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      profileId,
    )
      ? profileId
      : null),
  getNativeScopeIds: (ids: readonly string[]) => ({
    status: "available" as const,
    ids: ids.map((id) => {
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          id,
        )
      )
        return id;
      const existing = nativeScopeAliases.get(id);
      if (existing) return existing;
      const nativeId = `aaaaaaaa-aaaa-4aaa-8aaa-${String(nativeScopeAliases.size + 1).padStart(12, "0")}`;
      nativeScopeAliases.set(id, nativeId);
      return nativeId;
    }),
  }),
  readServerProfiles: () => ({
    status: "available",
    profiles: profileIds.value.map((id) => ({ id })),
  }),
  retireNativeScopeId,
  completeNativeScopeDeletion,
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
  purgeScope: vi.fn().mockResolvedValue({
    purged: true,
    scopeId: "33333333-3333-4333-8333-333333333333",
  }),
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
  profileIds.value = ["33333333-3333-4333-8333-333333333333"];
  nativeScopeAliases.clear();
  retireNativeScopeId.mockClear();
  completeNativeScopeDeletion.mockClear();
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

  it("refreshes native known scopes when the profile list changes", async () => {
    const firstProfileId = "33333333-3333-4333-8333-333333333333";
    const secondProfileId = "44444444-4444-4444-8444-444444444444";
    profileIds.value = [firstProfileId];
    activeProfileId.value = firstProfileId;
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
    profileIds.value = [firstProfileId, secondProfileId];
    await act(async () => {
      for (const listener of profileChanges)
        listener({ type: "profileListChanged" });
    });
    await act(async () => {});

    expect(value.openClient).toHaveBeenNthCalledWith(2, {
      status: "available",
      ids: [firstProfileId, secondProfileId],
    });
    expect(value.activateScope).toHaveBeenLastCalledWith(firstProfileId);
  });

  it("does not reopen the native client for token/data changes", async () => {
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

    await act(async () => {
      for (const listener of profileChanges) listener({ type: "dataChanged" });
    });
    await act(async () => {});

    expect(value.openClient).toHaveBeenCalledTimes(1);
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

  it("translates legacy profile IDs at the native scope boundary", async () => {
    const legacyId = "phase5-runtime-profile";
    const nativeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    profileIds.value = [legacyId];
    activeProfileId.value = legacyId;
    nativeScopeAliases.set(legacyId, nativeId);
    const value = host();
    vi.mocked(value.activateScope).mockResolvedValue({
      scopeId: nativeId,
    } as never);
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

    expect(value.openClient).toHaveBeenCalledWith({
      status: "available",
      ids: [nativeId],
    });
    expect(value.activateScope).toHaveBeenCalledWith(nativeId);

    activeProfileId.value = null;
    profileIds.value = [];
    await act(async () => {
      for (const listener of profileChanges)
        listener({
          type: "deleted",
          deletedProfileId: legacyId,
          knownProfileIds: { status: "available", ids: [] },
        });
    });

    expect(value.purgeScope).toHaveBeenCalledWith(nativeId, {
      status: "available",
      ids: [],
    });
    expect(completeNativeScopeDeletion).toHaveBeenCalledWith(
      legacyId,
      nativeId,
    );
  });

  it("retains a legacy deletion tombstone when native purge is incomplete", async () => {
    const legacyId = "phase5-runtime-profile";
    const nativeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    profileIds.value = [legacyId];
    activeProfileId.value = legacyId;
    nativeScopeAliases.set(legacyId, nativeId);
    const value = host();
    vi.mocked(value.activateScope).mockResolvedValue({
      scopeId: nativeId,
    } as never);
    vi.mocked(value.purgeScope).mockResolvedValue({
      purged: false,
      scopeId: nativeId,
    });
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
    profileIds.value = [];
    await act(async () => {
      for (const listener of profileChanges)
        listener({
          type: "deleted",
          deletedProfileId: legacyId,
          knownProfileIds: { status: "available", ids: [] },
        });
    });

    expect(value.purgeScope).toHaveBeenCalledWith(nativeId, {
      status: "available",
      ids: [],
    });
    expect(completeNativeScopeDeletion).not.toHaveBeenCalled();
  });

  it("does not invent a native scope ID when a deleted alias is missing", async () => {
    const legacyId = "phase5-runtime-profile";
    profileIds.value = ["33333333-3333-4333-8333-333333333333"];
    activeProfileId.value = "33333333-3333-4333-8333-333333333333";
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
    profileIds.value = [];
    await act(async () => {
      for (const listener of profileChanges)
        listener({
          type: "deleted",
          deletedProfileId: legacyId,
          knownProfileIds: { status: "available", ids: [] },
        });
    });

    expect(value.purgeScope).not.toHaveBeenCalled();
  });

  it("does not purge a recreated legacy profile from a stale deletion event", async () => {
    const legacyId = "phase5-runtime-profile";
    const originalId = "33333333-3333-4333-8333-333333333333";
    const oldNativeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const recreatedNativeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    profileIds.value = [originalId];
    activeProfileId.value = originalId;
    nativeScopeAliases.set(legacyId, oldNativeId);
    const value = host();
    const purge = deferred<{ scopeId: string; purged: boolean }>();
    vi.mocked(value.purgeScope).mockReturnValue(purge.promise);
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

    profileIds.value = [];
    activeProfileId.value = null;
    await act(async () => {
      for (const listener of profileChanges)
        listener({
          type: "deleted",
          deletedProfileId: legacyId,
          knownProfileIds: { status: "available", ids: [] },
        });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(value.purgeScope).toHaveBeenCalledWith(oldNativeId, {
      status: "available",
      ids: [],
    });
    profileIds.value = [legacyId];
    nativeScopeAliases.set(legacyId, recreatedNativeId);
    purge.resolve({ scopeId: oldNativeId, purged: true });
    await act(async () => {
      await purge.promise;
    });

    expect(completeNativeScopeDeletion).toHaveBeenCalledWith(
      legacyId,
      oldNativeId,
    );
    expect(nativeScopeAliases.get(legacyId)).toBe(recreatedNativeId);
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
    profileIds.value = [];
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
