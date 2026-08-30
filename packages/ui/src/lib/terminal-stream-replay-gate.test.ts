import { describe, expect, it } from "vitest";
import {
  createTerminalStreamReplayGate,
  markTerminalStreamReadyAfterRestart,
  resetTerminalStreamReplayGateForAttach,
} from "./terminal-stream-replay-gate.js";

describe("terminal stream replay gate", () => {
  it("closes a previously ready stream before a reconnect attach", () => {
    const gate = createTerminalStreamReplayGate();
    gate.hasAttachBufferBeenReceived = true;
    gate.isLiveStreamReady = true;
    gate.replayGeneration = 4;
    gate.queuedLiveData.push("stale");

    resetTerminalStreamReplayGateForAttach(gate);

    expect(gate).toEqual({
      hasAttachBufferBeenReceived: false,
      isReplayWriting: false,
      isLiveStreamReady: false,
      replayGeneration: 5,
      queuedLiveData: [],
    });
  });

  it("reopens a live stream after a confirmed in-place restart", () => {
    const gate = createTerminalStreamReplayGate();
    gate.replayGeneration = 4;
    gate.queuedLiveData.push("stale");

    markTerminalStreamReadyAfterRestart(gate);

    expect(gate).toEqual({
      hasAttachBufferBeenReceived: true,
      isReplayWriting: false,
      isLiveStreamReady: true,
      replayGeneration: 5,
      queuedLiveData: [],
    });
  });
});
