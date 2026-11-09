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

export interface InputControllerOptions {
  getSessionId: () => string;
  getIncarnation: () => string;
  getProfileEpoch: () => number;
  getSubscriptionEpoch: () => string | null;
  getLeaseToken: () => string | null;
  getViewportEpoch: () => number | string;
  getDrawnRect: () => DrawnRect | null;
  getControlSocket: () => WebSocket | null;
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
  private readonly onError?: (err: Error) => void;

  private inputSeq = 0;
  private lastLeaseToken: string | null = null;
  private heldKeys = new Map<string, { key: string; code: string }>();
  private heldButtons = new Set<MouseButton>();
  private lastPointerCoords: { u: number; v: number } | null = null;
  private pendingCoalescable: InputMessage | null = null;
  private isDisposed = false;
  constructor(options: InputControllerOptions) {
    this.getSessionId = options.getSessionId;
    this.getIncarnation = options.getIncarnation;
    this.getProfileEpoch = options.getProfileEpoch;
    this.getSubscriptionEpoch = options.getSubscriptionEpoch;
    this.getLeaseToken = options.getLeaseToken;
    this.getViewportEpoch = options.getViewportEpoch;
    this.getDrawnRect = options.getDrawnRect;
    this.getControlSocket = options.getControlSocket;
    this.onError = options.onError;
  }

  public getHeldKeys(): Set<string> {
    return new Set(this.heldKeys.keys());
  }

  public getHeldButtons(): Set<MouseButton> {
    return new Set(this.heldButtons);
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
    e: PointerEvent | React.PointerEvent<HTMLCanvasElement>,
  ): boolean {
    if (this.isDisposed) return false;
    const canvas = e.currentTarget as HTMLCanvasElement;
    const coords = this.mapClientToFractions(e.clientX, e.clientY, canvas);
    if (!coords) return false;

    const button = mapPointerButton(e.button);
    this.heldButtons.add(button);
    this.lastPointerCoords = coords;

    this.flushCoalescable();

    return this.sendInputEvent({
      kind: "pointerDown",
      button,
      u: coords.u,
      v: coords.v,
      modifiers: extractModifiers(e),
    });
  }

  public handlePointerUp(
    e: PointerEvent | React.PointerEvent<HTMLCanvasElement>,
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

    this.flushCoalescable();

    return this.sendInputEvent({
      kind: "pointerUp",
      button,
      u: coords.u,
      v: coords.v,
      modifiers: extractModifiers(e),
    });
  }

  public handlePointerMove(
    e: PointerEvent | React.PointerEvent<HTMLCanvasElement>,
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
    this.flushCoalescable();
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
    this.heldKeys.set(codeKey, { key: e.key, code: codeKey });
    this.flushCoalescable();

    return this.sendInputEvent({
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
    this.heldKeys.delete(codeKey);
    this.flushCoalescable();

    return this.sendInputEvent({
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

    this.flushCoalescable();

    return this.sendInputEvent({
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
        // Coalesce pointer move: update coordinates and modifiers
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
      // Different event: flush pending before creating new
      this.flushCoalescable();
    }

    const vpEpoch = Number(this.getViewportEpoch());
    const seq = ++this.inputSeq;

    this.pendingCoalescable = {
      browserSessionId: this.getSessionId(),
      browserIncarnation: this.getIncarnation(),
      profileEpoch: this.getProfileEpoch(),
      subscriptionEpoch: subEpoch,
      leaseToken,
      inputSeq: seq,
      viewportEpoch: Number.isFinite(vpEpoch) ? vpEpoch : 1,
      event,
    };

    // Schedule immediate microtask flush
    queueMicrotask(() => {
      this.flushCoalescable();
    });

    return true;
  }

  private flushCoalescable(): void {
    if (!this.pendingCoalescable) return;
    const msg = this.pendingCoalescable;
    this.pendingCoalescable = null;

    const socket = this.getControlSocket();
    if (socket && socket.readyState === WebSocket.OPEN) {
      if (socket.bufferedAmount > 256 * 1024) {
        this.onError?.(new Error("Control socket output queue saturated"));
        return;
      }
      try {
        socket.send(JSON.stringify(msg));
      } catch (err) {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private syncLeaseState(): string | null {
    const currentLease = this.getLeaseToken();
    if (currentLease !== this.lastLeaseToken) {
      const priorLease = this.lastLeaseToken;
      // Flush pending coalescable events on prior lease before resetting
      this.flushCoalescable();
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

    const leaseToken = this.syncLeaseState();
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

    this.flushCoalescable();
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.releaseAllHeldInput();
  }
}
