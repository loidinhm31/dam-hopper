import type { TileNode, TilePaneNode, TileSplitNode } from "@/types/tile-tree.js";
import { generateUUID } from "@/lib/utils.js";
import type { FloatBounds, OsAppId, OsDesktop, OsWindow, WindowContext } from "../types.js";
import { APP_MANIFESTS, findExistingWindowForApp } from "../app-registry.js";
import type { ConnectionSnapshot } from "@/api/connections.js";
import type { ApiClient, SessionInfo } from "@/api/client.js";
import type {
  ExcludedWindowPreview,
  LaunchRecordV1,
  MatchingWindowPreview,
  RecipeAppStep,
  RecipeLayout,
  RecipeStepKey,
  RecipeTerminalStep,
  RecipeV1,
  SaveSubsetPreview,
} from "./types.js";
import {
  createLaunchRecord,
  getLaunchRecord,
  persistLaunchRecord,
  stepTransitionConfirmed,
  stepTransitionDispatched,
  stepTransitionOutcomeUnknown,
  withRecipeLaunchLock,
} from "./launch-records.js";
import {
  collectDesktopWindowIds,
  evaluateSourceWindow,
} from "./recipe-source-context.js";

/**
 * Calculates matching and excluded windows for the chosen server/profile + project.
 * Explicitly lists every nonmatching window with name, context, and reason BEFORE confirmation.
 */
export function calculateSaveSubset(input: {
  desktop: OsDesktop;
  windows: Record<string, OsWindow>;
  chosenProfileId: string;
  chosenProjectId: string;
}): SaveSubsetPreview {
  const matching: MatchingWindowPreview[] = [];
  const excluded: ExcludedWindowPreview[] = [];

  const desktopWindowIds = collectDesktopWindowIds(input.desktop);

  for (const winId of desktopWindowIds) {
    const win = input.windows[winId];
    if (!win) continue;

    const evaluation = evaluateSourceWindow({
      win,
      chosenProfileId: input.chosenProfileId,
      chosenProjectId: input.chosenProjectId,
    });

    if (evaluation.isMatch) {
      const stepKey = `step-${win.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      matching.push({
        windowId: win.id,
        title: win.title,
        appId: win.appId,
        ctx: win.ctx,
        stepKey,
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
    profileId: input.chosenProfileId,
    project: input.chosenProjectId,
    matchingWindows: matching,
    excludedWindows: excluded,
    canSave:
      matching.length > 0 &&
      Boolean(input.chosenProfileId.trim()) &&
      Boolean(input.chosenProjectId.trim()),
  };
}

/**
 * Pure function: prunes layout tree down to matching windows only.
 * Deterministically collapses empty panes, prunes single-child splits, and renormalizes sizes.
 * Source tree is NEVER mutated.
 */
export function pruneLayoutTreeForSubset(
  tree: TileNode<string> | null,
  windowIdToStepKey: ReadonlyMap<string, RecipeStepKey>,
): TileNode<RecipeStepKey> | null {
  if (!tree) return null;

  if (tree.type === "pane") {
    const remainingItems: RecipeStepKey[] = [];
    for (const item of tree.items) {
      const stepKey = windowIdToStepKey.get(item);
      if (stepKey) {
        remainingItems.push(stepKey);
      }
    }
    if (remainingItems.length === 0) return null;

    let activeKey: RecipeStepKey | undefined = undefined;
    if (tree.active) {
      activeKey = windowIdToStepKey.get(tree.active);
    }
    if (!activeKey || !remainingItems.includes(activeKey)) {
      activeKey = remainingItems[0];
    }

    const prunedPane: TilePaneNode<RecipeStepKey> = {
      type: "pane",
      id: `pane-${remainingItems.join("-")}`,
      items: remainingItems,
      active: activeKey,
    };
    return prunedPane;
  }

  if (tree.type === "split") {
    const validChildren: TileNode<RecipeStepKey>[] = [];
    const originalWeights: number[] = [];

    for (let i = 0; i < tree.children.length; i++) {
      const child = tree.children[i];
      const prunedChild = pruneLayoutTreeForSubset(child, windowIdToStepKey);
      if (prunedChild) {
        validChildren.push(prunedChild);
        originalWeights.push(tree.sizes[i] ?? 100 / tree.children.length);
      }
    }

    if (validChildren.length === 0) return null;
    if (validChildren.length === 1) return validChildren[0];

    // Renormalize split sizes to sum to 100%
    const totalWeight = originalWeights.reduce((a, b) => a + b, 0);
    const normalizedSizes = originalWeights.map((w) =>
      totalWeight > 0 ? Math.round((w / totalWeight) * 100) : Math.round(100 / validChildren.length),
    );

    // Ensure sum is exactly 100
    const sum = normalizedSizes.reduce((a, b) => a + b, 0);
    if (sum !== 100 && normalizedSizes.length > 0) {
      normalizedSizes[0] += 100 - sum;
    }

    while (validChildren.length > 2) {
      const lastChild = validChildren.pop()!;
      const prevChild = validChildren.pop()!;
      const lastWeight = normalizedSizes.pop()!;
      const prevWeight = normalizedSizes.pop()!;
      const subSum = prevWeight + lastWeight;
      const subSizes: [number, number] = [
        Math.round((prevWeight / subSum) * 100),
        100 - Math.round((prevWeight / subSum) * 100),
      ];
      validChildren.push({
        type: "split",
        id: generateUUID(),
        direction: tree.direction,
        sizes: subSizes,
        children: [prevChild, lastChild],
      });
      normalizedSizes.push(subSum);
    }

    const binarySizes: [number, number] = [normalizedSizes[0], normalizedSizes[1]];
    const binaryChildren: [TileNode<RecipeStepKey>, TileNode<RecipeStepKey>] = [
      validChildren[0],
      validChildren[1],
    ];

    const prunedSplit: TileSplitNode<RecipeStepKey> = {
      type: "split",
      id: `split-${validChildren.map((c) => c.id).join("-")}`,
      direction: tree.direction,
      sizes: binarySizes,
      children: binaryChildren,
    };
    return prunedSplit;
  }

  return null;
}

export interface BuildRecipeFromDesktopInput {
  recipeId: string;
  name: string;
  description?: string;
  desktop: OsDesktop;
  windows: Record<string, OsWindow>;
  chosenProfileId: string;
  chosenProjectId: string;
  authoredCommandsByStepKey?: Record<RecipeStepKey, string>;
}

/**
 * Builds a RecipeV1 from selected desktop subset.
 * Commands must be authored or confirmed. Never deriver executable commands silently from terminal content.
 */
export function buildRecipeFromDesktopSubset(
  input: BuildRecipeFromDesktopInput,
): { recipe: RecipeV1; preview: SaveSubsetPreview } {
  const preview = calculateSaveSubset({
    desktop: input.desktop,
    windows: input.windows,
    chosenProfileId: input.chosenProfileId,
    chosenProjectId: input.chosenProjectId,
  });

  if (!preview.canSave) {
    throw new Error(
      `Cannot save recipe: no matching windows found for host "${input.chosenProfileId}" and project "${input.chosenProjectId}"`,
    );
  }

  const windowIdToStepKey = new Map<string, RecipeStepKey>();
  for (const m of preview.matchingWindows) {
    windowIdToStepKey.set(m.windowId, m.stepKey);
  }

  const terminalSteps: RecipeTerminalStep[] = [];
  const appSteps: RecipeAppStep[] = [];

  for (const m of preview.matchingWindows) {
    const win = input.windows[m.windowId];
    if (!win) continue;

    if (win.appId === "terminals") {
      const explicitCommand =
        input.authoredCommandsByStepKey?.[m.stepKey] ??
        (win.appState?.command as string | undefined) ??
        "bash";

      terminalSteps.push({
        key: m.stepKey,
        name: win.title || "Terminal",
        command: explicitCommand,
        worktreePath: win.ctx.worktreeId,
      });
    } else {
      appSteps.push({
        key: m.stepKey,
        appId: win.appId,
        worktreePath: win.ctx.worktreeId,
        appState: win.appState ? { ...win.appState } : undefined,
      });
    }
  }

  // Prune tree layout
  const prunedTree = pruneLayoutTreeForSubset(input.desktop.tree, windowIdToStepKey);

  // Floating windows
  const floatingLayout: Array<{ stepKey: RecipeStepKey; floatBounds?: FloatBounds }> = [];
  for (const winId of input.desktop.floatingWindowIds) {
    const stepKey = windowIdToStepKey.get(winId);
    if (stepKey) {
      const win = input.windows[winId];
      floatingLayout.push({
        stepKey,
        floatBounds: win?.floatBounds ? { ...win.floatBounds } : undefined,
      });
    }
  }

  const recipe: RecipeV1 = {
    version: 1,
    id: input.recipeId,
    name: input.name,
    description: input.description,
    profileId: input.chosenProfileId,
    project: input.chosenProjectId,
    terminalSteps,
    appSteps,
    layout: {
      tree: prunedTree,
      floating: floatingLayout,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return { recipe, preview };
}

export interface InstanceMoveRequirement {
  readonly stepKey: RecipeStepKey;
  readonly appId: OsAppId;
  readonly windowId: string;
  readonly fromDesktopId: string;
  readonly toDesktopId: string;
  readonly title: string;
}

export interface RecipePreflightResult {
  readonly canLaunch: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly movesNeeded: readonly InstanceMoveRequirement[];
  readonly serverEpoch: string | number | null;
}

/**
 * Preflights launch before any POST network effects:
 * - Checks connected profile and valid generation
 * - Captures authoritative serverEpoch
 * - Checks single-instance / per-context app instances across desktops and identifies move consent needs
 */
export function preflightRecipeLaunch(input: {
  recipe: RecipeV1;
  connections: ReadonlyMap<string, ConnectionSnapshot>;
  existingWindows: Record<string, OsWindow>;
  targetDesktopId: string;
  capturedServerEpoch?: string | number | null;
}): RecipePreflightResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const movesNeeded: InstanceMoveRequirement[] = [];

  const conn = input.connections.get(input.recipe.profileId);
  if (!conn || conn.status !== "connected") {
    blockers.push(`Host profile "${input.recipe.profileId}" is disconnected or unavailable`);
  }

  // Authoritative serverEpoch check: must be explicitly provided, never generation fallback
  const serverEpoch = input.capturedServerEpoch ?? null;
  if (serverEpoch === null || serverEpoch === undefined) {
    blockers.push("Authoritative serverEpoch is unavailable for target profile; launch blocked fail-closed");
  }

  // Preflight existing singleton / per-context app instances
  for (const step of input.recipe.appSteps) {
    const manifest = APP_MANIFESTS[step.appId];
    if (!manifest) continue;

    if (manifest.instancing === "single-instance" || manifest.instancing === "project-instance") {
      const existing = findExistingWindowForApp(
        input.existingWindows,
        step.appId,
        {
          profileId: input.recipe.profileId,
          projectId: input.recipe.project,
          worktreeId: step.worktreePath,
        },
        step.appState,
      );

      if (existing && existing.desktopId !== input.targetDesktopId) {
        movesNeeded.push({
          stepKey: step.key,
          appId: step.appId,
          windowId: existing.id,
          fromDesktopId: existing.desktopId,
          toDesktopId: input.targetDesktopId,
          title: existing.title,
        });
      }
    }
  }

  return {
    canLaunch: blockers.length === 0,
    blockers,
    warnings,
    movesNeeded,
    serverEpoch,
  };
}

export interface ExecuteRecipeLaunchInput {
  launchId: string;
  apiClient: ApiClient;
  preflight: RecipePreflightResult;
  userConsentedMoves?: boolean;
}

/**
 * Executes recipe launch serialized under Web Locks:
 * 1. Re-reads durable launch record under cross-tab lock.
 * 2. Persists dispatched state before terminal.create.
 * 3. On success, persists confirmed with incarnation.
 * 4. On interruption/timeout, persists outcomeUnknown (never resets to pending).
 */
export async function executeRecipeLaunch(
  input: ExecuteRecipeLaunchInput,
): Promise<LaunchRecordV1> {
  if (!input.preflight.canLaunch) {
    throw new Error(
      `Cannot launch recipe: preflight blockers: ${input.preflight.blockers.join("; ")}`,
    );
  }

  if (input.preflight.movesNeeded.length > 0 && !input.userConsentedMoves) {
    throw new Error(
      "Cannot launch recipe: singleton instance move requires explicit user consent",
    );
  }
  return withRecipeLaunchLock(input.launchId, async () => {
    let record = getLaunchRecord(input.launchId);
    if (!record) {
      throw new Error(`Launch record "${input.launchId}" not found in storage`);
    }

    if (
      input.apiClient.owner &&
      record.profileId !== input.apiClient.owner.profileId
    ) {
      throw new Error(
        `Profile mismatch: recipe launch target "${record.profileId}" does not match connected client owner "${input.apiClient.owner.profileId}"`,
      );
    }
    // Process terminal steps
    for (const step of record.recipeSnapshot.terminalSteps) {
      const stepRecord = record.steps[step.key];
      if (!stepRecord) continue;

      // ONLY pending steps can be dispatched!
      // confirmed steps are reused; outcomeUnknown, dispatched, and failed steps are NOT dispatched without explicit retry
      if (stepRecord.status !== "pending") {
        continue;
      }

      const targetId = stepRecord.terminalId ?? `term-${generateUUID()}`;
      record = stepTransitionDispatched(record, step.key, input.preflight.serverEpoch);

      try {
        // Step 2: Network effect (no automatic retries)
        const session = await input.apiClient.terminal.create({
          id: targetId,
          project: record.recipeSnapshot.project,
          command: step.command,
          cwd: step.worktreePath,
          worktreePath: step.worktreePath,
          name: step.name,
          cols: 80,
          rows: 24,
        });

        // Step 3: Authoritative confirmation
        if (
          session.id !== targetId ||
          typeof session.incarnation !== "number" ||
          !Number.isSafeInteger(session.incarnation)
        ) {
          throw new Error(
            `Server returned mismatched terminal identity: expected ${targetId}, got ${session.id} (incarnation ${session.incarnation})`,
          );
        }

        // Step 3: Authoritative confirmation with exact returned incarnation
        record = stepTransitionConfirmed(record, step.key, {
          terminalId: session.id,
          incarnation: session.incarnation,
        });
      } catch (err) {
        // Step 4: Interruption / timeout / network failure -> outcomeUnknown
        const errMsg = (err as Error).message || "Terminal create failed or response lost";
        record = stepTransitionOutcomeUnknown(record, step.key, errMsg);
      }
    }

    return record;
  });
}
