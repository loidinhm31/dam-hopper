// @vitest-environment jsdom
import * as React from "react";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GitLogEntry } from "@/api/client.js";
import {
  GitLogTree,
  getDropCommitMenuState,
  getEditCommitMessageMenuState,
  getUndoLastCommitMenuState,
  isHeadCommit,
} from "./GitLogTree.js";

const sampleLogs: GitLogEntry[] = [
  {
    hash: "a1b2c3d4e5f67890123456789012345678901234",
    parents: ["b2c3d4e5f678901234567890123456789012345a"],
    authorName: "Alice Dev",
    authorEmail: "alice@example.com",
    timestamp: 1727800000,
    message: "feat: add history search",
    refs: ["HEAD -> main", "origin/main"],
    isPushed: true,
  },
  {
    hash: "b2c3d4e5f678901234567890123456789012345a",
    parents: [],
    authorName: "Bob Dev",
    authorEmail: "bob@example.com",
    timestamp: 1727700000,
    message: "chore: initial commit",
    refs: [],
    isPushed: true,
  },
];

describe("GitLogTree helpers", () => {
  it("disables drop commit for pushed commits", () => {
    expect(getDropCommitMenuState({ isPushed: true })).toEqual({
      disabled: true,
      title: "Drop commit is only available for commits not pushed upstream",
    });
    expect(getDropCommitMenuState({ isPushed: false })).toEqual({
      disabled: false,
      title: undefined,
    });
  });

  it("enables Edit Commit Message for both pushed and unpushed commits", () => {
    expect(getEditCommitMessageMenuState({ isPushed: true })).toEqual({
      disabled: false,
      title: undefined,
    });
    expect(getEditCommitMessageMenuState({ isPushed: false })).toEqual({
      disabled: false,
      title: undefined,
    });
  });

  it("enables undo last commit only for HEAD", () => {
    expect(
      getUndoLastCommitMenuState({ isHead: true, isPushed: false }),
    ).toEqual({
      disabled: false,
      title: undefined,
    });
    expect(
      getUndoLastCommitMenuState({ isHead: false, isPushed: false }),
    ).toEqual({
      disabled: true,
      title: "Undo Last Commit is only available on HEAD",
    });
    expect(
      getUndoLastCommitMenuState({ isHead: true, isPushed: true }),
    ).toEqual({
      disabled: true,
      title:
        "Undo Last Commit is only available for commits not pushed upstream",
    });
  });

  it("detects HEAD from commit refs", () => {
    expect(isHeadCommit({ refs: ["HEAD -> main", "origin/main"] })).toBe(true);
    expect(isHeadCommit({ refs: ["HEAD"] })).toBe(true);
    expect(isHeadCommit({ refs: ["origin/main", "tag: v1"] })).toBe(false);
  });
});

describe("GitLogTree presentation modes", () => {
  it("renders graph SVG elements in graph presentation mode", () => {
    const html = renderToStaticMarkup(
      <GitLogTree logs={sampleLogs} presentation="graph" />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("<circle");
    expect(html).toContain("feat: add history search");
    expect(html).toContain("a1b2c3d");
  });

  it("omits graph SVG and circle elements in list presentation mode", () => {
    const html = renderToStaticMarkup(
      <GitLogTree logs={sampleLogs} presentation="list" />,
    );
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<circle");
    expect(html).toContain("feat: add history search");
    expect(html).toContain("chore: initial commit");
    expect(html).toContain("a1b2c3d");
    expect(html).toContain("b2c3d4e");
    expect(html).toContain("Alice Dev");
  });

  it("renders custom emptyMessage when logs are empty", () => {
    const html = renderToStaticMarkup(
      <GitLogTree logs={[]} emptyMessage="No matching commits found." />,
    );
    expect(html).toContain("No matching commits found.");
  });

  it("renders default empty message when logs are empty and no emptyMessage passed", () => {
    const html = renderToStaticMarkup(<GitLogTree logs={[]} />);
    expect(html).toContain("No commits found.");
  });
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
describe.each(["graph", "list"] as const)(
  "independent checkbox channel in %s rows",
  (presentation) => {
    it("keeps click and nested Space separate from row detail selection and preserves row keyboard/context menu", async () => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      function Harness() {
        const [selected, setSelected] = useState<GitLogEntry | null>(null);
        const [hashes, setHashes] = useState<string[]>([]);
        return (
          <>
            <GitLogTree
              logs={sampleLogs}
              presentation={presentation}
              selectedHash={selected?.hash}
              onSelectCommit={setSelected}
              squashSelectedHashes={hashes}
              onToggleSquashCommit={(hash) =>
                setHashes((old) =>
                  old.includes(hash)
                    ? old.filter((oid) => oid !== hash)
                    : [...old, hash],
                )
              }
            />
            <output aria-label="Detail hash">{selected?.hash}</output>
          </>
        );
      }
      try {
        await act(async () => root.render(<Harness />));
        const input = container.querySelector<HTMLInputElement>(
          'input[type="checkbox"]',
        )!;
        const row = container.querySelector("tbody tr")!;
        const detail = container.querySelector("output")!;
        await act(async () => input.click());
        expect(input.checked).toBe(true);
        expect(detail.textContent).toBe("");
        await act(async () =>
          input.dispatchEvent(
            new KeyboardEvent("keydown", { key: " ", bubbles: true }),
          ),
        );
        expect(detail.textContent).toBe("");
        await act(async () =>
          row.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
          ),
        );
        expect(detail.textContent).toBe(sampleLogs[0].hash);
        expect(input.checked).toBe(true);
        const secondRow = container.querySelectorAll("tbody tr")[1];
        await act(async () =>
          secondRow.dispatchEvent(
            new KeyboardEvent("keydown", { key: " ", bubbles: true }),
          ),
        );
        expect(detail.textContent).toBe(sampleLogs[1].hash);
        await act(async () =>
          row.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, button: 2 }),
          ),
        );
        expect(detail.textContent).toBe(sampleLogs[0].hash);
        expect(input.checked).toBe(true);
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    });
  },
);

describe("GitLogTree context menu accessibility & branch eligibility", () => {
  it("enables Edit Commit Message when callback is provided and fires callback on select", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onEdit = vi.fn();
    try {
      await act(async () =>
        root.render(
          <GitLogTree logs={sampleLogs} onEditCommitMessage={onEdit} />,
        ),
      );
      const row = container.querySelector("tbody tr")!;
      await act(async () =>
        row.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, button: 2 }),
        ),
      );
      const editItem = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((item) => item.textContent?.includes("Edit Commit Message"))!;
      expect(editItem).toBeDefined();
      expect(editItem.hasAttribute("data-disabled")).toBe(false);
      expect(editItem.getAttribute("aria-describedby")).toBeNull();
      await act(async () => {
        editItem.click();
      });
      expect(onEdit).toHaveBeenCalledWith(sampleLogs[0]);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("disables Edit Commit Message when callback is omitted, exposing title, aria-describedby and descriptive text", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(<GitLogTree logs={sampleLogs} onEditCommitMessage={undefined} />),
      );
      const row = container.querySelector("tbody tr")!;
      await act(async () =>
        row.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, button: 2 }),
        ),
      );
      const editItem = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((item) => item.textContent?.includes("Edit Commit Message"))!;
      expect(editItem).toBeDefined();
      expect(editItem.hasAttribute("data-disabled")).toBe(true);
      expect(editItem.getAttribute("title")).toBe(
        "Edit Commit Message is only available for local branches",
      );
      const describedById = editItem.getAttribute("aria-describedby");
      expect(describedById).toBeTruthy();
      const descriptionParagraph = document.getElementById(describedById!);
      expect(descriptionParagraph).not.toBeNull();
      expect(descriptionParagraph?.textContent).toBe(
        "Edit Commit Message is only available for local branches",
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});

describe.each(["graph", "list"] as const)(
  "row selection highlight, scroll, and reveal focus in %s mode",
  (presentation) => {
    it("highlights matching row and scrolls it into view", async () => {
      const scrollSpy = vi.fn();
      window.HTMLElement.prototype.scrollIntoView = scrollSpy;

      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);

      try {
        await act(async () => {
          root.render(
            <GitLogTree
              logs={sampleLogs}
              presentation={presentation}
              selectedHash={sampleLogs[0].hash}
            />,
          );
        });

        const selectedRow = container.querySelector<HTMLTableRowElement>(
          `tr[data-commit-hash="${sampleLogs[0].hash}"]`,
        );
        expect(selectedRow).not.toBeNull();
        expect(selectedRow?.getAttribute("aria-selected")).toBe("true");
        expect(selectedRow?.getAttribute("data-selected")).toBe("true");
        expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" });

        const unselectedRow = container.querySelector<HTMLTableRowElement>(
          `tr[data-commit-hash="${sampleLogs[1].hash}"]`,
        );
        expect(unselectedRow?.getAttribute("aria-selected")).toBe("false");
        expect(unselectedRow?.getAttribute("data-selected")).toBeNull();
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    });

    it("focuses destination row when revealNonce is provided, but does not blanket focus without revealNonce", async () => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);

      try {
        // Plain selectedHash: no revealNonce -> does not steal focus
        await act(async () => {
          root.render(
            <GitLogTree
              logs={sampleLogs}
              presentation={presentation}
              selectedHash={sampleLogs[0].hash}
            />,
          );
        });

        const firstRow = container.querySelector<HTMLTableRowElement>(
          `tr[data-commit-hash="${sampleLogs[0].hash}"]`,
        )!;
        expect(document.activeElement).not.toBe(firstRow);

        // Reveal request with revealNonce -> focuses row
        await act(async () => {
          root.render(
            <GitLogTree
              logs={sampleLogs}
              presentation={presentation}
              selectedHash={sampleLogs[0].hash}
              revealNonce={42}
            />,
          );
        });

        expect(document.activeElement).toBe(firstRow);
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    });

    it("re-triggers scroll into view when revealNonce increments with same hash", async () => {
      const scrollSpy = vi.fn();
      window.HTMLElement.prototype.scrollIntoView = scrollSpy;

      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);

      try {
        await act(async () => {
          root.render(
            <GitLogTree
              logs={sampleLogs}
              presentation={presentation}
              selectedHash={sampleLogs[0].hash}
              revealNonce={1}
            />,
          );
        });

        expect(scrollSpy).toHaveBeenCalledTimes(1);

        await act(async () => {
          root.render(
            <GitLogTree
              logs={sampleLogs}
              presentation={presentation}
              selectedHash={sampleLogs[0].hash}
              revealNonce={2}
            />,
          );
        });

        expect(scrollSpy).toHaveBeenCalledTimes(2);
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    });

    it("does not scroll or highlight when selectedHash is outside history", async () => {
      const scrollSpy = vi.fn();
      window.HTMLElement.prototype.scrollIntoView = scrollSpy;

      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);

      try {
        await act(async () => {
          root.render(
            <GitLogTree
              logs={sampleLogs}
              presentation={presentation}
              selectedHash="outside-hash-not-in-logs"
            />,
          );
        });

        expect(scrollSpy).not.toHaveBeenCalled();
        const selectedRows = container.querySelectorAll('tr[aria-selected="true"]');
        expect(selectedRows.length).toBe(0);
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    });
  },
);
