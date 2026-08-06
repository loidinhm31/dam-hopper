// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { syncNativeKeyboardSuppression } from "./terminal-native-input-policy.js";

describe("syncNativeKeyboardSuppression", () => {
  it("locks and restores xterm's real hidden textarea", () => {
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    textarea.focus();
    const term = {
      options: { disableStdin: false },
      textarea,
    };

    syncNativeKeyboardSuppression(term as never, true);

    expect(term.options.disableStdin).toBe(true);
    expect(textarea.inputMode).toBe("none");
    expect(textarea.getAttribute("inputmode")).toBe("none");
    expect(textarea.tabIndex).toBe(-1);
    expect(document.activeElement).not.toBe(textarea);

    syncNativeKeyboardSuppression(term as never, false);

    expect(term.options.disableStdin).toBe(false);
    expect(textarea.inputMode).toBe("");
    expect(textarea.hasAttribute("inputmode")).toBe(false);
    expect(textarea.tabIndex).toBe(0);
    textarea.remove();
  });

  it("does not fail when xterm is not ready", () => {
    expect(() => syncNativeKeyboardSuppression(null, true)).not.toThrow();
    expect(() =>
      syncNativeKeyboardSuppression(
        { options: { disableStdin: false }, textarea: null } as never,
        true,
      ),
    ).not.toThrow();
  });
});
