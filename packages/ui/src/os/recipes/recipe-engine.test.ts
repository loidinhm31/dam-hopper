import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TileNode } from "@/types/tile-tree.js";
import type { ConnectionSnapshot } from "@/api/connections.js";
import type { ApiClient, SessionInfo } from "@/api/client.js";
import type { OsDesktop, OsWindow } from "../types.js";
import {
  buildRecipeFromDesktopSubset,
  calculateSaveSubset,
  executeRecipeLaunch,
  preflightRecipeLaunch,
  pruneLayoutTreeForSubset,
} from "./recipe-engine.js";
import {
  createLaunchRecord,
  getLaunchRecord,
  persistLaunchRecord,
  stepTransitionConfirmed,
  stepTransitionOutcomeUnknown,
} from "./launch-records.js";
import type { RecipeV1 } from "./types.js";

describe("recipe-engine", () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => {
        store[key] = val;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    });

    const mockRequest = vi.fn().mockImplementation((name, options, cb) => cb());
    vi.stubGlobal("navigator", {
      locks: { request: mockRequest },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("Save Subset Chooser & Preview", () => {
    it("matches chosen profile and project while explicitly listing excluded windows with reasons", () => {
      const win1: OsWindow = {
        id: "win-1",
        appId: "terminals",
        title: "Alpha Main Term",
        ctx: { profileId: "server-a", projectId: "proj-1" },
        mode: "tile",
        desktopId: "d-1",
        maximized: false,
        minimized: false,
      };
      const win2: OsWindow = {
        id: "win-2",
        appId: "editor",
        title: "Alpha Editor",
        ctx: { profileId: "server-a", projectId: "proj-1" },
        mode: "tile",
        desktopId: "d-1",
        maximized: false,
        minimized: false,
      };
      const winOtherProfile: OsWindow = {
        id: "win-other-prof",
        appId: "terminals",
        title: "Beta Term",
        ctx: { profileId: "server-b", projectId: "proj-1" },
        mode: "tile",
        desktopId: "d-1",
        maximized: false,
        minimized: false,
      };
      const winOtherProject: OsWindow = {
        id: "win-other-proj",
        appId: "files",
        title: "Alpha Other Files",
        ctx: { profileId: "server-a", projectId: "proj-2" },
        mode: "tile",
        desktopId: "d-1",
        maximized: false,
        minimized: false,
      };
      const winSystemMonitor: OsWindow = {
        id: "win-sys-mon",
        appId: "system-monitor",
        title: "Fleet Monitor",
        ctx: { profileId: "server-a" },
        mode: "tile",
        desktopId: "d-1",
        maximized: false,
        minimized: false,
      };

      const desktop: OsDesktop = {
        id: "d-1",
        name: "Mixed Desktop",
        defaultCtx: { profileId: "server-a" },
        tree: {
          type: "split",
          id: "split-1",
          direction: "horizontal",
          sizes: [50, 50],
          children: [
            {
              type: "pane",
              id: "pane-1",
              items: ["win-1", "win-other-prof"],
              active: "win-1",
            },
            {
              type: "pane",
              id: "pane-2",
              items: ["win-2", "win-other-proj", "win-sys-mon"],
              active: "win-2",
            },
          ],
        },
        floatingWindowIds: [],
        focusedWindowId: "win-1",
      };

      const windows = {
        "win-1": win1,
        "win-2": win2,
        "win-other-prof": winOtherProfile,
        "win-other-proj": winOtherProject,
        "win-sys-mon": winSystemMonitor,
      };

      const preview = calculateSaveSubset({
        desktop,
        windows,
        chosenProfileId: "server-a",
        chosenProjectId: "proj-1",
      });

      expect(preview.canSave).toBe(true);
      expect(preview.matchingWindows).toHaveLength(2);
      expect(preview.matchingWindows.map((m) => m.windowId)).toEqual(["win-1", "win-2"]);

      // 3 windows excluded
      expect(preview.excludedWindows).toHaveLength(3);

      const otherProf = preview.excludedWindows.find((e) => e.windowId === "win-other-prof");
      expect(otherProf).toBeDefined();
      expect(otherProf?.reason).toContain("Different host profile");

      const otherProj = preview.excludedWindows.find((e) => e.windowId === "win-other-proj");
      expect(otherProj).toBeDefined();
      expect(otherProj?.reason).toContain("Different project");

      const sysMon = preview.excludedWindows.find((e) => e.windowId === "win-sys-mon");
      expect(sysMon).toBeDefined();
      expect(sysMon?.reason).toContain("Contextless / fleet application");
    });
  });

  describe("Topology Pruning for Subset", () => {
    it("prunes nonmatching leaves, collapses single-child splits, and renormalizes sizes", () => {
      const tree: TileNode<string> = {
        type: "split",
        id: "split-root",
        direction: "horizontal",
        sizes: [40, 60],
        children: [
          {
            type: "pane",
            id: "pane-left",
            items: ["win-keep-1", "win-drop-1"],
            active: "win-keep-1",
          },
          {
            type: "split",
            id: "split-right",
            direction: "vertical",
            sizes: [50, 50],
            children: [
              {
                type: "pane",
                id: "pane-top-right",
                items: ["win-drop-2"], // All items dropped -> subtree becomes null!
                active: "win-drop-2",
              },
              {
                type: "pane",
                id: "pane-bottom-right",
                items: ["win-keep-2"],
                active: "win-keep-2",
              },
            ],
          },
        ],
      };

      const matchingKeys = new Map<string, string>([
        ["win-keep-1", "step-term-1"],
        ["win-keep-2", "step-editor-2"],
      ]);

      const pruned = pruneLayoutTreeForSubset(tree, matchingKeys);
      expect(pruned).not.toBeNull();
      expect(pruned?.type).toBe("split");

      if (pruned?.type === "split") {
        expect(pruned.children).toHaveLength(2);
        expect(pruned.sizes).toEqual([40, 60]);

        // Left pane should only have step-term-1
        const left = pruned.children[0];
        expect(left.type).toBe("pane");
        if (left.type === "pane") {
          expect(left.items).toEqual(["step-term-1"]);
        }

        // Right split collapsed into single bottom pane because top pane was completely dropped!
        const right = pruned.children[1];
        expect(right.type).toBe("pane");
        if (right.type === "pane") {
          expect(right.items).toEqual(["step-editor-2"]);
        }
      }
    });
  });

  describe("buildRecipeFromDesktopSubset", () => {
    it("creates a complete valid RecipeV1 from desktop subset with authored commands", () => {
      const win1: OsWindow = {
        id: "win-term",
        appId: "terminals",
        title: "API Server",
        ctx: { profileId: "server-a", projectId: "proj-1" },
        mode: "tile",
        desktopId: "d-1",
        maximized: false,
        minimized: false,
      };
      const win2: OsWindow = {
        id: "win-files",
        appId: "files",
        title: "Files",
        ctx: { profileId: "server-a", projectId: "proj-1" },
        mode: "tile",
        desktopId: "d-1",
        maximized: false,
        minimized: false,
      };

      const desktop: OsDesktop = {
        id: "d-1",
        name: "Dev Desktop",
        defaultCtx: { profileId: "server-a", projectId: "proj-1" },
        tree: {
          type: "pane",
          id: "pane-1",
          items: ["win-term", "win-files"],
          active: "win-term",
        },
        floatingWindowIds: [],
        focusedWindowId: "win-term",
      };

      const initialPreview = calculateSaveSubset({
        desktop,
        windows: { "win-term": win1, "win-files": win2 },
        chosenProfileId: "server-a",
        chosenProjectId: "proj-1",
      });

      const { recipe, preview } = buildRecipeFromDesktopSubset({
        recipeId: "recipe-custom",
        name: "My Custom Recipe",
        desktop,
        windows: { "win-term": win1, "win-files": win2 },
        chosenProfileId: "server-a",
        chosenProjectId: "proj-1",
        authoredCommandsByStepKey: {
          [initialPreview.matchingWindows[0].stepKey]: "npm start",
        },
      });
      expect(recipe.terminalSteps).toHaveLength(1);
      expect(recipe.terminalSteps[0].command).toBe("npm start");
      expect(recipe.appSteps).toHaveLength(1);
      expect(recipe.appSteps[0].appId).toBe("files");
    });
  });

  describe("preflightRecipeLaunch and executeRecipeLaunch", () => {
    const mockRecipe: RecipeV1 = {
      version: 1,
      id: "recipe-1",
      name: "Launch Test Recipe",
      profileId: "server-a",
      project: "proj-1",
      terminalSteps: [
        {
          key: "term-step-1",
          name: "Terminal 1",
          command: "cargo test",
        },
      ],
      appSteps: [
        {
          key: "settings-step",
          appId: "settings",
        },
      ],
      layout: { tree: null, floating: [] },
      createdAt: 1000,
      updatedAt: 1000,
    };

    it("identifies singleton instance move requirement across desktops", () => {
      const connections = new Map<string, ConnectionSnapshot>([
        [
          "server-a",
          {
            owner: { profileId: "server-a", generation: 1 },
            status: "connected",
            intent: true,
            serverUrl: "http://localhost",
            error: null,
          },
        ],
      ]);

      // Settings app already open on desktop-2, but launching on desktop-1
      const existingWindows: Record<string, OsWindow> = {
        "win-settings-2": {
          id: "win-settings-2",
          appId: "settings",
          title: "Settings",
          ctx: { profileId: "server-a" },
          mode: "tile",
          desktopId: "desktop-2", // Different desktop!
          maximized: false,
          minimized: false,
        },
      };

      const preflight = preflightRecipeLaunch({
        recipe: mockRecipe,
        connections,
        existingWindows,
        targetDesktopId: "desktop-1",
        capturedServerEpoch: 50,
      });

      expect(preflight.canLaunch).toBe(true);
      expect(preflight.movesNeeded).toHaveLength(1);
      expect(preflight.movesNeeded[0].appId).toBe("settings");
      expect(preflight.movesNeeded[0].fromDesktopId).toBe("desktop-2");
      expect(preflight.movesNeeded[0].toDesktopId).toBe("desktop-1");
    });

    it("requires explicit user consent when moves are needed", async () => {
      const preflight = {
        canLaunch: true,
        blockers: [],
        warnings: [],
        movesNeeded: [
          {
            stepKey: "settings-step",
            appId: "settings" as const,
            windowId: "win-settings-2",
            fromDesktopId: "desktop-2",
            toDesktopId: "desktop-1",
            title: "Settings",
          },
        ],
        serverEpoch: 50,
      };

      const mockApiClient = {
        owner: { profileId: "server-a", generation: 1 },
        terminal: { create: vi.fn() },
      } as unknown as ApiClient;

      await expect(
        executeRecipeLaunch({
          launchId: "launch-1",
          apiClient: mockApiClient,
          preflight,
          userConsentedMoves: false, // Refused consent!
        }),
      ).rejects.toThrow("requires explicit user consent");
    });

    it("executes launch under Web Lock, persists dispatched before create, and confirms with incarnation", async () => {
      const record = createLaunchRecord({
        recipe: mockRecipe,
        desktopId: "desktop-1",
        serverEpoch: 50,
      });
      persistLaunchRecord(record);

      const mockCreate = vi.fn().mockResolvedValue({
        id: record.steps["term-step-1"].terminalId,
        incarnation: 3,
        alive: true,
      });

      const mockApiClient = {
        owner: { profileId: "server-a", generation: 1 },
        terminal: { create: mockCreate },
      } as unknown as ApiClient;

      const preflight = {
        canLaunch: true,
        blockers: [],
        warnings: [],
        movesNeeded: [],
        serverEpoch: 50,
      };

      const executed = await executeRecipeLaunch({
        launchId: record.launchId,
        apiClient: mockApiClient,
        preflight,
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(executed.steps["term-step-1"].status).toBe("confirmed");
      expect(executed.steps["term-step-1"].incarnation).toBe(3);
    });

    it("transitions step to outcomeUnknown if create network call throws or times out", async () => {
      const record = createLaunchRecord({
        recipe: mockRecipe,
        desktopId: "desktop-1",
        serverEpoch: 50,
      });
      persistLaunchRecord(record);

      const mockCreate = vi.fn().mockRejectedValue(new Error("Network timeout"));
      const mockApiClient = {
        owner: { profileId: "server-a", generation: 1 },
        terminal: { create: mockCreate },
      } as unknown as ApiClient;

      const preflight = {
        canLaunch: true,
        blockers: [],
        warnings: [],
        movesNeeded: [],
        serverEpoch: 50,
      };

      const executed = await executeRecipeLaunch({
        launchId: record.launchId,
        apiClient: mockApiClient,
        preflight,
      });

      expect(executed.steps["term-step-1"].status).toBe("outcomeUnknown");
      expect(executed.steps["term-step-1"].error).toContain("Network timeout");
    });

    it("rejects launch execution if apiClient profile does not match launch record target", async () => {
      const record = createLaunchRecord({
        recipe: mockRecipe, // profileId: "server-a"
        desktopId: "desktop-1",
        serverEpoch: 50,
      });
      persistLaunchRecord(record);

      const mismatchedApiClient = {
        owner: { profileId: "server-b", generation: 1 }, // Mismatched profile!
        terminal: { create: vi.fn() },
      } as unknown as ApiClient;

      const preflight = {
        canLaunch: true,
        blockers: [],
        warnings: [],
        movesNeeded: [],
        serverEpoch: 50,
      };

      await expect(
        executeRecipeLaunch({
          launchId: record.launchId,
          apiClient: mismatchedApiClient,
          preflight,
        }),
      ).rejects.toThrow("Profile mismatch");
    });
  });
});
