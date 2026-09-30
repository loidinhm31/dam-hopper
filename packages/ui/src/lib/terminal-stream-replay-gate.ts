export function utf8ByteLength(data: string): number {
  return new TextEncoder().encode(data).length;
}

export interface QueuedLiveChunk {
  data: string;
  offset: number;
  incarnation: number;
}

export interface TerminalStreamReplayGate {
  hasAttachBufferBeenReceived: boolean;
  isReplayWriting: boolean;
  isLiveStreamReady: boolean;
  replayGeneration: number;
  activeReplayWrites: number;
  queuedLiveData: QueuedLiveChunk[];
  onReplayDrain?: () => void;
}

export function createTerminalStreamReplayGate(): TerminalStreamReplayGate {
  return {
    hasAttachBufferBeenReceived: false,
    isReplayWriting: false,
    isLiveStreamReady: false,
    replayGeneration: 0,
    activeReplayWrites: 0,
    queuedLiveData: [],
    onReplayDrain: undefined,
  };
}

export function resetTerminalStreamReplayGateForAttach(
  gate: TerminalStreamReplayGate,
): void {
  gate.hasAttachBufferBeenReceived = false;
  gate.isLiveStreamReady = false;
  gate.replayGeneration += 1;
  gate.queuedLiveData.length = 0;
  // Outstanding parser write count survives attach/generation reset so in-flight
  // parses cannot leak queries after an attach reset or reconnect.
  gate.isReplayWriting = gate.activeReplayWrites > 0;
}

export function markTerminalStreamReadyAfterRestart(
  gate: TerminalStreamReplayGate,
): void {
  gate.hasAttachBufferBeenReceived = true;
  gate.replayGeneration += 1;
  gate.queuedLiveData.length = 0;
  gate.isReplayWriting = gate.activeReplayWrites > 0;
  // Live stream cannot open until all in-flight historical parsing finishes
  gate.isLiveStreamReady = gate.activeReplayWrites === 0;
}

export function beginTerminalReplayWrite(gate: TerminalStreamReplayGate): void {
  gate.hasAttachBufferBeenReceived = true;
  gate.isReplayWriting = true;
  gate.isLiveStreamReady = false;
  gate.activeReplayWrites += 1;
}

export function finishTerminalReplayWrite(
  gate: TerminalStreamReplayGate,
): void {
  gate.activeReplayWrites = Math.max(0, gate.activeReplayWrites - 1);
  gate.isReplayWriting = gate.activeReplayWrites > 0;
}

export function notifyTerminalReplayDrain(
  gate: TerminalStreamReplayGate,
): void {
  if (gate.activeReplayWrites === 0) {
    gate.onReplayDrain?.();
  }
}

/**
 * Returns whether outbound onData from xterm should be forwarded to the PTY.
 * Consults activeReplayWrites count so any in-flight asynchronous historical
 * replay parsing suppresses outbound queries even if an attach reset happened mid-flight.
 */
export function shouldForwardTerminalData(
  gate: TerminalStreamReplayGate,
): boolean {
  return gate.activeReplayWrites <= 0;
}

export function sliceUtf8LeadingBytes(
  data: string,
  bytesToSkip: number,
): string {
  if (bytesToSkip <= 0) return data;
  const bytes = new TextEncoder().encode(data);
  if (bytesToSkip >= bytes.length) return "";
  return new TextDecoder().decode(bytes.subarray(bytesToSkip));
}

export type ReconcileOutputResult =
  | { action: "render"; data: string; nextOffset: number }
  | { action: "discard"; nextOffset: number }
  | {
      action: "gap";
      expectedOffset: number;
      receivedStartOffset: number;
    };

/**
 * Reconcile a live output chunk with the current authoritative stream offset.
 * - endOffset <= currentOffset: duplicate chunk already seen -> discard
 * - startOffset > currentOffset: gap detected -> gap
 * - startOffset < currentOffset < endOffset: partial overlap -> slice leading bytes
 * - startOffset === currentOffset: contiguous chunk -> render
 */
export function reconcileTerminalOutput(
  data: string,
  endOffset: number,
  currentOffset: number,
): ReconcileOutputResult {
  // 1. Fast discard path for duplicate chunks without encoding (byteLen >= 0 => start <= end <= current)
  if (endOffset <= currentOffset) {
    return { action: "discard", nextOffset: currentOffset };
  }

  // 2. Single TextEncoder call for length and partial slicing
  const bytes = new TextEncoder().encode(data);
  const byteLen = bytes.length;
  const startOffset = endOffset - byteLen;

  if (startOffset > currentOffset) {
    return {
      action: "gap",
      expectedOffset: currentOffset,
      receivedStartOffset: startOffset,
    };
  }

  if (startOffset < currentOffset) {
    const bytesToSkip = currentOffset - startOffset;
    const remainingData = new TextDecoder().decode(bytes.subarray(bytesToSkip));
    return { action: "render", data: remainingData, nextOffset: endOffset };
  }

  return { action: "render", data, nextOffset: endOffset };
}
