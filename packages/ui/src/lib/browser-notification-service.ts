import {
  sanitizeTerminalNotificationText,
  type TerminalAgentNotification,
} from "./terminal-notification-signal-parser.js";

export type BrowserNotificationPermissionState =
  | NotificationPermission
  | "unsupported";

export interface BrowserNotificationServiceDependencies {
  now?: () => number;
  notificationFactory?: (
    title: string,
    options: NotificationOptions,
  ) => unknown;
  getPermission?: () => BrowserNotificationPermissionState;
  diagnostics?: (message: string, fields?: Record<string, string>) => void;
}

export interface NotifyTerminalAgentOptions {
  enabled?: boolean;
  rateLimitMs?: number;
  terminalOrder?: number;
  onSelect?: (event: TerminalAgentNotification) => void;
}

export interface BrowserNotificationResult {
  delivered: boolean;
  reason?:
    | "disabled"
    | "unsupported"
    | "permission-denied"
    | "permission-default"
    | "rate-limited"
    | "factory-error";
}

type BrowserTerminalNotificationOptions = NotificationOptions & {
  renotify?: boolean;
  timestamp?: number;
};

const DEFAULT_RATE_LIMIT_MS = 30_000;
const MAX_TITLE_LENGTH = 80;
const MAX_BODY_LENGTH = 180;
let defaultBrowserNotificationService: BrowserNotificationService | null = null;

export class BrowserNotificationService {
  private readonly now: () => number;
  private readonly notificationFactory: (
    title: string,
    options: NotificationOptions,
  ) => unknown;
  private readonly getPermission: () => BrowserNotificationPermissionState;
  private readonly diagnostics?: (
    message: string,
    fields?: Record<string, string>,
  ) => void;
  private readonly lastNotificationAt = new Map<string, number>();

  constructor(dependencies: BrowserNotificationServiceDependencies = {}) {
    this.now = dependencies.now ?? (() => Date.now());
    this.notificationFactory =
      dependencies.notificationFactory ?? createBrowserNotification;
    this.getPermission =
      dependencies.getPermission ?? getBrowserNotificationPermissionState;
    this.diagnostics = dependencies.diagnostics;
  }

  notifyTerminalAgent(
    event: TerminalAgentNotification,
    options: NotifyTerminalAgentOptions = {},
  ): BrowserNotificationResult {
    if (options.enabled === false) return this.skip("disabled", event);

    const permission = this.getPermission();
    if (permission === "unsupported")
      return this.skip("unsupported", event, permission);
    if (permission === "denied")
      return this.skip("permission-denied", event, permission);
    if (permission === "default")
      return this.skip("permission-default", event, permission);

    const key = `${event.sessionId}:${event.source}`;
    const currentTime = this.now();
    const lastTime = this.lastNotificationAt.get(key);
    const rateLimitMs = options.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS;
    if (lastTime !== undefined && currentTime - lastTime < rateLimitMs) {
      return this.skip("rate-limited", event, permission);
    }

    try {
      const notificationOptions: BrowserTerminalNotificationOptions = {
        body: buildNotificationBody(event, options.terminalOrder),
        renotify: true,
        tag: `dam-hopper-agent-${event.sessionId}-${event.source}`,
        timestamp: event.receivedAt,
      };

      const notification = this.notificationFactory(
        sanitizeTerminalNotificationText(event.title, MAX_TITLE_LENGTH),
        notificationOptions,
      );
      bindNotificationSelection(notification, event, options.onSelect);
      this.lastNotificationAt.set(key, currentTime);
      return { delivered: true };
    } catch {
      return this.skip("factory-error", event, permission);
    }
  }

  resetTerminalAgentRateLimit(
    sessionId: string,
    source?: TerminalAgentNotification["source"],
  ): void {
    if (source) {
      this.lastNotificationAt.delete(`${sessionId}:${source}`);
      return;
    }

    for (const key of this.lastNotificationAt.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.lastNotificationAt.delete(key);
      }
    }
  }

  private skip(
    reason: NonNullable<BrowserNotificationResult["reason"]>,
    event: TerminalAgentNotification,
    permission?: BrowserNotificationPermissionState,
  ): BrowserNotificationResult {
    const message =
      reason === "factory-error"
        ? "terminal agent notification delivery failed"
        : "terminal agent notification skipped";
    this.diagnostics?.(message, {
      agent: event.agent,
      permission: permission ?? this.getPermission(),
      reason,
      source: event.source,
      sessionId: event.sessionId,
    });
    return { delivered: false, reason };
  }
}

export function getBrowserNotificationPermissionState(): BrowserNotificationPermissionState {
  if (typeof globalThis.Notification === "undefined") return "unsupported";
  return globalThis.Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermissionState> {
  if (typeof globalThis.Notification === "undefined") return "unsupported";

  try {
    return await globalThis.Notification.requestPermission();
  } catch {
    return getBrowserNotificationPermissionState();
  }
}

export function notifyTerminalAgent(
  event: TerminalAgentNotification,
  options: NotifyTerminalAgentOptions &
    BrowserNotificationServiceDependencies = {},
): BrowserNotificationResult {
  const hasCustomDependencies =
    options.now !== undefined ||
    options.notificationFactory !== undefined ||
    options.getPermission !== undefined ||
    options.diagnostics !== undefined;
  const service = hasCustomDependencies
    ? new BrowserNotificationService(options)
    : (defaultBrowserNotificationService ??= new BrowserNotificationService());
  return service.notifyTerminalAgent(event, options);
}

export function __resetDefaultBrowserNotificationServiceForTests(): void {
  defaultBrowserNotificationService = null;
}

function createBrowserNotification(
  title: string,
  options: NotificationOptions,
): Notification {
  return new globalThis.Notification(title, options);
}

function buildNotificationBody(
  event: TerminalAgentNotification,
  terminalOrder: number | undefined,
): string {
  if (!Number.isInteger(terminalOrder) || terminalOrder! < 1) {
    return sanitizeTerminalNotificationText(event.body, MAX_BODY_LENGTH);
  }

  const project = sanitizeTerminalNotificationText(event.project, 60);
  const context = `${project || "Unknown project"} · Bash #${terminalOrder}`;
  const remainingLength = Math.max(
    0,
    MAX_BODY_LENGTH - Array.from(context).length - 1,
  );
  const body = sanitizeTerminalNotificationText(event.body, remainingLength);
  return body ? `${context}\n${body}` : context;
}

function bindNotificationSelection(
  notification: unknown,
  event: TerminalAgentNotification,
  onSelect: NotifyTerminalAgentOptions["onSelect"],
): void {
  if (!onSelect || !notification || typeof notification !== "object") return;

  const target = notification as {
    addEventListener?: (
      type: string,
      listener: () => void,
      options?: AddEventListenerOptions,
    ) => void;
    close?: () => void;
  };
  if (typeof target.addEventListener !== "function") return;

  target.addEventListener(
    "click",
    () => {
      target.close?.();
      onSelect(event);
    },
    { once: true },
  );
}
