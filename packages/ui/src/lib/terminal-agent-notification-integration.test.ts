import type { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { playTerminalNotificationSound, recordClientDiagnostic } = vi.hoisted(() => ({
  playTerminalNotificationSound: vi.fn(),
  recordClientDiagnostic: vi.fn(),
}));

vi.mock("@/lib/diagnostics-client.js", () => ({
  recordClientDiagnostic,
}));

vi.mock("@/lib/terminal-notification-sound.js", () => ({
  playTerminalNotificationSound,
}));

import { attachTerminalAgentNotifications } from "./terminal-agent-notification-integration.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useTerminalNotificationsStore } from "@/stores/terminal-notifications.js";

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
    playTerminalNotificationSound.mockReset();
    useSettingsStore.setState({
      terminalCodexNotificationsEnabled: true,
      terminalCodexNotificationSoundEnabled: true,
      terminalCodexNotificationSoundVolume: 100,
    });
    useTerminalNotificationsStore.setState({ notifications: [], toasts: [] });
  });

  afterEach(() => {
    useSettingsStore.setState({
      terminalCodexNotificationsEnabled: false,
      terminalCodexNotificationSoundEnabled: true,
      terminalCodexNotificationSoundVolume: 100,
    });
    useTerminalNotificationsStore.setState({ notifications: [], toasts: [] });
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
    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(
      2,
    );
    expect(playTerminalNotificationSound).toHaveBeenCalledTimes(2);
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
    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(
      0,
    );
    expect(playTerminalNotificationSound).not.toHaveBeenCalled();
  });

  it("delivers in-app when native browser notifications are denied", () => {
    installFakeNotification();
    useSettingsStore.setState({ terminalCodexNotificationSoundVolume: 45 });
    Object.defineProperty(globalThis.Notification, "permission", {
      configurable: true,
      value: "denied",
    });
    const { term, getHandler } = createTerminal();

    attachTerminalAgentNotifications({
      term,
      sessionId: "term-denied",
      project: "web",
    });

    expect(getHandler()?.("notify;Codex done;Review the answer")).toBe(true);
    const state = useTerminalNotificationsStore.getState();
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]?.event).toMatchObject({
      sessionId: "term-denied",
      title: "Codex done",
      body: "Review the answer",
    });
    expect(state.toasts).toEqual([state.notifications[0]?.id]);
    expect(playTerminalNotificationSound).toHaveBeenCalledExactlyOnceWith(45);
  });

  it("delivers notifications without sound when the sound setting is disabled", () => {
    const created = installFakeNotification();
    useSettingsStore.setState({ terminalCodexNotificationSoundEnabled: false });
    const { term, getHandler } = createTerminal();

    attachTerminalAgentNotifications({
      term,
      sessionId: "term-muted",
      project: "web",
    });

    expect(getHandler()?.("notify;Codex done;Review the answer")).toBe(true);
    expect(created).toHaveLength(1);
    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(
      1,
    );
    expect(playTerminalNotificationSound).not.toHaveBeenCalled();
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
