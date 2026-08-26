// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "@/components/ui/ContextMenu.js";
import { useBrowserContextMenuSuppression } from "./use-browser-context-menu-suppression.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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
      <ContextMenu.Root>
        <ContextMenu.Trigger disabled>
          <button data-testid="disabled-menu-trigger" type="button">
            Disabled menu trigger
          </button>
        </ContextMenu.Trigger>
        <ContextMenu.Content>Disabled configured action</ContextMenu.Content>
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

describe("useBrowserContextMenuSuppression", () => {
  it("suppresses an unconfigured right-click before target propagation", async () => {
    await mount();
    const plainTarget = document.querySelector<HTMLElement>(
      "[data-testid=plain-target]",
    );
    const observedDefaultPrevention = vi.fn();
    plainTarget?.addEventListener("contextmenu", (event) => {
      observedDefaultPrevention(event.defaultPrevented);
      event.stopPropagation();
    });
    const activeEvent = contextMenuEvent();

    await act(async () => plainTarget?.dispatchEvent(activeEvent));

    expect(activeEvent.defaultPrevented).toBe(true);
    expect(observedDefaultPrevention).toHaveBeenCalledWith(true);
    expect(document.querySelector("[role=menu]")).toBeNull();
  });

  it("cleans up suppression on unmount", async () => {
    await mount();

    act(() => root?.unmount());
    root = null;
    const afterUnmount = contextMenuEvent();
    document.body.dispatchEvent(afterUnmount);

    expect(afterUnmount.defaultPrevented).toBe(false);
  });

  it("preserves configured Radix context-menu opening", async () => {
    await mount();
    const trigger = document.querySelector<HTMLElement>(
      "[data-testid=menu-trigger]",
    );
    const event = contextMenuEvent();

    await act(async () => trigger?.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelector("[role=menu]")?.textContent).toContain(
      "Configured action",
    );
  });

  it("suppresses disabled shared triggers without opening a menu", async () => {
    await mount();
    const trigger = document.querySelector<HTMLElement>(
      "[data-testid=disabled-menu-trigger]",
    );
    const event = contextMenuEvent();

    await act(async () => trigger?.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector("[role=menu]")).toBeNull();
  });
});
