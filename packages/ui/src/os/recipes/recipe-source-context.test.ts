import { describe, expect, it } from "vitest";
import type { OsDesktop, OsWindow } from "../types.js";
import type { ServerProfile } from "@/api/server-config.js";
import type { ConnectionSnapshot } from "@/api/connections.js";
import {
  buildProfileNameMap,
  collectDesktopWindowIds,
  determineDefaultCandidatePair,
  determineSourceEmptyState,
  evaluateSourceWindow,
  isFleetUtility,
  projectSourceDesktopWindowsPreview,
  projectSourceWindowsToCandidatePairs,
} from "./recipe-source-context.js";

describe("recipe-source-context pure functions", () => {
  const profileAlpha: ServerProfile = {
    id: "profile-alpha-id",
    name: "Host Alpha",
    url: "http://127.0.0.1:4801",
    authType: "none",
    createdAt: 1,
    autoConnect: true,
  };

  const profileAlphaDup: ServerProfile = {
    id: "profile-alpha-dup-id",
    name: "Host Alpha", // Duplicate name
    url: "http://127.0.0.1:4802",
    authType: "none",
    createdAt: 2,
    autoConnect: true,
  };

  const profileBeta: ServerProfile = {
    id: "profile-beta-id",
    name: "Host Beta",
    url: "http://127.0.0.1:4803",
    authType: "none",
    createdAt: 3,
    autoConnect: true,
  };

  describe("collectDesktopWindowIds", () => {
    it("gathers window IDs from split panes and floating list without duplicates", () => {
      const desktop: OsDesktop = {
        id: "d-1",
        name: "Desktop 1",
        tree: {
          type: "split",
          id: "s-1",
          direction: "horizontal",
          sizes: [50, 50],
          children: [
            {
              type: "pane",
              id: "p-1",
              items: ["win-1", "win-2"],
              active: "win-1",
            },
            {
              type: "pane",
              id: "p-2",
              items: ["win-3"],
              active: "win-3",
            },
          ],
        },
        floatingWindowIds: ["win-4", "win-1"], // win-1 is also in pane; must deduplicate
      };

      const ids = collectDesktopWindowIds(desktop);
      expect(ids).toEqual(["win-1", "win-2", "win-3", "win-4"]);
    });

    it("handles empty desktop or null tree gracefully", () => {
      const emptyDesktop: OsDesktop = {
        id: "d-empty",
        name: "Empty",
        tree: null,
        floatingWindowIds: [],
      };
      expect(collectDesktopWindowIds(emptyDesktop)).toEqual([]);
    });
  });

  describe("isFleetUtility", () => {
    it("identifies recipes, system-monitor, settings, agent-hub as fleet utilities", () => {
      expect(isFleetUtility("recipes")).toBe(true);
      expect(isFleetUtility("system-monitor")).toBe(true);
      expect(isFleetUtility("settings")).toBe(true);
      expect(isFleetUtility("agent-hub")).toBe(true);

      expect(isFleetUtility("terminals")).toBe(false);
      expect(isFleetUtility("editor")).toBe(false);
      expect(isFleetUtility("files")).toBe(false);
      expect(isFleetUtility("browser")).toBe(false);
    });
  });

  describe("buildProfileNameMap", () => {
    it("adds stable ID suffix disambiguator only when names collide", () => {
      const map = buildProfileNameMap([profileAlpha, profileAlphaDup, profileBeta]);

      const alphaMeta = map.get("profile-alpha-id");
      expect(alphaMeta).toBeDefined();
      expect(alphaMeta?.name).toBe("Host Alpha");
      expect(alphaMeta?.disambiguator).toBe("pha-id");

      const dupMeta = map.get("profile-alpha-dup-id");
      expect(dupMeta).toBeDefined();
      expect(dupMeta?.name).toBe("Host Alpha");
      expect(dupMeta?.disambiguator).toBe("dup-id");

      const betaMeta = map.get("profile-beta-id");
      expect(betaMeta).toBeDefined();
      expect(betaMeta?.name).toBe("Host Beta");
      expect(betaMeta?.disambiguator).toBeUndefined();
    });
  });

  describe("projectSourceWindowsToCandidatePairs", () => {
    it("returns empty candidates on empty desktop", () => {
      const desktop: OsDesktop = {
        id: "d-1",
        name: "Desk",
        tree: null,
        floatingWindowIds: [],
      };
      const candidates = projectSourceWindowsToCandidatePairs({
        desktop,
        windows: {},
      });
      expect(candidates).toEqual([]);
    });

    it("excludes contextless/fleet utilities from candidate eligibility", () => {
      const desktop: OsDesktop = {
        id: "d-1",
        name: "Desk",
        tree: {
          type: "pane",
          id: "p-1",
          items: ["win-rec", "win-mon", "win-set", "win-hub"],
          active: "win-rec",
        },
        floatingWindowIds: [],
      };

      const windows: Record<string, OsWindow> = {
        "win-rec": {
          id: "win-rec",
          appId: "recipes",
          title: "Launch Recipes",
          ctx: { profileId: profileAlpha.id, projectId: "dam-hopper" },
          mode: "tile",
          desktopId: "d-1",
          maximized: false,
          minimized: false,
        },
        "win-mon": {
          id: "win-mon",
          appId: "system-monitor",
          title: "System Monitor",
          ctx: { profileId: profileAlpha.id, projectId: "dam-hopper" },
          mode: "tile",
          desktopId: "d-1",
          maximized: false,
          minimized: false,
        },
        "win-set": {
          id: "win-set",
          appId: "settings",
          title: "Settings",
          ctx: { profileId: profileAlpha.id, projectId: "dam-hopper" },
          mode: "tile",
          desktopId: "d-1",
          maximized: false,
          minimized: false,
        },
        "win-hub": {
          id: "win-hub",
          appId: "agent-hub",
          title: "Agent Hub",
          ctx: { profileId: profileAlpha.id, projectId: "dam-hopper" },
          mode: "tile",
          desktopId: "d-1",
          maximized: false,
          minimized: false,
        },
      };

      const candidates = projectSourceWindowsToCandidatePairs({
        desktop,
        windows,
        configuredProfiles: [profileAlpha],
      });
      expect(candidates).toHaveLength(0);
    });

    it("groups same-project worktrees into a single canonical candidate without inventing new project contexts", () => {
      const desktop: OsDesktop = {
        id: "d-1",
        name: "Desk",
        tree: {
          type: "pane",
          id: "p-1",
          items: ["win-term", "win-editor-wt1", "win-files-wt2"],
          active: "win-term",
        },
        floatingWindowIds: [],
      };

      const windows: Record<string, OsWindow> = {
        "win-term": {
          id: "win-term",
          appId: "terminals",
          title: "Dev Server",
          ctx: { profileId: profileAlpha.id, projectId: "dam-hopper" },
          mode: "tile",
          desktopId: "d-1",
          maximized: false,
          minimized: false,
        },
        "win-editor-wt1": {
          id: "win-editor-wt1",
          appId: "editor",
          title: "Feature Auth",
          ctx: {
            profileId: profileAlpha.id,
            projectId: "dam-hopper",
            worktreeId: "worktree-auth",
          },
          mode: "tile",
          desktopId: "d-1",
          maximized: false,
          minimized: false,
        },
        "win-files-wt2": {
          id: "win-files-wt2",
          appId: "files",
          title: "Feature UI",
          ctx: {
            profileId: profileAlpha.id,
            projectId: "dam-hopper",
            worktreeId: "worktree-ui",
          },
          mode: "tile",
          desktopId: "d-1",
          maximized: false,
          minimized: false,
        },
      };

      const candidates = projectSourceWindowsToCandidatePairs({
        desktop,
        windows,
        configuredProfiles: [profileAlpha],
      });

      expect(candidates).toHaveLength(1);
      const cand = candidates[0];
      expect(cand.profileId).toBe(profileAlpha.id);
      expect(cand.projectId).toBe("dam-hopper");
      expect(cand.windowCount).toBe(3);
      expect(cand.terminalCount).toBe(1);
      expect(cand.appCount).toBe(2);
      expect(cand.worktreeIds).toEqual(["worktree-auth", "worktree-ui"]);
      expect(cand.serverName).toBe("Host Alpha");
      expect(cand.isMissingProfile).toBe(false);
    });

    it("preserves missing/offline profile as eligible local identity with warning, not rebound", () => {
      const desktop: OsDesktop = {
        id: "d-1",
        name: "Desk",
        tree: {
          type: "pane",
          id: "p-1",
          items: ["win-offline"],
          active: "win-offline",
        },
        floatingWindowIds: [],
      };

      const windows: Record<string, OsWindow> = {
        "win-offline": {
          id: "win-offline",
          appId: "terminals",
          title: "Offline Host Term",
          ctx: { profileId: "unknown-uuid-profile", projectId: "dam-hopper" },
          mode: "tile",
          desktopId: "d-1",
          maximized: false,
          minimized: false,
        },
      };

      // Configured profiles do not contain "unknown-uuid-profile"
      const candidates = projectSourceWindowsToCandidatePairs({
        desktop,
        windows,
        configuredProfiles: [profileAlpha, profileBeta],
      });

      expect(candidates).toHaveLength(1);
      const cand = candidates[0];
      expect(cand.profileId).toBe("unknown-uuid-profile");
      expect(cand.projectId).toBe("dam-hopper");
      expect(cand.isMissingProfile).toBe(true);
      expect(cand.isOfflineOrDisconnected).toBe(true);
      expect(cand.serverDisambiguator).toContain("offline");
      // Must NOT be rebound to profileAlpha or profileBeta
      expect(cand.profileId).not.toBe(profileAlpha.id);
    });

    it("excludes windows with missing profileId or missing projectId", () => {
      const desktop: OsDesktop = {
        id: "d-1",
        name: "Desk",
        tree: {
          type: "pane",
          id: "p-1",
          items: ["win-no-prof", "win-no-proj"],
          active: "win-no-prof",
        },
        floatingWindowIds: [],
      };

      const windows: Record<string, OsWindow> = {
        "win-no-prof": {
          id: "win-no-prof",
          appId: "editor",
          title: "No Profile",
          ctx: { profileId: "", projectId: "dam-hopper" },
          mode: "tile",
          desktopId: "d-1",
          maximized: false,
          minimized: false,
        },
        "win-no-proj": {
          id: "win-no-proj",
          appId: "files",
          title: "No Project",
          ctx: { profileId: profileAlpha.id, projectId: "" },
          mode: "tile",
          desktopId: "d-1",
          maximized: false,
          minimized: false,
        },
      };

      const candidates = projectSourceWindowsToCandidatePairs({
        desktop,
        windows,
        configuredProfiles: [profileAlpha],
      });
      expect(candidates).toHaveLength(0);
    });
  });

  describe("determineDefaultCandidatePair", () => {
    const candidate1 = {
      profileId: "prof-1",
      projectId: "proj-1",
      windowCount: 2,
      terminalCount: 1,
      appCount: 1,
      worktreeIds: [],
      serverName: "Server 1",
      isMissingProfile: false,
      isOfflineOrDisconnected: false,
    };

    const candidate2 = {
      profileId: "prof-2",
      projectId: "proj-2",
      windowCount: 1,
      terminalCount: 1,
      appCount: 0,
      worktreeIds: [],
      serverName: "Server 2",
      isMissingProfile: false,
      isOfflineOrDisconnected: false,
    };

    it("returns null when candidate list is empty", () => {
      expect(
        determineDefaultCandidatePair({
          candidates: [],
          desktopDefaultCtx: { profileId: "prof-1", projectId: "proj-1" },
        }),
      ).toBeNull();
    });

    it("returns matching candidate when desktop default matches an eligible pair", () => {
      const result = determineDefaultCandidatePair({
        candidates: [candidate1, candidate2],
        desktopDefaultCtx: { profileId: "prof-2", projectId: "proj-2" },
      });
      expect(result).toBe(candidate2);
    });

    it("returns sole eligible candidate when only one candidate exists", () => {
      const result = determineDefaultCandidatePair({
        candidates: [candidate1],
        desktopDefaultCtx: undefined,
      });
      expect(result).toBe(candidate1);
    });

    it("returns null when candidates are mixed and desktop default does not match (requires explicit choice)", () => {
      const result = determineDefaultCandidatePair({
        candidates: [candidate1, candidate2],
        desktopDefaultCtx: { profileId: "prof-unrelated", projectId: "proj-unrelated" },
      });
      expect(result).toBeNull();
    });

    it("returns null when candidates are mixed and desktop default is absent", () => {
      const result = determineDefaultCandidatePair({
        candidates: [candidate1, candidate2],
        desktopDefaultCtx: null,
      });
      expect(result).toBeNull();
    });
  });

  describe("evaluateSourceWindow and projectSourceDesktopWindowsPreview", () => {
    const winTerm: OsWindow = {
      id: "w-term",
      appId: "terminals",
      title: "Terminal 1",
      ctx: { profileId: "p-alpha", projectId: "proj-alpha" },
      mode: "tile",
      desktopId: "d-1",
      maximized: false,
      minimized: false,
    };

    const winWorktree: OsWindow = {
      id: "w-wt",
      appId: "editor",
      title: "Worktree Editor",
      ctx: {
        profileId: "p-alpha",
        projectId: "proj-alpha",
        worktreeId: "wt-auth",
      },
      mode: "tile",
      desktopId: "d-1",
      maximized: false,
      minimized: false,
    };

    const winFleet: OsWindow = {
      id: "w-fleet",
      appId: "recipes",
      title: "Recipes Utility",
      ctx: { profileId: "p-alpha", projectId: "proj-alpha" },
      mode: "tile",
      desktopId: "d-1",
      maximized: false,
      minimized: false,
    };

    const winDiffProf: OsWindow = {
      id: "w-diff-prof",
      appId: "files",
      title: "Files Beta",
      ctx: { profileId: "p-beta", projectId: "proj-alpha" },
      mode: "tile",
      desktopId: "d-1",
      maximized: false,
      minimized: false,
    };

    const winDiffProj: OsWindow = {
      id: "w-diff-proj",
      appId: "files",
      title: "Files Other",
      ctx: { profileId: "p-alpha", projectId: "proj-beta" },
      mode: "tile",
      desktopId: "d-1",
      maximized: false,
      minimized: false,
    };

    const winMissingCtx: OsWindow = {
      id: "w-miss",
      appId: "editor",
      title: "Missing Project Editor",
      ctx: { profileId: "p-alpha" },
      mode: "tile",
      desktopId: "d-1",
      maximized: false,
      minimized: false,
    };

    it("evaluates each category with exact reasons and flags worktrees", () => {
      const evalFleet = evaluateSourceWindow({
        win: winFleet,
        chosenProfileId: "p-alpha",
        chosenProjectId: "proj-alpha",
      });
      expect(evalFleet.isMatch).toBe(false);
      expect(evalFleet.reason).toContain("Contextless / fleet application");

      const evalMissing = evaluateSourceWindow({
        win: winMissingCtx,
        chosenProfileId: "p-alpha",
        chosenProjectId: "proj-alpha",
      });
      expect(evalMissing.isMatch).toBe(false);
      expect(evalMissing.reason).toContain("Missing context / unsupported capture");

      const evalDiffProf = evaluateSourceWindow({
        win: winDiffProf,
        chosenProfileId: "p-alpha",
        chosenProjectId: "proj-alpha",
      });
      expect(evalDiffProf.isMatch).toBe(false);
      expect(evalDiffProf.reason).toContain("Different host profile");

      const evalDiffProj = evaluateSourceWindow({
        win: winDiffProj,
        chosenProfileId: "p-alpha",
        chosenProjectId: "proj-alpha",
      });
      expect(evalDiffProj.isMatch).toBe(false);
      expect(evalDiffProj.reason).toContain("Different project");

      const evalMatch = evaluateSourceWindow({
        win: winTerm,
        chosenProfileId: "p-alpha",
        chosenProjectId: "proj-alpha",
      });
      expect(evalMatch.isMatch).toBe(true);
      expect(evalMatch.isWorktree).toBe(false);

      const evalWtMatch = evaluateSourceWindow({
        win: winWorktree,
        chosenProfileId: "p-alpha",
        chosenProjectId: "proj-alpha",
      });
      expect(evalWtMatch.isMatch).toBe(true);
      expect(evalWtMatch.isWorktree).toBe(true);
      expect(evalWtMatch.worktreeId).toBe("wt-auth");
    });

    it("previews every window without omission", () => {
      const desktop: OsDesktop = {
        id: "d-1",
        name: "Desk 1",
        tree: {
          type: "pane",
          id: "p-1",
          items: [
            "w-term",
            "w-wt",
            "w-fleet",
            "w-diff-prof",
            "w-diff-proj",
            "w-miss",
          ],
          active: "w-term",
        },
        floatingWindowIds: [],
      };

      const windows: Record<string, OsWindow> = {
        "w-term": winTerm,
        "w-wt": winWorktree,
        "w-fleet": winFleet,
        "w-diff-prof": winDiffProf,
        "w-diff-proj": winDiffProj,
        "w-miss": winMissingCtx,
      };

      const preview = projectSourceDesktopWindowsPreview({
        desktop,
        windows,
        chosenProfileId: "p-alpha",
        chosenProjectId: "proj-alpha",
      });

      expect(preview.matchingWindows).toHaveLength(2);
      expect(preview.matchingWindows.map((m) => m.windowId)).toEqual(["w-term", "w-wt"]);
      expect(preview.excludedWindows).toHaveLength(4);
      expect(preview.canSave).toBe(true);
    });
  });

  describe("determineSourceEmptyState", () => {
    const desktop1: OsDesktop = {
      id: "d-1",
      name: "Desktop 1",
      tree: null,
      floatingWindowIds: [],
    };

    const desktop2: OsDesktop = {
      id: "d-2",
      name: "Desktop 2",
      tree: {
        type: "pane",
        id: "p-2",
        items: ["win-d2"],
        active: "win-d2",
      },
      floatingWindowIds: [],
    };

    const windows: Record<string, OsWindow> = {
      "win-d2": {
        id: "win-d2",
        appId: "terminals",
        title: "Terminal on Desk 2",
        ctx: { profileId: "p-alpha", projectId: "proj-alpha" },
        mode: "tile",
        desktopId: "d-2",
        maximized: false,
        minimized: false,
      },
    };

    it("returns 'none' when matching windows exist", () => {
      const res = determineSourceEmptyState({
        desktop: desktop1,
        allDesktops: [desktop1, desktop2],
        windows,
        matchingCount: 2,
        candidatesCount: 2,
      });
      expect(res.type).toBe("none");
    });

    it("returns 'different-selected-context' when desktop has candidates but 0 match chosen context", () => {
      const res = determineSourceEmptyState({
        desktop: desktop1,
        allDesktops: [desktop1, desktop2],
        windows,
        matchingCount: 0,
        candidatesCount: 2,
      });
      expect(res.type).toBe("different-selected-context");
    });

    it("returns 'windows-on-other-desktop' when source desktop is empty but another desktop has eligible windows", () => {
      const res = determineSourceEmptyState({
        desktop: desktop1,
        allDesktops: [desktop1, desktop2],
        windows,
        matchingCount: 0,
        candidatesCount: 0,
      });
      expect(res.type).toBe("windows-on-other-desktop");
      expect(res.otherDesktopsWithWindows).toHaveLength(1);
      expect(res.otherDesktopsWithWindows?.[0].id).toBe("d-2");
    });

    it("returns 'fleet-only-or-empty' when no desktops have eligible project windows", () => {
      const res = determineSourceEmptyState({
        desktop: desktop1,
        allDesktops: [desktop1],
        windows: {},
        matchingCount: 0,
        candidatesCount: 0,
      });
      expect(res.type).toBe("fleet-only-or-empty");
    });
  });
});
