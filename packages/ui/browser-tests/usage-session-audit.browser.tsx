import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  UsageSessionDetail,
  UsageSessionPage,
  UsageSessionQuery,
  UsageSettings,
  UsageSummary,
} from "@/api/client.js";
import { UsagePage } from "@/components/pages/UsagePage.js";
import "@/index.css";

const calls = vi.hoisted(() => ({
  detail: [] as Array<string | null>,
  sessionEnabled: [] as boolean[],
  sessions: [] as UsageSessionQuery[],
}));

let sessionPage: UsageSessionPage;
let sessionDetail: UsageSessionDetail;
let sessionError: Error | null;
let detailError: Error | null;

vi.mock("@/api/queries.js", () => ({
  useDeleteUsageData: () => ({ isPending: false, mutate: vi.fn() }),
  useDeleteUsageRange: () => ({ isPending: false, mutate: vi.fn() }),
  useUpdateUsageSettings: () => ({ isPending: false, mutate: vi.fn() }),
  useUsageSettings: () => ({ data: settings }),
  useUsageSession: (id: string | null) => {
    calls.detail.push(id);
    return {
      data: detailError ? undefined : sessionDetail,
      error: detailError,
      isLoading: false,
    };
  },
  useUsageSessions: (query: UsageSessionQuery, enabled: boolean) => {
    calls.sessions.push(query);
    calls.sessionEnabled.push(enabled);
    return {
      data: sessionError ? undefined : sessionPage,
      error: sessionError,
      isLoading: false,
    };
  },
  useUsageSummary: () => ({ data: summary, error: null, isLoading: false }),
}));

vi.mock("@/components/templates/AppLayout.js", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const tokens = {
  inputTokens: 10,
  cachedInputTokens: 100,
  outputTokens: 20,
  reasoningTokens: 30,
};
const settings: UsageSettings = {
  aggregateRetentionDays: null,
  collectorEnabled: false,
  collectorSetup: {
    codexExporter: "notConfigured",
    restartRequired: false,
    serverRestartRequired: false,
  },
  detailRetentionDays: 90,
  enabled: true,
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

const summary: UsageSummary = {
  codex: null,
  health: {
    available: true,
    collector: settings.runtime.collector,
    paused: false,
    rejectedEvents: 0,
    sampledAt: 0,
    writerErrors: 0,
  },
  range: { bucket: "day", from: 100, to: 200 },
  timeSeries: [],
};

function makePage(): UsageSessionPage {
  return {
    range: { from: 100, to: 200 },
    nextCursor: "next-page",
    paused: false,
    sessions: [
      {
        id: "a".repeat(64),
        startedAtUtcMs: 110,
        endedAtUtcMs: 190,
        model: "provider/model-a",
        tokens,
        models: [
          {
            model: "provider/model-a",
            responseCount: 1,
            tokens,
          },
        ],
      },
      {
        id: "b".repeat(64),
        startedAtUtcMs: 120,
        endedAtUtcMs: null,
        model: "provider/model-b",
        tokens: {
          inputTokens: null,
          cachedInputTokens: null,
          outputTokens: null,
          reasoningTokens: null,
        },
        models: [],
      },
    ],
  };
}

function makeDetail(): UsageSessionDetail {
  return {
    session: makePage().sessions[0],
    paused: false,
  };
}

function SearchProbe() {
  return <output data-testid="usage-location">{useLocation().search}</output>;
}

describe("usage session audit in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    calls.detail.length = 0;
    calls.sessionEnabled.length = 0;
    calls.sessions.length = 0;
    sessionPage = makePage();
    sessionDetail = makeDetail();
    sessionError = null;
    detailError = null;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderUsage(
    entry = `/usage?view=sessions&session=${"a".repeat(64)}`,
  ) {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[entry]}>
          <UsagePage />
          <SearchProbe />
        </MemoryRouter>,
      );
    });
  }

  it("renders exact and degraded facts without double-counting cached input", async () => {
    await renderUsage();
    expect(container.textContent).toContain("provider/model-a");
    expect(container.textContent).toContain("50 tokens");
    expect(container.textContent).toContain("Cached input100");
    expect(container.textContent).toContain("Models: Unavailable");
    expect(container.textContent).not.toContain("raw-provider-session");
    expect(container.textContent).not.toContain("git status");
  });

  it("renders flat detail without exposing a tree control", async () => {
    await renderUsage();
    expect(container.querySelector("button[aria-label*='node']")).toBeNull();
    expect(container.textContent).not.toContain("Lineage");
    expect(container.textContent).not.toContain("Coverage");
  });

  it("keeps cursor and selection in URL state and resets them on filter changes", async () => {
    await renderUsage();
    expect(calls.detail).toContain("a".repeat(64));
    const next = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Next page"));
    await act(async () => next?.click());
    await vi.waitFor(() =>
      expect(
        container.querySelector("[data-testid='usage-location']")?.textContent,
      ).toContain("cursor=next-page"),
    );
    const windowSelect = [
      ...container.querySelectorAll<HTMLLabelElement>("label"),
    ]
      .find((label) => label.textContent?.includes("Window"))
      ?.querySelector("select");
    await act(async () => {
      if (windowSelect) {
        windowSelect.value = "24h";
        windowSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await vi.waitFor(() => {
      const location = container.querySelector(
        "[data-testid='usage-location']",
      )?.textContent;
      expect(location).toContain("view=sessions");
      expect(location).not.toContain("cursor=");
      expect(location).not.toContain("session=");
    });
  });

  it("scopes polling to Sessions and supports the ARIA tab keyboard pattern", async () => {
    await renderUsage("/usage?window=7d&bucket=day");
    expect(calls.sessionEnabled.at(-1)).toBe(false);
    const overviewTab = container.querySelector<HTMLButtonElement>(
      "#usage-overview-tab",
    );
    const sessionsTab = container.querySelector<HTMLButtonElement>(
      "#usage-sessions-tab",
    );
    overviewTab?.focus();
    await act(async () => {
      overviewTab?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector("[data-testid='usage-location']")?.textContent,
      ).toContain("view=sessions");
      expect(calls.sessionEnabled.at(-1)).toBe(true);
      expect(document.activeElement).toBe(sessionsTab);
      expect(overviewTab?.tabIndex).toBe(-1);
      expect(sessionsTab?.tabIndex).toBe(0);
    });
  });

  it("resets filters without leaving the Sessions tab", async () => {
    await renderUsage(
      "/usage?view=sessions&window=30d&model=provider%2Fmodel-a",
    );
    const reset = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Reset filters"));
    await act(async () => reset?.click());
    await vi.waitFor(() => {
      const location = container.querySelector(
        "[data-testid='usage-location']",
      )?.textContent;
      expect(location).toContain("view=sessions");
      expect(location).toContain("window=7d");
      expect(location).not.toContain("model=");
    });
  });

  it("renders bounded responsive and empty/error states", async () => {
    sessionPage = { ...makePage(), sessions: [], nextCursor: null };
    await renderUsage("/usage?view=sessions");
    expect(container.textContent).toContain("No sessions in this range.");
    expect(
      container.querySelector(
        ".lg\\:grid-cols-\\[minmax\\(18rem\\,0\\.85fr\\)_minmax\\(0\\,1\\.15fr\\)\\]",
      ),
    ).toBeTruthy();

    await act(async () => root.unmount());
    root = createRoot(container);
    sessionError = new Error("Session audit unavailable");
    await renderUsage("/usage?view=sessions");
    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "Session audit unavailable",
    );
  });
});
