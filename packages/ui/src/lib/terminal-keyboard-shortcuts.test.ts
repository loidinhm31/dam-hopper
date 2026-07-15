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
    preventDefault: vi.fn(),
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
          revealActiveFileShortcut: "Alt+F1",
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
        revealActiveFileShortcut: "Alt+F1",
        onCopySelection: vi.fn(),
      }),
    ).toBe(false);
    expect(
      handleSharedTerminalKeyEvent(
        key({ code: "Backquote", ctrlKey: true, shiftKey: true }),
        {
          workspaceShortcut: "Ctrl+Shift+Backquote",
          revealActiveFileShortcut: "Alt+F1",
          onCopySelection: vi.fn(),
        },
      ),
    ).toBe(false);
    expect(
      handleSharedTerminalKeyEvent(
        key({ code: "F1", key: "F1", altKey: true }),
        {
          workspaceShortcut: "Ctrl+Shift+Backquote",
          revealActiveFileShortcut: "Alt+F1",
          onCopySelection: vi.fn(),
        },
      ),
    ).toBe(false);
  });

  it.each([
    { code: "KeyF", key: "f", ctrlKey: true },
    { code: "KeyF", key: "F", metaKey: true },
    { code: "Other", key: "f", ctrlKey: true },
  ])("opens terminal search for Ctrl/Cmd+F", (shortcut) => {
    const onFind = vi.fn();
    const event = key(shortcut);

    expect(
      handleSharedTerminalKeyEvent(event, {
        workspaceShortcut: "Mod+Shift+Backquote",
        revealActiveFileShortcut: "Alt+F1",
        onCopySelection: vi.fn(),
        onFind,
      }),
    ).toBe(false);

    expect(onFind).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it.each([
    { code: "KeyF", key: "f", ctrlKey: true, shiftKey: true },
    { code: "KeyF", key: "f", metaKey: true, altKey: true },
    { code: "KeyF", key: "f", ctrlKey: true, metaKey: true },
    { code: "KeyF", key: "f", ctrlKey: true, type: "keyup" },
  ])("leaves modified or non-keydown F events unchanged", (shortcut) => {
    const onFind = vi.fn();
    const event = key(shortcut);

    expect(
      handleSharedTerminalKeyEvent(event, {
        workspaceShortcut: "Mod+Shift+Backquote",
        revealActiveFileShortcut: "Alt+F1",
        onCopySelection: vi.fn(),
        onFind,
      }),
    ).toBe(true);

    expect(onFind).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    { code: "KeyF", key: "f", ctrlKey: true, repeat: true },
    { code: "KeyF", key: "f", metaKey: true, isComposing: true },
  ])("suppresses repeat/composition F events without reopening search", (shortcut) => {
    const onFind = vi.fn();
    const event = key(shortcut);

    expect(
      handleSharedTerminalKeyEvent(event, {
        workspaceShortcut: "Mod+Shift+Backquote",
        revealActiveFileShortcut: "Alt+F1",
        onCopySelection: vi.fn(),
        onFind,
      }),
    ).toBe(false);

    expect(onFind).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("keeps the file-search shortcut available", () => {
    const onFind = vi.fn();

    expect(
      handleSharedTerminalKeyEvent(
        key({ code: "KeyF", key: "f", ctrlKey: true, shiftKey: true }),
        {
          workspaceShortcut: "Mod+Shift+Backquote",
          revealActiveFileShortcut: "Alt+F1",
          onCopySelection: vi.fn(),
          onFind,
        },
      ),
    ).toBe(true);
    expect(onFind).not.toHaveBeenCalled();
  });

  it("dispatches search only for the active session", () => {
    const controllers = {
      active: { open: vi.fn() },
      inactive: { open: vi.fn() },
    };
    const dispatch = (sessionId: keyof typeof controllers) =>
      handleSharedTerminalKeyEvent(key({ code: "KeyF", ctrlKey: true }), {
        workspaceShortcut: "Mod+Shift+Backquote",
        revealActiveFileShortcut: "Alt+F1",
        onCopySelection: vi.fn(),
        onFind: () => controllers[sessionId].open(),
      });

    expect(dispatch("active")).toBe(false);
    expect(controllers.active.open).toHaveBeenCalledOnce();
    expect(controllers.inactive.open).not.toHaveBeenCalled();
  });

  it("prevents the terminal input path from receiving the find shortcut", () => {
    const onData = vi.fn();
    const event = key({ code: "KeyF", ctrlKey: true });
    const handled = handleSharedTerminalKeyEvent(event, {
      workspaceShortcut: "Mod+Shift+Backquote",
      revealActiveFileShortcut: "Alt+F1",
      onCopySelection: vi.fn(),
      onFind: vi.fn(),
    });

    if (handled) onData();

    expect(onData).not.toHaveBeenCalled();
  });
});
