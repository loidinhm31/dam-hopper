import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServerSettingsDialog } from "./ServerSettingsDialog.js";

const mockPolicy = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

describe("ServerSettingsDialog Android Chrome policy", () => {
  beforeEach(() => {
    mockPolicy.enabled = false;
  });

  it("blocks server text fields and text-dependent actions", () => {
    mockPolicy.enabled = true;
    const markup = renderToStaticMarkup(
      createElement(ServerSettingsDialog, {
        open: true,
        profile: null,
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain('placeholder="http://localhost:4800" disabled=""');
    expect(markup).toContain(
      "Unavailable on Android Chrome: text entry is disabled",
    );
    expect(markup).toContain(">Cancel</button>");
  });
});
