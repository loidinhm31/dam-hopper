import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const useGitFileDiffMock = vi.fn();
const useGitCommitFileDiffMock = vi.fn();
const useQueryClientMock = vi.fn(() => ({
  invalidateQueries: vi.fn(),
}));

vi.mock("@/api/queries.js", () => ({
  useGitFileDiff: (...args: unknown[]) => useGitFileDiffMock(...args),
  useGitCommitFileDiff: (...args: unknown[]) =>
    useGitCommitFileDiffMock(...args),
}));

vi.mock("@/lib/monaco-setup.js", () => ({}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => useQueryClientMock(),
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({
    original,
    modified,
  }: {
    original?: string;
    modified?: string;
  }) => (
    <div data-testid="diff-editor">
      {original}
      {modified}
    </div>
  ),
}));

import { DiffViewer } from "./DiffViewer.js";

const diffData = {
  original: "before\n",
  modified: "after\n",
  language: "typescript",
  isBinary: false,
};

describe("DiffViewer", () => {
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
});
