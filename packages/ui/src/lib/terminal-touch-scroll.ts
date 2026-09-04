import type { Terminal } from "@xterm/xterm";

const COARSE_POINTER_QUERY = "(any-pointer: coarse)";
const MIN_FLING_VELOCITY = 0.05;
const MAX_FLING_VELOCITY = 2;
const FLING_DECAY_MS = 180;
const MAX_FRAME_DELTA_MS = 32;
const FALLBACK_LINE_HEIGHT = 16;

type ScrollableTerminal = Pick<Terminal, "rows" | "scrollLines">;

/**
 * xterm renders scrollback through its buffer API, not a native scroll
 * container. Keep touch listeners passive and translate vertical swipes into
 * line scrolling on coarse-pointer devices.
 */
export function bindTerminalTouchScroll(
  root: HTMLElement | null,
  terminal: ScrollableTerminal | null = null,
): () => void {
  if (
    !root ||
    !terminal ||
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function" ||
    !window.matchMedia(COARSE_POINTER_QUERY).matches
  ) {
    return () => {};
  }

  let activeTouchId: number | null = null;
  let lastClientY = 0;
  let lastTimestamp = 0;
  let pendingPixels = 0;
  let velocity = 0;
  let moveFrame: number | null = null;
  let inertiaFrame: number | null = null;
  let inertiaTimestamp = 0;
  let disposed = false;

  const screen = root.querySelector<HTMLElement>(".xterm-screen");
  const lineHeight = (): number => {
    const height = screen?.getBoundingClientRect().height ?? 0;
    return height > 0 && terminal.rows > 0
      ? height / terminal.rows
      : FALLBACK_LINE_HEIGHT;
  };

  const cancelFrame = (frame: number | null): null => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    return null;
  };

  const flushPendingScroll = (): void => {
    const height = lineHeight();
    const rows =
      pendingPixels > 0
        ? Math.floor(pendingPixels / height)
        : Math.ceil(pendingPixels / height);
    if (rows === 0) return;
    pendingPixels -= rows * height;
    terminal.scrollLines(rows);
  };

  const scheduleMoveFlush = (): void => {
    if (moveFrame !== null) return;
    moveFrame = window.requestAnimationFrame(() => {
      moveFrame = null;
      flushPendingScroll();
    });
  };

  const stopInertia = (): void => {
    inertiaFrame = cancelFrame(inertiaFrame);
    velocity = 0;
  };
  const cancelActiveTouch = (): void => {
    activeTouchId = null;
    moveFrame = cancelFrame(moveFrame);
    pendingPixels = 0;
    stopInertia();
  };

  const startInertia = (): void => {
    if (Math.abs(velocity) < MIN_FLING_VELOCITY) return;
    inertiaTimestamp = performance.now();
    const tick = (timestamp: number): void => {
      inertiaFrame = null;
      const elapsed = Math.min(
        MAX_FRAME_DELTA_MS,
        Math.max(1, timestamp - inertiaTimestamp),
      );
      inertiaTimestamp = timestamp;
      pendingPixels += velocity * elapsed;
      flushPendingScroll();
      velocity *= Math.exp(-elapsed / FLING_DECAY_MS);
      if (Math.abs(velocity) >= MIN_FLING_VELOCITY && !disposed) {
        inertiaFrame = window.requestAnimationFrame(tick);
      } else {
        velocity = 0;
      }
    };
    inertiaFrame = window.requestAnimationFrame(tick);
  };

  const touchForId = (touches: TouchList, identifier: number): Touch | null => {
    for (let index = 0; index < touches.length; index += 1) {
      const touch = touches[index];
      if (touch?.identifier === identifier) return touch;
    }
    return null;
  };

  const handleTouchStart = (event: TouchEvent): void => {
    if (activeTouchId !== null) {
      if (event.touches.length > 1) cancelActiveTouch();
      return;
    }
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        ".xterm-helper-textarea, .xterm-scrollable-element > .scrollbar",
      )
    ) {
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    stopInertia();
    pendingPixels = 0;
    activeTouchId = touch.identifier;
    lastClientY = touch.clientY;
    lastTimestamp = event.timeStamp || performance.now();
  };

  const handleTouchMove = (event: TouchEvent): void => {
    if (activeTouchId === null) return;
    if (event.touches.length > 1) {
      cancelActiveTouch();
      return;
    }
    const touch = touchForId(event.touches, activeTouchId);
    if (!touch) return;
    const timestamp = event.timeStamp || performance.now();
    const elapsed = Math.max(1, timestamp - lastTimestamp);
    const delta = lastClientY - touch.clientY;
    if (delta !== 0) {
      pendingPixels += delta;
      velocity = Math.max(
        -MAX_FLING_VELOCITY,
        Math.min(MAX_FLING_VELOCITY, velocity * 0.7 + (delta / elapsed) * 0.3),
      );
      scheduleMoveFlush();
    }
    lastClientY = touch.clientY;
    lastTimestamp = timestamp;
  };

  const handleTouchEnd = (event: TouchEvent, fling: boolean): void => {
    if (activeTouchId === null) return;
    if (!touchForId(event.changedTouches, activeTouchId)) return;
    if (event.touches.length > 0) {
      cancelActiveTouch();
      return;
    }
    activeTouchId = null;
    moveFrame = cancelFrame(moveFrame);
    flushPendingScroll();
    if (fling) startInertia();
    else stopInertia();
  };

  const handleTouchEndWithFling = (event: TouchEvent): void =>
    handleTouchEnd(event, true);
  const handleTouchCancel = (event: TouchEvent): void =>
    handleTouchEnd(event, false);

  const listenerOptions: AddEventListenerOptions = {
    capture: true,
    passive: true,
  };
  root.addEventListener("touchstart", handleTouchStart, listenerOptions);
  root.addEventListener("touchmove", handleTouchMove, listenerOptions);
  root.addEventListener("touchend", handleTouchEndWithFling, listenerOptions);
  root.addEventListener("touchcancel", handleTouchCancel, listenerOptions);

  return () => {
    if (disposed) return;
    disposed = true;
    moveFrame = cancelFrame(moveFrame);
    stopInertia();
    root.removeEventListener("touchstart", handleTouchStart, true);
    root.removeEventListener("touchmove", handleTouchMove, true);
    root.removeEventListener("touchend", handleTouchEndWithFling, true);
    root.removeEventListener("touchcancel", handleTouchCancel, true);
  };
}
