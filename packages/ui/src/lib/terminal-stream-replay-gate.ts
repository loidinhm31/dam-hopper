export interface TerminalStreamReplayGate {
  hasAttachBufferBeenReceived: boolean;
  isReplayWriting: boolean;
  isLiveStreamReady: boolean;
  replayGeneration: number;
  queuedLiveData: string[];
}

export function createTerminalStreamReplayGate(): TerminalStreamReplayGate {
  return {
    hasAttachBufferBeenReceived: false,
    isReplayWriting: false,
    isLiveStreamReady: false,
    replayGeneration: 0,
    queuedLiveData: [],
  };
}

export function resetTerminalStreamReplayGateForAttach(
  gate: TerminalStreamReplayGate,
): void {
  gate.hasAttachBufferBeenReceived = false;
  gate.isReplayWriting = false;
  gate.isLiveStreamReady = false;
  gate.replayGeneration += 1;
  gate.queuedLiveData.length = 0;
}
