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
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
  const [controller] = React.useState(
    () =>
      new BrowserInputController({
        getSessionId: () => "android-sess-1",
        getIncarnation: () => "android-inc-1",
        getProfileEpoch: () => "1",
        getSubscriptionEpoch: () => "android-sub-1",
        getLeaseToken: () => "android-lease-1",
        getViewportEpoch: () => "1",
        getDrawnRect: () => drawnRect,
        getControlSocket: () => socket as unknown as WebSocket,
      }),
  );

  React.useEffect(() => {
    onControllerReady(controller, proxyRef.current);
  }, [controller, onControllerReady]);

  return (
    <div
      style={{
        width: "360px",
        height: "640px",
        position: "relative",
        background: "#000",
        overflow: "hidden",
      }}
    >
      <CanvasView
        controller={null}
        onCanvasPointerDown={(e) => {
          controller.handlePointerDown(e);
          proxyRef.current?.focus();
        }}
        onCanvasPointerUp={(e) => controller.handlePointerUp(e)}
        onCanvasPointerMove={(e) => controller.handlePointerMove(e)}
        onCanvasPointerCancel={() => controller.handlePointerCancel()}
        onCanvasWheel={(e) => controller.handleWheel(e)}
      >
        <TextInputProxy ref={proxyRef} controller={controller} />
      </CanvasView>
    </div>
  );
}

describe("host-browser-android: Android Web Touch, Soft Keyboard & IME in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;
  let socket: MockControlSocket;
  let activeController: BrowserInputController | null = null;
  let activeProxy: TextInputProxyHandle | null = null;

  const mockMobileDrawnRect: DrawnRect = {
    drawX: 0,
    drawY: 0,
    drawWidth: 360,
    drawHeight: 640,
    imageWidth: 360,
    imageHeight: 640,
    geometry: {
      cssWidth: 360,
      cssHeight: 640,
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
    container = document.createElement("div");
    container.style.width = "360px";
    container.style.height = "640px";
    container.style.position = "relative";
    document.body.appendChild(container);
    root = createRoot(container);
    socket = new MockControlSocket();
    activeController = null;
    activeProxy = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("handles Android virtual touch tap and focuses soft keyboard proxy", async () => {
    act(() => {
      root.render(
        <TestHarness
          socket={socket}
          drawnRect={mockMobileDrawnRect}
          onControllerReady={(ctrl, proxy) => {
            activeController = ctrl;
            activeProxy = proxy;
          }}
        />,
      );
    });

    await vi.waitFor(() => expect(activeController).not.toBeNull());
    const canvas = container.querySelector("canvas")!;
    expect(canvas).not.toBeNull();

    // Simulate mobile touch tap (pointerType: 'touch')
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 180,
        clientY: 320,
        pointerType: "touch",
        button: 0,
        bubbles: true,
      }),
    );

    // Verify soft keyboard proxy was focused
    const textarea = container.querySelector("textarea")!;
    expect(document.activeElement).toBe(textarea);

    canvas.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 180,
        clientY: 320,
        pointerType: "touch",
        button: 0,
        bubbles: true,
      }),
    );

    // Verify pointerDown and pointerUp were dispatched to control socket
    expect(socket.sentMessages.length).toBe(2);
    const downMsg = JSON.parse(socket.sentMessages[0]) as InputMessage;
    expect(downMsg.event.kind).toBe("pointerDown");
    expect(downMsg.event).toMatchObject({
      kind: "pointerDown",
      u: expect.closeTo(0.5, 2),
      v: expect.closeTo(0.5, 2),
    });

    const upMsg = JSON.parse(socket.sentMessages[1]) as InputMessage;
    expect(upMsg.event.kind).toBe("pointerUp");
  });

  it("handles Android touch drag / pan gesture", async () => {
    act(() => {
      root.render(
        <TestHarness
          socket={socket}
          drawnRect={mockMobileDrawnRect}
          onControllerReady={(ctrl, proxy) => {
            activeController = ctrl;
            activeProxy = proxy;
          }}
        />,
      );
    });

    await vi.waitFor(() => expect(activeController).not.toBeNull());
    const canvas = container.querySelector("canvas")!;

    // 1. Touch down at u=0.5, v=0.8
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 180,
        clientY: 512,
        pointerType: "touch",
        button: 0,
        bubbles: true,
      }),
    );

    // 2. Touch move swipe upward to u=0.5, v=0.2
    canvas.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: 180,
        clientY: 128,
        pointerType: "touch",
        bubbles: true,
      }),
    );
    await Promise.resolve();

    // 3. Touch up
    canvas.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: 180,
        clientY: 128,
        pointerType: "touch",
        button: 0,
        bubbles: true,
      }),
    );

    expect(socket.sentMessages.length).toBeGreaterThanOrEqual(3);
    const moveMsg = JSON.parse(socket.sentMessages[1]) as InputMessage;
    expect(moveMsg.event.kind).toBe("pointerMove");
  });

  it("handles touch cancel cleanly without stuck held state", async () => {
    act(() => {
      root.render(
        <TestHarness
          socket={socket}
          drawnRect={mockMobileDrawnRect}
          onControllerReady={(ctrl, proxy) => {
            activeController = ctrl;
            activeProxy = proxy;
          }}
        />,
      );
    });

    await vi.waitFor(() => expect(activeController).not.toBeNull());
    const canvas = container.querySelector("canvas")!;

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        pointerType: "touch",
        button: 0,
        bubbles: true,
      }),
    );

    // System touch cancel (e.g. incoming call, notification shade pulled down)
    canvas.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));

    const lastMsg = JSON.parse(socket.sentMessages[socket.sentMessages.length - 1]) as InputMessage;
    expect(lastMsg.event.kind).toBe("pointerCancel");
  });

  it("handles Vietnamese IME composition with exactly once commit", async () => {
    act(() => {
      root.render(
        <TestHarness
          socket={socket}
          drawnRect={mockMobileDrawnRect}
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

    // Vietnamese Telex input sequence for "Việt Nam":
    // 1. compositionstart
    textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));

    // 2. intermediate typing during composition (must be suppressed from raw keydown commits)
    textarea.dispatchEvent(new CompositionEvent("compositionupdate", { data: "V", bubbles: true }));
    textarea.dispatchEvent(new CompositionEvent("compositionupdate", { data: "Vi", bubbles: true }));
    textarea.dispatchEvent(new CompositionEvent("compositionupdate", { data: "Việ", bubbles: true }));
    textarea.dispatchEvent(new CompositionEvent("compositionupdate", { data: "Việt", bubbles: true }));
    textarea.dispatchEvent(new CompositionEvent("compositionupdate", { data: "Việt Nam", bubbles: true }));

    expect(socket.sentMessages.length).toBe(0);

    // 3. compositionend: final syllable committed exactly once
    textarea.dispatchEvent(
      new CompositionEvent("compositionend", {
        data: "Việt Nam",
        bubbles: true,
      }),
    );

    expect(socket.sentMessages.length).toBe(1);
    const msg = JSON.parse(socket.sentMessages[0]) as InputMessage;
    expect(msg.event).toEqual({
      kind: "insertText",
      text: "Việt Nam",
    });
  });

  it("handles Japanese IME composition with exactly once commit", async () => {
    act(() => {
      root.render(
        <TestHarness
          socket={socket}
          drawnRect={mockMobileDrawnRect}
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

    textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    textarea.dispatchEvent(new CompositionEvent("compositionupdate", { data: "にほん", bubbles: true }));
    textarea.dispatchEvent(new CompositionEvent("compositionend", { data: "日本", bubbles: true }));

    expect(socket.sentMessages.length).toBe(1);
    const msg = JSON.parse(socket.sentMessages[0]) as InputMessage;
    expect(msg.event).toEqual({
      kind: "insertText",
      text: "日本",
    });
  });

  it("handles clipboard paste plain text on Android web", async () => {
    act(() => {
      root.render(
        <TestHarness
          socket={socket}
          drawnRect={mockMobileDrawnRect}
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

    const pasteEvent = new Event("paste", {
      bubbles: true,
      cancelable: true,
    }) as ClipboardEvent;
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        getData: (format: string) =>
          format === "text/plain" ? "pasted-mobile-text" : "",
      },
    });

    textarea.dispatchEvent(pasteEvent);

    expect(socket.sentMessages.length).toBe(1);
    const msg = JSON.parse(socket.sentMessages[0]) as InputMessage;
    expect(msg.event).toEqual({
      kind: "insertText",
      text: "pasted-mobile-text",
    });
  });
});
