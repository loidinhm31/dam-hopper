import { describe, expect, it, vi } from "vitest";
import { applyTerminalBufferReplay } from "./terminal-buffer-replay.js";

describe("applyTerminalBufferReplay", () => {
  it("waits for asynchronous xterm write completion boundary before calling onComplete", () => {
    let complete: (() => void) | undefined;
    const onComplete = vi.fn();
    const term = {
      reset: vi.fn(),
      write: vi.fn((data: string, callback?: () => void) => {
        if (data === "") {
          // Synchronously finish the drain write
          callback?.();
        } else {
          // Hold the actual replay write until complete() is called
          complete = callback;
        }
      }),
    };
    const replay = {
      data: "\u001b]10;rgb:aa/bb/cc\u0007\u001b]9;notify;Old;History\u0007",
      offset: 42,
      reset: true,
      truncated: false,
      incarnation: 1,
    };

    const returnedOffset = applyTerminalBufferReplay(term, replay, onComplete);
    expect(returnedOffset).toBe(42);
    expect(onComplete).not.toHaveBeenCalled();

    complete?.();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("integrates with TerminalStreamReplayGate across write lifecycle", () => {
    let completeReplayWrite: (() => void) | undefined;
    const term = {
      reset: vi.fn(),
      write: vi.fn((data: string, cb?: () => void) => {
        if (data === "") cb?.();
        else completeReplayWrite = cb;
      }),
    };
    const gate = {
      hasAttachBufferBeenReceived: false,
      isReplayWriting: false,
      isLiveStreamReady: true,
      replayGeneration: 0,
      activeReplayWrites: 0,
      queuedLiveData: [],
    };

    applyTerminalBufferReplay(
      term,
      {
        data: "prompt",
        offset: 6,
        reset: true,
        truncated: false,
        incarnation: 1,
      },
      undefined,
      gate,
    );

    expect(gate.activeReplayWrites).toBe(1);
    expect(gate.isReplayWriting).toBe(true);
    expect(gate.isLiveStreamReady).toBe(false);

    completeReplayWrite?.();
    expect(gate.activeReplayWrites).toBe(0);
    expect(gate.isReplayWriting).toBe(false);
  });
});
