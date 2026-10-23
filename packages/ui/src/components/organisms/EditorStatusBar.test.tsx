import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type * as monacoNs from "monaco-editor";
import { EditorStatusBar } from "./EditorStatusBar.js";

describe("EditorStatusBar", () => {
  it("renders git stats when a changed file is active", () => {
    const editor = {
      getPosition: () => ({ lineNumber: 7, column: 3 }),
      getModel: () => ({ getLineCount: () => 42 }),
    } as unknown as monacoNs.editor.IStandaloneCodeEditor;

    const markup = renderToStaticMarkup(
      <EditorStatusBar
        editor={editor}
        language="typescript"
        gitState={{
          path: "src/app.ts",
          rootRelativePath: "src/app.ts",
          rootId: ".",
          status: "added",
          stagedState: "unstaged",
          additions: 4,
          deletions: 0,
          hasConflict: false,
        }}
      />,
    );

    expect(markup).toContain("Ln 7, Col 3");
    expect(markup).toContain("42 lines");
    expect(markup).toContain("? +4 -0");
  });
  it("renders semantic status indicator when semanticStatus is provided", () => {
    const editor = {
      getPosition: () => ({ lineNumber: 1, column: 1 }),
      getModel: () => ({ getLineCount: () => 10 }),
    } as unknown as monacoNs.editor.IStandaloneCodeEditor;

    const readyMarkup = renderToStaticMarkup(
      <EditorStatusBar
        editor={editor}
        language="typescript"
        semanticStatus="ready"
      />,
    );
    expect(readyMarkup).toContain("TS/JS Ready");

    const startingMarkup = renderToStaticMarkup(
      <EditorStatusBar
        editor={editor}
        language="typescript"
        semanticStatus="initializing"
      />,
    );
    expect(startingMarkup).toContain("TS/JS Starting");

    const errorMarkup = renderToStaticMarkup(
      <EditorStatusBar
        editor={editor}
        language="typescript"
        semanticStatus="error"
      />,
    );
    expect(errorMarkup).toContain("TS/JS Error");
  });
});
