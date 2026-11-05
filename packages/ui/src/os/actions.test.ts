import { describe, expect, it } from "vitest";
import { APP_MANIFESTS } from "./app-registry.js";
import {
  ACTION_DESCRIPTORS,
  getActionDescriptor,
  isExtraActionId,
  isOsActionId,
  listActionDescriptors,
  resolveActionBinding,
  type ActionBindingsSettingsProjection,
  type ExtraActionId,
  type OsActionId,
  type ScalarActionId,
} from "./actions.js";
import {
  DEFAULT_COGNITO_MODE_SHORTCUT,
  DEFAULT_GIT_PANEL_SHORTCUT,
  DEFAULT_OS_CYCLE_FOCUS_SHORTCUT,
  DEFAULT_OS_PALETTE_SHORTCUT,
  DEFAULT_PORTS_PANEL_SHORTCUT,
  DEFAULT_PROJECT_PANEL_SHORTCUT,
  DEFAULT_REVEAL_ACTIVE_FILE_SHORTCUT,
  DEFAULT_SEARCH_FILENAME_SHORTCUT,
  DEFAULT_SEARCH_TEXT_SHORTCUT,
  DEFAULT_TERMINAL_FILE_PANEL_SHORTCUT,
  DEFAULT_TERMINAL_FONT_SIZE_DECREASE_SHORTCUT,
  DEFAULT_TERMINAL_FONT_SIZE_INCREASE_SHORTCUT,
  DEFAULT_TERMINAL_WORKSPACE_SHORTCUT,
} from "../lib/shortcuts.js";
import type {
  ActionContext,
  ActionRequest,
  ActionResult,
  CanvasWorkArea,
  ChooserPresentationState,
  ConflictTargetRef,
  SettingsDeliveryState,
  TerminalCreatePayload,
  WindowPresentationKind,
} from "./types.js";

describe("OS Action Catalog (C1 Contract)", () => {
  it("derives exhaustive Open / Focus descriptors from APP_MANIFESTS for all 17 apps", () => {
    const appIds = Object.keys(APP_MANIFESTS);
    expect(appIds).toHaveLength(17);

    for (const appId of appIds) {
      const actionId = `app.${appId}.open` as OsActionId;
      const descriptor = getActionDescriptor(actionId);

      expect(descriptor).toBeDefined();
      expect(descriptor.id).toBe(actionId);
      expect(descriptor.appId).toBe(appId);
      expect(descriptor.label).toBe(APP_MANIFESTS[appId as keyof typeof APP_MANIFESTS].displayName);
      expect(descriptor.launchMode).toBe("focus-or-open");
      expect(descriptor.supportedModes).toEqual(["tile", "float"]);
    }
  });

  it("contains exactly 27 actions in the catalog", () => {
    const descriptors = listActionDescriptors();
    expect(descriptors).toHaveLength(27);
    expect(Object.keys(ACTION_DESCRIPTORS)).toHaveLength(27);
  });

  it("contains exactly 3 New Window actions, all using appShortcuts extra bindings", () => {
    const newWindowActions = listActionDescriptors().filter(
      (d) => d.launchMode === "new-window",
    );
    expect(newWindowActions).toHaveLength(3);

    const ids = newWindowActions.map((d) => d.id).sort();
    expect(ids).toEqual([
      "app.browser.new-window",
      "app.editor.new-window",
      "app.terminals.new-window",
    ]);

    for (const d of newWindowActions) {
      expect(d.bindingSource.kind).toBe("extra");
      expect(d.defaultBinding).toBeNull();
    }
  });

  it("strictly partitions actions into 13 scalar and 14 extra actions", () => {
    const all = listActionDescriptors();
    const scalarActions = all.filter((d) => d.bindingSource.kind === "scalar");
    const extraActions = all.filter((d) => d.bindingSource.kind === "extra");

    expect(scalarActions).toHaveLength(13);
    expect(extraActions).toHaveLength(14);

    for (const extra of extraActions) {
      expect(isExtraActionId(extra.id)).toBe(true);
      expect(extra.defaultBinding).toBeNull();
    }

    for (const scalar of scalarActions) {
      expect(isExtraActionId(scalar.id)).toBe(false);
      expect(typeof scalar.defaultBinding).toBe("string");
    }
  });

  it("identifies valid and invalid action IDs with isOsActionId", () => {
    expect(isOsActionId("app.terminals.open")).toBe(true);
    expect(isOsActionId("app.editor.new-window")).toBe(true);
    expect(isOsActionId("privacy.cognito")).toBe(true);
    expect(isOsActionId("unknown.action")).toBe(false);
    expect(isOsActionId("app.recipes.new-window")).toBe(false);
  });

  it("throws on unknown action ID in getActionDescriptor", () => {
    expect(() => getActionDescriptor("invalid" as OsActionId)).toThrow(
      "Unknown action ID: invalid",
    );
  });
});

describe("Presence-Aware Binding Resolution (C1 & C4 Contracts)", () => {
  it("resolves default bindings when settings projection is null or empty", () => {
    expect(resolveActionBinding("app.terminals.open", null)).toBe(
      DEFAULT_TERMINAL_WORKSPACE_SHORTCUT,
    );
    expect(resolveActionBinding("app.search.open", {})).toBe(
      DEFAULT_SEARCH_TEXT_SHORTCUT,
    );
    expect(resolveActionBinding("search.filename", {})).toBe(
      DEFAULT_SEARCH_FILENAME_SHORTCUT,
    );
    expect(resolveActionBinding("privacy.cognito", null)).toBe(
      DEFAULT_COGNITO_MODE_SHORTCUT,
    );
    expect(resolveActionBinding("os.palette", {})).toBe(
      DEFAULT_OS_PALETTE_SHORTCUT,
    );
    expect(resolveActionBinding("os.cycle-focus", {})).toBe(
      DEFAULT_OS_CYCLE_FOCUS_SHORTCUT,
    );

    // Extra actions default to null when missing
    expect(resolveActionBinding("app.editor.open", null)).toBeNull();
    expect(resolveActionBinding("app.browser.open", {})).toBeNull();
    expect(resolveActionBinding("app.terminals.new-window", {})).toBeNull();
  });

  it("resolves configured replacement chord for scalar actions", () => {
    const settings: ActionBindingsSettingsProjection = {
      terminalWorkspaceShortcut: "Ctrl+KeyT",
      searchTextShortcut: "Mod+KeyF",
    };

    expect(resolveActionBinding("app.terminals.open", settings)).toBe("Ctrl+KeyT");
    expect(resolveActionBinding("app.search.open", settings)).toBe("Mod+KeyF");
    // Missing scalar falls back to default
    expect(resolveActionBinding("app.git.open", settings)).toBe(
      DEFAULT_GIT_PANEL_SHORTCUT,
    );
  });

  it("resolves explicit null as unbound for scalar actions", () => {
    const settings: ActionBindingsSettingsProjection = {
      terminalWorkspaceShortcut: null,
      searchTextShortcut: null,
    };

    expect(resolveActionBinding("app.terminals.open", settings)).toBeNull();
    expect(resolveActionBinding("app.search.open", settings)).toBeNull();
    // Missing scalar still falls back to default
    expect(resolveActionBinding("app.files.open", settings)).toBe(
      DEFAULT_TERMINAL_FILE_PANEL_SHORTCUT,
    );
  });

  it("resolves extra actions via appShortcuts map with presence awareness", () => {
    const settings: ActionBindingsSettingsProjection = {
      appShortcuts: {
        "app.editor.open": "Mod+KeyE",
        "app.browser.open": null, // Explicitly unbound
      },
    };

    expect(resolveActionBinding("app.editor.open", settings)).toBe("Mod+KeyE");
    expect(resolveActionBinding("app.browser.open", settings)).toBeNull();
    // Unmentioned extra action resolves to default null
    expect(resolveActionBinding("app.changes.open", settings)).toBeNull();
  });

  it("enforces Cognito mode exception: chord cannot be unbound or invalid", () => {
    // Explicit null falls back to default
    expect(
      resolveActionBinding("privacy.cognito", { cognitoModeShortcut: null }),
    ).toBe(DEFAULT_COGNITO_MODE_SHORTCUT);

    // Empty string falls back to default
    expect(
      resolveActionBinding("privacy.cognito", { cognitoModeShortcut: "   " }),
    ).toBe(DEFAULT_COGNITO_MODE_SHORTCUT);

    // DoubleShift cannot be used for Cognito
    expect(
      resolveActionBinding("privacy.cognito", { cognitoModeShortcut: "DoubleShift" }),
    ).toBe(DEFAULT_COGNITO_MODE_SHORTCUT);

    // Mod+Wheel cannot be used for Cognito
    expect(
      resolveActionBinding("privacy.cognito", { cognitoModeShortcut: "Mod+Wheel" }),
    ).toBe(DEFAULT_COGNITO_MODE_SHORTCUT);

    // Valid custom chord is accepted
    expect(
      resolveActionBinding("privacy.cognito", {
        cognitoModeShortcut: "Ctrl+Alt+KeyC",
      }),
    ).toBe("Ctrl+Alt+KeyC");
  });
});

describe("Additive Context and Geometry Types (C1, C7, C10, C12, C13)", () => {
  it("allows constructing valid ActionContext variants", () => {
    const desktopContext: ActionContext = {
      kind: "desktop",
      desktopId: "desk-1",
      windowContext: { profileId: "prof-1" },
    };
    expect(desktopContext.kind).toBe("desktop");

    const editorContext: ActionContext = {
      kind: "editor",
      desktopId: "desk-1",
      windowId: "win-1",
      resourceId: "res-1",
      windowContext: { profileId: "prof-1" },
      owner: { profileId: "prof-1", generation: 1 },
      target: { kind: "workspace", profileId: "prof-1" },
      filePath: "src/main.ts",
    };
    expect(editorContext.kind).toBe("editor");

    const runningContext: ActionContext = {
      kind: "running-window",
      desktopId: "desk-1",
      windowId: "win-2",
      windowContext: { profileId: "prof-1" },
    };
    expect(runningContext.kind).toBe("running-window");

    const shellContext: ActionContext = {
      kind: "shell",
    };
    expect(shellContext.kind).toBe("shell");
  });

  it("allows constructing valid TerminalCreatePayload", () => {
    const payload: TerminalCreatePayload = {
      target: { kind: "workspace", profileId: "prof-1" },
      cwd: "packages/ui",
      directoryKind: "explicit-folder",
      owner: { profileId: "prof-1", generation: 1 },
      destinationDesktopId: "desk-1",
      windowContext: { profileId: "prof-1" },
    };
    expect(payload.directoryKind).toBe("explicit-folder");
    expect(payload.cwd).toBe("packages/ui");
  });

  it("allows constructing valid ActionRequest and ActionResult variants", () => {
    const ordinaryReq: ActionRequest = {
      id: "app.files.open",
      context: { kind: "shell" },
    };
    expect(ordinaryReq.id).toBe("app.files.open");

    const settingsReq: ActionRequest = {
      id: "app.settings.open",
      context: { kind: "shell" },
      settingsSection: "appearance",
    };
    expect(settingsReq.settingsSection).toBe("appearance");

    const terminalNewReq: ActionRequest = {
      id: "app.terminals.new-window",
      context: { kind: "shell" },
      terminalCreate: {
        target: { kind: "workspace", profileId: "prof-1" },
        cwd: null,
        directoryKind: "profile-default",
        owner: { profileId: "prof-1", generation: 1 },
        destinationDesktopId: "desk-1",
        windowContext: { profileId: "prof-1" },
      },
    };
    expect(terminalNewReq.terminalCreate?.directoryKind).toBe("profile-default");

    const focusedResult: ActionResult = { kind: "focused", windowId: "w-1" };
    const openedResult: ActionResult = { kind: "opened", windowId: "w-2" };
    const executedResult: ActionResult = { kind: "executed" };
    const disabledResult: ActionResult = { kind: "disabled", reason: "no context" };
    const blockedResult: ActionResult = { kind: "blocked", reason: "journal active" };
    const failedResult: ActionResult = { kind: "failed", reason: "creation error" };
    const uncertainResult: ActionResult = {
      kind: "uncertain",
      attemptId: "att-1",
      reason: "timeout",
    };

    expect(focusedResult.kind).toBe("focused");
    expect(openedResult.kind).toBe("opened");
    expect(executedResult.kind).toBe("executed");
    expect(disabledResult.kind).toBe("disabled");
    expect(blockedResult.kind).toBe("blocked");
    expect(failedResult.kind).toBe("failed");
    expect(uncertainResult.kind).toBe("uncertain");
  });

  it("allows constructing valid geometry and presentation types", () => {
    const workArea: CanvasWorkArea = { width: 1280, height: 800 };
    expect(workArea.width).toBe(1280);

    const kind: WindowPresentationKind = "maximized";
    expect(kind).toBe("maximized");

    const chooserState: ChooserPresentationState = {
      kind: "choose-target",
      capturedContext: { kind: "shell" },
      ownerGeneration: 1,
      destinationDesktopId: "desk-1",
      deliveryToken: "tok-1",
    };
    expect(chooserState.kind).toBe("choose-target");

    const deliveryState: SettingsDeliveryState = {
      section: "appearance",
      deliveryId: "del-1",
    };
    expect(deliveryState.section).toBe("appearance");

    const conflictTarget: ConflictTargetRef = {
      projectId: "proj-1",
      gitRootId: "root-1",
      operation: "merge",
    };
    expect(conflictTarget.operation).toBe("merge");
  });
});
