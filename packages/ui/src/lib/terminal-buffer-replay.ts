export interface TerminalBufferReplay {
  data: string;
  offset: number;
  reset: boolean;
  truncated: boolean;
}

export interface TerminalReplayTarget {
  clear(): void;
  write(data: string): void;
}

export function utf8ByteLength(data: string): number {
  return new TextEncoder().encode(data).length;
}

export function applyTerminalBufferReplay(
  term: TerminalReplayTarget,
  replay: TerminalBufferReplay,
): number {
  if (replay.reset) {
    term.clear();
  }
  term.write(replay.data);
  return replay.offset;
}
