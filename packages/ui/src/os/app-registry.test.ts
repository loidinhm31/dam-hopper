import { describe, expect, it } from "vitest";
import {
  APP_MANIFESTS,
  getAppManifest,
  isAppId,
  listAppManifests,
  findExistingWindowForApp,
} from "./app-registry.js";
import type { OsAppId, OsWindow } from "./types.js";

const EXPECTED_APPS: OsAppId[] = [
  "terminals",
  "editor",
  "browser",
  "files",
  "search",
  "changes",
  "project-info",
  "git",
  "conflict-resolver",
  "session-changes",
  "workflow-plans",
  "ports-tunnels",
  "agent-store",
  "settings",
  "system-monitor",
  "agent-hub",
  "recipes",
];

describe("app-registry", () => {
  it("contains all 17 app manifests including agent-hub and recipes", () => {
    const manifests = listAppManifests();
    expect(manifests).toHaveLength(17);
    for (const appId of EXPECTED_APPS) {
      expect(APP_MANIFESTS[appId]).toBeDefined();
      expect(isAppId(appId)).toBe(true);
      const manifest = getAppManifest(appId);
      expect(manifest).toBeDefined();
      expect(manifest?.appId).toBe(appId);
      expect(manifest?.displayName.length).toBeGreaterThan(0);
      expect([
        "single-instance",
        "multi-instance",
        "profile-instance",
        "project-instance",
        "worktree-instance",
        "tuple-instance",
      ]).toContain(manifest?.instancing);
      expect(["none", "profile", "project"]).toContain(manifest?.minimumCtx);
      expect(["tile", "float"]).toContain(manifest?.defaultPlacement);
      expect(manifest?.minSize.width).toBeGreaterThan(0);
      expect(manifest?.minSize.height).toBeGreaterThan(0);
      expect(Array.isArray(manifest?.intents)).toBe(true);
    }
  });

  it("distinguishes valid and invalid app IDs", () => {
    expect(isAppId("git")).toBe(true);
    expect(isAppId("terminals")).toBe(true);
    expect(isAppId("unknown-app")).toBe(false);
    expect(isAppId("")).toBe(false);
  });

  it("returns correct manifest for known app IDs and undefined for unknown", () => {
    expect(getAppManifest("git")?.displayName).toBe("Git");
    expect(getAppManifest("files")?.displayName).toBe("Files");
    expect(getAppManifest("invalid" as OsAppId)).toBeUndefined();
  });

  it("adheres to approved minimumCtx specifications", () => {
    expect(APP_MANIFESTS.settings.minimumCtx).toBe("none");
    expect(APP_MANIFESTS.terminals.minimumCtx).toBe("profile");
    expect(APP_MANIFESTS.browser.minimumCtx).toBe("profile");
    expect(APP_MANIFESTS["ports-tunnels"].minimumCtx).toBe("profile");
    expect(APP_MANIFESTS["agent-store"].minimumCtx).toBe("profile");
    expect(APP_MANIFESTS["session-changes"].minimumCtx).toBe("profile");

    expect(APP_MANIFESTS.editor.minimumCtx).toBe("project");
    expect(APP_MANIFESTS.files.minimumCtx).toBe("project");
    expect(APP_MANIFESTS.search.minimumCtx).toBe("project");
    expect(APP_MANIFESTS.changes.minimumCtx).toBe("project");
    expect(APP_MANIFESTS.git.minimumCtx).toBe("project");
    expect(APP_MANIFESTS["conflict-resolver"].minimumCtx).toBe("project");
    expect(APP_MANIFESTS["project-info"].minimumCtx).toBe("project");
    expect(APP_MANIFESTS["workflow-plans"].minimumCtx).toBe("project");
  });

  it("adheres to approved instancing rules", () => {
    expect(APP_MANIFESTS.settings.instancing).toBe("single-instance");
    expect(APP_MANIFESTS["agent-store"].instancing).toBe("profile-instance");
    expect(APP_MANIFESTS["ports-tunnels"].instancing).toBe("profile-instance");

    expect(APP_MANIFESTS.terminals.instancing).toBe("multi-instance");
    expect(APP_MANIFESTS.editor.instancing).toBe("multi-instance");
    expect(APP_MANIFESTS.browser.instancing).toBe("multi-instance");

    expect(APP_MANIFESTS.files.instancing).toBe("worktree-instance");
    expect(APP_MANIFESTS.search.instancing).toBe("worktree-instance");
    expect(APP_MANIFESTS.changes.instancing).toBe("worktree-instance");
    expect(APP_MANIFESTS.git.instancing).toBe("worktree-instance");

    expect(APP_MANIFESTS["conflict-resolver"].instancing).toBe("project-instance");
    expect(APP_MANIFESTS["project-info"].instancing).toBe("project-instance");
    expect(APP_MANIFESTS["workflow-plans"].instancing).toBe("project-instance");
    expect(APP_MANIFESTS["session-changes"].instancing).toBe("tuple-instance");
  });

  it("accurately finds existing windows based on exact instancing granularity", () => {
    const windows: Record<string, OsWindow> = {
      "win-settings": {
        id: "win-settings",
        appId: "settings",
        title: "Settings",
        ctx: { profileId: "p1" },
        mode: "tile",
        desktopId: "d1",
        maximized: false,
        minimized: false,
      },
      "win-ports-p1": {
        id: "win-ports-p1",
        appId: "ports-tunnels",
        title: "Ports p1",
        ctx: { profileId: "p1" },
        mode: "float",
        desktopId: "d1",
        maximized: false,
        minimized: false,
      },
      "win-files-wt1": {
        id: "win-files-wt1",
        appId: "files",
        title: "Files wt1",
        ctx: { profileId: "p1", projectId: "proj1", worktreeId: "wt1" },
        mode: "tile",
        desktopId: "d1",
        maximized: false,
        minimized: false,
      },
      "win-conflict": {
        id: "win-conflict",
        appId: "conflict-resolver",
        title: "Resolver",
        ctx: {
          profileId: "p1",
          projectId: "proj1",
          worktreeId: "wt1",
          gitRootId: ".",
          operation: "merge",
        },
        mode: "float",
        desktopId: "d1",
        maximized: false,
        minimized: false,
        appState: { root: ".", operation: "merge" },
      },
      "win-session": {
        id: "win-session",
        appId: "session-changes",
        title: "Session",
        ctx: { profileId: "p1" },
        mode: "float",
        desktopId: "d1",
        maximized: false,
        minimized: false,
        appState: {
          terminalId: "t1",
          terminalIncarnation: "inc1",
          ompSessionId: "s1",
          rootId: ".",
        },
      },
    };

    // Settings matches across any profile
    expect(
      findExistingWindowForApp(windows, "settings", { profileId: "p2" })?.id,
    ).toBe("win-settings");

    // Ports matches only within profile
    expect(
      findExistingWindowForApp(windows, "ports-tunnels", { profileId: "p1" })?.id,
    ).toBe("win-ports-p1");
    expect(
      findExistingWindowForApp(windows, "ports-tunnels", { profileId: "p2" }),
    ).toBeUndefined();

    // Files matches only within same profile + project + worktree
    expect(
      findExistingWindowForApp(windows, "files", {
        profileId: "p1",
        projectId: "proj1",
        worktreeId: "wt1",
      })?.id,
    ).toBe("win-files-wt1");
    expect(
      findExistingWindowForApp(windows, "files", {
        profileId: "p1",
        projectId: "proj1",
        worktreeId: "wt2",
      }),
    ).toBeUndefined();

    // Conflict Resolver matches root + operation
    expect(
      findExistingWindowForApp(
        windows,
        "conflict-resolver",
        {
          profileId: "p1",
          projectId: "proj1",
          worktreeId: "wt1",
          gitRootId: ".",
          operation: "merge",
        },
        { root: ".", operation: "merge" },
      )?.id,
    ).toBe("win-conflict");
    expect(
      findExistingWindowForApp(
        windows,
        "conflict-resolver",
        {
          profileId: "p1",
          projectId: "proj1",
          worktreeId: "wt1",
          gitRootId: "sub",
          operation: "merge",
        },
        { root: "sub", operation: "merge" },
      ),
    ).toBeUndefined();

    // Session Changes matches full tuple
    expect(
      findExistingWindowForApp(
        windows,
        "session-changes",
        { profileId: "p1" },
        {
          terminalId: "t1",
          terminalIncarnation: "inc1",
          ompSessionId: "s1",
          rootId: ".",
        },
      )?.id,
    ).toBe("win-session");
    expect(
      findExistingWindowForApp(
        windows,
        "session-changes",
        { profileId: "p1" },
        {
          terminalId: "t2",
          terminalIncarnation: "inc1",
          ompSessionId: "s1",
          rootId: ".",
        },
      ),
    ).toBeUndefined();

    // Terminals is multi-instance
    expect(
      findExistingWindowForApp(windows, "terminals", { profileId: "p1" }),
    ).toBeUndefined();
  });
});
