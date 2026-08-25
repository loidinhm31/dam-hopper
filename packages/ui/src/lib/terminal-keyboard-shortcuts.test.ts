import { describe, expect, it, vi } from "vitest";
import {
  handleSharedTerminalKeyEvent,
  handleTerminalFontSizeShortcut,
} from "./terminal-keyboard-shortcuts.js";

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
  it("matches native keyboard properties that are not enumerable", () => {
    const onIncrease = vi.fn();
    const event = Object.defineProperties(
      {},
      {
        type: { value: "keydown" },
        code: { value: "KeyZ" },
        key: { value: "z" },
        ctrlKey: { value: true },
        metaKey: { value: false },
        altKey: { value: false },
        shiftKey: { value: false },
        repeat: { value: false },
        isComposing: { value: false },
        preventDefault: { value: vi.fn() },
      },
    ) as KeyboardEvent;

    expect(
      handleTerminalFontSizeShortcut(event, {
        increaseShortcut: "Ctrl+KeyZ",
        onIncrease,
      }),
    ).toBe(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onIncrease).toHaveBeenCalledOnce();
  });

  it("handles a configured font shortcut without terminal focus", () => {
    const onIncrease = vi.fn();
    const event = key({ code: "KeyZ", key: "z", ctrlKey: true });

    expect(
      handleTerminalFontSizeShortcut(event, {
        increaseShortcut: "Ctrl+KeyZ",
        decreaseShortcut: "Ctrl+KeyX",
        onIncrease,
      }),
    ).toBe(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onIncrease).toHaveBeenCalledOnce();
  });

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

  it("suppresses workspace and panel shortcuts from xterm input", () => {
    expect(
      handleSharedTerminalKeyEvent(key({ code: "Backquote", ctrlKey: true }), {
        workspaceShortcut: "Mod+Shift+Backquote",
        revealActiveFileShortcut: "Alt+F1",
        panelShortcuts: ["Mod+Shift+KeyG", "Mod+Shift+KeyP", "Mod+Shift+KeyM"],
        onCopySelection: vi.fn(),
      }),
    ).toBe(false);
    expect(
      handleSharedTerminalKeyEvent(
        key({ code: "Backquote", ctrlKey: true, shiftKey: true }),
        {
          workspaceShortcut: "Ctrl+Shift+Backquote",
          revealActiveFileShortcut: "Alt+F1",
          panelShortcuts: [
            "Ctrl+Shift+KeyG",
            "Ctrl+Shift+KeyP",
            "Ctrl+Shift+KeyM",
          ],
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
          panelShortcuts: [
            "Ctrl+Shift+KeyG",
            "Ctrl+Shift+KeyP",
            "Ctrl+Shift+KeyM",
          ],
          onCopySelection: vi.fn(),
        },
      ),
    ).toBe(false);
    expect(
      handleSharedTerminalKeyEvent(
        key({ code: "KeyP", ctrlKey: true, shiftKey: true }),
        {
          workspaceShortcut: "Mod+Shift+Backquote",
          revealActiveFileShortcut: "Alt+F1",
          panelShortcuts: [
            "Mod+Shift+KeyG",
            "Mod+Shift+KeyP",
            "Mod+Shift+KeyM",
          ],
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
  ])(
    "suppresses repeat/composition F events without reopening search",
    (shortcut) => {
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
    },
  );

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

  it.each([
    {
      shortcut: "Ctrl+Alt+Shift+Equal",
      event: {
        code: "Equal",
        key: "+",
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
      },
      callback: "increase",
    },
    {
      shortcut: "Ctrl+Alt+Minus",
      event: { code: "Minus", key: "-", ctrlKey: true, altKey: true },
      callback: "decrease",
    },
  ])(
    "consumes the $shortcut terminal font shortcut",
    ({ shortcut, event, callback }) => {
      const onIncreaseTerminalFontSize = vi.fn();
      const onDecreaseTerminalFontSize = vi.fn();
      const keyEvent = key(event);

      expect(
        handleSharedTerminalKeyEvent(keyEvent, {
          workspaceShortcut: "Mod+Shift+Backquote",
          revealActiveFileShortcut: "Alt+F1",
          terminalFontSizeIncreaseShortcut:
            callback === "increase" ? shortcut : "Ctrl+Alt+Shift+Equal",
          terminalFontSizeDecreaseShortcut:
            callback === "decrease" ? shortcut : "Ctrl+Alt+Minus",
          onCopySelection: vi.fn(),
          onIncreaseTerminalFontSize,
          onDecreaseTerminalFontSize,
        }),
      ).toBe(false);

      expect(keyEvent.preventDefault).toHaveBeenCalledOnce();
      expect(onIncreaseTerminalFontSize).toHaveBeenCalledTimes(
        callback === "increase" ? 1 : 0,
      );
      expect(onDecreaseTerminalFontSize).toHaveBeenCalledTimes(
        callback === "decrease" ? 1 : 0,
      );
    },
  );

  it("consumes repeated and composing font shortcuts without changing the size", () => {
    for (const event of [
      key({
        code: "Equal",
        key: "+",
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
        repeat: true,
      }),
      key({
        code: "Minus",
        key: "-",
        ctrlKey: true,
        altKey: true,
        isComposing: true,
      }),
      key({
        code: "Equal",
        key: "+",
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
        keyCode: 229,
      }),
    ]) {
      const onIncreaseTerminalFontSize = vi.fn();
      const onDecreaseTerminalFontSize = vi.fn();
      expect(
        handleSharedTerminalKeyEvent(event, {
          workspaceShortcut: "Mod+Shift+Backquote",
          revealActiveFileShortcut: "Alt+F1",
          terminalFontSizeIncreaseShortcut: "Ctrl+Alt+Shift+Equal",
          terminalFontSizeDecreaseShortcut: "Ctrl+Alt+Minus",
          onCopySelection: vi.fn(),
          onIncreaseTerminalFontSize,
          onDecreaseTerminalFontSize,
        }),
      ).toBe(false);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(onIncreaseTerminalFontSize).not.toHaveBeenCalled();
      expect(onDecreaseTerminalFontSize).not.toHaveBeenCalled();
    }
  });

  it("does not match a terminal font shortcut with missing modifiers", () => {
    const event = key({ code: "Equal", key: "+", ctrlKey: true, altKey: true });
    const onIncreaseTerminalFontSize = vi.fn();

    expect(
      handleSharedTerminalKeyEvent(event, {
        workspaceShortcut: "Mod+Shift+Backquote",
        revealActiveFileShortcut: "Alt+F1",
        terminalFontSizeIncreaseShortcut: "Ctrl+Alt+Shift+Equal",
        onCopySelection: vi.fn(),
        onIncreaseTerminalFontSize,
      }),
    ).toBe(true);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onIncreaseTerminalFontSize).not.toHaveBeenCalled();
  });

  it("consumes duplicate font bindings without choosing a direction", () => {
    const event = key({
      code: "Equal",
      key: "+",
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
    });
    const onIncreaseTerminalFontSize = vi.fn();
    const onDecreaseTerminalFontSize = vi.fn();

    expect(
      handleSharedTerminalKeyEvent(event, {
        workspaceShortcut: "Mod+Shift+Backquote",
        revealActiveFileShortcut: "Alt+F1",
        terminalFontSizeIncreaseShortcut: "Ctrl+Alt+Shift+Equal",
        terminalFontSizeDecreaseShortcut: "Ctrl+Alt+Shift+Equal",
        onCopySelection: vi.fn(),
        onIncreaseTerminalFontSize,
        onDecreaseTerminalFontSize,
      }),
    ).toBe(false);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onIncreaseTerminalFontSize).not.toHaveBeenCalled();
    expect(onDecreaseTerminalFontSize).not.toHaveBeenCalled();
  });
});
