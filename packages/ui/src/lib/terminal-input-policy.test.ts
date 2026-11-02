// @vitest-environment jsdom
import type { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import {
  syncTerminalInputSuppression,
} from "./terminal-input-policy.js";

function createMockTerminal(): { term: Terminal; textarea: HTMLTextAreaElement } {
  const textarea = document.createElement("textarea");
  textarea.tabIndex = 0;
  textarea.blur = vi.fn();

  const term = {
    options: {
      disableStdin: false,
    },
    textarea,
  } as unknown as Terminal;

  return { term, textarea };
}

describe("terminal-input-policy", () => {
  it("locks and restores xterm hidden textarea and disableStdin option", () => {
    const { term, textarea } = createMockTerminal();

    // Suppress
    syncTerminalInputSuppression(term, true);
    expect(term.options.disableStdin).toBe(true);
    expect(textarea.inputMode).toBe("none");
    expect(textarea.getAttribute("inputmode")).toBe("none");
    expect(textarea.tabIndex).toBe(-1);
    expect(textarea.blur).toHaveBeenCalled();

    // Restore
    syncTerminalInputSuppression(term, false);
    expect(term.options.disableStdin).toBe(false);
    expect(textarea.inputMode).toBe("");
    expect(textarea.getAttribute("inputmode")).toBeNull();
    expect(textarea.tabIndex).toBe(0);
  });

  it("handles null terminal or missing textarea safely without error", () => {
    expect(() => syncTerminalInputSuppression(null, true)).not.toThrow();

    const termWithoutTextarea = {
      options: { disableStdin: false },
      textarea: undefined,
    } as unknown as Terminal;
    expect(() => syncTerminalInputSuppression(termWithoutTextarea, true)).not.toThrow();
    expect(termWithoutTextarea.options.disableStdin).toBe(true);
  });

});
