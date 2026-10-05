// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PublishPreview,
  PublishResult,
  PublishSnapshot,
} from "@/api/client.js";
import { __setConnectionSnapshotForTests } from "@/api/connections.js";

const mocks = vi.hoisted(() => ({
  prepareMutateAsync: vi.fn(),
  publishMutateAsync: vi.fn(),
  executeLeasedWithRetry: vi.fn(),
  cancel: vi.fn(),
  prepareHookArgs: vi.fn(),
}));

vi.mock("@/api/queries.js", () => ({
  resolveTargetOwner: vi.fn(() => undefined),
  useGitPrepareLeasedPush: vi.fn((...args: unknown[]) => {
    mocks.prepareHookArgs(...args);
    return {
      mutateAsync: mocks.prepareMutateAsync,
      isPending: false,
    };
  }),
  useGitPublishLeasedPush: vi.fn(() => ({
    mutateAsync: mocks.publishMutateAsync,
    isPending: false,
  })),
}));

vi.mock("@/hooks/use-git-with-ssh-retry.js", () => ({
  useGitWithSshRetry: vi.fn(() => ({
    passphraseDialogProps: {
      open: false,
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      loading: false,
      error: undefined,
      availableKeys: [],
    },
    statusMessage: undefined,
    executeLeasedWithRetry: mocks.executeLeasedWithRetry,
    cancel: mocks.cancel,
  })),
}));

import {
  useLeasedGitPush,
  type UseLeasedGitPushResult,
} from "./use-leased-git-push.js";

const mockSnapshot: PublishSnapshot = {
  branch: "refs/heads/feature",
  sourceOid: "1111111111111111111111111111111111111111",
  remoteName: "origin",
  destinationRef: "refs/heads/feature",
  expectedRemoteOid: "2222222222222222222222222222222222222222",
  remoteIdentity:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  repositoryIdentity:
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

let root: Root | null = null;
let currentHook: UseLeasedGitPushResult | null = null;

function Harness({
  project,
  rootPath,
  expectedSource,
  profileId,
}: {
  project: string;
  rootPath?: string;
  expectedSource?: { branch: string; sourceOid: string };
  profileId?: string;
}) {
  const hook = useLeasedGitPush({ project, profileId }, rootPath, {
    expectedSource,
  });
  React.useEffect(() => {
    currentHook = hook;
  }, [hook]);
  return null;
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

beforeEach(() => {
  vi.clearAllMocks();
  currentHook = null;
  mocks.executeLeasedWithRetry.mockImplementation(
    async (_owner: unknown, fn: () => Promise<unknown>) => fn(),
  );
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  document.body.innerHTML = "";
  __setConnectionSnapshotForTests("lease-profile", null);
});

describe("useLeasedGitPush", () => {
  it("initializes in closed state with no preview or result", async () => {
    await act(async () => {
      root?.render(<Harness project="demo" />);
    });

    expect(currentHook?.state).toBe("closed");
    expect(currentHook?.preview).toBeNull();
    expect(currentHook?.result).toBeNull();
    expect(currentHook?.error).toBeNull();
  });

  it("transitions prepare -> confirming when remote needs push", async () => {
    const readyPreview: PublishPreview = {
      status: "ready",
      snapshot: mockSnapshot,
      alreadyCurrent: false,
    };
    mocks.prepareMutateAsync.mockResolvedValueOnce(readyPreview);

    await act(async () => {
      root?.render(<Harness project="demo" />);
    });

    await act(async () => {
      await currentHook?.prepare();
    });

    expect(currentHook?.state).toBe("confirming");
    expect(currentHook?.preview).toEqual(readyPreview);
    expect(currentHook?.result).toBeNull();
  });

  it("transitions prepare -> already-current when local matches remote", async () => {
    const readyPreview: PublishPreview = {
      status: "ready",
      snapshot: mockSnapshot,
      alreadyCurrent: true,
    };
    mocks.prepareMutateAsync.mockResolvedValueOnce(readyPreview);

    await act(async () => {
      root?.render(<Harness project="demo" />);
    });

    await act(async () => {
      await currentHook?.prepare();
    });

    expect(currentHook?.state).toBe("already-current");
    expect(currentHook?.preview).toEqual(readyPreview);
  });

  it("transitions prepare -> blocked when prepare is blocked", async () => {
    const blockedPreview: PublishPreview = {
      status: "blocked",
      reason: "detached-head",
      message: "HEAD is detached",
    };
    mocks.prepareMutateAsync.mockResolvedValueOnce(blockedPreview);

    await act(async () => {
      root?.render(<Harness project="demo" />);
    });

    await act(async () => {
      await currentHook?.prepare();
    });

    expect(currentHook?.state).toBe("blocked");
    expect(currentHook?.preview).toEqual(blockedPreview);
  });

  it("publishes frozen lease and transitions confirming -> published", async () => {
    const readyPreview: PublishPreview = {
      status: "ready",
      snapshot: mockSnapshot,
      alreadyCurrent: false,
    };
    const publishedResult: PublishResult = {
      status: "published",
      branch: mockSnapshot.branch,
      remoteName: mockSnapshot.remoteName,
      destinationRef: mockSnapshot.destinationRef,
      sourceOid: mockSnapshot.sourceOid,
      expectedRemoteOid: mockSnapshot.expectedRemoteOid,
      actualRemoteOid: mockSnapshot.sourceOid,
      message: "Published successfully",
    };

    mocks.prepareMutateAsync.mockResolvedValueOnce(readyPreview);
    mocks.publishMutateAsync.mockResolvedValueOnce(publishedResult);

    await act(async () => {
      root?.render(<Harness project="demo" />);
    });

    await act(async () => {
      await currentHook?.prepare();
    });

    expect(currentHook?.state).toBe("confirming");

    await act(async () => {
      await currentHook?.publish();
    });

    expect(mocks.publishMutateAsync).toHaveBeenCalledWith(mockSnapshot);
    expect(currentHook?.state).toBe("published");
    expect(currentHook?.result).toEqual(publishedResult);
  });

  it("transitions publishing -> stale when remote moved", async () => {
    const readyPreview: PublishPreview = {
      status: "ready",
      snapshot: mockSnapshot,
      alreadyCurrent: false,
    };
    const staleResult: PublishResult = {
      status: "stale-remote",
      branch: mockSnapshot.branch,
      remoteName: mockSnapshot.remoteName,
      destinationRef: mockSnapshot.destinationRef,
      sourceOid: mockSnapshot.sourceOid,
      expectedRemoteOid: mockSnapshot.expectedRemoteOid,
      actualRemoteOid: "3333333333333333333333333333333333333333",
      message: "Remote ref has moved",
    };

    mocks.prepareMutateAsync.mockResolvedValueOnce(readyPreview);
    mocks.publishMutateAsync.mockResolvedValueOnce(staleResult);

    await act(async () => {
      root?.render(<Harness project="demo" />);
    });

    await act(async () => {
      await currentHook?.prepare();
    });

    await act(async () => {
      await currentHook?.publish();
    });

    expect(currentHook?.state).toBe("stale");
    expect(currentHook?.result).toEqual(staleResult);
  });

  it("resets to closed and invalidates in-flight actions when scope/target changes", async () => {
    const readyPreview: PublishPreview = {
      status: "ready",
      snapshot: mockSnapshot,
      alreadyCurrent: false,
    };
    mocks.prepareMutateAsync.mockResolvedValueOnce(readyPreview);

    await act(async () => {
      root?.render(<Harness project="demo" rootPath="." />);
    });

    await act(async () => {
      await currentHook?.prepare();
    });

    expect(currentHook?.state).toBe("confirming");

    // Change target project / root
    await act(async () => {
      root?.render(<Harness project="demo" rootPath="modules/child" />);
    });

    expect(currentHook?.state).toBe("closed");
    expect(currentHook?.preview).toBeNull();
    expect(currentHook?.result).toBeNull();
  });

  it("re-invokes publish with the identical frozen snapshot after SSH retry", async () => {
    const readyPreview: PublishPreview = {
      status: "ready",
      snapshot: mockSnapshot,
      alreadyCurrent: false,
    };
    const publishedResult: PublishResult = {
      status: "published",
      branch: mockSnapshot.branch,
      remoteName: mockSnapshot.remoteName,
      destinationRef: mockSnapshot.destinationRef,
      sourceOid: mockSnapshot.sourceOid,
      expectedRemoteOid: mockSnapshot.expectedRemoteOid,
      message: "Published after SSH key load",
    };

    mocks.prepareMutateAsync.mockResolvedValueOnce(readyPreview);

    // First attempt returns auth-required, retry callback succeeds
    let callCount = 0;
    mocks.executeLeasedWithRetry.mockImplementation(
      async (_owner: unknown, fn: () => Promise<unknown>) => {
        callCount++;
        if (callCount === 1) {
          // Prepare call
          return fn();
        }
        // Publish call: simulate executeLeasedWithRetry prompting and retrying fn()
        const firstAttempt = await fn();
        expect(firstAttempt).toEqual({ status: "auth-required" });
        // Retry invocation of the exact same fn() without refreshing snapshot
        mocks.publishMutateAsync.mockResolvedValueOnce(publishedResult);
        return fn();
      },
    );

    mocks.publishMutateAsync.mockResolvedValueOnce({ status: "auth-required" });

    await act(async () => {
      root?.render(<Harness project="demo" />);
    });

    await act(async () => {
      await currentHook?.prepare();
    });

    expect(currentHook?.state).toBe("confirming");

    await act(async () => {
      await currentHook?.publish();
    });

    // Both calls must have received the identical frozen snapshot (sourceOid and expectedRemoteOid unchanged)
    expect(mocks.publishMutateAsync).toHaveBeenCalledTimes(2);
    expect(mocks.publishMutateAsync).toHaveBeenNthCalledWith(1, mockSnapshot);
    expect(mocks.publishMutateAsync).toHaveBeenNthCalledWith(2, mockSnapshot);
    expect(currentHook?.state).toBe("published");
    expect(currentHook?.result).toEqual(publishedResult);
  });
  it("transitions publishing -> stale when local tip changed (stale-local)", async () => {
    const readyPreview: PublishPreview = {
      status: "ready",
      snapshot: mockSnapshot,
      alreadyCurrent: false,
    };
    const staleLocalResult: PublishResult = {
      status: "stale-local",
      branch: mockSnapshot.branch,
      remoteName: mockSnapshot.remoteName,
      destinationRef: mockSnapshot.destinationRef,
      sourceOid: mockSnapshot.sourceOid,
      expectedRemoteOid: mockSnapshot.expectedRemoteOid,
      message: "Local branch tip changed",
    };

    mocks.prepareMutateAsync.mockResolvedValueOnce(readyPreview);
    mocks.publishMutateAsync.mockResolvedValueOnce(staleLocalResult);

    await act(async () => {
      root?.render(<Harness project="demo" />);
    });

    await act(async () => {
      await currentHook?.prepare();
    });
    expect(currentHook?.state).toBe("confirming");

    await act(async () => {
      await currentHook?.publish();
    });

    expect(currentHook?.state).toBe("stale");
    expect(currentHook?.result).toEqual(staleLocalResult);
  });

  it("transitions publishing -> stale when config changed (stale-config)", async () => {
    const readyPreview: PublishPreview = {
      status: "ready",
      snapshot: mockSnapshot,
      alreadyCurrent: false,
    };
    const staleConfigResult: PublishResult = {
      status: "stale-config",
      branch: mockSnapshot.branch,
      remoteName: mockSnapshot.remoteName,
      destinationRef: mockSnapshot.destinationRef,
      sourceOid: mockSnapshot.sourceOid,
      expectedRemoteOid: mockSnapshot.expectedRemoteOid,
      message: "Remote URL changed",
    };

    mocks.prepareMutateAsync.mockResolvedValueOnce(readyPreview);
    mocks.publishMutateAsync.mockResolvedValueOnce(staleConfigResult);

    await act(async () => {
      root?.render(<Harness project="demo" />);
    });

    await act(async () => {
      await currentHook?.prepare();
    });
    expect(currentHook?.state).toBe("confirming");

    await act(async () => {
      await currentHook?.publish();
    });

    expect(currentHook?.state).toBe("stale");
    expect(currentHook?.result).toEqual(staleConfigResult);
  });

  it("transitions publishing -> rejected when remote server rejects with hook error", async () => {
    const readyPreview: PublishPreview = {
      status: "ready",
      snapshot: mockSnapshot,
      alreadyCurrent: false,
    };
    const rejectedResult: PublishResult = {
      status: "rejected",
      branch: mockSnapshot.branch,
      remoteName: mockSnapshot.remoteName,
      destinationRef: mockSnapshot.destinationRef,
      sourceOid: mockSnapshot.sourceOid,
      expectedRemoteOid: mockSnapshot.expectedRemoteOid,
      message: "Remote rejected: pre-receive hook declined",
    };

    mocks.prepareMutateAsync.mockResolvedValueOnce(readyPreview);
    mocks.publishMutateAsync.mockResolvedValueOnce(rejectedResult);

    await act(async () => {
      root?.render(<Harness project="demo" />);
    });

    await act(async () => {
      await currentHook?.prepare();
    });
    expect(currentHook?.state).toBe("confirming");

    await act(async () => {
      await currentHook?.publish();
    });

    expect(currentHook?.state).toBe("rejected");
    expect(currentHook?.result).toEqual(rejectedResult);
  });

  it("transitions publishing -> unknown on uncertain completion", async () => {
    const readyPreview: PublishPreview = {
      status: "ready",
      snapshot: mockSnapshot,
      alreadyCurrent: false,
    };
    const unknownResult: PublishResult = {
      status: "unknown",
      branch: mockSnapshot.branch,
      remoteName: mockSnapshot.remoteName,
      destinationRef: mockSnapshot.destinationRef,
      sourceOid: mockSnapshot.sourceOid,
      expectedRemoteOid: mockSnapshot.expectedRemoteOid,
      message: "Connection dropped after send",
    };

    mocks.prepareMutateAsync.mockResolvedValueOnce(readyPreview);
    mocks.publishMutateAsync.mockResolvedValueOnce(unknownResult);

    await act(async () => {
      root?.render(<Harness project="demo" />);
    });

    await act(async () => {
      await currentHook?.prepare();
    });
    expect(currentHook?.state).toBe("confirming");

    await act(async () => {
      await currentHook?.publish();
    });

    expect(currentHook?.state).toBe("unknown");
    expect(currentHook?.result).toEqual(unknownResult);
    await act(async () => {
      await currentHook?.publish();
    });
    expect(currentHook?.state).toBe("unknown");
    expect(mocks.publishMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("transitions publishing -> already-current when re-advertised remote was already at tip", async () => {
    const readyPreview: PublishPreview = {
      status: "ready",
      snapshot: mockSnapshot,
      alreadyCurrent: false,
    };
    const currentResult: PublishResult = {
      status: "already-current",
      branch: mockSnapshot.branch,
      remoteName: mockSnapshot.remoteName,
      destinationRef: mockSnapshot.destinationRef,
      sourceOid: mockSnapshot.sourceOid,
      expectedRemoteOid: mockSnapshot.expectedRemoteOid,
      message: "Branch is already up to date on remote",
    };

    mocks.prepareMutateAsync.mockResolvedValueOnce(readyPreview);
    mocks.publishMutateAsync.mockResolvedValueOnce(currentResult);

    await act(async () => {
      root?.render(<Harness project="demo" />);
    });

    await act(async () => {
      await currentHook?.prepare();
    });
    expect(currentHook?.state).toBe("confirming");

    await act(async () => {
      await currentHook?.publish();
    });

    expect(currentHook?.state).toBe("already-current");
    expect(currentHook?.result).toEqual(currentResult);
  });
  it("blocks a prepared source that differs from the successful squash receipt", async () => {
    mocks.prepareMutateAsync.mockResolvedValueOnce({
      status: "ready",
      snapshot: mockSnapshot,
      alreadyCurrent: false,
    });
    await act(async () =>
      root?.render(
        <Harness
          project="demo"
          expectedSource={{
            branch: mockSnapshot.branch,
            sourceOid: "f".repeat(40),
          }}
        />,
      ),
    );
    await act(async () => {
      await currentHook?.prepare();
    });
    expect(currentHook?.state).toBe("blocked");
    expect(currentHook?.error).toContain("Local history changed after squash");
    await act(async () => {
      await currentHook?.publish();
    });
    expect(mocks.publishMutateAsync).not.toHaveBeenCalled();
  });
  it("removes an actionable prepared preview synchronously on transport generation change", async () => {
    __setConnectionSnapshotForTests("lease-profile", {
      owner: { profileId: "lease-profile", generation: 1 },
      status: "connected",
    });
    mocks.prepareMutateAsync.mockResolvedValueOnce({
      status: "ready",
      snapshot: mockSnapshot,
      alreadyCurrent: false,
    });
    await act(async () =>
      root?.render(<Harness project="demo" profileId="lease-profile" />),
    );
    await act(async () => {
      await currentHook?.prepare();
    });
    expect(currentHook?.state).toBe("confirming");
    const oldPublish = currentHook!.publish;
    await act(async () =>
      __setConnectionSnapshotForTests("lease-profile", {
        owner: { profileId: "lease-profile", generation: 2 },
        status: "connected",
      }),
    );
    expect(currentHook?.state).toBe("closed");
    expect(currentHook?.preview).toBeNull();
    await act(async () => {
      await oldPublish();
    });
    expect(mocks.publishMutateAsync).not.toHaveBeenCalled();
  });

  it("forwards expectedSource branch to prepare mutation and publishes frozen inactive snapshot", async () => {
    const inactiveSnapshot: PublishSnapshot = {
      ...mockSnapshot,
      branch: "refs/heads/feature/inactive",
      destinationRef: "refs/heads/feature/inactive",
    };
    mocks.prepareMutateAsync.mockResolvedValueOnce({
      status: "ready",
      snapshot: inactiveSnapshot,
      alreadyCurrent: false,
    });
    mocks.publishMutateAsync.mockResolvedValueOnce({
      status: "published",
      branch: inactiveSnapshot.branch,
      remoteName: inactiveSnapshot.remoteName,
      destinationRef: inactiveSnapshot.destinationRef,
      sourceOid: inactiveSnapshot.sourceOid,
      expectedRemoteOid: inactiveSnapshot.expectedRemoteOid,
      message: "Published with lease",
    });

    await act(async () =>
      root?.render(
        <Harness
          project="demo"
          rootPath="subroot"
          expectedSource={{
            branch: "refs/heads/feature/inactive",
            sourceOid: inactiveSnapshot.sourceOid,
          }}
        />,
      ),
    );

    // Verify useGitPrepareLeasedPush received expectedSource.branch
    expect(mocks.prepareHookArgs).toHaveBeenLastCalledWith(
      expect.objectContaining({ project: "demo" }),
      "subroot",
      "refs/heads/feature/inactive",
    );

    await act(async () => {
      await currentHook?.prepare();
    });

    expect(currentHook?.state).toBe("confirming");
    expect(currentHook?.preview?.snapshot.branch).toBe("refs/heads/feature/inactive");

    await act(async () => {
      await currentHook?.publish();
    });

    expect(mocks.publishMutateAsync).toHaveBeenCalledWith(inactiveSnapshot);
    expect(currentHook?.state).toBe("published");
  });

  it("blocks preparation when preview snapshot branch mismatches receipt branch", async () => {
    mocks.prepareMutateAsync.mockResolvedValueOnce({
      status: "ready",
      snapshot: {
        ...mockSnapshot,
        branch: "refs/heads/main", // Mismatch with receipt branch
      },
      alreadyCurrent: false,
    });

    await act(async () =>
      root?.render(
        <Harness
          project="demo"
          expectedSource={{
            branch: "refs/heads/feature/inactive",
            sourceOid: mockSnapshot.sourceOid,
          }}
        />,
      ),
    );

    await act(async () => {
      await currentHook?.prepare();
    });

    expect(currentHook?.state).toBe("blocked");
    expect(currentHook?.error).toContain("Local history changed after squash");

    await act(async () => {
      await currentHook?.publish();
    });
    expect(mocks.publishMutateAsync).not.toHaveBeenCalled();
  });
});
