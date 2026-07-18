import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  clampTerminalFloatingToolPanelLayout,
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

  it("allows Git to resize to the viewport bounds while preserving gutters", () => {
    expect(
      clampTerminalFloatingToolPanelLayout(
        {
          width: 4000,
          height: 2000,
          top: -20,
          left: 9999,
        },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({
      width: 1888,
      height: 1048,
      top: 16,
      left: 16,
    });
  });
});
