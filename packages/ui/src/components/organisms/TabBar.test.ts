import { Children, isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
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

    (labelButton?.props.onContextMenu as (event: {
      clientX: number;
      clientY: number;
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => void)({ clientX: 31, clientY: 47, preventDefault, stopPropagation });

    expect(onOpenDiagnosticsMenu).toHaveBeenCalledWith("bash-2", 31, 47);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
  });
});
