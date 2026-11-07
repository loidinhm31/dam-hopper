import { isAppId } from "../app-registry.js";
import type { FloatBounds, OsAppId } from "../types.js";
import type { TileNode, TilePaneNode, TileSplitNode } from "@/types/tile-tree.js";
import type {
  RecipeAppStep,
  RecipeLayout,
  RecipeStepKey,
  RecipeTerminalStep,
  RecipeV1,
} from "./types.js";

const STEP_KEY_REGEX = /^[a-zA-Z0-9_-]+$/;
const MAX_STEPS = 32;
const MAX_TREE_DEPTH = 10;
const MAX_TREE_NODES = 64;

export const RECIPE_EXPORT_WARNING =
  "Exported recipes include authored commands and local file paths. Review thoroughly before sharing.";

export interface ValidationSuccess {
  readonly valid: true;
  readonly recipe: RecipeV1;
}

export interface ValidationFailure {
  readonly valid: false;
  readonly errors: readonly string[];
}

export type RecipeValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Validates a TileNode tree recursively checking node count, depth, and stepKey references.
 */
function validateLayoutTree(
  node: unknown,
  allowedKeys: ReadonlySet<string>,
  depth: number,
  nodeCounter: { count: number },
  errors: string[],
): boolean {
  if (depth > MAX_TREE_DEPTH) {
    errors.push(`Layout tree exceeds maximum nesting depth of ${MAX_TREE_DEPTH}`);
    return false;
  }
  nodeCounter.count++;
  if (nodeCounter.count > MAX_TREE_NODES) {
    errors.push(`Layout tree exceeds maximum node count of ${MAX_TREE_NODES}`);
    return false;
  }

  if (typeof node !== "object" || node === null) {
    errors.push("Invalid layout node: expected object");
    return false;
  }

  const n = node as Record<string, unknown>;
  if (typeof n.id !== "string" || !n.id.trim()) {
    errors.push("Layout node missing string id");
  }

  if (n.type === "pane") {
    if (!Array.isArray(n.items)) {
      errors.push(`Pane node "${n.id}" items must be an array`);
      return false;
    }
    for (const item of n.items) {
      if (typeof item !== "string") {
        errors.push(`Pane node "${n.id}" item must be a string stepKey`);
      } else if (!allowedKeys.has(item)) {
        errors.push(
          `Layout references unknown step key "${item}" not defined in terminalSteps or appSteps`,
        );
      }
    }
    if (n.active !== undefined && n.active !== null) {
      if (typeof n.active !== "string" || !allowedKeys.has(n.active)) {
        errors.push(`Pane active step key "${String(n.active)}" is not in allowed steps`);
      }
    }
    return true;
  }

  if (n.type === "split") {
    if (n.direction !== "horizontal" && n.direction !== "vertical") {
      errors.push(`Split node "${n.id}" direction must be "horizontal" or "vertical"`);
    }
    if (!Array.isArray(n.children) || n.children.length === 0) {
      errors.push(`Split node "${n.id}" children must be a non-empty array`);
      return false;
    }
    if (!Array.isArray(n.sizes) || n.sizes.length !== n.children.length) {
      errors.push(`Split node "${n.id}" sizes must match children length`);
    } else {
      for (const size of n.sizes) {
        if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
          errors.push(`Split node "${n.id}" size must be a non-negative finite number`);
        }
      }
    }

    let allValid = true;
    for (const child of n.children) {
      const childValid = validateLayoutTree(
        child,
        allowedKeys,
        depth + 1,
        nodeCounter,
        errors,
      );
      if (!childValid) allValid = false;
    }
    return allValid;
  }

  errors.push(`Unknown layout node type "${String(n.type)}"`);
  return false;
}

/**
 * Validates a RecipeV1 object against schema invariants.
 * Fail-closed validation for structure, bounds, and topology reference integrity.
 */
export function validateRecipeV1(raw: unknown): RecipeValidationResult {
  const errors: string[] = [];

  if (typeof raw !== "object" || raw === null) {
    return { valid: false, errors: ["Recipe must be a non-null object"] };
  }

  const obj = raw as Record<string, unknown>;

  // Version check
  if (obj.version !== 1) {
    errors.push(`Unsupported recipe version: ${String(obj.version)}, expected 1`);
  }

  // Id
  if (typeof obj.id !== "string" || !obj.id.trim()) {
    errors.push("Recipe id is required and must be a non-empty string");
  } else if (obj.id.length > 64) {
    errors.push("Recipe id must not exceed 64 characters");
  }

  // Name
  if (typeof obj.name !== "string" || !obj.name.trim()) {
    errors.push("Recipe name is required and must be a non-empty string");
  } else if (obj.name.length > 120) {
    errors.push("Recipe name must not exceed 120 characters");
  }

  // Description
  if (obj.description !== undefined && obj.description !== null) {
    if (typeof obj.description !== "string") {
      errors.push("Recipe description must be a string");
    } else if (obj.description.length > 500) {
      errors.push("Recipe description must not exceed 500 characters");
    }
  }

  // ProfileId
  if (typeof obj.profileId !== "string" || !obj.profileId.trim()) {
    errors.push("Recipe profileId is required and must be a non-empty string");
  } else if (obj.profileId.length > 64) {
    errors.push("Recipe profileId must not exceed 64 characters");
  }

  // Project
  if (typeof obj.project !== "string" || !obj.project.trim()) {
    errors.push("Recipe project is required and must be a non-empty string");
  } else if (obj.project.length > 128) {
    errors.push("Recipe project must not exceed 128 characters");
  }

  // Collect step keys to check uniqueness and reference integrity
  const stepKeys = new Set<string>();

  // Terminal Steps
  const validatedTerminalSteps: RecipeTerminalStep[] = [];
  if (!Array.isArray(obj.terminalSteps)) {
    errors.push("terminalSteps must be an array");
  } else {
    if (obj.terminalSteps.length > MAX_STEPS) {
      errors.push(`terminalSteps count (${obj.terminalSteps.length}) exceeds maximum of ${MAX_STEPS}`);
    }

    for (let i = 0; i < obj.terminalSteps.length; i++) {
      const step = obj.terminalSteps[i];
      if (typeof step !== "object" || step === null) {
        errors.push(`terminalSteps[${i}] must be an object`);
        continue;
      }

      // Disallow dangerous or sensitive fields in schema
      if ("env" in step || "credentials" in step || "secret" in step || "token" in step) {
        errors.push(
          `terminalSteps[${i}] contains forbidden credentials/env field in recipe schema`,
        );
      }

      if (typeof step.key !== "string" || !STEP_KEY_REGEX.test(step.key)) {
        errors.push(
          `terminalSteps[${i}].key "${String(step.key)}" is invalid; must match /^[a-zA-Z0-9_-]+$/`,
        );
      } else if (stepKeys.has(step.key)) {
        errors.push(`Duplicate step key detected: "${step.key}"`);
      } else {
        stepKeys.add(step.key);
      }

      if (typeof step.name !== "string" || !step.name.trim()) {
        errors.push(`terminalSteps[${i}].name must be a non-empty string`);
      } else if (step.name.length > 64) {
        errors.push(`terminalSteps[${i}].name must not exceed 64 characters`);
      }

      if (typeof step.command !== "string" || !step.command.trim()) {
        errors.push(`terminalSteps[${i}].command must be a non-empty string`);
      } else if (step.command.length > 2000) {
        errors.push(`terminalSteps[${i}].command must not exceed 2000 characters`);
      }

      if (step.worktreePath !== undefined && step.worktreePath !== null) {
        if (typeof step.worktreePath !== "string") {
          errors.push(`terminalSteps[${i}].worktreePath must be a string`);
        } else if (step.worktreePath.length > 500) {
          errors.push(`terminalSteps[${i}].worktreePath must not exceed 500 characters`);
        }
      }

      if (step.agent !== undefined && step.agent !== null) {
        if (typeof step.agent !== "string") {
          errors.push(`terminalSteps[${i}].agent must be a string`);
        } else if (step.agent.length > 32) {
          errors.push(`terminalSteps[${i}].agent must not exceed 32 characters`);
        }
      }

      validatedTerminalSteps.push({
        key: String(step.key),
        name: String(step.name),
        command: String(step.command),
        worktreePath: step.worktreePath ? String(step.worktreePath) : undefined,
        agent: step.agent ? String(step.agent) : undefined,
      });
    }
  }

  // App Steps
  const validatedAppSteps: RecipeAppStep[] = [];
  if (!Array.isArray(obj.appSteps)) {
    errors.push("appSteps must be an array");
  } else {
    if (obj.appSteps.length > MAX_STEPS) {
      errors.push(`appSteps count (${obj.appSteps.length}) exceeds maximum of ${MAX_STEPS}`);
    }

    for (let i = 0; i < obj.appSteps.length; i++) {
      const step = obj.appSteps[i];
      if (typeof step !== "object" || step === null) {
        errors.push(`appSteps[${i}] must be an object`);
        continue;
      }

      if (typeof step.key !== "string" || !STEP_KEY_REGEX.test(step.key)) {
        errors.push(
          `appSteps[${i}].key "${String(step.key)}" is invalid; must match /^[a-zA-Z0-9_-]+$/`,
        );
      } else if (stepKeys.has(step.key)) {
        errors.push(`Duplicate step key detected: "${step.key}"`);
      } else {
        stepKeys.add(step.key);
      }

      if (typeof step.appId !== "string" || !isAppId(step.appId)) {
        errors.push(
          `appSteps[${i}].appId "${String(step.appId)}" is not a recognized OsAppId manifest`,
        );
      }

      if (step.worktreePath !== undefined && step.worktreePath !== null) {
        if (typeof step.worktreePath !== "string") {
          errors.push(`appSteps[${i}].worktreePath must be a string`);
        } else if (step.worktreePath.length > 500) {
          errors.push(`appSteps[${i}].worktreePath must not exceed 500 characters`);
        }
      }

      validatedAppSteps.push({
        key: String(step.key),
        appId: step.appId as OsAppId,
        worktreePath: step.worktreePath ? String(step.worktreePath) : undefined,
        appState:
          typeof step.appState === "object" && step.appState !== null
            ? (step.appState as Record<string, unknown>)
            : undefined,
      });
    }
  }

  // At least one step must be present
  if (stepKeys.size === 0) {
    errors.push("Recipe must contain at least one terminalStep or appStep");
  }

  // Layout validation
  let validatedLayout: RecipeLayout = { tree: null, floating: [] };
  if (typeof obj.layout !== "object" || obj.layout === null) {
    errors.push("Recipe layout must be an object");
  } else {
    const layout = obj.layout as Record<string, unknown>;

    // Tree layout
    if (layout.tree !== null && layout.tree !== undefined) {
      const nodeCounter = { count: 0 };
      validateLayoutTree(layout.tree, stepKeys, 0, nodeCounter, errors);
    }

    // Floating windows
    const validatedFloating: Array<{ stepKey: RecipeStepKey; floatBounds?: FloatBounds }> = [];
    if (layout.floating !== undefined && layout.floating !== null) {
      if (!Array.isArray(layout.floating)) {
        errors.push("layout.floating must be an array");
      } else {
        if (layout.floating.length > MAX_STEPS) {
          errors.push(`layout.floating count exceeds maximum of ${MAX_STEPS}`);
        }
        for (let i = 0; i < layout.floating.length; i++) {
          const item = layout.floating[i];
          if (typeof item !== "object" || item === null) {
            errors.push(`layout.floating[${i}] must be an object`);
            continue;
          }
          if (typeof item.stepKey !== "string" || !stepKeys.has(item.stepKey)) {
            errors.push(
              `layout.floating[${i}] references unknown step key "${String(item.stepKey)}"`,
            );
          }
          let bounds = undefined;
          if (typeof item.floatBounds === "object" && item.floatBounds !== null) {
            const b = item.floatBounds as Record<string, unknown>;
            if (
              typeof b.x === "number" &&
              typeof b.y === "number" &&
              typeof b.width === "number" &&
              typeof b.height === "number" &&
              Number.isFinite(b.x) &&
              Number.isFinite(b.y) &&
              Number.isFinite(b.width) &&
              Number.isFinite(b.height)
            ) {
              bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
            }
          }
          validatedFloating.push({
            stepKey: String(item.stepKey),
            floatBounds: bounds,
          });
        }
      }
    }

    validatedLayout = {
      tree: (layout.tree as TileNode<RecipeStepKey>) ?? null,
      floating: validatedFloating,
    };
  }

  // Timestamps
  const createdAt =
    typeof obj.createdAt === "number" && Number.isFinite(obj.createdAt)
      ? obj.createdAt
      : Date.now();
  const updatedAt =
    typeof obj.updatedAt === "number" && Number.isFinite(obj.updatedAt)
      ? obj.updatedAt
      : Date.now();

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    recipe: {
      version: 1,
      id: String(obj.id),
      name: String(obj.name),
      description: obj.description ? String(obj.description) : undefined,
      profileId: String(obj.profileId),
      project: String(obj.project),
      terminalSteps: validatedTerminalSteps,
      appSteps: validatedAppSteps,
      layout: validatedLayout,
      createdAt,
      updatedAt,
    },
  };
}

/**
 * Serializes a RecipeV1 to portable JSON with security warning.
 * Never exports live execution records or host secrets.
 */
export function exportRecipeJson(recipe: RecipeV1): {
  readonly json: string;
  readonly warning: string;
} {
  const cleanRecipe: RecipeV1 = {
    version: 1,
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    profileId: recipe.profileId,
    project: recipe.project,
    terminalSteps: recipe.terminalSteps.map((s) => ({
      key: s.key,
      name: s.name,
      command: s.command,
      worktreePath: s.worktreePath,
      agent: s.agent,
    })),
    appSteps: recipe.appSteps.map((s) => ({
      key: s.key,
      appId: s.appId,
      worktreePath: s.worktreePath,
      appState: s.appState,
    })),
    layout: recipe.layout,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
  };

  return {
    json: JSON.stringify(cleanRecipe, null, 2),
    warning: RECIPE_EXPORT_WARNING,
  };
}

/**
 * Parses and validates portable recipe JSON string.
 * Keeps imported recipe inert until user explicitly confirms/launches.
 */
export function importRecipeJson(jsonStr: string): RecipeValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    return {
      valid: false,
      errors: [`Malformed JSON: ${(err as Error).message}`],
    };
  }

  return validateRecipeV1(parsed);
}
