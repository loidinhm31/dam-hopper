import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
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
  let terminalHostPointerDown: ReturnType<typeof vi.fn>;
  let terminalHostTouchStart: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollToTop = vi.fn();
    scrollToBottom = vi.fn();
    scrollLines = vi.fn();
    terminalHostClick = vi.fn();
    terminalHostPointerDown = vi.fn();
    terminalHostTouchStart = vi.fn();
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
    const focusTerminalInput = () => {
      container
        .querySelector<HTMLTextAreaElement>('[data-testid="terminal-input"]')
        ?.focus();
    };
    await act(async () =>
      root.render(
        <div
          onClick={terminalHostClick}
          onPointerDown={() => {
            terminalHostPointerDown();
            focusTerminalInput();
          }}
          onTouchStart={() => {
            terminalHostTouchStart();
            focusTerminalInput();
          }}
        >
          <textarea
            data-testid="terminal-input"
            className="xterm-helper-textarea"
          />
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

  it("blurs xterm input during trusted pointer/touch control actions", async () => {
    await render();
    const terminalInput = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="terminal-input"]',
    );
    expect(terminalInput).not.toBeNull();
    terminalInput?.focus();

    await userEvent.click(
      page.getByRole("button", { name: "Show terminal scroll buttons" }),
    );
    await expect
      .element(
        page.getByRole("button", { name: "Hide terminal scroll buttons" }),
      )
      .toBeVisible();
    expect(document.activeElement).not.toBe(terminalInput);
    expect(terminalHostPointerDown).not.toHaveBeenCalled();
    expect(terminalHostClick).not.toHaveBeenCalled();

    for (const label of [
      "Jump to top",
      "Scroll up 3 lines",
      "Scroll down 3 lines",
      "Jump to bottom",
    ]) {
      terminalInput?.focus();
      await userEvent.click(page.getByRole("button", { name: label }));
      expect(document.activeElement).not.toBe(terminalInput);
    }
    expect(scrollToTop).toHaveBeenCalledOnce();
    expect(scrollLines).toHaveBeenNthCalledWith(1, -3);
    expect(scrollLines).toHaveBeenNthCalledWith(2, 3);
    expect(scrollToBottom).toHaveBeenCalledOnce();
    expect(terminalHostPointerDown).not.toHaveBeenCalled();
    expect(terminalHostTouchStart).not.toHaveBeenCalled();
    expect(terminalHostClick).not.toHaveBeenCalled();

    terminalInput?.focus();
    const touchPress = new Event("touchstart", {
      bubbles: true,
      cancelable: true,
    });
    button("Scroll down 3 lines").dispatchEvent(touchPress);
    expect(terminalHostTouchStart).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(terminalInput);
  });

  it("keeps keyboard activation and aria linkage intact", async () => {
    await render();
    const trigger = page.getByRole("button", {
      name: "Show terminal scroll buttons",
    });
    (trigger.element() as HTMLButtonElement).focus();

    await userEvent.keyboard("{Enter}");
    const openTrigger = page.getByRole("button", {
      name: "Hide terminal scroll buttons",
    });
    const group = page.getByRole("group", { name: "Terminal scroll controls" });
    await expect.element(openTrigger).toBeVisible();
    await expect.element(group).toBeVisible();
    const triggerElement = openTrigger.element() as HTMLButtonElement;
    const groupElement = group.element() as HTMLElement;
    expect(triggerElement.getAttribute("aria-expanded")).toBe("true");
    expect(triggerElement.getAttribute("aria-controls")).toBe(groupElement.id);

    await userEvent.keyboard(" ");
    const closedTrigger = page.getByRole("button", {
      name: "Show terminal scroll buttons",
    });
    await expect.element(closedTrigger).toBeVisible();
    await expect.element(group).not.toBeInTheDocument();
    expect(
      (closedTrigger.element() as HTMLButtonElement).getAttribute(
        "aria-expanded",
      ),
    ).toBe("false");

    (closedTrigger.element() as HTMLButtonElement).focus();
    await userEvent.keyboard("{Enter}");
    const topButton = page.getByRole("button", { name: "Jump to top" });
    (topButton.element() as HTMLButtonElement).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(scrollToTop).toHaveBeenCalledTimes(2);
  });
});
