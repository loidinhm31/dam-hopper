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

function renderPanel(
  overrides: Partial<ComponentProps<typeof BrowserDebugPanel>> = {},
) {
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
    expect(markup).toContain('aria-label="Load address"');
    expect(markup).toContain('aria-label="Go back"');
    expect(markup).toContain('aria-label="Go forward"');
    expect(markup).toContain('aria-label="Reload current page"');
    expect(markup).toContain('data-testid="browser-debug-viewport"');
    expect(markup).toContain("Bridge connected");
    expect(markup).toContain("Browser console");
  });

  it("offers saved addresses through the existing address input", () => {
    const markup = renderPanel({
      addressHistory: ["http://localhost:3000/projects"],
    });

    expect(markup).toContain('list="browser-debug-address-history"');
    expect(markup).toContain('id="browser-debug-address-history"');
    expect(markup).toContain('value="http://localhost:3000/projects"');
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

  it("offers the bundled extension download and setup steps when the bridge is unavailable", () => {
    const markup = renderPanel({
      bridgeStatus: "unsupported",
      extensionPresence: "missing",
      error: "No Browser Debug response from http://localhost:3001.",
      onReloadPage: vi.fn(),
    });

    expect(markup).toContain("Browser Debug extension required");
    expect(markup).toContain("Download extension ZIP");
    expect(markup).toContain(
      'href="./browser-debug-extension/dam-hopper-browser-debug.zip"',
    );
    expect(markup).toContain("chrome://extensions");
    expect(markup).toContain("Load unpacked");
    expect(markup).toContain("Reload DamHopper page");
    expect(markup).toContain(
      "target app does not need any package or code change",
    );
  });

  it("distinguishes a detected extension from a target handshake failure", () => {
    const markup = renderPanel({
      bridgeStatus: "unsupported",
      extensionPresence: "detected",
    });

    expect(markup).toContain("Extension detected in this browser");
    expect(markup).not.toContain("Browser Debug extension required");
  });

  it("does not show extension setup after the bridge is connected", () => {
    const markup = renderPanel({
      bridgeStatus: "ready",
      extensionPresence: "missing",
    });

    expect(markup).toContain("Bridge connected");
    expect(markup).not.toContain("Download extension ZIP");
    expect(markup).not.toContain("Browser Debug extension required");
  });

  it("keeps optional local-only capture and manual-image actions collapsed", () => {
    const markup = renderPanel({
      selection,
      onStartCapture: vi.fn(),
      onManualImage: vi.fn(),
      captureStatus: "denied",
    });

    expect(markup).toContain('aria-label="Optional browser image capture"');
    expect(markup).toContain("Optional screenshot capture");
    expect(markup).not.toContain("<details open");
    expect(markup).toContain("Capture browser tab");
    expect(markup).toContain("Choose PNG or JPEG");
    expect(markup).toContain("Paste image");
    expect(markup).toContain("Screen capture was not granted");
    expect(markup).toContain('accept="image/png,image/jpeg"');
    expect(markup).toContain("nothing is attached or sent from this panel");
  });

  it("renders bounded Browser console entries as text", () => {
    const markup = renderPanel({
      consoleEntries: [
        { id: 1, level: "warn", message: "Slow request <script>" },
      ],
      onClearConsole: vi.fn(),
    });

    expect(markup).toContain(">warn<");
    expect(markup).toContain("Slow request &lt;script&gt;");
    expect(markup).toContain("Clear browser console");
    expect(markup).not.toContain("<script>");
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
