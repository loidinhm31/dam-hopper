// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleTerminalFloatingFilePanelKeyDown,
  TerminalFloatingFilePanel,
} from "./TerminalFloatingFilePanel.js";
import { getTerminalFloatingFilePanelTabForKey } from "@/lib/terminal-floating-file-panel-tabs.js";
import { TERMINAL_FLOATING_PANEL_FRONT_Z_INDEX } from "@/lib/terminal-workspace-panel.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

async function renderPanel(
  open: boolean,
  options: { onActivate?: () => void; zIndex?: number } = {},
) {
  if (!root) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }

  await act(async () => {
    root?.render(
      <TerminalFloatingFilePanel
        open={open}
        treeWidth={280}
        explorerContent={<div data-content="explorer">Explorer content</div>}
        changesContent={<div data-content="changes">Changes content</div>}
        editorContent={<div>Editor</div>}
        treeResizeHandleProps={{ onMouseDown: () => undefined }}
        zIndex={options.zIndex}
        onActivate={options.onActivate}
        onClose={() => undefined}
      />,
    );
  });
}

async function clickTab(id: string) {
  const tab = document.getElementById(id) as HTMLButtonElement | null;
  expect(tab).not.toBeNull();
  await act(async () => tab?.click());
  return tab!;
}

async function pressTabKey(tab: HTMLButtonElement, key: string) {
  await act(async () => {
    tab.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
    );
  });
}

describe("TerminalFloatingFilePanel", () => {
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    document.body.replaceChildren();
  });

  it("renders nothing while closed", () => {
    const markup = renderToStaticMarkup(
      <TerminalFloatingFilePanel
        open={false}
        treeWidth={280}
        explorerContent={<div>Explorer</div>}
        changesContent={<div>Changes</div>}
        editorContent={<div>Editor</div>}
        treeResizeHandleProps={{ onMouseDown: () => undefined }}
        onClose={() => undefined}
      />,
    );

    expect(markup).toBe("");
  });

  it("renders Explorer as the accessible default tab", () => {
    const markup = renderToStaticMarkup(
      <TerminalFloatingFilePanel
        open
        treeWidth={280}
        explorerContent={<div>Explorer</div>}
        changesContent={<div>Changes</div>}
        editorContent={<div>Editor</div>}
        treeResizeHandleProps={{ onMouseDown: () => undefined }}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("Workspace Files");
    expect(markup).toContain("Explorer");
    expect(markup).toContain("Changes");
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('role="tab"');
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("terminal-file-panel-explorer-panel");
    expect(markup).toContain("terminal-file-panel-changes-panel");
    expect(markup).not.toContain("<div>Changes</div>");
    expect(markup).toContain("Editor");
    expect(markup).toContain("Close files panel");
    expect(markup).toContain("Drag files panel");
    expect(markup).toContain("Resize files panel");
  });

  it("applies the requested layer to the overlay root", () => {
    const markup = renderToStaticMarkup(
      <TerminalFloatingFilePanel
        open
        treeWidth={280}
        explorerContent={<div>Explorer</div>}
        changesContent={<div>Changes</div>}
        editorContent={<div>Editor</div>}
        treeResizeHandleProps={{ onMouseDown: () => undefined }}
        zIndex={TERMINAL_FLOATING_PANEL_FRONT_Z_INDEX}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain('style="z-index:25"');
  });

  it("bounds each tab panel for scrollable active content", async () => {
    await renderPanel(true);

    for (const panel of document.querySelectorAll('[role="tabpanel"]')) {
      expect(panel.classList.contains("flex")).toBe(true);
      expect(panel.classList.contains("flex-col")).toBe(true);
      expect(panel.classList.contains("min-h-0")).toBe(true);
      expect(panel.classList.contains("overflow-hidden")).toBe(true);
    }
  });

  it("activates from descendant pointer and focus interactions", async () => {
    const onActivate = vi.fn();
    await renderPanel(true, { onActivate });

    const explorer = document.querySelector('[data-content="explorer"]');
    expect(explorer).not.toBeNull();
    await act(async () => {
      explorer?.dispatchEvent(
        new Event("pointerdown", { bubbles: true }),
      );
    });
    expect(onActivate).toHaveBeenCalledOnce();

    const editorRegion = document.querySelector<HTMLElement>(
      '[data-testid="terminal-floating-file-panel"] [tabindex="-1"]',
    );
    expect(editorRegion).not.toBeNull();
    await act(async () => editorRegion?.focus());
    expect(onActivate).toHaveBeenCalledTimes(2);
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

  it("moves between tabs with arrow, Home, and End keys", () => {
    expect(
      getTerminalFloatingFilePanelTabForKey("explorer", "ArrowRight"),
    ).toBe("changes");
    expect(getTerminalFloatingFilePanelTabForKey("explorer", "ArrowLeft")).toBe(
      "changes",
    );
    expect(getTerminalFloatingFilePanelTabForKey("changes", "Home")).toBe(
      "explorer",
    );
    expect(getTerminalFloatingFilePanelTabForKey("explorer", "End")).toBe(
      "changes",
    );
    expect(
      getTerminalFloatingFilePanelTabForKey("explorer", "Enter"),
    ).toBeNull();
  });

  it("activates tabs by click and keyboard while moving focus", async () => {
    await renderPanel(true);
    const explorerTab = await clickTab("terminal-file-panel-explorer-tab");
    await pressTabKey(explorerTab, "ArrowRight");

    const changesTab = document.getElementById(
      "terminal-file-panel-changes-tab",
    ) as HTMLButtonElement;
    expect(changesTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(changesTab);
    expect(document.querySelector('[data-content="changes"]')).not.toBeNull();
    expect(document.querySelector('[data-content="explorer"]')).toBeNull();

    await pressTabKey(changesTab, "Home");
    expect(explorerTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(explorerTab);
  });

  it("resets to Explorer after closing and reopening", async () => {
    await renderPanel(true);
    await clickTab("terminal-file-panel-changes-tab");
    await renderPanel(false);
    await renderPanel(true);

    expect(
      document
        .getElementById("terminal-file-panel-explorer-tab")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(document.querySelector('[data-content="explorer"]')).not.toBeNull();
  });

  it("keeps every tab's ARIA panel target mounted", async () => {
    await renderPanel(true);

    for (const tab of document.querySelectorAll('[role="tab"]')) {
      const panelId = tab.getAttribute("aria-controls");
      expect(panelId).not.toBeNull();
      expect(document.getElementById(panelId!)).not.toBeNull();
    }

    expect(
      document
        .getElementById("terminal-file-panel-changes-panel")
        ?.hasAttribute("hidden"),
    ).toBe(true);
  });
});
