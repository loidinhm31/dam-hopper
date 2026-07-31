import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { parseBrowserBridgeEvent } from "@dam-hopper/browser-bridge";
import { getActiveProfileId } from "@dam-hopper/ui/api/server-config";
import type {
  BrowserDebugHost,
  BrowserDebugHostCapability,
  BrowserDebugHostCommand,
  BrowserDebugHostEvent,
  BrowserDebugHostEventPayload,
  BrowserDebugHostViewport,
} from "@/lib/browser-debug-host";
import type { BrowserDebugTarget } from "@/lib/browser-debug-origin";

const RELAY_EVENT = "browser-debug:relay";
const RELAY_REJECTED_EVENT = "browser-debug:relay-rejected";
const CHILD_LABEL = "browser-debug";
const MAX_PENDING_RELAYS = 8;

const NATIVE_COMMANDS: Record<BrowserDebugHostCommand, string> = {
  "start-picker": "dam-hopper:start-picker",
  "stop-picker": "dam-hopper:stop-picker",
  "go-back": "dam-hopper:go-back",
  "go-forward": "dam-hopper:go-forward",
  reload: "dam-hopper:reload",
};

export interface NativeBrowserDebugState {
  label: string;
  profileId: string;
  sessionId: string;
  committedUrl: string;
  committedOrigin: string;
  generation: number;
  visible: boolean;
  relayInstalled: boolean;
}

interface NativeRelayEvent {
  label: string;
  profileId: string;
  sessionId: string;
  generation: number;
  origin: string;
  data: unknown;
}

interface NativeRelayRejectedEvent {
  label: string;
  profileId: string;
  sessionId: string;
  generation: number;
  reason: string;
}

function boundsOrZero(viewport: BrowserDebugHostViewport | null) {
  if (!viewport) return { top: 0, left: 0, width: 0, height: 0 };
  return {
    top: Math.max(0, viewport.top),
    left: Math.max(0, viewport.left),
    width: Math.max(0, viewport.width),
    height: Math.max(0, viewport.height),
  };
}

export function bridgeEventToHostEvent(
  relay: NativeRelayEvent,
  target: BrowserDebugTarget,
  generation: number,
  profileId: string,
  sessionId: string,
): BrowserDebugHostEvent | null {
  if (
    relay.label !== CHILD_LABEL ||
    relay.profileId !== profileId ||
    relay.sessionId !== sessionId ||
    relay.origin !== target.origin ||
    !Number.isSafeInteger(relay.generation) ||
    relay.generation < 0
  ) {
    return null;
  }

  const event = parseBrowserBridgeEvent(relay.data);
  if (!event) return null;

  let payload: BrowserDebugHostEventPayload;
  switch (event.type) {
    case "dam-hopper:bridge-ready":
      payload = {
        type: "ready",
        capabilities: [
          "picker",
          ...(event.capabilities ?? []),
        ] as BrowserDebugHostCapability[],
      };
      break;
    case "dam-hopper:selection":
      payload = { type: "selection", selection: event.selection };
      break;
    case "dam-hopper:navigation":
      payload = { type: "navigation", url: event.url };
      break;
    case "dam-hopper:console":
      payload = {
        type: "console",
        level: event.level,
        message: event.message,
      };
      break;
    case "dam-hopper:error":
      payload = {
        type: "status",
        status: "error",
        message: event.message,
      };
      break;
    default:
      return null;
  }

  return { ...payload, generation };
}

export class NativeBrowserDebugHost implements BrowserDebugHost {
  private target: BrowserDebugTarget | null = null;
  private profileId: string | null = null;
  private viewport: BrowserDebugHostViewport | null = null;
  private state: NativeBrowserDebugState | null = null;
  private pendingRelays: NativeRelayEvent[] = [];
  private generation = 0;
  private operation = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<
    (event: BrowserDebugHostEvent) => void
  >();
  private listenPromise: Promise<void> | null = null;
  private unlisteners: UnlistenFn[] = [];
  private disposed = false;

  constructor() {
    void this.ensureListeners();
  }

  setTarget(target: BrowserDebugTarget | null): void {
    if (this.disposed) return;
    if (
      target &&
      this.target?.url === target.url &&
      this.target.origin === target.origin &&
      this.profileId === getActiveProfileId()
    ) {
      return;
    }

    const operation = ++this.operation;
    const generation = ++this.generation;
    const profileId = target ? getActiveProfileId() : null;
    this.target = target;
    this.profileId = profileId;
    this.state = null;
    this.pendingRelays = [];
    this.enqueue(async () => {
      if (!(await this.ensureListeners())) return;
      try {
        await invoke<void>("browser_debug_destroy");
      } catch (error) {
        if (this.isCurrent(operation)) {
          this.emit({
            type: "status",
            status: "error",
            message: errorMessage(
              error,
              "Native Browser Debug could not close its previous child.",
            ),
            code: "bridge-unavailable",
            generation,
          });
        }
        return;
      }
      if (!this.isCurrent(operation)) return;
      if (!target) return;

      if (!profileId) {
        this.emit({
          type: "status",
          status: "error",
          message: "Select a server profile before opening Browser Debug.",
          code: "bridge-unavailable",
          generation,
        });
        return;
      }

      this.emit({ type: "status", status: "loading", generation });
      try {
        const state = await invoke<NativeBrowserDebugState>(
          "browser_debug_create",
          {
            input: {
              profileId,
              url: target.url,
              allowedTunnelOrigins:
                target.source === "tunnel" ? [target.origin] : [],
              bounds: boundsOrZero(this.viewport),
              visible: this.viewport !== null,
            },
          },
        );
        if (!this.isCurrent(operation)) {
          await invoke<void>("browser_debug_destroy").catch(() => {});
          return;
        }
        this.state = state;
        this.flushPendingRelays();
        if (!state.relayInstalled) {
          await invoke<void>("browser_debug_destroy").catch(() => {});
          this.state = null;
          this.emit({
            type: "status",
            status: "unsupported",
            message:
              "The native Browser Debug child compiled, but this platform's relay engine is experimental and unverified.",
            code: "bridge-unavailable",
            generation,
          });
          return;
        }
        await this.applyViewport(operation);
      } catch (error) {
        if (!this.isCurrent(operation)) return;
        this.emit({
          type: "status",
          status: "error",
          message: errorMessage(error, "Native Browser Debug could not start."),
          code: "bridge-unavailable",
          generation,
        });
      }
    });
  }

  setViewport(viewport: BrowserDebugHostViewport | null): void {
    if (this.disposed) return;
    this.viewport = viewport;
    const operation = this.operation;
    if (!this.state || !this.target) return;
    this.enqueue(async () => {
      if (!this.isCurrent(operation)) return;
      try {
        await this.applyViewport(operation);
      } catch (error) {
        if (!this.isCurrent(operation)) return;
        this.emit({
          type: "status",
          status: "error",
          message: errorMessage(error, "Native Browser Debug geometry failed."),
          code: "bridge-unavailable",
          generation: this.generation,
        });
      }
    });
  }

  command(command: BrowserDebugHostCommand): void {
    if (this.disposed) return;
    const operation = this.operation;
    this.enqueue(async () => {
      if (!this.isCurrent(operation) || !this.state) return;
      try {
        await invoke<void>("browser_debug_command", {
          command: NATIVE_COMMANDS[command],
        });
      } catch (error) {
        if (!this.isCurrent(operation)) return;
        this.emit({
          type: "status",
          status: "error",
          message: errorMessage(error, "Native Browser Debug command failed."),
          code: "navigation-rejected",
          generation: this.generation,
        });
      }
    });
  }

  subscribe(listener: (event: BrowserDebugHostEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    const operation = ++this.operation;
    ++this.generation;
    this.target = null;
    this.profileId = null;
    this.state = null;
    this.pendingRelays = [];
    this.enqueue(async () => {
      if (operation !== this.operation) return;
      await invoke<void>("browser_debug_destroy").catch(() => {});
    });
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task, task);
  }

  private isCurrent(operation: number): boolean {
    return operation === this.operation;
  }

  private async applyViewport(operation: number): Promise<void> {
    if (!this.state || !this.target || !this.isCurrent(operation)) return;
    const viewport = this.viewport;
    await invoke<void>("browser_debug_set_bounds", {
      bounds: boundsOrZero(viewport),
    });
    if (!this.isCurrent(operation)) return;
    await invoke<void>("browser_debug_set_visible", {
      visible: viewport !== null,
    });
  }

  private async ensureListeners(): Promise<boolean> {
    if (this.disposed) return false;
    if (!this.listenPromise) {
      this.listenPromise = (async () => {
        const unlisteners: UnlistenFn[] = [];
        try {
          unlisteners.push(
            await listen<NativeRelayEvent>(RELAY_EVENT, (event) => {
              this.handleRelay(event.payload);
            }),
          );
          unlisteners.push(
            await listen<NativeRelayRejectedEvent>(
              RELAY_REJECTED_EVENT,
              (event) => {
                this.handleRelayRejected(event.payload);
              },
            ),
          );
          if (this.disposed) {
            for (const unlisten of unlisteners) unlisten();
          } else {
            this.unlisteners = unlisteners;
          }
        } catch (error) {
          for (const unlisten of unlisteners) unlisten();
          throw error;
        }
      })();
    }
    const pending = this.listenPromise;
    try {
      await pending;
      return !this.disposed && this.unlisteners.length === 2;
    } catch (error) {
      if (this.listenPromise === pending) this.listenPromise = null;
      if (!this.disposed && this.target) {
        this.emit({
          type: "status",
          status: "error",
          code: "bridge-unavailable",
          message: errorMessage(
            error,
            "Native Browser Debug event relay is unavailable.",
          ),
          generation: this.generation,
        });
      }
      return false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.destroy();
    for (const unlisten of this.unlisteners) unlisten();
    this.unlisteners = [];
    this.listenPromise = null;
  }

  private handleRelay(relay: NativeRelayEvent): void {
    const target = this.target;
    const state = this.state;
    if (!target) return;
    if (!state) {
      if (
        relay.label === CHILD_LABEL &&
        relay.profileId === this.profileId &&
        relay.origin === target.origin
      ) {
        if (this.pendingRelays.length < MAX_PENDING_RELAYS)
          this.pendingRelays.push(relay);
      }
      return;
    }
    if (
      relay.profileId !== state.profileId ||
      relay.sessionId !== state.sessionId ||
      relay.generation < state.generation
    )
      return;
    if (relay.generation > state.generation) {
      this.state = {
        ...state,
        generation: relay.generation,
        committedOrigin: relay.origin,
      };
    }
    const event = bridgeEventToHostEvent(
      relay,
      target,
      this.generation,
      state.profileId,
      state.sessionId,
    );
    if (event) this.emit(event);
  }

  private flushPendingRelays(): void {
    const relays = this.pendingRelays;
    this.pendingRelays = [];
    for (const relay of relays) this.handleRelay(relay);
  }

  private handleRelayRejected(relay: NativeRelayRejectedEvent): void {
    if (
      relay.label !== CHILD_LABEL ||
      !this.target ||
      !this.state ||
      relay.profileId !== this.state.profileId ||
      relay.sessionId !== this.state.sessionId ||
      relay.generation !== this.state.generation
    )
      return;
    this.emit({
      type: "status",
      status: "error",
      code: "relay-rejected",
      message: `Native Browser Debug rejected a bridge event (${relay.reason}).`,
      generation: this.generation,
    });
  }

  private emit(event: BrowserDebugHostEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function isNativeBrowserDebugEnabled(value: unknown): boolean {
  return value !== "0" && value !== "false";
}

export function getNativeBrowserDebugEnvironment(
  platform: string,
  enabled = true,
) {
  return {
    kind: enabled ? ("native" as const) : ("web" as const),
    platform,
    experimental: enabled && platform !== "windows",
  };
}
