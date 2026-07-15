import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  handleTerminalFloatingToolPanelKeyDown,
  TerminalFloatingToolPanel,
} from "./TerminalFloatingToolPanel.js";

describe("TerminalFloatingToolPanel", () => {
  it("renders nothing while closed", () => {
    const markup = renderToStaticMarkup(
      <TerminalFloatingToolPanel
        open={false}
        title="Git"
        content={<div>Git content</div>}
        onClose={() => undefined}
      />,
    );

    expect(markup).toBe("");
  });

  it("renders a floating, closable tool surface while open", () => {
    const markup = renderToStaticMarkup(
      <TerminalFloatingToolPanel
        open
        title="Ports"
        content={<div>Ports content</div>}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("Ports");
    expect(markup).toContain("Ports content");
    expect(markup).toContain("Close Ports panel");
    expect(markup).toContain("Drag Ports panel");
    expect(markup).toContain("Resize Ports panel");
    expect(markup).toContain('data-testid="terminal-floating-tool-panel"');
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();

    expect(
      handleTerminalFloatingToolPanelKeyDown({ key: "Escape" }, onClose),
    ).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
    expect(
      handleTerminalFloatingToolPanelKeyDown({ key: "Enter" }, onClose),
    ).toBe(false);
  });
});
