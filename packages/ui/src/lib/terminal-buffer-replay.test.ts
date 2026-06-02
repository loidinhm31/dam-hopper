import { describe, expect, it, vi } from "vitest";
import {
  applyTerminalBufferReplay,
  utf8ByteLength,
} from "./terminal-buffer-replay.js";

describe("applyTerminalBufferReplay", () => {
  it("clears before writing full reset snapshots", () => {
    const term = { clear: vi.fn(), write: vi.fn() };

    const offset = applyTerminalBufferReplay(term, {
      data: "full",
      offset: 4,
      reset: true,
      truncated: false,
    });

    expect(term.clear).toHaveBeenCalledOnce();
    expect(term.write).toHaveBeenCalledWith("full");
    expect(offset).toBe(4);
  });

  it("appends delta snapshots without clearing", () => {
    const term = { clear: vi.fn(), write: vi.fn() };

    applyTerminalBufferReplay(term, {
      data: "delta",
      offset: 10,
      reset: false,
      truncated: false,
    });

    expect(term.clear).not.toHaveBeenCalled();
    expect(term.write).toHaveBeenCalledWith("delta");
  });
});

describe("utf8ByteLength", () => {
  it("counts utf8 bytes, not utf16 code units", () => {
    expect(utf8ByteLength("é")).toBe(2);
  });
});
