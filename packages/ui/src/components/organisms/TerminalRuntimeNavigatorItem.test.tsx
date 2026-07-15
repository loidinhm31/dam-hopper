import { Children, isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { TerminalRuntimeNavigatorItem } from "./TerminalRuntimeNavigatorItem.js";

function findElementByTitle(node: unknown, title: string): Record<string, unknown> | null {
  if (!isValidElement(node)) return null;
  if (typeof node.type === "function") {
    return findElementByTitle(node.type(node.props), title);
  }
  if ((node.props as { title?: string }).title === title) {
    return node.props as Record<string, unknown>;
  }
  for (const child of Children.toArray((node.props as { children?: unknown }).children)) {
    const match = findElementByTitle(child, title);
    if (match) return match;
  }
  return null;
}

function findElementByClass(node: unknown, className: string): Record<string, unknown> | null {
  if (!isValidElement(node)) return null;
  if (typeof node.type === "function") {
    return findElementByClass(node.type(node.props), className);
  }
  if ((node.props as { className?: string }).className === className) {
    return node.props as Record<string, unknown>;
  }
  for (const child of Children.toArray((node.props as { children?: unknown }).children)) {
    const match = findElementByClass(child, className);
    if (match) return match;
  }
  return null;
}

describe("TerminalRuntimeNavigatorItem", () => {
  it("routes the close button to the existing close flow", () => {
    const onCloseSession = vi.fn();
    const tree = TerminalRuntimeNavigatorItem({
      activeSessionId: "web",
      dragState: null,
      item: {
        kind: "session",
        id: "session:web",
        groupId: "web",
        sessionId: "web",
        label: "web:bash",
        project: "web",
        command: "pnpm dev",
        startedAt: 1,
        ports: [],
      },
      onCloseSession,
      onMoveItem: () => {},
      onSetDragState: () => {},
      onStartTunnel: async () => {},
      onStopTunnel: async () => {},
    });
    const closeProps = findElementByTitle(
      tree,
      "Close terminal (terminates process)",
    );

    expect(closeProps).not.toBeNull();
    (closeProps?.onClick as (event: { stopPropagation: () => void }) => void)?.({
      stopPropagation: () => {},
    });

    expect(onCloseSession).toHaveBeenCalledWith("web");
  });

  it("routes a session title context menu to that session", () => {
    const onOpenDiagnosticsMenu = vi.fn();
    const tree = TerminalRuntimeNavigatorItem({
      activeSessionId: "web",
      dragState: null,
      item: {
        kind: "session",
        id: "session:web",
        groupId: "web",
        sessionId: "web",
        label: "web:bash",
        project: "web",
        command: "bash",
        startedAt: 1,
        ports: [],
      },
      onOpenDiagnosticsMenu,
      onMoveItem: () => {},
      onSetDragState: () => {},
      onStartTunnel: async () => {},
      onStopTunnel: async () => {},
    });
    const labelProps = findElementByClass(
      tree,
      "flex min-w-0 flex-1 items-center gap-2 text-left",
    );
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    (labelProps?.onContextMenu as (event: {
      clientX: number;
      clientY: number;
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => void)?.({ clientX: 11, clientY: 22, preventDefault, stopPropagation });

    expect(onOpenDiagnosticsMenu).toHaveBeenCalledWith("web", 11, 22);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it("routes a grouped runtime session title to its own session", () => {
    const onOpenDiagnosticsMenu = vi.fn();
    const tree = TerminalRuntimeNavigatorItem({
      activeSessionId: "web",
      dragState: null,
      item: {
        kind: "service-group",
        id: "service:web",
        groupId: "web",
        label: "web",
        sessions: [
          {
            kind: "session",
            id: "session:worker",
            groupId: "web",
            sessionId: "worker",
            label: "web:worker",
            project: "web",
            command: "worker",
            startedAt: 1,
            ports: [],
          },
        ],
      },
      onOpenDiagnosticsMenu,
      onMoveItem: () => {},
      onSetDragState: () => {},
      onStartTunnel: async () => {},
      onStopTunnel: async () => {},
    });
    const labelProps = findElementByClass(
      tree,
      "flex min-w-0 flex-1 items-center gap-2 text-left",
    );

    (labelProps?.onContextMenu as (event: {
      clientX: number;
      clientY: number;
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => void)({
      clientX: 33,
      clientY: 44,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });

    expect(onOpenDiagnosticsMenu).toHaveBeenCalledWith("worker", 33, 44);
  });
});
