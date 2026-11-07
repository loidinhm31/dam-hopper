import type { TileNode } from "@/types/tile-tree.js";
import type { OsAppId, OsDesktop, OsWindow, WindowContext } from "../types.js";
import type { ServerProfile } from "@/api/server-config.js";
import type { ConnectionSnapshot, ConnectionStatus } from "@/api/connections.js";
import type {
  ExcludedWindowPreview,
  MatchingWindowPreview,
  RecipeStepKey,
} from "./types.js";

/**
 * Contextless / fleet applications excluded from single-project recipe capture.
 */
export const FLEET_APP_IDS: ReadonlySet<OsAppId> = new Set<OsAppId>([
  "system-monitor",
  "settings",
  "agent-hub",
  "recipes",
]);

/**
 * Determines whether an application ID belongs to a fleet / contextless utility.
 */
export function isFleetUtility(appId: OsAppId | string): boolean {
  return FLEET_APP_IDS.has(appId as OsAppId);
}

/**
 * Canonical target pair: (profileId, projectId).
 */
export interface CanonicalContextPair {
  readonly profileId: string;
  readonly projectId: string;
}

/**
 * Candidate target pair derived from actual project-bearing windows on a source desktop.
 */
export interface CanonicalContextCandidate extends CanonicalContextPair {
  readonly windowCount: number;
  readonly terminalCount: number;
  readonly appCount: number;
  readonly worktreeIds: readonly string[];
  readonly serverName: string;
  readonly serverDisambiguator?: string;
  readonly isMissingProfile: boolean;
  readonly isOfflineOrDisconnected: boolean;
  readonly connectionStatus?: ConnectionStatus;
}

/**
 * Collects all window IDs present on a desktop (both tiled and floating).
 */
export function collectDesktopWindowIds(desktop: OsDesktop): string[] {
  const windowIds: string[] = [];
  const seen = new Set<string>();

  function collectTree(node: TileNode<string> | null | undefined) {
    if (!node) return;
    if (node.type === "pane" && Array.isArray(node.items)) {
      for (const item of node.items) {
        if (!seen.has(item)) {
          seen.add(item);
          windowIds.push(item);
        }
      }
    } else if (node.type === "split" && Array.isArray(node.children)) {
      for (const child of node.children) {
        collectTree(child);
      }
    }
  }

  collectTree(desktop.tree);
  if (Array.isArray(desktop.floatingWindowIds)) {
    for (const id of desktop.floatingWindowIds) {
      if (!seen.has(id)) {
        seen.add(id);
        windowIds.push(id);
      }
    }
  }

  return windowIds;
}

/**
 * Builds a lookup map for server profile display names and disambiguators.
 * Duplicate profile names receive a stable ID suffix disambiguator.
 */
export function buildProfileNameMap(
  profiles: readonly ServerProfile[] = [],
): Map<string, { name: string; disambiguator?: string }> {
  const nameCounts = new Map<string, number>();
  for (const p of profiles) {
    nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
  }

  const result = new Map<string, { name: string; disambiguator?: string }>();
  for (const p of profiles) {
    const isDuplicate = (nameCounts.get(p.name) ?? 0) > 1;
    result.set(p.id, {
      name: p.name,
      disambiguator: isDuplicate ? p.id.slice(-6) : undefined,
    });
  }
  return result;
}

/**
 * Projects actual source desktop windows into counted canonical (profileId, projectId) pairs.
 * Contextless / fleet utilities and context-missing windows are excluded from candidate pairs.
 * Same-project worktrees are grouped under the same canonical project identity.
 */
export function projectSourceWindowsToCandidatePairs(options: {
  desktop: OsDesktop;
  windows: Record<string, OsWindow>;
  configuredProfiles?: readonly ServerProfile[];
  connectionSnapshots?: Record<string, ConnectionSnapshot>;
}): CanonicalContextCandidate[] {
  const {
    desktop,
    windows,
    configuredProfiles = [],
    connectionSnapshots = {},
  } = options;
  const windowIds = collectDesktopWindowIds(desktop);
  const profileNames = buildProfileNameMap(configuredProfiles);
  const configuredProfileIds = new Set(configuredProfiles.map((p) => p.id));

  interface GroupAccumulator {
    profileId: string;
    projectId: string;
    windowCount: number;
    terminalCount: number;
    appCount: number;
    worktreeIds: Set<string>;
  }

  const groups = new Map<string, GroupAccumulator>();

  for (const winId of windowIds) {
    const win = windows[winId];
    if (!win) continue;

    // Exclude contextless/fleet utilities
    if (isFleetUtility(win.appId)) {
      continue;
    }

    const profileId = win.ctx?.profileId?.trim();
    const projectId = win.ctx?.projectId?.trim();

    // Must have valid profile and project identity
    if (!profileId || !projectId) {
      continue;
    }

    const canonicalKey = `${profileId}:::${projectId}`;
    let group = groups.get(canonicalKey);
    if (!group) {
      group = {
        profileId,
        projectId,
        windowCount: 0,
        terminalCount: 0,
        appCount: 0,
        worktreeIds: new Set<string>(),
      };
      groups.set(canonicalKey, group);
    }

    group.windowCount++;
    if (win.appId === "terminals") {
      group.terminalCount++;
    } else {
      group.appCount++;
    }

    if (win.ctx?.worktreeId?.trim()) {
      group.worktreeIds.add(win.ctx.worktreeId.trim());
    }
  }

  const candidates: CanonicalContextCandidate[] = [];

  for (const group of groups.values()) {
    const isConfigured = configuredProfileIds.has(group.profileId);
    const profileMeta = profileNames.get(group.profileId);
    const snapshot = connectionSnapshots[group.profileId];

    let serverName: string;
    let serverDisambiguator: string | undefined;
    let isMissingProfile: boolean;
    let isOfflineOrDisconnected: boolean;
    let connectionStatus: ConnectionStatus | undefined;

    if (isConfigured && profileMeta) {
      serverName = profileMeta.name;
      serverDisambiguator = profileMeta.disambiguator;
      isMissingProfile = false;
      connectionStatus = snapshot?.status ?? "disconnected";
      isOfflineOrDisconnected = connectionStatus !== "connected";
    } else {
      // Missing profile remains an offline eligible local identity with warning,
      // never rebound to a configured profile sharing its name.
      serverName = group.profileId;
      serverDisambiguator = "offline / unconfigured";
      isMissingProfile = true;
      connectionStatus = "offline";
      isOfflineOrDisconnected = true;
    }

    candidates.push({
      profileId: group.profileId,
      projectId: group.projectId,
      windowCount: group.windowCount,
      terminalCount: group.terminalCount,
      appCount: group.appCount,
      worktreeIds: Array.from(group.worktreeIds).sort(),
      serverName,
      serverDisambiguator,
      isMissingProfile,
      isOfflineOrDisconnected,
      connectionStatus,
    });
  }

  // Sort descending by windowCount, then alphabetically by profileId, projectId
  candidates.sort((a, b) => {
    if (b.windowCount !== a.windowCount) {
      return b.windowCount - a.windowCount;
    }
    const profCmp = a.profileId.localeCompare(b.profileId);
    if (profCmp !== 0) return profCmp;
    return a.projectId.localeCompare(b.projectId);
  });

  return candidates;
}

/**
 * Determines default candidate pair:
 * - matching desktop default if eligible,
 * - otherwise sole eligible pair,
 * - mixed candidates require explicit choice (returns null).
 */
export function determineDefaultCandidatePair(options: {
  candidates: readonly CanonicalContextCandidate[];
  desktopDefaultCtx?: { profileId?: string; projectId?: string } | null;
}): CanonicalContextCandidate | null {
  const { candidates, desktopDefaultCtx } = options;
  if (!candidates || candidates.length === 0) {
    return null;
  }

  // Check matching desktop default if eligible
  if (desktopDefaultCtx?.profileId && desktopDefaultCtx?.projectId) {
    const match = candidates.find(
      (c) =>
        c.profileId === desktopDefaultCtx.profileId &&
        c.projectId === desktopDefaultCtx.projectId,
    );
    if (match) {
      return match;
    }
  }

  // Sole eligible pair
  if (candidates.length === 1) {
    return candidates[0];
  }

  // Mixed candidates require explicit choice
  return null;
}

export interface WindowEvaluationResult {
  readonly isMatch: boolean;
  readonly reason?: string;
  readonly isWorktree: boolean;
  readonly worktreeId?: string;
}

/**
 * Pure evaluation of a window against target context:
 * Checks fleet utility and missing context BEFORE target match/mismatch.
 */
export function evaluateSourceWindow(options: {
  win: OsWindow;
  chosenProfileId: string;
  chosenProjectId: string;
}): WindowEvaluationResult {
  const { win, chosenProfileId, chosenProjectId } = options;

  // 1. Contextless / fleet utility check
  if (isFleetUtility(win.appId)) {
    return {
      isMatch: false,
      reason: `Contextless / fleet application (${win.title}) cannot be captured in project recipe`,
      isWorktree: false,
    };
  }

  // 2. Missing context check
  const winProfile = win.ctx?.profileId?.trim();
  const winProject = win.ctx?.projectId?.trim();
  if (!winProfile || !winProject) {
    return {
      isMatch: false,
      reason: "Missing context / unsupported capture: host profile or project missing",
      isWorktree: false,
    };
  }

  // 3. Unselected context check
  if (!chosenProfileId.trim() || !chosenProjectId.trim()) {
    return {
      isMatch: false,
      reason: "No target server or project selected",
      isWorktree: false,
    };
  }

  // 4. Server profile mismatch
  if (winProfile !== chosenProfileId.trim()) {
    return {
      isMatch: false,
      reason: `Different host profile (${winProfile || "unknown"}, not chosen ${chosenProfileId})`,
      isWorktree: false,
    };
  }

  // 5. Project mismatch
  if (winProject !== chosenProjectId.trim()) {
    return {
      isMatch: false,
      reason: `Different project (${winProject || "none"}, not chosen ${chosenProjectId})`,
      isWorktree: false,
    };
  }

  // 6. Match! Same-project worktree is included
  const worktreeId = win.ctx?.worktreeId?.trim() || undefined;
  return {
    isMatch: true,
    isWorktree: Boolean(worktreeId),
    worktreeId,
  };
}

export interface ExtendedMatchingWindowPreview extends MatchingWindowPreview {
  readonly isWorktree: boolean;
  readonly worktreeId?: string;
}

/**
 * Previews every source window on the desktop as included or excluded with a clear reason.
 */
export function projectSourceDesktopWindowsPreview(options: {
  desktop: OsDesktop;
  windows: Record<string, OsWindow>;
  chosenProfileId: string;
  chosenProjectId: string;
}): {
  matchingWindows: ExtendedMatchingWindowPreview[];
  excludedWindows: ExcludedWindowPreview[];
  canSave: boolean;
} {
  const { desktop, windows, chosenProfileId, chosenProjectId } = options;
  const windowIds = collectDesktopWindowIds(desktop);
  const matching: ExtendedMatchingWindowPreview[] = [];
  const excluded: ExcludedWindowPreview[] = [];

  for (const winId of windowIds) {
    const win = windows[winId];
    if (!win) continue;

    const evaluation = evaluateSourceWindow({
      win,
      chosenProfileId,
      chosenProjectId,
    });

    if (evaluation.isMatch) {
      const stepKey: RecipeStepKey = `step-${win.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      matching.push({
        windowId: win.id,
        title: win.title,
        appId: win.appId,
        ctx: win.ctx,
        stepKey,
        isWorktree: evaluation.isWorktree,
        worktreeId: evaluation.worktreeId,
      });
    } else {
      excluded.push({
        windowId: win.id,
        title: win.title,
        appId: win.appId,
        ctx: win.ctx,
        reason: evaluation.reason ?? "Excluded from project recipe",
      });
    }
  }

  return {
    matchingWindows: matching,
    excludedWindows: excluded,
    canSave: matching.length > 0 && Boolean(chosenProfileId) && Boolean(chosenProjectId),
  };
}

export type RecipeSourceEmptyState =
  | "none"
  | "fleet-only-or-empty"
  | "windows-on-other-desktop"
  | "different-selected-context";

/**
 * Distinguishes empty states:
 * - fleet-only/no project windows on source desktop
 * - valid windows on different desktop
 * - different selected context
 */
export function determineSourceEmptyState(options: {
  desktop: OsDesktop;
  allDesktops: readonly OsDesktop[];
  windows: Record<string, OsWindow>;
  matchingCount: number;
  candidatesCount: number;
}): {
  type: RecipeSourceEmptyState;
  otherDesktopsWithWindows?: { id: string; name: string; windowCount: number }[];
} {
  const { desktop, allDesktops, windows, matchingCount, candidatesCount } = options;

  if (matchingCount > 0) {
    return { type: "none" };
  }

  // If source desktop has candidates, but matchingCount is 0 -> different context chosen
  if (candidatesCount > 0) {
    return { type: "different-selected-context" };
  }

  // Source desktop has 0 candidates. Check if other desktops have eligible project windows
  const otherDesktopsWithWindows: { id: string; name: string; windowCount: number }[] = [];
  for (const d of allDesktops) {
    if (d.id === desktop.id) continue;
    const ids = collectDesktopWindowIds(d);
    let eligibleCount = 0;
    for (const id of ids) {
      const w = windows[id];
      if (
        w &&
        !isFleetUtility(w.appId) &&
        w.ctx?.profileId?.trim() &&
        w.ctx?.projectId?.trim()
      ) {
        eligibleCount++;
      }
    }
    if (eligibleCount > 0) {
      otherDesktopsWithWindows.push({
        id: d.id,
        name: d.name,
        windowCount: eligibleCount,
      });
    }
  }

  if (otherDesktopsWithWindows.length > 0) {
    return {
      type: "windows-on-other-desktop",
      otherDesktopsWithWindows,
    };
  }

  return { type: "fleet-only-or-empty" };
}
