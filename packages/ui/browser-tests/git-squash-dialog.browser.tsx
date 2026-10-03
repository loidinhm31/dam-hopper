import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { CommitMessageResponse, GitActionResult } from "@/api/client.js";
import { WorkspaceGitPanel } from "@/components/organisms/WorkspaceGitPanel.js";
import { TerminalFloatingToolPanel } from "@/components/organisms/TerminalFloatingToolPanel.js";
import { resetGitHistoryStore } from "@/stores/git-history.js";
import {
  deferred,
  installSquashFixture,
  squashEntry,
  squashOids,
  type SquashFixture,
} from "@/test-fixtures/git-squash.js";
import "@/index.css";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let fixture: SquashFixture;
let root: Root;
let container: HTMLDivElement;
let qc: QueryClient;
let initialPointerEvents: string;
function Harness() {
  const [clicks, setClicks] = useState(0);
  return (
    <QueryClientProvider client={qc}>
      <button onClick={() => setClicks((value) => value + 1)}>
        IDE control
      </button>
      <output aria-label="IDE activations">{clicks}</output>
      <input aria-label="Terminal input" />
      <div className="relative h-[700px]">
        <TerminalFloatingToolPanel
          open
          title="Git"
          onClose={() => {}}
          content={
            <WorkspaceGitPanel
              project={fixture.target.project}
              target={fixture.target}
            />
          }
        />
      </div>
    </QueryClientProvider>
  );
}
beforeEach(async () => {
  resetGitHistoryStore();
  fixture = installSquashFixture();
  initialPointerEvents = document.body.style.pointerEvents;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await page.viewport(1280, 900);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
  await expect
    .element(page.getByRole("checkbox", { name: /^Select aaaaaaa:/ }))
    .toBeEnabled();
});
afterEach(async () => {
  await act(async () => root.unmount());
  qc.clear();
  fixture.destroy();
  container.remove();
  vi.unstubAllGlobals();
});
async function selectAndOpen() {
  await userEvent.click(
    page.getByRole("checkbox", { name: /^Select aaaaaaa:/ }),
  );
  const newest = page.getByRole("checkbox", { name: /^Select bbbbbbb:/ });
  await userEvent.click(newest);
  await expect
    .element(
      page.getByRole("button", { name: "Squash 2 commits", exact: true }),
    )
    .toBeEnabled();
  await userEvent.click(
    page.getByRole("button", { name: "Squash 2 commits", exact: true }),
  );
  await expect
    .element(
      page.getByRole("dialog", { name: "Squash 2 commits", exact: true }),
    )
    .toBeVisible();
  await expect
    .element(page.getByRole("textbox", { name: "Combined commit message" }))
    .toBeEnabled();
  await expect
    .poll(() => document.activeElement)
    .toBe(
      page.getByRole("textbox", { name: "Combined commit message" }).element(),
    );
}
async function inputRecovered() {
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await expect
    .poll(() => document.body.style.pointerEvents)
    .toBe(initialPointerEvents);
  await userEvent.click(page.getByRole("button", { name: "IDE control" }));
  await expect
    .element(page.getByRole("status", { name: "IDE activations" }))
    .toHaveTextContent("1");
  await userEvent.click(page.getByRole("textbox", { name: "Terminal input" }));
  await userEvent.keyboard("echo recovered");
  await expect
    .element(page.getByRole("textbox", { name: "Terminal input" }))
    .toHaveValue("echo recovered");
}
describe("real squash controller modal input handoff", () => {
  it("checkbox Space does not open details; cancel restores launcher and keeps selection", async () => {
    const oldest = page.getByRole("checkbox", { name: /^Select aaaaaaa:/ });
    await userEvent.click(oldest);
    await userEvent.keyboard(" ");
    await expect.element(oldest).not.toBeChecked();
    await expect
      .element(
        page.getByRole("button", { name: "Squash commits", exact: true }),
      )
      .toBeDisabled();
    expect(container.querySelector('[title="Cũ"]')).toBeNull();
    await selectAndOpen();
    await userEvent.fill(
      page.getByRole("textbox", { name: "Combined commit message" }),
      "Đặng — draft not submitted",
    );
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect
      .poll(() => document.activeElement?.textContent)
      .toBe("Squash 2 commits");
    expect(
      fixture.requests.some((request) =>
        request.url.pathname.endsWith("/squash"),
      ),
    ).toBe(false);
    await expect.element(oldest).toBeChecked();
    await inputRecovered();
  });
  it("pending X/Cancel/Escape cannot dismiss; success after removed rows focuses surviving toolbar and unlocks terminal input", async () => {
    const pending = deferred<GitActionResult>();
    fixture.squashResponse = () => pending.promise;
    await selectAndOpen();
    await userEvent.fill(
      page.getByRole("textbox", { name: "Combined commit message" }),
      "Squashed Đặng\n\nComplete body  ",
    );
    await userEvent.click(
      page.getByRole("button", { name: "Squash locally", exact: true }),
    );
    await expect
      .element(page.getByRole("button", { name: "Cancel", exact: true }))
      .toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Close", exact: true }))
      .toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect
      .element(
        page.getByRole("dialog", { name: "Squash 2 commits", exact: true }),
      )
      .toBeVisible();
    await act(async () => {
      fixture.logs = [
        squashEntry(
          squashOids.tip,
          [squashOids.squash],
          "Rewritten descendant",
        ),
        squashEntry(squashOids.squash, [], "Squashed Đặng"),
      ];
      pending.resolve({
        ok: true,
        hash: squashOids.squash,
        newTargetOid: squashOids.squash,
        newHeadOid: squashOids.tip,
        rewrittenCount: 2,
      });
    });
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect
      .poll(() => document.activeElement?.getAttribute("aria-label"))
      .toBe("Git history actions");
    expect(
      fixture.requests.filter((request) =>
        request.url.pathname.endsWith("/squash"),
      ),
    ).toHaveLength(1);
    expect(
      fixture.requests.find((request) =>
        request.url.pathname.endsWith("/squash"),
      )?.body?.message,
    ).toBe("Squashed Đặng\n\nComplete body  \n");
    await expect
      .element(
        page.getByRole("button", {
          name: "Publish rewritten branch",
          exact: true,
        }),
      )
      .toBeVisible();
    await userEvent.click(
      page.getByRole("button", {
        name: "Publish rewritten branch",
        exact: true,
      }),
    );
    await expect
      .element(page.getByRole("dialog", { name: "Confirm Leased Publication" }))
      .toBeVisible();
    expect(page.getByRole("dialog").element().textContent).toContain(
      squashOids.tip,
    );
    await userEvent.click(
      page.getByRole("button", { name: "Cancel", exact: true }),
    );
    await expect
      .poll(() => document.activeElement?.textContent)
      .toBe("Publish rewritten branch");
    expect(
      fixture.requests.some((request) =>
        request.url.pathname.endsWith("/push/publish"),
      ),
    ).toBe(false);
    await inputRecovered();
  });
  it("at 320px keeps long Unicode draft and footer inside viewport; consent retains editable draft", async () => {
    await page.viewport(320, 760);
    fixture.squashResponse = async () => ({
      ok: false,
      blockedReason: "signature-consent-required",
      message: "Explicit signature removal required",
    });
    await selectAndOpen();
    const message = page.getByRole("textbox", {
      name: "Combined commit message",
    });
    await userEvent.fill(message, "Tiếng Việt: ă â đ ê ô ơ ư\n\n".repeat(12));
    await userEvent.click(
      page.getByRole("button", { name: "Squash locally", exact: true }),
    );
    await expect
      .element(
        page.getByRole("checkbox", {
          name: "Allow removal of invalidated signatures",
          exact: true,
        }),
      )
      .not.toBeChecked();
    await expect
      .element(message)
      .toHaveValue("Tiếng Việt: ă â đ ê ô ơ ư\n\n".repeat(12));
    const dialog = page.getByRole("dialog").element().getBoundingClientRect();
    expect(dialog.left).toBeGreaterThanOrEqual(0);
    expect(dialog.right).toBeLessThanOrEqual(320);
    await userEvent.click(
      page.getByRole("button", { name: "Cancel", exact: true }),
    );
    await inputRecovered();
  });
  it.each(["graph", "list"] as const)(
    "preserves row keyboard/context details independently of checkboxes in %s",
    async (presentation) => {
      if (presentation === "list") {
        for (const entry of fixture.logs)
          fixture.messages[entry.hash] =
            `${fixture.messages[entry.hash] ?? entry.message}\nshared search\n`;
        await userEvent.fill(
          page.getByRole("textbox", { name: "Search commit messages" }),
          "shared search",
        );
        await expect
          .element(page.getByText("(filtered)", { exact: true }))
          .toBeVisible();
        await expect
          .poll(() => container.querySelectorAll("tbody svg").length)
          .toBe(0);
      }
      const newestRow = page.getByRole("row", { name: /Select bbbbbbb:/ });
      await expect.element(newestRow).toBeVisible();
      await act(async () => (newestRow.element() as HTMLElement).focus());
      await userEvent.keyboard("{Enter}");
      expect(container.querySelector('[title="Mới"]')).not.toBeNull();
      const oldestCheckbox = page.getByRole("checkbox", {
        name: /^Select aaaaaaa:/,
      });
      await userEvent.click(oldestCheckbox);
      await expect.element(oldestCheckbox).toBeChecked();
      expect(container.querySelector('[title="Mới"]')).not.toBeNull();
      await userEvent.click(
        page
          .getByRole("row", { name: /Select aaaaaaa:/ })
          .getByText("Cũ", { exact: true }),
        { button: "right" },
      );
      await expect.element(page.getByRole("menu")).toBeVisible();
      expect(container.querySelector('[title="Cũ"]')).not.toBeNull();
      await userEvent.keyboard("{Escape}");
      await expect.element(oldestCheckbox).toBeChecked();
      await expect
        .element(
          page.getByRole("button", { name: "Squash commits", exact: true }),
        )
        .toBeDisabled();
    },
  );
  it("ignores late full-message completion after reconnect without stealing new-scope input focus", async () => {
    const pending = deferred<CommitMessageResponse>();
    fixture.messageResponse = () => pending.promise;
    await userEvent.click(
      page.getByRole("checkbox", { name: /^Select aaaaaaa:/ }),
    );
    await userEvent.click(
      page.getByRole("checkbox", { name: /^Select bbbbbbb:/ }),
    );
    await userEvent.click(
      page.getByRole("button", { name: "Squash 2 commits", exact: true }),
    );
    await expect
      .element(page.getByRole("dialog", { name: "Squash 2 commits" }))
      .toBeVisible();
    await act(async () => fixture.bind(2));
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    const input = page.getByRole("textbox", { name: "Terminal input" });
    await userEvent.click(input);
    await userEvent.keyboard("new scope");
    await act(async () =>
      pending.resolve({
        message: "Old scope draft",
        branch: "refs/heads/main",
        headOid: squashOids.descendant,
      }),
    );
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(input).toHaveValue("new scope");
    expect(document.activeElement).toBe(input.element());
    expect(
      fixture.requests.some((request) =>
        request.url.pathname.endsWith("/squash"),
      ),
    ).toBe(false);
  });
});
