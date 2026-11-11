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
import {
  BROWSER_RECOVERY_STORAGE_KEY,
  saveBrowserRecoveryDisk,
  loadBrowserRecoveryDisk,
} from "./browser/browser-recovery-store.js";
import { BROWSER_STATE_VERSION, type BrowserWindowState } from "./browser/browser-tab-types.js";
import { getLaunchAttempt } from "./persistence.js";
import { getConnectionSnapshot } from "@/api/connections.js";
vi.mock("@/api/connections.js", () => ({
  isCurrentConnection: vi.fn((ref: { profileId: string; generation: number }) => ref.generation === 1),
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
      const st = win.appState as unknown as BrowserWindowState;
      expect(st.browserStateVersion).toBe(BROWSER_STATE_VERSION);
      expect(st.tabs).toHaveLength(1);
      expect(st.tabs[0]?.phase).toBe("new-tab");
      expect(st.tabs[0]?.committedUrl).toBeUndefined();
      expect(win.appState?.url).toBeUndefined();
      expect(win.appState?.presentation).toBeUndefined();
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
  describe("Browser launch, focus-or-open, and locked closed-group consume", () => {
    const scope = {
      profileId: "prof-1",
      endpoint: "http://127.0.0.1:4803",
      principal: "alice",
      namespace: "prod" as const,
    };

    beforeEach(() => {
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: { request: async (_n: string, _o: unknown, cb: () => Promise<unknown>) => cb() },
      });
      vi.mocked(getConnectionSnapshot).mockImplementation((profileId: string) => ({
        owner: { profileId, generation: 1 },
        status: "connected",
        intent: false,
        serverUrl: "http://127.0.0.1:4803",
        verifiedBrowserIdentity: { principal: "alice", namespace: "prod" },
      }));
    });

    it("focuses existing eligible window unchanged and does not consume saved closed group", async () => {
      saveBrowserRecoveryDisk({
        version: 1,
        groups: [{ version: 1, groupId: "grp-1", ownerScope: scope, addresses: ["https://saved.test/1"], activeIndex: 0 }],
        addressSuppressedScopes: [],
        operations: [],
      });
      useWindowStore.getState().openWindow(
        {
          id: "win-existing",
          appId: "browser",
          title: "Browser",
          ctx: { profileId: "prof-1" },
          mode: "tile",
          desktopId: "desk-1",
          maximized: false,
          minimized: false,
          appState: {
            browserStateVersion: BROWSER_STATE_VERSION,
            ownerScope: scope,
            activeTabId: "t1",
            tabs: [{ tabId: "t1", kind: "ordinary", phase: "new-tab", draft: { value: "", dirty: false }, actionSequence: 0 }],
          },
        },
        "desk-1",
      );
      const res = await executeAction({
        id: "app.browser.open",
        context: { kind: "desktop", desktopId: "desk-1", owner: { profileId: "prof-1", generation: 1 } },
      });
      expect(res).toEqual({ kind: "focused", windowId: "win-existing" });
      expect(loadBrowserRecoveryDisk().groups).toHaveLength(1);
    });

    it("consumes saved group once across overlapping open actions under recovery lock and blocks replay after store reset", async () => {
      saveBrowserRecoveryDisk({
        version: 1,
        groups: [{
          version: 1,
          groupId: "grp-1",
          ownerScope: scope,
          addresses: ["https://a.test/1?x=1", "https://b.test/2#h"],
          activeIndex: 1,
        }],
        addressSuppressedScopes: [],
        operations: [],
      });
      let lockTail = Promise.resolve();
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: {
          request: async (_n: string, _o: unknown, cb: () => Promise<unknown>) => {
            const prev = lockTail;
            const gate = Promise.withResolvers<void>();
            lockTail = gate.promise;
            await prev;
            try { return await cb(); } finally { gate.resolve(); }
          },
        },
      });

      // Fire overlapping open actions contending on the origin-wide lock; only the first consumes grp-1.
      const doc1Promise = executeAction({
        id: "app.browser.open",
        context: { kind: "desktop", desktopId: "desk-1", owner: { profileId: "prof-1", generation: 1 } },
      });
      const doc2Promise = executeAction({
        id: "app.browser.open",
        context: { kind: "desktop", desktopId: "desk-1", owner: { profileId: "prof-1", generation: 1 } },
      });
      const [res1, res2] = await Promise.all([doc1Promise, doc2Promise]);
      expect(res1.kind).toBe("opened");
      expect(res2.kind).toBe("focused");
      if (res1.kind === "opened") {
        const st1 = useWindowStore.getState().session.windows[res1.windowId].appState as unknown as BrowserWindowState;
        expect(st1.restoreGroupId).toBe("grp-1");
        expect(st1.tabs).toHaveLength(2);
        expect(st1.tabs[0]?.phase).toBe("deferred");
        expect(st1.tabs[1]?.phase).toBe("creating");
      }
      // After store reset (empty local window map), consumed grp-1 cannot replay
      useWindowStore.setState((prev) => ({ session: { ...prev.session, windows: {} } }));
      const resFreshDoc = await executeAction({
        id: "app.browser.open",
        context: { kind: "desktop", desktopId: "desk-1", owner: { profileId: "prof-1", generation: 1 } },
      });
      expect(resFreshDoc.kind).toBe("opened");
      if (resFreshDoc.kind === "opened") {
        const stFresh = useWindowStore.getState().session.windows[resFreshDoc.windowId].appState as unknown as BrowserWindowState;
        expect(stFresh.restoreGroupId).toBeUndefined();
        expect(stFresh.tabs[0]?.phase).toBe("new-tab");
      }
      expect(JSON.parse(localStorage.getItem(BROWSER_RECOVERY_STORAGE_KEY)!).groups).toHaveLength(0);
    });

    it("blocks app.browser.open when Web Locks is unavailable while New Window remains blank New Tab", async () => {
      Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
      const openRes = await executeAction({
        id: "app.browser.open",
        context: { kind: "desktop", desktopId: "desk-1", owner: { profileId: "prof-1", generation: 1 } },
      });
      expect(openRes.kind).toBe("blocked");

      const newWinRes = await executeAction({
        id: "app.browser.new-window",
        context: { kind: "desktop", desktopId: "desk-1", owner: { profileId: "prof-1", generation: 1 } },
      });
      expect(newWinRes.kind).toBe("opened");
    });

    it("blocks group restore when an unresolved recovery operation affects that group", async () => {
      saveBrowserRecoveryDisk({
        version: 1,
        groups: [{ version: 1, groupId: "grp-blocked", ownerScope: scope, addresses: ["https://blocked.test"], activeIndex: 0 }],
        addressSuppressedScopes: [],
        operations: [{ operationId: "op-1", ownerScope: scope, kind: "close-window", groupId: "grp-blocked", windowId: "w-old", status: "unknown" }],
      });
      const res = await executeAction({
        id: "app.browser.open",
        context: { kind: "desktop", desktopId: "desk-1", owner: { profileId: "prof-1", generation: 1 } },
      });
      expect(res.kind).toBe("opened");
      if (res.kind === "opened") {
        const st = useWindowStore.getState().session.windows[res.windowId].appState as unknown as BrowserWindowState;
        expect(st.tabs[0]?.phase).toBe("new-tab");
        expect(loadBrowserRecoveryDisk().groups).toHaveLength(1);
      }
    });
  });
});
