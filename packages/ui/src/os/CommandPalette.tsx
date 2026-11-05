import {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { useShellInputContext } from "./shell-input-context.js";
import { useWindowStore } from "./window-store.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { APP_MANIFESTS, findExistingWindowForApp } from "./app-registry.js";
import { createProjectDesktopTemplate } from "./desktop-templates.js";

import { generateUUID } from "@/lib/utils.js";
import { loadAllRecipes } from "./recipes/persistence.js";
import { dispatchIntent, createIntent } from "./intents.js";
import { getConnectionSnapshot, getApi } from "@/api/connections.js";
import { isCanonicalUuid } from "@/api/terminal-session-contract.js";
import { listActionDescriptors, resolveActionBinding } from "./actions.js";
import { canExecuteAction, executeAction } from "./action-executor.js";
import { APP_ICONS } from "./app-icons.js";
import type { ActionContext, OsAppId } from "./types.js";
export type PaletteMode =
  | "commands"
  | "agents"
  | "windows"
  | "files"
  | "recipes";

export interface PaletteItem {
  id: string;
  mode: PaletteMode;
  title: string;
  description?: string;
  shortcut?: string;
  appId?: OsAppId;
  disabled?: boolean;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  className?: string;
}

export function CommandPalette({
  isOpen,
  onClose,
  className = "",
}: CommandPaletteProps) {
  const isCognitoActive = useCognitoModeStore((state) => state.active);
  const session = useWindowStore((state) => state.session);
  const setSession = useWindowStore((state) => state.setSession);
  const openWindow = useWindowStore((state) => state.openWindow);
  const focusWindow = useWindowStore((state) => state.focusWindow);
  const switchDesktop = useWindowStore((state) => state.switchDesktop);
  const restoreWindow = useWindowStore((state) => state.restoreWindow);
  const toggleMaximizeWindow = useWindowStore(
    (state) => state.toggleMaximizeWindow,
  );
  const minimizeWindow = useWindowStore((state) => state.minimizeWindow);
  const setWindowMode = useWindowStore((state) => state.setWindowMode);
  const addDesktop = useWindowStore((state) => state.addDesktop);

  const [query, setQuery] = useState("");
  const [activeMode, setActiveMode] = useState<PaletteMode>("commands");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const invokingElementRef = useRef<HTMLElement | null>(null);

  const { registerModalMount } = useShellInputContext();

  // Register modal mount lifecycle token
  useEffect(() => {
    if (isOpen) {
      return registerModalMount("command-palette");
    }
  }, [isOpen, registerModalMount]);

  const handleClose = useCallback(() => {
    onClose();
    if (invokingElementRef.current && invokingElementRef.current.isConnected) {
      invokingElementRef.current.focus();
    }
  }, [onClose]);

  // Close immediately if Cognito Privacy Mode activates
  useEffect(() => {
    if (isCognitoActive && isOpen) {
      handleClose();
    }
  }, [isCognitoActive, isOpen, handleClose]);

  // Synchronous auto-focus on open and capture invoking element
  useEffect(() => {
    if (isOpen) {
      invokingElementRef.current = document.activeElement as HTMLElement | null;
      setQuery("");
      setSelectedIndex(0);
      inputRef.current?.focus();
    }
  }, [isOpen]);
  const activeDesktop =
    session.desktops.find((d) => d.id === session.activeDesktopId) ??
    session.desktops[0];

  // Derive mode from query prefix if typed
  const { currentMode, cleanQuery } = useMemo(() => {
    const trimmed = query.trimStart();
    if (trimmed.startsWith(">")) {
      return { currentMode: "commands" as PaletteMode, cleanQuery: trimmed.slice(1).trim() };
    }
    if (trimmed.startsWith("@")) {
      return { currentMode: "agents" as PaletteMode, cleanQuery: trimmed.slice(1).trim() };
    }
    if (trimmed.startsWith("#")) {
      return { currentMode: "windows" as PaletteMode, cleanQuery: trimmed.slice(1).trim() };
    }
    if (trimmed.startsWith("/")) {
      return { currentMode: "files" as PaletteMode, cleanQuery: trimmed.slice(1).trim() };
    }
    if (trimmed.startsWith("!")) {
      return { currentMode: "recipes" as PaletteMode, cleanQuery: trimmed.slice(1).trim() };
    }
    return { currentMode: activeMode, cleanQuery: trimmed };
  }, [query, activeMode]);

  // Built-in Commands Provider
  const commandItems = useMemo<PaletteItem[]>(() => {
    const actionCommands: PaletteItem[] = listActionDescriptors().map((desc) => {
      const binding = resolveActionBinding(desc.id, useSettingsStore.getState());
      const actionContext: ActionContext = {
        kind: "desktop",
        desktopId: activeDesktop?.id ?? "desktop-1",
        windowContext: activeDesktop?.defaultCtx ?? { profileId: "default" },
      };
      const check = canExecuteAction({ id: desc.id, context: actionContext });
      return {
        id: `cmd-action-${desc.id}`,
        appId: desc.appId,
        mode: "commands" as const,
        title: desc.label,
        description: check.canExecute ? desc.enabledExplanation : check.reason,
        shortcut: binding ?? undefined,
        disabled: !check.canExecute,
        onSelect: async () => {
          await executeAction({ id: desc.id, context: actionContext });
          onClose();
        },
      };
    });

    const items: PaletteItem[] = [
      ...actionCommands,
      {
        id: "cmd-new-desktop",
        mode: "commands",
        title: "Add Virtual Desktop",
        description: "Create an empty virtual desktop",
        onSelect: () => {
          addDesktop();
          onClose();
        },
      },
      {
        id: "cmd-apply-project-template",
        mode: "commands",
        title: "Create Project Desktop",
        description:
          "Add new desktop with approved 60/40 layout (Terminals + Files/Search + Git/Changes)",
        onSelect: () => {
          const newDesktopId = `desktop-${generateUUID().slice(0, 8)}`;
          const desktopCtx =
            activeDesktop?.defaultCtx ?? { profileId: "default" };
          const { desktop, windows } = createProjectDesktopTemplate(
            `Project (${desktopCtx.projectId ?? "Workspace"})`,
            desktopCtx,
            newDesktopId,
          );
          const current = session;
          const updatedDesktops = [...current.desktops, desktop];
          const updatedWindows = { ...current.windows };
          for (const w of windows) {
            updatedWindows[w.id] = w;
          }
          setSession({
            ...current,
            desktops: updatedDesktops,
            windows: updatedWindows,
            activeDesktopId: newDesktopId,
          });
          onClose();
        },
      },
    ];

    // Contextual active window commands
    if (activeDesktop?.focusedWindowId) {
      const focusedWin = session.windows[activeDesktop.focusedWindowId];
      if (focusedWin) {
        items.push({
          id: "cmd-toggle-maximize",
          mode: "commands",
          title: focusedWin.maximized ? "Restore Window" : "Maximize Window",
          description: `Affects active window: ${focusedWin.title}`,
          onSelect: () => {
            toggleMaximizeWindow(focusedWin.id);
            onClose();
          },
        });
        items.push({
          id: "cmd-toggle-float",
          mode: "commands",
          title:
            focusedWin.mode === "tile" ? "Float Window" : "Tile Window",
          description: `Switch window layout mode for ${focusedWin.title}`,
          onSelect: () => {
            setWindowMode(
              focusedWin.id,
              focusedWin.mode === "tile" ? "float" : "tile",
            );
            onClose();
          },
        });
        items.push({
          id: "cmd-minimize-window",
          mode: "commands",
          title: "Minimize Window",
          description: `Minimize ${focusedWin.title} to tray`,
          onSelect: () => {
            minimizeWindow(focusedWin.id);
            onClose();
          },
        });
      }
    }

    return items;
  }, [
    activeDesktop,
    session,
    setSession,
    openWindow,
    focusWindow,
    restoreWindow,
    addDesktop,
    toggleMaximizeWindow,
    setWindowMode,
    minimizeWindow,
    onClose,
  ]);

  // Windows Provider
  const windowItems = useMemo<PaletteItem[]>(() => {
    return Object.values(session.windows).map((win) => ({
      id: `win-${win.id}`,
      mode: "windows",
      title: win.title,
      description: `${win.desktopId} · ${win.mode}${win.minimized ? " · minimized" : ""}`,
      onSelect: () => {
        if (win.desktopId !== session.activeDesktopId) {
          switchDesktop(win.desktopId);
        }
        if (win.minimized) {
          restoreWindow(win.id);
        }
        focusWindow(win.id);
        onClose();
      },
    }));
  }, [session.windows, session.activeDesktopId, switchDesktop, restoreWindow, focusWindow, onClose]);

  // Lazy Agents Provider (placeholder until Phase 07 agent hub)
  const agentItems = useMemo<PaletteItem[]>(() => {
    return [
      {
        id: "agent-omp",
        mode: "agents",
        title: "OMP Agent Session",
        description: "OpenCode Interpreter agent process",
        onSelect: () => {
          openWindow(
            {
              id: `terminals-omp-${generateUUID().slice(0, 8)}`,
              appId: "terminals",
              title: "OMP Terminal",
              ctx: activeDesktop?.defaultCtx ?? { profileId: "default" },
              mode: "tile",
            },
            session.activeDesktopId,
          );
          onClose();
        },
      },
    ];
  }, [activeDesktop, session.activeDesktopId, openWindow, onClose]);

  // Lazy Files Provider
  const fileItems = useMemo<PaletteItem[]>(() => {
    return [
      {
        id: "file-open",
        mode: "files",
        title: "Quick Open File in Editor",
        description: "Focus or launch editor to open files",
        onSelect: () => {
          openWindow(
            {
              id: `editor-${generateUUID().slice(0, 8)}`,
              appId: "editor",
              title: "Editor",
              ctx: activeDesktop?.defaultCtx ?? { profileId: "default" },
              mode: useSettingsStore.getState().defaultWindowPlacement ?? "float",
            },
            session.activeDesktopId,
          );
          onClose();
        },
      },
    ];
  }, [activeDesktop, session.activeDesktopId, openWindow, onClose]);

  const recipeItems = useMemo<PaletteItem[]>(() => {
    const recipes = loadAllRecipes();
    const items: PaletteItem[] = [
      {
        id: "recipe-action-open-manager",
        mode: "recipes",
        title: "Open Recipes Manager",
        description: "Browse, import, or create launch recipes",
        onSelect: () => {
          onClose();
          dispatchIntent(createIntent("recipes:open", {}));
        },
      },
    ];

    for (const r of recipes) {
      items.push({
        id: `recipe-item-${r.id}`,
        mode: "recipes",
        title: `Launch: ${r.name}`,
        description: `${r.profileId} • ${r.project} • ${r.terminalSteps.length} terminals, ${r.appSteps.length} apps`,
        onSelect: () => {
          onClose();
          dispatchIntent(createIntent("recipes:launch", { profileId: r.profileId, recipeId: r.id }));
        },
      });
    }

    return items;
  }, [onClose]);

  // Filter items by currentMode and query
  const filteredItems = useMemo(() => {
    let pool: PaletteItem[] = [];
    switch (currentMode) {
      case "commands":
        pool = commandItems;
        break;
      case "windows":
        pool = windowItems;
        break;
      case "agents":
        pool = agentItems;
        break;
      case "files":
        pool = fileItems;
        break;
      case "recipes":
        pool = recipeItems;
        break;
    }

    if (!cleanQuery) return pool;
    const lower = cleanQuery.toLowerCase();
    return pool.filter(
      (item) =>
        item.title.toLowerCase().includes(lower) ||
        item.description?.toLowerCase().includes(lower),
    );
  }, [currentMode, cleanQuery, commandItems, windowItems, agentItems, fileItems, recipeItems]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      handleClose();
    } else if (e.key === "Tab") {
      // Focus trap within palette
      if (!dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'input, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filteredItems.length > 0 ? (prev + 1) % filteredItems.length : 0,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filteredItems.length > 0
          ? (prev - 1 + filteredItems.length) % filteredItems.length
          : 0,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = filteredItems[selectedIndex];
      if (selected && !selected.disabled) {
        handleClose();
        selected.onSelect();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      onKeyDown={handleKeyDown}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          e.stopPropagation();
          handleClose();
        }
      }}
      className={`fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/60 backdrop-blur-sm select-none ${className}`}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-xl rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl overflow-hidden flex flex-col"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
          <span className="text-sm text-[var(--color-text-muted)]">🔍</span>
          <input
            ref={inputRef}
            type="text"
            aria-label="Search commands, agents, windows, files, recipes"
            placeholder="Type a command, or > (commands), # (windows), @ (agents), / (files), ! (recipes)..."
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            className="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none"
          />
          <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono border border-[var(--color-border)] text-[var(--color-text-muted)]">
            ESC
          </kbd>
        </div>

        {/* Mode Tabs */}
        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] text-xs">
          {(["commands", "windows", "agents", "files", "recipes"] as PaletteMode[]).map(
            (mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setActiveMode(mode);
                  setSelectedIndex(0);
                  inputRef.current?.focus();
                }}
                className={`px-2 py-0.5 rounded text-xs capitalize transition-colors ${
                  currentMode === mode
                    ? "bg-[var(--color-primary)] text-white font-medium"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
                }`}
              >
                {mode}
              </button>
            ),
          )}
        </div>

        {/* Results List */}
        <div
          role="listbox"
          aria-label="Palette results"
          className="max-h-72 overflow-y-auto p-1.5 flex flex-col gap-0.5"
        >
          {filteredItems.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-[var(--color-text-muted)]">
              No matching items found
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    if (!item.disabled) {
                      handleClose();
                      item.onSelect();
                    }
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors text-xs ${
                    item.disabled
                      ? "opacity-50 cursor-not-allowed"
                      : isSelected
                        ? "bg-[var(--color-primary)] text-white"
                        : "text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
                  }`}
                >
                  <div className="flex items-center gap-2 truncate mr-2">
                    {item.appId && APP_ICONS[item.appId] && (() => {
                      const Icon = APP_ICONS[item.appId!];
                      return <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />;
                    })()}
                    <div className="flex flex-col gap-0.5 truncate">
                      <span className="font-medium truncate">{item.title}</span>
                      {item.description && (
                        <span
                          className={`text-[11px] truncate ${
                            isSelected ? "text-white/80" : "text-[var(--color-text-muted)]"
                          }`}
                        >
                          {item.description}
                        </span>
                      )}
                    </div>
                  </div>
                  {item.shortcut && (
                    <kbd
                      className={`px-1.5 py-0.5 rounded font-mono text-[10px] ${
                        isSelected
                          ? "bg-white/20 text-white"
                          : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border border-[var(--color-border)]"
                      }`}
                    >
                      {item.shortcut}
                    </kbd>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
