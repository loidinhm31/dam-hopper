import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictBlock, MergeConflictEditor } from "./MergeConflictEditor.js";

const mockPolicy = vi.hoisted(() => ({ enabled: false }));
const editorOptions: Array<Record<string, unknown>> = [];

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

vi.mock("@/api/queries.js", () => ({
  useGitConflicts: () => ({
    data: [{ path: "src/conflict.ts", ours: "ours", theirs: "theirs" }],
    isLoading: false,
  }),
  useGitFileDiff: () => ({
    data: {
      modified: "<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs\n",
      language: "typescript",
    },
    isLoading: false,
  }),
  useGitResolve: () => ({ mutateAsync: vi.fn() }),
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
    expect(markup).toContain(
      'disabled="" title="Accept all incoming (theirs)"',
    );
    expect(markup).toContain('disabled="" title="Accept all current (ours)"');
    expect(markup).toContain(
      'disabled="" title="Unavailable on Android Chrome: result is read-only"',
    );
    expect(markup).toContain("Text editing is unavailable on Android Chrome");
    expect(markup.match(/disabled=""/g)).toHaveLength(3);
  });

  it("disables each per-conflict accept action when the result is read-only", () => {
    const markup = renderToStaticMarkup(
      <ConflictBlock
        index={0}
        isSelected={false}
        onNavigate={() => {}}
        onAcceptOurs={() => {}}
        onAcceptTheirs={() => {}}
        actionsDisabled
      />,
    );

    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).toContain(
      "Unavailable on Android Chrome: result is read-only",
    );
  });
});
