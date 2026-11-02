import { describe, expect, it } from "vitest";
import {
  exportRecipeJson,
  importRecipeJson,
  RECIPE_EXPORT_WARNING,
  validateRecipeV1,
} from "./schema.js";
import type { RecipeV1 } from "./types.js";
import type { OsAppId } from "../types.js";

function validRecipe(): RecipeV1 {
  return {
    version: 1,
    id: "recipe-fullstack-dev",
    name: "Fullstack Development Setup",
    description: "Launch API server and web dev server with editor",
    profileId: "server-a",
    project: "dam-hopper",
    terminalSteps: [
      {
        key: "api-term",
        name: "Backend Server",
        command: "cargo run",
        worktreePath: "/repo/dam-hopper/server",
        agent: "omp",
      },
      {
        key: "web-term",
        name: "Web Frontend",
        command: "pnpm dev",
      },
    ],
    appSteps: [
      {
        key: "files-app",
        appId: "files",
      },
      {
        key: "editor-app",
        appId: "editor",
      },
    ],
    layout: {
      tree: {
        type: "split",
        id: "root-split",
        direction: "horizontal",
        sizes: [60, 40],
        children: [
          {
            type: "pane",
            id: "pane-1",
            items: ["api-term", "web-term"],
            active: "api-term",
          },
          {
            type: "pane",
            id: "pane-2",
            items: ["editor-app"],
            active: "editor-app",
          },
        ],
      },
      floating: [
        {
          stepKey: "files-app",
          floatBounds: { x: 100, y: 100, width: 400, height: 300 },
        },
      ],
    },
    createdAt: 1000,
    updatedAt: 1000,
  };
}

describe("recipes schema validation", () => {
  it("approves well-formed RecipeV1", () => {
    const recipe = validRecipe();
    const result = validateRecipeV1(recipe);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.recipe.id).toBe("recipe-fullstack-dev");
      expect(result.recipe.terminalSteps).toHaveLength(2);
      expect(result.recipe.appSteps).toHaveLength(2);
      expect(result.recipe.layout.tree).not.toBeNull();
    }
  });

  it("rejects invalid version or non-object input", () => {
    expect(validateRecipeV1(null).valid).toBe(false);
    expect(validateRecipeV1("string").valid).toBe(false);

    const badVersion = { ...validRecipe(), version: 2 };
    const res = validateRecipeV1(badVersion);
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.errors[0]).toContain("Unsupported recipe version");
    }
  });

  it("rejects duplicate step keys between terminal and app steps", () => {
    const dupRecipe = {
      ...validRecipe(),
      appSteps: [
        {
          key: "api-term", // Collides with terminal step key!
          appId: "files" as const,
        },
      ],
    };
    const res = validateRecipeV1(dupRecipe);
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.errors.some((e) => e.includes("Duplicate step key detected"))).toBe(true);
    }
  });

  it("enforces reference integrity: rejects layout pointing to nonexistent stepKey", () => {
    const orphanRecipe = {
      ...validRecipe(),
      layout: {
        tree: {
          type: "pane" as const,
          id: "pane-orphan",
          items: ["nonexistent-key"],
        },
        floating: [],
      },
    };
    const res = validateRecipeV1(orphanRecipe);
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(
        res.errors.some((e) => e.includes("references unknown step key \"nonexistent-key\"")),
      ).toBe(true);
    }
  });

  it("rejects forbidden env or credentials fields in recipe schema", () => {
    const secretRecipe = {
      ...validRecipe(),
      terminalSteps: [
        {
          key: "term-with-secret",
          name: "Secret Step",
          command: "echo hi",
          env: { API_KEY: "secret-123" }, // Forbidden!
        },
      ],
    };
    const res = validateRecipeV1(secretRecipe);
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(
        res.errors.some((e) => e.includes("contains forbidden credentials/env field")),
      ).toBe(true);
    }
  });

  it("rejects unrecognized OsAppId in appSteps", () => {
    const badAppRecipe = {
      ...validRecipe(),
      appSteps: [
        {
          key: "bad-app-step",
          appId: "nonexistent-app-id" as unknown as OsAppId,
        },
      ],
      layout: {
        tree: {
          type: "pane" as const,
          id: "pane-1",
          items: ["bad-app-step"],
        },
        floating: [],
      },
    };
    const res = validateRecipeV1(badAppRecipe);
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.errors.some((e) => e.includes("not a recognized OsAppId manifest"))).toBe(true);
    }
  });

  it("exports portable JSON with security warning and imports inertly", () => {
    const recipe = validRecipe();
    const exported = exportRecipeJson(recipe);
    expect(exported.warning).toBe(RECIPE_EXPORT_WARNING);
    expect(exported.json).toContain('"name": "Fullstack Development Setup"');

    const imported = importRecipeJson(exported.json);
    expect(imported.valid).toBe(true);
    if (imported.valid) {
      expect(imported.recipe.id).toBe(recipe.id);
      expect(imported.recipe.layout.tree).toEqual(recipe.layout.tree);
    }
  });

  it("rejects malformed JSON on import", () => {
    const res = importRecipeJson("{ not valid json");
    expect(res.valid).toBe(false);
    if (!res.valid) {
      expect(res.errors[0]).toContain("Malformed JSON");
    }
  });
});
