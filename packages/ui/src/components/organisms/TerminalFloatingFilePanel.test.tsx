import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  handleTerminalFloatingFilePanelKeyDown,
  TerminalFloatingFilePanel,
} from "./TerminalFloatingFilePanel.js";

describe("TerminalFloatingFilePanel", () => {
  it("renders nothing while closed", () => {
    const markup = renderToStaticMarkup(
      <TerminalFloatingFilePanel
        open={false}
        treeWidth={280}
        explorerContent={<div>Explorer</div>}
        editorContent={<div>Editor</div>}
        treeResizeHandleProps={{ onMouseDown: () => undefined }}
        onClose={() => undefined}
      />,
    );

    expect(markup).toBe("");
  });

  it("renders the explorer and editor surfaces while open", () => {
    const markup = renderToStaticMarkup(
      <TerminalFloatingFilePanel
        open
        treeWidth={280}
        explorerContent={<div>Explorer</div>}
        editorContent={<div>Editor</div>}
        treeResizeHandleProps={{ onMouseDown: () => undefined }}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("Workspace Files");
    expect(markup).toContain("Explorer");
    expect(markup).toContain("Editor");
    expect(markup).toContain("Close files panel");
    expect(markup).toContain("Drag files panel");
    expect(markup).toContain("Resize files panel");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();

    expect(
      handleTerminalFloatingFilePanelKeyDown({ key: "Escape" }, onClose),
    ).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(
      handleTerminalFloatingFilePanelKeyDown({ key: "Enter" }, onClose),
    ).toBe(false);
  });
});
