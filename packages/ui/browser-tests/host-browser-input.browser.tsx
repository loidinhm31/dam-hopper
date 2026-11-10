import * as React from "react";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { CanvasView } from "@/browser-host/canvas-view.js";
import { BrowserInputController, type CanvasPointerInput } from "@/browser-host/input-controller.js";
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
  controlReady?: Promise<void>;
  onHandoffComplete?: () => void;
}

function TestHarness({
  onControllerReady,
  drawnRect,
  socket,
  controlReady,
  onHandoffComplete,
}: TestHarnessProps) {
  const proxyRef = useRef<TextInputProxyHandle | null>(null);
  const controllerRef = useRef<BrowserInputController | null>(null);
  const leaseRef = useRef<string | null>(controlReady ? null : "lease-test-1");
  const pendingPointerRef = useRef<{ down: CanvasPointerInput; up?: CanvasPointerInput } | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = new BrowserInputController({
      getSessionId: () => "sess-test-1",
      getIncarnation: () => "inc-test-1",
      getProfileEpoch: () => 1,
      getSubscriptionEpoch: () => "sub-test-1",
      getLeaseToken: () => leaseRef.current,
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
        const controller = controllerRef.current!;
        proxyRef.current?.focus();
        if (!controlReady) { controller.handlePointerDown(e); return; }
        const pending: { down: CanvasPointerInput; up?: CanvasPointerInput } = { down: {
          currentTarget: e.currentTarget, clientX: e.clientX, clientY: e.clientY,
          button: e.button, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey,
        } };
        pendingPointerRef.current = pending;
        const handoff = controller.beginControlHandoff(
          () => pendingPointerRef.current === pending && Boolean(proxyRef.current?.isFocused()),
          () => { pendingPointerRef.current = null; },
        );
        void controlReady.then(() => {
          if (pendingPointerRef.current !== pending) return;
          leaseRef.current = "lease-test-1";
          controller.handlePointerDown(pending.down);
          const up = pendingPointerRef.current.up;
          if (up) controller.handlePointerUp(up);
          controller.completeControlHandoff(handoff, () => {
            pendingPointerRef.current = null;
            onHandoffComplete?.();
          });
        });
      }}
      onCanvasPointerUp={(e) => {
        if (pendingPointerRef.current) {
          pendingPointerRef.current.up = {
            currentTarget: e.currentTarget, clientX: e.clientX, clientY: e.clientY,
            button: e.button, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey,
          };
        } else controllerRef.current?.handlePointerUp(e);
      }}
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

  it("retains proxy focus through a native canvas click and forwards ordinary typing once", async () => {
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

    const canvas = container.querySelector("canvas")!;
    await userEvent.click(canvas);
    expect(activeProxy?.isFocused()).toBe(true);

    // No focus()/fill() on the textarea: real typing must follow the canvas click.
    await userEvent.keyboard("book");
    const insertedText = socket.sentMessages
      .map((message) => JSON.parse(message) as InputMessage)
      .flatMap((message) =>
        message.event.kind === "insertText" ? [message.event.text] : [],
      )
      .join("");
    expect(insertedText).toBe("book");
    expect(activeProxy?.isFocused()).toBe(true);
  });

  it("keeps native immediate typing and editing behind a deferred click lease", async () => {
    const ready = Promise.withResolvers<void>();
    const drained = Promise.withResolvers<void>();
    act(() => root.render(
      <TestHarness socket={socket} drawnRect={mockDrawnRect} controlReady={ready.promise}
        onHandoffComplete={() => drained.resolve()}
        onControllerReady={(controller, proxy) => { activeController = controller; activeProxy = proxy; }} />,
    ));
    await userEvent.click(container.querySelector("canvas")!);
    await userEvent.keyboard("book{Backspace}k");
    expect(socket.sentMessages).toEqual([]);
    await act(async () => ready.resolve());
    await drained.promise;
    const events = socket.sentMessages.map(message => (JSON.parse(message) as InputMessage).event);
    expect(events.slice(0, 2).map(event => event.kind)).toEqual(["pointerDown", "pointerUp"]);
    expect(events.flatMap(event => event.kind === "insertText" ? [event.text] : []).join("")).toBe("bookk");
    expect(events.filter(event => event.kind === "keyDown")).toEqual([
      { kind: "keyDown", key: "Backspace", code: "Backspace", modifiers: 0 },
    ]);
    expect(socket.sentMessages.map(message => JSON.parse(message).inputSeq))
      .toEqual(socket.sentMessages.map((_, index) => index + 1));
  });

  it("commits IME once during a handoff and cancels uncommitted composition on blur", async () => {
    const ready = Promise.withResolvers<void>();
    const drained = Promise.withResolvers<void>();
    act(() => root.render(
      <TestHarness socket={socket} drawnRect={mockDrawnRect} controlReady={ready.promise}
        onHandoffComplete={() => drained.resolve()}
        onControllerReady={(controller, proxy) => { activeController = controller; activeProxy = proxy; }} />,
    ));
    await userEvent.click(container.querySelector("canvas")!);
    const proxy = container.querySelector("textarea")!;
    proxy.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    proxy.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "tiếng Việt" }));
    proxy.value = "tiếng Việt";
    proxy.dispatchEvent(new InputEvent("input", { bubbles: true, data: "tiếng Việt", inputType: "insertCompositionText" }));
    expect(socket.sentMessages).toEqual([]);
    await act(async () => ready.resolve());
    await drained.promise;
    expect(socket.sentMessages.map(message => JSON.parse(message).event).filter(event => event.kind === "insertText"))
      .toEqual([{ kind: "insertText", text: "tiếng Việt" }]);
    socket.sentMessages = [];
    proxy.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    activeProxy?.reset();
    proxy.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "cancelled-navigation" }));
    proxy.value = "cancelled-navigation";
    proxy.dispatchEvent(new InputEvent("input", { bubbles: true, data: "cancelled-navigation", inputType: "insertCompositionText" }));
    expect(socket.sentMessages).toEqual([]);
    proxy.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    proxy.blur();
    proxy.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "discarded" }));
    expect(socket.sentMessages).toEqual([]);
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

  it.each([
    { name: "plain paste", key: "", code: "" },
    { name: "Ctrl+V", key: "v", code: "KeyV", ctrlKey: true },
    { name: "Meta+V", key: "v", code: "KeyV", metaKey: true },
    { name: "Shift+Insert", key: "Insert", code: "Insert", shiftKey: true },
  ])("inserts local plain text once for $name without triggering remote paste", async (shortcut) => {
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
    if (shortcut.key) {
      const keyDown = new KeyboardEvent("keydown", { ...shortcut, bubbles: true, cancelable: true });
      textarea.dispatchEvent(keyDown);
      expect(keyDown.defaultPrevented).toBe(false);
    }

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

    if (shortcut.key) {
      textarea.dispatchEvent(new KeyboardEvent("keyup", { ...shortcut, bubbles: true, cancelable: true }));
    }
    expect(socket.sentMessages.map((message) => (JSON.parse(message) as InputMessage).event))
      .toEqual([{ kind: "insertText", text: "pasted-safe-text" }]);
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
