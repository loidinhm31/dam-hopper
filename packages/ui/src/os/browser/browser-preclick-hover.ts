import type { CanvasPointerInput } from "@/browser-host/input-controller.js";

const PRECLICK_HOVER_WINDOW_MS = 600;
const MAX_PRECLICK_HOVER_MOVES = 5;
const MIN_CLICK_DWELL_MS = 45;
const MAX_CLICK_DWELL_MS = 180;

export interface PreClickHoverSample {
  pointer: CanvasPointerInput;
  atMs: number;
}

export interface PreClickHoverBuffer {
  latest: CanvasPointerInput | null;
  recent: PreClickHoverSample[];
}

export function createPreClickHoverBuffer(): PreClickHoverBuffer {
  return { latest: null, recent: [] };
}

export function clearPreClickHoverBuffer(buffer: PreClickHoverBuffer): void {
  buffer.latest = null;
  buffer.recent.length = 0;
}

export function recordPreClickHover(
  buffer: PreClickHoverBuffer,
  pointer: CanvasPointerInput,
  nowMs: number = Date.now(),
): void {
  buffer.latest = pointer;
  const cutoff = nowMs - PRECLICK_HOVER_WINDOW_MS;
  while (buffer.recent.length > 0 && buffer.recent[0].atMs < cutoff) {
    buffer.recent.shift();
  }
  buffer.recent.push({ pointer, atMs: nowMs });
  if (buffer.recent.length > MAX_PRECLICK_HOVER_MOVES) {
    buffer.recent.splice(0, buffer.recent.length - MAX_PRECLICK_HOVER_MOVES);
  }
}

function samePointerTarget(a: CanvasPointerInput, b: CanvasPointerInput): boolean {
  return (
    a.clientX === b.clientX &&
    a.clientY === b.clientY &&
    a.altKey === b.altKey &&
    a.ctrlKey === b.ctrlKey &&
    a.metaKey === b.metaKey &&
    a.shiftKey === b.shiftKey
  );
}

/**
 * Returns buffered approach moves ending at `downPointer` (only when at least one
 * pre-click hover was observed while view-only), then clears the buffer.
 */
export function consumePreClickHoverTrail(
  buffer: PreClickHoverBuffer,
  downPointer: CanvasPointerInput,
  nowMs: number = Date.now(),
): CanvasPointerInput[] {
  const cutoff = nowMs - PRECLICK_HOVER_WINDOW_MS;
  const recentMoves = buffer.recent
    .filter((sample) => sample.atMs >= cutoff)
    .map((sample) => sample.pointer);
  const trail =
    recentMoves.length > 0
      ? recentMoves
      : buffer.latest
        ? [buffer.latest]
        : [];
  clearPreClickHoverBuffer(buffer);
  if (trail.length === 0) {
    return [];
  }
  const last = trail[trail.length - 1];
  if (!samePointerTarget(last, downPointer)) {
    trail.push(downPointer);
  }
  return trail;
}

export function computeClickDwellMs(downAtMs: number, upAtMs: number): number {
  const raw = Number.isFinite(upAtMs - downAtMs) ? upAtMs - downAtMs : MIN_CLICK_DWELL_MS;
  return Math.min(MAX_CLICK_DWELL_MS, Math.max(MIN_CLICK_DWELL_MS, raw));
}
