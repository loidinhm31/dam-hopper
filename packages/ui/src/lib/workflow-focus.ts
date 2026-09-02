import { isMacPlatform, matchesKeyboardShortcut, type ShortcutKeyEvent } from "./shortcuts.js";

export const DEFAULT_WORKFLOW_CONTEXT_SHORTCUT = "Mod+Shift+KeyW";

/**
 * Returns true if the target element or current activeElement represents an editable
 * input, code editor, terminal, dialog, or shortcut suppression zone.
 */
export function isEditableOrSuppressedTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") {
    return false;
  }

  const el = target as Partial<HTMLElement>;

  // Native input controls
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    return true;
  }
  // Contenteditable
  if (
    el.isContentEditable ||
    (typeof el.getAttribute === "function" &&
      el.getAttribute("contenteditable") === "true") ||
    (typeof el.contentEditable === "string" &&
      el.contentEditable.toLowerCase() === "true")
  ) {
    return true;
  }

  // Ancestor element checks
  if ("closest" in el && typeof el.closest === "function") {
    const isInsideSuppression = el.closest(
      [
        ".monaco-editor",
        ".xterm",
        ".xterm-screen",
        ".xterm-helper-textarea",
        "[role='dialog']",
        "[data-suppress-shortcuts]",
        "[data-native-input]",
      ].join(", "),
    );
    if (isInsideSuppression) {
      return true;
    }
  }

  return false;
}

/**
 * Validates that focus is currently outside of any text inputs, editors, terminals, or dialogs,
 * meaning global workflow shortcuts (e.g. Mod+Shift+W) are safe to claim.
 */
export function isWorkflowShortcutOwner(
  target?: EventTarget | null,
  activeElement: Element | null = typeof document !== "undefined" ? document.activeElement : null,
): boolean {
  if (isEditableOrSuppressedTarget(target ?? null)) {
    return false;
  }
  if (activeElement && isEditableOrSuppressedTarget(activeElement)) {
    return false;
  }
  return true;
}

/**
 * Checks whether a key event matches the workflow toggle shortcut (Mod+Shift+KeyW).
 */
export function matchesWorkflowToggleShortcut(
  event: ShortcutKeyEvent,
  isMac = isMacPlatform(),
): boolean {
  return matchesKeyboardShortcut(DEFAULT_WORKFLOW_CONTEXT_SHORTCUT, event, isMac);
}

/**
 * Safely restores focus to a previously active element if it is still connected to the DOM.
 */
export function restoreWorkflowFocus(element?: HTMLElement | null): void {
  if (element && typeof element.focus === "function" && element.isConnected) {
    try {
      element.focus();
    } catch {
      // Ignored if focus fails
    }
  }
}
