/**
 * Transport interface — abstracts WebSocket + REST communication with the backend.
 *
 * initTransport() is called once in main.tsx before React renders.
 * All other modules use getTransport() to get the singleton.
 */

export interface Transport {
  /** Request/response — maps to fetch (REST) */
  invoke<T>(channel: string, data?: unknown): Promise<T>;

  /** Terminal data stream subscription. Returns unsubscribe fn. */
  onTerminalData(id: string, cb: (data: string) => void): () => void;

  /** Terminal exit subscription. Returns unsubscribe fn. */
  onTerminalExit(id: string, cb: (exitCode: number | null) => void): () => void;

  /** Push event subscription (git:progress, workspace:changed, etc.) */
  onEvent(channel: string, cb: (payload: unknown) => void): () => void;

  /** Fire-and-forget terminal stdin write */
  terminalWrite(id: string, data: string): void;

  /** Fire-and-forget terminal resize */
  terminalResize(id: string, cols: number, rows: number): void;
}

let _transport: Transport | null = null;

export function initTransport(transport: Transport): void {
  _transport = transport;
}

export function getTransport(): Transport {
  if (!_transport) throw new Error("Transport not initialized. Call initTransport() first.");
  return _transport;
}

/**
 * Replace the active transport with a new instance.
 * Caller is responsible for destroying the old transport to avoid WS leaks.
 * Use with resetTransportListeners() from useSSE.ts to re-register push event handlers.
 */
export function reconfigureTransport(transport: Transport): void {
  _transport = transport;
}

/** Reset for testing. */
export function resetTransport(): void {
  _transport = null;
}
