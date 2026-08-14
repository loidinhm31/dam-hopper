// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/api/client.js";
import { SettingsGlobalConfigPanel } from "./SettingsConfigPanels.js";

const semanticSettings = vi.hoisted(() => ({
  data: {
    enabled: false,
    available: false,
    disabledReason:
      "A valid signed semantic bundle is required on this server.",
  },
  isLoading: false,
  isError: false,
}));
const semanticUpdate = vi.hoisted(() => ({
  isPending: false,
  error: null as unknown,
  mutate: vi.fn(),
}));

vi.mock("@/api/queries.js", () => ({
  useSemanticNavigationSettings: () => semanticSettings,
  useUpdateSemanticNavigationSettings: () => semanticUpdate,
}));

describe("SettingsGlobalConfigPanel", () => {
  beforeEach(() => {
    semanticSettings.data = {
      enabled: false,
      available: false,
      disabledReason:
        "A valid signed semantic bundle is required on this server.",
    };
    semanticUpdate.error = null;
  });

  it("shows the server-owned setting before the lazy editor and disables unavailable bundles", () => {
    const markup = renderToStaticMarkup(<SettingsGlobalConfigPanel />);

    expect(markup.indexOf("Semantic navigation")).toBeGreaterThanOrEqual(0);
    expect(markup.indexOf("Semantic navigation")).toBeLessThan(
      markup.indexOf("Loading settings"),
    );
    expect(markup).toContain("A valid signed semantic bundle is required");
    expect(markup).toContain('aria-label="Enable semantic navigation"');
    expect(markup).toContain('disabled=""');
  });

  it("keeps a persisted enabled setting switchable off when the bundle disappears", () => {
    semanticSettings.data = {
      enabled: true,
      available: false,
      disabledReason:
        "A valid signed semantic bundle is required on this server.",
    };

    const markup = renderToStaticMarkup(<SettingsGlobalConfigPanel />);

    expect(markup).toContain('aria-checked="true"');
    expect(markup).toMatch(
      /role="switch" aria-checked="true" aria-label="Enable semantic navigation"(?! disabled)/,
    );
    expect(markup).toContain("A valid signed semantic bundle is required");
  });

  it("keeps a bounded safe conflict reason in mutation status", () => {
    semanticUpdate.error = new ApiRequestError(
      "Conflict: A valid signed semantic bundle is required on this server.",
      409,
    );

    const markup = renderToStaticMarkup(<SettingsGlobalConfigPanel />);

    expect(markup).toContain(
      "Conflict: A valid signed semantic bundle is required on this server.",
    );
  });
});
