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
import {
  executeTerminalLaunch,
  isLaunchAttemptActive,
  resetActiveLaunchAttemptsForTests,
} from "./terminal-launch-lifecycle.js";
import { getLaunchAttempt } from "./persistence.js";
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
    resetActiveLaunchAttemptsForTests();
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

  describe("app.terminals.new-window identity params & in-flight tracking (B3, F8)", () => {
    it("reserves with correct identity params for workspace and explicit cwd cases", async () => {
      // Workspace default case
      const req1: ActionRequest = {
        id: "app.terminals.new-window",
        context: {
          kind: "desktop",
          desktopId: "desk-1",
          owner: { profileId: "prof-1", generation: 1 },
        },
      };
      const res1 = await executeAction(req1);
      expect(res1.kind).toBe("opened");
      if (res1.kind === "opened") {
        const win = useWindowStore.getState().session.windows[res1.windowId];
        const attemptId = win.appState?.attemptId as string;
        expect(attemptId).toBeDefined();
        const record = getLaunchAttempt(attemptId);
        expect(record.status).toBe("ok");
        if (record.status === "ok") {
          expect(record.record.targetKind).toBe("workspace");
          expect(record.record.workspaceId).toBe("prof-1");
          expect(record.record.cwd).toBeNull();
        }
      }

      // Explicit CWD case
      const req2: ActionRequest = {
        id: "app.terminals.new-window",
        context: {
          kind: "desktop",
          desktopId: "desk-1",
          owner: { profileId: "prof-1", generation: 1 },
        },
        terminalCreate: {
          cwd: "/custom/path",
          target: { kind: "workspace", profileId: "prof-1" },
        },
      };
      const res2 = await executeAction(req2);
      expect(res2.kind).toBe("opened");
      if (res2.kind === "opened") {
        const win = useWindowStore.getState().session.windows[res2.windowId];
        const attemptId = win.appState?.attemptId as string;
        const record = getLaunchAttempt(attemptId);
        expect(record.status).toBe("ok");
        if (record.status === "ok") {
          expect(record.record.targetKind).toBe("workspace");
          expect(record.record.cwd).toBe("/custom/path");
        }
      }
    });

    it("reserves with correct identity params for project target", async () => {
      const req: ActionRequest = {
        id: "app.terminals.new-window",
        context: {
          kind: "desktop",
          desktopId: "desk-1",
          owner: { profileId: "prof-1", generation: 1 },
          windowContext: {
            projectId: "proj-fallback",
            worktreeId: "wt-fallback",
          },
        },
        terminalCreate: {
          target: {
            kind: "project",
            profileId: "prof-1",
            project: "my-project",
            worktreePath: "/repo/worktree",
          },
        },
      };
      const res = await executeAction(req);
      expect(res.kind).toBe("opened");
      if (res.kind === "opened") {
        const win = useWindowStore.getState().session.windows[res.windowId];
        const attemptId = win.appState?.attemptId as string;
        const record = getLaunchAttempt(attemptId);
        expect(record.status).toBe("ok");
        if (record.status === "ok") {
          expect(record.record.targetKind).toBe("project");
          expect(record.record.projectId).toBe("my-project");
          expect(record.record.worktreeId).toBe("/repo/worktree");
        }
      }
    });

    it("attempt stays active from reservation until executeTerminalLaunch settles", async () => {
      const req: ActionRequest = {
        id: "app.terminals.new-window",
        context: {
          kind: "desktop",
          desktopId: "desk-1",
          owner: { profileId: "prof-1", generation: 1 },
        },
      };
      const res = await executeAction(req);
      expect(res.kind).toBe("opened");
      if (res.kind !== "opened") return;

      const win = useWindowStore.getState().session.windows[res.windowId];
      const attemptId = win.appState?.attemptId as string;
      const terminalId = win.appState?.sessionId as string;

      // Reserved attempt is active in this page!
      expect(isLaunchAttemptActive(attemptId)).toBe(true);

      // Execute launch settles the attempt
      const outcome = await executeTerminalLaunch({
        owner: { profileId: "prof-1", generation: 1 },
        attemptId,
        terminalId,
        command: "",
      });
      expect(outcome.kind).toBe("created");

      // After settlement, attempt is no longer active in this page
      expect(isLaunchAttemptActive(attemptId)).toBe(false);
    });
  });
});
