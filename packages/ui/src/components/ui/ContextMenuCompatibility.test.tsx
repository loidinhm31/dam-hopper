// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuTrigger,
} from "./ContextMenu.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

async function mount(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
}

async function openMenu(id: string) {
  const trigger = document.querySelector<HTMLElement>(`[data-trigger="${id}"]`);
  expect(trigger).not.toBeNull();
  await act(async () =>
    trigger?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        button: 2,
        clientX: 120,
        clientY: 80,
      }),
    ),
  );
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("ContextMenu trigger compatibility spike", () => {
  it("supports defaultOpen for uncontrolled roots", async () => {
    await mount(
      <ContextMenuRoot defaultOpen>
        <ContextMenuTrigger>
          <button type="button">Default trigger</button>
        </ContextMenuTrigger>
        <ContextMenuPortal>
          <ContextMenuContent>
            <ContextMenuItem>Default action</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenuPortal>
      </ContextMenuRoot>,
    );
    expect(document.body.textContent).toContain("Default action");
  });

  it("accepts tree, tab, checkbox, select-action, and lifted diagnostics triggers", async () => {
    function categoryMenu(id: string, trigger: React.ReactElement) {
      return (
        <ContextMenuRoot key={id}>
          <ContextMenuTrigger>{trigger}</ContextMenuTrigger>
          <ContextMenuPortal>
            <ContextMenuContent>
              <ContextMenuItem>{id} action</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenuPortal>
        </ContextMenuRoot>
      );
    }

    function CompatibilityFixture() {
      const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false);
      return (
        <>
          {categoryMenu(
            "arborist-row",
            <div data-trigger="arborist-row" role="treeitem" />,
          )}
          {categoryMenu(
            "editor-tab",
            <button data-trigger="editor-tab" role="tab" type="button" />,
          )}
          {categoryMenu(
            "checkbox-row",
            <div data-trigger="checkbox-row" role="checkbox" />,
          )}
          {categoryMenu(
            "select-branch-action",
            <button data-trigger="select-branch-action" type="button" />,
          )}
          <button
            data-open-diagnostics
            onClick={() => setDiagnosticsOpen(true)}
          />
          <ContextMenuRoot
            open={diagnosticsOpen}
            onOpenChange={setDiagnosticsOpen}
          >
            <ContextMenuTrigger>
              <button data-trigger="diagnostics" type="button" />
            </ContextMenuTrigger>
            <ContextMenuPortal>
              <ContextMenuContent>
                <ContextMenuItem>diagnostics action</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenuPortal>
          </ContextMenuRoot>
        </>
      );
    }

    await mount(<CompatibilityFixture />);
    for (const id of [
      "arborist-row",
      "editor-tab",
      "checkbox-row",
      "select-branch-action",
    ]) {
      await openMenu(id);
      expect(document.body.textContent).toContain(`${id} action`);
    }
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>("[data-open-diagnostics]")
        ?.click(),
    );
    expect(document.body.textContent).toContain("diagnostics action");
  });
});
