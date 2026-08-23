import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { SplitLayout } from "@/components/organisms/SplitLayout.js";
import type { UseTerminalLayoutResult } from "@/hooks/use-terminal-layout.js";
import type { LayoutNode } from "@/types/terminal-layout.js";
import "@/index.css";
import "@xterm/xterm/css/xterm.css";

// Keep the real SplitLayout and react-resizable-panels tree under test while
// replacing the session-heavy leaf. The xterm instance below still runs in a
// production Panel wrapper, which is the ancestor that previously scrolled.
vi.mock("@/components/organisms/PaneContainer.js", () => ({
  PaneContainer: () => (
    <div
      data-testid="terminal-pane-output-host"
      style={{ width: "100%", height: "100%", position: "relative" }}
    />
  ),
}));

const SPLIT_ROOT: LayoutNode = {
  type: "split",
  id: "split-root",
  direction: "horizontal",
  sizes: [70, 30],
  children: [
    { type: "pane", id: "pane-a", sessionIds: [], activeSessionId: null },
    { type: "pane", id: "pane-b", sessionIds: [], activeSessionId: null },
  ],
};

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function createTerminalBoundary(host: HTMLElement): {
  boundary: HTMLDivElement;
  terminalHost: HTMLDivElement;
} {
  const boundary = document.createElement("div");
  boundary.style.cssText =
    "position:absolute; inset:0; width:100%; height:100%; overflow:hidden;";
  const terminalHost = document.createElement("div");
  terminalHost.style.cssText = "position:relative; width:100%; height:100%;";
  boundary.append(terminalHost);
  host.append(boundary);
  return { boundary, terminalHost };
}

function applyTerminalZoom(
  terminal: Terminal,
  boundary: HTMLElement,
  zoom: number,
): void {
  document.documentElement.style.zoom = `${zoom * 100}%`;
  boundary.style.zoom = String(1 / zoom);
  terminal.options.fontSize = 13 * zoom;
}

describe("terminal zoom through the production split layout in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;
  let terminal: Terminal | undefined;

  beforeEach(() => {
    document.documentElement.style.zoom = "";
    container = document.createElement("div");
    container.style.cssText =
      "width: 600px; height: 240px; position: fixed; left: 0; top: 0; overflow: clip;";
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    terminal?.dispose();
    terminal = undefined;
    await act(async () => root.unmount());
    container.remove();
    document.documentElement.style.zoom = "";
  });

  it("keeps the first terminal cell visible while split wrappers stay non-scrollable", async () => {
    const layout = {
      updateSizes: vi.fn(),
      dockSession: vi.fn(() => true),
    } as unknown as UseTerminalLayoutResult;

    await act(async () => {
      root.render(
        <div style={{ width: "100%", height: "100%", overflow: "clip" }}>
          <SplitLayout
            root={SPLIT_ROOT}
            layout={layout}
            mountedSessions={[]}
            openTabs={[]}
            onNewTerminal={vi.fn()}
            onSessionExit={vi.fn()}
            onSelectTab={vi.fn()}
            onCloseTab={vi.fn()}
            activeSessionId={null}
          />
        </div>,
      );
    });
    await nextFrame();

    const host = container.querySelector<HTMLElement>(
      '[data-testid="terminal-pane-output-host"]',
    );
    expect(host).toBeDefined();

    terminal = new Terminal({ cols: 80, rows: 16, fontSize: 13 });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    const { boundary, terminalHost } = createTerminalBoundary(host!);
    terminal.open(terminalHost);
    await new Promise<void>((resolve) =>
      terminal?.write("TOP-LEFT\r\nsecond row", resolve),
    );

    const group = container.querySelector<HTMLElement>("[data-group]");
    const terminalPanel = container.querySelector<HTMLElement>(
      "[data-panel]#pane-a > div",
    );
    const viewport = host!.querySelector<HTMLElement>(".xterm-viewport");
    expect(group).toBeDefined();
    expect(terminalPanel).toBeDefined();
    expect(viewport).toBeDefined();
    expect(getComputedStyle(group!).overflow).toBe("clip");
    expect(getComputedStyle(terminalPanel!).overflow).toBe("clip");
    expect(["auto", "scroll"]).toContain(getComputedStyle(viewport!).overflowY);

    for (const zoom of [1.1, 0.5, 1.2]) {
      applyTerminalZoom(terminal, boundary, zoom);
      fitAddon.fit();
      terminal.textarea?.focus();
      terminal.textarea?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
      await nextFrame();

      const hostRect = host!.getBoundingClientRect();
      const firstRow = host!.querySelector<HTMLElement>(".xterm-rows > div");
      const firstRowRect = firstRow?.getBoundingClientRect();
      expect(host!.scrollTop).toBe(0);
      expect(host!.scrollLeft).toBe(0);
      expect(group!.scrollTop).toBe(0);
      expect(group!.scrollLeft).toBe(0);
      expect(terminalPanel!.scrollTop).toBe(0);
      expect(terminalPanel!.scrollLeft).toBe(0);
      expect(firstRowRect?.top).toBeCloseTo(hostRect.top, 1);
      expect(firstRowRect?.left).toBeCloseTo(hostRect.left, 1);
      expect(host!.textContent).toContain("TOP-LEFT");
    }
  });

  it("keeps real xterm mouse selection aligned at non-100% zoom", async () => {
    const line = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    terminal = new Terminal({ cols: 80, rows: 4, fontSize: 13 });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    const { boundary, terminalHost } = createTerminalBoundary(container);
    terminal.open(terminalHost);
    await new Promise<void>((resolve) => terminal?.write(line, resolve));

    const screen =
      terminal.element?.querySelector<HTMLElement>(".xterm-screen");
    expect(screen).toBeDefined();

    for (const zoom of [0.5, 0.8, 1, 1.2]) {
      applyTerminalZoom(terminal, boundary, zoom);
      fitAddon.fit();
      await nextFrame();

      const screenRect = screen!.getBoundingClientRect();
      const cellWidth = screenRect.width / terminal.cols;
      const cellHeight = screenRect.height / terminal.rows;
      const startX = screenRect.left + cellWidth * 2.25;
      const endX = screenRect.left + cellWidth * 7.75;
      const y = screenRect.top + cellHeight * 0.5;
      const dispatch = (
        target: EventTarget,
        type: string,
        clientX: number,
        buttons: number,
      ) =>
        target.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            button: 0,
            buttons,
            clientX,
            clientY: y,
            detail: type === "mousedown" ? 1 : 0,
            view: window,
          }),
        );

      terminal.clearSelection();
      dispatch(screen!, "mousedown", startX, 1);
      dispatch(document, "mousemove", endX, 1);
      dispatch(document, "mouseup", endX, 0);

      expect(terminal.getSelection()).toBe("234567");
    }
  });
});
