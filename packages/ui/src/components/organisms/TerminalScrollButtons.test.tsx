// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalScrollButtons } from "./TerminalScrollButtons.js";
import { terminalRegistry } from "@/lib/terminal-registry.js";

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (
    selector: (state: { terminalScrollStep: number }) => unknown,
  ) => selector({ terminalScrollStep: 3 }),
}));

describe("TerminalScrollButtons", () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollToTop: ReturnType<typeof vi.fn>;
  let scrollToBottom: ReturnType<typeof vi.fn>;
  let scrollLines: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollToTop = vi.fn();
    scrollToBottom = vi.fn();
    scrollLines = vi.fn();
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

  it("opens a keyboard-reachable rail and preserves all scroll actions", async () => {
    await act(async () =>
      root.render(<TerminalScrollButtons sessionId="session-1" />),
    );

    const trigger = button("Show terminal scroll buttons");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-controls")).toBeNull();

    await act(async () => trigger.click());
    const top = button("Jump to top");
    expect(trigger.compareDocumentPosition(top)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(
      button("Hide terminal scroll buttons").getAttribute("aria-expanded"),
    ).toBe("true");

    await act(async () => top.click());
    await act(async () => button("Scroll up 3 lines").click());
    await act(async () => button("Scroll down 3 lines").click());
    await act(async () => button("Jump to bottom").click());

    expect(scrollToTop).toHaveBeenCalledOnce();
    expect(scrollLines).toHaveBeenNthCalledWith(1, -3);
    expect(scrollLines).toHaveBeenNthCalledWith(2, 3);
    expect(scrollToBottom).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="group"]')).not.toBeNull();
  });
});
