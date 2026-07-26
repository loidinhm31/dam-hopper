import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageSetupStatus } from "@/api/client.js";
import { SettingsUsageInsightsSection } from "./SettingsUsageInsightsSection.js";

const mocks = vi.hoisted(() => ({
  settings: undefined as UsageSetupStatus | undefined,
}));

vi.mock("@/api/queries.js", () => ({
  useConfigureUsageInsights: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useUsageSetupStatus: () => ({
    data: mocks.settings,
    error: null,
    isLoading: false,
  }),
}));

function settings(overrides: Partial<UsageSetupStatus> = {}): UsageSetupStatus {
  return {
    enabled: true,
    paused: false,
    collectorEnabled: true,
    runtime: {
      active: true,
      collector: {
        running: true,
        malformed: 0,
        rejected: 0,
        queued: 0,
        dropped: 0,
        duplicate: 0,
        unverifiedVersion: 0,
        coreSchemaDrift: 0,
        unavailableTokenCoverage: 0,
        lastAcceptedAtUtcMs: null,
      },
      collectorError: null,
    },
    collectorSetup: {
      codexExporter: "notConfigured",
      restartRequired: false,
      serverRestartRequired: false,
    },
    ...overrides,
  };
}

function markup() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SettingsUsageInsightsSection />
    </MemoryRouter>,
  );
}

describe("SettingsUsageInsightsSection", () => {
  beforeEach(() => {
    mocks.settings = settings();
  });

  it("keeps setup output opaque and links advanced controls to Usage", () => {
    const output = markup();
    expect(output).toContain("Manage Codex");
    expect(output).toContain("Usage");
    expect(output).not.toContain("Bearer");
    expect(output).not.toContain("config.toml");
  });

  it("renders an enable action when terminal capture is disabled", () => {
    mocks.settings = settings({ enabled: false });
    const output = markup();
    expect(output).toContain("Enable locally");
  });

  it("shows Codex restart guidance only for managed setup", () => {
    mocks.settings = settings({
      collectorSetup: {
        codexExporter: "managed",
        restartRequired: true,
        serverRestartRequired: false,
      },
    });
    expect(markup()).toContain("Restart or start a new Codex session");
  });
});
