// @vitest-environment jsdom
import { Children, createElement, isValidElement, act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { setTerminalStreamReady } from "@/lib/terminal-output-activity.js";
import { DraggableTab, splitActionToPaneDirection } from "./TabBar.js";

vi.mock("@dnd-kit/core", () => ({
  useDndMonitor: () => {},
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    isDragging: false,
  }),
}));

describe("splitActionToPaneDirection", () => {
  it("maps split-right to a horizontal pane split", () => {
    expect(splitActionToPaneDirection("right")).toBe("horizontal");
  });

  it("maps split-down to a vertical pane split", () => {
    expect(splitActionToPaneDirection("down")).toBe("vertical");
  });

  it("opens diagnostics for the right-clicked traditional tab", () => {
    const onOpenDiagnosticsMenu = vi.fn();
    const tree = DraggableTab({
      paneId: "pane-1",
      tab: { sessionId: "bash-2", label: "api:bash" },
      isActive: false,
      onSelect: vi.fn(),
      onClose: vi.fn(),
      onOpenDiagnosticsMenu,
    });
    const labelButton = Children.toArray(tree.props.children).find(
      (child) => isValidElement(child) && child.type === "button",
    );
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    (
      labelButton?.props.onContextMenu as (event: {
        clientX: number;
        clientY: number;
        preventDefault: () => void;
        stopPropagation: () => void;
      }) => void
    )({ clientX: 31, clientY: 47, preventDefault, stopPropagation });

    expect(onOpenDiagnosticsMenu).toHaveBeenCalledWith("bash-2", 31, 47);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it("routes pinning and omits close for a pinned traditional tab", () => {
    const onTogglePin = vi.fn();
    const onClose = vi.fn();
    const unpinned = DraggableTab({
      paneId: "pane-1",
      tab: { sessionId: "bash-2", label: "api:bash" },
      isActive: false,
      onSelect: vi.fn(),
      onTogglePin,
      onClose,
    });
    const children = Children.toArray(unpinned.props.children);
    const pinButton = children.find(
      (child) =>
        isValidElement(child) && child.props["aria-label"] === "Pin terminal",
    );
    const closeButton = children.find(
      (child) =>
        isValidElement(child) && child.props["aria-label"] === "Close terminal",
    );

    expect(pinButton).not.toBeUndefined();
    expect(closeButton).not.toBeUndefined();
    expect(pinButton?.props["aria-pressed"]).toBe(false);
    pinButton?.props.onClick({ stopPropagation: vi.fn() });
    expect(onTogglePin).toHaveBeenCalledWith("bash-2");

    const pinned = DraggableTab({
      paneId: "pane-1",
      tab: { sessionId: "bash-2", label: "api:bash", isPinned: true },
      isActive: false,
      onSelect: vi.fn(),
      onTogglePin,
      onClose,
    });
    const pinnedChildren = Children.toArray(pinned.props.children);
    const unpinButton = pinnedChildren.find(
      (child) =>
        isValidElement(child) && child.props["aria-label"] === "Unpin terminal",
    );

    expect(unpinButton?.props["aria-pressed"]).toBe(true);
    expect(
      pinnedChildren.find(
        (child) =>
          isValidElement(child) &&
          child.props["aria-label"] === "Close terminal",
      ),
    ).toBeUndefined();
  });
  it("renders the shared terminal activity state in a Traditional tab", () => {
    const sessionId = "traditional-status";
    setTerminalStreamReady(sessionId, false);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        createElement(DraggableTab, {
          paneId: "pane-1",
          tab: {
            sessionId,
            label: "api:bash",
            title: {
              baseLabel: "api:bash",
              ordinal: 1,
              fullText: "api:bash #1",
            },
            session: {
              id: sessionId,
              project: "api",
              command: "bash",
              cwd: "/repo/api",
              type: "custom",
              alive: true,
              startedAt: 1,
            },
          },
          isActive: true,
          onSelect: vi.fn(),
          onClose: vi.fn(),
        }),
      );
    });

    const status = container.querySelector<HTMLElement>(
      'span[title="Output stream unavailable"]',
    );
    expect(status).not.toBeNull();
    expect(status?.className).toContain("color-text-muted");
    expect(status?.parentElement?.querySelector(".sr-only")?.textContent).toBe(
      "Output unavailable",
    );

    act(() => root.unmount());
    container.remove();
  });
});
