export interface TerminalBufferReplay {
  data: string;
  offset: number;
  reset: boolean;
  truncated: boolean;
}

export interface TerminalReplayTarget {
  clear(): void;
  write(data: string, callback?: () => void): void;
}

export function utf8ByteLength(data: string): number {
  return new TextEncoder().encode(data).length;
}

export function applyTerminalBufferReplay(
  term: TerminalReplayTarget,
  replay: TerminalBufferReplay,
  onComplete?: () => void,
): number {
  if (replay.reset) {
    term.clear();
  }
  if (onComplete) {
    term.write(replay.data, onComplete);
  } else {
    term.write(replay.data);
  }
  return replay.offset;
}
