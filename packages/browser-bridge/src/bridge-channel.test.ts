import { describe, expect, it, vi } from "vitest";
import { createPostMessageBrowserBridgeChannel } from "./bridge-channel.js";

interface FakeWindow {
  listeners: Set<(event: MessageEvent<unknown>) => void>;
  addEventListener: (
    type: string,
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
  removeEventListener: (
    type: string,
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
  postMessage: (message: unknown, targetOrigin: string) => void;
}

function fakeWindow(): FakeWindow {
  const listeners = new Set<(event: MessageEvent<unknown>) => void>();
  return {
    listeners,
    addEventListener(type, listener) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "message") listeners.delete(listener);
    },
    postMessage: vi.fn(),
  };
}

describe("postMessage browser bridge channel", () => {
  it("forwards delivery evidence and target origins without parsing", () => {
    const parent = fakeWindow();
    const target = fakeWindow();
    const channel = createPostMessageBrowserBridgeChannel(
      parent as unknown as Window,
      target as unknown as Window,
    );
    const listener = vi.fn();
    channel.subscribe(listener);

    const data = { type: "untrusted" };
    target.listeners.forEach((onMessage) =>
      onMessage({
        data,
        origin: "http://localhost:5173",
        source: parent as unknown as WindowProxy,
      } as MessageEvent<unknown>),
    );
    channel.send(
      {
        version: 1,
        type: "dam-hopper:bridge-ready",
        nonce: "nonce",
        requestId: "request",
      },
      "http://localhost:5173",
    );

    expect(listener).toHaveBeenCalledWith({
      data,
      origin: "http://localhost:5173",
      source: parent,
    });
    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "dam-hopper:bridge-ready" }),
      "http://localhost:5173",
    );
  });

  it("unsubscribes listeners and destroys idempotently", () => {
    const parent = fakeWindow();
    const target = fakeWindow();
    const channel = createPostMessageBrowserBridgeChannel(
      parent as unknown as Window,
      target as unknown as Window,
    );
    const listener = vi.fn();
    const unsubscribe = channel.subscribe(listener);
    unsubscribe();
    channel.destroy();
    channel.destroy();

    expect(target.listeners.size).toBe(0);
    target.listeners.forEach((onMessage) =>
      onMessage({
        data: {},
        origin: "",
        source: parent,
      } as unknown as MessageEvent<unknown>),
    );
    expect(listener).not.toHaveBeenCalled();
    expect(() => channel.send({} as never, "*")).not.toThrow();
  });
});
