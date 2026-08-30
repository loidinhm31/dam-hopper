import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalTabBar } from "./TerminalTabBar.js";

let androidChromeSuppressed = false;

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: androidChromeSuppressed,
  }),
}));

const tabs = [
  {
    sessionId: "session-1",
    label: "bash",
    title: { baseLabel: "bash", ordinal: 1, fullText: "bash #1" },
    isSaveable: true,
  },
];

const baseProps = {
  tabs,
  activeTab: "session-1",
  onSelectTab: () => {},
  onCloseTab: () => {},
  onSaveTab: () => {},
};

describe("TerminalTabBar Android Chrome text actions", () => {
  beforeEach(() => {
    androidChromeSuppressed = false;
  });
  it("renders the full accessible title and keyboard-safe controls", () => {
    const markup = renderToStaticMarkup(<TerminalTabBar {...baseProps} />);
    expect(markup).toContain("bash #1");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("> #1</span>");
    expect(markup).toContain('role="button"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-label="Close terminal"');
  });

  it("keeps profile saving available outside Android Chrome", () => {
    const markup = renderToStaticMarkup(<TerminalTabBar {...baseProps} />);

    expect(markup).toContain('title="Save as profile"');
    expect(markup).not.toContain('title="Saving profiles is unavailable');
  });

  it("disables profile save actions when native text input is suppressed", () => {
    androidChromeSuppressed = true;
    const markup = renderToStaticMarkup(
      <TerminalTabBar
        {...baseProps}
        savePrompt={{ sessionId: "session-1", name: "" }}
      />,
    );

    expect(markup).toContain(
      'title="Saving profiles is unavailable in Android Chrome"',
    );
    expect(markup).toMatch(
      /<button[^>]*disabled=""[^>]*title="Saving profiles is unavailable in Android Chrome"/,
    );
  });
});
