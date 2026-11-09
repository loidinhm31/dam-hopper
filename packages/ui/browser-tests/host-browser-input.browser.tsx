import * as React from "react";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasView } from "@/browser-host/canvas-view.js";
import { BrowserInputController } from "@/browser-host/input-controller.js";
import {
  TextInputProxy,
  type TextInputProxyHandle,
} from "@/browser-host/text-input-proxy.js";
import type { DrawnRect } from "@/browser-host/stream-controller.js";
import type { InputMessage } from "@/api/browser-host-types.js";
import "@/index.css";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MockControlSocket {
  public static OPEN = 1;
  public readyState = MockControlSocket.OPEN;
  public sentMessages: string[] = [];

  public send(data: string): void {
    this.sentMessages.push(data);
  }
}

interface TestHarnessProps {
  onControllerReady: (
    controller: BrowserInputController,
    proxyHandle: TextInputProxyHandle | null,
  ) => void;
  drawnRect: DrawnRect | null;
  socket: MockControlSocket;
}

function TestHarness({
  onControllerReady,
  drawnRect,
  socket,
}: TestHarnessProps) {
  const proxyRef = useRef<TextInputProxyHandle | null>(null);
  const controllerRef = useRef<BrowserInputController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = new BrowserInputController({
      getSessionId: () => "sess-test-1",
      getIncarnation: () => "inc-test-1",
      getProfileEpoch: () => 1,
      getSubscriptionEpoch: () => "sub-test-1",
      getLeaseToken: () => "lease-test-1",
      getViewportEpoch: () => 1,
      getDrawnRect: () => drawnRect,
      getControlSocket: () => socket as unknown as WebSocket,
    });
  }

  React.useEffect(() => {
    if (controllerRef.current) {
      onControllerReady(controllerRef.current, proxyRef.current);
    }
  }, [onControllerReady]);

  return (
    <CanvasView
      controller={null}
      onCanvasPointerDown={(e) => {
        controllerRef.current?.handlePointerDown(e);
        proxyRef.current?.focus();
      }}
      onCanvasPointerUp={(e) => controllerRef.current?.handlePointerUp(e)}
      onCanvasPointerMove={(e) => controllerRef.current?.handlePointerMove(e)}
      onCanvasPointerCancel={() => controllerRef.current?.handlePointerCancel()}
      onCanvasWheel={(e) => controllerRef.current?.handleWheel(e)}
    >
      <TextInputProxy ref={proxyRef} controller={controllerRef.current} />
    </CanvasView>
  );
}

describe("host-browser-input in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;
  let socket: MockControlSocket;
  let activeController: BrowserInputController | null = null;
  let activeProxy: TextInputProxyHandle | null = null;

  const mockDrawnRect: DrawnRect = {
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

  beforeEach(() => {
    socket = new MockControlSocket();
    container = document.createElement("div");
    container.style.width = "640px";
    container.style.height = "480px";
    container.style.position = "relative";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    activeController?.dispose();
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("mounts harness, shifts focus to proxy on pointerDown, and sends pointer events", async () => {
    act(() => {
      root.render(
        <TestHarness
          socket={socket}
          drawnRect={mockDrawnRect}
          onControllerReady={(ctrl, proxy) => {
            activeController = ctrl;
            activeProxy = proxy;
          }}
        />,
      );
    });

    await vi.waitFor(() => expect(activeController).not.toBeNull());

    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();

    // Click inside the drawn image (x=320, y=240)
    canvas!.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 320,
        clientY: 240,
        button: 0,
        bubbles: true,
      }),
    );

    // Text proxy should receive focus
    expect(activeProxy?.isFocused()).toBe(true);

    // PointerDown message sent
    expect(socket.sentMessages.length).toBe(1);
    const downMsg = JSON.parse(socket.sentMessages[0]) as InputMessage;
    expect(downMsg.event.kind).toBe("pointerDown");
    expect(downMsg.inputSeq).toBe(1);

    // PointerMove
    canvas!.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 340,
        clientY: 260,
        bubbles: true,
      }),
    );
    await Promise.resolve();
    expect(socket.sentMessages.length).toBe(2);
    const moveMsg = JSON.parse(socket.sentMessages[1]) as InputMessage;
    expect(moveMsg.event.kind).toBe("pointerMove");

    // PointerUp
    canvas!.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 340,
        clientY: 260,
        button: 0,
        bubbles: true,
      }),
    );
    expect(socket.sentMessages.length).toBe(3);
    const upMsg = JSON.parse(socket.sentMessages[2]) as InputMessage;
    expect(upMsg.event.kind).toBe("pointerUp");
  });

  it("rejects pointerDown in letterbox margin without emitting messages", async () => {
    act(() => {
      root.render(
        <TestHarness
          socket={socket}
          drawnRect={mockDrawnRect}
          onControllerReady={(ctrl, proxy) => {
            activeController = ctrl;
            activeProxy = proxy;
          }}
        />,
      );
    });

    await vi.waitFor(() => expect(activeController).not.toBeNull());

    const canvas = container.querySelector("canvas")!;
    // Click in letterbox border (x=20 is outside 80..560)
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 20,
        clientY: 240,
        button: 0,
        bubbles: true,
      }),
    );

    expect(socket.sentMessages.length).toBe(0);
  });

  it("handles Vietnamese IME composition without duplicate keydown commits", async () => {
    act(() => {
      root.render(
        <TestHarness
          socket={socket}
          drawnRect={mockDrawnRect}
          onControllerReady={(ctrl, proxy) => {
            activeController = ctrl;
            activeProxy = proxy;
          }}
        />,
      );
    });

    await vi.waitFor(() => expect(activeProxy).not.toBeNull());
    const textarea = container.querySelector("textarea")!;
    textarea.focus();

    // Start composition
    textarea.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );

    // While composing, keydown events should not emit to backend
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "d",
        code: "KeyD",
        bubbles: true,
      }),
    );
    expect(socket.sentMessages.length).toBe(0);

    // End composition with Vietnamese word "tiếng Việt"
    textarea.dispatchEvent(
      new CompositionEvent("compositionend", {
        data: "tiếng Việt",
        bubbles: true,
      }),
    );

    // Emitted exactly ONE insertText event
    expect(socket.sentMessages.length).toBe(1);
    const msg = JSON.parse(socket.sentMessages[0]) as InputMessage;
    expect(msg.event).toEqual({
      kind: "insertText",
      text: "tiếng Việt",
    });
  });

  it("handles Japanese IME composition", async () => {
    act(() => {
      root.render(
        <TestHarness
          socket={socket}
          drawnRect={mockDrawnRect}
          onControllerReady={(ctrl, proxy) => {
            activeController = ctrl;
            activeProxy = proxy;
          }}
        />,
      );
    });

    await vi.waitFor(() => expect(activeProxy).not.toBeNull());
    const textarea = container.querySelector("textarea")!;
    textarea.focus();

    textarea.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    textarea.dispatchEvent(
      new CompositionEvent("compositionend", {
        data: "日本語",
        bubbles: true,
      }),
    );

    expect(socket.sentMessages.length).toBe(1);
    const msg = JSON.parse(socket.sentMessages[0]) as InputMessage;
    expect(msg.event).toEqual({
      kind: "insertText",
      text: "日本語",
    });
  });

  it("handles plain text paste without HTML or binary", async () => {
    act(() => {
      root.render(
        <TestHarness
          socket={socket}
          drawnRect={mockDrawnRect}
          onControllerReady={(ctrl, proxy) => {
            activeController = ctrl;
            activeProxy = proxy;
          }}
        />,
      );
    });

    await vi.waitFor(() => expect(activeProxy).not.toBeNull());
    const textarea = container.querySelector("textarea")!;
    textarea.focus();

    // Simulate paste event with text/plain
    const pasteEvent = new Event("paste", {
      bubbles: true,
      cancelable: true,
    }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        getData: (format: string) =>
          format === "text/plain" ? "pasted-safe-text" : "",
      },
    });

    textarea.dispatchEvent(pasteEvent);

    expect(socket.sentMessages.length).toBe(1);
    const msg = JSON.parse(socket.sentMessages[0]) as InputMessage;
    expect(msg.event).toEqual({
      kind: "insertText",
      text: "pasted-safe-text",
    });
  });

  it("releases held input on blur without stuck keys or buttons", async () => {
    act(() => {
      root.render(
        <TestHarness
          socket={socket}
          drawnRect={mockDrawnRect}
          onControllerReady={(ctrl, proxy) => {
            activeController = ctrl;
            activeProxy = proxy;
          }}
        />,
      );
    });

    await vi.waitFor(() => expect(activeProxy).not.toBeNull());
    const canvas = container.querySelector("canvas")!;
    const textarea = container.querySelector("textarea")!;

    // Press Shift and click mouse
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Shift",
        code: "ShiftLeft",
        shiftKey: true,
        bubbles: true,
      }),
    );

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 320,
        clientY: 240,
        button: 0,
        shiftKey: true,
        bubbles: true,
      }),
    );

    expect(activeController?.getHeldKeys().size).toBe(1);
    expect(activeController?.getHeldButtons().size).toBe(1);

    socket.sentMessages = [];

    // Trigger blur on text proxy
    textarea.blur();
    expect(activeController?.getHeldKeys().size).toBe(0);
    expect(activeController?.getHeldButtons().size).toBe(0);

    // Emitted keyUp and pointerCancel
    expect(socket.sentMessages.length).toBe(2);
    const keyUp = JSON.parse(socket.sentMessages[0]) as InputMessage;
    const cancel = JSON.parse(socket.sentMessages[1]) as InputMessage;
    expect(keyUp.event.kind).toBe("keyUp");
    expect(cancel.event.kind).toBe("pointerCancel");
  });
});
