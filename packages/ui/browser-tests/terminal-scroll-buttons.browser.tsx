import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalScrollButtons } from "@/components/organisms/TerminalScrollButtons.js";
import { terminalRegistry } from "@/lib/terminal-registry.js";
import "@/index.css";

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (
    selector: (state: { terminalScrollStep: number }) => unknown,
  ) => selector({ terminalScrollStep: 3 }),
}));

describe("Terminal scroll buttons in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollToTop: ReturnType<typeof vi.fn>;
  let scrollToBottom: ReturnType<typeof vi.fn>;
  let scrollLines: ReturnType<typeof vi.fn>;
  let terminalHostClick: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollToTop = vi.fn();
    scrollToBottom = vi.fn();
    scrollLines = vi.fn();
    terminalHostClick = vi.fn();
    terminalRegistry.set("session-1", {
      terminal: { scrollToTop, scrollToBottom, scrollLines },
      fitAddon: {} as never,
    } as never);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    terminalRegistry.clear();
  });

  function button(label: string) {
    const result = container.querySelector<HTMLButtonElement>(
      `[aria-label="${label}"]`,
    );
    expect(result).not.toBeNull();
    return result as HTMLButtonElement;
  }

  async function render() {
    await act(async () =>
      root.render(
        <div onClick={terminalHostClick}>
          <TerminalScrollButtons sessionId="session-1" />
        </div>,
      ),
    );
  }

  it("opens one rail, preserves terminal actions, and remains open for repeated scrolling", async () => {
    await render();
    const trigger = button("Show terminal scroll buttons");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="group"]')).toBeNull();

    await act(async () => trigger.click());
    expect(terminalHostClick).not.toHaveBeenCalled();
    expect(
      button("Hide terminal scroll buttons").getAttribute("aria-expanded"),
    ).toBe("true");

    await act(async () => button("Jump to top").click());
    await act(async () => button("Scroll up 3 lines").click());
    await act(async () => button("Scroll down 3 lines").click());
    await act(async () => button("Jump to bottom").click());

    expect(scrollToTop).toHaveBeenCalledOnce();
    expect(scrollLines).toHaveBeenNthCalledWith(1, -3);
    expect(scrollLines).toHaveBeenNthCalledWith(2, 3);
    expect(scrollToBottom).toHaveBeenCalledOnce();
    expect(terminalHostClick).not.toHaveBeenCalled();
    expect(container.querySelector('[role="group"]')).not.toBeNull();
  });

  it("closes with Escape or a pointer outside the controls", async () => {
    await render();
    await act(async () => button("Show terminal scroll buttons").click());

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => document.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(container.querySelector('[role="group"]')).toBeNull();

    await act(async () => button("Show terminal scroll buttons").click());
    await act(async () =>
      document.body.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      ),
    );
    expect(container.querySelector('[role="group"]')).toBeNull();
  });

  it("keeps terminal focus during trigger and action mouse presses", async () => {
    await render();
    const focusTarget = document.createElement("input");
    document.body.append(focusTarget);
    focusTarget.focus();

    const triggerPress = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    button("Show terminal scroll buttons").dispatchEvent(triggerPress);
    expect(triggerPress.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusTarget);

    await act(async () => button("Show terminal scroll buttons").click());
    const actionPress = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    button("Scroll up 3 lines").dispatchEvent(actionPress);
    expect(actionPress.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusTarget);

    focusTarget.remove();
  });
});
