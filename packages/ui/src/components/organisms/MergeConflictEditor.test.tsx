import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MergeConflictEditor } from "./MergeConflictEditor.js";
import { ConflictRegionNav } from "./ConflictRegionNav.js";
import type { ConflictSnapshot } from "@/api/client.js";

const mockPolicy = vi.hoisted(() => ({ enabled: false }));
const editorOptions: Array<Record<string, unknown>> = [];

const recoveryState = vi.hoisted(() => ({
  drafts: [] as Array<Record<string, unknown>>,
  activeDraft: null as Record<string, unknown> | null,
  currentScope: null as Record<string, unknown> | null,
}));

const initialConflictSnapshot: ConflictSnapshot = {
  conflictId: "cid_1",
  path: "src/conflict.ts",
  repositoryRoot: "/repo",
  worktreeRoot: "/repo",
  snapshotVersion: "ver1",
  fullIndexFingerprint: "idx1",
  status: "bothModified",
  stages: {
    ours: {
      stage: 2,
      mode: 0o100644,
      byteSize: 4,
      kind: "text",
      textTokens: ["ours\n"],
      oid: "abc1234",
    },
    theirs: {
      stage: 3,
      mode: 0o100644,
      byteSize: 6,
      kind: "text",
      textTokens: ["theirs\n"],
      oid: "def5678",
    },
  },
  worktree: {
    exists: true,
    kind: "regular",
    mode: 0o100644,
    byteLength: 40,
    textTokens: [
      "<<<<<<< ours\n",
      "ours\n",
      "=======\n",
      "theirs\n",
      ">>>>>>> theirs\n",
    ],
    hasConflictMarkers: true,
    isDirtyVsStages: true,
  },
  effectiveAttributes: {
    ident: false,
    filterQualified: true,
  },
};

const mockConflictFileState = vi.hoisted(() => ({
  data: null as ConflictSnapshot | null,
}));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

vi.mock("@/hooks/use-conflict-resolver.js", () => ({
  useConflictResolver: () => ({
    conflicts: [
      {
        conflictId: "cid_1",
        path: "src/conflict.ts",
        status: "bothModified",
        isBinary: false,
      },
    ],
    isLoading: false,
    drafts: recoveryState.drafts,
    activeDraft: recoveryState.activeDraft,
    currentScope: recoveryState.currentScope,
    inventoryError: null,
    refreshError: null,
    importRecoveryDraft: vi.fn(),
    confirmFreshReview: vi.fn(),
    discardDraft: vi.fn(),
    loadConflictDraft: vi.fn(),
    cancelPendingDraftLoads: vi.fn(),
    getDraft: vi.fn(),
    updateDraftResult: vi.fn(() => ({ success: true })),
    undoDraft: vi.fn(() => null),
    redoDraft: vi.fn(() => null),
    applyDraft: vi.fn(),
  }),
}));
vi.mock("@/api/queries.js", () => ({
  useGitConflictFile: () => ({
    data: mockConflictFileState.data ?? initialConflictSnapshot,
    isLoading: false,
  }),
  useGitFileDiff: () => ({
    data: {
      modified: "<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs\n",
      language: "typescript",
    },
    isLoading: false,
  }),
}));

vi.mock("@/lib/monaco-setup.js", () => ({}));

vi.mock("@monaco-editor/react", () => ({
  Editor: (props: Record<string, unknown>) => {
    editorOptions.push(props.options as Record<string, unknown>);
    return <div data-testid="merge-editor" />;
  },
}));

describe("MergeConflictEditor Android policy", () => {
  beforeEach(() => {
    mockPolicy.enabled = false;
    editorOptions.length = 0;
    recoveryState.drafts = [];
    recoveryState.activeDraft = null;
    recoveryState.currentScope = null;
    mockConflictFileState.data = null;
  });

  it("shows memory-only recovery and requires fresh review before Apply", () => {
    const scope = {
      profileId: "profile-1",
      generation: 1,
      serverUrl: "http://localhost:4803",
      project: "demo-project",
      worktreePath: "/repo",
      root: "/repo",
    };
    const authority = { repositoryRoot: "/repo", worktreeRoot: "/repo" };
    const recovery = {
      history: { past: [], future: [] },
      id: "recovery-1",
      isRecovery: true,
      requiresReview: false,
      scope,
      target: {
        conflictId: "cid_1",
        path: "src/conflict.ts",
        snapshotVersion: "old-ver",
      },
      authority,
      recoveryReason: "Earlier conflict snapshot",
    };
    recoveryState.drafts = [
      recovery,
      {
        ...recovery,
        id: "other-owner",
        scope: { ...scope, profileId: "profile-2" },
      },
      {
        history: { past: [], future: [] },
        id: "fresh-1",
        isRecovery: false,
        requiresReview: true,
        scope,
        target: {
          conflictId: "cid_1",
          path: "src/conflict.ts",
          snapshotVersion: "ver1",
        },
        authority,
      },
    ];
    recoveryState.activeDraft = recoveryState.drafts[2] ?? null;
    recoveryState.currentScope = scope;

    const markup = renderToStaticMarkup(
      <MergeConflictEditor
        project="demo-project"
        filePath="src/conflict.ts"
        onClose={() => {}}
        onResolved={() => {}}
      />,
    );

    expect(markup).toContain("Saved recovery for src/conflict.ts.");
    expect(markup).toContain("This text is memory-only and");
    expect(markup).toContain("not sent to the server or worktree.");
    expect(markup).toContain("Refresh and import for review");
    expect(markup.match(/Refresh and import for review/g)).toHaveLength(1);
    expect(markup).toContain("Discard saved text");
    expect(markup).toContain("Confirm fresh review");
    expect(markup).toContain(
      'disabled="" title="Confirm fresh-snapshot review before Apply"',
    );
  });

  it("keeps the result editor read-only and disables text mutations on Android policy", () => {
    mockPolicy.enabled = true;

    const markup = renderToStaticMarkup(
      <MergeConflictEditor
        project="demo-project"
        filePath="src/conflict.ts"
        onClose={() => {}}
        onResolved={() => {}}
      />,
    );

    expect(editorOptions).toHaveLength(3);
    expect(editorOptions[0]?.readOnly).toBe(true);
    expect(editorOptions[1]?.readOnly).toBe(true);
    expect(editorOptions[2]?.readOnly).toBe(true);
    expect(markup).toContain('title="Undo conflict draft edit" disabled=""');
    expect(markup).toContain('title="Redo conflict draft edit" disabled=""');
    expect(markup).toContain(
      'disabled="" title="Accept all incoming (theirs)"',
    );
    expect(markup).toContain('disabled="" title="Accept all current (ours)"');
    expect(markup).toContain(
      'disabled="" title="Unavailable on Android Chrome: result is read-only"',
    );
    expect(markup).toContain("Text editing is unavailable on Android Chrome");
  });

  it("disables each per-conflict accept action when the result is read-only", () => {
    const markup = renderToStaticMarkup(
      <ConflictRegionNav
        regions={[{ id: "conflict-1", startLine: 1, endLine: 5 }]}
        selectedIndex={0}
        onSelectIndex={() => {}}
        onAcceptSide={() => {}}
        disabled={true}
      />,
    );

    expect(markup).toContain('disabled="" title="Editing disabled"');
    expect(markup.match(/disabled=""/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it("renders binary conflict view when stages are binary", () => {
    mockConflictFileState.data = {
      ...initialConflictSnapshot,
      stages: {
        ours: {
          stage: 2,
          mode: 0o100644,
          byteSize: 1024,
          kind: "binary",
          oid: "1234567890abcdef",
        },
        theirs: {
          stage: 3,
          mode: 0o100644,
          byteSize: 2048,
          kind: "binary",
          oid: "abcdef1234567890",
        },
      },
    };

    const markup = renderToStaticMarkup(
      <MergeConflictEditor
        project="demo-project"
        filePath="src/conflict.ts"
        onClose={() => {}}
        onResolved={() => {}}
      />,
    );

    expect(markup).toContain("Binary File Conflict");
    expect(markup).toContain("Take Ours (Stage 2)");
    expect(markup).toContain("Take Theirs (Stage 3)");
    expect(markup).toContain("1024 bytes");
    expect(markup).toContain("2048 bytes");
  });

  it("renders modify / delete conflict view keeping Ours when Ours is present and Theirs is missing", () => {
    mockConflictFileState.data = {
      ...initialConflictSnapshot,
      status: "modifyDelete",
      stages: {
        ...initialConflictSnapshot.stages,
        theirs: { kind: "missing" },
      },
      worktree: {
        exists: false,
        kind: "missing",
        mode: 0,
        byteLength: 0,
        hasConflictMarkers: false,
        isDirtyVsStages: false,
      },
    };

    const markup = renderToStaticMarkup(
      <MergeConflictEditor
        project="demo-project"
        filePath="src/conflict.ts"
        onClose={() => {}}
        onResolved={() => {}}
      />,
    );

    expect(markup).toContain("Modify / Delete Conflict");
    expect(markup).toContain("Keep modified version (Ours)");
    expect(markup).toContain("Delete file");
  });

  it("renders modify / delete conflict view keeping Theirs when Ours is missing and Theirs is present", () => {
    mockConflictFileState.data = {
      ...initialConflictSnapshot,
      status: "modifyDelete",
      stages: {
        ...initialConflictSnapshot.stages,
        ours: { kind: "missing" },
      },
      worktree: {
        exists: false,
        kind: "missing",
        mode: 0,
        byteLength: 0,
        hasConflictMarkers: false,
        isDirtyVsStages: false,
      },
    };

    const markup = renderToStaticMarkup(
      <MergeConflictEditor
        project="demo-project"
        filePath="src/conflict.ts"
        onClose={() => {}}
        onResolved={() => {}}
      />,
    );

    expect(markup).toContain("Modify / Delete Conflict");
    expect(markup).toContain("Keep modified version (Theirs)");
    expect(markup).toContain("Delete file");
  });

  it("renders unsupported conflict view when status is unsupported", () => {
    mockConflictFileState.data = {
      ...initialConflictSnapshot,
      status: "unsupported",
      unsupportedReason: "Unsupported git attributes filter",
      worktreeRoot: "/home/user/project",
    };

    const markup = renderToStaticMarkup(
      <MergeConflictEditor
        project="demo-project"
        filePath="src/conflict.ts"
        onClose={() => {}}
        onResolved={() => {}}
      />,
    );

    expect(markup).toContain("Unsupported Conflict");
    expect(markup).toContain("Unsupported git attributes filter");
    expect(markup).toContain("Automatic resolution is disabled for safety");
  });
});
