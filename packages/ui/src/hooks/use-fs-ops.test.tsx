// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startVideoDownload = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const queryClient = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));

vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => queryClient }));
vi.mock("@dam-hopper/shared/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/api/transport.js", () => ({ getTransport: vi.fn() }));
vi.mock("@/api/queries.js", () => ({ invalidateGitFileOperation: vi.fn() }));
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
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("useFsOps download", () => {
  it("routes recognized video to the direct ticket helper before fetch", async () => {
    startVideoDownload.mockResolvedValue(undefined);

    await latestOps().download("clips/demo.MP4", 3 * 1024 * 1024 * 1024);

    expect(startVideoDownload).toHaveBeenCalledWith("demo", "clips/demo.MP4");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects known oversized non-video files before fetch or Blob allocation", async () => {
    await expect(
      latestOps().download("archive.iso", 101 * 1024 * 1024),
    ).rejects.toThrow("too large");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
