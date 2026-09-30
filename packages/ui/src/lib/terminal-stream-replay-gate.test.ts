import { describe, expect, it } from "vitest";
import {
  beginTerminalReplayWrite,
  createTerminalStreamReplayGate,
  finishTerminalReplayWrite,
  markTerminalStreamReadyAfterRestart,
  reconcileTerminalOutput,
  resetTerminalStreamReplayGateForAttach,
  shouldForwardTerminalData,
  sliceUtf8LeadingBytes,
} from "./terminal-stream-replay-gate.js";

describe("terminal stream replay gate", () => {
  it("closes a previously ready stream before a reconnect attach", () => {
    const gate = createTerminalStreamReplayGate();
    gate.hasAttachBufferBeenReceived = true;
    gate.isLiveStreamReady = true;
    gate.replayGeneration = 4;
    gate.queuedLiveData.push({ data: "stale", offset: 10, incarnation: 1 });

    resetTerminalStreamReplayGateForAttach(gate);

    expect(gate).toEqual({
      hasAttachBufferBeenReceived: false,
      isReplayWriting: false,
      isLiveStreamReady: false,
      replayGeneration: 5,
      activeReplayWrites: 0,
      queuedLiveData: [],
    });
  });

  it("preserves active replay writes across attach reset to fence older writes", () => {
    const gate = createTerminalStreamReplayGate();
    beginTerminalReplayWrite(gate);
    expect(gate.activeReplayWrites).toBe(1);
    expect(gate.isReplayWriting).toBe(true);
    expect(shouldForwardTerminalData(gate)).toBe(false);

    // An attach reset (e.g. reconnect or retry) while a write is still parsing
    // must keep the fence closed until that write actually finishes.
    resetTerminalStreamReplayGateForAttach(gate);
    expect(gate.activeReplayWrites).toBe(1);
    expect(gate.isReplayWriting).toBe(true);
    expect(shouldForwardTerminalData(gate)).toBe(false);

    // Once parsing finishes, the fence opens
    finishTerminalReplayWrite(gate);
    expect(gate.activeReplayWrites).toBe(0);
    expect(gate.isReplayWriting).toBe(false);
    expect(shouldForwardTerminalData(gate)).toBe(true);
  });

  it("reopens a live stream after a confirmed in-place restart when idle", () => {
    const gate = createTerminalStreamReplayGate();
    gate.replayGeneration = 4;
    gate.activeReplayWrites = 0;
    gate.queuedLiveData.push({ data: "stale", offset: 10, incarnation: 1 });

    markTerminalStreamReadyAfterRestart(gate);

    expect(gate).toEqual({
      hasAttachBufferBeenReceived: true,
      isReplayWriting: false,
      isLiveStreamReady: true,
      replayGeneration: 5,
      activeReplayWrites: 0,
      queuedLiveData: [],
    });
    expect(shouldForwardTerminalData(gate)).toBe(true);
  });

  it("preserves in-flight replay write fence across restart until parse completes", () => {
    const gate = createTerminalStreamReplayGate();
    gate.replayGeneration = 4;
    gate.activeReplayWrites = 1;
    gate.queuedLiveData.push({ data: "stale", offset: 10, incarnation: 1 });

    markTerminalStreamReadyAfterRestart(gate);

    // Live stream remains closed while in-flight replay write parses
    expect(gate.activeReplayWrites).toBe(1);
    expect(gate.isReplayWriting).toBe(true);
    expect(gate.isLiveStreamReady).toBe(false);
    expect(shouldForwardTerminalData(gate)).toBe(false);

    // Once in-flight replay finishes, fence opens
    finishTerminalReplayWrite(gate);
    expect(gate.activeReplayWrites).toBe(0);
    expect(gate.isReplayWriting).toBe(false);
    expect(shouldForwardTerminalData(gate)).toBe(true);
  });
});

describe("sliceUtf8LeadingBytes", () => {
  it("slices ASCII bytes accurately", () => {
    expect(sliceUtf8LeadingBytes("hello world", 6)).toBe("world");
    expect(sliceUtf8LeadingBytes("hello world", 0)).toBe("hello world");
    expect(sliceUtf8LeadingBytes("hello world", 20)).toBe("");
  });

  it("slices multi-byte UTF-8 sequences cleanly", () => {
    // '界' is 3 bytes (0xE7 0x95 0x8C)
    const text = "hello界world"; // 5 + 3 + 5 = 13 bytes
    expect(sliceUtf8LeadingBytes(text, 5)).toBe("界world");
    expect(sliceUtf8LeadingBytes(text, 8)).toBe("world");
  });
});

describe("reconcileTerminalOutput", () => {
  it("discards fully duplicate chunks", () => {
    const result = reconcileTerminalOutput("already rendered", 50, 50);
    expect(result).toEqual({ action: "discard", nextOffset: 50 });

    const resultEarlier = reconcileTerminalOutput("stale", 40, 50);
    expect(resultEarlier).toEqual({ action: "discard", nextOffset: 50 });
  });

  it("renders contiguous chunks without modification", () => {
    // "hello" is 5 bytes. endOffset 55, startOffset 50 === currentOffset 50
    const result = reconcileTerminalOutput("hello", 55, 50);
    expect(result).toEqual({
      action: "render",
      data: "hello",
      nextOffset: 55,
    });
  });

  it("slices leading overlapping bytes for partial overlap", () => {
    // "hello world" is 11 bytes. endOffset 60 -> startOffset 49.
    // currentOffset is 55. Overlap is 55 - 49 = 6 bytes ("hello ").
    // Remaining 5 bytes: "world".
    const result = reconcileTerminalOutput("hello world", 60, 55);
    expect(result).toEqual({
      action: "render",
      data: "world",
      nextOffset: 60,
    });
  });

  it("detects gaps and signals resync", () => {
    // "missing" is 7 bytes. endOffset 70 -> startOffset 63.
    // currentOffset is 50. Gap between 50 and 63.
    const result = reconcileTerminalOutput("missing", 70, 50);
    expect(result).toEqual({
      action: "gap",
      expectedOffset: 50,
      receivedStartOffset: 63,
    });
  });
});
