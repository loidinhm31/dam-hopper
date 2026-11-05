import * as React from "react";
import { Pin, PinOff, Search, X } from "lucide-react";
import type { ActionContext, OsAppId } from "./types.js";
import { APP_MANIFESTS } from "./app-registry.js";
import { AppIcon } from "./app-icons.js";
import {
  getDockPinsSnapshot,
  subscribeDockPins,
  toggleDockPin,
} from "./dock-pins.js";
import { useWindowStore } from "./window-store.js";
import { executeAction } from "./action-executor.js";
import { getConnectionSnapshot } from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { useOptionalShellInputContext } from "./shell-input-context.js";

export interface AppLauncherProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunchApp?: (appId: OsAppId) => void;
  className?: string;
}

export function AppLauncher({
  isOpen,
  onClose,
  onLaunchApp,
  className = "",
}: AppLauncherProps) {
  const [search, setSearch] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const pinnedApps = React.useSyncExternalStore(
    subscribeDockPins,
    getDockPinsSnapshot,
    getDockPinsSnapshot,
  );

  const session = useWindowStore((state) => state.session);

  const shellInput = useOptionalShellInputContext();
  const registerModalMount = shellInput?.registerModalMount;

  React.useEffect(() => {
    if (isOpen && registerModalMount) {
      return registerModalMount("command-palette");
    }
  }, [isOpen, registerModalMount]);
  // Auto-focus search input when opened, reset search
  React.useEffect(() => {
    if (isOpen) {
      setSearch("");
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle Escape key
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const activeDesktopId = session.activeDesktopId;
  const activeDesktop =
    session.desktops.find((d) => d.id === activeDesktopId) ??
    session.desktops[0];
  const desktopCtx = activeDesktop?.defaultCtx ?? { profileId: "default" };

  let owner: ConnectionRef | null = null;
  if (desktopCtx.profileId) {
    try {
      const snap = getConnectionSnapshot(desktopCtx.profileId);
      if (snap && snap.status === "connected") {
        owner = snap.owner;
      }
    } catch {
      // Fall back
    }
  }

  const capturedContext: ActionContext = {
    kind: "desktop",
    desktopId: activeDesktopId,
    windowContext: desktopCtx,
    owner,
    target: desktopCtx.target,
  };

  const handleLaunch = (appId: OsAppId) => {
    onClose();
    if (onLaunchApp) {
      onLaunchApp(appId);
      return;
    }
    const actionId = `app.${appId}.open` as const;
    void executeAction({
      id: actionId,
      context: capturedContext,
    });
  };

  const handleTogglePin = (e: React.MouseEvent, appId: OsAppId) => {
    e.stopPropagation();
    toggleDockPin(appId);
  };

  const allManifests = Object.values(APP_MANIFESTS);
  const normalizedQuery = search.trim().toLowerCase();
  const filteredApps = normalizedQuery
    ? allManifests.filter(
        (m) =>
          m.displayName.toLowerCase().includes(normalizedQuery) ||
          m.appId.toLowerCase().includes(normalizedQuery),
      )
    : allManifests;

  const runningAppIds = new Set<string>();
  for (const win of Object.values(session.windows)) {
    runningAppIds.add(win.appId);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Applications Catalog"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs select-none"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      data-testid="app-launcher-backdrop"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-testid="app-launcher-panel"
      >
        {/* Header with Search and Close */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
          <Search
            size={18}
            className="text-[var(--color-text-muted)] shrink-0"
            aria-hidden="true"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search applications..."
            aria-label="Search applications"
            className="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none"
            data-testid="app-launcher-search"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close applications catalog"
            className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
            data-testid="app-launcher-close"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Applications Grid */}
        <div className="flex-1 overflow-y-auto p-4 min-h-60">
          {filteredApps.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-[var(--color-text-muted)] text-sm">
              <p>No applications match &quot;{search}&quot;</p>
            </div>
          ) : (
            <div
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3"
              data-testid="app-launcher-grid"
            >
              {filteredApps.map((app) => {
                const isPinned = pinnedApps.includes(app.appId);
                const isRunning = runningAppIds.has(app.appId);

                return (
                  <div
                    key={app.appId}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleLaunch(app.appId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleLaunch(app.appId);
                      }
                    }}
                    aria-label={`Launch ${app.displayName}`}
                    data-testid={`app-card-${app.appId}`}
                    className="group relative flex flex-col items-center justify-center p-3 rounded-lg border border-[var(--color-border)]/50 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-all cursor-pointer text-center"
                  >
                    {/* Pin toggle button in top-right corner of card */}
                    <button
                      type="button"
                      aria-label={
                        isPinned
                          ? `Unpin ${app.displayName} from Dock`
                          : `Pin ${app.displayName} to Dock`
                      }
                      title={
                        isPinned
                          ? `Unpin ${app.displayName} from Dock`
                          : `Pin ${app.displayName} to Dock`
                      }
                      onClick={(e) => handleTogglePin(e, app.appId)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                      }}
                      data-testid={`app-pin-btn-${app.appId}`}
                      className={`absolute top-1.5 right-1.5 p-1 rounded-md transition-opacity ${
                        isPinned
                          ? "opacity-100 text-[var(--color-primary)] bg-[var(--color-primary)]/10"
                          : "opacity-0 group-hover:opacity-100 focus:opacity-100 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
                      }`}
                    >
                      {isPinned ? (
                        <PinOff size={14} aria-hidden="true" />
                      ) : (
                        <Pin size={14} aria-hidden="true" />
                      )}
                    </button>

                    {/* App Icon */}
                    <div className="relative flex items-center justify-center w-12 h-12 mb-2 rounded-xl bg-[var(--color-surface-hover)] text-[var(--color-text)] group-hover:scale-105 transition-transform">
                      <AppIcon appId={app.appId} size={24} />
                      {/* Running dot indicator */}
                      {isRunning && (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[var(--color-primary)] ring-2 ring-[var(--color-surface)]"
                          title="Running"
                        />
                      )}
                    </div>

                    {/* App Display Name */}
                    <span className="text-xs font-medium text-[var(--color-text)] truncate max-w-full">
                      {app.displayName}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
