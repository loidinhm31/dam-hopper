// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserInputController } from "./input-controller.js";
import { TextInputProxy } from "./text-input-proxy.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function dispatchPaste(textarea: HTMLTextAreaElement, text: string): void {
  const evt = new Event("paste", { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  Object.defineProperty(evt, "clipboardData", {
    configurable: true,
    value: { getData: (type: string) => (type === "text/plain" ? text : "") },
  });
  textarea.dispatchEvent(evt);
}

describe("TextInputProxy paste feedback and staging lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("reports unavailable controller on paste and clears staging only after explicit accept/reject", () => {
    const onPasteError = vi.fn();
    const onPasteSuccess = vi.fn();
    act(() => {
      root.render(
        <TextInputProxy
          controller={null}
          onPasteError={onPasteError}
          onPasteSuccess={onPasteSuccess}
        />,
      );
    });
    const textarea = container.querySelector("textarea")!;
    textarea.value = "staged";
    act(() => {
      dispatchPaste(textarea, "hello");
    });
    expect(onPasteError).toHaveBeenCalledWith(
      "Paste rejected: browser input controller unavailable",
    );
    expect(onPasteSuccess).not.toHaveBeenCalled();

    const handlePasteText = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const controller = { handlePasteText } as unknown as BrowserInputController;
    onPasteError.mockClear();
    onPasteSuccess.mockClear();

    act(() => {
      root.render(
        <TextInputProxy
          controller={controller}
          onPasteError={onPasteError}
          onPasteSuccess={onPasteSuccess}
        />,
      );
    });

    // Rejected paste clears staging without calling onPasteSuccess
    textarea.value = "stale-before-reject";
    act(() => {
      dispatchPaste(textarea, "rejected-body");
    });
    expect(handlePasteText).toHaveBeenCalledWith("rejected-body");
    expect(onPasteSuccess).not.toHaveBeenCalled();
    expect(textarea.value).toBe("");

    // Accepted paste calls onPasteSuccess and clears staging
    textarea.value = "stale-before-accept";
    act(() => {
      dispatchPaste(textarea, "accepted-body");
    });
    expect(handlePasteText).toHaveBeenCalledWith("accepted-body");
    expect(onPasteSuccess).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe("");
  });
});
