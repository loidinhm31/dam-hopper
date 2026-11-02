import {
  useState,
  useMemo,
  type ReactElement,
} from "react";
import type { OsWindow } from "../types.js";
import { useWindowStore } from "../window-store.js";
import { getAllConnectionSnapshots } from "@/api/connections.js";
import type { RecipeV1 } from "../recipes/types.js";
import {
  deleteRecipe,
  loadAllRecipes,
  saveRecipe,
} from "../recipes/persistence.js";
import { RecipeEditor } from "../recipes/RecipeEditor.js";
import { LaunchReview } from "../recipes/LaunchReview.js";

export interface RecipesAppProps {
  window: OsWindow;
}

export function RecipesApp({ window }: RecipesAppProps): ReactElement {
  const session = useWindowStore((state) => state.session);
  const activeDesktop =
    session.desktops.find((d) => d.id === session.activeDesktopId) ?? session.desktops[0];
  type RecipeTab = "catalog" | "save-subset" | "import" | "review";
  const initialTab: RecipeTab =
    window.appState?.activeTab === "save-subset" ||
    window.appState?.activeTab === "import" ||
    window.appState?.activeTab === "review"
      ? window.appState.activeTab
      : "catalog";
  const [activeTab, setActiveTab] = useState<RecipeTab>(initialTab);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(
    (window.appState?.selectedRecipeId as string | undefined) ?? null,
  );
  const [exportingRecipe, setExportingRecipe] = useState<RecipeV1 | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  const recipes = useMemo(() => {
    // refreshCounter is a trigger to re-read localStorage
    if (refreshCounter < 0) return [];
    return loadAllRecipes();
  }, [refreshCounter]);

  const selectedRecipe = useMemo(() => {
    if (!selectedRecipeId) return null;
    return recipes.find((r) => r.id === selectedRecipeId) ?? null;
  }, [recipes, selectedRecipeId]);

  const connectionsMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getAllConnectionSnapshots>[0]>();
    for (const snap of getAllConnectionSnapshots()) {
      map.set(snap.owner.profileId, snap);
    }
    return map;
  }, []);

  const handleDeleteRecipe = (id: string) => {
    deleteRecipe(id);
    if (selectedRecipeId === id) setSelectedRecipeId(null);
    setRefreshCounter((c) => c + 1);
  };

  const handleRecipeSaved = (saved: RecipeV1) => {
    setRefreshCounter((c) => c + 1);
    setSelectedRecipeId(saved.id);
    setActiveTab("catalog");
  };

  return (
    <div
      data-os-recipes={window.id}
      data-testid={`recipes-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none text-xs"
    >
      {/* App Header */}
      <div className="flex items-center justify-between p-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-[var(--color-primary)]">
            📜 Launch Recipes
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[var(--color-text-muted)] font-mono">
            {recipes.length} saved
          </span>
        </div>

        <div className="flex items-center gap-2">
          {activeTab !== "catalog" && (
            <button
              type="button"
              data-testid="recipes-catalog-back-btn"
              onClick={() => {
                setActiveTab("catalog");
                setSelectedRecipeId(null);
              }}
              className="px-2.5 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-xs font-medium"
            >
              ← Back to Catalog
            </button>
          )}

          {activeTab === "catalog" && (
            <>
              <button
                type="button"
                data-testid="recipes-save-desktop-btn"
                onClick={() => setActiveTab("save-subset")}
                className="px-2.5 py-1 rounded bg-[var(--color-primary)] text-white hover:opacity-90 font-medium text-xs transition-opacity flex items-center gap-1"
              >
                + Save Desktop
              </button>
              <button
                type="button"
                data-testid="recipes-import-btn"
                onClick={() => setActiveTab("import")}
                className="px-2.5 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-xs font-medium"
              >
                Import JSON
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden">
        {/* VIEW 1: Catalog List */}
        {activeTab === "catalog" && (
          <div className="w-full h-full overflow-y-auto p-4 flex flex-col gap-3">
            {recipes.length === 0 ? (
              <div
                data-testid="recipes-empty-catalog"
                className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[var(--color-text-muted)] gap-2"
              >
                <span className="text-2xl">📜</span>
                <span className="font-semibold text-sm">No saved recipes</span>
                <span className="text-xs max-w-sm">
                  Click "Save Desktop" to save your current layout, terminals, and apps as a
                  declarative launch recipe.
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab("save-subset")}
                  className="mt-2 px-3 py-1.5 rounded bg-[var(--color-primary)] text-white font-medium text-xs hover:opacity-90"
                >
                  Save Current Desktop
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {recipes.map((recipe) => (
                  <div
                    key={recipe.id}
                    data-testid={`recipe-card-${recipe.id}`}
                    className="p-3 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-border-hover)] bg-[var(--color-bg)] flex flex-col justify-between gap-3 transition-colors"
                  >
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-xs truncate" title={recipe.name}>
                          {recipe.name}
                        </span>
                        <span className="px-1.5 py-0.2 rounded font-mono text-[10px] bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[var(--color-primary)]">
                          v{recipe.version}
                        </span>
                      </div>

                      {recipe.description && (
                        <span className="text-[11px] text-[var(--color-text-muted)] line-clamp-2">
                          {recipe.description}
                        </span>
                      )}

                      <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)] font-mono flex-wrap pt-1">
                        <span>Host: {recipe.profileId}</span>
                        <span>•</span>
                        <span>Project: {recipe.project}</span>
                        <span>•</span>
                        <span>
                          {recipe.terminalSteps.length} Terminals, {recipe.appSteps.length} Apps
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-1.5 pt-2 border-t border-[var(--color-border)]/50">
                      <button
                        type="button"
                        data-testid={`recipe-export-${recipe.id}`}
                        onClick={() => setExportingRecipe(recipe)}
                        className="px-2 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[11px]"
                      >
                        Export
                      </button>

                      <button
                        type="button"
                        data-testid={`recipe-delete-${recipe.id}`}
                        onClick={() => handleDeleteRecipe(recipe.id)}
                        className="px-2 py-1 rounded bg-[var(--color-surface)] hover:bg-red-500/20 text-red-400 border border-[var(--color-border)] text-[11px]"
                      >
                        Delete
                      </button>

                      <button
                        type="button"
                        data-testid={`recipe-launch-${recipe.id}`}
                        onClick={() => {
                          setSelectedRecipeId(recipe.id);
                          setActiveTab("review");
                        }}
                        className="px-3 py-1 rounded bg-[var(--color-primary)] text-white hover:opacity-90 font-medium text-[11px] transition-opacity flex items-center gap-1"
                      >
                        Launch ➔
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW 2: Save Desktop Subset Editor */}
        {activeTab === "save-subset" && (
          <RecipeEditor
            desktop={activeDesktop}
            windows={session.windows}
            initialMode="save-subset"
            onSaved={handleRecipeSaved}
            onCancel={() => setActiveTab("catalog")}
          />
        )}

        {/* VIEW 3: Import Recipe JSON */}
        {activeTab === "import" && (
          <RecipeEditor
            desktop={activeDesktop}
            windows={session.windows}
            initialMode="import"
            onSaved={handleRecipeSaved}
            onCancel={() => setActiveTab("catalog")}
          />
        )}

        {/* VIEW 4: Launch Review & Execution */}
        {activeTab === "review" && selectedRecipe && (
          <LaunchReview
            recipe={selectedRecipe}
            activeDesktop={activeDesktop}
            connections={connectionsMap}
            windows={session.windows}
            onClose={() => {
              setActiveTab("catalog");
              setSelectedRecipeId(null);
            }}
          />
        )}
      </div>

        {/* VIEW 5: Export Recipe JSON */}
        {exportingRecipe && (
          <RecipeEditor
            desktop={activeDesktop}
            windows={session.windows}
            initialRecipe={exportingRecipe}
            initialMode="export"
            onSaved={() => setExportingRecipe(null)}
            onCancel={() => setExportingRecipe(null)}
          />
        )}
    </div>
  );
}
