import type { Terminal } from "@xterm/xterm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { playTerminalNotificationSound, recordClientDiagnostic } = vi.hoisted(
  () => ({
    playTerminalNotificationSound: vi.fn(),
    recordClientDiagnostic: vi.fn(),
  }),
);

vi.mock("@/lib/diagnostics-client.js", () => ({
  recordClientDiagnostic,
}));

vi.mock("@/lib/terminal-notification-sound.js", () => ({
  playTerminalNotificationSound,
}));

import { attachTerminalAgentNotifications } from "./terminal-agent-notification-integration.js";
import { applyTerminalBufferReplay } from "./terminal-buffer-replay.js";
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
  let writeComplete: (() => void) | undefined;
  const dispose = vi.fn();
  const term = {
    clear: vi.fn(),
    write: vi.fn((data: string, callback?: () => void) => {
      const osc9Signals = data.matchAll(/\u001b]9;([^\u0007]*)\u0007/g);
      for (const signal of osc9Signals) handler?.(signal[1] ?? "");
      writeComplete = callback;
    }),
    parser: {
      registerOscHandler: vi.fn((code: number, next: OscHandler) => {
        handler = next;
        return { dispose };
      }),
    },
  } as unknown as Terminal;

  return {
    dispose,
    completeWrite: () => writeComplete?.(),
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
      terminalCodexNotificationToastEnabled: true,
      terminalCodexBrowserNotificationsEnabled: true,
      terminalCodexNotificationSoundEnabled: true,
      terminalCodexNotificationSoundVolume: 100,
      terminalCodexNotificationSoundPattern: "default",
    });
    useTerminalNotificationsStore.setState({ notifications: [], toasts: [] });
  });

  afterEach(() => {
    useSettingsStore.setState({
      terminalCodexNotificationsEnabled: false,
      terminalCodexNotificationToastEnabled: true,
      terminalCodexBrowserNotificationsEnabled: true,
      terminalCodexNotificationSoundEnabled: true,
      terminalCodexNotificationSoundVolume: 100,
      terminalCodexNotificationSoundPattern: "default",
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
    expect(playTerminalNotificationSound).toHaveBeenNthCalledWith(
      1,
      "default",
      100,
    );
    expect(playTerminalNotificationSound).toHaveBeenNthCalledWith(
      2,
      "default",
      100,
    );
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
    const { getHandler, term } = createTerminal();

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
    expect(useTerminalNotificationsStore.getState().toasts).toEqual([]);
    expect(playTerminalNotificationSound).not.toHaveBeenCalled();
  });

  it("keeps replayed OSC 9 silent, then delivers an identical live signal", () => {
    const created = installFakeNotification();
    const { completeWrite, getHandler, term } = createTerminal();
    const integration = attachTerminalAgentNotifications({
      term,
      sessionId: "term-replay",
      project: "web",
    });
    const handler = getHandler();
    const payload = "notify;Codex done;Review the answer";

    integration.setReplayActive(true);
    applyTerminalBufferReplay(
      term,
      {
        data: `\u001b]10;rgb:aa/bb/cc\u0007\u001b]9;${payload}\u0007`,
        offset: 42,
        reset: true,
        truncated: false,
      },
      () => integration.setReplayActive(false),
    );
    expect(term.parser.registerOscHandler).toHaveBeenCalledTimes(1);
    expect(term.parser.registerOscHandler).toHaveBeenCalledWith(
      9,
      expect.any(Function),
    );
    expect(created).toHaveLength(0);
    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(
      0,
    );
    expect(useTerminalNotificationsStore.getState().toasts).toEqual([]);
    expect(playTerminalNotificationSound).not.toHaveBeenCalled();

    completeWrite();
    expect(handler?.(payload)).toBe(true);
    expect(created).toHaveLength(1);
    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(
      1,
    );
    expect(useTerminalNotificationsStore.getState().toasts).toHaveLength(1);
    expect(playTerminalNotificationSound).toHaveBeenCalledOnce();
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
    expect(playTerminalNotificationSound).toHaveBeenCalledExactlyOnceWith(
      "default",
      45,
    );
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

  it("keeps bell history while suppressing only in-app toasts", () => {
    const created = installFakeNotification();
    useSettingsStore.setState({
      terminalCodexNotificationToastEnabled: false,
      terminalCodexNotificationSoundPattern: "urgent",
      terminalCodexNotificationSoundVolume: 45,
    });
    const { term, getHandler } = createTerminal();

    attachTerminalAgentNotifications({
      term,
      sessionId: "term-no-toast",
      project: "web",
    });

    expect(getHandler()?.("notify;Codex done;Review the answer")).toBe(true);
    const state = useTerminalNotificationsStore.getState();
    expect(state.notifications).toHaveLength(1);
    expect(state.toasts).toEqual([]);
    expect(created).toHaveLength(1);
    expect(playTerminalNotificationSound).toHaveBeenCalledExactlyOnceWith(
      "urgent",
      45,
    );
  });

  it("suppresses only browser popups when browser delivery is disabled", () => {
    const created = installFakeNotification();
    useSettingsStore.setState({
      terminalCodexBrowserNotificationsEnabled: false,
      terminalCodexNotificationSoundPattern: "soft",
      terminalCodexNotificationSoundVolume: 60,
    });
    const { term, getHandler } = createTerminal();

    attachTerminalAgentNotifications({
      term,
      sessionId: "term-no-browser",
      project: "web",
    });

    expect(getHandler()?.("notify;Codex done;Review the answer")).toBe(true);
    const state = useTerminalNotificationsStore.getState();
    expect(state.notifications).toHaveLength(1);
    expect(state.toasts).toEqual([state.notifications[0]?.id]);
    expect(created).toEqual([]);
    expect(playTerminalNotificationSound).toHaveBeenCalledExactlyOnceWith(
      "soft",
      60,
    );
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
    expect(created[0]?.options.body).toBe("api · Bash #2\nReview the answer");

    vi.advanceTimersByTime(1_001);
    terminalOrder = 4;
    expect(getHandler()?.("notify;Codex done;Review again")).toBe(true);
    expect(created[1]?.options.body).toBe("api · Bash #4\nReview again");
  });
});
