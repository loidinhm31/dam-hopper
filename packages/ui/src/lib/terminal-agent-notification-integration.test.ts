import type { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { recordClientDiagnostic } = vi.hoisted(() => ({
  recordClientDiagnostic: vi.fn(),
}));

vi.mock("@/lib/diagnostics-client.js", () => ({
  recordClientDiagnostic,
}));

import { attachTerminalAgentNotifications } from "./terminal-agent-notification-integration.js";
import { useSettingsStore } from "@/stores/settings.js";

type OscHandler = (payload: string) => boolean;

const originalNotification = globalThis.Notification;

function restoreNotificationGlobal(): void {
  if (originalNotification === undefined) {
    Reflect.deleteProperty(globalThis, "Notification");
    return;
  }

  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: originalNotification,
  });
}

function installFakeNotification() {
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

  return created;
}

function createTerminal() {
  let handler: OscHandler | null = null;
  const dispose = vi.fn();
  const term = {
    parser: {
      registerOscHandler: vi.fn((code: number, next: OscHandler) => {
        handler = next;
        return { dispose };
      }),
    },
  } as unknown as Terminal;

  return {
    dispose,
    getHandler: () => handler,
    term,
  };
}

describe("attachTerminalAgentNotifications", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    recordClientDiagnostic.mockReset();
    useSettingsStore.setState({ terminalCodexNotificationsEnabled: true });
  });

  afterEach(() => {
    useSettingsStore.setState({ terminalCodexNotificationsEnabled: false });
    restoreNotificationGlobal();
    vi.useRealTimers();
  });

  it("re-alerts repeated Codex OSC 9 notifications with stable tags", () => {
    const created = installFakeNotification();
    const { term, getHandler, dispose } = createTerminal();
    const integration = attachTerminalAgentNotifications({
      term,
      sessionId: "term-1",
      project: "web",
    });

    expect(term.parser.registerOscHandler).toHaveBeenCalledWith(
      9,
      expect.any(Function),
    );

    const handler = getHandler();
    expect(handler).toBeTypeOf("function");
    expect(handler?.("notify;Codex done;Review the answer")).toBe(true);

    vi.advanceTimersByTime(1_001);
    expect(handler?.("notify;Codex done;Review the answer again")).toBe(true);

    expect(created).toHaveLength(2);
    expect(created[0]).toEqual({
      title: "Codex done",
      options: {
        body: "Review the answer",
        renotify: true,
        tag: "dam-hopper-agent-term-1-osc9",
        timestamp: 1_000,
      },
    });
    expect(created[1]).toEqual({
      title: "Codex done",
      options: {
        body: "Review the answer again",
        renotify: true,
        tag: "dam-hopper-agent-term-1-osc9",
        timestamp: 2_001,
      },
    });

    integration.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("does not deliver OSC 9 notifications when the Codex setting is disabled", () => {
    const created = installFakeNotification();
    useSettingsStore.setState({ terminalCodexNotificationsEnabled: false });
    const { term, getHandler } = createTerminal();

    attachTerminalAgentNotifications({
      term,
      sessionId: "term-2",
      project: "web",
    });

    const handler = getHandler();
    expect(handler).toBeTypeOf("function");
    expect(handler?.("notify;Codex done;Review the answer")).toBe(true);
    expect(created).toHaveLength(0);
  });

  it("adds the current project and open-terminal order to the body", () => {
    const created = installFakeNotification();
    const { term, getHandler } = createTerminal();
    let terminalOrder = 2;

    attachTerminalAgentNotifications({
      term,
      sessionId: "term-3",
      project: "api",
      getTerminalOrder: () => terminalOrder,
    });

    expect(getHandler()?.("notify;Codex done;Review the answer")).toBe(true);
    expect(created[0]?.options.body).toBe(
      "api · Bash #2\nReview the answer",
    );

    vi.advanceTimersByTime(1_001);
    terminalOrder = 4;
    expect(getHandler()?.("notify;Codex done;Review again")).toBe(true);
    expect(created[1]?.options.body).toBe("api · Bash #4\nReview again");
  });
});
