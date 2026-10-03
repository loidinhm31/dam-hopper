// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommitMessageResponse, GitActionResult } from "@/api/client.js";
import {
  useGitHistoryView,
  type GitHistoryViewResult,
} from "./use-git-history-view.js";
import { useGitSquashActions } from "./use-git-squash.js";
import { GitHistoryToolbar } from "@/components/molecules/GitHistoryToolbar.js";
import { GitLogTree } from "@/components/organisms/GitLogTree.js";
import { GitSquashFlow } from "@/components/organisms/GitSquashFlow.js";
import { gitHistoryQueryPrefixes } from "@/api/queries.js";
import { resetGitHistoryStore } from "@/stores/git-history.js";
import {
  deferred,
  installSquashFixture,
  squashEntry,
  squashOids,
  type SquashFixture,
} from "@/test-fixtures/git-squash.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let fixture: SquashFixture;
let root: Root;
let container: HTMLDivElement;
let qc: QueryClient;
let view: GitHistoryViewResult;
let available = true;
const MESSAGE_LOAD_CONCURRENCY_FOR_TEST = 8;
function Harness() {
  view = useGitHistoryView(fixture.target, { available });
  const squash = useGitSquashActions(fixture.target, view.rootId, view);
  return (
    <>
      <GitHistoryToolbar
        searchText={view.searchText}
        onSearchChange={view.setSearchText}
        onClearSearch={view.clearSearch}
        page={view.page}
        offset={view.offset}
        logsCount={view.logs.length}
        hasPreviousPage={view.hasPreviousPage}
        hasNextPage={view.hasNextPage}
        onPreviousPage={view.previousPage}
        onNextPage={view.nextPage}
        onRefresh={() => void view.refresh()}
        squashCount={view.squashSelection.count}
        squashDisabledReason={
          view.squashUnavailableReason || view.squashSelection.disabledReason
        }
        squashBusy={squash.open}
        onSquash={squash.begin}
        onClearSquashSelection={view.clearSquashSelection}
        focusRef={squash.toolbarRef}
      />
      <GitLogTree
        logs={view.logs}
        selectedHash={view.selectedCommit?.hash}
        onSelectCommit={view.selectCommit}
        presentation={view.isFiltered ? "list" : "graph"}
        squashSelectedHashes={view.squashSelectedHashes}
        onToggleSquashCommit={view.toggleSquashCommit}
        squashSelectionDisabled={!view.squashAvailable || squash.open}
      />
      <p data-testid="detail">{view.selectedCommit?.hash}</p>
      <GitSquashFlow squash={squash} />
    </>
  );
}
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}
async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>,
    );
  });
  await flush();
}
function button(text: string) {
  const found = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).find((entry) => entry.textContent === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
async function click(text: string) {
  await act(async () => {
    button(text).click();
  });
  await flush();
}
async function select() {
  await act(async () => {
    for (const hash of [squashOids.newest, squashOids.oldest])
      container
        .querySelector<HTMLInputElement>(
          `input[aria-label^="Select ${hash.slice(0, 7)}:"]`,
        )!
        .click();
  });
}
async function open() {
  await select();
  await click("Squash 2 commits");
}
async function edit(value: string) {
  const textarea = document.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const mutations = () =>
  fixture.requests.filter((request) =>
    request.url.pathname.endsWith("/squash"),
  );
beforeEach(() => {
  vi.useFakeTimers();
  resetGitHistoryStore();
  available = true;
  fixture = installSquashFixture();
  qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
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

describe("shared squash controller and actual controls", () => {
  it("keeps detail selection independent, sends full oldest-first messages in frozen worktree/root and offers separate publication", async () => {
    await render();
    await act(async () => {
      view.setRootId("nested/history");
    });
    await flush();
    const detailKeys = gitHistoryQueryPrefixes(
      fixture.target,
      "nested/history",
    ).details(squashOids.descendant);
    for (const queryKey of detailKeys)
      qc.setQueryData(queryKey, { oldDescendant: true });
    await act(async () => {
      view.selectCommit(fixture.logs[0]);
    });
    await open();
    expect(container.querySelector('[data-testid="detail"]')!.textContent).toBe(
      squashOids.descendant,
    );
    expect(document.querySelector("textarea")!.value).toBe(
      `${fixture.messages[squashOids.oldest]}\n${fixture.messages[squashOids.newest]}\n`,
    );
    await click("Squash locally");
    expect(mutations()).toHaveLength(1);
    expect(mutations()[0].body).toMatchObject({
      hashes: [squashOids.oldest, squashOids.newest],
      worktreePath: fixture.target.worktreePath,
      root: "nested/history",
      expectedBranch: "refs/heads/main",
      expectedHeadOid: squashOids.descendant,
    });
    expect(mutations()[0].body).not.toHaveProperty("profileId");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain(
      "Squashed 2 commits locally. Remote unchanged.",
    );
    for (const queryKey of detailKeys)
      expect(qc.getQueryCache().find({ queryKey })?.isStale()).toBe(true);
    expect(container.querySelector('[data-testid="detail"]')!.textContent).toBe(
      "",
    );
    expect(view.squashSelectedHashes).toEqual([]);
    expect(
      fixture.requests.some((request) =>
        request.url.pathname.endsWith("/push/prepare"),
      ),
    ).toBe(false);
    await click("Publish rewritten branch");
    expect(
      fixture.requests.find((request) =>
        request.url.pathname.endsWith("/push/prepare"),
      )?.body?.root,
    ).toBe("nested/history");
    expect(
      fixture.requests.some((request) =>
        request.url.pathname.endsWith("/push/publish"),
      ),
    ).toBe(false);
    await click("Cancel");
    await click("Publish rewritten branch");
    await click("Publish Branch");
    expect(
      fixture.requests.find((request) =>
        request.url.pathname.endsWith("/push/publish"),
      )?.body,
    ).toMatchObject({
      root: "nested/history",
      snapshot: { sourceOid: squashOids.tip },
    });
  });
  it("retains edited Unicode draft on signature block and requires fresh explicit consent", async () => {
    fixture.squashResponse = async (input) =>
      input.allowSignatureRemoval
        ? { ok: true, newHeadOid: squashOids.tip }
        : {
            ok: false,
            blockedReason: "signature-consent-required",
            message: "Signatures invalidated",
            recommendation: "Explicit consent required",
          };
    await render();
    await open();
    await edit("Edited Đặng\n\nBody  ");
    await click("Squash locally");
    expect(document.querySelector("textarea")!.value).toBe(
      "Edited Đặng\n\nBody  ",
    );
    expect(button("Squash locally").disabled).toBe(true);
    expect(document.body.textContent).toContain("every rewritten descendant");
    await act(async () =>
      document
        .querySelector<HTMLInputElement>('input[type="checkbox"][aria-label]')
        ?.focus(),
    );
    const consent = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).find((input) =>
      input.parentElement?.textContent?.includes("Allow removal"),
    )!;
    await act(async () => consent.click());
    await click("Squash locally");
    expect(mutations()[1].body).toMatchObject({
      message: "Edited Đặng\n\nBody  \n",
      allowSignatureRemoval: true,
    });
    await open();
    expect(
      Array.from(document.querySelectorAll("label")).some((label) =>
        label.textContent?.includes("Allow removal"),
      ),
    ).toBe(false);
    await click("Squash locally");
    expect(mutations()[2].body).not.toHaveProperty("allowSignatureRemoval");
  });
  it.each(["head", "branch"] as const)(
    "rejects incoherent %s snapshots and deliberately retries whole failed batches",
    async (mismatch) => {
      const original = fixture.messageResponse;
      fixture.messageResponse = async (hash) => {
        const message = await original(hash);
        return hash === squashOids.oldest
          ? {
              ...message,
              ...(mismatch === "head"
                ? { headOid: "f".repeat(40) }
                : { branch: "refs/heads/other" }),
            }
          : message;
      };
      await render();
      await open();
      expect(document.body.textContent).toContain(
        "History changed while loading messages",
      );
      expect(button("Squash locally").disabled).toBe(true);
      expect(document.querySelector("textarea")!.value).toBe("");
      await click("Cancel");
      fixture.messageResponse = async () => {
        throw new Error("Read failed");
      };
      await click("Squash 2 commits");
      expect(button("Retry full messages")).toBeDefined();
      fixture.messageResponse = original;
      const before = fixture.requests.filter((request) =>
        request.url.pathname.endsWith("/message"),
      ).length;
      await click("Retry full messages");
      expect(
        fixture.requests.filter((request) =>
          request.url.pathname.endsWith("/message"),
        ).length - before,
      ).toBe(2);
      expect(button("Squash locally").disabled).toBe(false);
      expect(mutations()).toHaveLength(0);
    },
  );
  it.each([
    "stale-ref",
    "active-operation",
    "unsupported-history",
  ] as const)(
    "requires refresh/reselection after server %s block",
    async (blockedReason) => {
      fixture.squashResponse = async () => ({
        ok: false,
        blockedReason,
        message: "Refresh before retrying",
      });
      await render();
      await open();
      await edit("Keep this draft for copying");
      await click("Squash locally");
      expect(document.querySelector("textarea")!.value).toBe(
        "Keep this draft for copying",
      );
      expect(button("Squash locally").disabled).toBe(true);
      expect(button("Inspect / refresh history")).toBeDefined();
      expect(mutations()).toHaveLength(1);
    },
  );
  it("bounds concurrent full-message reads for large selections", async () => {
    const count = 18;
    const hashes = Array.from(
      { length: count },
      (_, index) =>
        (index + 1).toString(16).padStart(7, "0") + "0".repeat(33),
    );
    fixture.logs = hashes
      .map((hash, index) =>
        squashEntry(
          hash,
          index === 0 ? [] : [hashes[index - 1]],
          `commit ${index + 1}`,
        ),
      )
      .reverse();
    let active = 0;
    let maxActive = 0;
    fixture.messageResponse = async (hash) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return {
        message: `message ${hash.slice(0, 7)}`,
        branch: "refs/heads/main",
        headOid: squashOids.descendant,
      };
    };

    await render();
    await act(async () => {
      for (const hash of hashes) {
        container
          .querySelector<HTMLInputElement>(
            `input[aria-label^="Select ${hash.slice(0, 7)}:"]`,
          )!
          .click();
      }
    });
    expect(view.squashSelection.valid).toBe(true);
    await click(`Squash ${count} commits`);
    expect(maxActive).toBe(MESSAGE_LOAD_CONCURRENCY_FOR_TEST);
  });
  it("forbids duplicate submit and every pending dismissal; uncertainty never enables blind retry", async () => {
    const pending = deferred<GitActionResult>();
    fixture.squashResponse = () => pending.promise;
    await render();
    await open();
    await act(async () => {
      button("Squash locally").click();
      button("Squash locally").click();
    });
    await flush();
    expect(mutations()).toHaveLength(1);
    expect(button("Cancel").disabled).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>("button:has(.sr-only)")
        ?.disabled,
    ).toBe(true);
    await act(async () =>
      document
        .querySelector('[role="dialog"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    );
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () =>
      pending.resolve({
        ok: false,
        blockedReason: "publication-uncertain",
        message: "Inspect local branch",
      }),
    );
    await flush();
    expect(button("Squash locally").disabled).toBe(true);
    expect(button("Inspect / refresh history")).toBeDefined();
    expect(container.textContent).not.toContain("Remote unchanged.");
  });
  it("cancel discards draft, retains checkboxes, and away/back query scope cannot revive old reads", async () => {
    await render();
    await open();
    await edit("Unsubmitted edit");
    await click("Cancel");
    expect(view.squashSelectedHashes).toHaveLength(2);
    expect(mutations()).toHaveLength(0);
    const pending = deferred<CommitMessageResponse>();
    fixture.messageResponse = () => pending.promise;
    await click("Squash 2 commits");
    await act(async () => {
      view.setSearchText("x");
    });
    expect(view.squashSelectedHashes).toEqual([]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => view.clearSearch());
    await act(async () =>
      pending.resolve({
        message: "Stale draft",
        branch: "refs/heads/main",
        headOid: squashOids.descendant,
      }),
    );
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("reconnect invalidates open preparation and pending lease; changed source cannot be confirmed", async () => {
    await render();
    await open();
    await click("Squash locally");
    fixture.prepareResponse = async () => ({
      status: "ready",
      alreadyCurrent: false,
      snapshot: {
        branch: "refs/heads/main",
        sourceOid: "f".repeat(40),
        expectedRemoteOid: squashOids.descendant,
        remoteName: "origin",
        destinationRef: "refs/heads/main",
        remoteIdentity: "remote",
        repositoryIdentity: "repo",
      },
    });
    await click("Publish rewritten branch");
    expect(document.body.textContent).toContain(
      "Local history changed after squash",
    );
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (entry) => entry.textContent === "Publish Branch",
      ),
    ).toBe(false);
    await act(async () => fixture.bind(2));
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).not.toContain("Publish rewritten branch");
  });
  it("clears selection during follow-active checkout, refreshed row loss and availability changes", async () => {
    await render();
    await select();
    fixture.branch = "checkout";
    await act(async () => {
      await qc.invalidateQueries();
    });
    await flush();
    expect(view.activeBranchRef).toBe("refs/heads/checkout");
    expect(view.squashSelectedHashes).toEqual([]);
    await select();
    fixture.logs = fixture.logs.filter(
      (entry) => entry.hash !== squashOids.oldest,
    );
    await act(async () => {
      await qc.invalidateQueries();
    });
    await flush();
    expect(view.squashSelectedHashes).toEqual([]);
    available = false;
    await render();
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label^="Select"]')!
        .disabled,
    ).toBe(true);
    expect(button("Squash commits").disabled).toBe(true);
  });
  it.each([
    "root",
    "project",
    "profile",
    "worktree",
    "branch",
    "generation",
    "page",
    "availability",
  ] as const)(
    "fences pending full-message reads across %s changes",
    async (change) => {
      fixture.logs = [
        ...fixture.logs,
        ...Array.from({ length: 197 }, (_, index) => ({
          ...fixture.logs[0],
          hash: String(index).padStart(40, "0"),
          parents: [],
        })),
      ];
      const pending = deferred<CommitMessageResponse>();
      fixture.messageResponse = () => pending.promise;
      await render();
      await open();
      await act(async () => {
        if (change === "root") view.setRootId("nested/history");
        if (change === "project")
          fixture.target = { ...fixture.target, project: "other-project" };
        if (change === "profile")
          fixture.target = { ...fixture.target, profileId: "other-profile" };
        if (change === "worktree")
          fixture.target = {
            ...fixture.target,
            worktreePath: "/tmp/other-worktree",
          };
        if (change === "branch") view.selectBranchRef("refs/heads/other");
        if (change === "generation") fixture.bind(2);
        if (change === "page") view.nextPage();
        if (change === "availability") available = false;
      });
      await render();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(view.squashSelectedHashes).toEqual([]);
      await act(async () =>
        pending.resolve({
          message: "Old scope",
          branch: "refs/heads/main",
          headOid: squashOids.descendant,
        }),
      );
      await flush();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(mutations()).toHaveLength(0);
    },
  );
  it("forbids blank-only drafts and turns ambiguous transport loss into inspection, not retry", async () => {
    await render();
    await open();
    await edit(" \n\t");
    expect(button("Squash locally").disabled).toBe(true);
    await edit("Unchanged draft also valid");
    fixture.squashResponse = async () => {
      throw new Error("Connection lost after request");
    };
    await click("Squash locally");
    expect(button("Squash locally").disabled).toBe(true);
    expect(document.body.textContent).toContain("rewrite may have happened");
    expect(mutations()).toHaveLength(1);
  });
  it.each(["success", "uncertain"] as const)(
    "keeps a submitted %s outcome when refresh removes selected rows",
    async (outcome) => {
      const pending = deferred<GitActionResult>();
      fixture.squashResponse = () => pending.promise;
      await render();
      await open();
      await click("Squash locally");
      fixture.logs = [];
      await act(async () => {
        await qc.invalidateQueries();
      });
      await flush();
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(view.squashSelectedHashes).toEqual([]);
      await act(async () =>
        pending.resolve(
          outcome === "success"
            ? {
                ok: true,
                newTargetOid: squashOids.squash,
                newHeadOid: squashOids.tip,
              }
            : {
                ok: false,
                blockedReason: "publication-uncertain",
                message: "Inspect local branch",
              },
        ),
      );
      await flush();
      if (outcome === "success") {
        expect(container.textContent).toContain(
          "Squashed 2 commits locally. Remote unchanged.",
        );
        expect(button("Publish rewritten branch")).toBeDefined();
      } else {
        expect(button("Squash locally").disabled).toBe(true);
        expect(button("Inspect / refresh history")).toBeDefined();
        expect(container.textContent).not.toContain("Remote unchanged.");
      }
      expect(mutations()).toHaveLength(1);
    },
  );
  it("retains draft on typed stale HTTP rejection without making that frozen snapshot retryable", async () => {
    const fetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      (input: string | URL | Request, init?: RequestInit) =>
        new URL(String(input)).pathname.endsWith("/squash")
          ? Promise.resolve(
              new Response(
                JSON.stringify({
                  error: "Branch moved; refresh and reselect",
                  code: "STALE_REF",
                }),
                {
                  status: 409,
                  headers: { "content-type": "application/json" },
                },
              ),
            )
          : fetch(input, init),
    );
    await render();
    await open();
    await edit("Keep this body for copying");
    await click("Squash locally");
    expect(document.querySelector("textarea")!.value).toBe(
      "Keep this body for copying",
    );
    expect(document.body.textContent).toContain(
      "Branch moved; refresh and reselect",
    );
    expect(button("Squash locally").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(false);
  });
});
