// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ApiClient,
  GitBlameInput,
  GitBlameResponse,
  ProjectTargetRef,
  VcsRoot,
} from "@/api/client.js";
import { ApiRequestError } from "@/api/client.js";
import type { Tab } from "@/stores/editor.js";
import {
  __setConnectionSnapshotForTests,
  resetConnections,
} from "@/api/connections.js";
import {
  type BlameEditorSeam,
  type UseEditorGitBlameResult,
  useEditorGitBlame,
} from "./use-editor-git-blame.js";
import { GIT_BLAME_MAX_BUFFER_BYTES } from "@/lib/editor-git-blame.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function createDeferred<T>() {
  let resolve!: (val: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createMockEditor(initialContent = "line 1\nline 2\n") {
  let content = initialContent;
  let version = 1;
  const contentListeners: Array<() => void> = [];
  const modelListeners: Array<() => void> = [];

  const model = {
    id: "model-1",
    uri: { toString: () => "inmemory://test/file.ts" },
    getVersionId: () => version,
    getValue: () => content,
    getLineCount: () => content.split("\n").length,
    onDidChangeContent: (cb: () => void) => {
      contentListeners.push(cb);
      return {
        dispose: () => {
          const idx = contentListeners.indexOf(cb);
          if (idx !== -1) contentListeners.splice(idx, 1);
        },
      };
    },
  };

  const editor: BlameEditorSeam = {
    getModel: () => model,
    onDidChangeModel: (cb: () => void) => {
      modelListeners.push(cb);
      return {
        dispose: () => {
          const idx = modelListeners.indexOf(cb);
          if (idx !== -1) modelListeners.splice(idx, 1);
        },
      };
    },
  };

  return {
    model,
    editor,
    setContent(newContent: string) {
      content = newContent;
      version++;
      contentListeners.forEach((cb) => cb());
    },
    triggerModelChange() {
      modelListeners.forEach((cb) => cb());
    },
  };
}

const sampleRoots: VcsRoot[] = [
  {
    rootId: ".",
    path: ".",
    absolutePath: "/repo",
    kind: "primary",
    warnings: [],
    status: {
      projectName: "my-project",
      branch: "main",
      isClean: true,
      ahead: 0,
      behind: 0,
      staged: 0,
      modified: 0,
      untracked: 0,
      hasStash: false,
      lastCommit: {
        hash: "head-commit-1111",
        message: "feat: initial",
        date: "2026-10-06",
      },
    },
  },
];

function createSampleBlameResponse(
  snapshotId: string,
  modelVersion = 1,
  lineCount = 3,
): GitBlameResponse {
  return {
    snapshotId,
    modelVersion,
    rootId: ".",
    rootRelativePath: "src/file.ts",
    baseCommitOid: "head-commit-1111",
    bufferLineCount: lineCount,
    status: "ready",
    commits: [
      {
        hash: "1111222233334444555566667777888899990000",
        authorName: "Alice",
        authorTimestamp: 1760000000,
        authorTimezoneOffsetMinutes: 0,
        subject: "initial work",
      },
    ],
    ranges: [{ startLine: 1, lineCount, commitIndex: 0 }],
  };
}

let root: Root | null = null;
let currentHook: UseEditorGitBlameResult | null = null;
let queryClient: QueryClient;
let blameMock: ReturnType<typeof vi.fn>;
let rootsMock: ReturnType<typeof vi.fn>;

function TestHarness({
  tab,
  editor,
  active = true,
}: {
  tab: Tab | null;
  editor: BlameEditorSeam | null;
  active?: boolean;
}) {
  const result = useEditorGitBlame({ tab, editor, active });
  currentHook = result;
  return null;
}

async function mount(
  tab: Tab | null,
  editor: BlameEditorSeam | null,
  active = true,
) {
  if (root) {
    act(() => {
      root?.unmount();
    });
    root = null;
    document.body.innerHTML = "";
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <TestHarness tab={tab} editor={editor} active={active} />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useEditorGitBlame", () => {
  const target: ProjectTargetRef = {
    profileId: "server-1",
    project: "my-project",
  };

  const defaultTab: Tab = {
    key: "my-project::src/file.ts",
    project: "my-project",
    target,
    targetKey: "my-project",
    targetAvailable: true,
    path: "src/file.ts",
    name: "file.ts",
    mtime: 100,
    size: 200,
    tier: "normal",
    content: "line 1\nline 2\n",
    savedContent: "line 1\nline 2\n",
    dirty: false,
    loading: false,
    saving: false,
    conflicted: false,
    blameEnabled: true,
    resourceBinding: { serverUrl: "http://localhost:4801" },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    currentHook = null;
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    blameMock = vi.fn().mockImplementation((_tgt, input: GitBlameInput) => {
      return Promise.resolve(
        createSampleBlameResponse(input.snapshotId, input.modelVersion, 3),
      );
    });

    rootsMock = vi.fn().mockResolvedValue(sampleRoots);

    const mockApi = {
      git: {
        blame: blameMock,
        roots: rootsMock,
      },
    } as unknown as ApiClient;

    __setConnectionSnapshotForTests("server-1", {
      owner: { profileId: "server-1", generation: 1 },
      status: "connected",
      serverUrl: "http://localhost:4801",
      api: mockApi,
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
    resetConnections();
  });

  it("remains off when blameEnabled is false or tab is diff tier", async () => {
    const disabledTab = { ...defaultTab, blameEnabled: false };
    const mock = createMockEditor();

    await mount(disabledTab, mock.editor, true);
    expect(currentHook?.status).toBe("off");
    expect(currentHook?.data).toBeNull();
    expect(blameMock).not.toHaveBeenCalled();

    const diffTab = { ...defaultTab, tier: "diff" as const, blameEnabled: true };
    await mount(diffTab, mock.editor, true);
    expect(currentHook?.status).toBe("off");
    expect(blameMock).not.toHaveBeenCalled();
  });

  it("remains unavailable when connection snapshot is disconnected", async () => {
    __setConnectionSnapshotForTests("server-1", {
      owner: { profileId: "server-1", generation: 1 },
      status: "disconnected",
      serverUrl: "http://localhost:4801",
      api: null,
    });
    const mock = createMockEditor();

    await mount(defaultTab, mock.editor, true);
    expect(currentHook?.status).toBe("unavailable");
    expect(blameMock).not.toHaveBeenCalled();
  });

  it("runs happy path: waiting -> loading -> ready with valid partition", async () => {
    const deferred = createDeferred<GitBlameResponse>();
    blameMock.mockReturnValueOnce(deferred.promise);

    const mock = createMockEditor("line 1\nline 2\n");
    await mount(defaultTab, mock.editor, true);

    expect(currentHook?.status).toBe("loading");

    const callInput = blameMock.mock.calls[0][1] as GitBlameInput;
    await act(async () => {
      deferred.resolve(
        createSampleBlameResponse(callInput.snapshotId, 1, 3),
      );
      await Promise.resolve();
    });

    expect(currentHook?.status).toBe("ready");
    expect(currentHook?.data?.commits[0]?.authorName).toBe("Alice");
    expect(blameMock).toHaveBeenCalledTimes(1);
  });

  it("synchronously clears attribution on edit, debounces 250ms, and coalesces rapid edits", async () => {
    const mock = createMockEditor("line 1\nline 2\n");
    await mount(defaultTab, mock.editor, true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(currentHook?.status).toBe("ready");

    // Edit 1: clears ready state synchronously
    act(() => {
      mock.setContent("line 1 edited\nline 2\n");
    });
    expect(currentHook?.status).toBe("waiting");
    expect(currentHook?.data).toBeNull();

    // Advance 100ms (less than 250ms debounce)
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(blameMock).toHaveBeenCalledTimes(1); // not yet called for edit

    // Edit 2: resets debounce
    act(() => {
      mock.setContent("line 1 edited again\nline 2\n");
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(blameMock).toHaveBeenCalledTimes(1);

    // Complete the remaining 50ms (total 250ms after Edit 2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(blameMock).toHaveBeenCalledTimes(2);
    expect(currentHook?.status).toBe("ready");
  });

  it("discards late response from superseded model version (race condition)", async () => {
    const deferredV1 = createDeferred<GitBlameResponse>();
    const deferredV2 = createDeferred<GitBlameResponse>();

    blameMock
      .mockReturnValueOnce(deferredV1.promise)
      .mockReturnValueOnce(deferredV2.promise);

    const mock = createMockEditor("v1 content\n");
    await mount(defaultTab, mock.editor, true);

    // In flight for v1
    expect(currentHook?.status).toBe("loading");

    // User edits to v2 while v1 is still in flight
    act(() => {
      mock.setContent("v2 content\n");
    });
    expect(currentHook?.status).toBe("waiting");

    // Resolve v1 (late arrival)
    await act(async () => {
      deferredV1.resolve(createSampleBlameResponse("v1-snap", 1, 2));
      await Promise.resolve();
    });

    // v1 must NOT have been accepted because model version has moved to 2
    expect(currentHook?.status).not.toBe("ready");

    // Advance debounce for v2
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    // Now resolve v2 with its actual snapshotId
    const callInputV2 = blameMock.mock.calls[1][1] as GitBlameInput;
    await act(async () => {
      deferredV2.resolve(
        createSampleBlameResponse(callInputV2.snapshotId, 2, 2),
      );
      await Promise.resolve();
    });

    expect(currentHook?.status).toBe("ready");
    expect(currentHook?.data?.modelVersion).toBe(2);
  });

  it("discards in-flight response when tab changes (A -> B switch)", async () => {
    const deferredA = createDeferred<GitBlameResponse>();
    blameMock.mockReturnValueOnce(deferredA.promise);

    const mock = createMockEditor("tab A content\n");
    await mount(defaultTab, mock.editor, true);

    expect(currentHook?.status).toBe("loading");

    // Switch to Tab B
    const tabB: Tab = {
      ...defaultTab,
      key: "my-project::src/other.ts",
      path: "src/other.ts",
      name: "other.ts",
    };

    const mockB = createMockEditor("tab B content\n");
    await mount(tabB, mockB.editor, true);

    // Resolve deferred A
    await act(async () => {
      deferredA.resolve(createSampleBlameResponse("snap-A", 1, 2));
      await Promise.resolve();
    });

    // Tab B should not have Tab A's data
    expect(currentHook?.data?.rootRelativePath).not.toBe("src/file.ts");
  });

  it("discards response on reconnect generation mismatch", async () => {
    const deferred = createDeferred<GitBlameResponse>();
    blameMock.mockReturnValueOnce(deferred.promise);

    const mock = createMockEditor("content\n");
    await mount(defaultTab, mock.editor, true);
    expect(currentHook?.status).toBe("loading");

    // Reconnect bumps generation to 2
    __setConnectionSnapshotForTests("server-1", {
      owner: { profileId: "server-1", generation: 2 },
      status: "connected",
      serverUrl: "http://localhost:4801",
      api: { git: { blame: blameMock, roots: rootsMock } } as unknown as ApiClient,
    });

    await act(async () => {
      deferred.resolve(createSampleBlameResponse("snap-1", 1, 2));
      await Promise.resolve();
    });

    // Gen 1 response discarded
    expect(currentHook?.status).not.toBe("ready");
  });

  it("fails closed when buffer size exceeds 5 MiB without making network calls", async () => {
    const hugeContent = "x".repeat(GIT_BLAME_MAX_BUFFER_BYTES + 10);
    const mock = createMockEditor(hugeContent);

    await mount(defaultTab, mock.editor, true);
    expect(currentHook?.status).toBe("unavailable");
    expect(currentHook?.errorCode).toBe("GIT_BLAME_TOO_LARGE");
    expect(blameMock).not.toHaveBeenCalled();
  });

  it("handles 503 GIT_BLAME_BUSY gracefully", async () => {
    blameMock.mockRejectedValueOnce(
      new ApiRequestError("Workers busy", 503, "GIT_BLAME_BUSY"),
    );

    const mock = createMockEditor("content\n");
    await mount(defaultTab, mock.editor, true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(currentHook?.status).toBe("unavailable");
    expect(currentHook?.isBusy).toBe(true);
    expect(currentHook?.errorCode).toBe("GIT_BLAME_BUSY");
  });

  it("handles 409 GIT_BLAME_STALE_REVISION gracefully", async () => {
    blameMock.mockRejectedValueOnce(
      new ApiRequestError("Revision changed", 409, "GIT_BLAME_STALE_REVISION"),
    );

    const mock = createMockEditor("content\n");
    await mount(defaultTab, mock.editor, true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(currentHook?.status).toBe("waiting");
    expect(currentHook?.errorCode).toBe("GIT_BLAME_STALE_REVISION");
  });

  it("handles malformed response with GIT_BLAME_INVALID_RESPONSE error", async () => {
    blameMock.mockResolvedValueOnce({
      ...createSampleBlameResponse("snap-1", 1, 5),
      ranges: [{ startLine: 1, lineCount: 2, commitIndex: 0 }], // only covers lines 1..2, not 5
    });

    const mock = createMockEditor("line 1\nline 2\nline 3\nline 4\n");
    await mount(defaultTab, mock.editor, true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(currentHook?.status).toBe("error");
    expect(currentHook?.errorCode).toBe("GIT_BLAME_INVALID_RESPONSE");
  });

  it("triggers repository refresh on window focus and manual refresh without periodic polling", async () => {
    const mock = createMockEditor("content\n");
    await mount(defaultTab, mock.editor, true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(blameMock).toHaveBeenCalledTimes(1);

    // Idle focused interval for 60 seconds produces ZERO requests (no polling!)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(blameMock).toHaveBeenCalledTimes(1);

    // Manual refresh triggers refresh
    act(() => {
      currentHook?.refresh();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(rootsMock).toHaveBeenCalled();
    expect(blameMock).toHaveBeenCalledTimes(2);

    // Window focus triggers refresh
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(blameMock).toHaveBeenCalledTimes(3);
  });
});
