import { describe, expect, it, vi } from "vitest";
import {
  handleTerminalSuggestionKeyEvent,
  TERMINAL_HISTORY_SHORTCUT,
} from "./terminal-suggestion-key-handler.js";

function key(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    type: "keydown",
    code: "ArrowRight",
    key: "ArrowRight",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("terminal suggestion key handler", () => {
  it("consumes only a gated full acceptance", () => {
    const accept = vi.fn(() => " status");
    expect(
      handleTerminalSuggestionKeyEvent(key({ altKey: true }), {
        accept,
        openHistory: vi.fn(() => false),
      }),
    ).toBe(false);
    expect(accept).toHaveBeenCalledWith("full");
  });

  it("keeps Alt+Right for pane navigation when no current ghost can accept", () => {
    expect(
      handleTerminalSuggestionKeyEvent(key({ altKey: true }), {
        accept: () => null,
        openHistory: vi.fn(() => false),
      }),
    ).toBe(true);
  });

  it.each(["\t", "\r", "Escape", "\x12", "ArrowLeft"])(
    "passes native terminal input unchanged: %s",
    (keyValue) => {
      expect(
        handleTerminalSuggestionKeyEvent(
          key({ key: keyValue, code: keyValue }),
          {
            accept: vi.fn(() => "suffix"),
            openHistory: vi.fn(() => false),
          },
        ),
      ).toBe(true);
    },
  );

  it(`opens explicit history with ${TERMINAL_HISTORY_SHORTCUT}`, () => {
    const openHistory = vi.fn(() => true);
    expect(
      handleTerminalSuggestionKeyEvent(
        key({ code: "KeyH", key: "h", ctrlKey: true, altKey: true }),
        {
          accept: vi.fn(() => null),
          openHistory,
        },
      ),
    ).toBe(false);
    expect(openHistory).toHaveBeenCalledOnce();
  });

  it.each([
    { isComposing: true },
    { keyCode: 229 },
    { repeat: true },
    { type: "keyup" },
  ])("passes IME and non-initial keyboard events through: %o", (overrides) => {
    const accept = vi.fn(() => " suffix");
    const openHistory = vi.fn(() => true);

    expect(
      handleTerminalSuggestionKeyEvent(key({ altKey: true, ...overrides }), {
        accept,
        openHistory,
      }),
    ).toBe(true);
    expect(accept).not.toHaveBeenCalled();
    expect(openHistory).not.toHaveBeenCalled();
  });
});
