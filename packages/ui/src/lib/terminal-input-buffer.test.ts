import { describe, it, expect, beforeEach } from "vitest";
import { TerminalInputBuffer } from "./terminal-input-buffer.js";

describe("TerminalInputBuffer", () => {
  let buf: TerminalInputBuffer;

  beforeEach(() => {
    buf = new TerminalInputBuffer();
  });

  it("accumulates printable characters", () => {
    buf.append("hello");
    expect(buf.currentInput).toBe("hello");
    expect(buf.length).toBe(5);
    expect(buf.isClean).toBe(true);
  });

  it("removes last character on backspace (0x7f)", () => {
    buf.append("hello");
    buf.append("\x7f");
    expect(buf.currentInput).toBe("hell");
    expect(buf.length).toBe(4);
  });

  it("backspace on empty buffer is a no-op", () => {
    buf.append("\x7f");
    expect(buf.currentInput).toBe("");
    expect(buf.length).toBe(0);
  });

  it("Ctrl+U (0x15) clears entire buffer", () => {
    buf.append("hello world");
    buf.append("\x15");
    expect(buf.currentInput).toBe("");
    expect(buf.length).toBe(0);
  });

  it("Ctrl+W (0x17) deletes last word", () => {
    buf.append("git commit");
    buf.append("\x17");
    expect(buf.currentInput).toBe("git ");
  });

  it("Ctrl+W on single word clears buffer", () => {
    buf.append("hello");
    buf.append("\x17");
    expect(buf.currentInput).toBe("");
  });

  it("Enter (\\r) resets buffer and isClean", () => {
    buf.append("ls -la");
    buf.append("\r");
    expect(buf.currentInput).toBe("");
    expect(buf.length).toBe(0);
    expect(buf.isClean).toBe(true);
  });

  it("Ctrl+C (0x03) resets buffer", () => {
    buf.append("partial command");
    buf.append("\x03");
    expect(buf.currentInput).toBe("");
    expect(buf.length).toBe(0);
  });

  it("CSI escape sequence marks buffer as unclean", () => {
    buf.append("he");
    buf.append("\x1b[A"); // Up arrow
    buf.append("llo");
    expect(buf.isClean).toBe(false);
    // Escape sequence bytes not added to buffer
    expect(buf.currentInput).toBe("hello");
  });

  it("SS3 escape sequence marks buffer as unclean", () => {
    buf.append("he");
    buf.append("\x1bOH"); // Home key
    expect(buf.isClean).toBe(false);
  });

  it("simple escape sequence marks buffer as unclean", () => {
    buf.append("\x1b" + "c"); // ESC c = terminal reset
    expect(buf.isClean).toBe(false);
  });

  it("reset clears buffer and isClean flag", () => {
    buf.append("test");
    buf.append("\x1b[A");
    buf.reset();
    expect(buf.currentInput).toBe("");
    expect(buf.isClean).toBe(true);
    expect(buf.length).toBe(0);
  });

  it("handles mixed printable and control chars in one append", () => {
    buf.append("hello\x7f world");
    expect(buf.currentInput).toBe("hell world");
  });

  it("ignores non-printable control chars below space", () => {
    // Only allow ≥ 0x20, except the specifically handled ones
    buf.append("\x01\x02hello"); // SOH, STX should be ignored
    expect(buf.currentInput).toBe("hello");
  });
});
