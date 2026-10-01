// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCognitoModeInputGuard } from "./use-cognito-mode-input-guard.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
if (typeof window !== "undefined" && typeof window.PointerEvent === "undefined") {
  class MockPointerEvent extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, params: MouseEventInit & { pointerId?: number } = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
    }
  }
  // @ts-expect-error polyfill for jsdom
  window.PointerEvent = MockPointerEvent;
  // @ts-expect-error polyfill for jsdom
  globalThis.PointerEvent = MockPointerEvent;
}

function TestGuardHost() {
  useCognitoModeInputGuard();
  return <div data-testid="guard-host" />;
}

describe("useCognitoModeInputGuard", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let sink: HTMLDivElement | null = null;

  beforeEach(() => {
    useCognitoModeStore.getState().reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    sink = document.createElement("div");
    sink.setAttribute("data-cognito-mode-overlay", "");
    sink.tabIndex = -1;
    document.body.appendChild(sink);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    sink?.remove();
    root = null;
    container = null;
    sink = null;
    useCognitoModeStore.getState().reset();
  });

  it("permits click and input events when inactive", async () => {
    await act(async () => root?.render(<TestGuardHost />));
    const button = document.createElement("button");
    const onClick = vi.fn();
    button.addEventListener("click", onClick);
    container?.appendChild(button);

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("suppresses click, pointer, wheel, and paste events when active", async () => {
    await act(async () => root?.render(<TestGuardHost />));
    const button = document.createElement("button");
    const onClick = vi.fn();
    button.addEventListener("click", onClick);
    container?.appendChild(button);

    useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");

    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(clickEvent);
    expect(onClick).not.toHaveBeenCalled();
    expect(clickEvent.defaultPrevented).toBe(true);

    const pointerEvent = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    button.dispatchEvent(pointerEvent);
    expect(pointerEvent.defaultPrevented).toBe(true);

    const wheelEvent = new WheelEvent("wheel", { bubbles: true, cancelable: true });
    button.dispatchEvent(wheelEvent);
    expect(wheelEvent.defaultPrevented).toBe(true);

    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    button.dispatchEvent(pasteEvent);
    expect(pasteEvent.defaultPrevented).toBe(true);
  });

  it("redirects external focus attempts back to the focus sink while active", async () => {
    await act(async () => root?.render(<TestGuardHost />));
    const input = document.createElement("input");
    container?.appendChild(input);

    useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    expect(document.activeElement).toBe(sink);

    input.focus();
    expect(document.activeElement).toBe(sink);
  });

  it("restores prior connected focus upon deactivation", async () => {
    await act(async () => root?.render(<TestGuardHost />));
    const input = document.createElement("input");
    container?.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    act(() => useCognitoModeStore.getState().toggle("Mod+Alt+KeyB"));
    expect(document.activeElement).toBe(sink);

    act(() => useCognitoModeStore.getState().toggle("Mod+Alt+KeyB"));
    expect(document.activeElement).toBe(input);
  });

  it("does not restore focus to an inert or disconnected prior element", async () => {
    await act(async () => root?.render(<TestGuardHost />));
    const input = document.createElement("input");
    container?.appendChild(input);
    input.focus();

    act(() => useCognitoModeStore.getState().toggle("Mod+Alt+KeyB"));
    input.setAttribute("inert", "");

    act(() => useCognitoModeStore.getState().toggle("Mod+Alt+KeyB"));
    expect(document.activeElement).not.toBe(input);
  });

  it("consumes trailing pointerup and click events from an in-flight active gesture after deactivation", async () => {
    await act(async () => root?.render(<TestGuardHost />));
    const button = document.createElement("button");
    const onClick = vi.fn();
    button.addEventListener("click", onClick);
    container?.appendChild(button);

    act(() => useCognitoModeStore.getState().toggle("Mod+Alt+KeyB"));
    const pointerDown = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    button.dispatchEvent(pointerDown);

    act(() => useCognitoModeStore.getState().toggle("Mod+Alt+KeyB"));
    expect(useCognitoModeStore.getState().active).toBe(false);

    const pointerUp = new PointerEvent("pointerup", { bubbles: true, cancelable: true });
    button.dispatchEvent(pointerUp);
    expect(pointerUp.defaultPrevented).toBe(true);

    const trailingClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(trailingClick);
    expect(trailingClick.defaultPrevented).toBe(true);
    expect(onClick).not.toHaveBeenCalled();

    const freshClick = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(freshClick);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("clears in-flight gesture tracking on active click completion so subsequent inactive click works", async () => {
    await act(async () => root?.render(<TestGuardHost />));
    const button = document.createElement("button");
    const onClick = vi.fn();
    button.addEventListener("click", onClick);
    container?.appendChild(button);

    act(() => useCognitoModeStore.getState().toggle("Mod+Alt+KeyB"));
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onClick).not.toHaveBeenCalled();

    act(() => useCognitoModeStore.getState().toggle("Mod+Alt+KeyB"));
    expect(useCognitoModeStore.getState().active).toBe(false);

    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("consumes and clears pending gesture when touchcancel arrives after deactivation", async () => {
    await act(async () => root?.render(<TestGuardHost />));
    const button = document.createElement("button");
    const onClick = vi.fn();
    button.addEventListener("click", onClick);
    container?.appendChild(button);

    act(() => useCognitoModeStore.getState().toggle("Mod+Alt+KeyB"));
    const touchStart = new Event("touchstart", { bubbles: true, cancelable: true });
    button.dispatchEvent(touchStart);
    expect(touchStart.defaultPrevented).toBe(true);

    act(() => useCognitoModeStore.getState().toggle("Mod+Alt+KeyB"));
    expect(useCognitoModeStore.getState().active).toBe(false);

    const touchCancel = new Event("touchcancel", { bubbles: true, cancelable: true });
    button.dispatchEvent(touchCancel);
    expect(touchCancel.defaultPrevented).toBe(true);

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("removes all listeners and resets store on unmount", async () => {
    await act(async () => root?.render(<TestGuardHost />));
    useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    expect(useCognitoModeStore.getState().active).toBe(true);

    await act(async () => {
      root?.unmount();
      root = null;
    });

    expect(useCognitoModeStore.getState().active).toBe(false);
    const button = document.createElement("button");
    const onClick = vi.fn();
    button.addEventListener("click", onClick);
    document.body.appendChild(button);

    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
    button.remove();
  });
});
