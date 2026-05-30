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
});
