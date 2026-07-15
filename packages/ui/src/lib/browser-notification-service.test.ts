import { describe, expect, it, vi } from "vitest";
import {
  __resetDefaultBrowserNotificationServiceForTests,
  BrowserNotificationService,
  getBrowserNotificationPermissionState,
  notifyTerminalAgent,
  requestBrowserNotificationPermission,
} from "./browser-notification-service.js";
import type { TerminalAgentNotification } from "./terminal-notification-signal-parser.js";

const event: TerminalAgentNotification = {
  source: "quiet",
  sessionId: "s1",
  project: "web",
  agent: "codex",
  title: "Codex may need attention",
  body: "No terminal output for 30s in web.",
  status: "needs-attention",
  receivedAt: 1,
};

function restoreNotificationGlobal(
  originalNotification: typeof globalThis.Notification,
): void {
  if (originalNotification === undefined) {
    Reflect.deleteProperty(globalThis, "Notification");
    return;
  }

  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: originalNotification,
  });
}

describe("BrowserNotificationService", () => {
  it("no-ops when notifications are disabled or permission is not granted", () => {
    const factory = vi.fn();
    const service = new BrowserNotificationService({
      notificationFactory: factory,
      getPermission: () => "denied",
    });

    expect(service.notifyTerminalAgent(event, { enabled: false })).toEqual({
      delivered: false,
      reason: "disabled",
    });
    expect(service.notifyTerminalAgent(event)).toEqual({
      delivered: false,
      reason: "permission-denied",
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it("no-ops when the Notification API is unsupported", () => {
    const factory = vi.fn();
    const diagnostics = vi.fn();
    const service = new BrowserNotificationService({
      notificationFactory: factory,
      diagnostics,
      getPermission: () => "unsupported",
    });

    expect(service.notifyTerminalAgent(event)).toEqual({
      delivered: false,
      reason: "unsupported",
    });
    expect(factory).not.toHaveBeenCalled();
    expect(diagnostics).toHaveBeenCalledWith(
      "terminal agent notification skipped",
      expect.objectContaining({
        permission: "unsupported",
        reason: "unsupported",
      }),
    );
  });

  it("delivers sanitized browser notifications with stable tags", () => {
    const factory = vi.fn();
    const service = new BrowserNotificationService({
      notificationFactory: factory,
      getPermission: () => "granted",
      now: () => 1000,
    });

    expect(
      service.notifyTerminalAgent({
        ...event,
        title: "Codex\x1b[31m done",
        body: "Needs\x07 attention",
      }),
    ).toEqual({ delivered: true });
    expect(factory).toHaveBeenCalledWith("Codex done", {
      body: "Needs attention",
      renotify: true,
      tag: "dam-hopper-agent-s1-quiet",
      timestamp: 1,
    });
  });

  it("shows terminal context and navigates when the notification is selected", () => {
    let clickListener: (() => void) | undefined;
    const close = vi.fn();
    const factory = vi.fn(() => ({
      addEventListener: vi.fn(
        (type: string, listener: () => void, options?: AddEventListenerOptions) => {
          expect(type).toBe("click");
          expect(options).toEqual({ once: true });
          clickListener = listener;
        },
      ),
      close,
    }));
    const onSelect = vi.fn();
    const service = new BrowserNotificationService({
      notificationFactory: factory,
      getPermission: () => "granted",
      now: () => 1000,
    });

    expect(
      service.notifyTerminalAgent(event, { terminalOrder: 3, onSelect }),
    ).toEqual({ delivered: true });
    expect(factory).toHaveBeenCalledWith("Codex may need attention", {
      body: "web · Bash #3\nNo terminal output for 30s in web.",
      renotify: true,
      tag: "dam-hopper-agent-s1-quiet",
      timestamp: 1,
    });

    clickListener?.();
    expect(close).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(event);
  });

  it("uses the notification source in the browser tag for TUI-ready events", () => {
    const factory = vi.fn();
    const service = new BrowserNotificationService({
      notificationFactory: factory,
      getPermission: () => "granted",
      now: () => 1000,
    });

    expect(
      service.notifyTerminalAgent({
        ...event,
        source: "tui-ready",
        title: "Codex is ready",
      }),
    ).toEqual({ delivered: true });
    expect(factory).toHaveBeenCalledWith("Codex is ready", {
      body: "No terminal output for 30s in web.",
      renotify: true,
      tag: "dam-hopper-agent-s1-tui-ready",
      timestamp: 1,
    });
  });

  it("re-alerts repeated stable-tag notifications after the rate limit window", () => {
    const factory = vi.fn();
    let now = 0;
    const service = new BrowserNotificationService({
      notificationFactory: factory,
      getPermission: () => "granted",
      now: () => now,
    });

    expect(
      service.notifyTerminalAgent({
        ...event,
        source: "osc9",
        receivedAt: 100,
      }),
    ).toEqual({ delivered: true });
    now = 31_000;
    expect(
      service.notifyTerminalAgent({
        ...event,
        source: "osc9",
        receivedAt: 31_100,
      }),
    ).toEqual({ delivered: true });

    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenNthCalledWith(
      1,
      "Codex may need attention",
      expect.objectContaining({
        renotify: true,
        tag: "dam-hopper-agent-s1-osc9",
        timestamp: 100,
      }),
    );
    expect(factory).toHaveBeenNthCalledWith(
      2,
      "Codex may need attention",
      expect.objectContaining({
        renotify: true,
        tag: "dam-hopper-agent-s1-osc9",
        timestamp: 31_100,
      }),
    );
  });

  it("rate-limits repeated notifications per session and source", () => {
    const factory = vi.fn();
    let now = 0;
    const service = new BrowserNotificationService({
      notificationFactory: factory,
      getPermission: () => "granted",
      now: () => now,
    });

    expect(service.notifyTerminalAgent(event)).toEqual({ delivered: true });
    now = 10_000;
    expect(service.notifyTerminalAgent(event)).toEqual({
      delivered: false,
      reason: "rate-limited",
    });
    now = 31_000;
    expect(service.notifyTerminalAgent(event)).toEqual({ delivered: true });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("allows callers to disable rate limiting explicitly", () => {
    const factory = vi.fn();
    let now = 0;
    const service = new BrowserNotificationService({
      notificationFactory: factory,
      getPermission: () => "granted",
      now: () => now,
    });

    expect(service.notifyTerminalAgent(event, { rateLimitMs: 0 })).toEqual({
      delivered: true,
    });
    now = 10_000;
    expect(service.notifyTerminalAgent(event, { rateLimitMs: 0 })).toEqual({
      delivered: true,
    });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("allows callers to reset rate limits when output resumes", () => {
    const factory = vi.fn();
    let now = 0;
    const service = new BrowserNotificationService({
      notificationFactory: factory,
      getPermission: () => "granted",
      now: () => now,
    });

    expect(service.notifyTerminalAgent(event)).toEqual({ delivered: true });
    now = 5_000;
    service.resetTerminalAgentRateLimit("s1", "quiet");
    expect(service.notifyTerminalAgent(event)).toEqual({ delivered: true });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("does not reset other notification sources when quiet tracking resumes", () => {
    const factory = vi.fn();
    let now = 0;
    const service = new BrowserNotificationService({
      notificationFactory: factory,
      getPermission: () => "granted",
      now: () => now,
    });

    expect(
      service.notifyTerminalAgent({
        ...event,
        source: "osc9",
        sessionId: "s2",
      }),
    ).toEqual({ delivered: true });
    now = 5_000;
    service.resetTerminalAgentRateLimit("s2", "quiet");
    expect(
      service.notifyTerminalAgent({
        ...event,
        source: "osc9",
        sessionId: "s2",
      }),
    ).toEqual({
      delivered: false,
      reason: "rate-limited",
    });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("records structured diagnostics for skipped and failed delivery", () => {
    const diagnostics = vi.fn();
    const service = new BrowserNotificationService({
      diagnostics,
      getPermission: () => "default",
      notificationFactory: () => {
        throw new Error("boom");
      },
    });

    expect(service.notifyTerminalAgent(event)).toEqual({
      delivered: false,
      reason: "permission-default",
    });
    expect(diagnostics).toHaveBeenCalledWith(
      "terminal agent notification skipped",
      expect.objectContaining({
        agent: "codex",
        permission: "default",
        reason: "permission-default",
        sessionId: "s1",
        source: "quiet",
      }),
    );

    diagnostics.mockClear();
    const failingService = new BrowserNotificationService({
      diagnostics,
      getPermission: () => "granted",
      notificationFactory: () => {
        throw new Error("boom");
      },
    });
    expect(failingService.notifyTerminalAgent(event)).toEqual({
      delivered: false,
      reason: "factory-error",
    });
    expect(diagnostics).toHaveBeenCalledWith(
      "terminal agent notification delivery failed",
      expect.objectContaining({
        agent: "codex",
        permission: "granted",
        reason: "factory-error",
      }),
    );
  });

  it("rate-limits through the exported helper for normal callers", () => {
    __resetDefaultBrowserNotificationServiceForTests();
    const originalNotification = globalThis.Notification;
    const created: Array<{ title: string; options: NotificationOptions }> = [];
    class FakeNotification {
      static permission: NotificationPermission = "granted";
      static requestPermission = vi.fn();

      constructor(title: string, options: NotificationOptions) {
        created.push({ title, options });
      }
    }

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: FakeNotification,
    });

    try {
      expect(notifyTerminalAgent({ ...event, sessionId: "helper-s1" })).toEqual(
        {
          delivered: true,
        },
      );
      expect(notifyTerminalAgent({ ...event, sessionId: "helper-s1" })).toEqual(
        {
          delivered: false,
          reason: "rate-limited",
        },
      );
      expect(created).toHaveLength(1);
    } finally {
      __resetDefaultBrowserNotificationServiceForTests();
      restoreNotificationGlobal(originalNotification);
    }
  });
});

describe("browser notification permission helpers", () => {
  it("reports unsupported when Notification is unavailable", () => {
    const originalNotification = globalThis.Notification;
    Reflect.deleteProperty(globalThis, "Notification");

    try {
      expect(getBrowserNotificationPermissionState()).toBe("unsupported");
    } finally {
      restoreNotificationGlobal(originalNotification);
    }
  });

  it("returns unsupported when permission is requested without Notification support", async () => {
    const originalNotification = globalThis.Notification;
    Reflect.deleteProperty(globalThis, "Notification");

    try {
      await expect(requestBrowserNotificationPermission()).resolves.toBe(
        "unsupported",
      );
    } finally {
      restoreNotificationGlobal(originalNotification);
    }
  });

  it("requests permission successfully when supported", async () => {
    const originalNotification = globalThis.Notification;
    const requestPermission = vi.fn(async () => "granted" as const);

    class FakeNotification {
      static permission: NotificationPermission = "default";
      static requestPermission = requestPermission;
    }

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: FakeNotification,
    });

    try {
      await expect(requestBrowserNotificationPermission()).resolves.toBe(
        "granted",
      );
      expect(requestPermission).toHaveBeenCalledTimes(1);
    } finally {
      restoreNotificationGlobal(originalNotification);
    }
  });

  it("requests permission and falls back to current state on request errors", async () => {
    const originalNotification = globalThis.Notification;

    class FakeNotification {
      static permission: NotificationPermission = "default";
      static async requestPermission(): Promise<NotificationPermission> {
        throw new Error("blocked");
      }
    }

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: FakeNotification,
    });

    try {
      await expect(requestBrowserNotificationPermission()).resolves.toBe(
        "default",
      );
    } finally {
      restoreNotificationGlobal(originalNotification);
    }
  });
});
