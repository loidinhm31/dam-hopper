import { getConnectionSnapshot } from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import type { FsTargetRef } from "@/api/ownership.js";
import { getBrowserShortcutSuppression } from "@/lib/browser-shortcut-guard.js";
import { dismissContextMenu, isContextMenuOpen } from "@/lib/context-menu-coordinator.js";
import {
  DoubleShiftDetector,
  DEFAULT_OS_CYCLE_FOCUS_SHORTCUT,
  DEFAULT_OS_PALETTE_SHORTCUT,
  DEFAULT_SEARCH_FILENAME_SHORTCUT,
  matchesKeyboardShortcut,
  type ShortcutKeyEvent,
} from "@/lib/shortcuts.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useSettingsStore } from "@/stores/settings.js";
import { canExecuteAction, executeAction } from "./action-executor.js";
import { listActionDescriptors, resolveActionBinding } from "./actions.js";
import { isImeOrCompositionEvent, isInsideShortcutCapture } from "./input-arbiter.js";
import type { ActionContext, OsWindow, ShellNonmodalSurface, WindowContext } from "./types.js";
import { useWindowStore } from "./window-store.js";

// ============================================================================
// Event Outcome & WeakMap Tracking (Architecture Contract C5)
// ============================================================================

const handledEvents = new WeakMap<Event, boolean>();

export function isEventHandledByCoordinator(event: Event): boolean {
  return handledEvents.get(event) ?? false;
}

export function markEventHandled(event: Event): void {
  handledEvents.set(event, true);
}

// ============================================================================
// Editor Slot Context Registration (Architecture Contract C5 & C10)
// ============================================================================

export interface EditorSlotContext {
  readonly windowId: string;
  readonly resourceId: string;
  readonly owner: ConnectionRef;
  readonly target: FsTargetRef;
  readonly windowContext: WindowContext;
  readonly getFilePath: () => string | undefined;
  readonly getSelectedText: () => string | undefined;
}

const editorRegistrations = new Map<string, EditorSlotContext>();

export function registerEditorSlot(slot: EditorSlotContext): () => void {
  editorRegistrations.set(slot.windowId, slot);
  return () => {
    if (editorRegistrations.get(slot.windowId) === slot) {
      editorRegistrations.delete(slot.windowId);
    }
  };
}

export function getEditorContextForWindow(windowId: string): ActionContext | undefined {
  const reg = editorRegistrations.get(windowId);
  if (!reg) return undefined;
  return {
    kind: "editor",
    desktopId: useWindowStore.getState().session.activeDesktopId,
    windowId: reg.windowId,
    resourceId: reg.resourceId,
    owner: reg.owner,
    target: reg.target,
    windowContext: reg.windowContext,
    filePath: reg.getFilePath(),
    selectedText: reg.getSelectedText(),
  };
}

// ============================================================================
// Shell Delegate Registration (Architecture Contract C5)
// ============================================================================

export interface ShellInputDelegate {
  getActiveWindow: () => OsWindow | undefined;
  getActiveDesktopId: () => string;
  getActivePalette: () => boolean;
  getActiveNonmodal: () => ShellNonmodalSurface | null;
  getModalDepth: () => number;
  closeActiveNonmodal: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  cycleFocus: () => void;
}

let activeShellDelegate: ShellInputDelegate | null = null;

export function registerShellDelegate(delegate: ShellInputDelegate): () => void {
  activeShellDelegate = delegate;
  return () => {
    if (activeShellDelegate === delegate) {
      activeShellDelegate = null;
    }
  };
}

export function getActiveShellDelegate(): ShellInputDelegate | null {
  return activeShellDelegate;
}

// ============================================================================
// Cognito Physical Keyboard Policy Interface
// ============================================================================

export type CognitoPhysicalPolicyHandler = (event: KeyboardEvent) => boolean;

let cognitoPhysicalPolicy: CognitoPhysicalPolicyHandler | null = null;

export function setCognitoPhysicalPolicy(handler: CognitoPhysicalPolicyHandler | null): void {
  cognitoPhysicalPolicy = handler;
}

// ============================================================================
// Root Keyboard Coordinator (Architecture Contract C5)
// ============================================================================

const doubleShiftDetector = new DoubleShiftDetector();

function resolveActiveActionContext(
  delegate: ShellInputDelegate | null,
): ActionContext {
  const session = useWindowStore.getState().session;
  const activeDesktopId = delegate?.getActiveDesktopId() ?? session.activeDesktopId;
  const activeDesk = session.desktops.find((d) => d.id === activeDesktopId);
  const activeWindow =
    delegate?.getActiveWindow() ??
    (activeDesk?.focusedWindowId
      ? session.windows[activeDesk.focusedWindowId]
      : undefined);
  if (activeWindow) {
    if (activeWindow.appId === "editor") {
      const editorCtx = getEditorContextForWindow(activeWindow.id);
      if (editorCtx) return editorCtx;
    }
    const profileId = activeWindow.ctx.profileId;
    let owner: ConnectionRef | null = null;
    if (profileId) {
      try {
        const snap = getConnectionSnapshot(profileId);
        if (snap && snap.status === "connected") {
          owner = snap.owner;
        }
      } catch {
        // Fall back gracefully
      }
    }
    return {
      kind: "running-window",
      desktopId: activeWindow.desktopId,
      windowId: activeWindow.id,
      windowContext: activeWindow.ctx,
      runtimeIdentity: activeWindow.runtimeIdentity,
      owner,
      target: activeWindow.ctx.target,
    };
  }

  const desktopCtx = activeDesk?.defaultCtx ?? { profileId: "default" };
  let owner: ConnectionRef | null = null;
  if (desktopCtx.profileId) {
    try {
      const snap = getConnectionSnapshot(desktopCtx.profileId);
      if (snap && snap.status === "connected") {
        owner = snap.owner;
      }
    } catch {
      // Fall back gracefully
    }
  }

  return {
    kind: "desktop",
    desktopId: activeDesktopId,
    windowContext: desktopCtx,
    owner,
    target: desktopCtx.target,
  };
}

export function handleCoordinatorKeyEvent(event: KeyboardEvent): boolean {
  // If already handled in WeakMap, don't reprocess
  if (handledEvents.get(event)) {
    return true;
  }

  // --------------------------------------------------------------------------
  // Stage 1: Cognito Physical Keyboard Policy
  // --------------------------------------------------------------------------
  if (cognitoPhysicalPolicy) {
    const consumed = cognitoPhysicalPolicy(event);
    if (consumed) {
      markEventHandled(event);
      return true;
    }
  }

  // --------------------------------------------------------------------------
  // Stage 2: Settings Shortcut Capture Ownership
  // --------------------------------------------------------------------------
  if (isInsideShortcutCapture(event)) {
    doubleShiftDetector.reset();
    markEventHandled(event);
    return true;
  }

  // --------------------------------------------------------------------------
  // Stage 3: IME / Dead / Process / AltGraph Passthrough
  // --------------------------------------------------------------------------
  if (isImeOrCompositionEvent(event)) {
    doubleShiftDetector.reset();
    return false;
  }

  const delegate = activeShellDelegate;
  const isMenuOrModalActive =
    isContextMenuOpen() ||
    (delegate &&
      (delegate.getModalDepth() > 0 ||
        delegate.getActivePalette() ||
        delegate.getActiveNonmodal() !== null));

  // --------------------------------------------------------------------------
  // Stage 4: Current Modal / Context Menu Ownership
  // --------------------------------------------------------------------------
  if (isMenuOrModalActive) {
    doubleShiftDetector.reset();
    if (event.key === "Escape" && event.type === "keydown") {
      if (isContextMenuOpen()) {
        dismissContextMenu();
        event.preventDefault();
        event.stopImmediatePropagation();
        markEventHandled(event);
        return true;
      }
      if (delegate) {
        if (delegate.getActiveNonmodal() !== null) {
          delegate.closeActiveNonmodal();
          event.preventDefault();
          event.stopImmediatePropagation();
          markEventHandled(event);
          return true;
        }
        if (delegate.getActivePalette()) {
          delegate.closePalette();
          event.preventDefault();
          event.stopImmediatePropagation();
          markEventHandled(event);
          return true;
        }
      }
    }

    // Modal/menu cancels browser-reserved defaults without allowing background actions
    const suppression = getBrowserShortcutSuppression(event, event.target);
    if (suppression !== "none") {
      event.preventDefault();
      markEventHandled(event);
      return true;
    }

    // Modal active: do not execute background actions
    return false;
  }

  // --------------------------------------------------------------------------
  // Stage 5: Configured Enabled Action Resolution (including Page-Wide Font)
  // --------------------------------------------------------------------------
  if (event.type === "keydown") {
    const settings = useSettingsStore.getState();

    // 5a. DoubleShift check
    if (event.key === "Shift") {
      const binding =
        settings.searchFilenameShortcut !== undefined
          ? settings.searchFilenameShortcut
          : DEFAULT_SEARCH_FILENAME_SHORTCUT;
      if (binding === "DoubleShift") {
        const detected = doubleShiftDetector.match(event);
        if (detected) {
          const actionContext = resolveActiveActionContext(delegate);
          void executeAction({
            id: "search.filename",
            context: actionContext,
          });
          event.preventDefault();
          event.stopImmediatePropagation();
          markEventHandled(event);
          return true;
        }
      }
    } else {
      doubleShiftDetector.reset();
    }

    // 5b. Command Palette shortcut
    const paletteShortcut =
      settings.osPaletteShortcut !== undefined
        ? settings.osPaletteShortcut
        : DEFAULT_OS_PALETTE_SHORTCUT;
    if (paletteShortcut && matchesKeyboardShortcut(paletteShortcut, event)) {
      delegate?.togglePalette();
      event.preventDefault();
      event.stopImmediatePropagation();
      markEventHandled(event);
      return true;
    }

    // 5c. Focus cycle shortcut
    const cycleShortcut =
      settings.osCycleFocusShortcut !== undefined
        ? settings.osCycleFocusShortcut
        : DEFAULT_OS_CYCLE_FOCUS_SHORTCUT;
    if (cycleShortcut && matchesKeyboardShortcut(cycleShortcut, event)) {
      delegate?.cycleFocus();
      event.preventDefault();
      event.stopImmediatePropagation();
      markEventHandled(event);
      return true;
    }

    // 5d. Page-wide Terminal Font Increase / Decrease
    if (
      settings.terminalFontSizeIncreaseShortcut &&
      matchesKeyboardShortcut(settings.terminalFontSizeIncreaseShortcut, event)
    ) {
      if (settings.terminalFontSize < 32) {
        settings.saveDebounced({
          terminalFontSize: settings.terminalFontSize + 1,
        });
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      markEventHandled(event);
      return true;
    }

    if (
      settings.terminalFontSizeDecreaseShortcut &&
      matchesKeyboardShortcut(settings.terminalFontSizeDecreaseShortcut, event)
    ) {
      if (settings.terminalFontSize > 10) {
        settings.saveDebounced({
          terminalFontSize: settings.terminalFontSize - 1,
        });
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      markEventHandled(event);
      return true;
    }

    // 5e. Other configured actions (app shortcuts, etc.)
    const descriptors = listActionDescriptors();
    const actionContext = resolveActiveActionContext(delegate);

    for (const desc of descriptors) {
      const binding = resolveActionBinding(desc.id, settings);
      if (binding && matchesKeyboardShortcut(binding, event)) {
        const eligibility = canExecuteAction({ id: desc.id, context: actionContext });
        if (eligibility.canExecute) {
          void executeAction({ id: desc.id, context: actionContext });
          event.preventDefault();
          event.stopImmediatePropagation();
          markEventHandled(event);
          return true;
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Stage 6: Browser Shortcut Suppression
  // --------------------------------------------------------------------------
  const suppression = getBrowserShortcutSuppression(event, event.target);
  if (suppression === "block") {
    event.preventDefault();
    event.stopImmediatePropagation();
    markEventHandled(event);
    return true;
  }
  if (suppression === "prevent-default") {
    event.preventDefault();
    return false;
  }

  // --------------------------------------------------------------------------
  // Stage 7: Frame / Local App Behavior and Ordinary Input
  // --------------------------------------------------------------------------
  return false;
}

let coordinatorRefCount = 0;
const listenerOptions = { capture: true, passive: false };

function onKeyEvent(e: KeyboardEvent) {
  handleCoordinatorKeyEvent(e);
}

function onWindowBlur() {
  doubleShiftDetector.reset();
}

export function installRootKeyboardCoordinator(): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  coordinatorRefCount += 1;
  if (coordinatorRefCount === 1) {
    window.addEventListener("keydown", onKeyEvent, listenerOptions);
    window.addEventListener("keypress", onKeyEvent, listenerOptions);
    window.addEventListener("keyup", onKeyEvent, listenerOptions);
    window.addEventListener("blur", onWindowBlur);
  }

  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    coordinatorRefCount = Math.max(0, coordinatorRefCount - 1);
    if (coordinatorRefCount === 0) {
      window.removeEventListener("keydown", onKeyEvent, listenerOptions);
      window.removeEventListener("keypress", onKeyEvent, listenerOptions);
      window.removeEventListener("keyup", onKeyEvent, listenerOptions);
      window.removeEventListener("blur", onWindowBlur);
    }
  };
}
