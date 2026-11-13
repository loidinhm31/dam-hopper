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
} from "../api/browser-host-types.js";

export const MODIFIER_ALT = 1;
export const MODIFIER_CTRL = 2;
export const MODIFIER_META = 4;
export const MODIFIER_SHIFT = 8;

export const MAX_QUEUE_RECORDS = 128;
export const MAX_INSERT_TEXT_BYTES = 4096;
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

interface ControlHandoff {
  id: number;
  isCurrent: () => boolean;
  onCancel: () => void;
  events: { event: KeyboardInput; bytes: number }[];
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
  getProfileEpoch: () => number;
  getSubscriptionEpoch: () => string | null;
  getLeaseToken: () => string | null;
  getViewportEpoch: () => number | string;
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
  private readonly getProfileEpoch: () => number;
  private readonly getSubscriptionEpoch: () => string | null;
  private readonly getLeaseToken: () => string | null;
  private readonly getViewportEpoch: () => number | string;
  private readonly getDrawnRect: () => DrawnRect | null;
  private readonly getControlSocket: () => WebSocket | null;
  private readonly isInputAllowed?: () => boolean;
  private readonly onError?: (err: Error) => void;

  private inputSeq = 0;
  private lastLeaseToken: string | null = null;
  private heldKeys = new Map<string, { key: string; code: string }>();
  private heldButtons = new Set<MouseButton>();
  private lastPointerCoords: { u: number; v: number } | null = null;
  private pendingCoalescable: InputMessage | null = null;
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
    if (this.isDisposed || !handoff.isCurrent()) {
      this.cancelControlHandoff();
      return false;
    }
    const next = handoff.events.shift();
    if (next) {
      handoff.bytes -= next.bytes;
      if (!this.dispatchKeyboardInput(next.event)) {
        this.cancelControlHandoff();
        return false;
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
      const bytes = new TextEncoder().encode(JSON.stringify(event)).length;
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
  ): { u: number; v: number } | null {
    const drawn = this.getDrawnRect();
    if (!drawn) return null;

    // Reject input if geometry is untrusted or viewport epoch is stale
    if (!drawn.inputTrusted) return null;
    if (String(drawn.viewportEpoch) !== String(this.getViewportEpoch())) {
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

    const u = (canvasX - drawn.drawX) / drawn.drawWidth;
    const v = (canvasY - drawn.drawY) / drawn.drawHeight;

    // Reject out-of-image
    if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) {
      return null;
    }

    return { u, v };
  }

  public handlePointerDown(
    e: CanvasPointerInput,
  ): boolean {
    if (this.isDisposed) return false;
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
    if (this.isDisposed) return false;
    const canvas = e.currentTarget as HTMLCanvasElement;
    const coords =
      this.mapClientToFractions(e.clientX, e.clientY, canvas) ??
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
  ): boolean {
    if (this.isDisposed) return false;
    const canvas = e.currentTarget as HTMLCanvasElement;
    const coords = this.mapClientToFractions(e.clientX, e.clientY, canvas);
    if (!coords) return false;

    this.lastPointerCoords = coords;

    // Eligible for coalescing with adjacent moves
    return this.enqueueCoalescableEvent({
      kind: "pointerMove",
      u: coords.u,
      v: coords.v,
      modifiers: extractModifiers(e),
    });
  }

  public handlePointerCancel(): boolean {
    if (this.isDisposed) return false;
    this.heldButtons.clear();
    this.flushCoalescable(true);
    return this.sendInputEvent({
      kind: "pointerCancel",
    });
  }
  public handleWheel(
    e: WheelEvent | React.WheelEvent<HTMLCanvasElement>,
  ): boolean {
    if (this.isDisposed) return false;
    const canvas = e.currentTarget as HTMLCanvasElement;
    const coords =
      this.mapClientToFractions(e.clientX, e.clientY, canvas) ??
      this.lastPointerCoords;
    if (!coords) return false;

    // Normalizing wheel delta
    const deltaX = e.deltaX;
    const deltaY = e.deltaY;

    // Coalesce with adjacent wheel events if pending
    return this.enqueueCoalescableEvent({
      kind: "wheel",
      u: coords.u,
      v: coords.v,
      deltaX,
      deltaY,
      delta_x: deltaX,
      delta_y: deltaY,
      modifiers: extractModifiers(e),
    });
  }

  public handleKeyDown(
    e: KeyboardEvent | React.KeyboardEvent,
  ): boolean {
    if (this.isDisposed) return false;

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
    if (this.isDisposed) return false;
    const codeKey = e.code || e.key;
    return this.handleKeyboardInput({
      kind: "keyUp",
      key: e.key,
      code: codeKey,
      modifiers: extractModifiers(e),
    });
  }

  public handleInsertText(rawText: string): boolean {
    if (this.isDisposed) return false;
    if (!rawText) return false;

    const encoder = new TextEncoder();
    const bytes = encoder.encode(rawText);
    let text = rawText;
    if (bytes.length > MAX_INSERT_TEXT_BYTES) {
      let end = MAX_INSERT_TEXT_BYTES;
      while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
        end--;
      }
      text = new TextDecoder("utf-8").decode(bytes.subarray(0, end));
    }

    return this.handleKeyboardInput({
      kind: "insertText",
      text,
    });
  }

  private enqueueCoalescableEvent(event: InputEvent): boolean {
    const socket = this.getControlSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;

    const leaseToken = this.syncLeaseState();
    const subEpoch = this.getSubscriptionEpoch();
    if (!leaseToken || !subEpoch) return false;
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
        prev.deltaX += event.deltaX;
        prev.deltaY += event.deltaY;
        prev.delta_x += event.delta_x;
        prev.delta_y += event.delta_y;
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
    const vpEpoch = Number(this.getViewportEpoch());

    this.pendingCoalescable = {
      browserSessionId: this.getSessionId(),
      browserIncarnation: this.getIncarnation(),
      profileEpoch: this.getProfileEpoch(),
      subscriptionEpoch: subEpoch,
      leaseToken,
      inputSeq: 0,
      viewportEpoch: Number.isFinite(vpEpoch) ? vpEpoch : 1,
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
  private flushCoalescable(isBarrier = false): void {
    this.cancelCoalescableTimer();
    if (!this.pendingCoalescable) return;
    const msg = this.pendingCoalescable;

    const socket = this.getControlSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 256 * 1024) {
      this.onError?.(new Error("Control socket output queue saturated"));
      return;
    }

    const currentLease = this.getLeaseToken();
    const currentSubEpoch = this.getSubscriptionEpoch();
    if (
      currentLease !== msg.leaseToken ||
      currentSubEpoch !== msg.subscriptionEpoch
    ) {
      this.pendingCoalescable = null;
      return;
    }

    const now = Date.now();
    const elapsed = now - this.lastCoalescableFlushAt;
    if (!isBarrier && elapsed < COALESCABLE_MIN_INTERVAL_MS) {
      this.scheduleCoalescableFlush();
      return;
    }

    if (!this.canSendReplaceable(now)) {
      this.pendingCoalescable = null;
      return;
    }

    this.pendingCoalescable = null;
    msg.inputSeq = ++this.inputSeq;
    this.lastCoalescableFlushAt = now;
    this.sentTimestamps.push(now);
    this.replaceableSentTimestamps.push(now);

    try {
      socket.send(JSON.stringify(msg));
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }
  private syncLeaseState(): string | null {
    const currentLease = this.getLeaseToken();
    if (currentLease !== this.lastLeaseToken) {
      const priorLease = this.lastLeaseToken;
      // Discard or flush pending coalescable events on prior lease before resetting
      if (currentLease === null) {
        this.cancelCoalescableTimer();
        this.pendingCoalescable = null;
      } else {
        this.flushCoalescable();
      }
      this.lastLeaseToken = currentLease;
      this.inputSeq = 0;
      if (priorLease !== null) {
        this.releaseAllHeldInput();
      }
    }
    return currentLease;
  }

  private sendInputEvent(event: InputEvent): boolean {
    const socket = this.getControlSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    if (socket.bufferedAmount > 256 * 1024) {
      this.onError?.(new Error("Control socket output queue saturated"));
      return false;
    }

    // Lease synchronisation may itself send release records: run it before admission so those
    // sends are counted and the budget check sits immediately before this event's send.
    const leaseToken = this.syncLeaseState();
    if (socket.readyState !== WebSocket.OPEN) {
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
    const subEpoch = this.getSubscriptionEpoch();
    if (!leaseToken || !subEpoch) {
      return false;
    }
    const vpEpoch = Number(this.getViewportEpoch());
    const seq = ++this.inputSeq;

    const msg: InputMessage = {
      browserSessionId: this.getSessionId(),
      browserIncarnation: this.getIncarnation(),
      profileEpoch: this.getProfileEpoch(),
      subscriptionEpoch: subEpoch,
      leaseToken,
      inputSeq: seq,
      viewportEpoch: Number.isFinite(vpEpoch) ? vpEpoch : 1,
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
  public releaseAllHeldInput(): void {
    this.cancelCoalescableTimer();
    this.pendingCoalescable = null;
    this.cancelControlHandoff();
    this.releaseDispatchedInput();
  }

  private releaseDispatchedInput(): void {
    if (this.heldKeys.size > 0) {
      for (const { key, code } of this.heldKeys.values()) {
        this.sendInputEvent({
          kind: "keyUp",
          key,
          code,
          modifiers: 0,
        });
      }
      this.heldKeys.clear();
    }

    if (this.heldButtons.size > 0) {
      this.sendInputEvent({
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
