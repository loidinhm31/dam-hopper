import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  UsageSettings,
  UsageSummary,
  UsageSummaryQuery,
} from "@/api/client.js";
import { TopNavRouteMenu } from "@/components/organisms/TopNavRouteMenu.js";
import { UsagePage } from "@/components/pages/UsagePage.js";
import { UsageTrendChart } from "@/components/usage/UsageTrendChart.js";
import "@/index.css";

const mocks = vi.hoisted(() => ({
  deleteAll: vi.fn(),
  deleteRange: vi.fn(),
  summaryCalls: [] as UsageSummaryQuery[],
  updateSettings: vi.fn(),
}));

vi.mock("@/api/queries.js", () => ({
  useDeleteUsageData: () => ({ isPending: false, mutate: mocks.deleteAll }),
  useDeleteUsageRange: () => ({ isPending: false, mutate: mocks.deleteRange }),
  useProjects: () => ({ data: [{ name: "api" }, { name: "web" }] }),
  useUpdateUsageSettings: () => ({
    isPending: false,
    mutate: mocks.updateSettings,
  }),
  useUsageSettings: () => ({ data: settings }),
  useUsageSession: () => ({ data: undefined, error: null, isLoading: false }),
  useUsageSessions: () => ({
    data: {
      nextCursor: null,
      paused: false,
      range: { from: 0, to: 1 },
      sessions: [],
    },
    error: null,
    isLoading: false,
  }),
  useUsageSummary: (query: UsageSummaryQuery) => {
    mocks.summaryCalls.push(query);
    return { data: summary, error: null, isLoading: false };
  },
}));

vi.mock("@/components/templates/AppLayout.js", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const settings: UsageSettings = {
  aggregateRetentionDays: null,
  collectorEnabled: false,
  collectorSetup: {
    codexExporter: "notConfigured",
    restartRequired: true,
    serverRestartRequired: false,
  },
  detailRetentionDays: 90,
  enabled: true,
  excludedProjects: ["private"],
  paused: false,
  runtime: {
    active: true,
    collector: {
      coreSchemaDrift: 0,
      dropped: 0,
      duplicate: 0,
      lastAcceptedAtUtcMs: null,
      malformed: 0,
      queued: 0,
      rejected: 0,
      running: false,
      unavailableTokenCoverage: 0,
      unverifiedVersion: 0,
    },
    collectorError: null,
  },
};

const emptyUsage = {
  commandCount: 0,
  durationMsSum: 0,
  failedCount: 0,
  interruptedCount: 0,
  succeededCount: 0,
  unknownCount: 0,
};

const summary: UsageSummary = {
  categories: [{ name: "git", terminal: emptyUsage }],
  codex: null,
  coverage: {
    captureQualityFilter: null,
    codexCorrelation: null,
    detailOnly: true,
  },
  detailMetrics: {
    durationP50Ms: 10,
    durationP95Ms: 20,
    repeatedCommandCount: 0,
  },
  health: {
    available: true,
    collector: {
      coreSchemaDrift: 0,
      dropped: 0,
      duplicate: 0,
      lastAcceptedAtUtcMs: null,
      malformed: 0,
      queued: 0,
      rejected: 0,
      running: false,
      unavailableTokenCoverage: 0,
      unverifiedVersion: 0,
    },
    paused: false,
    rejectedEvents: 0,
    sampledAt: 0,
    writerErrors: 0,
  },
  projects: [{ name: "api", terminal: emptyUsage }],
  range: { bucket: "day", from: 0, to: 1 },
  terminal: emptyUsage,
  timeSeries: [],
};

function SearchProbe() {
  const location = useLocation();
  return <output data-testid="usage-location">{location.search}</output>;
}

describe("usage page in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.deleteAll.mockReset();
    mocks.deleteRange.mockReset();
    mocks.summaryCalls.length = 0;
    mocks.updateSettings.mockReset();
    mocks.updateSettings.mockImplementation((_patch, callbacks) =>
      callbacks?.onSuccess?.(),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderUsage(entry = "/usage?window=7d&bucket=day") {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[entry]}>
          <UsagePage />
          <SearchProbe />
        </MemoryRouter>,
      );
    });
  }

  function labeledControl(label: string) {
    const labelElement = [...container.querySelectorAll("label")].find(
      (element) => element.textContent?.includes(label),
    );
    expect(labelElement).toBeTruthy();
    const control = labelElement?.querySelector<
      HTMLInputElement | HTMLSelectElement
    >("input, select");
    expect(control).toBeTruthy();
    return control!;
  }

  it("reloads the route with its URL filters intact", async () => {
    const entry =
      "/usage?window=30d&bucket=day&project=api&shell=zsh&captureQuality=partial&category=git&agent=codex&model=gpt-5.6-sol";
    await renderUsage(entry);
    expect(mocks.summaryCalls.at(-1)).toMatchObject({
      agent: "codex",
      category: "git",
      captureQuality: "partial",
      model: "gpt-5.6-sol",
      project: "api",
      shell: "zsh",
      window: "30d",
    });
    expect(mocks.summaryCalls.at(-1)?.from).toBeUndefined();
    expect(mocks.summaryCalls.at(-1)?.to).toBeUndefined();

    await act(async () => root.unmount());
    root = createRoot(container);
    await renderUsage(entry);
    expect(mocks.summaryCalls.at(-1)).toMatchObject({
      project: "api",
      shell: "zsh",
      window: "30d",
    });
  });

  it("maps keyboard-accessible filter controls back to URL state", async () => {
    await renderUsage();
    const windowSelect = labeledControl("Window");
    windowSelect.focus();
    expect(document.activeElement).toBe(windowSelect);
    await act(async () => {
      (windowSelect as HTMLSelectElement).value = "24h";
      windowSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(
        container.querySelector("[data-testid='usage-location']")?.textContent,
      ).toContain("window=24h"),
    );

    const shellSelect = labeledControl("Shell");
    shellSelect.focus();
    expect(document.activeElement).toBe(shellSelect);
    await act(async () => {
      (shellSelect as HTMLSelectElement).value = "fish";
      shellSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(mocks.summaryCalls.at(-1)).toMatchObject({
        shell: "fish",
        window: "24h",
      }),
    );
  });

  it("clears custom bounds when a preset window is selected", async () => {
    await renderUsage("/usage?from=1782864000000&to=1783036800000&bucket=day");
    const windowSelect = labeledControl("Window") as HTMLSelectElement;
    await act(async () => {
      windowSelect.value = "24h";
      windowSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(() => {
      const search = container.querySelector(
        "[data-testid='usage-location']",
      )?.textContent;
      expect(search).toContain("window=24h");
      expect(search).not.toContain("from=");
      expect(search).not.toContain("to=");
    });
  });

  it("retains custom bounds when a non-window filter changes", async () => {
    await renderUsage("/usage?from=1782864000000&to=1783036800000&bucket=day");
    const shellSelect = labeledControl("Shell") as HTMLSelectElement;
    await act(async () => {
      shellSelect.value = "fish";
      shellSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(mocks.summaryCalls.at(-1)).toMatchObject({
        from: 1_782_864_000_000,
        shell: "fish",
        to: 1_783_036_800_000,
        window: undefined,
      }),
    );
  });

  it("uses UTC date-only bounds after destructive-delete confirmation", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    await renderUsage();
    const from = labeledControl("From") as HTMLInputElement;
    const to = labeledControl("To (exclusive)") as HTMLInputElement;
    const setDateValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setDateValue?.call(from, "2026-07-01");
      from.dispatchEvent(new Event("input", { bubbles: true }));
      setDateValue?.call(to, "2026-07-03");
      to.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const apply = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Apply custom range"));
    await act(async () => apply?.click());
    await vi.waitFor(() =>
      expect(mocks.summaryCalls.at(-1)).toMatchObject({
        from: Date.UTC(2026, 6, 1),
        to: Date.UTC(2026, 6, 3),
      }),
    );
    const deleteButton = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Delete selected range"));
    await act(async () => deleteButton?.click());
    expect(confirm).toHaveBeenCalledWith(
      "Delete the selected UTC date range? This cannot be undone.",
    );
    expect(mocks.deleteRange).toHaveBeenCalledWith({
      from: Date.UTC(2026, 6, 1),
      to: Date.UTC(2026, 6, 3),
    });
  });

  it("keeps a Unix-epoch custom range destructive-range scoped", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    await renderUsage("/usage?from=0&to=86400000&bucket=day");
    const deleteButton = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Delete selected range"));
    await act(async () => deleteButton?.click());
    expect(confirm).toHaveBeenCalledWith(
      "Delete the selected UTC date range? This cannot be undone.",
    );
    expect(mocks.deleteRange).toHaveBeenCalledWith({ from: 0, to: 86_400_000 });
    expect(mocks.deleteAll).not.toHaveBeenCalled();
  });

  it("preserves existing exclusions through an accessible protected-settings action", async () => {
    await renderUsage();
    const project = labeledControl("Project to exclude") as HTMLSelectElement;
    project.focus();
    expect(document.activeElement).toBe(project);
    await act(async () => {
      project.value = "api";
      project.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const submit = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Exclude project"));
    await act(async () => submit?.click());
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      { excludedProjects: ["private", "api"] },
      expect.any(Object),
    );
    const remove = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Remove private']",
    );
    remove?.focus();
    expect(document.activeElement).toBe(remove);
  });

  it("keeps all navigation targets reachable in narrow compact navigation", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <TopNavRouteMenu
            collapsed={false}
            compactLabelClass="text-xs"
            compactTextClass="text-xs"
            isCompactWorkspace
          />
        </MemoryRouter>,
      );
    });
    const navs = container.querySelectorAll<HTMLElement>(
      "nav[aria-label='Primary']",
    );
    expect(navs).toHaveLength(2);
    const compactNav = navs[1];
    expect(compactNav.className).toContain("grid-cols-2");
    expect(compactNav.className).toContain("sm:hidden");
    const usage = [...compactNav.querySelectorAll<HTMLAnchorElement>("a")].find(
      (link) => link.textContent?.includes("USAGE"),
    );
    usage?.focus();
    expect(document.activeElement).toBe(usage);
  });

  it("excludes cached input from token trend totals", async () => {
    await act(async () => {
      root.render(
        <UsageTrendChart
          bucket="day"
          metric="tokens"
          series={[
            {
              codex: {
                inputTokens: 10,
                cachedInputTokens: 100,
                outputTokens: 20,
                reasoningTokens: 30,
              },
              startUtcMs: Date.UTC(2026, 6, 1),
              terminal: emptyUsage,
            },
          ]}
          title="Codex tokens"
        />,
      );
    });
    expect(container.querySelector("circle title")?.textContent).toContain(
      "50 tokens",
    );
  });
});
