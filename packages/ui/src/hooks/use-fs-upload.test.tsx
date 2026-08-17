// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fsUploadFile: vi.fn(),
  invalidateGitFileOperation: vi.fn(),
  markTargetUnavailableIfNeeded: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/api/transport.js", () => ({
  getTransport: () => ({ fsUploadFile: mocks.fsUploadFile }),
}));
vi.mock("@/api/queries.js", () => ({
  invalidateGitFileOperation: mocks.invalidateGitFileOperation,
  markTargetUnavailableIfNeeded: mocks.markTargetUnavailableIfNeeded,
}));

import { useFsUpload } from "./use-fs-upload.js";

const target = { project: "demo", worktreePath: "/tmp/demo-worktree" };

let root: Root | null = null;
let onReady = vi.fn();

function Harness({
  onReady,
}: {
  onReady: (value: ReturnType<typeof useFsUpload>) => void;
}) {
  const upload = useFsUpload(target, "src");
  React.useEffect(() => onReady(upload), [onReady, upload]);
  return null;
}

function latestUpload(): ReturnType<typeof useFsUpload> {
  return onReady.mock.lastCall?.[0] as ReturnType<typeof useFsUpload>;
}

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onReady = vi.fn();
  await act(async () => root?.render(<Harness onReady={onReady} />));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  mocks.fsUploadFile.mockReset();
  mocks.invalidateGitFileOperation.mockReset();
  mocks.markTargetUnavailableIfNeeded.mockReset();
});

describe("useFsUpload target recovery", () => {
  it("passes plain-string commit errors to shared target recovery", async () => {
    const error = "WORKSPACE_TARGET_UNAVAILABLE";
    mocks.fsUploadFile.mockResolvedValue({ ok: false, error });
    const file = {
      name: "demo.txt",
      stream: () => undefined,
    } as unknown as File;

    await act(async () => {
      await latestUpload().upload("src", file);
    });

    expect(mocks.fsUploadFile).toHaveBeenCalledWith(
      target,
      "src",
      file,
      expect.any(Function),
    );
    expect(mocks.markTargetUnavailableIfNeeded).toHaveBeenCalledWith(
      target,
      error,
    );
  });
});
