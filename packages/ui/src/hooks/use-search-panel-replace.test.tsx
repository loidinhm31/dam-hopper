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

const mockSnap = vi.hoisted(() => ({
  owner: { profileId: "remote-1", generation: 2 },
  status: "connected",
}));

vi.mock("@/api/connections.js", () => ({
  captureConnection: (profileId: string) => ({
    profileId,
    generation: mockSnap.owner.generation,
  }),
  isCurrentConnection: (conn: { generation: number }) =>
    conn.generation === mockSnap.owner.generation,
  getConnectionSnapshot: (profileId: string) => ({
    owner: { profileId, generation: mockSnap.owner.generation },
    status: mockSnap.status,
  }),
  getTransport: () => ({
    fsRead: mocks.fsRead,
    fsWriteFile: mocks.fsWriteFile,
  }),
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
import type { SearchMatch } from "@/api/fs-types.js";
import { useEditorStore } from "@/stores/editor.js";
import {
  useSearchPanelReplace,
  type UseSearchPanelReplaceResult,
} from "./use-search-panel-replace.js";
import type { ProjectTargetInput } from "@/api/client.js";
const target: ProjectTargetInput = { project: "demo", worktreePath: "/tmp/demo-worktree" };
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
  testMatches,
  testTarget,
}: {
  onReady: (value: UseSearchPanelReplaceResult) => void;
  testMatches?: SearchMatch[];
  testTarget?: ProjectTargetInput;
}) {
  const replace = useSearchPanelReplace({
    target: testTarget ?? target,
    scope: "project",
    matches: testMatches ?? matches,
    searchQuery: "needle",
    replaceQuery: "token",
    caseSensitive: true,
    refreshMatches: vi.fn(async () => []),
    openMatch: vi.fn(),
  });
  React.useEffect(() => onReady(replace), [onReady, replace]);
  return null;
}

function latestReplace(): UseSearchPanelReplaceResult {
  return onReady.mock.lastCall?.[0] as UseSearchPanelReplaceResult;
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

  describe("replaceAll generation validation", () => {
    it("rejects replaceAll when matches have stale generation", async () => {
      const staleMatches: SearchMatch[] = [
        {
          path: "src/remote.ts",
          line: 1,
          col: 1,
          text: "needle remote",
          profileId: "remote-1",
          project: "demo",
          generation: 1, // Stale! Current is 2
        },
      ];

      await act(async () =>
        root?.render(
          <Harness
            onReady={onReady}
            testMatches={staleMatches}
            testTarget={{ profileId: "remote-1", project: "demo" }}
          />,
        ),
      );

      await act(async () => {
        await latestReplace().replaceAll();
      });

      expect(mocks.fsRead).not.toHaveBeenCalled();
      expect(mocks.fsWriteFile).not.toHaveBeenCalled();
    });

    it("rejects replaceAll when a file group has mixed generations", async () => {
      const mixedMatches: SearchMatch[] = [
        {
          path: "src/remote.ts",
          line: 1,
          col: 1,
          text: "needle 1",
          profileId: "remote-1",
          project: "demo",
          generation: 2,
        },
        {
          path: "src/remote.ts",
          line: 2,
          col: 1,
          text: "needle 2",
          profileId: "remote-1",
          project: "demo",
          generation: 1, // Mixed!
        },
      ];

      await act(async () =>
        root?.render(
          <Harness
            onReady={onReady}
            testMatches={mixedMatches}
            testTarget={{ profileId: "remote-1", project: "demo" }}
          />,
        ),
      );

      await act(async () => {
        await latestReplace().replaceAll();
      });

      expect(mocks.fsRead).not.toHaveBeenCalled();
      expect(mocks.fsWriteFile).not.toHaveBeenCalled();
    });

    it("executes replaceAll when all matches match current connection generation", async () => {
      const validMatches: SearchMatch[] = [
        {
          path: "src/remote.ts",
          line: 1,
          col: 1,
          text: "needle 1",
          profileId: "remote-1",
          project: "demo",
          generation: 2,
        },
      ];

      mocks.fsRead.mockResolvedValue({
        ok: true,
        binary: false,
        content: btoa("needle 1\n"),
        mtime: 42,
      });
      mocks.fsWriteFile.mockResolvedValue({ ok: true });

      await act(async () =>
        root?.render(
          <Harness
            onReady={onReady}
            testMatches={validMatches}
            testTarget={{ profileId: "remote-1", project: "demo" }}
          />,
        ),
      );

      await act(async () => {
        await latestReplace().replaceAll();
      });

      expect(mocks.fsRead).toHaveBeenCalled();
      expect(mocks.fsWriteFile).toHaveBeenCalled();
    });

    it("aborts write when an open tab is dirtied while fsRead is in flight", async () => {
      const readGate = Promise.withResolvers<{
        ok: boolean;
        binary: boolean;
        content: string;
        mtime: number;
      }>();
      mocks.fsRead.mockReturnValue(readGate.promise);

      const validMatches: SearchMatch[] = [
        {
          path: "src/remote.ts",
          line: 1,
          col: 1,
          text: "needle 1",
          profileId: "remote-1",
          project: "demo",
          generation: 2,
        },
      ];

      await act(async () =>
        root?.render(
          <Harness
            onReady={onReady}
            testMatches={validMatches}
            testTarget={{ profileId: "remote-1", project: "demo" }}
          />,
        ),
      );

      let replaceSettled = false;
      const replacePromise = latestReplace()
        .replaceAll()
        .then(() => {
          replaceSettled = true;
        });

      // Mark tab dirty while read is in flight:
      useEditorStore.setState({
        tabs: [
          {
            key: "tab-1",
            project: "demo",
            path: "src/remote.ts",
            dirty: true,
            target: { profileId: "remote-1", project: "demo" },
            tier: "file",
            file: {
              id: "src/remote.ts",
              name: "remote.ts",
              kind: "file",
              size: 10,
              mtime: 10,
              isSymlink: false,
              children: null,
            },
          } as unknown as (typeof useEditorStore extends { getState: () => { tabs: (infer T)[] } } ? T : never),
        ],
      });

      // Resolve fsRead:
      readGate.resolve({
        ok: true,
        binary: false,
        content: btoa("needle 1\n"),
        mtime: 42,
      });

      await act(async () => {
        await replacePromise;
      });

      expect(replaceSettled).toBe(true);
      expect(mocks.fsRead).toHaveBeenCalled();
      expect(mocks.fsWriteFile).not.toHaveBeenCalled();

      // Reset tabs
      useEditorStore.setState({ tabs: [] });
    });
  });
});
