import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const renderedPanelProps: Array<Record<string, unknown>> = [];
const mockPolicy = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/components/organisms/TerminalPanel.js", () => ({
  TerminalPanel: (props: Record<string, unknown>) => {
    renderedPanelProps.push(props);
    return null;
  },
}));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

import { TerminalKeepAliveHost } from "./TerminalKeepAliveHost.js";

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
});
