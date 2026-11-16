// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalScrollButtons } from "./TerminalScrollButtons.js";
import {
  registerTerminal,
  removeTerminal,
  terminalRegistry,
} from "@/lib/terminal-registry.js";
import { terminalKey } from "@/api/ownership.js";
import type { TerminalTarget } from "@/api/terminal-session-contract.js";

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

  it("scrolls terminal when sessionId is an Agent Hub qualified JSON key", async () => {
    const target: TerminalTarget = {
      profileId: "hub-profile",
      generation: 1,
      serverEpoch: "epoch-1",
      terminalId: "hub-term-1",
      incarnation: "inc-1",
    };
    const qKey = terminalKey({ profileId: "hub-profile", id: "hub-term-1" });
    registerTerminal(
      target,
      { scrollToTop, scrollToBottom, scrollLines } as never,
      {} as never,
      {} as never,
    );

    try {
      await act(async () =>
        root.render(<TerminalScrollButtons sessionId={qKey} />),
      );

      const trigger = button("Show terminal scroll buttons");
      await act(async () => trigger.click());

      await act(async () => button("Jump to top").click());
      await act(async () => button("Scroll up 3 lines").click());
      await act(async () => button("Scroll down 3 lines").click());
      await act(async () => button("Jump to bottom").click());

      expect(scrollToTop).toHaveBeenCalledOnce();
      expect(scrollLines).toHaveBeenNthCalledWith(1, -3);
      expect(scrollLines).toHaveBeenNthCalledWith(2, 3);
      expect(scrollToBottom).toHaveBeenCalledOnce();
    } finally {
      removeTerminal(target);
    }
  });

  it("invokes custom resolveTerminal prop when provided", async () => {
    const customScrollToTop = vi.fn();
    const customScrollLines = vi.fn();
    const customScrollToBottom = vi.fn();
    const customResolver = vi.fn((sid: string) => {
      if (sid === "custom-session") {
        return {
          terminal: {
            scrollToTop: customScrollToTop,
            scrollLines: customScrollLines,
            scrollToBottom: customScrollToBottom,
          },
        } as never;
      }
      return undefined;
    });

    await act(async () =>
      root.render(
        <TerminalScrollButtons
          sessionId="custom-session"
          resolveTerminal={customResolver}
        />,
      ),
    );

    const trigger = button("Show terminal scroll buttons");
    await act(async () => trigger.click());

    await act(async () => button("Jump to top").click());
    await act(async () => button("Scroll up 3 lines").click());
    await act(async () => button("Scroll down 3 lines").click());
    await act(async () => button("Jump to bottom").click());

    expect(customScrollToTop).toHaveBeenCalledOnce();
    expect(customScrollLines).toHaveBeenNthCalledWith(1, -3);
    expect(customScrollLines).toHaveBeenNthCalledWith(2, 3);
    expect(customScrollToBottom).toHaveBeenCalledOnce();
    expect(customResolver).toHaveBeenCalledWith("custom-session");
  });

  it("does not throw or scroll when custom resolveTerminal returns undefined", async () => {
    const customResolver = vi.fn(() => undefined);
    await act(async () =>
      root.render(
        <TerminalScrollButtons
          sessionId="denied-session"
          resolveTerminal={customResolver}
        />,
      ),
    );

    const trigger = button("Show terminal scroll buttons");
    await act(async () => trigger.click());

    await act(async () => button("Jump to top").click());
    await act(async () => button("Scroll up 3 lines").click());
    await act(async () => button("Scroll down 3 lines").click());
    await act(async () => button("Jump to bottom").click());

    expect(customResolver).toHaveBeenCalledWith("denied-session");
    expect(scrollToTop).not.toHaveBeenCalled();
    expect(scrollLines).not.toHaveBeenCalled();
    expect(scrollToBottom).not.toHaveBeenCalled();
  });
});
