// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCognitoModeInputGuard } from "./use-cognito-mode-input-guard.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useSettingsStore } from "@/stores/settings.js";
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
    useSettingsStore.setState({ cognitoModeShortcut: "Mod+Alt+KeyB" });
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

  it("activates synchronously on matching non-repeating keydown chord, eats repeats and keyup", async () => {
    await act(async () => root?.render(<TestGuardHost />));
    expect(useCognitoModeStore.getState().active).toBe(false);

    // 1. Initial keydown matching chord
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const event = new KeyboardEvent("keydown", {
      code: "KeyB",
      key: "b",
      ctrlKey: !isMac,
      metaKey: isMac,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(useCognitoModeStore.getState().active).toBe(true);
    expect(useCognitoModeStore.getState().activationShortcut).toBe("Mod+Alt+KeyB");

    // 2. Held repeat of the same chord key
    const repeatEvent = new KeyboardEvent("keydown", {
      code: "KeyB",
      key: "b",
      ctrlKey: !isMac,
      metaKey: isMac,
      altKey: true,
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(repeatEvent);

    expect(repeatEvent.defaultPrevented).toBe(true);
    expect(useCognitoModeStore.getState().active).toBe(true); // stays active, no toggle

    // 3. Keyup of KeyB
    const keyUpEvent = new KeyboardEvent("keyup", {
      code: "KeyB",
      key: "b",
      ctrlKey: !isMac,
      metaKey: isMac,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(keyUpEvent);
    expect(keyUpEvent.defaultPrevented).toBe(true);
    expect(useCognitoModeStore.getState().active).toBe(true);
  });

  it("deactivates on matching frozen chord, consumes dismissal sequence through release, and resumes ordinary input", async () => {
    await act(async () => root?.render(<TestGuardHost />));
    useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    expect(useCognitoModeStore.getState().active).toBe(true);

    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

    // While active, ordinary keydown is consumed
    const letterEvent = new KeyboardEvent("keydown", {
      code: "KeyX",
      key: "x",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(letterEvent);
    expect(letterEvent.defaultPrevented).toBe(true);

    // Dismiss with matching chord keydown
    const dismissEvent = new KeyboardEvent("keydown", {
      code: "KeyB",
      key: "b",
      ctrlKey: !isMac,
      metaKey: isMac,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(dismissEvent);

    expect(dismissEvent.defaultPrevented).toBe(true);
    expect(useCognitoModeStore.getState().active).toBe(false);

    // Trailing keyup of KeyB after deactivation is consumed (does not leak to app)
    const keyUpEvent = new KeyboardEvent("keyup", {
      code: "KeyB",
      key: "b",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(keyUpEvent);
    expect(keyUpEvent.defaultPrevented).toBe(true);

    // Subsequent fresh ordinary key passes through
    const freshEvent = new KeyboardEvent("keydown", {
      code: "KeyZ",
      key: "z",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(freshEvent);
    expect(freshEvent.defaultPrevented).toBe(false);
  });

  it("repeated chord hold does not flash mask off/on while active or inactive", async () => {
    await act(async () => root?.render(<TestGuardHost />));
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

    // Activate
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyB",
        key: "b",
        ctrlKey: !isMac,
        metaKey: isMac,
        altKey: true,
        cancelable: true,
      }),
    );
    expect(useCognitoModeStore.getState().active).toBe(true);

    // 5 repeats while active do not dismiss
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyB",
          key: "b",
          ctrlKey: !isMac,
          metaKey: isMac,
          altKey: true,
          repeat: true,
          cancelable: true,
        }),
      );
      expect(useCognitoModeStore.getState().active).toBe(true);
    }

    // Release
    window.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyB", key: "b", cancelable: true }),
    );

    // Dismiss
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyB",
        key: "b",
        ctrlKey: !isMac,
        metaKey: isMac,
        altKey: true,
        cancelable: true,
      }),
    );
    expect(useCognitoModeStore.getState().active).toBe(false);

    // 5 repeats after dismissal do not re-activate
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyB",
          key: "b",
          ctrlKey: !isMac,
          metaKey: isMac,
          altKey: true,
          repeat: true,
          cancelable: true,
        }),
      );
      expect(useCognitoModeStore.getState().active).toBe(false);
    }
  });

  it("composing keydown (isComposing or keyCode 229) is suppressed without activating or dismissing", async () => {
    await act(async () => root?.render(<TestGuardHost />));
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

    // 1. Inactive: matching chord with isComposing is suppressed but does not activate
    const composing1 = new KeyboardEvent("keydown", {
      code: "KeyB",
      key: "b",
      ctrlKey: !isMac,
      metaKey: isMac,
      altKey: true,
      isComposing: true,
      cancelable: true,
    });
    window.dispatchEvent(composing1);
    expect(composing1.defaultPrevented).toBe(true);
    expect(useCognitoModeStore.getState().active).toBe(false);

    // Inactive: matching chord with keyCode 229 is suppressed but does not activate
    const composing2 = new KeyboardEvent("keydown", {
      code: "KeyB",
      key: "b",
      ctrlKey: !isMac,
      metaKey: isMac,
      altKey: true,
      keyCode: 229,
      cancelable: true,
    });
    window.dispatchEvent(composing2);
    expect(composing2.defaultPrevented).toBe(true);
    expect(useCognitoModeStore.getState().active).toBe(false);

    // Activate cleanly
    useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    expect(useCognitoModeStore.getState().active).toBe(true);

    // 2. Active: matching chord with isComposing is consumed but does NOT dismiss
    const activeComposing = new KeyboardEvent("keydown", {
      code: "KeyB",
      key: "b",
      ctrlKey: !isMac,
      metaKey: isMac,
      altKey: true,
      isComposing: true,
      cancelable: true,
    });
    window.dispatchEvent(activeComposing);
    expect(activeComposing.defaultPrevented).toBe(true);
    expect(useCognitoModeStore.getState().active).toBe(true);
  });

  it("allows chord through when target is inside [data-shortcut-capture='true'] while inactive, but consumes all keys while active", async () => {
    await act(async () => root?.render(<TestGuardHost />));
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

    const captureBtn = document.createElement("button");
    captureBtn.setAttribute("data-shortcut-capture", "true");
    document.body.appendChild(captureBtn);

    // Inactive: event dispatched on capture button passes through without activating
    const captureEvent = new KeyboardEvent("keydown", {
      code: "KeyB",
      key: "b",
      ctrlKey: !isMac,
      metaKey: isMac,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    captureBtn.dispatchEvent(captureEvent);
    expect(captureEvent.defaultPrevented).toBe(false);
    expect(useCognitoModeStore.getState().active).toBe(false);

    // Activate
    useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    expect(useCognitoModeStore.getState().active).toBe(true);

    // Active: event dispatched on capture button is consumed (capture exemption ignored)
    const activeCaptureEvent = new KeyboardEvent("keydown", {
      code: "KeyX",
      key: "x",
      bubbles: true,
      cancelable: true,
    });
    captureBtn.dispatchEvent(activeCaptureEvent);
    expect(activeCaptureEvent.defaultPrevented).toBe(true);

    captureBtn.remove();
  });

  it("reconciles physical codes on window blur without deactivating mask", async () => {
    await act(async () => root?.render(<TestGuardHost />));
    useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    expect(useCognitoModeStore.getState().active).toBe(true);

    // Keydown for KeyA while active
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyA", key: "a", cancelable: true }),
    );

    // Blur window (e.g. switch windows / tab away)
    window.dispatchEvent(new Event("blur"));

    // Mask remains active!
    expect(useCognitoModeStore.getState().active).toBe(true);

    // Deactivate cleanly
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyB",
        key: "b",
        ctrlKey: !isMac,
        metaKey: isMac,
        altKey: true,
        cancelable: true,
      }),
    );
    expect(useCognitoModeStore.getState().active).toBe(false);

    // Fresh KeyA press now passes through normally (not permanently eaten due to blur clearing codes)
    const freshKeyA = new KeyboardEvent("keydown", {
      code: "KeyA",
      key: "a",
      cancelable: true,
    });
    window.dispatchEvent(freshKeyA);
    expect(freshKeyA.defaultPrevented).toBe(false);
  });

  it("freezes activation chord so settings hydration change while active cannot lock user out", async () => {
    await act(async () => root?.render(<TestGuardHost />));
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

    // Activate with Mod+Alt+KeyB
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyB",
        key: "b",
        ctrlKey: !isMac,
        metaKey: isMac,
        altKey: true,
        cancelable: true,
      }),
    );
    expect(useCognitoModeStore.getState().active).toBe(true);
    expect(useCognitoModeStore.getState().activationShortcut).toBe("Mod+Alt+KeyB");

    // Release KeyB from activation sequence
    window.dispatchEvent(
      new KeyboardEvent("keyup", {
        code: "KeyB",
        key: "b",
        ctrlKey: !isMac,
        metaKey: isMac,
        altKey: true,
        cancelable: true,
      }),
    );

    // Settings changes while active (e.g. hydration or sync)
    useSettingsStore.setState({ cognitoModeShortcut: "Ctrl+Shift+KeyC" });

    // Attempt to dismiss with new settings chord: does not dismiss!
    const newChordEvent = new KeyboardEvent("keydown", {
      code: "KeyC",
      key: "c",
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    window.dispatchEvent(newChordEvent);
    expect(newChordEvent.defaultPrevented).toBe(true);
    expect(useCognitoModeStore.getState().active).toBe(true);

    // Dismiss with frozen original chord: dismisses!
    const originalChordEvent = new KeyboardEvent("keydown", {
      code: "KeyB",
      key: "b",
      ctrlKey: !isMac,
      metaKey: isMac,
      altKey: true,
      cancelable: true,
    });
    window.dispatchEvent(originalChordEvent);
    expect(originalChordEvent.defaultPrevented).toBe(true);
    expect(useCognitoModeStore.getState().active).toBe(false);
  });
});
