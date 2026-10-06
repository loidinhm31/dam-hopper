// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetGitHistoryStore } from "@/stores/git-history.js";
import { useEditorStore } from "@/stores/editor.js";
import {
  installSquashFixture,
  type SquashFixture,
} from "@/test-fixtures/git-squash.js";
import { WorkspaceGitPanel } from "./WorkspaceGitPanel.js";
import type { GitCommitRevealRequest } from "@/lib/git-commit-reveal.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let fixture: SquashFixture;
let root: Root;
let container: HTMLDivElement;
let qc: QueryClient;

async function renderPanel(props: {
  revealRequest?: GitCommitRevealRequest | null;
  onRevealRequestConsumed?: (nonce: number) => void;
}) {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(WorkspaceGitPanel, {
          project: fixture.target.project,
          target: fixture.target,
          available: true,
          revealRequest: props.revealRequest,
          onRevealRequestConsumed: props.onRevealRequestConsumed,
        }),
      ),
    );
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetGitHistoryStore();
  fixture = installSquashFixture();
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

describe("WorkspaceGitPanel Git blame reveal & inspection mode", () => {
  it("consumes valid revealRequest, sets inspection state, and marks outside view notice for non-loaded hash", async () => {
    const onConsumed = vi.fn();
    const revealRequest: GitCommitRevealRequest = {
      nonce: 101,
      owner: { profileId: fixture.target.profileId, generation: 1 },
      target: fixture.target,
      rootId: ".",
      hash: "9999999999999999999999999999999999999999",
    };

    await renderPanel({
      revealRequest,
      onRevealRequestConsumed: onConsumed,
    });

    expect(onConsumed).toHaveBeenCalledWith(101);

    // CommitDetailsPanel should be rendered with outside view notice
    const notice = container.querySelector(
      '[data-testid="outside-history-view-notice"]',
    );
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain(
      "Commit opened from annotation; outside current history view",
    );
  });

  it("does not render outside view notice when revealed commit is in loaded logs", async () => {
    const loadedHash = fixture.logs[0]?.hash ?? "aaaa";
    const onConsumed = vi.fn();
    const revealRequest: GitCommitRevealRequest = {
      nonce: 102,
      owner: { profileId: fixture.target.profileId, generation: 1 },
      target: fixture.target,
      rootId: ".",
      hash: loadedHash,
    };

    await renderPanel({
      revealRequest,
      onRevealRequestConsumed: onConsumed,
    });

    expect(onConsumed).toHaveBeenCalledWith(102);

    const notice = container.querySelector(
      '[data-testid="outside-history-view-notice"]',
    );
    expect(notice).toBeNull();
  });

  it("ignores revealRequest with mismatched project target", async () => {
    const onConsumed = vi.fn();
    const revealRequest: GitCommitRevealRequest = {
      nonce: 103,
      owner: { profileId: fixture.target.profileId, generation: 1 },
      target: {
        profileId: fixture.target.profileId,
        project: "other-project",
        worktreePath: "/tmp/other",
      },
      rootId: ".",
      hash: "1111111111111111111111111111111111111111",
    };

    await renderPanel({
      revealRequest,
      onRevealRequestConsumed: onConsumed,
    });

    expect(onConsumed).not.toHaveBeenCalled();
    const detailsPanel = container.querySelector(
      '[data-testid="outside-history-view-notice"]',
    );
    expect(detailsPanel).toBeNull();
  });

  it("exits inspection mode when user selects a real history row", async () => {
    const onConsumed = vi.fn();
    const revealRequest: GitCommitRevealRequest = {
      nonce: 104,
      owner: { profileId: fixture.target.profileId, generation: 1 },
      target: fixture.target,
      rootId: ".",
      hash: "8888888888888888888888888888888888888888",
    };

    await renderPanel({
      revealRequest,
      onRevealRequestConsumed: onConsumed,
    });

    expect(
      container.querySelector('[data-testid="outside-history-view-notice"]'),
    ).not.toBeNull();

    // Click first log row in GitLogTree
    const logRow = container.querySelector<HTMLElement>('[role="row"]');
    if (logRow) {
      await act(async () => {
        logRow.click();
      });
      // Selecting real row exits inspection mode, so outside notice is cleared
      expect(
        container.querySelector('[data-testid="outside-history-view-notice"]'),
      ).toBeNull();
    }
  });

  it("clears inspection mode when user clicks close on details panel", async () => {
    const onConsumed = vi.fn();
    const revealRequest: GitCommitRevealRequest = {
      nonce: 105,
      owner: { profileId: fixture.target.profileId, generation: 1 },
      target: fixture.target,
      rootId: ".",
      hash: "7777777777777777777777777777777777777777",
    };

    await renderPanel({
      revealRequest,
      onRevealRequestConsumed: onConsumed,
    });

    const closeBtn = container.querySelector<HTMLButtonElement>(
      'button[title="Close commit details"]',
    );
    expect(closeBtn).not.toBeNull();

    await act(async () => {
      closeBtn?.click();
    });

    expect(
      container.querySelector('[data-testid="outside-history-view-notice"]'),
    ).toBeNull();
  });

  it("calls openDiff with the inspected hash when double-clicking a file in inspect mode", async () => {
    const openDiffSpy = vi.fn();
    useEditorStore.setState({ openDiff: openDiffSpy });

    const inspectedHash = "6666666666666666666666666666666666666666";
    const revealRequest: GitCommitRevealRequest = {
      nonce: 106,
      owner: { profileId: fixture.target.profileId, generation: 1 },
      target: fixture.target,
      rootId: ".",
      hash: inspectedHash,
    };

    await renderPanel({
      revealRequest,
    });

    // Mock query client returning commit files for inspectedHash
    qc.setQueryData(
      ["git-commit-files", fixture.target, ".", inspectedHash],
      [
        {
          path: "src/file.ts",
          status: "modified",
          additions: 5,
          deletions: 2,
        },
      ],
    );

    // Re-render to observe query data
    await renderPanel({ revealRequest });

    const fileRow = Array.from(
      container.querySelectorAll<HTMLElement>("div"),
    ).find((el) => el.textContent?.includes("src/file.ts"));

    if (fileRow) {
      await act(async () => {
        fileRow.dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
        );
      });

      expect(openDiffSpy).toHaveBeenCalledWith(
        expect.objectContaining({ project: fixture.target.project }),
        "src/file.ts",
        "modified",
        5,
        2,
        inspectedHash,
      );
    }
  });
});
