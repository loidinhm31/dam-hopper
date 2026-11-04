// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportOsEnvelope,
  exportOsSessionJson,
  getPreservedCorruptBytes,
  importOsEnvelope,
  importOsSessionJson,
  isAutosaveSuspended,
  loadDockPins,
  loadOsSession,
  OS_DOCK_STORAGE_KEY,
  OS_SESSION_STORAGE_KEY,
  resumeAutosave,
  sanitizeSessionForPersistence,
  saveDockPins,
  saveOsSession,
  validateOsSession,
} from "./persistence.js";
import { createDefaultOsSession, openWindow } from "./window-ops.js";

describe("persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    resumeAutosave();
  });

  it("loads a default session when localStorage is empty", () => {
    const session = loadOsSession();
    expect(session.schema).toBe(1);
    expect(session.desktops.length).toBe(1);
  });

  it("saves and reloads a session roundtrip", () => {
    let session = createDefaultOsSession("d1", "Main");
    session = openWindow(session, {
      id: "w1",
      appId: "terminals",
      title: "Terminals",
      ctx: { profileId: "p1" },
      mode: "tile",
    });

    const saved = saveOsSession(session);
    expect(saved).toBe(true);

    const reloaded = loadOsSession();
    expect(reloaded.schema).toBe(1);
    expect(reloaded.windows["w1"]).toBeDefined();
    expect(reloaded.windows["w1"].appId).toBe("terminals");
  });

  it("sanitizes appState to only allowlisted view fields", () => {
    let session = createDefaultOsSession("d1", "Main");
    session = openWindow(session, {
      id: "w1",
      appId: "terminals",
      title: "Terminals",
      ctx: { profileId: "p1" },
      mode: "tile",
      appState: {
        sessionId: "term-1",
        dirtyText: "SECRET_PASSWORD_1234",
        token: "BEARER_AUTH_TOKEN",
        cwd: "/home/user/project",
      },
    });

    const sanitized = sanitizeSessionForPersistence(session);
    expect(sanitized.windows["w1"].appState).toEqual({
      sessionId: "term-1",
      cwd: "/home/user/project",
    });
    expect(
      (sanitized.windows["w1"].appState as Record<string, unknown>)?.dirtyText,
    ).toBeUndefined();
    expect(
      (sanitized.windows["w1"].appState as Record<string, unknown>)?.token,
    ).toBeUndefined();
  });

  it("sanitizes files appState to allowlisted mode and projectFilter fields", () => {
    let session = createDefaultOsSession("d1", "Main");
    session = openWindow(session, {
      id: "w-files",
      appId: "files",
      title: "Files",
      ctx: { profileId: "p1" },
      mode: "tile",
      appState: {
        mode: "workspace",
        projectFilter: "my-service",
        selectedPath: "src/main.rs",
        expandedPaths: ["src", "src/models"],
        scrollTop: 120,
        secretAuth: "token-123",
        unsupportedField: { nested: true },
      },
    });

    const sanitized = sanitizeSessionForPersistence(session);
    expect(sanitized.windows["w-files"].appState).toEqual({
      mode: "workspace",
      projectFilter: "my-service",
      selectedPath: "src/main.rs",
      expandedPaths: ["src", "src/models"],
      scrollTop: 120,
    });
    const state = sanitized.windows["w-files"].appState as Record<string, unknown>;
    expect(state.secretAuth).toBeUndefined();
    expect(state.unsupportedField).toBeUndefined();
  });

  it("suspends autosave and preserves corrupt bytes when JSON is malformed", () => {
    const noticeHandler = vi.fn();
    localStorage.setItem(OS_SESSION_STORAGE_KEY, "not-valid-json{[[");

    const session = loadOsSession(OS_SESSION_STORAGE_KEY, noticeHandler);
    expect(session.schema).toBe(1);
    expect(isAutosaveSuspended()).toBe(true);
    expect(getPreservedCorruptBytes()).toBe("not-valid-json{[[");
    expect(noticeHandler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "corrupt-data" }),
    );

    const saveAttempt = saveOsSession(session);
    expect(saveAttempt).toBe(false);

    resumeAutosave();
    expect(isAutosaveSuspended()).toBe(false);
  });

  it("validates session objects against schema and apps", () => {
    expect(validateOsSession(null).valid).toBe(false);
    expect(validateOsSession({ schema: 2 }).valid).toBe(false);
    expect(
      validateOsSession({
        schema: 1,
        activeDesktopId: "d1",
        desktops: [],
        windows: {},
      }).valid,
    ).toBe(false);

    // activeDesktopId not in desktops
    expect(
      validateOsSession({
        schema: 1,
        activeDesktopId: "d-non-existent",
        desktops: [{ id: "d1", name: "Main", tree: null, floatingWindowIds: [] }],
        windows: {},
      }).valid,
    ).toBe(false);

    // Invalid appId
    const badAppSession = {
      schema: 1,
      activeDesktopId: "d1",
      desktops: [{ id: "d1", name: "Main", tree: null, floatingWindowIds: [] }],
      windows: {
        w1: { id: "w1", appId: "non-existent-app", mode: "tile" },
      },
    };
    expect(validateOsSession(badAppSession).valid).toBe(false);
  });

  it("imports valid JSON and exports session", () => {
    const session = createDefaultOsSession();
    const exported = exportOsSessionJson(session);
    expect(typeof exported).toBe("string");

    const importRes = importOsSessionJson(exported);
    expect(importRes.success).toBe(true);
    expect(importRes.session?.schema).toBe(1);

    const badImport = importOsSessionJson("{invalid-json}");
    expect(badImport.success).toBe(false);
  });

  it("enforces exactly-one-placement and rejects duplicate placements across tree and float", () => {
    const valid = createDefaultOsSession();
    valid.windows["w1"] = {
      id: "w1",
      appId: "terminals",
      title: "Term 1",
      ctx: { profileId: "default" },
      mode: "float",
      desktopId: "desktop-1",
      maximized: false,
      minimized: false,
      floatBounds: { x: 10, y: 10, width: 400, height: 300 },
    };
    valid.desktops[0].floatingWindowIds = ["w1"];
    expect(validateOsSession(valid).valid).toBe(true);

    // Duplicate placement: also add w1 to tile tree
    const invalidDuplicate = JSON.parse(JSON.stringify(valid));
    invalidDuplicate.desktops[0].tree = {
      type: "pane",
      id: "pane-1",
      items: ["w1"],
      active: "w1",
    };
    expect(validateOsSession(invalidDuplicate).valid).toBe(false);
  });

  it("rejects unplaced non-minimized windows and placed minimized windows", () => {
    const valid = createDefaultOsSession();
    valid.windows["w1"] = {
      id: "w1",
      appId: "editor",
      title: "Editor",
      ctx: { profileId: "default" },
      mode: "tile",
      desktopId: "desktop-1",
      maximized: false,
      minimized: false,
    };
    // w1 is not in tree or float -> 0 placements -> invalid!
    expect(validateOsSession(valid).valid).toBe(false);

    // Minimized window must have 0 placements
    valid.windows["w1"].minimized = true;
    expect(validateOsSession(valid).valid).toBe(true);

    // If minimized window is placed in float list -> invalid!
    valid.desktops[0].floatingWindowIds = ["w1"];
    expect(validateOsSession(valid).valid).toBe(false);
  });

  it("rejects invalid pane active item, invalid floatBounds, and invalid desktop focus", () => {
    const valid = createDefaultOsSession();
    valid.windows["w1"] = {
      id: "w1",
      appId: "terminals",
      title: "Term 1",
      ctx: { profileId: "default" },
      mode: "tile",
      desktopId: "desktop-1",
      maximized: false,
      minimized: false,
    };
    valid.desktops[0].tree = {
      type: "pane",
      id: "p1",
      items: ["w1"],
      active: "w-other", // active not in items!
    };
    expect(validateOsSession(valid).valid).toBe(false);

    // Valid active
    valid.desktops[0].tree.active = "w1";
    expect(validateOsSession(valid).valid).toBe(true);

    // Invalid floatBounds
    valid.windows["w1"].floatBounds = { x: 0, y: 0, width: -100, height: 200 };
    expect(validateOsSession(valid).valid).toBe(false);
    delete valid.windows["w1"].floatBounds;

    // Focused window minimized
    valid.desktops[0].focusedWindowId = "w1";
    valid.windows["w1"].minimized = true;
    valid.desktops[0].tree = null;
    expect(validateOsSession(valid).valid).toBe(false);
  });

  it("roundtrips desktop defaultCtx with worktreeId", () => {
    const session = createDefaultOsSession("d1", "Main");
    session.desktops[0].defaultCtx = {
      profileId: "p1",
      projectId: "proj-alpha",
      worktreeId: "wt-feature-login",
    };

    const sanitized = sanitizeSessionForPersistence(session);
    expect(sanitized.desktops[0].defaultCtx).toEqual({
      profileId: "p1",
      projectId: "proj-alpha",
      worktreeId: "wt-feature-login",
    });

    saveOsSession(session);
    const reloaded = loadOsSession();
    expect(reloaded.desktops[0].defaultCtx?.worktreeId).toBe("wt-feature-login");
  });

  it("loads and saves dock pins under os:v1:dock key", () => {
    const defaultPins = loadDockPins();
    expect(defaultPins).toEqual(["files", "terminals", "editor", "browser"]);
    saveDockPins(["terminals", "editor"]);
    expect(JSON.parse(localStorage.getItem(OS_DOCK_STORAGE_KEY)!)).toEqual([
      "terminals",
      "editor",
    ]);

    const loaded = loadDockPins();
    expect(loaded).toEqual(["terminals", "editor"]);
  });

  it("exports and imports 4-namespace envelope with schema validation", () => {
    const session = createDefaultOsSession("d1", "Main");
    saveDockPins(["terminals", "browser"]);

    const exportedJson = exportOsEnvelope(session);
    const parsed = JSON.parse(exportedJson);
    expect(parsed.version).toBe(1);
    expect(parsed.namespaces.session).toBeDefined();
    expect(parsed.namespaces.dock).toEqual(["terminals", "browser"]);

    const imported = importOsEnvelope(exportedJson);
    expect(imported.success).toBe(true);
    expect(imported.envelope?.namespaces.session?.activeDesktopId).toBe("d1");

    // Invalid envelope
    expect(importOsEnvelope("invalid json").success).toBe(false);
    expect(importOsEnvelope(JSON.stringify({ version: 2 })).success).toBe(false);
  });
});
