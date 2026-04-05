/** Transport-agnostic interface for routing PTY events. */
export interface EventSink {
  sendTerminalData(sessionId: string, data: string): void;
  sendTerminalExit(sessionId: string, exitCode: number | null): void;
  sendTerminalChanged(): void;
}
