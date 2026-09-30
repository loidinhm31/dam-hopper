import {
  type TerminalStreamReplayGate,
  beginTerminalReplayWrite,
  finishTerminalReplayWrite,
  notifyTerminalReplayDrain,
} from "./terminal-stream-replay-gate.js";

export interface TerminalBufferReplay {
  data: string;
  offset: number;
  reset: boolean;
  truncated: boolean;
  incarnation: number;
}

export interface TerminalReplayTarget {
  reset(): void;
  write(data: string, callback?: () => void): void;
}

export function applyTerminalBufferReplay(
  term: TerminalReplayTarget,
  replay: TerminalBufferReplay,
  onComplete?: () => void,
  gate?: TerminalStreamReplayGate,
): number {
  if (gate) {
    beginTerminalReplayWrite(gate);
  }

  const finish = () => {
    if (gate) {
      finishTerminalReplayWrite(gate);
    }
    try {
      onComplete?.();
    } finally {
      if (gate) {
        notifyTerminalReplayDrain(gate);
      }
    }
  };

  if (replay.reset) {
    term.write("", () => {
      term.reset();
      term.write(replay.data, finish);
    });
  } else {
    term.write(replay.data, finish);
  }
  return replay.offset;
}
