import { useEffect, useLayoutEffect, useRef } from "react";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { BLOCKED_POINTER_EVENTS } from "@/lib/cognito-mode-events.js";

const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Installs window-capture listeners to intercept and suppress pointer, mouse,
 * touch, wheel, drag, clipboard, input, and focus events while Cognito Privacy
 * Mode is active. Also tracks in-flight gestures so ending release/click sequences
 * are consumed if deactivation occurs before the gesture completes.
 */
export function useCognitoModeInputGuard(): void {
  const priorFocusedElementRef = useRef<HTMLElement | null>(null);
  const gestureInFlightRef = useRef<boolean>(false);
  const releaseTimerRef = useRef<number | null>(null);

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
    };

    const listenerOptions = { capture: true, passive: false };

    for (const eventName of BLOCKED_POINTER_EVENTS) {
      window.addEventListener(eventName, handleBlockedEvent, listenerOptions);
    }
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
      window.removeEventListener("focus", handleFocusCapture, listenerOptions);
      window.removeEventListener("focusin", handleFocusCapture, listenerOptions);
      window.removeEventListener("blur", handleWindowBlur);

      clearReleaseTimer();
      gestureInFlightRef.current = false;
      priorFocusedElementRef.current = null;
      useCognitoModeStore.getState().reset();
    };
  }, []);
}
