import { Children, isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { TerminalRuntimeNavigatorItem } from "./TerminalRuntimeNavigatorItem.js";
import type { RuntimeSessionItem } from "@/lib/terminal-runtime-tree.js";

function createSession(): RuntimeSessionItem {
  return {
    kind: "session",
    id: "session:web",
    groupId: "web",
    sessionId: "web",
    label: "web:bash",
    project: "web",
    command: "bash",
    startedAt: 1,
    ports: [],
  };
}

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

function findElementByClassFragment(
  node: unknown,
  classFragment: string,
): Record<string, unknown> | null {
  if (!isValidElement(node)) return null;
  if (typeof node.type === "function") {
    return findElementByClassFragment(node.type(node.props), classFragment);
  }
  const className = (node.props as { className?: unknown }).className;
  if (typeof className === "string" && className.includes(classFragment)) {
    return node.props as Record<string, unknown>;
  }
  for (const child of Children.toArray(
    (node.props as { children?: unknown }).children,
  )) {
    const match = findElementByClassFragment(child, classFragment);
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

  it("uses a native selection button without making the leaf a nested button", () => {
    const onSelectSession = vi.fn();
    const tree = TerminalRuntimeNavigatorItem({
      activeSessionId: "web",
      dragState: null,
      item: createSession(),
      onSelectSession,
      onMoveItem: () => {},
      onSetDragState: () => {},
      onStartTunnel: async () => {},
      onStopTunnel: async () => {},
    });
    const selectionProps = findElementByTitle(tree, "web");
    const leafProps = findElementByClassFragment(
      tree,
      "rounded-sm px-1.5 py-1 outline-none",
    );

    expect(selectionProps).toMatchObject({
      type: "button",
      "aria-current": "page",
    });
    expect(selectionProps?.onKeyDown).toBeUndefined();
    expect(leafProps?.role).toBeUndefined();
    expect(leafProps?.tabIndex).toBeUndefined();

    (selectionProps?.onClick as (event: { stopPropagation: () => void }) => void)?.({
      stopPropagation: vi.fn(),
    });
    expect(onSelectSession).toHaveBeenCalledWith("web");
  });

  it("selects the session when clicking noninteractive row content", () => {
    const onSelectSession = vi.fn();
    const tree = TerminalRuntimeNavigatorItem({
      activeSessionId: null,
      dragState: null,
      item: {
        ...createSession(),
        ports: [
          {
            port: 3000,
            project: "web",
            state: "listening",
            sessionId: "web",
          },
        ],
      },
      onSelectSession,
      onMoveItem: () => {},
      onSetDragState: () => {},
      onStartTunnel: async () => {},
      onStopTunnel: async () => {},
    });
    const leafProps = findElementByClassFragment(
      tree,
      "rounded-sm px-1.5 py-1 outline-none",
    );

    expect(leafProps?.role).toBeUndefined();
    (leafProps?.onClick as () => void)?.();

    expect(onSelectSession).toHaveBeenCalledWith("web");
  });

  it("routes pinning and omits close for a pinned Runtime leaf", () => {
    const onToggleTabPin = vi.fn();
    const tree = TerminalRuntimeNavigatorItem({
      activeSessionId: "worker",
      dragState: null,
      item: {
        kind: "service-group",
        id: "services:web",
        groupId: "web",
        label: "Running ports",
        startedAt: 1,
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
            isPinned: true,
          },
        ],
      },
      onToggleTabPin,
      onMoveItem: () => {},
      onSetDragState: () => {},
      onStartTunnel: async () => {},
      onStopTunnel: async () => {},
    });
    const unpinProps = findElementByTitle(
      tree,
      "Unpin terminal (allows closing)",
    );

    expect(unpinProps).not.toBeNull();
    expect(unpinProps?.["aria-pressed"]).toBe(true);
    expect(
      findElementByTitle(tree, "Close terminal (terminates process)"),
    ).toBeNull();
    (unpinProps?.onClick as (event: { stopPropagation: () => void }) => void)?.({
      stopPropagation: vi.fn(),
    });
    expect(onToggleTabPin).toHaveBeenCalledWith("worker");
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
    const labelProps = findElementByTitle(tree, "web");
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
    const labelProps = findElementByTitle(tree, "worker");

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

  it("routes a ready tunnel chip to the embedded browser without selecting the session", () => {
    const onOpenTunnelInBrowser = vi.fn();
    const stopPropagation = vi.fn();
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
        ports: [
          {
            port: 3000,
            project: "web",
            state: "listening",
            sessionId: "web",
            tunnel: {
              id: "tunnel-1",
              port: 3000,
              label: "web",
              driver: "cloudflared",
              status: "ready",
              url: "https://demo.trycloudflare.com",
              startedAt: 1,
            },
            tunnelStatus: "ready",
            tunnelUrl: "https://demo.trycloudflare.com",
            tunnelId: "tunnel-1",
          },
        ],
      },
      onOpenTunnelInBrowser,
      onMoveItem: () => {},
      onSetDragState: () => {},
      onStartTunnel: async () => {},
      onStopTunnel: async () => {},
    });
    const openProps = findElementByTitle(
      tree,
      "Open https://demo.trycloudflare.com in embedded Browser",
    );

    expect(openProps).not.toBeNull();
    (openProps?.onClick as (event: { stopPropagation: () => void }) => void)?.({
      stopPropagation,
    });

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(onOpenTunnelInBrowser).toHaveBeenCalledWith(
      "https://demo.trycloudflare.com",
      expect.objectContaining({
        id: "tunnel-1",
        status: "ready",
      }),
    );

    const keydownStopPropagation = vi.fn();
    (openProps?.onKeyDown as (event: { stopPropagation: () => void }) => void)?.({
      stopPropagation: keydownStopPropagation,
    });

    expect(keydownStopPropagation).toHaveBeenCalledOnce();
  });
});
