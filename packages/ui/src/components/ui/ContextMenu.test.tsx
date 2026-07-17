// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root | null = null;

function TestMenu({ id, explicitPortal = true }: { id: string; explicitPortal?: boolean }) {
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
      {explicitPortal ? <ContextMenuPortal>{content}</ContextMenuPortal> : content}
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
      document.querySelector('[data-radix-popper-content-wrapper]')
        ?.parentElement,
    ).toBe(document.body);

    await openMenu("second");
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(
      "second action",
    );
    expect(document.body.textContent).not.toContain("first action");
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
      document.querySelector('[data-radix-popper-content-wrapper]')
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
