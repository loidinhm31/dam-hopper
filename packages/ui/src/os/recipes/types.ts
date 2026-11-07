import type { TileNode } from "@/types/tile-tree.js";
import type { FloatBounds, OsAppId, WindowContext } from "../types.js";

export type RecipeStepKey = string;

export interface RecipeTerminalStep {
  readonly key: RecipeStepKey;
  readonly name: string;
  readonly command: string;
  readonly worktreePath?: string;
  readonly agent?: "omp" | "codex" | "claude" | string;
}

export interface RecipeAppStep {
  readonly key: RecipeStepKey;
  readonly appId: OsAppId;
  readonly worktreePath?: string;
  readonly appState?: Record<string, unknown>;
}

export interface RecipeLayout {
  readonly tree: TileNode<RecipeStepKey> | null;
  readonly floating: readonly {
    readonly stepKey: RecipeStepKey;
    readonly floatBounds?: FloatBounds;
  }[];
}

export interface RecipeV1 {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly profileId: string;
  readonly project: string;
  readonly terminalSteps: readonly RecipeTerminalStep[];
  readonly appSteps: readonly RecipeAppStep[];
  readonly layout: RecipeLayout;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type StepExecutionStatus =
  | "pending"
  | "dispatched"
  | "confirmed"
  | "failed"
  | "outcomeUnknown";

export interface LaunchStepRecord {
  readonly stepKey: RecipeStepKey;
  readonly type: "terminal" | "app";
  readonly terminalId?: string;
  readonly windowId?: string;
  readonly status: StepExecutionStatus;
  readonly profileId: string;
  readonly serverEpoch?: string | number | null;
  readonly incarnation?: number;
  readonly dispatchedAt?: number;
  readonly resolvedAt?: number;
  readonly error?: string;
  readonly evidence?: string;
  readonly dismissed?: boolean;
}

export interface LaunchRecordV1 {
  readonly version: 1;
  readonly launchId: string;
  readonly recipeId: string;
  readonly recipeSnapshot: RecipeV1;
  readonly desktopId: string;
  readonly profileId: string;
  readonly serverEpoch: string | number | null;
  readonly steps: Readonly<Record<RecipeStepKey, LaunchStepRecord>>;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly capturedRun?: boolean;
}

export interface ExcludedWindowPreview {
  readonly windowId: string;
  readonly title: string;
  readonly appId: OsAppId;
  readonly ctx: WindowContext;
  readonly reason: string;
}

export interface MatchingWindowPreview {
  readonly windowId: string;
  readonly title: string;
  readonly appId: OsAppId;
  readonly ctx: WindowContext;
  readonly stepKey: RecipeStepKey;
}

export interface SaveSubsetPreview {
  readonly profileId: string;
  readonly project: string;
  readonly matchingWindows: readonly MatchingWindowPreview[];
  readonly excludedWindows: readonly ExcludedWindowPreview[];
  readonly canSave: boolean;
}
