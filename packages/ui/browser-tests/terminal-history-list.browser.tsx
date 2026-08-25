import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalHistoryList } from "@/components/organisms/TerminalHistoryList.js";
import type { HistorySearchResult } from "@/lib/command-history.js";
import "@/index.css";

const results: HistorySearchResult[] = [
  {
    score: 1,
    entry: {
      id: "one",
      command: "git status --short",
      searchText: "git status --short",
      lastUsedAt: 0,
      useCount: 1,
      projectUsage: {},
    },
  },
  {
    score: 1,
    entry: {
      id: "two",
      command: "printf 'first\nsecond'",
      searchText: "printf first second",
      lastUsedAt: 0,
      useCount: 1,
      projectUsage: {},
    },
  },
];

function HistoryFixture({ onUse }: { onUse: (command: string) => void }) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("git");
  return (
    <TerminalHistoryList
      open={open}
      query={query}
      results={results}
      onOpenChange={setOpen}
      onQueryChange={setQuery}
      onUse={onUse}
    />
  );
}

describe("TerminalHistoryList in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("focuses its explicit dialog and inserts only on Use", async () => {
    const onUse = vi.fn();
    await act(async () => root.render(<HistoryFixture onUse={onUse} />));

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const search = document.querySelector<HTMLInputElement>(
      'input[placeholder="Type to filter commands"]',
    );
    const use = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Use" && !button.disabled,
    );

    expect(dialog).not.toBeNull();
    expect(search?.labels?.[0]?.textContent).toContain("Search history");
    expect(dialog?.textContent).toContain("git status --short");
    expect(document.activeElement).toBe(search);
    expect(dialog?.querySelector('[aria-selected="true"]')).toBeNull();
    await act(async () => use?.click());
    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledWith("git status --short");
  });

  it("does not permit a multi-line command to be inserted", async () => {
    await act(async () => root.render(<HistoryFixture onUse={vi.fn()} />));

    const disabledUse = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Use" && button.disabled);
    expect(disabledUse).toBeDefined();
    expect(disabledUse?.getAttribute("aria-describedby")).toBe(
      "terminal-history-multiline-note",
    );
    expect(document.body.textContent).toContain(
      "Multi-line commands can be copied but cannot be inserted.",
    );
  });

  it("copies without sending a command to the terminal", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const onUse = vi.fn();
    await act(async () => root.render(<HistoryFixture onUse={onUse} />));

    const copy = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Copy",
    );
    await act(async () => copy?.click());

    expect(writeText).toHaveBeenCalledWith("git status --short");
    expect(onUse).not.toHaveBeenCalled();
  });
});
