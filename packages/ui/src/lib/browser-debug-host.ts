import type {
  BrowserConsoleLevel,
  BrowserSelectionV1,
} from "@dam-hopper/browser-bridge";
import type { BrowserDebugController } from "@/hooks/use-browser-debug.js";
import type { BrowserDebugTarget } from "./browser-debug-origin.js";

export type BrowserDebugBridgeStatus =
  | "idle"
  | "loading"
  | "ready"
  | "unsupported"
  | "error";

/** Capabilities are reported by the host; shared UI must not infer them. */
export type BrowserDebugHostCapability =
  | "picker"
  | "navigation"
  | "console"
  | "capture"
  | "storage-clear";

export type BrowserDebugHostFailureCode =
  | "bridge-unavailable"
  | "navigation-rejected"
  | "relay-rejected";

export type BrowserDebugHostCommand =
  | "start-picker"
  | "stop-picker"
  | "go-back"
  | "go-forward"
  | "reload";

export interface BrowserDebugHostMessage {
  data: unknown;
  origin: string;
  source: unknown;
}

export interface BrowserDebugHostViewport {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type BrowserDebugHostEventPayload =
  | {
      type: "ready";
      capabilities: BrowserDebugHostCapability[];
    }
  | { type: "selection"; selection: BrowserSelectionV1 }
  | { type: "navigation"; url: string }
  | {
      type: "console";
      level: BrowserConsoleLevel;
      message: string;
    }
  | {
      type: "status";
      status: "loading" | "unsupported" | "error";
      code?: BrowserDebugHostFailureCode;
      message?: string;
    };

export type BrowserDebugHostEvent = BrowserDebugHostEventPayload & {
  generation: number;
};

/**
 * Lifecycle contract for a host-owned browser surface. Tauri implements this
 * contract later; the web adapter remains the default implementation.
 */
export interface BrowserDebugHost {
  setTarget(target: BrowserDebugTarget | null): void;
  setViewport(viewport: BrowserDebugHostViewport | null): void;
  command(command: BrowserDebugHostCommand): void;
  subscribe(listener: (event: BrowserDebugHostEvent) => void): () => void;
  destroy(): void;
}

export function acceptBrowserDebugHostEventGeneration(
  currentGeneration: number | null,
  event: BrowserDebugHostEvent,
): { accepted: boolean; generation: number } {
  if (currentGeneration === null)
    return { accepted: true, generation: event.generation };
  if (event.type === "status" && event.status === "loading") {
    return event.generation > currentGeneration
      ? { accepted: true, generation: event.generation }
      : { accepted: false, generation: currentGeneration };
  }
  return event.generation === currentGeneration
    ? { accepted: true, generation: currentGeneration }
    : { accepted: false, generation: currentGeneration };
}

/** Applies host-neutral events to the existing Browser controller state. */
export function applyBrowserDebugHostEvent(
  browser: Pick<
    BrowserDebugController,
    | "setBridgeStatus"
    | "setBridgeCapabilities"
    | "setSelection"
    | "setPickerActive"
    | "syncCurrentUrl"
    | "appendConsoleEntry"
    | "setError"
  >,
  event: BrowserDebugHostEvent,
): void {
  switch (event.type) {
    case "ready":
      browser.setBridgeStatus("ready");
      browser.setBridgeCapabilities(event.capabilities);
      browser.setError(null);
      return;
    case "status":
      browser.setBridgeStatus(event.status);
      if (event.message !== undefined) browser.setError(event.message);
      return;
    case "selection":
      browser.setSelection(event.selection);
      browser.setPickerActive(false);
      return;
    case "navigation":
      browser.syncCurrentUrl(event.url);
      return;
    case "console":
      browser.appendConsoleEntry({
        level: event.level,
        message: event.message,
      });
      return;
  }
}
