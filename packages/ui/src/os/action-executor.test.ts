// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canExecuteAction,
  executeAction,
} from "./action-executor.js";
import { useWindowStore } from "./window-store.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import type { ActionRequest } from "./types.js";

vi.mock("@/api/connections.js", () => ({
  getConnectionSnapshot: vi.fn((profileId: string) => ({
    owner: { profileId, generation: 1 },
    status: "connected",
    intent: false,
    serverUrl: "http://127.0.0.1:4803",
  })),
  getApi: vi.fn(() => ({
    terminal: {
      create: vi.fn().mockResolvedValue({
        id: "term-created-1",
        incarnation: 1,
        serverEpoch: "epoch-1",
      }),
    },
  })),
}));

describe("action-executor (C1, C2, C10, C12, C13)", () => {
  beforeEach(() => {
    localStorage.clear();
    useWindowStore.setState({
      session: {
        schema: 1,
        activeDesktopId: "desk-1",
        desktops: [
          {
            id: "desk-1",
            name: "Desktop 1",
            tree: null,
            floatingWindowIds: [],
            focusedWindowId: null,
          },
          {
            id: "desk-2",
            name: "Desktop 2",
            tree: null,
            floatingWindowIds: [],
            focusedWindowId: null,
          },
        ],
        windows: {},
      },
    });
    useCognitoModeStore.getState().reset();
  });

  it("validates context requirements in canExecuteAction", () => {
    // Context-free action is always executable
    expect(
      canExecuteAction({
        id: "app.settings.open",
        context: { kind: "shell" },
      }),
    ).toEqual({ canExecute: true });

    // Profile-required action fails without profile
    expect(
      canExecuteAction({
        id: "app.terminals.open",
        context: { kind: "shell" },
      }),
    ).toEqual({
      canExecute: false,
      reason: "Action 'app.terminals.open' requires an active profile connection",
    });

    // Project-required action fails without project
    expect(
      canExecuteAction({
        id: "app.workflow-plans.open",
        context: {
          kind: "desktop",
          desktopId: "desk-1",
          owner: { profileId: "prof-1", generation: 1 },
        },
      }),
    ).toEqual({
      canExecute: false,
      reason: "Action 'app.workflow-plans.open' requires a project context",
    });
  });

  it("focuses existing window on current desktop and restores if minimized", async () => {
    useWindowStore.getState().openWindow(
      {
        id: "settings-win-1",
        appId: "settings",
        title: "Settings",
        ctx: { profileId: "prof-1" },
        mode: "float",
        desktopId: "desk-1",
        maximized: false,
        minimized: true,
      },
      "desk-1",
    );

    const req: ActionRequest = {
      id: "app.settings.open",
      context: {
        kind: "desktop",
        desktopId: "desk-1",
        owner: { profileId: "prof-1", generation: 1 },
      },
    };

    const result = await executeAction(req);
    expect(result).toEqual({ kind: "focused", windowId: "settings-win-1" });

    const win = useWindowStore.getState().session.windows["settings-win-1"];
    expect(win.minimized).toBe(false);
  });

  it("handles repeated Settings Appearance navigation with fresh delivery token (C13)", async () => {
    useWindowStore.getState().openWindow(
      {
        id: "settings-win-1",
        appId: "settings",
        title: "Settings",
        ctx: { profileId: "prof-1" },
        mode: "float",
        desktopId: "desk-1",
        maximized: false,
        minimized: false,
      },
      "desk-1",
    );

    const req: ActionRequest = {
      id: "app.settings.open",
      context: {
        kind: "desktop",
        desktopId: "desk-1",
        owner: { profileId: "prof-1", generation: 1 },
      },
      settingsSection: "appearance",
    };

    const result = await executeAction(req);
    expect(result.kind).toBe("focused");

    const win = useWindowStore.getState().session.windows["settings-win-1"];
    expect(win.appState?.section).toBe("appearance");
    expect(win.appState?.activeTab).toBe("general");
    expect(typeof win.appState?.deliveryId).toBe("string");
  });

  it("opens an independent target chooser for new editor and browser actions (C10)", async () => {
    const editorReq: ActionRequest = {
      id: "app.editor.new-window",
      context: {
        kind: "desktop",
        desktopId: "desk-1",
        owner: { profileId: "prof-1", generation: 1 },
      },
    };

    const editorResult = await executeAction(editorReq);
    expect(editorResult.kind).toBe("opened");
    if (editorResult.kind === "opened") {
      const win = useWindowStore.getState().session.windows[editorResult.windowId];
      expect(win.appId).toBe("editor");
      expect(win.appState?.presentation).toMatchObject({
        kind: "choose-target",
      });
      expect(win.appState?.filePath).toBeUndefined();
    }

    const browserReq: ActionRequest = {
      id: "app.browser.new-window",
      context: {
        kind: "desktop",
        desktopId: "desk-1",
        owner: { profileId: "prof-1", generation: 1 },
      },
    };

    const browserResult = await executeAction(browserReq);
    expect(browserResult.kind).toBe("opened");
    if (browserResult.kind === "opened") {
      const win = useWindowStore.getState().session.windows[browserResult.windowId];
      expect(win.appId).toBe("browser");
      expect(win.appState?.presentation).toMatchObject({
        kind: "choose-target",
      });
      expect(win.appState?.url).toBeUndefined();
    }
  });

  it("executes non-window scalar actions like Cognito toggle and font size adjustment", async () => {
    useSettingsStore.setState({
      cognitoModeShortcut: "Mod+Alt+KeyB",
      terminalFontSize: 14,
    });

    const cognitoResult = await executeAction({
      id: "privacy.cognito",
      context: { kind: "shell" },
    });
    expect(cognitoResult).toEqual({ kind: "executed" });
    expect(useCognitoModeStore.getState().active).toBe(true);

    const fontResult = await executeAction({
      id: "terminal.font-increase",
      context: { kind: "shell" },
    });
    expect(fontResult).toEqual({ kind: "executed" });
  });
});
