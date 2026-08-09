// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FsEventDto, FsTreeData } from "@/api/fs-types.js";
import type { ExplorerLanguageScanCache } from "@/lib/explorer-language-scan.js";
import { GIT_FS_INVALIDATION_DEBOUNCE_MS } from "@/lib/git-fs-invalidation.js";
import { useFsSubscription } from "./use-fs-subscription.js";

const mocks = vi.hoisted(() => {
  const queryClient = {
    invalidateQueries: vi.fn(() => Promise.resolve()),
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
    removeQueries: vi.fn(),
  };
  const transport = {
    fsSubscribeTree: vi.fn(async () => ({
      sub_id: 7,
      nodes: [
        {
          path: "src/app.ts",
          name: "app.ts",
          kind: "file",
          size: 4,
          mtime: 1,
          isSymlink: false,
        },
      ],
    })),
    fsUnsubscribeTree: vi.fn(),
    onFsEvent: vi.fn(),
  };
  return { queryClient, transport };
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
  useQuery: () => ({
    data: {
      sub_id: 7,
      nodes: [
        {
          id: "src/app.ts",
          name: "app.ts",
          kind: "file",
          size: 4,
          mtime: 1,
          isSymlink: false,
          children: null,
        },
      ],
    },
  }),
}));

vi.mock("@/api/transport.js", () => ({
  getTransportGeneration: () => 0,
  getTransport: () => mocks.transport,
  subscribeTransportChanges: () => () => {},
}));

vi.mock("@/api/client.js", () => ({
  api: { fs: { list: vi.fn() } },
}));

let root: Root | null = null;
let eventHandler: ((event: FsEventDto) => void) | undefined;

function TestSubscription() {
  useFsSubscription("alpha", "");
  return null;
}

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.transport.onFsEvent.mockImplementation((_id, handler) => {
    eventHandler = handler;
    return vi.fn();
  });
  await act(async () => root?.render(<TestSubscription />));
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  eventHandler = undefined;
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useFsSubscription Git refresh", () => {
  it("marks the existing language scan stale when a tree event arrives", async () => {
    vi.useFakeTimers();
    let scanCache: ExplorerLanguageScanCache = {
      result: {
        files: [],
        truncated: false,
        limit: 20_000,
      },
      generation: 0,
      stale: false,
      scannedAt: 100,
    };
    mocks.queryClient.getQueryData.mockImplementation((key: unknown[]) =>
      key[0] === "explorer-language-scan" ? scanCache : undefined,
    );
    mocks.queryClient.setQueryData.mockImplementation(
      (key: unknown[], update: unknown) => {
        if (key[0] === "explorer-language-scan") {
          scanCache = update as ExplorerLanguageScanCache;
        }
      },
    );

    await mount();
    await act(async () =>
      eventHandler?.({ kind: "modify", path: "/workspace/src/app.ts" }),
    );

    expect(scanCache).toMatchObject({
      generation: 1,
      stale: true,
    });
    vi.advanceTimersByTime(GIT_FS_INVALIDATION_DEBOUNCE_MS);
  });

  it("keeps the tree delta path and schedules a Git refresh", async () => {
    vi.useFakeTimers();
    let cache: FsTreeData = {
      sub_id: 7,
      nodes: [
        {
          id: "src/app.ts",
          name: "app.ts",
          kind: "file",
          size: 4,
          mtime: 1,
          isSymlink: false,
          children: null,
        },
      ],
    };
    mocks.queryClient.setQueryData.mockImplementation(
      (key: unknown[], update: unknown) => {
        if (key[0] === "fs-tree") {
          cache = (update as (current: FsTreeData) => FsTreeData)(cache);
        }
      },
    );

    await mount();
    await act(async () =>
      eventHandler?.({ kind: "modify", path: "/workspace/src/app.ts" }),
    );

    expect(cache.nodes).toHaveLength(1);
    expect(cache.nodes[0]?.name).toBe("app.ts");
    expect(cache.nodes[0]?.mtime).toBeGreaterThan(1);
    expect(mocks.queryClient.invalidateQueries).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(GIT_FS_INVALIDATION_DEBOUNCE_MS);
    });
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledTimes(3);
    expect(mocks.queryClient.invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["git-diff", "alpha"] }],
      [{ queryKey: ["git-untracked", "alpha"] }],
      [{ queryKey: ["git-file-diff", "alpha"] }],
    ]);
  });

  it("preserves refetch behavior for unknown tree deltas", async () => {
    vi.useFakeTimers();
    await mount();

    await act(async () =>
      eventHandler?.({ kind: "create", path: "/workspace/src/new.ts" }),
    );

    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["fs-tree", "alpha", ""],
    });
    vi.advanceTimersByTime(GIT_FS_INVALIDATION_DEBOUNCE_MS);
    expect(mocks.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["git-diff", "alpha"],
    });
  });
});
