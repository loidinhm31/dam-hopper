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
const mockPolicy = vi.hoisted(() => ({ enabled: false }));

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

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
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
  mockPolicy.enabled = false;
});

describe("TerminalKeepAliveHost", () => {
  it("overrides an explicit native-input opt-out when Android policy is active", () => {
    renderedPanelProps.length = 0;
    mockPolicy.enabled = true;

    renderToStaticMarkup(
      <TerminalKeepAliveHost
        mountedSessions={[
          { sessionId: "android", project: "web", command: "bash" },
        ]}
        suppressAutoFocus
        suppressNativeKeyboard={false}
      />,
    );

    expect(renderedPanelProps[0]).toEqual(
      expect.objectContaining({
        suppressAutoFocus: true,
        suppressNativeKeyboard: true,
      }),
    );
    mockPolicy.enabled = false;
  });

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
});
