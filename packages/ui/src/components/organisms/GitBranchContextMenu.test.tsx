// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitBranchContextMenu } from "./GitBranchContextMenu.js";

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

function expectNoPreInteractionWarning(
  consoleWarn: ReturnType<typeof vi.spyOn>,
) {
  expect(
    consoleWarn.mock.calls.some(([message]) =>
      typeof message === "string"
        ? message.includes("open prop has been set to true before the user")
        : false,
    ),
  ).toBe(false);
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("GitBranchContextMenu", () => {
  it("opens through its synthetic pointer trigger without an unanchored warning", async () => {
    const dispatchEvent = vi.spyOn(HTMLElement.prototype, "dispatchEvent");
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await mount(
        <GitBranchContextMenu
          x={120}
          y={80}
          branchName="feature/demo"
          isCurrent={false}
          onDelete={vi.fn()}
          onClose={vi.fn()}
        />,
      );

      const triggerEvent = dispatchEvent.mock.calls
        .map(([event]) => event)
        .find(
          (event) =>
            event instanceof MouseEvent && event.type === "contextmenu",
        ) as MouseEvent | undefined;
      expect(triggerEvent).toMatchObject({ clientX: 120, clientY: 80 });
      expect(document.querySelector('[role="menu"]')?.textContent).toContain(
        "feature/demo",
      );
      expectNoPreInteractionWarning(consoleWarn);
    } finally {
      dispatchEvent.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  it("dismisses through the controlled close callback", async () => {
    const onClose = vi.fn();
    await mount(
      <GitBranchContextMenu
        x={120}
        y={80}
        branchName="feature/demo"
        isCurrent={false}
        onDelete={vi.fn()}
        onClose={onClose}
      />,
    );

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Escape",
        }),
      );
    });

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
