// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserInputController,
  extractModifiers,
  mapPointerButton,
  MODIFIER_ALT,
  MODIFIER_CTRL,
  MODIFIER_META,
  MODIFIER_SHIFT,
  MAX_QUEUE_RECORDS,
  MAX_HANDOFF_BYTES,
} from "./input-controller.js";
import type { DrawnRect } from "./stream-controller.js";
import type { InputMessage } from "../api/browser-host-types.js";

class MockControlSocket {
  public static OPEN = 1;
  public readyState = MockControlSocket.OPEN;
  public sentMessages: string[] = [];
  public closeCalls: Array<[number | undefined, string | undefined]> = [];

  public send(data: string): void {
    this.sentMessages.push(data);
  }

  public close(code?: number, reason?: string): void {
    this.closeCalls.push([code, reason]);
    this.readyState = 3;
  }
}

describe("input-controller", () => {
  let socket: MockControlSocket;
  let drawnRect: DrawnRect | null;
  let leaseToken: string | null;
  let subEpoch: string | null;
  let controller: BrowserInputController;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    socket = new MockControlSocket();
    leaseToken = "lease-token-123";
    subEpoch = "sub-epoch-uuid-1";

    drawnRect = {
      drawX: 80,
      drawY: 0,
      drawWidth: 480,
      drawHeight: 480,
      imageWidth: 480,
      imageHeight: 480,
      geometry: {
        cssWidth: 480,
        cssHeight: 480,
        offsetTop: 0,
        scrollX: 0,
        scrollY: 0,
        pageScale: 1,
        visualOffsetX: 0,
        visualOffsetY: 0,
        dpr: 1,
      },
      viewportEpoch: "1",
      inputTrusted: true,
    };

    canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 640,
      bottom: 480,
      width: 640,
      height: 480,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    controller = new BrowserInputController({
      getSessionId: () => "sess-1",
      getIncarnation: () => "inc-1",
      getProfileEpoch: () => "1",
      getSubscriptionEpoch: () => subEpoch,
      getLeaseToken: () => leaseToken,
      getViewportEpoch: () => "1",
      getDrawnRect: () => drawnRect,
      getControlSocket: () => socket as unknown as WebSocket,
    });
  });

  describe("modifier bitmasks and button mapping", () => {
    it("extracts modifiers correctly", () => {
      expect(
        extractModifiers({
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
        }),
      ).toBe(0);
      expect(
        extractModifiers({
          altKey: true,
          ctrlKey: false,
          metaKey: false,
          shiftKey: false,
        }),
      ).toBe(MODIFIER_ALT);
      expect(
        extractModifiers({
          altKey: false,
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
        }),
      ).toBe(MODIFIER_CTRL);
      expect(
        extractModifiers({
          altKey: false,
          ctrlKey: false,
          metaKey: true,
          shiftKey: false,
        }),
      ).toBe(MODIFIER_META);
      expect(
        extractModifiers({
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          shiftKey: true,
        }),
      ).toBe(MODIFIER_SHIFT);
      expect(
        extractModifiers({
          altKey: true,
          ctrlKey: true,
          metaKey: true,
          shiftKey: true,
        }),
      ).toBe(
        MODIFIER_ALT | MODIFIER_CTRL | MODIFIER_META | MODIFIER_SHIFT,
      );
    });

    it("maps mouse buttons to CDP strings", () => {
      expect(mapPointerButton(0)).toBe("left");
      expect(mapPointerButton(1)).toBe("middle");
      expect(mapPointerButton(2)).toBe("right");
      expect(mapPointerButton(3)).toBe("back");
      expect(mapPointerButton(4)).toBe("forward");
      expect(mapPointerButton(99)).toBe("none");
    });
  });

  describe("letterbox aspect-fit geometry mapping", () => {
    it("maps coordinates inside drawn image to [0.0, 1.0]", () => {
      // Image is at x: 80..560, y: 0..480
      // Center of image: x = 320, y = 240
      const center = controller.mapClientToFractions(320, 240, canvas);
      expect(center).not.toBeNull();
      expect(center!.u).toBeCloseTo(0.5, 4);
      expect(center!.v).toBeCloseTo(0.5, 4);

      // Top-left of image: x = 80, y = 0
      const topLeft = controller.mapClientToFractions(80, 0, canvas);
      expect(topLeft).not.toBeNull();
      expect(topLeft!.u).toBeCloseTo(0.0, 4);
      expect(topLeft!.v).toBeCloseTo(0.0, 4);

      // Bottom-right of image: x = 560, y = 480
      const bottomRight = controller.mapClientToFractions(560, 480, canvas);
      expect(bottomRight).not.toBeNull();
      expect(bottomRight!.u).toBeCloseTo(1.0, 4);
      expect(bottomRight!.v).toBeCloseTo(1.0, 4);
    });

    it("rejects coordinates outside the drawn image in letterbox borders", () => {
      // Left border: x = 40 (inside 0..80 border)
      const leftBorder = controller.mapClientToFractions(40, 240, canvas);
      expect(leftBorder).toBeNull();

      // Right border: x = 600 (inside 560..640 border)
      const rightBorder = controller.mapClientToFractions(600, 240, canvas);
      expect(rightBorder).toBeNull();

      // Negative coordinates
      expect(controller.mapClientToFractions(-10, 240, canvas)).toBeNull();
    });

    it("rejects coordinates if drawn geometry input is not trusted", () => {
      drawnRect = { ...drawnRect!, inputTrusted: false };
      expect(controller.mapClientToFractions(320, 240, canvas)).toBeNull();
    });

    it("rejects coordinates if displayed viewportEpoch is stale", () => {
      drawnRect = { ...drawnRect!, viewportEpoch: "0" };
      expect(controller.mapClientToFractions(320, 240, canvas)).toBeNull();
    });

    it("resets sequence and releases held input when lease token changes", () => {
      controller.handleKeyDown({
        key: "Shift",
        code: "ShiftLeft",
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
      } as KeyboardEvent);

      expect(socket.sentMessages.length).toBe(1);
      const keyMsg = JSON.parse(socket.sentMessages[0]) as InputMessage;
      expect(keyMsg.inputSeq).toBe("1");

      socket.sentMessages = [];
      // Change lease token
      leaseToken = "new-lease-token-456";

      // Next event should release held Shift on old/sync and reset inputSeq to 1 for new event
      controller.handleInsertText("test");
      expect(socket.sentMessages.length).toBe(2);
      const releaseMsg = JSON.parse(socket.sentMessages[0]) as InputMessage;
      const insertMsg = JSON.parse(socket.sentMessages[1]) as InputMessage;
      expect(releaseMsg.inputSeq).toBe("1");
      expect(releaseMsg.event.kind).toBe("keyUp");
      expect(insertMsg.event.kind).toBe("insertText");
      expect(insertMsg.inputSeq).toBe("2");
      expect(insertMsg.leaseToken).toBe("new-lease-token-456");
    });
  });

  describe("pointer events", () => {
    it("sends pointerDown and pointerUp with sequence incrementation", () => {
      const downEvt = {
        currentTarget: canvas,
        clientX: 320,
        clientY: 240,
        button: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      } as unknown as PointerEvent;

      const handledDown = controller.handlePointerDown(downEvt);
      expect(handledDown).toBe(true);
      expect(socket.sentMessages.length).toBe(1);

      const msg1 = JSON.parse(socket.sentMessages[0]) as InputMessage;
      expect(msg1.inputSeq).toBe("1");
      expect(msg1.event).toMatchObject({
        kind: "pointerDown",
        button: "left",
        modifiers: 0,
      });

      const upEvt = {
        currentTarget: canvas,
        clientX: 320,
        clientY: 240,
        button: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      } as unknown as PointerEvent;

      const handledUp = controller.handlePointerUp(upEvt);
      expect(handledUp).toBe(true);
      expect(socket.sentMessages.length).toBe(2);

      const msg2 = JSON.parse(socket.sentMessages[1]) as InputMessage;
      expect(msg2.inputSeq).toBe("2");
      expect(msg2.event).toMatchObject({
        kind: "pointerUp",
        button: "left",
      });
    });

    it("rejects pointerDown outside image", () => {
      const outEvt = {
        currentTarget: canvas,
        clientX: 20, // inside letterbox border
        clientY: 240,
        button: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      } as unknown as PointerEvent;

      const handled = controller.handlePointerDown(outEvt);
      expect(handled).toBe(false);
      expect(socket.sentMessages.length).toBe(0);
    });
  });

  describe("coalescing and barriers", () => {
    it("coalesces adjacent pointerMove events until microtask flush or barrier", async () => {
      const move1 = {
        currentTarget: canvas,
        clientX: 300,
        clientY: 240,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      } as unknown as PointerEvent;

      const move2 = {
        currentTarget: canvas,
        clientX: 320,
        clientY: 250,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      } as unknown as PointerEvent;

      controller.handlePointerMove(move1);
      controller.handlePointerMove(move2);

      // Not sent synchronously yet because queued
      expect(socket.sentMessages.length).toBe(0);

      await Promise.resolve(); // flush microtask

      expect(socket.sentMessages.length).toBe(1);
      const msg = JSON.parse(socket.sentMessages[0]) as InputMessage;
      expect(msg.event.kind).toBe("pointerMove");
      // Coalesced coords should match move2
      if (msg.event.kind === "pointerMove") {
        expect(msg.event.u).toBeCloseTo(0.5, 4);
      }
    });

    it("barrier event (e.g. key down) flushes queued coalesced move before barrier", () => {
      const move = {
        currentTarget: canvas,
        clientX: 300,
        clientY: 240,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      } as unknown as PointerEvent;

      controller.handlePointerMove(move);
      expect(socket.sentMessages.length).toBe(0);

      // Barrier key down
      controller.handleKeyDown({
        key: "Enter",
        code: "Enter",
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      } as KeyboardEvent);

      // Move flushed before key
      expect(socket.sentMessages.length).toBe(2);
      const moveMsg = JSON.parse(socket.sentMessages[0]) as InputMessage;
      const keyMsg = JSON.parse(socket.sentMessages[1]) as InputMessage;
      expect(moveMsg.event.kind).toBe("pointerMove");
      expect(keyMsg.event.kind).toBe("keyDown");
    });
  });

  describe("keyboard and text insertion", () => {
    it("defers non-special printable characters to text input proxy", () => {
      const printable = controller.handleKeyDown({
        key: "a",
        code: "KeyA",
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      } as KeyboardEvent);

      expect(printable).toBe(false);
      expect(socket.sentMessages.length).toBe(0);
    });

    it("sends special keys (shortcuts, Enter, arrows) via keyDown/keyUp", () => {
      const enterDown = controller.handleKeyDown({
        key: "Enter",
        code: "Enter",
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      } as KeyboardEvent);
      expect(enterDown).toBe(true);

      const enterUp = controller.handleKeyUp({
        key: "Enter",
        code: "Enter",
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      } as KeyboardEvent);
      expect(enterUp).toBe(true);

      expect(socket.sentMessages.length).toBe(2);
    });

    it("sends insertText event", () => {
      controller.handleInsertText("hello world");
      expect(socket.sentMessages.length).toBe(1);
      const msg = JSON.parse(socket.sentMessages[0]) as InputMessage;
      expect(msg.event).toEqual({
        kind: "insertText",
        text: "hello world",
      });
    });
  });

  describe("explicit click control handoff typeahead", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
    afterEach(() => { controller.dispose(); vi.useRealTimers(); });

    it("does not retain ordinary offline text without an active gesture", () => {
      leaseToken = null;
      expect(controller.handleInsertText("not-offline-queued")).toBe(false);
      leaseToken = "new-lease";
      controller.handleInsertText("live");
      expect(socket.sentMessages.map(message => JSON.parse(message).event)).toEqual([
        { kind: "insertText", text: "live" },
      ]);
    });

    it("orders text, shortcuts, releases, and IME commits after pointer focus with contiguous sequence", async () => {
      leaseToken = null;
      const handoff = controller.beginControlHandoff(() => true, vi.fn());
      const shortcut = new KeyboardEvent("keydown", { key: "a", code: "KeyA", ctrlKey: true });
      expect(controller.handleKeyDown(shortcut)).toBe(true);
      expect(controller.handleKeyUp(shortcut)).toBe(true);
      expect(controller.handleInsertText("đặng")).toBe(true);
      expect(controller.getHeldKeys().size).toBe(0);
      expect(socket.sentMessages).toEqual([]);
      leaseToken = "new-lease";
      const pointer = { currentTarget: canvas, clientX: 320, clientY: 240, button: 0,
        altKey: false, ctrlKey: false, metaKey: false, shiftKey: false } as unknown as PointerEvent;
      controller.handlePointerDown(pointer);
      controller.handlePointerUp(pointer);
      expect(controller.completeControlHandoff(handoff)).toBe(true);
      await vi.runAllTimersAsync();
      expect(socket.sentMessages.map(message => JSON.parse(message).event.kind)).toEqual([
        "pointerDown", "pointerUp", "keyDown", "keyUp", "insertText",
      ]);
      expect(socket.sentMessages.map(message => JSON.parse(message).inputSeq)).toEqual(["1", "2", "3", "4", "5"]);
      expect(controller.getHeldKeys().size).toBe(0);
      expect(controller.completeControlHandoff(handoff)).toBe(false);
    });

    it.each(["release", "dispose", "provenance", "socket"] as const)("drops queued text on %s without replay", (cancel) => {
      leaseToken = null;
      let current = true;
      const onCancel = vi.fn();
      const handoff = controller.beginControlHandoff(() => current, onCancel);
      controller.handleInsertText("private");
      controller.handleKeyDown(new KeyboardEvent("keydown", { key: "Shift", code: "ShiftLeft" }));
      if (cancel === "release") controller.releaseAllHeldInput();
      if (cancel === "dispose") controller.dispose();
      if (cancel === "provenance") current = false;
      if (cancel === "socket") socket.readyState = 3;
      leaseToken = "new-lease";
      expect(controller.completeControlHandoff(handoff)).toBe(false);
      expect(socket.sentMessages).toEqual([]);
      expect(controller.getHeldKeys().size).toBe(0);
      if (cancel !== "socket") expect(onCancel).toHaveBeenCalledOnce();
    });

    it.each(["records", "bytes"] as const)("cancels the whole gesture when its %s bound is reached", (bound) => {
      leaseToken = null;
      const onCancel = vi.fn();
      const handoff = controller.beginControlHandoff(() => true, onCancel);
      if (bound === "records") {
        const key = new KeyboardEvent("keyup", { key: "Enter", code: "Enter" });
        for (let i = 0; i < MAX_QUEUE_RECORDS; i++) expect(controller.handleKeyUp(key)).toBe(true);
        expect(controller.handleKeyUp(key)).toBe(false);
      } else {
        // UTF-8 accounting includes multibyte input, not just JS string length.
        const text = "界".repeat(1000);
        const bytes = new TextEncoder().encode(JSON.stringify({ kind: "insertText", text })).length;
        for (let i = 0; i < Math.floor(MAX_HANDOFF_BYTES / bytes); i++) {
          expect(controller.handleInsertText(text)).toBe(true);
        }
        expect(controller.handleInsertText(text)).toBe(false);
      }
      leaseToken = "new-lease";
      expect(controller.completeControlHandoff(handoff)).toBe(false);
      expect(onCancel).toHaveBeenCalledOnce();
      expect(socket.sentMessages).toEqual([]);
    });

    it("does not let an old completion consume replacement-gesture text", () => {
      leaseToken = null;
      const old = controller.beginControlHandoff(() => true, vi.fn());
      controller.handleInsertText("old");
      const replacement = controller.beginControlHandoff(() => true, vi.fn());
      controller.handleInsertText("replacement");
      leaseToken = "new-lease";
      expect(controller.completeControlHandoff(old)).toBe(false);
      expect(controller.completeControlHandoff(replacement)).toBe(true);
      expect(socket.sentMessages.map(message => JSON.parse(message).event)).toEqual([
        { kind: "insertText", text: "replacement" },
      ]);
    });

    it("delivers more than 100 records without closing a 100/s consumer, including arrivals during drain", async () => {
      const arrivals: number[] = [];
      let closed = false;
      vi.spyOn(socket, "send").mockImplementation(message => {
        const now = Date.now();
        arrivals.push(now);
        // Consumer's rolling admission limit, independent of the drain's interval.
        if (arrivals.filter(time => now - time < 1000).length > 100) {
          closed = true;
          socket.readyState = 3;
          throw new Error("Consumer rate limit exceeded");
        }
        socket.sentMessages.push(message);
      });
      leaseToken = null;
      const complete = vi.fn();
      const handoff = controller.beginControlHandoff(() => true, vi.fn());
      for (let index = 0; index < 120; index++) controller.handleInsertText(String(index));
      leaseToken = "paced-lease";
      const pointer = { currentTarget: canvas, clientX: 320, clientY: 240, button: 0,
        altKey: false, ctrlKey: false, metaKey: false, shiftKey: false } as unknown as PointerEvent;
      controller.handlePointerDown(pointer);
      controller.handlePointerUp(pointer);
      expect(controller.completeControlHandoff(handoff, complete)).toBe(true);
      expect(complete).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(500);
      const backspace = new KeyboardEvent("keydown", { key: "Backspace", code: "Backspace" });
      controller.handleKeyDown(backspace);
      controller.handleKeyUp(backspace);
      controller.handleInsertText("new-arrival");
      await vi.runAllTimersAsync();
      const messages = socket.sentMessages.map(message => JSON.parse(message) as InputMessage);
      expect(closed).toBe(false);
      expect(messages).toHaveLength(125);
      expect(messages.map(message => message.event)).toEqual([
        { kind: "pointerDown", button: "left", u: 0.5, v: 0.5, modifiers: 0 },
        { kind: "pointerUp", button: "left", u: 0.5, v: 0.5, modifiers: 0 },
        ...Array.from({ length: 120 }, (_, index) => ({ kind: "insertText", text: String(index) })),
        { kind: "keyDown", key: "Backspace", code: "Backspace", modifiers: 0 },
        { kind: "keyUp", key: "Backspace", code: "Backspace", modifiers: 0 },
        { kind: "insertText", text: "new-arrival" },
      ]);
      expect(messages.map(message => message.inputSeq)).toEqual(Array.from({ length: 125 }, (_, index) => String(index + 1)));
      expect(complete).toHaveBeenCalledOnce();
    });

    it.each(["provenance", "release"] as const)("cancels a paced tail on %s and releases only dispatched held keys", async (cause) => {
      leaseToken = null;
      let current = true;
      const cancelled = vi.fn();
      const complete = vi.fn();
      const handoff = controller.beginControlHandoff(() => current, cancelled);
      controller.handleKeyDown(new KeyboardEvent("keydown", { key: "Shift", code: "ShiftLeft" }));
      for (let index = 0; index < 120; index++) controller.handleInsertText(`private-${index}`);
      leaseToken = "paced-lease";
      expect(controller.completeControlHandoff(handoff, complete)).toBe(true);
      await vi.advanceTimersByTimeAsync(400);
      const before = socket.sentMessages.map(message => JSON.parse(message) as InputMessage);
      expect(before.some(message => message.event.kind === "insertText")).toBe(true);
      expect(before.filter(message => message.event.kind === "insertText").length).toBeLessThan(120);
      if (cause === "provenance") current = false;
      else controller.releaseAllHeldInput();
      await vi.runAllTimersAsync();
      const after = socket.sentMessages.map(message => JSON.parse(message) as InputMessage);
      expect(after.filter(message => message.event.kind === "insertText")).toEqual(
        before.filter(message => message.event.kind === "insertText"),
      );
      expect(after.at(-1)?.event).toEqual({ kind: "keyUp", key: "Shift", code: "ShiftLeft", modifiers: 0 });
      expect(controller.getHeldKeys().size).toBe(0);
      expect(cancelled).toHaveBeenCalledOnce();
      expect(complete).not.toHaveBeenCalled();
    });
  });

  describe("held input release", () => {
    it("releases all held keys and buttons on releaseAllHeldInput", () => {
      controller.handleKeyDown({
        key: "Shift",
        code: "ShiftLeft",
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
      } as KeyboardEvent);

      controller.handlePointerDown({
        currentTarget: canvas,
        clientX: 320,
        clientY: 240,
        button: 0,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: true,
      } as unknown as PointerEvent);

      expect(controller.getHeldKeys().has("ShiftLeft")).toBe(true);
      expect(controller.getHeldButtons().has("left")).toBe(true);

      socket.sentMessages = [];

      controller.releaseAllHeldInput();

      expect(controller.getHeldKeys().size).toBe(0);
      expect(controller.getHeldButtons().size).toBe(0);

      expect(socket.sentMessages.length).toBe(2);
      const keyUpMsg = JSON.parse(socket.sentMessages[0]) as InputMessage;
      const cancelMsg = JSON.parse(socket.sentMessages[1]) as InputMessage;

      expect(keyUpMsg.event.kind).toBe("keyUp");
      expect(cancelMsg.event.kind).toBe("pointerCancel");
    });
  });

  describe("rolling input budget", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
    afterEach(() => { controller.dispose(); vi.useRealTimers(); });

    const pointer = (clientX = 320) => ({
      currentTarget: canvas, clientX, clientY: 240, button: 0,
      altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    }) as unknown as PointerEvent;

    /** Records live-send instants; max messages in any sliding 1s window. */
    function recordSends(): { times: number[]; kinds: string[]; maxWindow: (pred?: (kind: string) => boolean) => number } {
      const times: number[] = [];
      const kinds: string[] = [];
      const original = socket.send.bind(socket);
      vi.spyOn(socket, "send").mockImplementation(message => {
        times.push(Date.now());
        kinds.push((JSON.parse(message) as InputMessage).event.kind);
        original(message);
      });
      const maxWindow = (pred: (kind: string) => boolean = () => true): number => {
        const selected = times.filter((_, i) => pred(kinds[i]));
        let max = 0;
        for (let i = 0; i < selected.length; i++) {
          let j = i;
          while (j < selected.length && selected[j] - selected[i] < 1000) j++;
          max = Math.max(max, j - i);
        }
        return max;
      };
      return { times, kinds, maxWindow };
    }

    it("keeps 240Hz pointer moves at or below 40 records per second", async () => {
      const sends = recordSends();
      for (let elapsed = 0; elapsed < 3000; elapsed += 4) {
        controller.handlePointerMove(pointer(300 + (elapsed % 50)));
        await vi.advanceTimersByTimeAsync(4);
      }
      expect(sends.times.length).toBeGreaterThan(60);
      expect(sends.maxWindow()).toBeLessThanOrEqual(40);
    });

    it("never lets pointer, wheel and key bursts cross the 100/s ceiling or leave sequence gaps", async () => {
      const sends = recordSends();
      const key = (type: "keydown" | "keyup") => new KeyboardEvent(type, { key: "Enter", code: "Enter" });
      for (let elapsed = 0; elapsed < 3000; elapsed += 4) {
        controller.handlePointerMove(pointer(300 + (elapsed % 50)));
        if (elapsed % 8 === 0) {
          controller.handleWheel({ ...pointer(), deltaX: 0, deltaY: 10 } as unknown as WheelEvent);
        }
        if (elapsed % 80 === 0) {
          controller.handleKeyDown(key("keydown"));
          controller.handleKeyUp(key("keyup"));
        }
        await vi.advanceTimersByTimeAsync(4);
      }
      // Sustained: traffic flows for the whole run (no early fail-closed shutdown).
      expect(socket.closeCalls).toEqual([]);
      expect(sends.times.at(-1)! - sends.times[0]).toBeGreaterThan(2500);
      const isRelease = (kind: string) => kind === "keyUp" || kind === "pointerUp" || kind === "pointerCancel";
      expect(sends.maxWindow()).toBeLessThanOrEqual(100);
      expect(sends.maxWindow(kind => !isRelease(kind))).toBeLessThanOrEqual(80);
      const seqs = socket.sentMessages.map(message => (JSON.parse(message) as InputMessage).inputSeq);
      expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => String(i + 1)));
    });

    it("closes fail-closed on normal overflow past 80/s without recording held state", () => {
      const errors: Error[] = [];
      controller = new BrowserInputController({
        getSessionId: () => "sess-1", getIncarnation: () => "inc-1", getProfileEpoch: () => "1",
        getSubscriptionEpoch: () => subEpoch, getLeaseToken: () => leaseToken, getViewportEpoch: () => "1",
        getDrawnRect: () => drawnRect, getControlSocket: () => socket as unknown as WebSocket,
        onError: err => errors.push(err),
      });
      for (let i = 0; i < 80; i++) {
        expect(controller.handleKeyDown(new KeyboardEvent("keydown", { key: "F1", code: `F${i}` }))).toBe(true);
      }
      expect(controller.handleKeyDown(new KeyboardEvent("keydown", { key: "F1", code: "Extra" }))).toBe(false);
      expect(controller.getHeldKeys().has("Extra")).toBe(false);
      expect(controller.handlePointerDown(pointer())).toBe(false);
      expect(controller.getHeldButtons().size).toBe(0);
      expect(errors.map(e => e.message)).toContain("Input rate budget saturated");
      expect(socket.sentMessages).toHaveLength(80);
      expect(socket.closeCalls).toEqual([[1008, "input rate budget exhausted"]]);
    });

    it("closes fail-closed rather than silently dropping a release beyond the 100/s ceiling", () => {
      for (let i = 0; i < 80; i++) {
        controller.handleKeyDown(new KeyboardEvent("keydown", { key: "F1", code: `F${i}` }));
      }
      controller.releaseAllHeldInput();
      expect(socket.sentMessages).toHaveLength(100);
      expect(socket.closeCalls).toEqual([[1008, "input rate budget exhausted"]]);
    });

    it("counts releases sent by a lease change before admitting the next event (never send #101)", () => {
      for (let i = 0; i < 21; i++) {
        controller.handleKeyDown(new KeyboardEvent("keydown", { key: "F1", code: `H${i}` }));
      }
      for (let i = 0; i < 58; i++) controller.handleInsertText(`t${i}`);
      expect(socket.sentMessages).toHaveLength(79);
      leaseToken = "lease-2";
      expect(controller.handleInsertText("after-lease")).toBe(false);
      expect(socket.sentMessages.length).toBeLessThanOrEqual(100);
      const kinds = socket.sentMessages.map(message => (JSON.parse(message) as InputMessage).event);
      expect(kinds.some(event => event.kind === "insertText" && event.text === "after-lease")).toBe(false);
      expect(socket.closeCalls).toEqual([[1008, "input rate budget exhausted"]]);
    });

    it("keeps accumulated wheel deltas when a pointer move interleaves", async () => {
      controller.handleWheel({ ...pointer(), deltaX: 0, deltaY: 10 } as unknown as WheelEvent);
      controller.handleWheel({ ...pointer(), deltaX: 0, deltaY: 10 } as unknown as WheelEvent);
      controller.handlePointerMove(pointer(400));
      await vi.advanceTimersByTimeAsync(30);
      const events = socket.sentMessages.map(message => (JSON.parse(message) as InputMessage).event);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: "wheel", deltaY: 20, u: expect.closeTo((400 - 80) / 480, 4) });
    });
  });

  describe("canonical decimal wire counters", () => {
    const TWO_POW_53_PLUS_1 = "9007199254740993";
    const U64_MAX = "18446744073709551615";

    function build(profileEpoch: string, viewportEpoch: () => string, errors: Error[] = []) {
      return new BrowserInputController({
        getSessionId: () => "sess-1",
        getIncarnation: () => "inc-1",
        getProfileEpoch: () => profileEpoch,
        getSubscriptionEpoch: () => subEpoch,
        getLeaseToken: () => leaseToken,
        getViewportEpoch: viewportEpoch,
        getDrawnRect: () => drawnRect,
        getControlSocket: () => socket as unknown as WebSocket,
        onError: err => errors.push(err),
      });
    }

    it("sends profile/viewport epochs and inputSeq as exact decimal strings above 2^53 and at u64 max", () => {
      for (const [profile, viewport] of [
        [TWO_POW_53_PLUS_1, TWO_POW_53_PLUS_1],
        [U64_MAX, U64_MAX],
      ]) {
        socket.sentMessages = [];
        const c = build(profile, () => viewport);
        expect(c.handleInsertText("x")).toBe(true);
        const raw = socket.sentMessages[0];
        const msg = JSON.parse(raw) as InputMessage;
        expect(msg.profileEpoch).toBe(profile);
        expect(msg.viewportEpoch).toBe(viewport);
        expect(msg.inputSeq).toBe("1");
        // The wire carries JSON strings, never lossy numbers.
        expect(raw).toContain(`"profileEpoch":"${profile}"`);
        expect(raw).toContain(`"viewportEpoch":"${viewport}"`);
        expect(raw).toContain('"inputSeq":"1"');
      }
    });

    it("never sends under an epoch that is not a canonical positive decimal u64 (no fabricated identity)", () => {
      for (const bad of ["", "0", "01", "-1", "1.5", "abc", "18446744073709551616"]) {
        socket.sentMessages = [];
        const viaViewport = build("1", () => bad);
        expect(viaViewport.handleInsertText("x")).toBe(false);
        const viaProfile = build(bad, () => "1");
        expect(viaProfile.handleInsertText("x")).toBe(false);
        expect(socket.sentMessages).toEqual([]);
      }
    });

    it("stops at an exhausted inputSeq instead of wrapping or reusing it", () => {
      const errors: Error[] = [];
      const c = build("1", () => "1", errors);
      // The first event adopts the lease (sequence restarts); then fast-forward to the edge.
      expect(c.handleInsertText("prime")).toBe(true);
      socket.sentMessages = [];
      (c as unknown as { inputSeq: bigint }).inputSeq = 18446744073709551614n;
      expect(c.handleInsertText("last")).toBe(true);
      expect((JSON.parse(socket.sentMessages[0]) as InputMessage).inputSeq).toBe(U64_MAX);
      expect(c.handleInsertText("past-the-end")).toBe(false);
      expect(socket.sentMessages).toHaveLength(1);
      expect(errors.map(e => e.message)).toContain("Input sequence exhausted; reacquire control to continue");
    });

    it("drops a pending coalesced move whose viewport epoch moved before it was flushed", async () => {
      vi.useFakeTimers();
      try {
        let viewport = "1";
        const c = build("1", () => viewport);
        expect(c.handlePointerMove({ currentTarget: canvas, clientX: 300, clientY: 200, button: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false } as unknown as PointerEvent)).toBe(true);
        viewport = "2";
        await vi.advanceTimersByTimeAsync(50);
        expect(socket.sentMessages).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
