import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BrowserSelectionV1 } from "@dam-hopper/browser-bridge";
import {
  BrowserDebugPanel,
  stopBrowserPickerOnEscape,
} from "./BrowserDebugPanel.js";

const selection: BrowserSelectionV1 = {
  version: 1,
  tag: "button",
  role: "button",
  accessibleName: "Save changes",
  text: "Save <em>changes</em>",
  attributes: { "data-testid": "save" },
  locator: "main > button[data-testid=save]",
  bounds: { x: 12, y: 24, width: 96, height: 36 },
};

function renderPanel(overrides: Partial<ComponentProps<typeof BrowserDebugPanel>> = {}) {
  return renderToStaticMarkup(
    <BrowserDebugPanel
      url="http://localhost:3000"
      bridgeStatus="ready"
      onUrlChange={vi.fn()}
      onNavigate={vi.fn()}
      {...overrides}
    />,
  );
}

describe("BrowserDebugPanel", () => {
  it("renders an accessible URL toolbar and iframe viewport registration point", () => {
    const markup = renderPanel();

    expect(markup).toContain('id="browser-debug-url"');
    expect(markup).toContain('aria-label="Load target URL"');
    expect(markup).toContain('data-testid="browser-debug-viewport"');
    expect(markup).toContain("Bridge connected");
  });

  it("renders selection data as inert text", () => {
    const markup = renderPanel({
      selection: {
        ...selection,
        accessibleName: "Save <img src=x>",
        locator: "main > <script>",
        attributes: { "data-label": "<img src=x>" },
      },
    });

    expect(markup).toContain("Selected button · button");
    expect(markup).toContain("Save &lt;em&gt;changes&lt;/em&gt;");
    expect(markup).toContain("Save &lt;img src=x&gt;");
    expect(markup).toContain("main &gt; &lt;script&gt;");
    expect(markup).not.toContain("<em>changes</em>");
    expect(markup).not.toContain("<img src=x>");
    expect(markup).toContain("data-label=&quot;&lt;img src=x&gt;&quot;");
  });

  it("renders error, picker, close, and maximize controls when provided", () => {
    const markup = renderPanel({
      bridgeStatus: "error",
      error: "Target refused framing",
      onStartPicker: vi.fn(),
      onStopPicker: vi.fn(),
      onToggleMaximize: vi.fn(),
      onClose: vi.fn(),
    });

    expect(markup).toContain("Target refused framing");
    expect(markup).toContain("Maximize browser panel");
    expect(markup).toContain("Close browser panel");
    expect(markup).not.toContain("Select element");
  });

  it("cancels an active picker before Escape reaches its containing panel", () => {
    const onStopPicker = vi.fn();
    const event = {
      key: "Escape",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    expect(stopBrowserPickerOnEscape(event, true, onStopPicker)).toBe(true);
    expect(onStopPicker).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });
});
