import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const renderedPanelProps: Array<Record<string, unknown>> = [];

vi.mock("@/components/organisms/TerminalPanel.js", () => ({
  TerminalPanel: (props: Record<string, unknown>) => {
    renderedPanelProps.push(props);
    return null;
  },
}));

import { TerminalKeepAliveHost } from "./TerminalKeepAliveHost.js";

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
});
