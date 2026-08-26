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

  it("preserves replay bytes and waits for xterm write completion", () => {
    let complete: (() => void) | undefined;
    const onComplete = vi.fn();
    const term = {
      clear: vi.fn(),
      write: vi.fn((_data: string, callback?: () => void) => {
        complete = callback;
      }),
    };
    const replay = {
      data: "\u001b]10;rgb:aa/bb/cc\u0007\u001b]9;notify;Old;History\u0007",
      offset: 42,
      reset: true,
      truncated: false,
    };

    expect(applyTerminalBufferReplay(term, replay, onComplete)).toBe(42);
    expect(term.clear).toHaveBeenCalledOnce();
    expect(term.write).toHaveBeenCalledWith(replay.data, expect.any(Function));
    expect(onComplete).not.toHaveBeenCalled();

    complete?.();
    expect(onComplete).toHaveBeenCalledOnce();
  });
});

describe("utf8ByteLength", () => {
  it("counts utf8 bytes, not utf16 code units", () => {
    expect(utf8ByteLength("é")).toBe(2);
  });
});
