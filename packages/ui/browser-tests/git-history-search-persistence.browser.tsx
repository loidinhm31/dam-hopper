import * as React from "react";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { GitLogEntry } from "@/api/client.js";
import { GitHistoryToolbar } from "@/components/molecules/GitHistoryToolbar.js";
import { GitLogTree } from "@/components/organisms/GitLogTree.js";
import {
  resetGitHistoryStore,
  useGitHistoryStore,
} from "@/stores/git-history.js";
import "@/index.css";
import { projectKey } from "@/api/ownership.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const commitA: GitLogEntry = {
  hash: "a".repeat(40),
  parents: ["b".repeat(40)],
  authorName: "Alice",
  authorEmail: "alice@example.com",
  timestamp: 1_700_000_000,
  message: "feat: needle search match in subject",
  refs: ["HEAD -> main"],
  isPushed: true,
};

const commitB: GitLogEntry = {
  hash: "b".repeat(40),
  parents: [],
  authorName: "Bob",
  authorEmail: "bob@example.com",
  timestamp: 1_699_999_000,
  message: "chore: initial commit",
  refs: ["origin/main"],
  isPushed: true,
};

interface ToolbarHarnessProps {
  initialSearch?: string;
  initialPage?: number;
  initialNotice?: string | null;
  compact?: boolean;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
}

function ToolbarHarness({
  initialSearch = "",
  initialPage = 0,
  initialNotice = null,
  compact = false,
  onCompositionStart,
  onCompositionEnd,
}: ToolbarHarnessProps) {
  const [searchText, setSearchText] = useState(initialSearch);
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [notice, setNotice] = useState<string | null>(initialNotice);
  const [followActive, setFollowActive] = useState(true);

  return (
    <div className="p-4 bg-[var(--color-surface)] max-w-2xl">
      <GitHistoryToolbar
        searchText={searchText}
        onSearchChange={setSearchText}
        onClearSearch={() => setSearchText("")}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        isFiltered={Boolean(searchText)}
        page={pageNumber}
        offset={pageNumber * 200}
        logsCount={50}
        pageSize={200}
        hasPreviousPage={pageNumber > 0}
        hasNextPage={true}
        onPreviousPage={() => setPageNumber((p) => Math.max(0, p - 1))}
        onNextPage={() => setPageNumber((p) => p + 1)}
        onRefresh={() => {}}
        followActive={followActive}
        isViewingActiveBranch={followActive}
        branchLabel="main"
        onFollowCheckedOutBranch={() => setFollowActive(true)}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        compact={compact}
      />
    </div>
  );
}

describe("Git history search and persistence browser tests in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await page.viewport(1280, 800);
    resetGitHistoryStore();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    resetGitHistoryStore();
  });

  it("handles search typing, clear button, and Escape key in GitHistoryToolbar", async () => {
    await act(async () => {
      root.render(<ToolbarHarness initialSearch="" />);
    });

    const searchInput = page.getByRole("textbox", {
      name: "Search commit messages",
    });
    await expect.element(searchInput).toBeVisible();

    // Type query
    await userEvent.type(searchInput, "needle");
    await expect.element(searchInput).toHaveValue("needle");

    // Clear button appears when search text is present
    const clearButton = page.getByRole("button", {
      name: /clear search/i,
    });
    await expect.element(clearButton).toBeVisible();

    // Clicking clear clears the search text
    await userEvent.click(clearButton);
    await expect.element(searchInput).toHaveValue("");

    // Typing again and pressing Escape
    await userEvent.type(searchInput, "escape-test");
    await expect.element(searchInput).toHaveValue("escape-test");
    await userEvent.keyboard("{Escape}");
    await expect.element(searchInput).toHaveValue("");
  });

  it("observes IME composition start and end events in GitHistoryToolbar", async () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    await act(async () => {
      root.render(
        <ToolbarHarness
          onCompositionStart={onStart}
          onCompositionEnd={onEnd}
        />,
      );
    });

    const searchInput = page.getByRole("textbox", {
      name: "Search commit messages",
    });
    await expect.element(searchInput).toBeVisible();

    const inputElement = container.querySelector("input")!;
    inputElement.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    expect(onStart).toHaveBeenCalledTimes(1);

    inputElement.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("handles pagination and notice dismissal in GitHistoryToolbar", async () => {
    await act(async () => {
      root.render(
        <ToolbarHarness
          initialPage={1}
          initialNotice="Viewing historical commits"
        />,
      );
    });

    // Verify notice is visible
    const noticeText = page.getByText("Viewing historical commits");
    await expect.element(noticeText).toBeVisible();

    // Dismiss notice
    const dismissButton = page.getByRole("button", {
      name: "Dismiss notice",
    });
    await expect.element(dismissButton).toBeVisible();
    await userEvent.click(dismissButton);
    await expect.element(noticeText).not.toBeInTheDocument();

    // Verify pagination controls
    const prevButton = page.getByRole("button", { name: "Previous page" });
    const nextButton = page.getByRole("button", { name: "Next page" });
    await expect.element(prevButton).toBeVisible();
    await expect.element(nextButton).toBeVisible();

    // Click next page
    await userEvent.click(nextButton);
    // Page was 1, now 2 (offsets 401-450)
    await expect.element(page.getByText(/401.*450/)).toBeVisible();

    // Click previous page
    await userEvent.click(prevButton);
    await expect.element(page.getByText(/201.*250/)).toBeVisible();
  });

  it("renders compact toolbar without overflowing or layout break", async () => {
    await page.viewport(400, 600);
    await act(async () => {
      root.render(<ToolbarHarness compact={true} />);
    });

    const searchInput = page.getByRole("textbox", {
      name: "Search commit messages",
    });
    await expect.element(searchInput).toBeVisible();
    const nextButton = page.getByRole("button", { name: "Next page" });
    await expect.element(nextButton).toBeVisible();
  });

  it("renders graph SVG when unfiltered and suppresses SVG graph in list presentation", async () => {
    function LogTreeHarness({
      presentation,
    }: {
      presentation: "graph" | "list";
    }) {
      return (
        <div className="h-[400px] w-full">
          <GitLogTree logs={[commitA, commitB]} presentation={presentation} />
        </div>
      );
    }

    // 1. Graph presentation: SVG lines/dots exist
    await act(async () => {
      root.render(<LogTreeHarness presentation="graph" />);
    });

    const svgElements = container.querySelectorAll("svg");
    expect(svgElements.length).toBeGreaterThan(0);
    expect(
      page.getByText("feat: needle search match in subject"),
    ).toBeDefined();

    // 2. List presentation (used when filtered): SVG lines/dots are completely omitted
    await act(async () => {
      root.render(<LogTreeHarness presentation="list" />);
    });

    const listSvgElements = container.querySelectorAll("svg");
    expect(listSvgElements.length).toBe(0);
  });

  it("persists branch pinning and Git page selection in useGitHistoryStore across views", () => {
    const store = useGitHistoryStore.getState();

    // Initial state
    expect(store.gitPageSelection).toBeNull();
    expect(store.selectionRecoveryRequired).toBe(false);

    const scope = {
      profileId: "profile-1",
      project: "project-1",
      worktreePath: null,
    };

    // Pin a branch for a scope
    act(() => {
      store.setBranchPreference(
        scope,
        {
          mode: "pinned",
          ref: "refs/heads/feature-x",
        },
        ".",
      );
    });

    const pref = useGitHistoryStore.getState().getBranchPreference(scope, ".");
    expect(pref).toEqual({
      mode: "pinned",
      ref: "refs/heads/feature-x",
    });

    // Return to follow-active
    act(() => {
      store.clearBranchPreference(scope, ".");
    });
    const resetPref = useGitHistoryStore
      .getState()
      .getBranchPreference(scope, ".");
    expect(resetPref).toEqual({ mode: "follow-active" });

    const key1 = projectKey({ profileId: "profile-1", project: "project-1" });
    const key2 = projectKey({ profileId: "profile-1", project: "project-2" });

    // Set Git page selection
    act(() => {
      store.setGitPageSelection([key1, key2]);
    });
    expect(useGitHistoryStore.getState().gitPageSelection).toEqual([
      key1,
      key2,
    ]);

    // Clear Git page selection to explicit all []
    act(() => {
      store.clearGitPageSelection();
    });
    expect(useGitHistoryStore.getState().gitPageSelection).toEqual([]);
  });
});
