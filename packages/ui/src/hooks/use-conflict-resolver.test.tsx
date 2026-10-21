// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  type ApiClient,
  type ConflictSnapshot,
  type ConflictSummaryEntry,
  type ConflictSummaryResponse,
  type ProjectTargetInput,
} from "@/api/client.js";
import {
  __setConnectionSnapshotForTests,
  disconnectProfile,
  resetConnections,
} from "@/api/connections.js";
import * as serverConfig from "@/api/server-config.js";
import type { ServerProfile } from "@/api/server-config.js";
import { conflictDraftStore } from "@/lib/conflict-draft-store.js";
import type {
  ConflictDraft,
  DraftOwnerScope,
} from "@/lib/conflict-draft-types.js";
import { useConflictResolver } from "./use-conflict-resolver.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const controllerMocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  mutateAsync: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/hooks/use-server-profile.js", () => ({
  useServerProfile: () => ({ id: "profile-a" }),
}));
vi.mock("@/api/queries.js", () => ({
  useGitOperationStatus: () => ({
    data: undefined,
    isLoading: false,
    refetch: controllerMocks.refetch,
  }),
  useGitExecuteOperation: () => ({ mutateAsync: controllerMocks.mutateAsync }),
  invalidateGitProjectQueries: controllerMocks.invalidate,
}));

const serverProfiles = [
  {
    id: "profile-a",
    name: "A",
    url: "http://127.0.0.1:4801",
    authType: "none",
    createdAt: 1,
    autoConnect: false,
  },
  {
    id: "profile-b",
    name: "B",
    url: "http://127.0.0.1:4802",
    authType: "none",
    createdAt: 2,
    autoConnect: false,
  },
] satisfies ServerProfile[];

interface ResolverHarnessResult {
  conflicts: ConflictSummaryEntry[];
  loadConflictDraft(
    conflictId: string,
    providedSnapshot?: ConflictSnapshot,
    requireFreshSnapshot?: boolean,
  ): Promise<ConflictDraft>;
}

function makeSnapshot(): ConflictSnapshot {
  const stage = (number: 1 | 2 | 3, text: string) => ({
    stage: number,
    oid: `oid-${number}`,
    mode: 0o100644,
    byteSize: text.length,
    kind: "text" as const,
    textTokens: [text],
  });
  return {
    conflictId: "conflict-1",
    path: "src/file.txt",
    repositoryRoot: "/repo",
    worktreeRoot: "/repo",
    snapshotVersion: "snapshot-1",
    fullIndexFingerprint: "index-1",
    status: "bothModified",
    stages: {
      base: stage(1, "base\n"),
      ours: stage(2, "ours\n"),
      theirs: stage(3, "theirs\n"),
    },
    worktree: {
      exists: true,
      kind: "regular",
      mode: 0o100644,
      byteLength: 5,
      textTokens: ["ours\n"],
      hasConflictMarkers: false,
      isDirtyVsStages: true,
    },
    effectiveAttributes: { ident: false, filterQualified: true },
  };
}

function makeApi(conflicts: unknown, operationStatus: unknown = vi.fn()) {
  return {
    git: { conflicts, operationStatus },
  } as unknown as ApiClient;
}

function connectProfile(
  profileId: string,
  serverUrl: string,
  api: ApiClient,
): void {
  __setConnectionSnapshotForTests(profileId, {
    owner: { profileId, generation: 1 },
    status: "connected",
    serverUrl,
    api,
  });
}

function makeScope(profileId: string, serverUrl: string): DraftOwnerScope {
  return { profileId, generation: 1, serverUrl, project: "repo" };
}

async function delayOneTurn(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  await promise;
}

describe("useConflictResolver ownership and async fencing", () => {
  let queryClient: QueryClient;
  let container: HTMLDivElement;
  let root: Root;
  let latest: ResolverHarnessResult | null;

  function Harness({ profileId }: { profileId: string }) {
    latest = useConflictResolver({ profileId, project: "repo" });
    return null;
  }

  async function renderProfile(profileId: string): Promise<void> {
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(Harness, { profileId }),
        ),
      );
      await delayOneTurn();
    });
  }

  beforeEach(() => {
    resetConnections();
    conflictDraftStore.resetForTesting();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    latest = null;
    vi.spyOn(serverConfig, "getProfiles").mockReturnValue(serverProfiles);
    controllerMocks.refetch.mockReset();
    controllerMocks.mutateAsync.mockReset();
    controllerMocks.invalidate.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
    resetConnections();
    vi.restoreAllMocks();
  });

  it("retains another profile's draft when selection switches and retires it only on invalidation", async () => {
    const conflict: ConflictSummaryEntry = {
      conflictId: "conflict-1",
      path: "src/file.txt",
      status: "bothModified",
      isBinary: false,
    };
    const apiA = makeApi(
      vi.fn(async () => ({ entries: [conflict], truncated: false })),
    );
    const apiB = makeApi(
      vi.fn(async () => ({ entries: [], truncated: false })),
    );
    connectProfile("profile-a", serverProfiles[0]!.url, apiA);
    connectProfile("profile-b", serverProfiles[1]!.url, apiB);
    const draftResult = conflictDraftStore.loadSnapshot(
      makeScope("profile-a", serverProfiles[0]!.url),
      makeSnapshot(),
    );
    if (!("draft" in draftResult)) throw new Error(draftResult.error);
    const draft = draftResult.draft;
    conflictDraftStore.updateResult(draft.id, "unsent edit");

    await renderProfile("profile-a");
    await renderProfile("profile-b");

    expect(draft.isRecovery).toBe(false);
    act(() => disconnectProfile("profile-a"));
    expect(draft.isRecovery).toBe(true);
    expect(draft.recoveryText).toBe("unsent edit");
  });

  it("restarts inventory pagination once when the server rejects a stale cursor", async () => {
    const stale = new ApiRequestError(
      "Conflict cursor is stale",
      400,
      "GIT_CONFLICT_CURSOR_STALE",
    );
    const conflict: ConflictSummaryEntry = {
      conflictId: "conflict-current",
      path: "src/current.txt",
      status: "bothModified",
      isBinary: false,
    };
    const conflicts = vi
      .fn(
        async (
          _target: ProjectTargetInput,
          _root?: string,
          _cursor?: string,
        ): Promise<ConflictSummaryResponse> => ({
          targetRevision: "head",
          entries: [],
          truncated: false,
        }),
      )
      .mockResolvedValueOnce({
        targetRevision: "head",
        entries: [],
        truncated: false,
        nextCursor: "cursor-1",
      })
      .mockRejectedValueOnce(stale)
      .mockResolvedValueOnce({
        targetRevision: "head",
        entries: [conflict],
        truncated: false,
      });

    connectProfile("profile-a", serverProfiles[0]!.url, makeApi(conflicts));
    await renderProfile("profile-a");

    expect(conflicts.mock.calls.map((call) => call[2])).toEqual([
      undefined,
      "cursor-1",
      undefined,
    ]);
    expect(latest?.conflicts.map((entry) => entry.conflictId)).toEqual([
      "conflict-current",
    ]);
  });

  it("does not store a snapshot after its owner changes during the operation-status read", async () => {
    const { promise: operationPromise, resolve: releaseOperation } =
      Promise.withResolvers<{ stageRoleLabels?: undefined }>();
    const operationStatus = vi.fn(() => operationPromise);
    const conflict: ConflictSummaryEntry = {
      conflictId: "conflict-1",
      path: "src/file.txt",
      status: "bothModified",
      isBinary: false,
    };
    const apiA = makeApi(
      vi.fn(async () => ({ entries: [conflict], truncated: false })),
      operationStatus,
    );
    const apiB = makeApi(
      vi.fn(async () => ({ entries: [], truncated: false })),
    );
    connectProfile("profile-a", serverProfiles[0]!.url, apiA);
    connectProfile("profile-b", serverProfiles[1]!.url, apiB);

    await renderProfile("profile-a");
    const pendingLoad = latest!.loadConflictDraft("conflict-1", makeSnapshot());
    expect(operationStatus).toHaveBeenCalledTimes(1);
    await renderProfile("profile-b");
    releaseOperation({});

    await expect(pendingLoad).rejects.toThrow(
      "Conflict selection or owner changed while loading",
    );
    expect(conflictDraftStore.getSnapshot().drafts).toEqual([]);
  });
});
