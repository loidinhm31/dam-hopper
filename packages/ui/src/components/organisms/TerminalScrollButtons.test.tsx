import { Children, isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { TerminalScrollButtons } from "./TerminalScrollButtons.js";
import { terminalRegistry } from "@/lib/terminal-registry.js";

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (selector: (state: { terminalScrollStep: number }) => unknown) =>
    selector({ terminalScrollStep: 3 }),
}));

function getButtons(sessionId: string) {
  const tree = TerminalScrollButtons({ sessionId });
  if (!isValidElement(tree)) {
    throw new Error("Expected a valid React element");
  }

  return Children.toArray(tree.props.children).filter(isValidElement);
}

describe("TerminalScrollButtons", () => {
  it("keeps step scrolling and adds top and bottom jumps", () => {
    const scrollToTop = vi.fn();
    const scrollToBottom = vi.fn();
    const scrollLines = vi.fn();
    terminalRegistry.set("session-1", {
      terminal: { scrollToTop, scrollToBottom, scrollLines },
      fitAddon: {} as never,
    } as never);

    const [topButton, upButton, downButton, bottomButton] =
      getButtons("session-1");
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.MouseEvent;

    topButton.props.onClick(event);
    upButton.props.onClick(event);
    downButton.props.onClick(event);
    bottomButton.props.onClick(event);

    expect(scrollToTop).toHaveBeenCalledOnce();
    expect(scrollLines).toHaveBeenNthCalledWith(1, -3);
    expect(scrollLines).toHaveBeenNthCalledWith(2, 3);
    expect(scrollToBottom).toHaveBeenCalledOnce();

    terminalRegistry.clear();
  });
});
