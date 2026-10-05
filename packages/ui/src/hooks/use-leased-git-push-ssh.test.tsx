// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setConnectionSnapshotForTests } from "@/api/connections.js";
import { deferred } from "@/test-fixtures/git-squash.js";
import type {
  PublishPreview,
  PublishResult,
  SshLoadKeyResult,
} from "@/api/client.js";
import {
  useLeasedGitPush,
  type UseLeasedGitPushResult,
} from "./use-leased-git-push.js";

const owner = { profileId: "ssh-lease-profile", generation: 1 };
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  publish: vi.fn(),
  addKey: vi.fn(),
  prepareArgs: vi.fn(),
}));
vi.mock("@/api/queries.js", () => ({
  resolveTargetOwner: () => ({ profileId: "ssh-lease-profile", generation: 1 }),
  useGitPrepareLeasedPush: (...args: unknown[]) => {
    mocks.prepareArgs(...args);
    return { mutateAsync: mocks.prepare };
  },
  useGitPublishLeasedPush: () => ({ mutateAsync: mocks.publish }),
  useSshAddKey: () => ({ mutateAsync: mocks.addKey }),
  useSshListKeys: () => ({ data: [] }),
}));
const preview: PublishPreview = {
  status: "ready",
  alreadyCurrent: false,
  snapshot: {
    branch: "refs/heads/main",
    sourceOid: "a".repeat(40),
    remoteName: "origin",
    destinationRef: "refs/heads/main",
    expectedRemoteOid: "b".repeat(40),
    remoteIdentity: "c".repeat(64),
    repositoryIdentity: "d".repeat(64),
  },
};
let root: Root;
let container: HTMLDivElement;
let hook: UseLeasedGitPushResult;
function Harness({
  scope = "first",
  expectedSource,
  rootPath = ".",
}: {
  scope?: string;
  expectedSource?: { branch: string; sourceOid: string };
  rootPath?: string;
}) {
  hook = useLeasedGitPush(
    { profileId: owner.profileId, project: "demo" },
    rootPath,
    { scopeFence: scope, expectedSource },
  );
  return null;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  __setConnectionSnapshotForTests(owner.profileId, {
    owner,
    status: "connected",
  });
  mocks.prepare.mockResolvedValue(preview);
  mocks.addKey.mockResolvedValue({ success: true, saved: false });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  __setConnectionSnapshotForTests(owner.profileId, null);
});

describe("leased publication with the real SSH retry controller", () => {
  it("does not open delayed authentication after preparation is closed", async () => {
    const response = deferred<PublishPreview>();
    mocks.prepare.mockReturnValueOnce(response.promise);
    let operation!: Promise<void>;
    await act(async () => {
      operation = hook.prepare();
    });
    await act(async () => hook.close());
    await act(async () => {
      response.resolve({
        status: "blocked",
        reason: "auth-required",
        message: "authentication required",
      });
    });
    expect(hook.passphraseDialogProps.open).toBe(false);
    await act(async () => {
      await operation;
    });
    expect(hook.state).toBe("closed");
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });
  it.each(["scope reset", "away and back", "close", "unmount"])(
    "revokes a pending SSH retry on %s without a second publication",
    async (change) => {
      await act(async () => {
        await hook.prepare();
      });
      mocks.publish.mockResolvedValueOnce({
        ...preview.snapshot,
        status: "auth-required",
        message: "authentication required",
      } satisfies PublishResult);
      let operation!: Promise<void>;
      await act(async () => {
        operation = hook.publish();
      });
      expect(hook.passphraseDialogProps.open).toBe(true);
      const oldSubmit = hook.passphraseDialogProps.onSubmit;
      const key = deferred<SshLoadKeyResult>();
      mocks.addKey.mockReturnValueOnce(key.promise);
      let authentication!: Promise<void>;
      await act(async () => {
        authentication = oldSubmit("secret", undefined, false);
      });
      if (change === "close") await act(async () => hook.close());
      else if (change === "unmount") await act(async () => root.unmount());
      else {
        await act(async () => root.render(<Harness scope="second" />));
        if (change === "away and back")
          await act(async () => root.render(<Harness scope="first" />));
      }
      if (change !== "unmount") {
        expect(hook.passphraseDialogProps.open).toBe(false);
        expect(hook.state).toBe("closed");
      }
      await act(async () => {
        key.resolve({ success: true, saved: false });
        await authentication;
        await operation;
      });
      expect(mocks.publish).toHaveBeenCalledTimes(1);
      if (change !== "unmount") {
        expect(hook.state).toBe("closed");
        expect(hook.preview).toBeNull();
        expect(hook.result).toBeNull();
      }
    },
  );

  it("retains inactive ref on prepare credential retry and publishes confirmed snapshot on publish retry", async () => {
    const inactiveSource = {
      branch: "refs/heads/feature/inactive",
      sourceOid: "a".repeat(40),
    };
    const inactivePreview: PublishPreview = {
      status: "ready",
      alreadyCurrent: false,
      snapshot: {
        ...preview.snapshot,
        branch: inactiveSource.branch,
        destinationRef: inactiveSource.branch,
      },
    };

    await act(async () =>
      root.render(<Harness expectedSource={inactiveSource} rootPath="sub" />),
    );

    // 1. Prepare returns auth-required
    mocks.prepare.mockResolvedValueOnce({
      status: "blocked",
      reason: "auth-required",
      message: "authentication required",
    } as unknown as PublishPreview);
    mocks.prepare.mockResolvedValueOnce(inactivePreview);

    let prepareOp!: Promise<void>;
    await act(async () => {
      prepareOp = hook.prepare();
    });

    // Dialog opens
    expect(hook.passphraseDialogProps.open).toBe(true);

    // Verify prepare was called with inactive branch
    expect(mocks.prepareArgs).toHaveBeenCalledWith(
      expect.objectContaining({ project: "demo" }),
      "sub",
      "refs/heads/feature/inactive",
    );

    // Submit passphrase for prepare retry
    await act(async () => {
      await hook.passphraseDialogProps.onSubmit("secret", undefined, false);
      await prepareOp;
    });

    expect(hook.state).toBe("confirming");
    expect(hook.preview?.snapshot.branch).toBe("refs/heads/feature/inactive");

    // 2. Publish returns auth-required, retries with confirmed snapshot
    mocks.publish.mockResolvedValueOnce({
      ...inactivePreview.snapshot,
      status: "auth-required",
      message: "publish auth required",
    } satisfies PublishResult);
    mocks.publish.mockResolvedValueOnce({
      ...inactivePreview.snapshot,
      status: "published",
      message: "published",
    } satisfies PublishResult);

    let publishOp!: Promise<void>;
    await act(async () => {
      publishOp = hook.publish();
    });

    expect(hook.passphraseDialogProps.open).toBe(true);

    await act(async () => {
      await hook.passphraseDialogProps.onSubmit("secret", undefined, false);
      await publishOp;
    });

    expect(hook.state).toBe("published");
    expect(mocks.publish).toHaveBeenLastCalledWith(inactivePreview.snapshot);
  });
});
