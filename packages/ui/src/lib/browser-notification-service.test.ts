import { describe, expect, it, vi } from "vitest";
import {
  BrowserNotificationService,
  notifyTerminalAgent,
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
      tag: "dam-hopper-agent-s1-quiet",
    });
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
      expect(notifyTerminalAgent({ ...event, sessionId: "helper-s1" })).toEqual({
        delivered: true,
      });
      expect(notifyTerminalAgent({ ...event, sessionId: "helper-s1" })).toEqual({
        delivered: false,
        reason: "rate-limited",
      });
      expect(created).toHaveLength(1);
    } finally {
      Object.defineProperty(globalThis, "Notification", {
        configurable: true,
        value: originalNotification,
      });
    }
  });
});
