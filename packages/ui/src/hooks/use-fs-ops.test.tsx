// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startVideoDownload = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const fsOpMock = vi.hoisted(() => vi.fn());
const getTransportMock = vi.hoisted(() => vi.fn(() => ({ fsOp: fsOpMock })));
const markTargetUnavailableMock = vi.hoisted(() => vi.fn());
const queryClient = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));

vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => queryClient }));
vi.mock("@dam-hopper/shared/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/api/transport.js", () => ({ getTransport: getTransportMock }));
vi.mock("@/api/queries.js", () => ({
  invalidateGitFileOperation: vi.fn(),
  markTargetUnavailableIfNeeded: markTargetUnavailableMock,
}));
vi.mock("@/api/server-config.js", () => ({
  getActiveProfile: () => null,
  getAuthToken: () => null,
  getServerUrl: () => "https://api.test",
}));
vi.mock("@/lib/start-video-download.js", () => ({ startVideoDownload }));

import { useFsOps } from "./use-fs-ops.js";

let root: Root | null = null;
let onReady = vi.fn();

function Harness({
  onReady,
}: {
  onReady: (value: ReturnType<typeof useFsOps>) => void;
}) {
  const resolvedOps = useFsOps("demo", "");
  React.useEffect(() => onReady(resolvedOps), [onReady, resolvedOps]);
  return null;
}

function latestOps(): ReturnType<typeof useFsOps> {
  return onReady.mock.lastCall?.[0] as ReturnType<typeof useFsOps>;
}

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(async () => {
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  onReady = vi.fn();
  await act(async () => root?.render(<Harness onReady={onReady} />));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  onReady = null;
  document.body.innerHTML = "";
  startVideoDownload.mockReset();
  fsOpMock.mockReset();
  getTransportMock.mockClear();
  markTargetUnavailableMock.mockReset();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("useFsOps download", () => {
  it("routes recognized video to the direct ticket helper before fetch", async () => {
    startVideoDownload.mockResolvedValue(undefined);

    await latestOps().download("clips/demo.MP4", 3 * 1024 * 1024 * 1024);

    expect(startVideoDownload).toHaveBeenCalledWith(
      { project: "demo" },
      "clips/demo.MP4",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects known oversized non-video files before fetch or Blob allocation", async () => {
    await expect(
      latestOps().download("archive.iso", 101 * 1024 * 1024),
    ).rejects.toThrow("too large");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a failed fs mutation result to target recovery", async () => {
    const result = {
      ok: false,
      error: "WORKSPACE_TARGET_UNAVAILABLE",
    };
    fsOpMock.mockResolvedValue(result);

    await expect(latestOps().createFile("src/demo.ts")).resolves.toEqual(
      result,
    );

    expect(markTargetUnavailableMock).toHaveBeenCalledWith(
      { project: "demo" },
      result,
    );
  });

  it("preserves target error codes from direct downloads", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      statusText: "Conflict",
      clone: () => ({
        json: async () => ({
          code: "WORKSPACE_TARGET_UNAVAILABLE",
          message: "Selected worktree is unavailable",
        }),
      }),
    });

    await expect(latestOps().download("src/demo.ts", 1)).rejects.toThrow(
      "Selected worktree is unavailable",
    );

    expect(markTargetUnavailableMock).toHaveBeenCalledWith(
      { project: "demo" },
      expect.objectContaining({
        code: "WORKSPACE_TARGET_UNAVAILABLE",
      }),
    );
  });
});
