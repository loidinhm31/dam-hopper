// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommandPalette } from "./CommandPalette.js";
import { ShellInputProvider } from "./shell-input-context.js";
import { useWindowStore } from "./window-store.js";
import { createDefaultOsSession } from "./window-ops.js";
import * as actionExecutor from "./action-executor.js";

describe("CommandPalette", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useWindowStore.getState().setSession(createDefaultOsSession());
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders manifest action commands with shared icons and executes via executeAction", async () => {
    const onClose = vi.fn();
    const executeSpy = vi.spyOn(actionExecutor, "executeAction").mockResolvedValue({ kind: "executed" });

    act(() => {
      root.render(
        <ShellInputProvider>
          <CommandPalette isOpen={true} onClose={onClose} />
        </ShellInputProvider>,
      );
    });

    const palette = container.querySelector('[role="dialog"]');
    expect(palette).not.toBeNull();

    // Verify manifest commands appear
    const options = container.querySelectorAll('[role="option"]');
    expect(options.length).toBeGreaterThan(0);

    // Find and click the Settings or Terminals action
    const terminalsOption = Array.from(options).find((opt) =>
      opt.textContent?.includes("Terminals"),
    ) as HTMLElement | undefined;
    expect(terminalsOption).toBeDefined();

    act(() => {
      terminalsOption?.click();
    });

    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "app.terminals.open",
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("filters items by query", async () => {
    const onClose = vi.fn();

    act(() => {
      root.render(
        <ShellInputProvider>
          <CommandPalette isOpen={true} onClose={onClose} />
        </ShellInputProvider>,
      );
    });

    const input = container.querySelector("input")!;
    act(() => {
      input.value = "Settings";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const options = container.querySelectorAll('[role="option"]');
    expect(options.length).toBeGreaterThan(0);
    const textContent = Array.from(options).map((o) => o.textContent).join(" ");
    expect(textContent).toContain("Settings");
  });

  it("closes on Escape key press", async () => {
    const onClose = vi.fn();

    act(() => {
      root.render(
        <ShellInputProvider>
          <CommandPalette isOpen={true} onClose={onClose} />
        </ShellInputProvider>,
      );
    });

    const input = container.querySelector("input")!;
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onClose).toHaveBeenCalled();
  });
});
