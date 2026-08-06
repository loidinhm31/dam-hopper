// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useGitFileDiffMock = vi.fn();
const useGitCommitFileDiffMock = vi.fn();
const useQueryClientMock = vi.fn(() => ({
  invalidateQueries: vi.fn(),
}));
const mockPolicy = vi.hoisted(() => ({ enabled: false }));
let lastDiffProps: Record<string, unknown> | null = null;
let lastOnMount: ((editor: unknown) => void) | undefined;

vi.mock("@/api/queries.js", () => ({
  useGitFileDiff: (...args: unknown[]) => useGitFileDiffMock(...args),
  useGitCommitFileDiff: (...args: unknown[]) =>
    useGitCommitFileDiffMock(...args),
}));

vi.mock("@/lib/monaco-setup.js", () => ({}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => useQueryClientMock(),
}));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: (props: Record<string, unknown>) => {
    lastDiffProps = props;
    lastOnMount = props.onMount as typeof lastOnMount;
    const original = props.original as string | undefined;
    const modified = props.modified as string | undefined;
    return (
      <div data-testid="diff-editor">
        {original}
        {modified}
      </div>
    );
  },
}));

import { DiffViewer } from "./DiffViewer.js";

const diffData = {
  original: "before\n",
  modified: "after\n",
  language: "typescript",
  isBinary: false,
};

describe("DiffViewer", () => {
  beforeEach(() => {
    mockPolicy.enabled = false;
    lastDiffProps = null;
    lastOnMount = undefined;
  });

  it("renders a working-copy diff without throwing", () => {
    useGitFileDiffMock.mockReturnValue({
      data: diffData,
      isLoading: false,
      isError: false,
    });
    useGitCommitFileDiffMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });

    expect(() =>
      renderToStaticMarkup(
        <DiffViewer
          project="demo-project"
          filePath="src/demo.ts"
          fileStatus="modified"
          additions={1}
          deletions={1}
          onClose={() => {}}
        />,
      ),
    ).not.toThrow();
  });

  it("renders a commit diff without throwing", () => {
    useGitFileDiffMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });
    useGitCommitFileDiffMock.mockReturnValue({
      data: diffData,
      isLoading: false,
      isError: false,
    });

    expect(() =>
      renderToStaticMarkup(
        <DiffViewer
          project="demo-project"
          filePath="src/demo.ts"
          fileStatus="modified"
          additions={1}
          deletions={1}
          commitHash="abc123"
          onClose={() => {}}
        />,
      ),
    ).not.toThrow();
  });

  it("sets the modified editor read-only and guards mount focus under Android policy", () => {
    mockPolicy.enabled = true;
    useGitFileDiffMock.mockReturnValue({
      data: diffData,
      isLoading: false,
      isError: false,
    });
    useGitCommitFileDiffMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });

    renderToStaticMarkup(
      <DiffViewer
        project="demo-project"
        filePath="src/demo.ts"
        fileStatus="modified"
        additions={1}
        deletions={1}
        onClose={() => {}}
      />,
    );

    expect((lastDiffProps?.options as { readOnly?: boolean }).readOnly).toBe(
      true,
    );

    const updateOptions = vi.fn();
    const modifiedEditor = {
      getValue: () => "after\n",
      getDomNode: () => null,
      updateOptions,
      onDidChangeModelContent: vi.fn(),
    };
    const originalEditor = { getDomNode: () => null };
    lastOnMount?.({
      getModifiedEditor: () => modifiedEditor,
      getOriginalEditor: () => originalEditor,
      getModel: () => ({ original: null, modified: null }),
      onDidChangeModel: vi.fn(),
    });

    expect(updateOptions).toHaveBeenCalledWith({ readOnly: true });
    mockPolicy.enabled = false;
  });
});
