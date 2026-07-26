import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageSetupStatus } from "@/api/client.js";
import { SettingsUsageInsightsSection } from "@/components/organisms/SettingsUsageInsightsSection.js";
import "@/index.css";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(() => true),
  configure: vi.fn(() => Promise.resolve()),
  pending: false,
  settings: undefined as UsageSetupStatus | undefined,
}));

vi.stubGlobal("confirm", mocks.confirm);

vi.mock("@/api/queries.js", () => ({
  useConfigureUsageInsights: () => ({
    isPending: mocks.pending,
    mutateAsync: mocks.configure,
  }),
  useUsageSetupStatus: () => ({
    data: mocks.settings,
    error: null,
    isLoading: false,
  }),
}));

vi.mock("@/components/pages/settings-page/SettingsActionRow.js", () => ({
  SettingsActionRow: ({
    title,
    description,
    status,
    action,
  }: {
    title: string;
    description: ReactNode;
    status?: ReactNode;
    action: ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      <p>{description}</p>
      {status}
      {action}
    </section>
  ),
}));

function makeSettings(
  overrides: Partial<UsageSetupStatus> = {},
): UsageSetupStatus {
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

describe("Settings usage insights in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.confirm.mockReset();
    mocks.confirm.mockReturnValue(true);
    mocks.configure.mockReset();
    mocks.configure.mockResolvedValue(undefined);
    mocks.pending = false;
    mocks.settings = makeSettings();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render() {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <SettingsUsageInsightsSection />
        </MemoryRouter>,
      ),
    );
  }

  function button(name: string) {
    const result = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes(name),
    );
    expect(result).toBeTruthy();
    return result as HTMLButtonElement;
  }

  it("enables terminal capture and confirms Codex management without exposing secrets", async () => {
    mocks.settings = makeSettings({
      collectorSetup: {
        codexExporter: "notConfigured",
        restartRequired: false,
        serverRestartRequired: false,
      },
    });
    await render();

    const manage = button("Manage Codex");
    manage.focus();
    expect(document.activeElement).toBe(manage);
    await act(async () => manage.click());
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.configure).toHaveBeenCalledWith({ codexExporter: true });
    expect(container.textContent).not.toContain("Bearer");
    expect(container.textContent).not.toContain("127.0.0.1");
  });

  it("disables active terminal capture through the live setup action", async () => {
    await render();
    await act(async () => button("Disable").click());
    expect(mocks.configure).toHaveBeenCalledWith({ enabled: false });
  });

  it("shows a recoverable disabled and receiver-unavailable state", async () => {
    mocks.settings = makeSettings({
      enabled: false,
      runtime: { ...makeSettings().runtime, active: false },
    });
    await render();

    expect(container.textContent).toContain("Enable locally");
    expect(button("Manage Codex")).toBeDisabled();
  });

  it("keeps terminal capture active while offering receiver retry", async () => {
    mocks.settings = makeSettings({
      runtime: {
        ...makeSettings().runtime,
        collector: { ...makeSettings().runtime.collector, running: false },
        collectorError: "Unable to start the local Codex usage collector",
      },
    });
    await render();

    expect(container.textContent).toContain(
      "DamHopper ready; open a new terminal",
    );
    expect(container.textContent).toContain("Receiver unavailable");
    await act(async () => button("Retry receiver").click());
    expect(mocks.configure).toHaveBeenCalledWith({
      enabled: true,
      retryCollector: true,
    });
  });

  it("disables both setup actions during a live transition", async () => {
    mocks.pending = true;
    await render();
    expect(button("Updating")).toBeDisabled();
    expect(button("Manage Codex")).toBeDisabled();
  });

  it("keeps safe server error detail available for retry", async () => {
    mocks.configure.mockRejectedValueOnce(new Error("Collector bind failed"));
    await render();
    await act(async () => button("Manage Codex").click());
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Collector bind failed"),
    );
  });

  it("keeps setup controls within a narrow viewport", async () => {
    container.style.width = "320px";
    container.style.maxWidth = "320px";
    await render();
    expect(container.getBoundingClientRect().width).toBe(320);
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
  });

  it("preserves a foreign Codex exporter as a visible conflict", async () => {
    mocks.settings = makeSettings({
      collectorSetup: {
        codexExporter: "conflict",
        restartRequired: false,
        serverRestartRequired: false,
      },
    });
    await render();

    expect(container.textContent).toContain("Configuration conflict");
    expect(button("Conflict")).toBeDisabled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("confirms disabling managed Codex export and explains restart scope", async () => {
    mocks.settings = makeSettings({
      collectorSetup: {
        codexExporter: "managed",
        restartRequired: true,
        serverRestartRequired: false,
      },
    });
    await render();

    expect(container.textContent).toContain(
      "Restart or start a new Codex session",
    );
    await act(async () => button("Disable Codex export").click());
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.configure).toHaveBeenCalledWith({ codexExporter: false });
  });
});
