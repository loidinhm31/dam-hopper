import "@/index.css";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowStore } from "@/os/window-store.js";
import { createDefaultOsSession } from "@/os/window-ops.js";
import { EncryptProvider } from "@/contexts/EncryptContext.js";
import { __setConnectionSnapshotForTests, resetConnections } from "@/api/connections.js";
import { saveProfiles, type ServerProfile } from "@/api/server-config.js";
import { RecipesApp } from "@/os/apps/RecipesApp.js";
import { RecipeEditor } from "@/os/recipes/RecipeEditor.js";
import { LaunchReview } from "@/os/recipes/LaunchReview.js";
import type { OsDesktop, OsWindow } from "@/os/types.js";
import type { RecipeV1 } from "@/os/recipes/types.js";
import type { WsTransport } from "@/api/ws-transport.js";
import { createApiClient } from "@/api/client.js";
import { saveRecipe, loadAllRecipes, RECIPES_STORAGE_KEY } from "@/os/recipes/persistence.js";
import { RECIPE_LAUNCHES_STORAGE_KEY } from "@/os/recipes/launch-records.js";
import { useAgentStatusStore } from "@/stores/agent-status.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const profileA: ServerProfile = {
  id: "profile-a",
  name: "Host Alpha",
  url: "http://127.0.0.1:4801",
  authType: "none",
  createdAt: 1,
  autoConnect: true,
};

function createMockTransport(): WsTransport {
  return {
    invoke: vi.fn().mockImplementation((action: string, payload: unknown) => {
      if (action === "terminal:create") {
        const opts = payload as { id: string; name?: string };
        return Promise.resolve({
          id: opts.id,
          name: opts.name,
          command: "pnpm dev",
          cwd: "/repo",
          type: "shell",
          alive: true,
          startedAt: Date.now(),
          incarnation: 1,
        });
      }
      return Promise.resolve([]);
    }),
    request: vi.fn().mockResolvedValue([]),
    terminalWrite: vi.fn(),
    terminalResize: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
    onClose: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  } as unknown as WsTransport;
}

describe("os-recipes.browser", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    container.id = "browser-test-root";
    container.style.width = "1280px";
    container.style.height = "800px";
    document.body.appendChild(container);
    root = createRoot(container);

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });

    saveProfiles([profileA], profileA.id);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    resetConnections();
    queryClient.clear();
    localStorage.removeItem(RECIPES_STORAGE_KEY);
    localStorage.removeItem(RECIPE_LAUNCHES_STORAGE_KEY);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders Save Subset chooser with matching and explicitly listed excluded windows", async () => {
    const winTerm: OsWindow = {
      id: "win-term-1",
      appId: "terminals",
      title: "Dev Server Terminal",
      ctx: { profileId: "profile-a", projectId: "dam-hopper" },
      mode: "tile",
      desktopId: "d-1",
      maximized: false,
      minimized: false,
    };

    const winFiles: OsWindow = {
      id: "win-files-1",
      appId: "files",
      title: "Project Files",
      ctx: { profileId: "profile-a", projectId: "dam-hopper" },
      mode: "tile",
      desktopId: "d-1",
      maximized: false,
      minimized: false,
    };

    const winExcludedSysMon: OsWindow = {
      id: "win-sys-1",
      appId: "system-monitor",
      title: "System Monitor",
      ctx: { profileId: "profile-a" },
      mode: "tile",
      desktopId: "d-1",
      maximized: false,
      minimized: false,
    };

    const winExcludedOtherProject: OsWindow = {
      id: "win-other-proj",
      appId: "editor",
      title: "Other Project Editor",
      ctx: { profileId: "profile-a", projectId: "other-project" },
      mode: "tile",
      desktopId: "d-1",
      maximized: false,
      minimized: false,
    };

    const desktop: OsDesktop = {
      id: "d-1",
      name: "Desktop 1",
      defaultCtx: { profileId: "profile-a", projectId: "dam-hopper" },
      tree: {
        type: "split",
        id: "split-1",
        direction: "horizontal",
        sizes: [50, 50],
        children: [
          {
            type: "pane",
            id: "pane-1",
            items: ["win-term-1", "win-files-1"],
            active: "win-term-1",
          },
          {
            type: "pane",
            id: "pane-2",
            items: ["win-sys-1", "win-other-proj"],
            active: "win-sys-1",
          },
        ],
      },
      floatingWindowIds: [],
      focusedWindowId: "win-term-1",
    };

    const windows = {
      "win-term-1": winTerm,
      "win-files-1": winFiles,
      "win-sys-1": winExcludedSysMon,
      "win-other-proj": winExcludedOtherProject,
    };

    const onSaved = vi.fn();
    const onCancel = vi.fn();

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <MemoryRouter>
              <RecipeEditor
                desktop={desktop}
                windows={windows}
                onSaved={onSaved}
                onCancel={onCancel}
              />
            </MemoryRouter>
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });

    // Check Editor rendered
    expect(container.querySelector('[data-testid="recipe-editor"]')).not.toBeNull();

    // Verify 2 matching windows included
    expect(container.querySelector('[data-testid="recipe-matching-win-win-term-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="recipe-matching-win-win-files-1"]')).not.toBeNull();

    // Verify 2 excluded windows explicitly shown with reasons
    const excludedSys = container.querySelector('[data-testid="recipe-excluded-win-win-sys-1"]');
    expect(excludedSys).not.toBeNull();
    expect(excludedSys?.textContent).toContain("Contextless / fleet application");

    const excludedProj = container.querySelector('[data-testid="recipe-excluded-win-win-other-proj"]');
    expect(excludedProj).not.toBeNull();
    expect(excludedProj?.textContent).toContain("Different project");

    // Verify save is initially disabled until command is explicitly confirmed
    const saveBtn = container.querySelector('[data-testid="recipe-save-submit-btn"]') as HTMLButtonElement;
    expect(saveBtn).not.toBeNull();
    expect(saveBtn.disabled).toBe(true);

    // Confirm terminal command
    const confirmCheckbox = container.querySelector(
      'input[type="checkbox"][data-testid^="recipe-step-confirm-"]',
    ) as HTMLInputElement;
    expect(confirmCheckbox).not.toBeNull();

    await act(async () => {
      confirmCheckbox.click();
    });

    expect(saveBtn.disabled).toBe(false);

    await act(async () => {
      saveBtn.click();
    });

    expect(onSaved).toHaveBeenCalledTimes(1);
    const savedRecipe: RecipeV1 = onSaved.mock.calls[0][0];
    expect(savedRecipe.terminalSteps).toHaveLength(1);
    expect(savedRecipe.appSteps).toHaveLength(1);
    expect(savedRecipe.profileId).toBe("profile-a");
    expect(savedRecipe.project).toBe("dam-hopper");
  });

  it("handles launch review and executes launch with authoritative confirmation", async () => {
    const transport = createMockTransport();
    const api = createApiClient({ profileId: profileA.id, generation: 1 }, transport);
    __setConnectionSnapshotForTests(
      profileA.id,
      {
        owner: { profileId: profileA.id, generation: 1 },
        status: "connected",
        intent: true,
        serverUrl: profileA.url,
        error: null,
        api,
      },
      transport,
    );
    useAgentStatusStore.setState({
      profiles: new Map([
        [
          profileA.id,
          {
            owner: { profileId: profileA.id, generation: 1 },
            epoch: 100,
            revision: 1,
            availability: "ready",
            rows: new Map(),
            cursors: new Map(),
          },
        ],
      ]),
    });

    const recipe: RecipeV1 = {
      version: 1,
      id: "recipe-ready",
      name: "Ready Recipe",
      profileId: "profile-a",
      project: "dam-hopper",
      terminalSteps: [
        {
          key: "term-step-1",
          name: "Dev Terminal",
          command: "pnpm dev",
        },
      ],
      appSteps: [],
      layout: { tree: null, floating: [] },
      createdAt: 1000,
      updatedAt: 1000,
    };

    const activeDesktop: OsDesktop = {
      id: "desktop-active",
      name: "Main Desktop",
      defaultCtx: { profileId: "profile-a" },
      tree: null,
      floatingWindowIds: [],
    };

    const connections = new Map([
      [
        profileA.id,
        {
          owner: { profileId: profileA.id, generation: 1 },
          status: "connected" as const,
          intent: true,
          serverUrl: profileA.url,
          error: null,
        },
      ],
    ]);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <MemoryRouter>
              <LaunchReview
                recipe={recipe}
                activeDesktop={activeDesktop}
                connections={connections}
                windows={{}}
                onClose={() => {}}
              />
            </MemoryRouter>
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });

    // Check Launch Review UI rendered
    expect(container.querySelector('[data-testid="recipe-launch-review"]')).not.toBeNull();

    // Click Execute Launch
    const launchBtn = container.querySelector(
      '[data-testid="recipe-start-launch-btn"]',
    ) as HTMLButtonElement;
    expect(launchBtn).not.toBeNull();
    expect(launchBtn.disabled).toBe(false);

    await act(async () => {
      launchBtn.click();
    });
    await vi.waitFor(() => {
      expect(transport.invoke).toHaveBeenCalledWith(
        "terminal:create",
        expect.objectContaining({
          command: "pnpm dev",
          project: "dam-hopper",
        }),
      );
    });

    await vi.waitFor(() => {
      const statusBadge = container.querySelector(
        '[data-testid="recipe-step-status-term-step-1"]',
      );
      expect(statusBadge?.textContent?.toLowerCase()).toContain("confirmed");
    });
  });

  it("invalidates value-bound confirmation on command edit and requires explicit re-review", async () => {
    function setInputValue(input: HTMLInputElement, value: string) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(input, value);
      } else {
        input.value = value;
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const winTerm: OsWindow = {
      id: "win-term-val",
      appId: "terminals",
      title: "Worker Terminal",
      ctx: { profileId: "profile-a", projectId: "dam-hopper" },
      mode: "tile",
      desktopId: "d-1",
      maximized: false,
      minimized: false,
    };

    const desktop: OsDesktop = {
      id: "d-1",
      name: "Desktop 1",
      defaultCtx: { profileId: "profile-a", projectId: "dam-hopper" },
      tree: {
        type: "pane",
        id: "p-1",
        items: ["win-term-val"],
        active: "win-term-val",
      },
      floatingWindowIds: [],
    };

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <MemoryRouter>
              <RecipeEditor
                desktop={desktop}
                desktops={[desktop]}
                sourceDesktopId="d-1"
                windows={{ "win-term-val": winTerm }}
                onSaved={vi.fn()}
                onCancel={vi.fn()}
              />
            </MemoryRouter>
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });

    const cmdInput = container.querySelector(
      'input[data-testid^="recipe-step-command-"]',
    ) as HTMLInputElement;
    const confirmCheckbox = container.querySelector(
      'input[type="checkbox"][data-testid^="recipe-step-confirm-"]',
    ) as HTMLInputElement;
    const saveBtn = container.querySelector(
      '[data-testid="recipe-save-submit-btn"]',
    ) as HTMLButtonElement;

    expect(cmdInput).not.toBeNull();
    expect(confirmCheckbox).not.toBeNull();
    expect(saveBtn.disabled).toBe(true);

    // 1. Confirm the initial command ("bash")
    await act(async () => {
      confirmCheckbox.click();
    });
    expect(confirmCheckbox.checked).toBe(true);
    expect(saveBtn.disabled).toBe(false);

    // 2. Edit command text -> confirmation must be invalidated immediately!
    await act(async () => {
      setInputValue(cmdInput, "npm run build");
    });
    expect(confirmCheckbox.checked).toBe(false);
    expect(saveBtn.disabled).toBe(true);

    // 3. Typing back the previously confirmed text ("bash") does NOT re-confirm without explicit user action
    await act(async () => {
      setInputValue(cmdInput, "bash");
    });
    expect(confirmCheckbox.checked).toBe(false);
    expect(saveBtn.disabled).toBe(true);

    // 4. Explicit review: re-clicking checkbox re-confirms with current value
    await act(async () => {
      confirmCheckbox.click();
    });
    expect(confirmCheckbox.checked).toBe(true);
    expect(saveBtn.disabled).toBe(false);
  });

  it("displays same-project worktree badges and includes worktree in recipe", async () => {
    const winWorktree: OsWindow = {
      id: "win-wt-1",
      appId: "editor",
      title: "Worktree Editor",
      ctx: {
        profileId: "profile-a",
        projectId: "dam-hopper",
        worktreeId: "feature-recipes",
      },
      mode: "tile",
      desktopId: "d-1",
      maximized: false,
      minimized: false,
    };

    const desktop: OsDesktop = {
      id: "d-1",
      name: "Desktop 1",
      defaultCtx: { profileId: "profile-a", projectId: "dam-hopper" },
      tree: {
        type: "pane",
        id: "p-1",
        items: ["win-wt-1"],
        active: "win-wt-1",
      },
      floatingWindowIds: [],
    };

    const onSaved = vi.fn();

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <MemoryRouter>
              <RecipeEditor
                desktop={desktop}
                desktops={[desktop]}
                sourceDesktopId="d-1"
                windows={{ "win-wt-1": winWorktree }}
                onSaved={onSaved}
                onCancel={vi.fn()}
              />
            </MemoryRouter>
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });

    const badge = container.querySelector(
      '[data-testid="recipe-worktree-badge-win-wt-1"]',
    );
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("Worktree: feature-recipes");

    // Non-terminal app step requires no confirmation checkbox; save should be immediately eligible
    const saveBtn = container.querySelector(
      '[data-testid="recipe-save-submit-btn"]',
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);

    await act(async () => {
      saveBtn.click();
    });

    expect(onSaved).toHaveBeenCalledTimes(1);
    const saved: RecipeV1 = onSaved.mock.calls[0][0];
    expect(saved.appSteps).toHaveLength(1);
    expect(saved.appSteps[0].worktreePath).toBe("feature-recipes");
  });

  it("shows actionable source-unavailable state when selected desktop is deleted", async () => {
    const desktopValid: OsDesktop = {
      id: "d-valid",
      name: "Valid Desktop",
      tree: null,
      floatingWindowIds: [],
    };

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <MemoryRouter>
              <RecipeEditor
                desktops={[desktopValid]}
                sourceDesktopId="d-deleted"
                windows={{}}
                onSaved={vi.fn()}
                onCancel={vi.fn()}
              />
            </MemoryRouter>
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });

    const unavailableNotice = container.querySelector(
      '[data-testid="recipe-source-unavailable"]',
    );
    expect(unavailableNotice).not.toBeNull();
    expect(unavailableNotice?.textContent).toContain("Source Desktop Unavailable");
    expect(
      container.querySelector('[data-testid="recipe-recovery-desktop-select"]'),
    ).not.toBeNull();
  });

  it("distinguishes empty states: fleet-only vs windows on other desktop", async () => {
    const desktopFleetOnly: OsDesktop = {
      id: "d-fleet",
      name: "Fleet Desktop",
      tree: {
        type: "pane",
        id: "p-fleet",
        items: ["win-sys-only"],
        active: "win-sys-only",
      },
      floatingWindowIds: [],
    };

    const winFleetOnly: OsWindow = {
      id: "win-sys-only",
      appId: "system-monitor",
      title: "System Monitor",
      ctx: { profileId: "profile-a" },
      mode: "tile",
      desktopId: "d-fleet",
      maximized: false,
      minimized: false,
    };

    // Case 1: Fleet-only on sole desktop
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <MemoryRouter>
              <RecipeEditor
                desktops={[desktopFleetOnly]}
                sourceDesktopId="d-fleet"
                windows={{ "win-sys-only": winFleetOnly }}
                onSaved={vi.fn()}
                onCancel={vi.fn()}
              />
            </MemoryRouter>
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });

    expect(
      container.querySelector('[data-testid="recipe-empty-fleet-only"]'),
    ).not.toBeNull();

    // Case 2: Source desktop is empty/fleet-only, but other desktop has project windows
    const desktopWithProject: OsDesktop = {
      id: "d-proj",
      name: "Project Desktop",
      tree: {
        type: "pane",
        id: "p-proj",
        items: ["win-term-other"],
        active: "win-term-other",
      },
      floatingWindowIds: [],
    };

    const winTermOther: OsWindow = {
      id: "win-term-other",
      appId: "terminals",
      title: "Other Desk Term",
      ctx: { profileId: "profile-a", projectId: "dam-hopper" },
      mode: "tile",
      desktopId: "d-proj",
      maximized: false,
      minimized: false,
    };

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <MemoryRouter>
              <RecipeEditor
                desktops={[desktopFleetOnly, desktopWithProject]}
                sourceDesktopId="d-fleet"
                windows={{
                  "win-sys-only": winFleetOnly,
                  "win-term-other": winTermOther,
                }}
                onSaved={vi.fn()}
                onCancel={vi.fn()}
              />
            </MemoryRouter>
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });

    const otherDeskNotice = container.querySelector(
      '[data-testid="recipe-empty-other-desktops"]',
    );
    expect(otherDeskNotice).not.toBeNull();
    expect(otherDeskNotice?.textContent).toContain("Switch to Project Desktop");
  });
});
