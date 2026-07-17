// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ContextMenu.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function TestMenu({
  id,
  explicitPortal = true,
}: {
  id: string;
  explicitPortal?: boolean;
}) {
  const content = (
    <ContextMenuContent>
      <ContextMenuItem>{id} action</ContextMenuItem>
    </ContextMenuContent>
  );
  return (
    <ContextMenuRoot>
      <ContextMenuTrigger>
        <button data-trigger={id} type="button">
          {id}
        </button>
      </ContextMenuTrigger>
      {explicitPortal ? (
        <ContextMenuPortal>{content}</ContextMenuPortal>
      ) : (
        content
      )}
    </ContextMenuRoot>
  );
}

function InteractiveMenu({
  onFirstSelect = () => undefined,
  onSecondSelect = () => undefined,
}: {
  onFirstSelect?: () => void;
  onSecondSelect?: () => void;
}) {
  return (
    <ContextMenuRoot>
      <ContextMenuTrigger>
        <button data-trigger="interactive" type="button">
          Interactive trigger
        </button>
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent>
          <ContextMenuItem disabled onSelect={onFirstSelect}>
            Disabled action
          </ContextMenuItem>
          <ContextMenuItem onSelect={onSecondSelect}>
            First action
          </ContextMenuItem>
          <ContextMenuItem>Last action</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenuRoot>
  );
}

async function mount(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
}

async function openMenu(id: string) {
  const trigger = document.querySelector<HTMLButtonElement>(
    `[data-trigger="${id}"]`,
  );
  expect(trigger).not.toBeNull();
  await act(async () => {
    trigger?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        clientX: 120,
        clientY: 80,
      }),
    );
  });
}

async function pressKey(target: Element | null, key: string, shiftKey = false) {
  expect(target).not.toBeNull();
  await act(async () => {
    target?.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
        shiftKey,
      }),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("ContextMenu foundation", () => {
  it("exports the complete shared composition contract", () => {
    expect(ContextMenu).toEqual({
      Root: ContextMenuRoot,
      Trigger: ContextMenuTrigger,
      Portal: ContextMenuPortal,
      Content: ContextMenuContent,
      Item: ContextMenuItem,
      CheckboxItem: ContextMenuCheckboxItem,
      Label: ContextMenuLabel,
      Separator: ContextMenuSeparator,
    });
  });

  it("keeps trigger semantics and leaves content to the body portal", () => {
    const markup = renderToString(
      <ContextMenuRoot>
        <ContextMenuTrigger>
          <button type="button">Open</button>
        </ContextMenuTrigger>
        <ContextMenuPortal>
          <ContextMenuContent>
            <ContextMenuItem>Action</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenuPortal>
      </ContextMenuRoot>,
    );

    expect(markup).toMatch(/<button type="button"[^>]*>Open<\/button>/);
    expect(markup).not.toContain("Action");
  });

  it("mounts content under body and replaces the previous open menu", async () => {
    await mount(
      <>
        <TestMenu id="first" />
        <TestMenu id="second" />
      </>,
    );

    await openMenu("first");
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(
      "first action",
    );
    expect(
      document.querySelector("[data-radix-popper-content-wrapper]")
        ?.parentElement,
    ).toBe(document.body);

    await openMenu("second");
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(
      "second action",
    );
    expect(document.body.textContent).not.toContain("first action");
  });

  it("applies shared content semantics and available-space classes", async () => {
    await mount(<TestMenu id="defaults" />);
    await openMenu("defaults");

    const content = document.querySelector<HTMLElement>('[role="menu"]');
    expect(content).not.toBeNull();
    expect(content?.getAttribute("data-state")).toBe("open");
    expect(content?.hasAttribute("data-side")).toBe(true);
    expect(content?.hasAttribute("data-align")).toBe(true);
    expect(content?.className).toContain(
      "max-h-[var(--radix-context-menu-content-available-height)]",
    );
    expect(content?.className).toContain(
      "max-w-[var(--radix-context-menu-content-available-width)]",
    );
  });

  it.each([
    ["ContextMenu", false],
    ["F10", true],
  ])(
    "supports %s keyboard invocation and focuses the first enabled item",
    async (key, shiftKey) => {
      await mount(<InteractiveMenu />);
      const trigger = document.querySelector<HTMLElement>(
        '[data-trigger="interactive"]',
      );
      trigger?.focus();
      await pressKey(trigger, key, shiftKey);

      expect(document.querySelector('[role="menu"]')).not.toBeNull();
      expect(document.activeElement?.textContent).toContain("First action");
    },
  );

  it("exposes Radix roving-focus semantics for enabled item navigation", async () => {
    await mount(<InteractiveMenu />);
    await openMenu("interactive");
    const items = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ];
    expect(items.map((item) => item.textContent)).toEqual([
      "Disabled action",
      "First action",
      "Last action",
    ]);
    expect(items[0]?.hasAttribute("data-disabled")).toBe(true);
    expect(
      items.slice(1).every((item) => !item.hasAttribute("data-disabled")),
    ).toBe(true);
    expect(
      items.every(
        (item) => item.getAttribute("data-orientation") === "vertical",
      ),
    ).toBe(true);
  });

  it("honors trigger keydown cancellation without opening", async () => {
    const onKeyDown = vi.fn((event: React.KeyboardEvent) =>
      event.preventDefault(),
    );
    await mount(
      <ContextMenuRoot>
        <ContextMenuTrigger onKeyDown={onKeyDown}>
          <button data-trigger="cancelled" type="button">
            Cancelled trigger
          </button>
        </ContextMenuTrigger>
        <ContextMenuPortal>
          <ContextMenuContent>
            <ContextMenuItem>Cancelled action</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenuPortal>
      </ContextMenuRoot>,
    );

    const trigger = document.querySelector<HTMLElement>(
      '[data-trigger="cancelled"]',
    );
    trigger?.focus();
    await pressKey(trigger, "ContextMenu");
    expect(onKeyDown).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("dismisses on Escape and outside pointer while restoring trigger focus", async () => {
    await mount(<InteractiveMenu />);
    const trigger = document.querySelector<HTMLElement>(
      '[data-trigger="interactive"]',
    );
    trigger?.focus();
    await pressKey(trigger, "ContextMenu");
    await pressKey(document.activeElement, "Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await openMenu("interactive");
    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("does not invoke disabled items and invokes an enabled action once", async () => {
    const onFirstSelect = () => {
      throw new Error("disabled action selected");
    };
    const onSecondSelect = vi.fn();
    await mount(
      <InteractiveMenu
        onFirstSelect={onFirstSelect}
        onSecondSelect={onSecondSelect}
      />,
    );
    await openMenu("interactive");

    const items = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
    expect(items[0]?.hasAttribute("data-disabled")).toBe(true);
    await act(async () => items[1]?.click());
    expect(onSecondSelect).toHaveBeenCalledOnce();
  });

  it("closes the active menu on capture-level scroll", async () => {
    await mount(<TestMenu id="scroll" />);
    await openMenu("scroll");
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("guards against inline Content by self-portaling to body", async () => {
    await mount(<TestMenu explicitPortal={false} id="guarded" />);
    await openMenu("guarded");
    expect(
      document.querySelector("[data-radix-popper-content-wrapper]")
        ?.parentElement,
    ).toBe(document.body);
  });

  it("supports a controlled root opened outside the trigger event", async () => {
    function ControlledMenu() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button data-open-controlled onClick={() => setOpen(true)}>
            Open
          </button>
          <ContextMenuRoot open={open} onOpenChange={setOpen}>
            <ContextMenuTrigger>
              <button type="button">Controlled trigger</button>
            </ContextMenuTrigger>
            <ContextMenuPortal>
              <ContextMenuContent>
                <ContextMenuItem>Controlled action</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenuPortal>
          </ContextMenuRoot>
        </>
      );
    }

    await mount(<ControlledMenu />);
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>("[data-open-controlled]")
        ?.click();
    });
    expect(document.body.textContent).toContain("Controlled action");
  });
});
