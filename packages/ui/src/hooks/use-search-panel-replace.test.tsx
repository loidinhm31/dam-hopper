// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fsRead: vi.fn(),
  fsWriteFile: vi.fn(),
  markTargetUnavailableIfNeeded: vi.fn(),
}));

vi.mock("@/api/transport.js", () => ({
  getTransport: () => ({
    fsRead: mocks.fsRead,
    fsWriteFile: mocks.fsWriteFile,
  }),
}));
vi.mock("@/api/queries.js", () => ({
  markTargetUnavailableIfNeeded: mocks.markTargetUnavailableIfNeeded,
}));

import { useSearchPanelReplace } from "./use-search-panel-replace.js";

const target = { project: "demo", worktreePath: "/tmp/demo-worktree" };
const matches = [
  {
    path: "src/demo.ts",
    line: 1,
    col: 1,
    text: "needle demo",
  },
];

let root: Root | null = null;
let onReady = vi.fn();

function Harness({
  onReady,
}: {
  onReady: (value: ReturnType<typeof useSearchPanelReplace>) => void;
}) {
  const replace = useSearchPanelReplace({
    target,
    scope: "project",
    matches,
    searchQuery: "needle",
    replaceQuery: "token",
    caseSensitive: true,
    refreshMatches: vi.fn(async () => []),
    openMatch: vi.fn(),
  });
  React.useEffect(() => onReady(replace), [onReady, replace]);
  return null;
}

function latestReplace(): ReturnType<typeof useSearchPanelReplace> {
  return onReady.mock.lastCall?.[0] as ReturnType<typeof useSearchPanelReplace>;
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
  mocks.fsRead.mockReset();
  mocks.fsWriteFile.mockReset();
  mocks.markTargetUnavailableIfNeeded.mockReset();
});

describe("useSearchPanelReplace target recovery", () => {
  it("handles a non-throwing target error from fsRead", async () => {
    const result = { ok: false, code: "WORKSPACE_TARGET_UNAVAILABLE" };
    mocks.fsRead.mockResolvedValue(result);

    await act(async () => {
      await latestReplace().replaceNext();
    });

    expect(mocks.fsRead).toHaveBeenCalledWith(target, "src/demo.ts");
    expect(mocks.markTargetUnavailableIfNeeded).toHaveBeenCalledWith(
      target,
      result,
    );
    expect(mocks.markTargetUnavailableIfNeeded).toHaveBeenCalledTimes(1);
  });

  it("handles a non-throwing target error from fsWriteFile", async () => {
    const readResult = {
      ok: true as const,
      binary: false,
      content: btoa("needle demo\n"),
      mtime: 10,
      size: 12,
    };
    const writeResult = {
      ok: false as const,
      conflict: false as const,
      error: "WORKSPACE_TARGET_UNAVAILABLE",
    };
    mocks.fsRead.mockResolvedValue(readResult);
    mocks.fsWriteFile.mockResolvedValue(writeResult);

    await act(async () => {
      await latestReplace().replaceNext();
    });

    expect(mocks.fsRead).toHaveBeenCalledWith(target, "src/demo.ts");
    expect(mocks.fsWriteFile).toHaveBeenCalledWith(
      target,
      "src/demo.ts",
      "token demo\n",
      10,
    );
    expect(mocks.markTargetUnavailableIfNeeded).toHaveBeenCalledWith(
      target,
      writeResult,
    );
    expect(mocks.markTargetUnavailableIfNeeded).toHaveBeenCalledTimes(1);
  });
});
