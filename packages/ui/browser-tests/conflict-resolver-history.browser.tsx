import "@/index.css";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as monaco from "monaco-editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type {
  ApiClient,
  ConflictSnapshot,
  OperationStatusResponse,
} from "@/api/client.js";
import {
  __setConnectionSnapshotForTests,
  resetConnections,
} from "@/api/connections.js";
import * as serverConfig from "@/api/server-config.js";
import type { ServerProfile } from "@/api/server-config.js";
import { MergeConflictEditor } from "@/components/organisms/MergeConflictEditor.js";
import { conflictDraftStore } from "@/lib/conflict-draft-store.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const serverProfile: ServerProfile = {
  id: "resolver-profile",
  name: "Resolver browser test",
  url: "http://127.0.0.1:4801",
  authType: "none",
  createdAt: 1,
  autoConnect: false,
};
const target = { profileId: serverProfile.id, project: "repo" };
const conflictSummary = {
  conflictId: "conflict-resolver-history",
  path: "src/history.txt",
  status: "bothModified" as const,
  isBinary: false,
};
const snapshot: ConflictSnapshot = {
  conflictId: conflictSummary.conflictId,
  path: conflictSummary.path,
  repositoryRoot: "/repo",
  worktreeRoot: "/repo",
  snapshotVersion: "snapshot-resolver-history",
  fullIndexFingerprint: "index-resolver-history",
  status: "bothModified",
  stages: {
    ours: {
      stage: 2,
      oid: "ours-oid",
      mode: 0o100644,
      byteSize: 5,
      kind: "text",
      textTokens: ["ours\n"],
    },
    theirs: {
      stage: 3,
      oid: "theirs-oid",
      mode: 0o100644,
      byteSize: 7,
      kind: "text",
      textTokens: ["theirs\n"],
    },
  },
  worktree: {
    exists: true,
    kind: "regular",
    mode: 0o100644,
    byteLength: 9,
    textTokens: ["original\n"],
    hasConflictMarkers: false,
    isDirtyVsStages: true,
  },
  effectiveAttributes: { ident: false, filterQualified: true },
};

function operationStatus(): OperationStatusResponse {
  return {
    operation: "none",
    canContinue: false,
    canAbort: false,
    operationFingerprint: "operation-1",
    fullIndexFingerprint: "index-resolver-history",
    stageRoleLabels: { ours: "Ours", theirs: "Theirs" },
  };
}

async function delayOneTurn(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  await promise;
}

describe("MergeConflictEditor retained result history in Chromium", () => {
  let queryClient: QueryClient;
  let container: HTMLDivElement;
  let root: Root;
  let api: ApiClient;
  let previousProfiles: ServerProfile[];
  let previousActiveProfileId: string | null;

  beforeEach(() => {
    previousProfiles = serverConfig.getProfiles();
    previousActiveProfileId = serverConfig.getActiveProfileId();
    resetConnections();
    conflictDraftStore.resetForTesting();
    serverConfig.saveProfiles([serverProfile]);
    serverConfig.setActiveProfile(serverProfile.id);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    api = {
      git: {
        conflicts: vi.fn(async () => ({
          targetRevision: "head-1",
          entries: [conflictSummary],
          truncated: false,
        })),
        conflictFile: vi.fn(async () => snapshot),
        fileDiff: vi.fn(async () => ({
          path: snapshot.path,
          language: "plaintext",
          hunks: [],
          lineChanges: [],
          isBinary: false,
        })),
        operationStatus: vi.fn(async () => operationStatus()),
        resolve: vi.fn(),
      },
    } as unknown as ApiClient;
    __setConnectionSnapshotForTests(serverProfile.id, {
      owner: { profileId: serverProfile.id, generation: 1 },
      status: "connected",
      serverUrl: serverProfile.url,
      api,
    });
    container = document.createElement("div");
    container.style.width = "1100px";
    container.style.height = "700px";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    act(() => root.unmount());
    await queryClient.cancelQueries();
    container.remove();
    queryClient.clear();
    conflictDraftStore.resetForTesting();
    resetConnections();
    serverConfig.saveProfiles(previousProfiles);
    if (
      previousActiveProfileId &&
      previousProfiles.some((profile) => profile.id === previousActiveProfileId)
    ) {
      serverConfig.setActiveProfile(previousActiveProfileId);
    } else {
      serverConfig.clearActiveProfile();
    }
    vi.restoreAllMocks();
  });

  it("routes Ctrl+Z and Ctrl+Shift+Z through the retained draft history", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MergeConflictEditor
            project="repo"
            target={target}
            filePath={snapshot.path}
            onClose={() => {}}
            onResolved={() => {}}
          />
        </QueryClientProvider>,
      );
      await delayOneTurn();
    });

    let resultEditor: monaco.editor.IStandaloneCodeEditor | undefined;
    for (let attempt = 0; attempt < 100 && !resultEditor; attempt += 1) {
      resultEditor = monaco.editor
        .getEditors()
        .find((editor) => editor.getModel()?.getValue() === "original\n");
      if (!resultEditor) {
        await act(async () => delayOneTurn());
      }
    }
    expect(resultEditor).toBeDefined();
    const editor = resultEditor!;
    const model = editor.getModel();
    expect(model).not.toBeNull();

    await act(async () => {
      const insertion = new monaco.Range(1, 9, 1, 9);
      model!.applyEdits([{ range: insertion, text: " edited" }]);
    });
    expect(model!.getValue()).toBe("original edited\n");
    const draft = conflictDraftStore.getSnapshot().activeDraft;
    expect(draft?.result).toBe("original edited\n");
    expect(draft?.history.past).toHaveLength(1);

    editor.focus();
    expect(editor.hasTextFocus()).toBe(true);
    await act(async () => {
      await userEvent.keyboard("{Control>}z{/Control}");
    });
    expect(model!.getValue()).toBe("original\n");
    expect(
      conflictDraftStore.getSnapshot().activeDraft?.history.future,
    ).toHaveLength(1);

    await act(async () => {
      await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    });
    expect(model!.getValue()).toBe("original edited\n");
    expect(
      conflictDraftStore.getSnapshot().activeDraft?.history.future,
    ).toHaveLength(0);
  });
});
