import type { OsDesktop, OsWindow, WindowContext } from "./types.js";
import type { TileNode } from "@/types/tile-tree.js";
import { generateUUID } from "@/lib/utils.js";
import { APP_MANIFESTS } from "./app-registry.js";

export interface ProjectDesktopResult {
  desktop: OsDesktop;
  windows: OsWindow[];
}

/**
 * Creates the approved project-desktop layout:
 * - 60% Terminals (primary left pane)
 * - 40% side split:
 *   - Top pane (50%): Files tabbed with Search (active: Files)
 *   - Bottom pane (50%): Git tabbed with Changes (active: Git)
 */
export function createProjectDesktopTemplate(
  name: string,
  ctx: WindowContext,
  desktopId: string = `desktop-${generateUUID().slice(0, 8)}`,
): ProjectDesktopResult {
  const termWinId = `terminals-${generateUUID().slice(0, 8)}`;
  const filesWinId = `files-${generateUUID().slice(0, 8)}`;
  const searchWinId = `search-${generateUUID().slice(0, 8)}`;
  const gitWinId = `git-${generateUUID().slice(0, 8)}`;
  const changesWinId = `changes-${generateUUID().slice(0, 8)}`;

  const tree: TileNode<string> = {
    type: "split",
    id: generateUUID(),
    direction: "horizontal",
    sizes: [60, 40],
    children: [
      {
        type: "pane",
        id: generateUUID(),
        items: [termWinId],
        active: termWinId,
      },
      {
        type: "split",
        id: generateUUID(),
        direction: "vertical",
        sizes: [50, 50],
        children: [
          {
            type: "pane",
            id: generateUUID(),
            items: [filesWinId, searchWinId],
            active: filesWinId,
          },
          {
            type: "pane",
            id: generateUUID(),
            items: [gitWinId, changesWinId],
            active: gitWinId,
          },
        ],
      },
    ],
  };

  const termWin: OsWindow = {
    id: termWinId,
    appId: "terminals",
    title: APP_MANIFESTS.terminals.displayName,
    ctx,
    mode: "tile",
    desktopId,
    maximized: false,
    minimized: false,
  };

  const filesWin: OsWindow = {
    id: filesWinId,
    appId: "files",
    title: APP_MANIFESTS.files.displayName,
    ctx,
    mode: "tile",
    desktopId,
    maximized: false,
    minimized: false,
  };

  const searchWin: OsWindow = {
    id: searchWinId,
    appId: "search",
    title: APP_MANIFESTS.search.displayName,
    ctx,
    mode: "tile",
    desktopId,
    maximized: false,
    minimized: false,
  };

  const gitWin: OsWindow = {
    id: gitWinId,
    appId: "git",
    title: APP_MANIFESTS.git.displayName,
    ctx,
    mode: "tile",
    desktopId,
    maximized: false,
    minimized: false,
  };

  const changesWin: OsWindow = {
    id: changesWinId,
    appId: "changes",
    title: APP_MANIFESTS.changes.displayName,
    ctx,
    mode: "tile",
    desktopId,
    maximized: false,
    minimized: false,
  };

  const desktop: OsDesktop = {
    id: desktopId,
    name,
    defaultCtx: ctx,
    tree,
    floatingWindowIds: [],
    focusedWindowId: termWinId,
  };

  return {
    desktop,
    windows: [termWin, filesWin, searchWin, gitWin, changesWin],
  };
}

export interface AgentHubDesktopResult {
  desktop: OsDesktop;
  windows: OsWindow[];
}

/**
 * Creates the approved Agent Hub home desktop layout:
 * - Desktop 1 "Hub" (singleton / minimumCtx: none)
 * - Agent Hub window tiled/maximized occupying the pane
 */
export function createAgentHubDesktopTemplate(
  name: string = "Hub",
  desktopId: string = "desktop-hub",
): AgentHubDesktopResult {
  const hubWinId = `agent-hub-${generateUUID().slice(0, 8)}`;
  const tree: TileNode<string> = {
    type: "pane",
    id: generateUUID(),
    items: [hubWinId],
    active: hubWinId,
  };

  const hubWin: OsWindow = {
    id: hubWinId,
    appId: "agent-hub",
    title: APP_MANIFESTS["agent-hub"].displayName,
    ctx: { profileId: "" },
    mode: "tile",
    desktopId,
    maximized: true,
    minimized: false,
  };

  const desktop: OsDesktop = {
    id: desktopId,
    name,
    defaultCtx: { profileId: "" },
    tree,
    floatingWindowIds: [],
    focusedWindowId: hubWinId,
  };

  return {
    desktop,
    windows: [hubWin],
  };
}
