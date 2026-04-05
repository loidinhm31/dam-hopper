/**
 * Transport interface — abstracts IPC (Electron) and WebSocket + REST (web mode).
 *
 * Detection: window.devhub present → IpcTransport (Electron), absent → WsTransport (browser).
 *
 * initTransport() is called once in main.tsx before React renders.
 * All other modules use getTransport() to get the singleton.
 */

export interface Transport {
  /** Request/response — maps to ipcMain.handle (IPC) or fetch (REST) */
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

/**
 * Initialize transport. Called once at app boot (main.tsx).
 * Must be called before getTransport().
 */
export function initTransport(transport: Transport): void {
  _transport = transport;
}

/** Get the initialized transport singleton. */
export function getTransport(): Transport {
  if (!_transport) throw new Error("Transport not initialized. Call initTransport() first.");
  return _transport;
}

/** Reset for testing. */
export function resetTransport(): void {
  _transport = null;
}

/** Detect which transport to use. */
export function isWebMode(): boolean {
  return typeof window === "undefined" || !(window as { devhub?: unknown }).devhub;
}
