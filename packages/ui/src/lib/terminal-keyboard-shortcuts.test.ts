import { describe, expect, it, vi } from "vitest";
import { handleSharedTerminalKeyEvent } from "./terminal-keyboard-shortcuts.js";

function key(overrides: Partial<KeyboardEvent> & { code: string }) {
  return {
    type: "keydown",
    key: overrides.code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("handleSharedTerminalKeyEvent", () => {
  it("copies terminal selection on Ctrl+Shift+C", () => {
    const onCopySelection = vi.fn();

    expect(
      handleSharedTerminalKeyEvent(
        key({ code: "KeyC", ctrlKey: true, shiftKey: true }),
        {
          workspaceShortcut: "Mod+Shift+Backquote",
          onCopySelection,
        },
      ),
    ).toBe(false);
    expect(onCopySelection).toHaveBeenCalledOnce();
  });

  it("suppresses workspace and new-terminal shortcuts from xterm input", () => {
    expect(
      handleSharedTerminalKeyEvent(key({ code: "Backquote", ctrlKey: true }), {
        workspaceShortcut: "Mod+Shift+Backquote",
        onCopySelection: vi.fn(),
      }),
    ).toBe(false);
    expect(
      handleSharedTerminalKeyEvent(
        key({ code: "Backquote", ctrlKey: true, shiftKey: true }),
        {
          workspaceShortcut: "Ctrl+Shift+Backquote",
          onCopySelection: vi.fn(),
        },
      ),
    ).toBe(false);
  });
});
