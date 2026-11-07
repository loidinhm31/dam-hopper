// @vitest-environment jsdom

import { act, useEffect } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTerminalOutputActivitySnapshot,
  registerTerminalOutputActivity,
  type TerminalOutputActivityRegistration,
} from "@/lib/terminal-output-activity.js";

const renderedPanelProps: Array<Record<string, unknown>> = [];
const activityRegistrations = new Map<
  string,
  TerminalOutputActivityRegistration
>();
const mockZoom = vi.hoisted(() => ({ level: 100 }));

vi.mock("@/components/organisms/TerminalPanel.js", () => ({
  TerminalPanel: (props: Record<string, unknown>) => {
    renderedPanelProps.push(props);
    useEffect(() => {
      const sessionId = String(props.sessionId);
      const registration = registerTerminalOutputActivity(sessionId);
      registration.setStreamReady(true);
      activityRegistrations.set(sessionId, registration);

      return () => {
        registration.dispose();
        activityRegistrations.delete(sessionId);
      };
    }, [props.sessionId]);
    return null;
  },
}));


vi.mock("@/contexts/AppZoomContext.js", () => ({
  useAppZoom: () => ({ level: mockZoom.level }),
}));

import { TerminalKeepAliveHost } from "./TerminalKeepAliveHost.js";

let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  renderedPanelProps.length = 0;
  activityRegistrations.clear();
  mockZoom.level = 100;
  delete document.documentElement.dataset.appHost;
  delete document.documentElement.dataset.appPlatform;
});

describe("TerminalKeepAliveHost", () => {

  it("passes the current 1-based open-tab order to each terminal", () => {
    renderedPanelProps.length = 0;

    renderToStaticMarkup(
      <TerminalKeepAliveHost
        mountedSessions={[
          { sessionId: "a", project: "web", command: "bash" },
          { sessionId: "b", project: "api", command: "bash" },
        ]}
        openTabs={[
          { sessionId: "b", label: "api" },
          { sessionId: "a", label: "web" },
        ]}
      />,
    );

    expect(renderedPanelProps).toEqual([
      expect.objectContaining({ sessionId: "a", terminalOrder: 2 }),
      expect.objectContaining({ sessionId: "b", terminalOrder: 1 }),
    ]);
  });

  it("passes cwd and worktree metadata to recovery panels", () => {
    renderedPanelProps.length = 0;

    renderToStaticMarkup(
      <TerminalKeepAliveHost
        mountedSessions={[
          {
            sessionId: "targeted",
            project: "demo",
            command: "pnpm dev",
            cwd: "/worktrees/demo-feature/src",
            worktreePath: "/worktrees/demo-feature",
          },
        ]}
      />,
    );

    expect(renderedPanelProps[0]).toEqual(
      expect.objectContaining({
        sessionId: "targeted",
        cwd: "/worktrees/demo-feature/src",
        worktreePath: "/worktrees/demo-feature",
      }),
    );
  });

  it("does not invent an order when supplied tabs omit a mounted session", () => {
    renderedPanelProps.length = 0;

    renderToStaticMarkup(
      <TerminalKeepAliveHost
        mountedSessions={[
          { sessionId: "pending", project: "web", command: "bash" },
        ]}
        openTabs={[]}
      />,
    );

    expect(renderedPanelProps[0]).toEqual(
      expect.objectContaining({
        sessionId: "pending",
        terminalOrder: undefined,
      }),
    );
  });

  it("enables WebGL only for sessions active in visible panes", () => {
    renderedPanelProps.length = 0;

    renderToStaticMarkup(
      <TerminalKeepAliveHost
        mountedSessions={[
          { sessionId: "visible-left", project: "web", command: "bash" },
          { sessionId: "hidden-tab", project: "web", command: "bash" },
          { sessionId: "visible-right", project: "api", command: "bash" },
        ]}
        webglEnabledSessionIds={new Set(["visible-left", "visible-right"])}
      />,
    );

    expect(renderedPanelProps).toEqual([
      expect.objectContaining({
        sessionId: "visible-left",
        webglEnabled: true,
      }),
      expect.objectContaining({ sessionId: "hidden-tab", webglEnabled: false }),
      expect.objectContaining({
        sessionId: "visible-right",
        webglEnabled: true,
      }),
    ]);
  });


  it("disables WebGL whenever app zoom is not 100%", () => {
    for (const level of [50, 80, 120]) {
      renderedPanelProps.length = 0;
      mockZoom.level = level;

      renderToStaticMarkup(
        <TerminalKeepAliveHost
          mountedSessions={[
            { sessionId: "zoomed", project: "web", command: "bash" },
          ]}
          webglEnabledSessionIds={new Set(["zoomed"])}
        />,
      );

      expect(renderedPanelProps[0]).toEqual(
        expect.objectContaining({ sessionId: "zoomed", webglEnabled: false }),
      );
    }
  });

  it("keeps hidden sessions isolated and disposes removed panels", () => {
    const host = (
      <TerminalKeepAliveHost
        mountedSessions={[
          { sessionId: "hidden-a", project: "web", command: "bash" },
          { sessionId: "hidden-b", project: "api", command: "bash" },
        ]}
      />
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(host));

    expect(activityRegistrations).toHaveProperty("size", 2);
    activityRegistrations.get("hidden-a")?.markOutput();
    expect(getTerminalOutputActivitySnapshot("hidden-a")).toEqual({
      recentOutput: true,
      streamReady: true,
    });
    expect(getTerminalOutputActivitySnapshot("hidden-b")).toEqual({
      recentOutput: false,
      streamReady: true,
    });

    act(() =>
      root?.render(
        <TerminalKeepAliveHost
          mountedSessions={[
            { sessionId: "hidden-b", project: "api", command: "bash" },
          ]}
        />,
      ),
    );

    expect(getTerminalOutputActivitySnapshot("hidden-a")).toEqual({
      recentOutput: false,
      streamReady: false,
    });
    expect(activityRegistrations).toHaveProperty("size", 1);

    act(() => root?.unmount());
    root = null;
    container.remove();

    expect(getTerminalOutputActivitySnapshot("hidden-b")).toEqual({
      recentOutput: false,
      streamReady: false,
    });
  });

  it("propagates exact TerminalTarget and attachPolicy to TerminalPanel", () => {
    renderedPanelProps.length = 0;
    const target = {
      profileId: "prof-1",
      generation: 2,
      serverEpoch: "c18f1f50-3bf0-4566-b333-e18e8df52ea2",
      terminalId: "term-exact-1",
      incarnation: "18446744073709551615",
    };

    renderToStaticMarkup(
      <TerminalKeepAliveHost
        mountedSessions={[
          {
            sessionId: "term-exact-1",
            project: "web",
            command: "bash",
            profileId: "prof-1",
            terminalTarget: target,
            attachPolicy: "existing-only",
          },
        ]}
      />,
    );

    expect(renderedPanelProps).toContainEqual(
      expect.objectContaining({
        sessionId: "term-exact-1",
        terminalTarget: target,
        attachPolicy: "existing-only",
      }),
    );
  });

  it("maintains stable panel instance across target adoption (ZERO remount/dispose)", () => {
    renderedPanelProps.length = 0;
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const initialSession = {
      sessionId: "term-1",
      project: "web",
      command: "bash",
      profileId: "prof-1",
      terminalRef: { profileId: "prof-1", id: "term-1" },
    };

    act(() => {
      root?.render(
        <TerminalKeepAliveHost mountedSessions={[initialSession]} />,
      );
    });

    const initialRegistration = activityRegistrations.get("term-1");
    expect(initialRegistration).toBeDefined();

    const target = {
      profileId: "prof-1",
      generation: 2,
      serverEpoch: "c18f1f50-3bf0-4566-b333-e18e8df52ea2",
      terminalId: "term-1",
      incarnation: "42",
    };

    // Re-render with target adopted (such as after Move beside)
    act(() => {
      root?.render(
        <TerminalKeepAliveHost
          mountedSessions={[
            {
              ...initialSession,
              terminalTarget: target,
              attachPolicy: "existing-only",
            },
          ]}
        />,
      );
    });

    // Activity registration must NOT have been disposed / recreated!
    expect(activityRegistrations.get("term-1")).toBe(initialRegistration);
    container.remove();
  });
});
