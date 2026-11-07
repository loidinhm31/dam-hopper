// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getEditorContextForWindow,
  handleCoordinatorKeyEvent,
  installRootKeyboardCoordinator,
  isEventHandledByCoordinator,
  registerEditorSlot,
  registerShellDelegate,
  setCognitoPhysicalPolicy,
  type ShellInputDelegate,
} from "./action-dispatch.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useWindowStore } from "./window-store.js";
import { createDefaultOsSession } from "./window-ops.js";

describe("action-dispatch - root keyboard coordinator (C5)", () => {
  beforeEach(() => {
    useWindowStore.getState().setSession(createDefaultOsSession());
    setCognitoPhysicalPolicy(null);
  });

  it("handles Stage 1: Cognito physical keyboard policy", () => {
    const policy = vi.fn().mockReturnValue(true);
    setCognitoPhysicalPolicy(policy);

    const event = new KeyboardEvent("keydown", {
      key: "KeyA",
      code: "KeyA",
      cancelable: true,
    });
    const handled = handleCoordinatorKeyEvent(event);

    expect(handled).toBe(true);
    expect(policy).toHaveBeenCalledWith(event);
    expect(isEventHandledByCoordinator(event)).toBe(true);
  });

  it("handles Stage 2: Settings shortcut capture ownership", () => {
    const input = document.createElement("input");
    input.setAttribute("data-shortcut-capture", "true");
    document.body.appendChild(input);

    const event = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      cancelable: true,
    });
    Object.defineProperty(event, "target", { value: input });

    const handled = handleCoordinatorKeyEvent(event);
    expect(handled).toBe(true);
    expect(isEventHandledByCoordinator(event)).toBe(true);

    document.body.removeChild(input);
  });

  it("handles Stage 3: IME and composition passthrough without suppression", () => {
    const event = new KeyboardEvent("keydown", {
      key: "Process",
      code: "KeyA",
      cancelable: true,
    });
    const handled = handleCoordinatorKeyEvent(event);

    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(isEventHandledByCoordinator(event)).toBe(false);
  });

  it("handles Stage 4: Modal / Menu Escape dismissal", () => {
    const delegate: ShellInputDelegate = {
      getActiveWindow: vi.fn(),
      getActiveDesktopId: vi.fn().mockReturnValue("desktop-1"),
      getActivePalette: vi.fn().mockReturnValue(true),
      getActiveNonmodal: vi.fn().mockReturnValue(null),
      getModalDepth: vi.fn().mockReturnValue(0),
      closeActiveNonmodal: vi.fn(),
      closePalette: vi.fn(),
      togglePalette: vi.fn(),
      cycleFocus: vi.fn(),
    };
    const unregister = registerShellDelegate(delegate);

    const escapeEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      cancelable: true,
    });
    const handled = handleCoordinatorKeyEvent(escapeEvent);

    expect(handled).toBe(true);
    expect(delegate.closePalette).toHaveBeenCalled();
    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(isEventHandledByCoordinator(escapeEvent)).toBe(true);

    unregister();
  });

  it("handles Stage 5: Page-wide terminal font increase/decrease", () => {
    useSettingsStore.setState({
      terminalFontSize: 14,
      terminalFontSizeIncreaseShortcut: "Ctrl+Alt+Shift+Equal",
      terminalFontSizeDecreaseShortcut: "Ctrl+Alt+Minus",
    });

    const increaseEvent = new KeyboardEvent("keydown", {
      key: "=",
      code: "Equal",
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
      cancelable: true,
    });
    const handled = handleCoordinatorKeyEvent(increaseEvent);

    expect(handled).toBe(true);
    expect(increaseEvent.defaultPrevented).toBe(true);
    expect(useSettingsStore.getState().terminalFontSize).toBe(15);
  });

  it("registers and retrieves editor slot context with selection", () => {
    const unregister = registerEditorSlot({
      windowId: "win-editor-1",
      resourceId: "doc-1",
      owner: { profileId: "profile-1", generation: 1 },
      target: { kind: "project", profileId: "profile-1", project: "demo" },
      windowContext: { profileId: "profile-1" },
      getFilePath: () => "src/main.rs",
      getSelectedText: () => "selected code snippet",
    });

    const ctx = getEditorContextForWindow("win-editor-1");
    expect(ctx).toBeDefined();
    expect(ctx?.kind).toBe("editor");
    if (ctx?.kind === "editor") {
      expect(ctx.filePath).toBe("src/main.rs");
      expect(ctx.selectedText).toBe("selected code snippet");
    }

    unregister();
    expect(getEditorContextForWindow("win-editor-1")).toBeUndefined();
  });
});
