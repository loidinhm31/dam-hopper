// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserInputController,
  extractModifiers,
  mapPointerButton,
  MODIFIER_ALT,
  MODIFIER_CTRL,
  MODIFIER_META,
  MODIFIER_SHIFT,
} from "./input-controller.js";
import type { DrawnRect } from "./stream-controller.js";
import type { InputMessage } from "../api/browser-host-types.js";

class MockControlSocket {
  public static OPEN = 1;
  public readyState = MockControlSocket.OPEN;
  public sentMessages: string[] = [];

  public send(data: string): void {
    this.sentMessages.push(data);
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
      getProfileEpoch: () => 1,
      getSubscriptionEpoch: () => subEpoch,
      getLeaseToken: () => leaseToken,
      getViewportEpoch: () => 1,
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
      expect(keyMsg.inputSeq).toBe(1);

      socket.sentMessages = [];
      // Change lease token
      leaseToken = "new-lease-token-456";

      // Next event should release held Shift on old/sync and reset inputSeq to 1 for new event
      controller.handleInsertText("test");
      expect(socket.sentMessages.length).toBe(2);
      const releaseMsg = JSON.parse(socket.sentMessages[0]) as InputMessage;
      const insertMsg = JSON.parse(socket.sentMessages[1]) as InputMessage;
      expect(releaseMsg.inputSeq).toBe(1);
      expect(releaseMsg.event.kind).toBe("keyUp");
      expect(insertMsg.event.kind).toBe("insertText");
      expect(insertMsg.inputSeq).toBe(2);
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
      expect(msg1.inputSeq).toBe(1);
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
      expect(msg2.inputSeq).toBe(2);
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
});
