// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const transportMocks = vi.hoisted(() => ({
  fsRead: vi.fn(),
  fsWriteFile: vi.fn(),
}));

vi.mock("@/api/transport.js", () => ({
  getTransport: () => ({
    fsRead: transportMocks.fsRead,
    fsWriteFile: transportMocks.fsWriteFile,
  }),
}));

const useGitFileDiffMock = vi.fn();
const useGitCommitFileDiffMock = vi.fn();
const useQueryClientMock = vi.fn(() => ({
  invalidateQueries: vi.fn(),
}));
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
    lastDiffProps = null;
    lastOnMount = undefined;
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      } as unknown as typeof ResizeObserver;
    }
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


  it("resets saveState from saving to idle when in-flight stat is superseded by typing", async () => {
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

    const statGate = Promise.withResolvers<{
      ok: boolean;
      content: string;
      mtime: number;
    }>();
    transportMocks.fsRead.mockReturnValue(statGate.promise);

    let onDidChangeContentCb: (() => void) | undefined;
    let modifiedVal = "after\n";
    const modifiedEditor = {
      getValue: () => modifiedVal,
      getDomNode: () => null,
      updateOptions: vi.fn(),
      onDidChangeModelContent: (cb: () => void) => {
        onDidChangeContentCb = cb;
        return { dispose: vi.fn() };
      },
    };
    const originalEditor = { getDomNode: () => null };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DiffViewer
          project="demo-project"
          filePath="src/demo.ts"
          fileStatus="modified"
        />,
      );
    });

    // Mount editor
    lastOnMount?.({
      getModifiedEditor: () => modifiedEditor,
      getOriginalEditor: () => originalEditor,
      getModel: () => ({ original: null, modified: null }),
      onDidChangeModel: vi.fn(),
    });

    // Simulate dirty edit
    modifiedVal = "after-edit-1\n";
    act(() => onDidChangeContentCb?.());

    const saveBtn = container.querySelector(
      'button[aria-label="Save diff changes"]',
    ) as HTMLButtonElement | null;
    expect(saveBtn).not.toBeNull();
    expect(saveBtn?.disabled).toBe(false);

    // Click save
    await act(async () => {
      saveBtn?.click();
    });

    // While stat is in flight, user types again (superseding the save)
    modifiedVal = "after-edit-2\n";
    act(() => onDidChangeContentCb?.());

    // Resolve stat promise deterministically
    await act(async () => {
      statGate.resolve({ ok: true, content: btoa("file\n"), mtime: 10 });
    });

    // fsWriteFile must NOT have been called because revision changed!
    expect(transportMocks.fsWriteFile).not.toHaveBeenCalled();

    // saveState must have reset to idle (save button not stuck in disabled/saving)
    expect(saveBtn?.disabled).toBe(false);

    root.unmount();
    container.remove();
  });

  it("preserves authoritative content in Monaco after successful clean save during delayed refetch", async () => {
    useGitFileDiffMock.mockReturnValue({
      data: { ...diffData, modified: "server-old\n" },
      isLoading: false,
      isError: false,
    });
    useGitCommitFileDiffMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });

    transportMocks.fsRead.mockResolvedValue({
      ok: true,
      content: btoa("server-old\n"),
      mtime: 10,
    });
    transportMocks.fsWriteFile.mockResolvedValue({ ok: true });

    let onDidChangeContentCb: (() => void) | undefined;
    let modifiedVal = "server-old\n";
    const modifiedEditor = {
      getValue: () => modifiedVal,
      getDomNode: () => null,
      updateOptions: vi.fn(),
      onDidChangeModelContent: (cb: () => void) => {
        onDidChangeContentCb = cb;
        return { dispose: vi.fn() };
      },
    };
    const originalEditor = { getDomNode: () => null };

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DiffViewer
          project="demo-project"
          filePath="src/demo.ts"
          fileStatus="modified"
        />,
      );
    });

    lastOnMount?.({
      getModifiedEditor: () => modifiedEditor,
      getOriginalEditor: () => originalEditor,
      getModel: () => ({ original: null, modified: null }),
      onDidChangeModel: vi.fn(),
    });

    // User types new content
    modifiedVal = "user-saved-new\n";
    act(() => onDidChangeContentCb?.());

    const saveBtn = container.querySelector(
      'button[aria-label="Save diff changes"]',
    ) as HTMLButtonElement | null;
    expect(saveBtn?.disabled).toBe(false);

    // Save
    await act(async () => {
      saveBtn?.click();
    });

    expect(transportMocks.fsWriteFile).toHaveBeenCalledWith(
      expect.anything(),
      "src/demo.ts",
      "user-saved-new\n",
      10,
    );

    // Even though refetched data has not yet updated (query still returns server-old),
    // lastDiffProps.modified passed to DiffEditor MUST NOT be "server-old\n"!
    // It must remain "user-saved-new\n"!
    expect(lastDiffProps?.modified).toBe("user-saved-new\n");

    root.unmount();
    container.remove();
  });

  it("renders locate button when onLocateFile is provided and invokes it on click", async () => {
    const onLocateFile = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DiffViewer
          project="demo-project"
          filePath="src/demo.ts"
          fileStatus="modified"
          onLocateFile={onLocateFile}
        />,
      );
    });

    const locateBtn = container.querySelector(
      'button[aria-label="Locate file in file tree"]',
    ) as HTMLButtonElement | null;
    expect(locateBtn).not.toBeNull();
    expect(locateBtn?.title).toBe("Locate file in file tree");

    await act(async () => {
      locateBtn?.click();
    });

    expect(onLocateFile).toHaveBeenCalledWith("src/demo.ts");

    root.unmount();
    container.remove();
  });

  it("does not render locate button when onLocateFile is not provided", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <DiffViewer
          project="demo-project"
          filePath="src/demo.ts"
          fileStatus="modified"
        />,
      );
    });

    const locateBtn = container.querySelector(
      'button[aria-label="Locate file in file tree"]',
    );
    expect(locateBtn).toBeNull();

    root.unmount();
    container.remove();
  });
});
