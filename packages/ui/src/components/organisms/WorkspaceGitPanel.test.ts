// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetGitHistoryStore,
  useGitHistoryStore,
} from "@/stores/git-history.js";
import {
  installSquashFixture,
  squashOids,
  type SquashFixture,
} from "@/test-fixtures/git-squash.js";
import {
  describeVcsRoot,
  formatVcsRootLabel,
  projectRelativePathForRoot,
  WorkspaceGitPanel,
  workspaceGitRootOptions,
} from "./WorkspaceGitPanel.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let fixture: SquashFixture;
let root: Root;
let container: HTMLDivElement;
let qc: QueryClient;
let available = true;
async function renderPanel() {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(WorkspaceGitPanel, {
          project: fixture.target.project,
          target: fixture.target,
          available,
        }),
      ),
    );
  });
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
  available = true;
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
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Workspace Git roots", () => {
  it("keeps root fallback and mapping labels", () => {
    expect(workspaceGitRootOptions([])[0].rootId).toBe(".");
    const root = {
      rootId: "child",
      path: "child",
      absolutePath: "/repo/child",
      kind: "submodule" as const,
      mappingState: "unmapped" as const,
      warnings: [],
    };
    expect(formatVcsRootLabel(root)).toBe("child");
    expect(describeVcsRoot(root)).toBe("Unmapped");
    expect(projectRelativePathForRoot("child", "src/file.ts")).toBe(
      "child/src/file.ts",
    );
    expect(projectRelativePathForRoot("child", "child/src/file.ts")).toBe(
      "child/src/file.ts",
    );
  });
});
describe("Workspace real squash controls", () => {
  it("selects independently of descendant details, squashes locally and clears every obsolete selection", async () => {
    await renderPanel();
    await renderPanel();
    const detailRow = container.querySelectorAll("tbody tr")[0];
    await act(async () =>
      detailRow.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(
      container.querySelector('[title="Later descendant"]'),
    ).not.toBeNull();
    await act(async () => {
      for (const hash of [squashOids.oldest, squashOids.newest])
        container
          .querySelector<HTMLInputElement>(
            `input[aria-label^="Select ${hash.slice(0, 7)}:"]`,
          )!
          .click();
    });
    expect(button("Squash 2 commits").disabled).toBe(false);
    await act(async () => button("Squash 2 commits").click());
    await renderPanel();
    expect(document.querySelector("textarea")!.value).toContain("Nội dung");
    await act(async () => button("Squash locally").click());
    await renderPanel();
    expect(container.textContent).toContain(
      "Squashed 2 commits locally. Remote unchanged.",
    );
    expect(
      container.querySelectorAll('input[type="checkbox"]:checked'),
    ).toHaveLength(0);
    expect(container.querySelector('[title="Later descendant"]')).toBeNull();
    expect(
      fixture.requests.filter((request) =>
        request.url.pathname.endsWith("/squash"),
      )[0].body?.hashes,
    ).toEqual([squashOids.oldest, squashOids.newest]);
    expect(
      fixture.requests.some((request) =>
        request.url.pathname.endsWith("/push/publish"),
      ),
    ).toBe(false);
    expect(button("Push")).toBeDefined();
    expect(button("Force Push")).toBeDefined();
  });
  it("keeps valid filtered chains actionable but fails closed on non-local branches and unavailable target", async () => {
    fixture.messages[squashOids.newest] += "\nmatching filter\n";
    fixture.logs = fixture.logs.slice(1);
    await renderPanel();
    await renderPanel();
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="Search commit messages"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "matching filter");
      search.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(300);
    });
    await renderPanel();
    expect(container.querySelector("tbody svg")).toBeNull();
    expect(
      fixture.requests.some(
        (request) =>
          request.url.searchParams.get("messageQuery") === "matching filter",
      ),
    ).toBe(true);
    await act(async () =>
      container
        .querySelectorAll<HTMLInputElement>('input[aria-label^="Select"]')
        .forEach((input) => input.click()),
    );
    expect(button("Squash 2 commits").disabled).toBe(false);
    await act(async () =>
      useGitHistoryStore
        .getState()
        .setBranchPreference(
          fixture.target,
          { mode: "pinned", ref: "refs/remotes/origin/remote" },
          ".",
        ),
    );
    await renderPanel();
    expect(button("Squash commits").disabled).toBe(true);
    expect(container.textContent).toContain("Squash requires a local branch.");
    available = false;
    await renderPanel();
    expect(container.querySelector('input[aria-label^="Select"]')).toBeNull();
  });
});
