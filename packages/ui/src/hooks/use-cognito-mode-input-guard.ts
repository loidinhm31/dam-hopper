import { useEffect, useLayoutEffect, useRef } from "react";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useSettingsStore } from "@/stores/settings.js";
import { BLOCKED_POINTER_EVENTS } from "@/lib/cognito-mode-events.js";
import {
  matchesKeyboardShortcut,
  DEFAULT_COGNITO_MODE_SHORTCUT,
  type ShortcutKeyEvent,
} from "@/lib/shortcuts.js";

const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function isInsideShortcutCapture(event: Event): boolean {
  if (typeof event.composedPath === "function") {
    for (const target of event.composedPath()) {
      if (
        target instanceof Element &&
        target.getAttribute("data-shortcut-capture") === "true"
      ) {
        return true;
      }
    }
  } else if (event.target instanceof Element) {
    if (event.target.closest('[data-shortcut-capture="true"]')) {
      return true;
    }
  }
  return false;
}

function createSuppressionEvent(event: KeyboardEvent): ShortcutKeyEvent {
  return {
    type: event.type,
    code: event.code,
    key: event.key,
    ctrlKey: Boolean(event.ctrlKey),
    metaKey: Boolean(event.metaKey),
    altKey: Boolean(event.altKey),
    shiftKey: Boolean(event.shiftKey),
    repeat: false,
    isComposing: false,
    keyCode: event.keyCode,
  };
}

/**
 * Installs window-capture listeners to intercept and suppress pointer, mouse,
 * touch, wheel, drag, clipboard, input, focus, and keyboard events while Cognito
 * Privacy Mode is active or toggling.
 */
export function useCognitoModeInputGuard(): void {
  const priorFocusedElementRef = useRef<HTMLElement | null>(null);
  const gestureInFlightRef = useRef<boolean>(false);
  const releaseTimerRef = useRef<number | null>(null);
  const consumedPhysicalCodesRef = useRef<Set<string>>(new Set());
  useClientLayoutEffect(() => {
    if (typeof window === "undefined") return;

    const clearReleaseTimer = () => {
      if (releaseTimerRef.current !== null) {
        window.clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
    };

    const handleBlockedEvent = (event: Event) => {
      const active = useCognitoModeStore.getState().active;
      const t = event.type;
      const isDown = t === "pointerdown" || t === "mousedown" || t === "touchstart";
      const isUp = t === "pointerup" || t === "mouseup" || t === "touchend";
      const isClick = t === "click" || t === "auxclick" || t === "contextmenu";

      if (active) {
        if (isDown) {
          gestureInFlightRef.current = true;
          clearReleaseTimer();
        } else if (
          (t === "pointermove" || t === "mousemove") &&
          "buttons" in event &&
          typeof event.buttons === "number" &&
          event.buttons > 0
        ) {
          gestureInFlightRef.current = true;
        } else if (isClick || t === "touchcancel") {
          gestureInFlightRef.current = false;
          clearReleaseTimer();
        } else if (isUp) {
          clearReleaseTimer();
          releaseTimerRef.current = window.setTimeout(() => {
            gestureInFlightRef.current = false;
            releaseTimerRef.current = null;
          }, 100);
        }

        if (event.cancelable) event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      // Inactive: consume trailing release/click if gesture started while active
      if (gestureInFlightRef.current) {
        if (isUp) {
          if (event.cancelable) event.preventDefault();
          event.stopImmediatePropagation();
          clearReleaseTimer();
          releaseTimerRef.current = window.setTimeout(() => {
            gestureInFlightRef.current = false;
            releaseTimerRef.current = null;
          }, 300);
          return;
        }

        if (isClick || t === "touchcancel") {
          if (event.cancelable) event.preventDefault();
          event.stopImmediatePropagation();
          gestureInFlightRef.current = false;
          clearReleaseTimer();
        }
      }
    };
    const handleKeyEvent = (event: KeyboardEvent) => {
      const { active, activationShortcut } = useCognitoModeStore.getState();
      const code = event.code;

      // 1. Consume pending releases/keypress/repeats from a key sequence already intercepted;
      // no fresh toggle from held keys.
      if (code && consumedPhysicalCodesRef.current.has(code)) {
        if (event.type === "keyup") {
          consumedPhysicalCodesRef.current.delete(code);
        }
        if (event.cancelable) event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      // 2. If active, choose frozen activationShortcut; consume all keys.
      // Toggle off only when it matches a fresh nonrepeat/noncomposing keydown,
      // then retain dismissal sequence tracking until release.
      if (active) {
        const chord =
          activationShortcut ??
          useSettingsStore.getState().cognitoModeShortcut ??
          DEFAULT_COGNITO_MODE_SHORTCUT;

        const isComposing = Boolean(event.isComposing) || event.keyCode === 229;
        if (
          event.type === "keydown" &&
          !event.repeat &&
          !isComposing &&
          matchesKeyboardShortcut(chord, event)
        ) {
          if (code) {
            consumedPhysicalCodesRef.current.add(code);
          }
          useCognitoModeStore.getState().toggle(chord);
          if (event.cancelable) event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }

        // All keys during active mode are consumed
        if (event.type === "keydown" && code) {
          consumedPhysicalCodesRef.current.add(code);
        } else if (event.type === "keyup" && code) {
          consumedPhysicalCodesRef.current.delete(code);
        }
        if (event.cancelable) event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      // 3. If inactive and target composedPath() includes [data-shortcut-capture="true"],
      // pass through so Settings capture works; no global toggle. Marker is only an inactive exemption.
      if (isInsideShortcutCapture(event)) {
        return;
      }

      // 4. If inactive and matching the configured Cognito chord, synchronously activate;
      // prevent default and stop immediate propagation. Eat composing/repeated variants of
      // the matching physical chord without toggling.
      const configuredShortcut =
        useSettingsStore.getState().cognitoModeShortcut ??
        DEFAULT_COGNITO_MODE_SHORTCUT;

      if (event.type === "keydown") {
        const isComposing = Boolean(event.isComposing) || event.keyCode === 229;
        if (
          !event.repeat &&
          !isComposing &&
          matchesKeyboardShortcut(configuredShortcut, event)
        ) {
          if (code) {
            consumedPhysicalCodesRef.current.add(code);
          }
          useCognitoModeStore.getState().toggle(configuredShortcut);
          if (event.cancelable) event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }

        // Check if composing or repeated variant of the configured chord
        const suppressionEvent = createSuppressionEvent(event);
        if (matchesKeyboardShortcut(configuredShortcut, suppressionEvent)) {
          if (code) {
            consumedPhysicalCodesRef.current.add(code);
          }
          if (event.cancelable) event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
      }

      // 5. Otherwise leave ordinary events unchanged. Browser guard and existing app handlers then own them.
    };

    const handleFocusCapture = (event: FocusEvent) => {
      if (!useCognitoModeStore.getState().active) return;
      const sink = document.querySelector<HTMLElement>(
        "[data-cognito-mode-overlay]",
      );
      if (!sink) return;

      const target = event.target;
      if (target === sink || (target instanceof Node && sink.contains(target))) {
        return;
      }

      if (typeof event.preventDefault === "function") event.preventDefault();
      event.stopImmediatePropagation();
      sink.focus({ preventScroll: true });
    };

    const handleWindowBlur = () => {
      gestureInFlightRef.current = false;
      clearReleaseTimer();
      consumedPhysicalCodesRef.current.clear();
    };

    const listenerOptions = { capture: true, passive: false };

    for (const eventName of BLOCKED_POINTER_EVENTS) {
      window.addEventListener(eventName, handleBlockedEvent, listenerOptions);
    }
    window.addEventListener("keydown", handleKeyEvent, listenerOptions);
    window.addEventListener("keypress", handleKeyEvent, listenerOptions);
    window.addEventListener("keyup", handleKeyEvent, listenerOptions);
    window.addEventListener("focus", handleFocusCapture, listenerOptions);
    window.addEventListener("focusin", handleFocusCapture, listenerOptions);
    window.addEventListener("blur", handleWindowBlur);
    const unsubscribe = useCognitoModeStore.subscribe((state, prevState) => {
      if (state.active && !prevState.active) {
        const current = document.activeElement;
        priorFocusedElementRef.current =
          current instanceof HTMLElement ? current : null;
        if (current instanceof HTMLElement) {
          current.blur();
        }
        const sink = document.querySelector<HTMLElement>(
          "[data-cognito-mode-overlay]",
        );
        sink?.focus({ preventScroll: true });
      } else if (!state.active && prevState.active) {
        const prior = priorFocusedElementRef.current;
        priorFocusedElementRef.current = null;
        const restore = () => {
          if (
            prior &&
            prior.isConnected &&
            !prior.hasAttribute("inert") &&
            !prior.closest("[inert]:not([data-cognito-mode-content])")
          ) {
            try {
              prior.focus({ preventScroll: true });
            } catch {}
          }
        };
        restore();
        if (document.activeElement !== prior) {
          queueMicrotask(restore);
          setTimeout(restore, 0);
        }
      }
    });
    return () => {
      unsubscribe();
      for (const eventName of BLOCKED_POINTER_EVENTS) {
        window.removeEventListener(
          eventName,
          handleBlockedEvent,
          listenerOptions,
        );
      }
      window.removeEventListener("keydown", handleKeyEvent, listenerOptions);
      window.removeEventListener("keypress", handleKeyEvent, listenerOptions);
      window.removeEventListener("keyup", handleKeyEvent, listenerOptions);
      window.removeEventListener("focus", handleFocusCapture, listenerOptions);
      window.removeEventListener("focusin", handleFocusCapture, listenerOptions);
      window.removeEventListener("blur", handleWindowBlur);

      clearReleaseTimer();
      consumedPhysicalCodesRef.current.clear();
      gestureInFlightRef.current = false;
      priorFocusedElementRef.current = null;
      useCognitoModeStore.getState().reset();
    };
  }, []);
}
