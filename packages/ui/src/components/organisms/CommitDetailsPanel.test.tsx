// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitLogEntry } from "@/api/client.js";
import { gitCommitDetailsQueryKey } from "@/api/queries.js";
import { CommitDetailsPanel } from "./CommitDetailsPanel.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;
let qc: QueryClient;

const testLogEntry: GitLogEntry = {
  hash: "1234567890abcdef1234567890abcdef12345678",
  parents: ["parent-hash"],
  message: "feat: history commit subject",
  authorName: "Alice Tester",
  authorEmail: "alice@example.com",
  timestamp: 1728200000,
  refs: [],
  isPushed: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("CommitDetailsPanel discriminated mode behavior", () => {
  it("renders history mode with commit subject, author, and action callbacks", async () => {
    const onClose = vi.fn();
    const onFileDoubleClick = vi.fn();
    const onCherryPick = vi.fn();
    const onRevert = vi.fn();
    const onDrop = vi.fn();

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(CommitDetailsPanel, {
            mode: "history",
            project: "demo",
            root: ".",
            commit: testLogEntry,
            onClose,
            onFileDoubleClick,
            onCherryPickSelectedChanges: onCherryPick,
            onRevertSelectedChanges: onRevert,
            onDropSelectedChanges: onDrop,
          }),
        ),
      );
    });

    expect(container.textContent).toContain("feat: history commit subject");
    expect(container.textContent).toContain("Alice Tester");
    expect(container.textContent).toContain("<alice@example.com>");
    expect(
      container.querySelector('[data-testid="outside-history-view-notice"]'),
    ).toBeNull();
  });

  it("renders inspect mode in read-only mode without mutation callbacks", async () => {
    const onClose = vi.fn();
    const onFileDoubleClick = vi.fn();
    const inspectHash = "fedcba0987654321fedcba0987654321fedcba09";

    // Seed commit details with multiline body using exact canonical query key
    const queryKey = gitCommitDetailsQueryKey("demo", inspectHash, ".");
    qc.setQueryData(queryKey, {
      hash: inspectHash,
      authorName: "Bob Inspect",
      authorEmail: "bob@example.com",
      authorTimestamp: 1728205000,
      authorTimezoneOffsetMinutes: 420,
      committerName: "Bob Reviewer",
      committerEmail: "reviewer@example.com",
      committerTimestamp: 1728205600,
      committerTimezoneOffsetMinutes: 420,
      subject: "fix: inspect mode commit",
      fullMessage:
        "fix: inspect mode commit\n\nDetailed explanation of fix body.",
    });
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(CommitDetailsPanel, {
            mode: "inspect",
            project: "demo",
            root: ".",
            commitHash: inspectHash,
            outsideViewNotice: true,
            onClose,
            onFileDoubleClick,
          }),
        ),
      );
    });

    expect(container.textContent).toContain("fix: inspect mode commit");
    expect(container.textContent).toContain("Bob Inspect");
    expect(container.textContent).toContain("<bob@example.com>");
    expect(container.textContent).toContain(
      "Detailed explanation of fix body.",
    );

    const committerEl = container.querySelector(
      '[data-testid="commit-details-committer"]',
    );
    expect(committerEl).not.toBeNull();
    expect(committerEl?.textContent).toContain("Bob Reviewer");
    expect(committerEl?.textContent).toContain("<reviewer@example.com>");
    const notice = container.querySelector(
      '[data-testid="outside-history-view-notice"]',
    );
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain(
      "Commit opened from annotation; outside current history view",
    );
  });

  it("displays error state when commit details query returns an error", async () => {
    const onClose = vi.fn();
    const onFileDoubleClick = vi.fn();
    const missingHash = "0000000000000000000000000000000000000000";

    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: "Commit not found in repository" }),
          {
            status: 404,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(CommitDetailsPanel, {
            mode: "inspect",
            project: "demo",
            root: ".",
            commitHash: missingHash,
            onClose,
            onFileDoubleClick,
          }),
        ),
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    const errorBanner = container.querySelector(
      '[data-testid="commit-details-error"]',
    );
    expect(errorBanner).not.toBeNull();
    expect(errorBanner?.textContent).toContain("Failed to load commit details");
  });

  it("copies full hash to clipboard when clicking copy affordance", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    const inspectHash = "4444444444444444444444444444444444444444";

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(CommitDetailsPanel, {
            mode: "inspect",
            project: "demo",
            root: ".",
            commitHash: inspectHash,
            onClose: () => {},
            onFileDoubleClick: () => {},
          }),
        ),
      );
    });

    const copyBtn = container.querySelector<HTMLButtonElement>(
      `button[title*="${inspectHash}"]`,
    );
    expect(copyBtn).not.toBeNull();

    await act(async () => {
      copyBtn?.click();
    });

    expect(writeTextMock).toHaveBeenCalledWith(inspectHash);
  });

  it("renders committerName, committerEmail, and timestamp metadata from details", async () => {
    const commitHash = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const queryKey = gitCommitDetailsQueryKey("demo", commitHash, ".");
    qc.setQueryData(queryKey, {
      hash: commitHash,
      authorName: "Alice Author",
      authorEmail: "alice@example.com",
      authorTimestamp: 1760000000,
      authorTimezoneOffsetMinutes: 0,
      committerName: "Bob Committer",
      committerEmail: "bob@example.com",
      committerTimestamp: 1760003600,
      committerTimezoneOffsetMinutes: 120,
      subject: "feat: committer metadata test",
      fullMessage: "feat: committer metadata test\n\nBody",
    });

    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(CommitDetailsPanel, {
            mode: "inspect",
            project: "demo",
            root: ".",
            commitHash,
            onClose: () => {},
            onFileDoubleClick: () => {},
          }),
        ),
      );
    });

    const committerBlock = container.querySelector(
      '[data-testid="commit-details-committer"]',
    );
    expect(committerBlock).not.toBeNull();
    expect(committerBlock?.textContent).toContain("Bob Committer");
    expect(committerBlock?.textContent).toContain("<bob@example.com>");
  });
});
