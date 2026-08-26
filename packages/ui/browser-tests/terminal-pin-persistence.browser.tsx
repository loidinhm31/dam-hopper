import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DndContext } from "@dnd-kit/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DraggableTab } from "@/components/organisms/TabBar.js";
import {
  loadPinnedTerminalIds,
  savePinnedTerminalIds,
  TERMINAL_PIN_STORAGE_KEY,
} from "@/lib/terminal-pin-persistence.js";
import "@/index.css";

const SESSION_ID = "free:persistence-test";

function PinPersistenceFixture() {
  const [pinnedIds, setPinnedIds] = useState(loadPinnedTerminalIds);
  const isPinned = pinnedIds.has(SESSION_ID);

  function togglePin() {
    const nextPinnedIds = new Set(pinnedIds);
    if (isPinned) {
      nextPinnedIds.delete(SESSION_ID);
    } else {
      nextPinnedIds.add(SESSION_ID);
    }
    savePinnedTerminalIds(nextPinnedIds);
    setPinnedIds(nextPinnedIds);
  }

  return (
    <DndContext>
      <DraggableTab
        paneId="pane-1"
        tab={{ sessionId: SESSION_ID, label: "Terminal 1", isPinned }}
        isActive
        onClose={() => undefined}
        onSelect={() => undefined}
        onTogglePin={togglePin}
      />
    </DndContext>
  );
}

describe("terminal pin persistence in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;

  async function mount() {
    root = createRoot(container);
    await act(async () => root.render(<PinPersistenceFixture />));
  }

  async function remount() {
    await act(async () => root.unmount());
    await mount();
  }

  beforeEach(async () => {
    sessionStorage.removeItem(TERMINAL_PIN_STORAGE_KEY);
    container = document.createElement("div");
    document.body.append(container);
    await mount();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    sessionStorage.removeItem(TERMINAL_PIN_STORAGE_KEY);
  });

  it("restores pin close protection after remount and persists unpinning", async () => {
    const pin = container.querySelector<HTMLButtonElement>(
      '[aria-label="Pin terminal"]',
    );
    expect(pin?.tagName).toBe("BUTTON");
    pin?.focus();
    await act(async () => pin?.click());

    expect(container.querySelector('[aria-label="Close terminal"]')).toBeNull();
    await remount();
    expect(
      container
        .querySelector<HTMLButtonElement>('[aria-label="Unpin terminal"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(container.querySelector('[aria-label="Close terminal"]')).toBeNull();

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Unpin terminal"]')
        ?.click(),
    );
    await remount();

    expect(
      container
        .querySelector<HTMLButtonElement>('[aria-label="Pin terminal"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      container.querySelector('[aria-label="Close terminal"]'),
    ).not.toBeNull();
  });
});
