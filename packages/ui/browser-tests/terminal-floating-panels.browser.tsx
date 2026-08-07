import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalWorkspaceShell } from "@/components/templates/TerminalWorkspaceShell.js";
import { TerminalFloatingFilePanel } from "@/components/organisms/TerminalFloatingFilePanel.js";
import {
  TERMINAL_FILE_PANEL_HEIGHT_KEY,
  TERMINAL_FILE_PANEL_LEFT_KEY,
  TERMINAL_FILE_PANEL_TOP_KEY,
  TERMINAL_FILE_PANEL_WIDTH_KEY,
} from "@/lib/terminal-floating-file-panel-state.js";
import type { TerminalWorkspacePanelRequest } from "@/lib/terminal-workspace-panel.js";
import "@/index.css";

vi.mock("@/components/organisms/TopNav.js", () => ({
  TopNav: () => <header data-testid="mock-top-nav" />,
}));

const FILE_LAYOUT_KEYS = [
  TERMINAL_FILE_PANEL_HEIGHT_KEY,
  TERMINAL_FILE_PANEL_LEFT_KEY,
  TERMINAL_FILE_PANEL_TOP_KEY,
  TERMINAL_FILE_PANEL_WIDTH_KEY,
];

function FloatingPanelHarness() {
  const [filesOpen, setFilesOpen] = useState(true);
  const [toolRequest, setToolRequest] = useState<TerminalWorkspacePanelRequest>(
    {
      nonce: 1,
      targetId: "git",
    },
  );
  const requestNonce = useRef(1);

  const requestTool = (targetId: TerminalWorkspacePanelRequest["targetId"]) => {
    requestNonce.current += 1;
    setToolRequest({ nonce: requestNonce.current, targetId });
  };

  return (
    <>
      <div data-testid="harness-controls">
        <button
          type="button"
          data-testid="toggle-files"
          onClick={() => setFilesOpen((open) => !open)}
        >
          Toggle files
        </button>
        <button
          type="button"
          data-testid="open-tool"
          onClick={() => requestTool("git")}
        >
          Open tool
        </button>
        <button
          type="button"
          data-testid="switch-ports"
          onClick={() => requestTool("ports")}
        >
          Switch Ports
        </button>
        <button
          type="button"
          data-testid="switch-fleet"
          onClick={() => requestTool("terminals")}
        >
          Switch Fleet
        </button>
      </div>
      <TerminalWorkspaceShell
        terminalContent={
          <div className="h-full" data-testid="terminal-content">
            Terminal
          </div>
        }
        terminalOverlayOpen={filesOpen}
        terminalOverlayContent={({ onActivate, zIndex }) => (
          <TerminalFloatingFilePanel
            open={filesOpen}
            treeWidth={280}
            explorerContent={
              <button type="button" data-testid="file-content">
                Files content
              </button>
            }
            changesContent={<div>Changes content</div>}
            editorContent={<div>Editor content</div>}
            treeResizeHandleProps={{ onMouseDown: () => undefined }}
            onActivate={onActivate}
            zIndex={zIndex}
            onClose={() => setFilesOpen(false)}
          />
        )}
        fleetContent={
          <button type="button" data-testid="fleet-content">
            Fleet content
          </button>
        }
        gitContent={
          <button type="button" data-testid="git-content">
            Git content
          </button>
        }
        portsContent={
          <button type="button" data-testid="ports-content">
            Ports content
          </button>
        }
        activatePanelRequest={toolRequest}
        workspaceMode="terminal"
        onWorkspaceModeChange={() => undefined}
      />
    </>
  );
}

describe("terminal floating panels in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    for (const key of FILE_LAYOUT_KEYS) localStorage.removeItem(key);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<FloatingPanelHarness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    for (const key of FILE_LAYOUT_KEYS) localStorage.removeItem(key);
    document.body.querySelector('[data-testid="global-layer-probe"]')?.remove();
  });

  function panel(testId: string) {
    const element = container.querySelector<HTMLElement>(
      `[data-testid="${testId}"]`,
    );
    expect(element).not.toBeNull();
    return element!;
  }

  function panelRoot(testId: string) {
    return panel(testId).parentElement!;
  }

  function arrangeOverlap() {
    const file = panel(testId("file"));
    const tool = panel(testId("tool"));
    const main = container.querySelector("main")!;
    const width = Math.max(
      240,
      Math.floor(main.getBoundingClientRect().width * 0.62),
    );

    for (const element of [file, tool]) {
      element.style.width = `${width}px`;
      element.style.height = "520px";
      element.style.top = "16px";
    }
    file.style.left = "16px";
    file.style.right = "auto";
    tool.style.left = "auto";
    tool.style.right = "16px";

    const fileRect = file.getBoundingClientRect();
    const toolRect = tool.getBoundingClientRect();
    const overlap = {
      left: Math.max(fileRect.left, toolRect.left),
      top: Math.max(fileRect.top, toolRect.top),
      right: Math.min(fileRect.right, toolRect.right),
      bottom: Math.min(fileRect.bottom, toolRect.bottom),
    };
    expect(overlap.right).toBeGreaterThan(overlap.left);
    expect(overlap.bottom).toBeGreaterThan(overlap.top);
    return { file, tool, overlap };
  }

  function testId(panelName: "file" | "tool") {
    return panelName === "file"
      ? "terminal-floating-file-panel"
      : "terminal-floating-tool-panel";
  }

  function overlapPoint(overlap: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }) {
    return {
      x: (overlap.left + overlap.right) / 2,
      y: Math.min(overlap.bottom - 12, overlap.top + 100),
    };
  }

  it("starts at baseline, activates from content pointer/focus, and hit-tests the active panel", async () => {
    const { file, tool, overlap } = arrangeOverlap();
    expect(getComputedStyle(panelRoot(testId("file"))).zIndex).toBe("20");
    expect(getComputedStyle(panelRoot(testId("tool"))).zIndex).toBe("20");

    const fileContent = panel("file-content");
    await act(async () => {
      fileContent.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(getComputedStyle(panelRoot(testId("file"))).zIndex).toBe("25");
    expect(getComputedStyle(panelRoot(testId("tool"))).zIndex).toBe("20");
    const filePoint = overlapPoint(overlap);
    expect(
      file.contains(document.elementFromPoint(filePoint.x, filePoint.y)),
    ).toBe(true);

    const toolContent = panel("git-content");
    await act(async () => {
      toolContent.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(getComputedStyle(panelRoot(testId("file"))).zIndex).toBe("20");
    expect(getComputedStyle(panelRoot(testId("tool"))).zIndex).toBe("25");
    expect(
      tool.contains(document.elementFromPoint(filePoint.x, filePoint.y)),
    ).toBe(true);

    await act(async () => fileContent.focus());
    expect(getComputedStyle(panelRoot(testId("file"))).zIndex).toBe("25");
    await act(async () => toolContent.focus());
    expect(getComputedStyle(panelRoot(testId("tool"))).zIndex).toBe("25");
  });

  it("retains tool ownership across Git/Ports/Fleet switches and clears on close/reopen", async () => {
    arrangeOverlap();
    const tool = panel(testId("tool"));
    await act(async () => {
      tool
        .querySelector<HTMLElement>("[data-testid=git-content]")
        ?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(getComputedStyle(panelRoot(testId("tool"))).zIndex).toBe("25");

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-testid=switch-ports]")
        ?.click(),
    );
    expect(panel("ports-content").textContent).toContain("Ports");
    expect(getComputedStyle(panelRoot(testId("tool"))).zIndex).toBe("25");

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-testid=switch-fleet]")
        ?.click(),
    );
    expect(panel("fleet-content").textContent).toContain("Fleet");
    expect(getComputedStyle(panelRoot(testId("tool"))).zIndex).toBe("25");

    await act(async () => {
      panel(testId("tool"))
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Close Fleet Terminal panel"]',
        )
        ?.click();
    });
    expect(
      container.querySelector(`[data-testid="${testId("tool")}"]`),
    ).toBeNull();

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-testid=open-tool]")
        ?.click(),
    );
    expect(getComputedStyle(panelRoot(testId("tool"))).zIndex).toBe("20");

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-testid=toggle-files]")
        ?.click(),
    );
    expect(
      container.querySelector(`[data-testid="${testId("file")}"]`),
    ).toBeNull();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-testid=toggle-files]")
        ?.click(),
    );
    expect(getComputedStyle(panelRoot(testId("file"))).zIndex).toBe("20");
  });

  it("keeps a z-index 30 global layer above active panels", async () => {
    const { overlap } = arrangeOverlap();
    const point = overlapPoint(overlap);
    const probe = document.createElement("div");
    probe.dataset.testid = "global-layer-probe";
    Object.assign(probe.style, {
      height: "24px",
      left: `${point.x - 12}px`,
      pointerEvents: "auto",
      position: "fixed",
      top: `${point.y - 12}px`,
      width: "24px",
      zIndex: "30",
    });
    document.body.append(probe);

    await act(async () => panel("file-content").click());
    expect(document.elementFromPoint(point.x, point.y)).toBe(probe);
  });
});
