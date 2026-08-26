// @vitest-environment jsdom

import { act, Profiler, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  markTerminalOutput,
  setTerminalStreamReady,
} from "@/lib/terminal-output-activity.js";
import type {
  RuntimeSessionItem,
  RuntimeTreeItem,
} from "@/lib/terminal-runtime-tree.js";
import { TerminalRuntimeNavigatorItem } from "./TerminalRuntimeNavigatorItem.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type ItemProps = ComponentProps<typeof TerminalRuntimeNavigatorItem>;

let container: HTMLDivElement;
let root: Root;

function createSession(sessionId = "web"): RuntimeSessionItem {
  return {
    kind: "session",
    id: `session:${sessionId}`,
    groupId: "web",
    sessionId,
    label: `${sessionId}:bash`,
    project: "web",
    command: "bash",
    startedAt: 1,
    ports: [],
  };
}

function defaultProps(item: RuntimeTreeItem): ItemProps {
  return {
    activeSessionId: null,
    dragState: null,
    item,
    onMoveItem: () => {},
    onSetDragState: () => {},
    onStartTunnel: async () => {},
    onStopTunnel: async () => {},
  };
}

function renderItem(
  item: RuntimeTreeItem,
  overrides: Partial<ItemProps> = {},
): void {
  act(() =>
    root.render(
      <TerminalRuntimeNavigatorItem {...defaultProps(item)} {...overrides} />,
    ),
  );
}

function renderElement(element: ReactElement): void {
  act(() => root.render(element));
}

function getStatus(sessionId?: string): HTMLElement {
  const statuses = Array.from(
    container.querySelectorAll<HTMLElement>("span[title]"),
  );
  if (!sessionId) {
    expect(statuses).toHaveLength(1);
    return statuses[0]!;
  }
  const sessionLabel = container.querySelector(`button[title="${sessionId}"]`);
  expect(sessionLabel).not.toBeNull();
  const status = sessionLabel?.querySelector<HTMLElement>("span[title]");
  expect(status).not.toBeNull();
  return status!;
}

function expectStatus(
  status: HTMLElement,
  label: string,
  title: string,
  classFragment: string,
): void {
  const selectionButton = status.closest("button");
  expect(status.getAttribute("aria-hidden")).toBe("true");
  expect(status.getAttribute("aria-label")).toBeNull();
  expect(status.getAttribute("title")).toBe(title);
  expect(status.className).toContain(classFragment);
  expect(selectionButton?.querySelector(".sr-only")?.textContent).toBe(label);
  expect(selectionButton?.textContent).toContain(label);
  expect(container.textContent).toContain(label);
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("TerminalRuntimeNavigatorItem", () => {
  it.each([
    {
      name: "stopped",
      session: { alive: false },
      ready: true,
      recent: true,
      label: "Stopped",
      title: "Terminal stopped",
      classFragment: "color-danger",
    },
    {
      name: "stream unavailable",
      session: {},
      ready: false,
      recent: false,
      label: "Output unavailable",
      title: "Output stream unavailable",
      classFragment: "color-text-muted",
    },
    {
      name: "recent output",
      session: {},
      ready: true,
      recent: true,
      label: "Receiving output",
      title: "Receiving output",
      classFragment: "color-success",
    },
    {
      name: "quiet",
      session: {},
      ready: true,
      recent: false,
      label: "Quiet",
      title: "Quiet; no recent output observed",
      classFragment: "color-warning",
    },
  ])(
    "renders the $name state",
    ({ session, ready, recent, label, title, classFragment }) => {
      const sessionId = `state-${label.toLowerCase().replaceAll(" ", "-")}`;
      if (ready) setTerminalStreamReady(sessionId, true);
      if (recent) markTerminalOutput(sessionId);

      renderItem({ ...createSession(sessionId), ...session });

      expectStatus(getStatus(), label, title, classFragment);
    },
  );

  it("applies stopped before recent output", () => {
    setTerminalStreamReady("precedence", true);
    markTerminalOutput("precedence");

    renderItem({ ...createSession("precedence"), alive: false });

    expectStatus(getStatus(), "Stopped", "Terminal stopped", "color-danger");
  });

  it("moves a recent row back to unavailable when its stream disconnects", () => {
    const sessionId = "stream-reset";
    setTerminalStreamReady(sessionId, true);
    markTerminalOutput(sessionId);

    renderItem(createSession(sessionId));
    expectStatus(
      getStatus(),
      "Receiving output",
      "Receiving output",
      "color-success",
    );

    act(() => setTerminalStreamReady(sessionId, false));

    expectStatus(
      getStatus(),
      "Output unavailable",
      "Output stream unavailable",
      "color-text-muted",
    );
  });

  it("updates only the leaf with the matching session ID", () => {
    setTerminalStreamReady("first", true);
    setTerminalStreamReady("second", true);
    renderItem({
      kind: "service-group",
      id: "services:web",
      groupId: "web",
      label: "Running ports",
      startedAt: 1,
      sessions: [createSession("first"), createSession("second")],
    });

    act(() => markTerminalOutput("first"));

    expect(getStatus("first").getAttribute("title")).toBe("Receiving output");
    expect(getStatus("second").getAttribute("title")).toBe(
      "Quiet; no recent output observed",
    );
  });

  it("does not rerender another leaf or repeat recent transition renders", () => {
    setTerminalStreamReady("first", true);
    setTerminalStreamReady("second", true);
    const renders = { first: 0, second: 0 };

    renderElement(
      <>
        <Profiler id="first" onRender={() => renders.first++}>
          <TerminalRuntimeNavigatorItem
            {...defaultProps(createSession("first"))}
          />
        </Profiler>
        <Profiler id="second" onRender={() => renders.second++}>
          <TerminalRuntimeNavigatorItem
            {...defaultProps(createSession("second"))}
          />
        </Profiler>
      </>,
    );
    const initialRenders = { ...renders };

    act(() => markTerminalOutput("first"));
    expect(renders.first).toBe(initialRenders.first + 1);
    expect(renders.second).toBe(initialRenders.second);

    act(() => markTerminalOutput("first"));
    expect(renders.first).toBe(initialRenders.first + 1);
    expect(renders.second).toBe(initialRenders.second);
  });

  it("routes the close button to the existing close flow", () => {
    const onCloseSession = vi.fn();
    renderItem(createSession(), { activeSessionId: "web", onCloseSession });

    container
      .querySelector<HTMLButtonElement>(
        'button[title="Close terminal (terminates process)"]',
      )
      ?.click();

    expect(onCloseSession).toHaveBeenCalledWith("web");
  });

  it("uses a native selection button without making the leaf a nested button", () => {
    const onSelectSession = vi.fn();
    renderItem(createSession(), {
      activeSessionId: "web",
      onSelectSession,
    });
    const selectionButton = container.querySelector<HTMLButtonElement>(
      'button[title="web"]',
    );
    const leaf = selectionButton?.parentElement?.parentElement;

    expect(selectionButton?.getAttribute("aria-current")).toBe("page");
    expect(leaf?.getAttribute("role")).toBeNull();
    expect(leaf?.getAttribute("tabindex")).toBeNull();

    selectionButton?.click();
    expect(onSelectSession).toHaveBeenCalledWith("web");
  });

  it("selects the session when clicking noninteractive row content", () => {
    const onSelectSession = vi.fn();
    renderItem(
      {
        ...createSession(),
        ports: [
          {
            port: 3000,
            project: "web",
            state: "listening",
            sessionId: "web",
            tunnel: undefined,
            tunnelStatus: null,
          },
        ],
      },
      { onSelectSession },
    );

    container.querySelector<HTMLElement>(".font-mono")?.click();
    expect(onSelectSession).toHaveBeenCalledWith("web");
  });

  it("routes pinning and omits close for a pinned Runtime leaf", () => {
    const onToggleTabPin = vi.fn();
    renderItem(
      {
        kind: "service-group",
        id: "services:web",
        groupId: "web",
        label: "Running ports",
        startedAt: 1,
        sessions: [{ ...createSession("worker"), isPinned: true }],
      },
      { activeSessionId: "worker", onToggleTabPin },
    );

    const unpinButton = container.querySelector<HTMLButtonElement>(
      'button[title="Unpin terminal (allows closing)"]',
    );
    expect(unpinButton?.getAttribute("aria-pressed")).toBe("true");
    expect(
      container.querySelector(
        'button[title="Close terminal (terminates process)"]',
      ),
    ).toBeNull();
    unpinButton?.click();
    expect(onToggleTabPin).toHaveBeenCalledWith("worker");
  });

  it("routes a session title context menu to that session", () => {
    const onOpenDiagnosticsMenu = vi.fn();
    renderItem(createSession(), { onOpenDiagnosticsMenu });
    const button = container.querySelector<HTMLButtonElement>(
      'button[title="web"]',
    )!;

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 11,
      clientY: 22,
    });
    const preventDefault = vi.spyOn(event, "preventDefault");
    const stopPropagation = vi.spyOn(event, "stopPropagation");
    button.dispatchEvent(event);

    expect(onOpenDiagnosticsMenu).toHaveBeenCalledWith("web", 11, 22);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it("routes a grouped runtime session title to its own session", () => {
    const onOpenDiagnosticsMenu = vi.fn();
    renderItem(
      {
        kind: "service-group",
        id: "service:web",
        groupId: "web",
        label: "web",
        startedAt: 1,
        sessions: [createSession("worker")],
      },
      { onOpenDiagnosticsMenu },
    );
    const button = container.querySelector<HTMLButtonElement>(
      'button[title="worker"]',
    )!;

    button.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 33,
        clientY: 44,
      }),
    );

    expect(onOpenDiagnosticsMenu).toHaveBeenCalledWith("worker", 33, 44);
  });

  it("routes a ready tunnel chip to the embedded browser without selecting the session", () => {
    const onOpenTunnelInBrowser = vi.fn();
    const tunnel = {
      id: "tunnel-1",
      port: 3000,
      label: "web",
      driver: "cloudflared" as const,
      status: "ready" as const,
      url: "https://demo.trycloudflare.com",
      startedAt: 1,
    };
    renderItem(
      {
        ...createSession(),
        ports: [
          {
            port: 3000,
            project: "web",
            state: "listening",
            sessionId: "web",
            tunnel,
            tunnelStatus: "ready",
            tunnelUrl: tunnel.url,
            tunnelId: tunnel.id,
          },
        ],
      },
      { onOpenTunnelInBrowser },
    );

    container
      .querySelector<HTMLButtonElement>(
        'button[title="Open https://demo.trycloudflare.com in embedded Browser"]',
      )
      ?.click();

    expect(onOpenTunnelInBrowser).toHaveBeenCalledWith(
      tunnel.url,
      expect.objectContaining({ id: tunnel.id, status: "ready" }),
    );
  });
});
