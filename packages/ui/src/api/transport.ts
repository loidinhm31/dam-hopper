/**
 * Transport interface — abstracts WebSocket + REST communication with the backend.
 *
 * initTransport() is called once in main.tsx before React renders.
 * All other modules use getTransport() to get the singleton.
 */

import type {
  BrowserDebugArtifactResponse,
  TerminalLifecycleEvent,
} from "./client.js";

export interface Transport {
  /** Request/response — maps to fetch (REST) */
  invoke<T>(channel: string, data?: unknown): Promise<T>;

  /** Terminal data stream subscription. Returns unsubscribe fn. */
  onTerminalData(id: string, cb: (data: string) => void): () => void;

  /** Terminal exit subscription. Returns unsubscribe fn. */
  onTerminalExit(id: string, cb: (exitCode: number | null) => void): () => void;

  /** Terminal exit subscription with restart metadata (optional, not all transports support). */
  onTerminalExitEnhanced?(
    id: string,
    cb: (exit: {
      exitCode: number | null;
      willRestart: boolean;
      restartIn?: number;
      restartCount?: number;
    }) => void,
  ): () => void;

  /** Verified shell lifecycle subscription (optional for non-WS transports). */
  onTerminalLifecycle?(
    id: string,
    cb: (event: TerminalLifecycleEvent) => void,
  ): () => void;

  /** Process restart subscription (optional, not all transports support). */
  onProcessRestarted?(
    id: string,
    cb: (restart: {
      restartCount: number;
      previousExitCode: number | null;
    }) => void,
  ): () => void;

  /** FS overflow subscription (optional, not all transports support). */
  onFsOverflow?(sub_id: number, cb: (message: string) => void): () => void;

  /** Push event subscription (git:progress, workspace:changed, etc.) */
  onEvent(channel: string, cb: (payload: unknown) => void): () => void;

  /** Fire-and-forget terminal stdin write */
  terminalWrite(id: string, data: string): void;

  /** Fire-and-forget terminal resize */
  terminalResize(id: string, cols: number, rows: number): void;

  /** Authenticated binary upload for a browser-debug screenshot. */
  uploadBrowserDebugPng?(
    artifactId: string,
    png: Blob,
  ): Promise<BrowserDebugArtifactResponse>;

  /** Terminal attach for reconnect with buffer replay. Return false if not sent. */
  terminalAttach?(id: string, fromOffset?: number): boolean | void;

  /** Terminal buffer subscription (response to terminal:attach). Returns unsubscribe fn. */
  onTerminalBuffer?(
    id: string,
    cb: (buffer: {
      data: string;
      offset: number;
      reset: boolean;
      truncated: boolean;
    }) => void,
  ): () => void;

  /** Connection status subscription. Returns unsubscribe fn. */
  onStatusChange?(cb: (status: string) => void): () => void;
}

let _transport: Transport | null = null;
let _transportGeneration = 0;
const transportChangeListeners = new Set<() => void>();

function notifyTransportChange(): void {
  _transportGeneration += 1;
  transportChangeListeners.forEach((listener) => listener());
}

export function initTransport(transport: Transport): void {
  _transport = transport;
  notifyTransportChange();
}

export function getTransport(): Transport {
  if (!_transport)
    throw new Error("Transport not initialized. Call initTransport() first.");
  return _transport;
}

/**
 * Replace the active transport with a new instance.
 * Caller is responsible for destroying the old transport to avoid WS leaks.
 * Use with resetTransportListeners() from use-sse.ts to re-register push event handlers.
 */
export function reconfigureTransport(transport: Transport): void {
  _transport = transport;
  notifyTransportChange();
}

/** Snapshot used by React consumers that must rebind to a replacement transport. */
export function getTransportGeneration(): number {
  return _transportGeneration;
}

/** Subscribe to transport replacement events. */
export function subscribeTransportChanges(callback: () => void): () => void {
  transportChangeListeners.add(callback);
  return () => transportChangeListeners.delete(callback);
}

/** Reset for testing. */
export function resetTransport(): void {
  _transport = null;
  notifyTransportChange();
}
