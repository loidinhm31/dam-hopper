/**
 * Precise Pointer, Keyboard, IME and Control Input Controller.
 *
 * Implements input mapping, letterbox geometry containment, modifier bitmasks,
 * contiguous inputSeq sequencing, coalescing, and held-state cleanup per architecture-contracts.md §8.
 */

import {
  type DrawnRect,
} from "./stream-controller.js";
import {
  type InputEvent,
  type InputMessage,
  type MouseButton,
  isValidPositiveDecimalU64,
} from "../api/browser-host-types.js";

/** Wire counters are canonical positive decimal u64 strings; the local sequence is a bigint. */
const MAX_INPUT_SEQ = 18446744073709551615n;
/** A coalescable event waits for its `inputSeq`, which is assigned only when it is sent. */
type PendingInputMessage = Omit<InputMessage, "inputSeq">;

export const MODIFIER_ALT = 1;
export const MODIFIER_CTRL = 2;
export const MODIFIER_META = 4;
export const MODIFIER_SHIFT = 8;

export const MAX_QUEUE_RECORDS = 128;
export const MAX_INSERT_TEXT_BYTES = 4096;
export const MAX_PASTE_BYTES = 16 * 1024;
export const MAX_CONTROL_MESSAGE_BYTES = 16 * 1024;
export const WHEEL_LINE_HEIGHT_CSS_PX = 16;
export const MAX_WHEEL_DELTA_CSS_PX = 4096;

function clampWheelDeltaCssPx(value: number): number {
  if (value > MAX_WHEEL_DELTA_CSS_PX) return MAX_WHEEL_DELTA_CSS_PX;
  if (value < -MAX_WHEEL_DELTA_CSS_PX) return -MAX_WHEEL_DELTA_CSS_PX;
  return value;
}
const MAX_U64_DECIMAL_STR = "18446744073709551615";
const TEXT_ENCODER = new TextEncoder();

function utf8ByteLength(text: string): number {
  return TEXT_ENCODER.encode(text).length;
}
const EMPTY_INSERT_TEXT_EVENT_BYTES = utf8ByteLength(
  JSON.stringify({ kind: "insertText", text: "" }),
);
/**
 * Replaces unpaired UTF-16 surrogates with U+FFFD so JSON serialization never emits `\udXXX`
 * escapes that Rust `serde_json` rejects (which would skip a record and trigger SequenceGap).
 */
function normalizeWellFormedText(text: string): string {
  const maybe = text as string & { toWellFormed?: () => string };
  if (typeof maybe.toWellFormed === "function") {
    return maybe.toWellFormed();
  }
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}


/** Measures UTF-8 length up to `limit` without copying/encoding huge inputs; returns null above `limit`. */
function measureUtf8BytesUpTo(text: string, limit: number): number | null {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 < text.length) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          i++;
        } else {
          bytes += 3;
        }
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > limit) return null;
  }
  return bytes;
}

/** Splits `text` at Unicode scalar boundaries so every chunk satisfies raw and JSON-escaped limits. */
function splitBoundedInsertTextChunks(text: string, envelopeBytes: number): string[] | null {
  if (envelopeBytes >= MAX_CONTROL_MESSAGE_BYTES) return null;
  const chunks: string[] = [];
  let chunkStart = 0;
  let chunkRawBytes = 0;
  let chunkJsonBytes = 0;

  for (let i = 0; i < text.length; ) {
    const code = text.charCodeAt(i);
    let step = 1;
    let rawScalarBytes: number;
    let jsonScalarBytes: number;

    if (code <= 0x7f) {
      rawScalarBytes = 1;
      if (
        code === 0x22 ||
        code === 0x5c ||
        code === 0x08 ||
        code === 0x0c ||
        code === 0x0a ||
        code === 0x0d ||
        code === 0x09
      ) {
        jsonScalarBytes = 2;
      } else if (code < 0x20) {
        jsonScalarBytes = 6;
      } else {
        jsonScalarBytes = 1;
      }
    } else if (code <= 0x7ff) {
      rawScalarBytes = 2;
      jsonScalarBytes = 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 < text.length) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          step = 2;
          rawScalarBytes = 4;
          jsonScalarBytes = 4;
        } else {
          rawScalarBytes = 3;
          jsonScalarBytes = 6;
        }
      } else {
        rawScalarBytes = 3;
        jsonScalarBytes = 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      rawScalarBytes = 3;
      jsonScalarBytes = 6;
    } else {
      rawScalarBytes = 3;
      jsonScalarBytes = 3;
    }

    if (rawScalarBytes > MAX_INSERT_TEXT_BYTES || envelopeBytes + jsonScalarBytes > MAX_CONTROL_MESSAGE_BYTES) {
      return null;
    }

    if (
      chunkRawBytes + rawScalarBytes > MAX_INSERT_TEXT_BYTES ||
      envelopeBytes + chunkJsonBytes + jsonScalarBytes > MAX_CONTROL_MESSAGE_BYTES
    ) {
      chunks.push(text.slice(chunkStart, i));
      chunkStart = i;
      chunkRawBytes = 0;
      chunkJsonBytes = 0;
    }

    chunkRawBytes += rawScalarBytes;
    chunkJsonBytes += jsonScalarBytes;
    i += step;
  }

  if (chunkStart < text.length) {
    chunks.push(text.slice(chunkStart));
  }
  return chunks;
}
export const MAX_HANDOFF_BYTES = 16 * 1024;
// Leave headroom below the control channel's 100/s limit for pointer/cleanup records.
const HANDOFF_INTERVAL_MS = 25;
/**
 * Minimum interval between replaceable coalescable flushes (pointerMove / wheel).
 * Bound to 25ms (<=40/s) per performance contract.
 */
export const COALESCABLE_MIN_INTERVAL_MS = 25;

/**
 * Maximum rolling replaceable messages per second (pointerMove, wheel) - capped at <=40/s.
 */
export const MAX_REPLACEABLE_ROLLING_PER_SEC = 40;

/**
 * Combined rolling ceiling for normal traffic (replaceable + discrete presses/text). Leaves
 * 20/s of headroom beneath the server's 100/s sustained control limit.
 */
export const MAX_NORMAL_ROLLING_PER_SEC = 80;

/**
 * Hard combined rolling ceiling, equal to the server's sustained control limit. Only release
 * transitions (keyUp/pointerUp/pointerCancel) may use the headroom above the normal ceiling.
 */
export const MAX_COMBINED_ROLLING_PER_SEC = 100;
type KeyboardInput = Extract<InputEvent, { kind: "keyDown" | "keyUp" | "insertText" }>;

interface PasteBatchTracker {
  sent: number;
  reported?: boolean;
}

interface ControlHandoff {
  id: number;
  isCurrent: () => boolean;
  onCancel: () => void;
  events: { event: KeyboardInput; bytes: number; pasteBatch?: PasteBatchTracker }[];
  bytes: number;
  draining?: boolean;
  timer?: number;
  onComplete?: () => void;
}

export type CanvasPointerInput = Pick<
  PointerEvent,
  "currentTarget" | "clientX" | "clientY" | "button" |
  "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>;

export interface InputControllerOptions {
  getSessionId: () => string;
  getIncarnation: () => string;
  getProfileEpoch: () => string;
  getSubscriptionEpoch: () => string | null;
  getLeaseToken: () => string | null;
  getViewportEpoch: () => string;
  getDrawnRect: () => DrawnRect | null;
  getControlSocket: () => WebSocket | null;
  isInputAllowed?: () => boolean;
  onError?: (err: Error) => void;
}

export function extractModifiers(e: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  let mask = 0;
  if (e.altKey) mask |= MODIFIER_ALT;
  if (e.ctrlKey) mask |= MODIFIER_CTRL;
  if (e.metaKey) mask |= MODIFIER_META;
  if (e.shiftKey) mask |= MODIFIER_SHIFT;
  return mask;
}

export function mapPointerButton(button: number): MouseButton {
  switch (button) {
    case 0:
      return "left";
    case 1:
      return "middle";
    case 2:
      return "right";
    case 3:
      return "back";
    case 4:
      return "forward";
    default:
      return "none";
  }
}

export class BrowserInputController {
  private readonly getSessionId: () => string;
  private readonly getIncarnation: () => string;
  private readonly getProfileEpoch: () => string;
  private readonly getSubscriptionEpoch: () => string | null;
  private readonly getLeaseToken: () => string | null;
  private readonly getViewportEpoch: () => string;
  private readonly getDrawnRect: () => DrawnRect | null;
  private readonly getControlSocket: () => WebSocket | null;
  private readonly isInputAllowed?: () => boolean;
  private readonly onError?: (err: Error) => void;

  private inputSeq = 0n;
  private lastLeaseToken: string | null = null;
  private lastControlSocket: WebSocket | null = null;
  private lastSubscriptionEpoch: string | null = null;
  private lastWireEpochs: { profileEpoch: string; viewportEpoch: string } | null = null;
  private heldKeys = new Map<string, { key: string; code: string }>();
  private heldButtons = new Set<MouseButton>();
  private lastPointerCoords: { u: number; v: number } | null = null;
  private pendingCoalescable: PendingInputMessage | null = null;
  private coalescableTimer: number | null = null;
  private lastCoalescableFlushAt = -Infinity;
  /** Every message actually sent live (replaceable + discrete), rolling 1s. */
  private sentTimestamps: number[] = [];
  /** Subset of sentTimestamps that were replaceable (pointerMove / wheel). */
  private replaceableSentTimestamps: number[] = [];
  private isDisposed = false;
  private handoff: ControlHandoff | null = null;
  private handoffId = 0;
  constructor(options: InputControllerOptions) {
    this.getSessionId = options.getSessionId;
    this.getIncarnation = options.getIncarnation;
    this.getProfileEpoch = options.getProfileEpoch;
    this.getSubscriptionEpoch = options.getSubscriptionEpoch;
    this.getLeaseToken = options.getLeaseToken;
    this.getViewportEpoch = options.getViewportEpoch;
    this.getDrawnRect = options.getDrawnRect;
    this.getControlSocket = options.getControlSocket;
    this.isInputAllowed = options.isInputAllowed;
    this.onError = options.onError;
  }

  public getHeldKeys(): Set<string> {
    return new Set(this.heldKeys.keys());
  }

  public getHeldButtons(): Set<MouseButton> {
    return new Set(this.heldButtons);
  }

  /** Retain typeahead only for an explicit, provenance-fenced click acquiring control. */
  public beginControlHandoff(isCurrent: () => boolean, onCancel: () => void): number {
    this.cancelControlHandoff();
    this.syncLeaseState();
    const id = ++this.handoffId;
    if (!this.isDisposed) this.handoff = { id, isCurrent, onCancel, events: [], bytes: 0 };
    return id;
  }

  public cancelControlHandoff(): void {
    const handoff = this.handoff;
    this.handoff = null;
    if (handoff) {
      for (const item of handoff.events) {
        const batch = item.pasteBatch;
        if (batch && !batch.reported) {
          batch.reported = true;
          this.onError?.(
            new Error(
              batch.sent > 0
                ? "Paste interrupted: remote text may be incomplete"
                : "Paste rejected: control handoff cancelled",
            ),
          );
        }
      }
    }
    handoff?.onCancel();
    if (handoff?.timer !== undefined) clearTimeout(handoff.timer);
    if (handoff) this.releaseDispatchedInput();
  }

  /** The host must replay the focusing pointer gesture before committing typeahead. */
  public completeControlHandoff(id: number, onComplete?: () => void): boolean {
    const handoff = this.handoff;
    if (!handoff || handoff.id !== id || handoff.draining) return false;
    handoff.draining = true;
    handoff.onComplete = onComplete;
    return this.drainControlHandoff(handoff);
  }

  private drainControlHandoff(handoff: ControlHandoff): boolean {
    if (this.handoff !== handoff) return false;
    handoff.timer = undefined;
    // Typeahead queued while trusted must not replay after the frame became display-only.
    if (this.isDisposed || this.isDisplayOnly() || !handoff.isCurrent()) {
      this.cancelControlHandoff();
      return false;
    }
    const next = handoff.events.shift();
    if (next) {
      handoff.bytes -= next.bytes;
      if (!this.dispatchKeyboardInput(next.event)) {
        if (next.pasteBatch && !next.pasteBatch.reported) {
          next.pasteBatch.reported = true;
          this.onError?.(
            new Error(
              next.pasteBatch.sent > 0
                ? "Paste interrupted: remote text may be incomplete"
                : "Paste rejected: control channel unavailable",
            ),
          );
        }
        this.cancelControlHandoff();
        return false;
      }
      if (next.pasteBatch) {
        next.pasteBatch.sent += 1;
      }
    }
    if (handoff.events.length === 0) {
      this.handoff = null;
      handoff.onComplete?.();
    } else {
      // Keep the same gesture queue active: fresh typing cannot overtake its tail.
      handoff.timer = window.setTimeout(() => this.drainControlHandoff(handoff), HANDOFF_INTERVAL_MS);
    }
    return true;
  }

  private handleKeyboardInput(event: KeyboardInput): boolean {
    if (this.isInputAllowed && !this.isInputAllowed()) {
      this.cancelControlHandoff();
      return false;
    }
    const handoff = this.handoff;
    if (handoff) {
      if (!handoff.isCurrent()) {
        this.cancelControlHandoff();
        return false;
      }
      const bytes = utf8ByteLength(JSON.stringify(event));
      if (handoff.events.length >= MAX_QUEUE_RECORDS || handoff.bytes + bytes > MAX_HANDOFF_BYTES) {
        this.cancelControlHandoff();
        this.onError?.(new Error("Click control handoff typeahead limit exceeded"));
        return false;
      }
      handoff.events.push({ event, bytes });
      handoff.bytes += bytes;
      return true;
    }
    return this.dispatchKeyboardInput(event);
  }

  private dispatchKeyboardInput(event: KeyboardInput): boolean {
    this.flushCoalescable(true);
    if (!this.sendInputEvent(event)) return false;
    // Only remotely dispatched keys belong in held-state cleanup.
    if (event.kind === "keyDown") this.heldKeys.set(event.code, { key: event.key, code: event.code });
    if (event.kind === "keyUp") this.heldKeys.delete(event.code);
    return true;
  }

  /**
   * Computes aspect-fit fraction coordinates (u, v) in [0.0, 1.0] from canvas client coordinates.
   * Rejects events outside the letterbox image.
   */
  public mapClientToFractions(
    clientX: number,
    clientY: number,
    canvas: HTMLCanvasElement,
    clampToImage = false,
  ): { u: number; v: number } | null {
    const drawn = this.getDrawnRect();
    if (!drawn) return null;

    // Reject input if geometry is untrusted or viewport epoch is stale
    if (!drawn.inputTrusted) return null;
    if (drawn.viewportEpoch !== this.getViewportEpoch()) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    // Canvas internal pixel coordinates
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (clientX - rect.left) * scaleX;
    const canvasY = (clientY - rect.top) * scaleY;

    if (drawn.drawWidth <= 0 || drawn.drawHeight <= 0) return null;

    let u = (canvasX - drawn.drawX) / drawn.drawWidth;
    let v = (canvasY - drawn.drawY) / drawn.drawHeight;

    if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) {
      if (!clampToImage) return null;
      u = Math.min(1.0, Math.max(0.0, u));
      v = Math.min(1.0, Math.max(0.0, v));
    }

    return { u, v };
  }

  /**
   * Untrusted (downscaled/unverified) frames are display-only: no entry point may dispatch.
   * Any input arriving while display-only runs the existing paired release of held input
   * (keyUp / pointerCancel) and drops the stale pointer position, so nothing stays stuck
   * across a trusted -> untrusted transition and no later event can reuse old coordinates.
   */
  private isDisplayOnly(): boolean {
    if (this.getDrawnRect()?.inputTrusted) return false;
    this.lastPointerCoords = null;
    this.releaseAllHeldInput(false);
    return true;
  }

  public handlePointerDown(
    e: CanvasPointerInput,
  ): boolean {
    if (this.isDisposed || this.isDisplayOnly()) return false;
    const canvas = e.currentTarget as HTMLCanvasElement;
    const coords = this.mapClientToFractions(e.clientX, e.clientY, canvas);
    if (!coords) return false;

    const button = mapPointerButton(e.button);
    this.lastPointerCoords = coords;

    this.flushCoalescable(true);

    // Record held state only after the press was actually dispatched.
    if (
      !this.sendInputEvent({
        kind: "pointerDown",
        button,
        u: coords.u,
        v: coords.v,
        modifiers: extractModifiers(e),
      })
    ) {
      return false;
    }
    this.heldButtons.add(button);
    return true;
  }

  public handlePointerUp(
    e: CanvasPointerInput,
  ): boolean {
    if (this.isDisposed || this.isDisplayOnly()) return false;
    const canvas = e.currentTarget as HTMLCanvasElement;
    const coords =
      this.mapClientToFractions(e.clientX, e.clientY, canvas, this.heldButtons.size > 0) ??
      this.lastPointerCoords;
    if (!coords) return false;

    const button = mapPointerButton(e.button);
    this.heldButtons.delete(button);
    this.lastPointerCoords = coords;

    this.flushCoalescable(true);

    return this.sendInputEvent({
      kind: "pointerUp",
      button,
      u: coords.u,
      v: coords.v,
      modifiers: extractModifiers(e),
    });
  }

  public handlePointerMove(
    e: CanvasPointerInput,
    immediate = false,
  ): boolean {
    if (this.isDisposed || this.isDisplayOnly()) return false;
    const canvas = e.currentTarget as HTMLCanvasElement;
    const coords = this.mapClientToFractions(
      e.clientX,
      e.clientY,
      canvas,
      this.heldButtons.size > 0,
    );
    if (!coords) return false;
    this.lastPointerCoords = coords;

    // Eligible for coalescing with adjacent moves unless replaying pre-click trail.
    return this.enqueueCoalescableEvent(
      {
        kind: "pointerMove",
        u: coords.u,
        v: coords.v,
        modifiers: extractModifiers(e),
      },
      immediate,
    );
  }

  public handlePointerCancel(): boolean {
    if (this.isDisposed || this.isDisplayOnly()) return false;
    this.heldButtons.clear();
    this.flushCoalescable(true);
    return this.sendInputEvent({
      kind: "pointerCancel",
    });
  }
  public handleWheel(
    e: WheelEvent | React.WheelEvent<HTMLCanvasElement>,
  ): boolean {
    if (this.isDisposed || this.isDisplayOnly()) return false;
    if (!Number.isFinite(e.deltaX) || !Number.isFinite(e.deltaY)) return false;
    const rawDeltaMode = (e as { deltaMode?: unknown }).deltaMode;
    const deltaMode = rawDeltaMode === undefined ? 0 : rawDeltaMode;
    if (deltaMode !== 0 && deltaMode !== 1 && deltaMode !== 2) return false;

    const canvas = e.currentTarget as HTMLCanvasElement;
    const coords =
      this.mapClientToFractions(e.clientX, e.clientY, canvas) ??
      this.lastPointerCoords;
    if (!coords) return false;

    let scaleX = 1;
    let scaleY = 1;
    if (deltaMode === 1) {
      scaleX = WHEEL_LINE_HEIGHT_CSS_PX;
      scaleY = WHEEL_LINE_HEIGHT_CSS_PX;
    } else if (deltaMode === 2) {
      const drawn = this.getDrawnRect();
      const cssWidth = drawn?.geometry?.cssWidth;
      const cssHeight = drawn?.geometry?.cssHeight;
      if (
        !drawn?.inputTrusted ||
        drawn.viewportEpoch !== this.getViewportEpoch() ||
        typeof cssWidth !== "number" ||
        typeof cssHeight !== "number" ||
        !Number.isFinite(cssWidth) ||
        !Number.isFinite(cssHeight) ||
        cssWidth <= 0 ||
        cssHeight <= 0
      ) {
        return false;
      }
      scaleX = cssWidth;
      scaleY = cssHeight;
    }

    const delta_x = clampWheelDeltaCssPx(e.deltaX * scaleX);
    const delta_y = clampWheelDeltaCssPx(e.deltaY * scaleY);

    // Coalesce with adjacent wheel events if pending
    return this.enqueueCoalescableEvent({
      kind: "wheel",
      u: coords.u,
      v: coords.v,
      delta_x,
      delta_y,
      modifiers: extractModifiers(e),
    });
  }

  public handleKeyDown(
    e: KeyboardEvent | React.KeyboardEvent,
  ): boolean {
    if (this.isDisposed || this.isDisplayOnly()) return false;

    // Avoid duplicate text commit: printable text without modifiers is handled by TextInputProxy insertText
    const isControlOrMeta = e.ctrlKey || e.metaKey || e.altKey;
    const isSpecialKey =
      e.key.length > 1 ||
      isControlOrMeta ||
      e.key === "Enter" ||
      e.key === "Backspace" ||
      e.key === "Tab" ||
      e.key === "Escape" ||
      e.key === "Delete";

    if (!isSpecialKey) {
      // Defer single printable characters to text input proxy (insertText)
      return false;
    }
    const codeKey = e.code || e.key;
    return this.handleKeyboardInput({
      kind: "keyDown",
      key: e.key,
      code: codeKey,
      modifiers: extractModifiers(e),
    });
  }

  public handleKeyUp(
    e: KeyboardEvent | React.KeyboardEvent,
  ): boolean {
    if (this.isDisposed || this.isDisplayOnly()) return false;
    const codeKey = e.code || e.key;
    return this.handleKeyboardInput({
      kind: "keyUp",
      key: e.key,
      code: codeKey,
      modifiers: extractModifiers(e),
    });
  }

  public handleInsertText(rawText: string): boolean {
    if (this.isDisposed || this.isDisplayOnly()) return false;
    if (!rawText) return false;
    if (rawText.length > MAX_PASTE_BYTES) {
      return this.handlePasteText(rawText);
    }
    const text = normalizeWellFormedText(rawText);
    const rawBytes = measureUtf8BytesUpTo(text, MAX_INSERT_TEXT_BYTES);
    const envelopeBytes = this.measureMaxInsertTextEnvelopeBytes();
    if (
      rawBytes === null ||
      utf8ByteLength(JSON.stringify({ kind: "insertText", text })) -
        EMPTY_INSERT_TEXT_EVENT_BYTES +
        envelopeBytes >
        MAX_CONTROL_MESSAGE_BYTES
    ) {
      return this.handlePasteText(text);
    }
    return this.handleKeyboardInput({
      kind: "insertText",
      text,
    });
  }

  private measureMaxInsertTextEnvelopeBytes(): number {
    const sampleEnvelope: InputMessage = {
      browserSessionId: this.getSessionId(),
      browserIncarnation: this.getIncarnation(),
      profileEpoch: MAX_U64_DECIMAL_STR,
      subscriptionEpoch: this.getSubscriptionEpoch() ?? "00000000-0000-0000-0000-000000000000",
      leaseToken: this.getLeaseToken() ?? "00000000-0000-0000-0000-000000000000",
      inputSeq: MAX_U64_DECIMAL_STR,
      viewportEpoch: MAX_U64_DECIMAL_STR,
      event: { kind: "insertText", text: "" },
    };
    return utf8ByteLength(JSON.stringify(sampleEnvelope));
  }

  /**
   * Admits bounded plain-text paste (<= 16 KiB raw UTF-8) as an ordered batch of UTF-8-safe,
   * escape-aware `insertText` records, or rejects the entire paste visibly before sending.
   */
  public handlePasteText(rawText: string): boolean {
    if (!rawText) return false;
    if (this.isDisposed) return false;
    if (this.isDisplayOnly()) {
      this.onError?.(new Error("Paste rejected: stream display is read-only"));
      return false;
    }
    if (this.isInputAllowed && !this.isInputAllowed()) {
      this.cancelControlHandoff();
      this.onError?.(new Error("Paste rejected: input is not permitted"));
      return false;
    }

    const handoff = this.handoff;
    if (handoff && !handoff.isCurrent()) {
      this.cancelControlHandoff();
      this.onError?.(new Error("Paste rejected: control handoff cancelled"));
      return false;
    }

    const socket = this.getControlSocket();
    const leaseToken = handoff ? this.getLeaseToken() : this.syncLeaseState();
    const subEpoch = this.getSubscriptionEpoch();
    const wire = this.captureWireEpochs();

    if (!handoff) {
      if (!socket || socket.readyState !== WebSocket.OPEN || !leaseToken || !subEpoch || !wire) {
        this.onError?.(new Error("Paste rejected: active control lease required"));
        return false;
      }
      if (socket.bufferedAmount > 256 * 1024) {
        this.onError?.(new Error("Control socket output queue saturated"));
        try {
          socket.close(1008, "control socket output queue saturated");
        } catch {
          // already closing
        }
        return false;
      }
    }

    if (
      rawText.length > MAX_PASTE_BYTES ||
      measureUtf8BytesUpTo(rawText, MAX_PASTE_BYTES) === null
    ) {
      this.onError?.(new Error("Paste rejected: text exceeds the 16 KiB limit"));
      return false;
    }

    const text = normalizeWellFormedText(rawText);
    const envelopeBytes = this.measureMaxInsertTextEnvelopeBytes();
    const chunks = splitBoundedInsertTextChunks(text, envelopeBytes);
    if (!chunks || chunks.length === 0) {
      this.onError?.(new Error("Paste rejected: text exceeds control message size limit"));
      return false;
    }
    if (handoff) {
      const items = chunks.map((text) => {
        const event: KeyboardInput = { kind: "insertText", text };
        return { event, bytes: utf8ByteLength(JSON.stringify(event)) };
      });
      const totalEventBytes = items.reduce((sum, item) => sum + item.bytes, 0);
      if (
        handoff.events.length + items.length > MAX_QUEUE_RECORDS ||
        handoff.bytes + totalEventBytes > MAX_HANDOFF_BYTES
      ) {
        this.onError?.(new Error("Paste rejected: input queue busy or exceeds 16 KiB handoff limit"));
        return false;
      }
      const batch: PasteBatchTracker = { sent: 0 };
      for (const item of items) {
        handoff.events.push({ ...item, pasteBatch: batch });
        handoff.bytes += item.bytes;
      }
      return true;
    }

    const now = Date.now();
    this.pruneBudget(now);
    const pendingCost = this.pendingCoalescable ? 1 : 0;
    if (chunks.length + pendingCost > MAX_NORMAL_ROLLING_PER_SEC - this.sentTimestamps.length) {
      this.onError?.(new Error("Paste rejected: input rate capacity busy; try again"));
      return false;
    }

    this.flushCoalescable(true);
    for (let i = 0; i < chunks.length; i++) {
      if (
        this.isDisposed ||
        this.isDisplayOnly() ||
        (this.isInputAllowed && !this.isInputAllowed()) ||
        this.getLeaseToken() !== leaseToken ||
        this.getControlSocket() !== socket ||
        this.getSubscriptionEpoch() !== subEpoch
      ) {
        this.onError?.(
          new Error(
            i > 0
              ? "Paste interrupted: remote text may be incomplete"
              : "Paste rejected: control channel changed",
          ),
        );
        return false;
      }
      if (!this.dispatchKeyboardInput({ kind: "insertText", text: chunks[i] })) {
        if (i > 0) {
          this.onError?.(new Error("Paste interrupted: remote text may be incomplete"));
        } else if (socket!.readyState !== WebSocket.OPEN) {
          this.onError?.(new Error("Paste rejected: control channel closed"));
        }
        return false;
      }
    }
    return true;
  }

  private enqueueCoalescableEvent(event: InputEvent, immediate = false): boolean {
    const socket = this.getControlSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;

    const leaseToken = this.syncLeaseState();
    const subEpoch = this.getSubscriptionEpoch();
    const wire = this.captureWireEpochs();
    if (!leaseToken || !subEpoch || !wire) return false;
    this.lastWireEpochs = wire;
    if (immediate) {
      if (this.pendingCoalescable) {
        this.flushCoalescable(true);
      }
      this.pendingCoalescable = {
        browserSessionId: this.getSessionId(),
        browserIncarnation: this.getIncarnation(),
        profileEpoch: wire.profileEpoch,
        subscriptionEpoch: subEpoch,
        leaseToken,
        viewportEpoch: wire.viewportEpoch,
        event,
      };
      return this.flushCoalescable(true);
    }
    if (
      this.pendingCoalescable &&
      (this.pendingCoalescable.leaseToken !== leaseToken ||
        this.pendingCoalescable.subscriptionEpoch !== subEpoch ||
        this.pendingCoalescable.viewportEpoch !== wire.viewportEpoch ||
        this.pendingCoalescable.profileEpoch !== wire.profileEpoch)
    ) {
      this.cancelCoalescableTimer();
      this.pendingCoalescable = null;
    }
    if (this.pendingCoalescable) {
      const prev = this.pendingCoalescable.event;
      if (prev.kind === "pointerMove" && event.kind === "pointerMove") {
        prev.u = event.u;
        prev.v = event.v;
        prev.modifiers = event.modifiers;
        return true;
      }
      if (prev.kind === "wheel" && event.kind === "pointerMove") {
        // Never overwrite accumulated wheel deltas: the wheel carries the latest pointer position.
        prev.u = event.u;
        prev.v = event.v;
        prev.modifiers = event.modifiers;
        return true;
      }
      if (prev.kind === "wheel" && event.kind === "wheel") {
        prev.delta_x = clampWheelDeltaCssPx(prev.delta_x + event.delta_x);
        prev.delta_y = clampWheelDeltaCssPx(prev.delta_y + event.delta_y);
        prev.u = event.u;
        prev.v = event.v;
        prev.modifiers = event.modifiers;
        return true;
      }
      // Different coalescable event: replace pending event while preserving scheduled cadence
      this.pendingCoalescable.event = event;
      this.scheduleCoalescableFlush();
      return true;
    }
    this.pendingCoalescable = {
      browserSessionId: this.getSessionId(),
      browserIncarnation: this.getIncarnation(),
      profileEpoch: wire.profileEpoch,
      subscriptionEpoch: subEpoch,
      leaseToken,
      viewportEpoch: wire.viewportEpoch,
      event,
    };

    this.scheduleCoalescableFlush();

    return true;
  }

  private scheduleCoalescableFlush(): void {
    if (this.coalescableTimer !== null || !this.pendingCoalescable) return;
    const now = Date.now();
    const elapsed = now - this.lastCoalescableFlushAt;
    const delayMs = Math.max(0, COALESCABLE_MIN_INTERVAL_MS - elapsed);
    if (delayMs === 0) {
      queueMicrotask(() => {
        this.flushCoalescable(false);
      });
    } else {
      this.coalescableTimer = window.setTimeout(() => {
        this.coalescableTimer = null;
        this.flushCoalescable(false);
      }, delayMs);
    }
  }

  private cancelCoalescableTimer(): void {
    if (this.coalescableTimer !== null) {
      clearTimeout(this.coalescableTimer);
      this.coalescableTimer = null;
    }
  }

  private pruneBudget(now: number): void {
    const cutoff = now - 1000;
    while (this.sentTimestamps.length > 0 && this.sentTimestamps[0] < cutoff) {
      this.sentTimestamps.shift();
    }
    while (
      this.replaceableSentTimestamps.length > 0 &&
      this.replaceableSentTimestamps[0] < cutoff
    ) {
      this.replaceableSentTimestamps.shift();
    }
  }

  private canSendReplaceable(now: number): boolean {
    this.pruneBudget(now);
    return (
      this.replaceableSentTimestamps.length < MAX_REPLACEABLE_ROLLING_PER_SEC &&
      this.sentTimestamps.length < MAX_NORMAL_ROLLING_PER_SEC
    );
  }

  private canSendDiscrete(now: number, isRelease: boolean): boolean {
    this.pruneBudget(now);
    return (
      this.sentTimestamps.length <
      (isRelease ? MAX_COMBINED_ROLLING_PER_SEC : MAX_NORMAL_ROLLING_PER_SEC)
    );
  }
  private flushCoalescable(isBarrier = false): boolean {
    this.cancelCoalescableTimer();
    if (this.isDisposed || !this.pendingCoalescable) {
      this.pendingCoalescable = null;
      return false;
    }
    // Queued while trusted; the frame may have become display-only before this deferred flush.
    if (this.isDisplayOnly()) {
      if (isBarrier) this.pendingCoalescable = null;
      return false;
    }
    const msg = this.pendingCoalescable;

    const socket = this.getControlSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      if (isBarrier) this.pendingCoalescable = null;
      return false;
    }
    if (socket.bufferedAmount > 256 * 1024) {
      this.pendingCoalescable = null;
      this.onError?.(new Error("Control socket output queue saturated"));
      try {
        socket.close(1008, "control socket output queue saturated");
      } catch {
        // already closing
      }
      return false;
    }

    const currentLease = this.getLeaseToken();
    const currentSubEpoch = this.getSubscriptionEpoch();
    if (
      (this.lastControlSocket !== null && socket !== this.lastControlSocket) ||
      currentLease !== msg.leaseToken ||
      currentSubEpoch !== msg.subscriptionEpoch ||
      msg.viewportEpoch !== this.getViewportEpoch() ||
      msg.profileEpoch !== this.getProfileEpoch()
    ) {
      // Identity moved since the event was captured: never send it under a stale epoch.
      this.pendingCoalescable = null;
      return false;
    }

    const now = Date.now();
    const elapsed = now - this.lastCoalescableFlushAt;
    if (!isBarrier && elapsed < COALESCABLE_MIN_INTERVAL_MS) {
      this.scheduleCoalescableFlush();
      return true;
    }

    if (!this.canSendReplaceable(now)) {
      this.pendingCoalescable = null;
      return false;
    }

    this.pendingCoalescable = null;
    const inputSeq = this.nextInputSeq();
    if (inputSeq === null) return false;
    const wireMsg: InputMessage = { ...msg, inputSeq };
    this.lastCoalescableFlushAt = now;
    this.sentTimestamps.push(now);
    this.replaceableSentTimestamps.push(now);

    try {
      socket.send(JSON.stringify(wireMsg));
      return true;
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  /** Both wire epochs, or null when either is not a canonical positive decimal u64 string. */
  private captureWireEpochs(): { profileEpoch: string; viewportEpoch: string } | null {
    const profileEpoch = this.getProfileEpoch();
    const viewportEpoch = this.getViewportEpoch();
    if (!isValidPositiveDecimalU64(profileEpoch) || !isValidPositiveDecimalU64(viewportEpoch)) {
      return null;
    }
    return { profileEpoch, viewportEpoch };
  }

  /**
   * Next contiguous wire `inputSeq`. An exhausted u64 sequence is never reused or wrapped: input
   * stops until the lease is reacquired, which restarts the server-side sequence.
   */
  private nextInputSeq(): string | null {
    if (this.inputSeq >= MAX_INPUT_SEQ) {
      this.onError?.(new Error("Input sequence exhausted; reacquire control to continue"));
      return null;
    }
    this.inputSeq += 1n;
    return this.inputSeq.toString();
  }
  private syncLeaseState(): string | null {
    const currentLease = this.getLeaseToken();
    const currentSocket = this.getControlSocket();
    const currentSubEpoch = this.getSubscriptionEpoch();
    const currentWire = this.captureWireEpochs();
    if (
      currentLease !== this.lastLeaseToken ||
      currentSocket !== this.lastControlSocket ||
      currentSubEpoch !== this.lastSubscriptionEpoch
    ) {
      const priorLease = this.lastLeaseToken;
      const priorSocket = this.lastControlSocket;
      const priorSubEpoch = this.lastSubscriptionEpoch;
      const priorWire = this.lastWireEpochs ?? currentWire;
      if (priorLease !== null) {
        if (
          this.pendingCoalescable &&
          priorSocket === currentSocket &&
          priorSubEpoch === currentSubEpoch &&
          priorSocket?.readyState === WebSocket.OPEN &&
          this.pendingCoalescable.leaseToken === priorLease &&
          this.getDrawnRect()?.inputTrusted
        ) {
          this.flushCoalescable(true);
        } else {
          this.cancelCoalescableTimer();
          this.pendingCoalescable = null;
        }
        this.cancelControlHandoff();
        // Always release prior holds on the original lease/channel before binding the replacement.
        this.releaseDispatchedInputOnChannel(priorSocket, priorLease, priorSubEpoch, priorWire);
      } else {
        this.cancelCoalescableTimer();
        this.pendingCoalescable = null;
      }
      this.lastLeaseToken = currentLease;
      this.lastControlSocket = currentSocket;
      this.lastSubscriptionEpoch = currentSubEpoch;
      this.lastWireEpochs = currentWire;
      this.inputSeq = 0n;
    } else if (currentWire) {
      this.lastWireEpochs = currentWire;
    }
    return currentLease;
  }

  private sendInputEvent(event: InputEvent): boolean {
    const socket = this.getControlSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    // Lease synchronisation may itself send release records on the prior lease/channel: run it
    // before admission so those sends are counted and the budget check sits before this send.
    const leaseToken = this.syncLeaseState();
    const subEpoch = this.getSubscriptionEpoch();
    const wire = this.captureWireEpochs();
    if (wire) this.lastWireEpochs = wire;
    return this.sendEventOnChannel(socket, leaseToken, subEpoch, wire, event);
  }

  private sendEventOnChannel(
    socket: WebSocket | null,
    leaseToken: string | null,
    subEpoch: string | null,
    wire: { profileEpoch: string; viewportEpoch: string } | null,
    event: InputEvent,
  ): boolean {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    if (socket.bufferedAmount > 256 * 1024) {
      this.onError?.(new Error("Control socket output queue saturated"));
      try {
        socket.close(1008, "control socket output queue saturated");
      } catch {
        // already closing
      }
      return false;
    }

    const now = Date.now();
    const isRelease =
      event.kind === "keyUp" ||
      event.kind === "pointerUp" ||
      event.kind === "pointerCancel";
    if (!this.canSendDiscrete(now, isRelease)) {
      this.onError?.(new Error("Input rate budget saturated"));
      // Key/button transitions are never silently dropped or queued without bound: close
      // fail-closed so the server releases lease-held input and the owner reconnects.
      try {
        socket.close(1008, "input rate budget exhausted");
      } catch {
        // already closing
      }
      return false;
    }
    if (!leaseToken || !subEpoch || !wire) {
      return false;
    }
    const seq = this.nextInputSeq();
    if (seq === null) return false;

    const msg: InputMessage = {
      browserSessionId: this.getSessionId(),
      browserIncarnation: this.getIncarnation(),
      profileEpoch: wire.profileEpoch,
      subscriptionEpoch: subEpoch,
      leaseToken,
      inputSeq: seq,
      viewportEpoch: wire.viewportEpoch,
      event,
    };

    try {
      socket.send(JSON.stringify(msg));
      this.sentTimestamps.push(now);
      return true;
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  /**
   * Cleans up all held keys and pointer buttons to prevent stuck keys on blur/privacy/modal.
   */
  public releaseAllHeldInput(flushPendingMove = true): void {
    if (flushPendingMove && this.pendingCoalescable && this.getDrawnRect()?.inputTrusted) {
      this.flushCoalescable(true);
    } else {
      this.cancelCoalescableTimer();
      this.pendingCoalescable = null;
    }
    this.cancelControlHandoff();
    this.releaseDispatchedInput();
  }

  private releaseDispatchedInput(): void {
    const socket = this.lastControlSocket ?? this.getControlSocket();
    const leaseToken = this.lastLeaseToken ?? this.getLeaseToken();
    const subEpoch = this.lastSubscriptionEpoch ?? this.getSubscriptionEpoch();
    const wire = this.captureWireEpochs() ?? this.lastWireEpochs;
    this.releaseDispatchedInputOnChannel(socket, leaseToken, subEpoch, wire);
  }

  private releaseDispatchedInputOnChannel(
    socket: WebSocket | null,
    leaseToken: string | null,
    subEpoch: string | null,
    wire: { profileEpoch: string; viewportEpoch: string } | null,
  ): void {
    if (this.heldKeys.size > 0) {
      for (const { key, code } of this.heldKeys.values()) {
        if (
          !this.sendEventOnChannel(socket, leaseToken, subEpoch, wire, {
            kind: "keyUp",
            key,
            code,
            modifiers: 0,
          })
        ) {
          break;
        }
      }
      this.heldKeys.clear();
    }

    if (this.heldButtons.size > 0) {
      this.sendEventOnChannel(socket, leaseToken, subEpoch, wire, {
        kind: "pointerCancel",
      });
      this.heldButtons.clear();
    }
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.cancelCoalescableTimer();
    this.pendingCoalescable = null;
    this.releaseAllHeldInput();
  }
}
