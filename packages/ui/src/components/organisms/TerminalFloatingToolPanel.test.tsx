// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampTerminalFloatingToolPanelLayout,
  handleTerminalFloatingToolPanelKeyDown,
  TerminalFloatingToolPanel,
} from "./TerminalFloatingToolPanel.js";
import { TERMINAL_FLOATING_PANEL_FRONT_Z_INDEX } from "@/lib/terminal-workspace-panel.js";

let root: Root | null = null;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

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

  it("applies the requested layer to the overlay root", () => {
    const markup = renderToStaticMarkup(
      <TerminalFloatingToolPanel
        open
        title="Git"
        content={<div>Git content</div>}
        zIndex={TERMINAL_FLOATING_PANEL_FRONT_Z_INDEX}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain('style="z-index:25"');
  });

  it("activates from descendant pointer and focus interactions", async () => {
    const onActivate = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <TerminalFloatingToolPanel
          open
          title="Git"
          content={
            <button type="button" data-testid="tool-content">
              Git
            </button>
          }
          onActivate={onActivate}
          onClose={() => undefined}
        />,
      );
    });

    const content = container.querySelector<HTMLButtonElement>(
      '[data-testid="tool-content"]',
    );
    expect(content).not.toBeNull();
    await act(async () => {
      content?.dispatchEvent(
        new Event("pointerdown", { bubbles: true }),
      );
    });
    expect(onActivate).toHaveBeenCalledOnce();

    await act(async () => content?.focus());
    expect(onActivate).toHaveBeenCalledTimes(2);
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
