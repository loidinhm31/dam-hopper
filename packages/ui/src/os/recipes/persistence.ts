import { validateRecipeV1 } from "./schema.js";
import type { RecipeV1 } from "./types.js";

export const RECIPES_STORAGE_KEY = "dam-hopper:os:v1:recipes";

/**
 * Loads all saved recipes from local persistence.
 * Discards malformed or corrupt entries safely.
 */
export function loadAllRecipes(): RecipeV1[] {
  if (typeof localStorage === "undefined") return [];

  try {
    const raw = localStorage.getItem(RECIPES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const recipes: RecipeV1[] = [];
    for (const item of parsed) {
      const validation = validateRecipeV1(item);
      if (validation.valid) {
        recipes.push(validation.recipe);
      }
    }
    return recipes;
  } catch {
    return [];
  }
}

/**
 * Persists all recipes to local storage.
 */
export function saveAllRecipes(recipes: readonly RecipeV1[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RECIPES_STORAGE_KEY, JSON.stringify(recipes));
  } catch (err) {
    throw new Error(`Failed to persist recipes: ${(err as Error).message}`);
  }
}

/**
 * Retrieves a single recipe by its id.
 */
export function getRecipeById(id: string): RecipeV1 | undefined {
  const all = loadAllRecipes();
  return all.find((r) => r.id === id);
}

/**
 * Upserts a recipe into storage.
 */
export function saveRecipe(recipe: RecipeV1): void {
  const validation = validateRecipeV1(recipe);
  if (!validation.valid) {
    throw new Error(`Cannot save invalid recipe: ${validation.errors.join("; ")}`);
  }

  const all = loadAllRecipes();
  const existingIdx = all.findIndex((r) => r.id === recipe.id);
  const updated = [...all];

  if (existingIdx !== -1) {
    updated[existingIdx] = recipe;
  } else {
    updated.push(recipe);
  }

  saveAllRecipes(updated);
}

/**
 * Deletes a recipe by id from storage.
 */
export function deleteRecipe(id: string): void {
  const all = loadAllRecipes();
  const filtered = all.filter((r) => r.id !== id);
  saveAllRecipes(filtered);
}
