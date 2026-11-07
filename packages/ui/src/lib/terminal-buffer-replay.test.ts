import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  applyTerminalBufferReplay,
  isTerminalBufferReplayEligible,
} from "./terminal-buffer-replay.js";
import { recordClientDiagnostic } from "@/lib/diagnostics-client.js";

vi.mock("@/lib/diagnostics-client.js", () => ({
  recordClientDiagnostic: vi.fn(),
}));

describe("applyTerminalBufferReplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
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

  it("records diagnostic event on buffer reset boundary with instance token", () => {
    const term = {
      reset: vi.fn(),
      write: vi.fn((data: string, cb?: () => void) => cb?.()),
    };
    applyTerminalBufferReplay(
      term,
      {
        data: "abc",
        offset: 3,
        reset: true,
        truncated: false,
        incarnation: 1,
      },
      undefined,
      undefined,
      "inst-tok-123",
    );

    expect(recordClientDiagnostic).toHaveBeenCalledWith(
      "transport",
      "terminal-buffer-replay",
      "buffer_reset",
      {
        offset: 3,
        truncated: false,
        instanceToken: "inst-tok-123",
      },
    );
  });

  it("checks exact target eligibility: accepts safe exact-equal and refuses mismatch/unsafe", () => {
    const target = {
      profileId: "p1",
      generation: 1,
      serverEpoch: "c18f1f50-3bf0-4566-b333-e18e8df52ea2",
      terminalId: "term-1",
      incarnation: "42",
    };

    // Matching safe positive integer equal to target string
    expect(isTerminalBufferReplayEligible({ incarnation: 42 }, target)).toBe(true);

    // Mismatched incarnation
    expect(isTerminalBufferReplayEligible({ incarnation: 43 }, target)).toBe(false);

    // Unsafe numeric representation (> MAX_SAFE_INTEGER)
    expect(
      isTerminalBufferReplayEligible(
        { incarnation: Number.MAX_SAFE_INTEGER + 10 },
        { ...target, incarnation: "9007199254740992" },
      ),
    ).toBe(false);

    // Negative / non-positive numbers
    expect(isTerminalBufferReplayEligible({ incarnation: 0 }, target)).toBe(false);
    expect(isTerminalBufferReplayEligible({ incarnation: -1 }, target)).toBe(false);

    // When target provided to applyTerminalBufferReplay, mismatch fails closed without writing to term
    const term = {
      reset: vi.fn(),
      write: vi.fn(),
    };
    const offset = applyTerminalBufferReplay(
      term,
      {
        data: "mismatched",
        offset: 10,
        reset: true,
        truncated: false,
        incarnation: 99,
      },
      undefined,
      undefined,
      "inst-tok-123",
      target,
    );

    expect(offset).toBe(-1);
    expect(term.write).not.toHaveBeenCalled();
    expect(term.reset).not.toHaveBeenCalled();
    expect(recordClientDiagnostic).toHaveBeenCalledWith(
      "transport",
      "terminal-buffer-replay",
      "buffer_replay_refused_mismatch",
      {
        expectedIncarnation: "42",
        receivedIncarnation: 99,
        instanceToken: "inst-tok-123",
      },
    );
  });
});
