import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { GitLogEntry } from "@/api/client.js";
import { GitLogTree } from "@/components/organisms/GitLogTree.js";
import { GitEditCommitMessageDialog } from "@/components/organisms/GitHistoryActions.js";
import { TerminalFloatingToolPanel } from "@/components/organisms/TerminalFloatingToolPanel.js";
import "@/index.css";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const originalCommit: GitLogEntry = {
  hash: "1".repeat(40),
  parents: [],
  authorName: "Smoke",
  authorEmail: "smoke@example.invalid",
  timestamp: 1_790_000_000,
  message: "Original message",
  refs: ["HEAD -> main"],
  isPushed: false,
};

function HistoryDialogHarness() {
  const [head, setHead] = useState(originalCommit);
  const [editing, setEditing] = useState<GitLogEntry | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [clicks, setClicks] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setClicks((value) => value + 1)}>
        IDE control
      </button>
      <output aria-label="IDE activations">{clicks}</output>
      <input aria-label="Terminal input" />
      <div className="relative h-[650px]">
        <TerminalFloatingToolPanel
          open={panelOpen}
          title="Git"
          onClose={() => setPanelOpen(false)}
          content={
            <>
              <GitLogTree logs={[head]} onEditCommitMessage={setEditing} />
              <GitEditCommitMessageDialog
                commit={editing}
                originalMessage={editing?.message}
                loading={false}
                saving={false}
                onClose={() => setEditing(null)}
                onConfirm={(message) => {
                  // Model the successful refresh replacing the keyed history row.
                  setHead({ ...head, hash: "2".repeat(40), message });
                  setEditing(null);
                }}
              />
            </>
          }
        />
      </div>
    </>
  );
}

let root: Root;
let container: HTMLDivElement;
let initialPointerEvents: string;

beforeEach(async () => {
  initialPointerEvents = document.body.style.pointerEvents;
  await page.viewport(1280, 800);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<HistoryDialogHarness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  // Keep a failed modal-lock regression from poisoning subsequent browser suites.
  document.body.style.pointerEvents = initialPointerEvents;
});

async function openEditDialog() {
  const row = page.getByRole("row", { name: /HEAD -> main/ });
  await userEvent.click(row, { button: "right" });
  await userEvent.click(
    page.getByRole("menuitem", { name: "Edit Commit Message", exact: true }),
  );
  const dialog = page.getByRole("dialog", { name: "Edit Commit Message" });
  await expect.element(dialog).toBeVisible();
  await userEvent.fill(
    page.getByRole("textbox", { name: "Commit message" }),
    "Updated message",
  );
  // A shared registry must still block outside input while the dialog owns it.
  await expect
    .poll(() => getComputedStyle(document.body).pointerEvents)
    .toBe("none");
  await userEvent.keyboard("{Tab}");
  expect(dialog.element().contains(document.activeElement)).toBe(true);
}

async function expectApplicationInputRecovered() {
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
  await expect
    .poll(() => document.body.style.pointerEvents)
    .toBe(initialPointerEvents);
  const control = page.getByRole("button", { name: "IDE control" });
  await userEvent.click(control);
  await expect
    .element(page.getByRole("status", { name: "IDE activations" }))
    .toHaveTextContent("1");
  await userEvent.keyboard("{Enter}");
  await expect
    .element(page.getByRole("status", { name: "IDE activations" }))
    .toHaveTextContent("2");
  const input = page.getByRole("textbox", { name: "Terminal input" });
  await userEvent.click(input);
  await userEvent.keyboard("echo recovered");
  await expect.element(input).toHaveValue("echo recovered");
  expect(document.activeElement).toBe(input.element());
}

describe("Git history modal handoff in TERMINAL mode", () => {
  it("restores application input after saving and replacing the original commit row", async () => {
    await openEditDialog();
    await userEvent.click(
      page.getByRole("button", { name: "Edit Commit Message", exact: true }),
    );
    await expect
      .element(page.getByRole("row", { name: /Updated message/ }))
      .toBeVisible();
    await expectApplicationInputRecovered();
  });

  it("restores application input after cancel without replacing the commit row", async () => {
    await openEditDialog();
    await userEvent.click(
      page.getByRole("button", { name: "Cancel", exact: true }),
    );
    await expect
      .element(page.getByRole("row", { name: /Original message/ }))
      .toBeVisible();
    await expect
      .element(page.getByRole("row", { name: /Updated message/ }))
      .not.toBeInTheDocument();
    await expectApplicationInputRecovered();
  });
});
