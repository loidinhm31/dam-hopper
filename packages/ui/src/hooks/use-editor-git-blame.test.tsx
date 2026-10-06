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
import { gitQueryKey } from "@/api/queries.js";
import {
  type BlameEditorSeam,
  type UseEditorGitBlameResult,
  useEditorGitBlame,
} from "./use-editor-git-blame.js";
import {
  computeMonacoLineCount,
  GIT_BLAME_MAX_BUFFER_BYTES,
} from "@/lib/editor-git-blame.js";

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
  path = "src/file.ts",
): GitBlameResponse {
  return {
    snapshotId,
    modelVersion,
    rootId: ".",
    rootRelativePath: path,
    baseCommitOid: "head-commit-1111",
    bufferLineCount: lineCount,
    status: "ready",
    commits: [
      {
        hash: "1111222233334444555566667777888899990000",
        authorName: "Alice",
        authorEmail: "alice@example.com",
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
  if (!root) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
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
      const lineCount = computeMonacoLineCount(input.content);
      return Promise.resolve(
        createSampleBlameResponse(
          input.snapshotId,
          input.modelVersion,
          lineCount,
          input.path,
        ),
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

    const diffTab = {
      ...defaultTab,
      tier: "diff" as const,
      blameEnabled: true,
    };
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
      deferred.resolve(createSampleBlameResponse(callInput.snapshotId, 1, 3));
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
    const inputA = blameMock.mock.calls[0][1] as GitBlameInput;

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
      deferredA.resolve(createSampleBlameResponse(inputA.snapshotId, 1, 2));
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
    });

    // Tab B should not have Tab A's data
    expect(currentHook?.status).toBe("ready");
    expect(currentHook?.data?.rootRelativePath).toBe("src/other.ts");
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
      api: {
        git: { blame: blameMock, roots: rootsMock },
      } as unknown as ApiClient,
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

    // Window focus triggers refresh to inspect roots; coalesces without reblaming when HEAD is identical
    rootsMock.mockClear();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(rootsMock).toHaveBeenCalled();
    expect(blameMock).toHaveBeenCalledTimes(2);

    // Window focus reblames if roots report an updated HEAD commit
    rootsMock.mockResolvedValueOnce([
      {
        ...sampleRoots[0],
        status: {
          ...sampleRoots[0].status,
          lastCommit: {
            hash: "head-commit-2222",
            author: "Bob",
            message: "feat: second commit",
            date: "2026-10-06",
          },
        },
      },
    ]);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(blameMock).toHaveBeenCalledTimes(3);
  });

  it("keeps status off when roots fetch rejects after feature was toggled off (parent repro)", async () => {
    const deferredRoots = createDeferred<VcsRoot[]>();
    rootsMock.mockReturnValueOnce(deferredRoots.promise);

    const mock = createMockEditor("line 1\nline 2\n");
    await mount(defaultTab, mock.editor, true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(currentHook?.status).toBe("ready");

    // Trigger repository refresh
    act(() => {
      currentHook?.refresh();
    });

    // Advance 50ms so triggerRepositoryRefresh initiates roots fetch (now pending deferredRoots)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // User disables blame (status -> "off")
    const disabledTab = { ...defaultTab, blameEnabled: false };
    await mount(disabledTab, mock.editor, true);
    expect(currentHook?.status).toBe("off");

    // Old in-flight roots fetch rejects
    await act(async () => {
      deferredRoots.reject(new Error("Network failed discovering roots"));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(50);
    });

    // Status MUST remain "off", NOT flip to "unavailable" or "error"!
    expect(currentHook?.status).toBe("off");
    expect(currentHook?.data).toBeNull();
  });

  it("clears attribution synchronously on tab switch (finding 1)", async () => {
    const mockA = createMockEditor("tab A content\n");
    await mount(defaultTab, mockA.editor, true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(currentHook?.status).toBe("ready");
    expect(currentHook?.data).not.toBeNull();

    // Deferred blame for Tab B
    const deferredB = createDeferred<GitBlameResponse>();
    blameMock.mockReturnValueOnce(deferredB.promise);

    const tabB: Tab = {
      ...defaultTab,
      key: "my-project::src/tab-b.ts",
      path: "src/tab-b.ts",
      name: "tab-b.ts",
    };
    const mockB = createMockEditor("tab B content\n");

    // Switch to Tab B
    await mount(tabB, mockB.editor, true);

    // Synchronously, Tab B must NOT have Tab A's data!
    expect(currentHook?.data).toBeNull();
    expect(currentHook?.status).toBe("loading");
    const inputB = blameMock.mock.calls[1][1] as GitBlameInput;

    // Resolve deferred Tab B
    await act(async () => {
      deferredB.resolve(
        createSampleBlameResponse(inputB.snapshotId, 1, 2, inputB.path),
      );
      await Promise.resolve();
    });

    expect(currentHook?.status).toBe("ready");
    expect(currentHook?.data?.rootRelativePath).toBe("src/tab-b.ts");
  });

  it("reblames on same-HEAD git-diff invalidation (staged rename baseline change)", async () => {
    const mock = createMockEditor("content\n");
    await mount(defaultTab, mock.editor, true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(blameMock).toHaveBeenCalledTimes(1);
    expect(currentHook?.status).toBe("ready");

    // Invalidate git-diff via QueryCache (same HEAD, but index changed due to staged rename)
    const diffQueryKey = gitQueryKey("git-diff", target);
    await act(async () => {
      queryClient.setQueryData(diffQueryKey, { entries: [] });
      await queryClient.invalidateQueries({ queryKey: diffQueryKey });
      await vi.advanceTimersByTimeAsync(100);
    });

    // Must re-run blame to recompute baseline against the staged rename!
    expect(blameMock).toHaveBeenCalledTimes(2);
  });

  it("ignores cross-profile invalidation with identical project name", async () => {
    const mock = createMockEditor("content\n");
    await mount(defaultTab, mock.editor, true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(blameMock).toHaveBeenCalledTimes(1);

    // Invalidate git-diff on server-2 for same project name
    const otherProfileKey = [
      "profile",
      "server-2",
      1,
      "git",
      "git-diff",
      "my-project",
      "root",
    ];

    await act(async () => {
      queryClient.setQueryData(otherProfileKey, { entries: [] });
      await queryClient.invalidateQueries({ queryKey: otherProfileKey });
      await vi.advanceTimersByTimeAsync(100);
    });

    // Server-1 blame must NOT have been re-triggered!
    expect(blameMock).toHaveBeenCalledTimes(1);
  });

  it("coalesces window focus with active in-flight request without aborting", async () => {
    const deferred = createDeferred<GitBlameResponse>();
    blameMock.mockReturnValueOnce(deferred.promise);

    const mock = createMockEditor("content\n");
    await mount(defaultTab, mock.editor, true);

    expect(currentHook?.status).toBe("loading");
    expect(blameMock).toHaveBeenCalledTimes(1);

    // Window focuses while initial request is in-flight
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    // Advance 50ms so focus repository refresh fires
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // The initial request must NOT have been aborted or duplicated!
    expect(blameMock).toHaveBeenCalledTimes(1);
    const input = blameMock.mock.calls[0][1] as GitBlameInput;

    // Resolve deferred initial request
    await act(async () => {
      deferred.resolve(createSampleBlameResponse(input.snapshotId, 1, 2));
      await Promise.resolve();
    });

    expect(currentHook?.status).toBe("ready");
  });

  it("cleans up on unmount and ignores pending promises", async () => {
    const deferred = createDeferred<GitBlameResponse>();
    blameMock.mockReturnValueOnce(deferred.promise);

    const mock = createMockEditor("content\n");
    await mount(defaultTab, mock.editor, true);
    expect(currentHook?.status).toBe("loading");

    // Unmount
    act(() => {
      root?.unmount();
      root = null;
    });

    // Resolve after unmount
    await act(async () => {
      deferred.resolve(createSampleBlameResponse("snap-1", 1, 2));
      await Promise.resolve();
    });

    // No errors thrown, clean unmount
    expect(root).toBeNull();
  });
});
