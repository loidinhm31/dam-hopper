import { useEffect, useRef } from "react";
import {
  DOUBLE_SHIFT_SHORTCUT,
  DoubleShiftDetector,
  matchesKeyboardShortcut,
  matchesWheelShortcut,
  parseShortcut,
  type ShortcutKeyEvent,
} from "@/lib/shortcuts.js";

type KeyboardShortcutHandler = (event: KeyboardEvent) => void;
type WheelShortcutHandler = (event: WheelEvent) => void;

export function useDocumentKeyboardShortcut(
  shortcut: string,
  handler: KeyboardShortcutHandler,
) {
  const handlerRef = useRef(handler);
  const detectorRef = useRef(new DoubleShiftDetector());

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (!matchesShortcut(shortcut, event, detectorRef.current)) return;
      event.preventDefault();
      handlerRef.current(event);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shortcut]);
}

export function addKeyboardShortcutListener(
  target: EventTarget,
  getShortcut: () => string,
  handler: KeyboardShortcutHandler,
): () => void {
  const detector = new DoubleShiftDetector();
  const onKeyDown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.defaultPrevented) return;
    if (!matchesShortcut(getShortcut(), keyboardEvent, detector)) return;
    keyboardEvent.preventDefault();
    keyboardEvent.stopPropagation();
    handler(keyboardEvent);
  };
  target.addEventListener("keydown", onKeyDown, { capture: true });
  return () =>
    target.removeEventListener("keydown", onKeyDown, { capture: true });
}

export function addWheelShortcutListener(
  target: EventTarget,
  getShortcut: () => string,
  handler: WheelShortcutHandler,
): () => void {
  const onWheel = (event: Event) => {
    const wheelEvent = event as WheelEvent;
    if (wheelEvent.defaultPrevented) return;
    if (!matchesWheelShortcut(getShortcut(), wheelEvent)) return;
    wheelEvent.preventDefault();
    handler(wheelEvent);
  };
  target.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => target.removeEventListener("wheel", onWheel, { capture: true });
}

function matchesShortcut(
  shortcut: string,
  event: KeyboardEvent,
  detector: DoubleShiftDetector,
): boolean {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return false;
  if (shortcut === DOUBLE_SHIFT_SHORTCUT || parsed.kind === "double-shift") {
    return detector.match(event as ShortcutKeyEvent);
  }
  return matchesKeyboardShortcut(shortcut, event as ShortcutKeyEvent);
}
