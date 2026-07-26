import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TerminalRuntimeOutput } from "./TerminalRuntimeOutput.js";

vi.mock("@/components/organisms/TerminalKeepAliveHost.js", () => ({
  TerminalKeepAliveHost: () => null,
}));
vi.mock("@/components/organisms/TerminalScrollButtons.js", () => ({
  TerminalScrollButtons: ({ className }: { className?: string }) => (
    <div data-testid="terminal-scroll-buttons" data-class-name={className} />
  ),
}));
vi.mock("@/hooks/use-compact-workspace.js", () => ({
  useCompactWorkspace: () => true,
}));
vi.mock("@/hooks/use-coarse-pointer.js", () => ({
  useCoarsePointer: () => true,
}));
vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: () => ({
    mobileCustomKeyboardEnabled: true,
    terminalScrollButtonsEnabled: true,
  }),
}));

describe("TerminalRuntimeOutput", () => {
  it("keeps the scroll control above the compact mobile accessory bar", () => {
    const markup = renderToStaticMarkup(
      <TerminalRuntimeOutput
        activeSessionId="session-1"
        mountedSessions={[
          { sessionId: "session-1", project: "demo", command: "shell" },
        ]}
        renderTerminals={false}
      />,
    );

    expect(markup).toContain('data-testid="terminal-scroll-buttons"');
    expect(markup).toContain('data-class-name="bottom-2"');
  });
});
