import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "@/components/ui/ContextMenu.js";
import { useBrowserContextMenuSuppression } from "@/hooks/use-browser-context-menu-suppression.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function TestApp() {
  useBrowserContextMenuSuppression();

  return (
    <>
      <button data-testid="plain-target" type="button">
        Plain target
      </button>
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <button data-testid="menu-trigger" type="button">
            Menu trigger
          </button>
        </ContextMenu.Trigger>
        <ContextMenu.Content>Configured action</ContextMenu.Content>
      </ContextMenu.Root>
    </>
  );
}

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<TestApp />));
}

function contextMenuEvent() {
  return new MouseEvent("contextmenu", {
    bubbles: true,
    button: 2,
    cancelable: true,
    clientX: 80,
    clientY: 60,
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("global native context-menu suppression in Chromium", () => {
  it("suppresses unconfigured targets and preserves configured menus", async () => {
    await mount();
    const plainTarget = document.querySelector<HTMLElement>(
      "[data-testid=plain-target]",
    );
    const plainEvent = contextMenuEvent();
    plainTarget?.addEventListener("contextmenu", (event) =>
      event.stopPropagation(),
    );

    await act(async () => plainTarget?.dispatchEvent(plainEvent));

    expect(plainEvent.defaultPrevented).toBe(true);
    expect(document.querySelector("[role=menu]")).toBeNull();

    const trigger = document.querySelector<HTMLElement>(
      "[data-testid=menu-trigger]",
    );
    const triggerEvent = contextMenuEvent();

    await act(async () => trigger?.dispatchEvent(triggerEvent));

    expect(triggerEvent.defaultPrevented).toBe(true);
    await vi.waitFor(() =>
      expect(document.querySelector("[role=menu]")?.textContent).toContain(
        "Configured action",
      ),
    );
  });
});
