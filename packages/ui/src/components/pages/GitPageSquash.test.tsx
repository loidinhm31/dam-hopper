// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregatedProjectItem } from "@/hooks/use-aggregated-projects.js";
import { projectKey } from "@/api/ownership.js";
import {
  resetGitHistoryStore,
  useGitHistoryStore,
} from "@/stores/git-history.js";
import { useProjectTargetStore } from "@/stores/project-target.js";
import {
  installSquashFixture,
  squashOids,
  type SquashFixture,
} from "@/test-fixtures/git-squash.js";
import { GitPage } from "./GitPage.js";

let fixture: SquashFixture;
let projects: AggregatedProjectItem[];
vi.mock("@/hooks/use-aggregated-projects.js", () => ({
  useAggregatedProjects: () => ({
    allProjects: projects,
    groups: [],
    isLoading: false,
  }),
}));
vi.mock("@/components/templates/AppLayout.js", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/organisms/GitLocalChanges.js", () => ({
  GitLocalChanges: () => <div>Local changes sidebar</div>,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
let qc: QueryClient;
async function renderPage() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <GitPage />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}
function button(text: string) {
  const found = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).find((entry) => entry.textContent === text);
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}
beforeEach(() => {
  vi.useFakeTimers();
  resetGitHistoryStore();
  fixture = installSquashFixture();
  projects = [
    {
      profileId: fixture.target.profileId,
      profileName: "Squash profile",
      serverUrl: "http://squash.invalid",
      ref: fixture.target,
      project: {
        name: fixture.target.project,
        type: "git",
        isAvailable: true,
      } as AggregatedProjectItem["project"],
    },
  ];
  useProjectTargetStore
    .getState()
    .selectTarget(fixture.target, fixture.target.worktreePath);
  useGitHistoryStore
    .getState()
    .setRootForTarget(fixture.target, "nested/history");
  useGitHistoryStore.setState({
    gitPageSelection: [projectKey(fixture.target)],
  });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
  fixture.destroy();
  container.remove();
  useProjectTargetStore.getState().resetTarget(fixture.target);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("standalone history squash uses its own root", () => {
  it("leaves bulk root independent and prepares/publishes only the rewritten history root", async () => {
    await renderPage();
    await renderPage();
    const selects = Array.from(
      container.querySelectorAll<HTMLSelectElement>("select"),
    );
    const bulkRoot = selects.find(
      (select) =>
        select.value === "." &&
        Array.from(select.options).some(
          (option) => option.value === "bulk/root",
        ),
    )!;
    expect(bulkRoot).toBeDefined();
    await act(async () => {
      bulkRoot.value = "bulk/root";
      bulkRoot.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      for (const hash of [squashOids.newest, squashOids.oldest])
        container
          .querySelector<HTMLInputElement>(
            `input[aria-label^="Select ${hash.slice(0, 7)}:"]`,
          )!
          .click();
    });
    await act(async () => button("Squash 2 commits").click());
    await renderPage();
    expect(document.querySelector("textarea")!.value).toContain(
      "Signed-off-by: Đặng",
    );
    await act(async () => button("Squash locally").click());
    await renderPage();
    const rewrite = fixture.requests.find((request) =>
      request.url.pathname.endsWith("/squash"),
    )!;
    expect(rewrite.body).toMatchObject({
      root: "nested/history",
      worktreePath: fixture.target.worktreePath,
    });
    expect(bulkRoot.value).toBe("bulk/root");
    expect(
      fixture.requests.some((request) =>
        request.url.pathname.endsWith("/push/prepare"),
      ),
    ).toBe(false);
    await act(async () => button("Publish rewritten branch").click());
    await renderPage();
    expect(
      fixture.requests.find((request) =>
        request.url.pathname.endsWith("/push/prepare"),
      )?.body?.root,
    ).toBe("nested/history");
    await act(async () => button("Publish Branch").click());
    await renderPage();
    expect(
      fixture.requests.find((request) =>
        request.url.pathname.endsWith("/push/publish"),
      )?.body,
    ).toMatchObject({
      root: "nested/history",
      snapshot: { sourceOid: squashOids.tip },
    });
  });
  it("squashes and leased-publishes an inactive local branch with explicit confirmation and cancellation safety", async () => {
    await renderPage();
    await renderPage();

    await act(async () =>
      useGitHistoryStore
        .getState()
        .setBranchPreference(
          fixture.target,
          { mode: "pinned", ref: "refs/heads/other" },
          "nested/history",
        ),
    );
    await renderPage();

    expect(container.textContent).toContain("Viewing other.");
    expect(container.textContent).toContain(
      "Cherry-pick and revert apply to checked-out branch main.",
    );
    expect(container.textContent).not.toContain(
      "Rewrite actions stay on the active branch.",
    );

    await act(async () => {
      for (const hash of [squashOids.newest, squashOids.oldest])
        container
          .querySelector<HTMLInputElement>(
            `input[aria-label^="Select ${hash.slice(0, 7)}:"]`,
          )!
          .click();
    });

    expect(button("Squash 2 commits").disabled).toBe(false);
    await act(async () => button("Squash 2 commits").click());
    await renderPage();

    await act(async () => button("Squash locally").click());
    await renderPage();

    const squashReq = fixture.requests.find((request) =>
      request.url.pathname.endsWith("/squash"),
    )!;
    expect(squashReq.body).toMatchObject({
      expectedBranch: "refs/heads/other",
    });

    expect(
      fixture.requests.some((request) =>
        request.url.pathname.endsWith("/push/prepare"),
      ),
    ).toBe(false);
    expect(
      fixture.requests.some((request) =>
        request.url.pathname.endsWith("/push/publish"),
      ),
    ).toBe(false);

    await act(async () => button("Publish rewritten branch").click());
    await renderPage();

    const prepareReq = fixture.requests.find((request) =>
      request.url.pathname.endsWith("/push/prepare"),
    )!;
    expect(prepareReq.body).toMatchObject({
      branch: "refs/heads/other",
    });

    const cancelButton = button("Cancel");
    await act(async () => cancelButton.click());
    await renderPage();

    expect(
      fixture.requests.some((request) =>
        request.url.pathname.endsWith("/push/publish"),
      ),
    ).toBe(false);

    await act(async () => button("Publish rewritten branch").click());
    await renderPage();

    await act(async () => button("Publish Branch").click());
    await renderPage();

    const publishReq = fixture.requests.find((request) =>
      request.url.pathname.endsWith("/push/publish"),
    )!;
    expect(publishReq.body).toMatchObject({
      snapshot: {
        branch: "refs/heads/other",
      },
    });
  });
  it("offers no history mutation on empty/multi/unavailable project selection", async () => {
    useGitHistoryStore.setState({ gitPageSelection: [] });
    await renderPage();
    expect(container.querySelector('input[aria-label^="Select"]')).toBeNull();
    useGitHistoryStore.setState({
      gitPageSelection: [projectKey(fixture.target), '["offline","missing"]'],
    });
    await renderPage();
    expect(container.querySelector('input[aria-label^="Select"]')).toBeNull();
    useGitHistoryStore.setState({
      gitPageSelection: ['["offline","missing"]'],
    });
    await renderPage();
    expect(container.textContent).toContain(
      "Selected Project Offline or Unavailable",
    );
    expect(
      fixture.requests.some((request) =>
        request.url.pathname.endsWith("/squash"),
      ),
    ).toBe(false);
  });
});
