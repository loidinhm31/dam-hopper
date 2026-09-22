import { lazy, Suspense, useEffect, useState } from "react";
import { logger } from "@dam-hopper/shared/logger";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary.js";
import {
  connectProfile,
  syncActiveProfileConnection,
} from "@/api/connections.js";
import { useSettingsStore } from "@/stores/settings.js";
import {
  getServerUrl,
  buildAuthHeaders,
  getActiveProfile,
  migrateToProfiles,
  normalizeServerUrl,
  getAuthToken,
  setAuthToken,
  readServerProfiles,
  isSameOriginProfile,
  subscribeToProfileChanges,
} from "@/api/server-config.js";
import { useServerProfile } from "@/hooks/use-server-profile.js";
import { TerminalNotificationToastViewport } from "@/components/organisms/TerminalNotificationToastViewport.js";
import { EncryptProvider } from "@/contexts/EncryptContext.js";
import { AppZoomProvider } from "@/contexts/AppZoomContext.js";
import { AndroidChromeInputPolicyProvider } from "@/contexts/AndroidChromeInputPolicyContext.js";
import { useSshForwardHost } from "@/contexts/SshForwardHostContext.js";
import { AndroidChromeKeyboardNotice } from "@/components/organisms/AndroidChromeKeyboardNotice.js";
import { PassphrasePrompt } from "@/components/molecules/PassphrasePrompt.js";
import { useBrowserShortcutGuard } from "@/hooks/use-browser-shortcut-guard.js";
import { useBrowserContextMenuSuppression } from "@/hooks/use-browser-context-menu-suppression.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import { matchesNewTerminalShortcut } from "@/lib/shortcuts.js";
import { handleTerminalFontSizeShortcut } from "@/lib/terminal-keyboard-shortcuts.js";
import { isTerminalSurfaceTarget } from "@/lib/browser-shortcut-guard.js";
import { normalizeRouterBasename } from "@/lib/router-basename.js";
import { recordClientRoute } from "@/lib/diagnostics-client.js";
import {
  shouldShowFreshResetNotice,
  dismissFreshResetNotice,
  checkLegacyDeepLink,
} from "@/lib/fresh-state-reset.js";
export {
  SshForwardHostProvider,
  SshForwardScopeBridge,
  useSshForwardHost,
  type SshForwardHostEnvironment,
} from "@/contexts/SshForwardHostContext.js";
export {
  BrowserDebugHostProvider,
  useBrowserDebugHost,
  type BrowserDebugHostEnvironment,
} from "@/contexts/BrowserDebugHostContext.js";
export {
  AppZoomProvider,
  useAppZoom,
  type AppZoomContextValue,
} from "@/contexts/AppZoomContext.js";
export type {
  AppZoomDirection,
  AppZoomLevel,
  AppZoomStorage,
} from "@/lib/app-zoom.js";

function syncFontSizeCssVar(fontSize: number): void {
  document.documentElement.style.setProperty(
    "--app-font-size",
    `${fontSize}px`,
  );
}

const WorkspacePage = lazy(() => import("@/components/pages/WorkspacePage.js"));
const DashboardPage = lazy(() =>
  import("@/components/pages/DashboardPage.js").then((m) => ({
    default: m.DashboardPage,
  })),
);
const GitPage = lazy(() =>
  import("@/components/pages/GitPage.js").then((m) => ({
    default: m.GitPage,
  })),
);
const SettingsPage = lazy(() =>
  import("@/components/pages/SettingsPage.js").then((m) => ({
    default: m.SettingsPage,
  })),
);
const AgentStorePage = lazy(() =>
  import("@/components/pages/AgentStorePage.js").then((m) => ({
    default: m.AgentStorePage,
  })),
);
const UsagePage = lazy(() =>
  import("@/components/pages/UsagePage.js").then((m) => ({
    default: m.UsagePage,
  })),
);
const SshForwardingPage = lazy(() =>
  import("@/components/pages/SshForwardingPage.js").then((m) => ({
    default: m.SshForwardingPage,
  })),
);
const PluginHostPage = lazy(() =>
  import("@/components/PluginHostPage.js").then((module) => ({
    default: module.PluginHostPage,
  })),
);

const LOADING_FALLBACK = (
  <div className="app-screen-height flex items-center justify-center text-xs text-[var(--color-text-muted)]">
    Loading…
  </div>
);

/** Redirect /terminals or /ide to /workspace, preserving search params. */
function LegacyRedirect({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
}

/** Registers Ctrl+` as a global shortcut to open a new free terminal in workspace. */
function GlobalShortcuts() {
  const navigate = useNavigate();
  const activeProject = useWorkspaceStore((state) => state.activeProject);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (matchesNewTerminalShortcut(e)) {
        e.preventDefault();
        const params = new URLSearchParams({ action: "new-terminal" });
        if (activeProject) params.set("project", activeProject);
        navigate(`/workspace?${params.toString()}`);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeProject, navigate]);

  return null;
}

/** Applies terminal font-size shortcuts anywhere in the current page. */
function GlobalTerminalFontSizeShortcuts() {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // The xterm handler already applied the shortcut and prevented the
      // browser default; page-level handling must not apply it a second time.
      if (event.defaultPrevented && isTerminalSurfaceTarget(event.target)) {
        return;
      }
      const settings = useSettingsStore.getState();
      handleTerminalFontSizeShortcut(event, {
        increaseShortcut: settings.terminalFontSizeIncreaseShortcut,
        decreaseShortcut: settings.terminalFontSizeDecreaseShortcut,
        onIncrease: () => {
          const current = useSettingsStore.getState();
          if (current.terminalFontSize < 32) {
            current.saveDebounced({
              terminalFontSize: current.terminalFontSize + 1,
            });
          }
        },
        onDecrease: () => {
          const current = useSettingsStore.getState();
          if (current.terminalFontSize > 10) {
            current.saveDebounced({
              terminalFontSize: current.terminalFontSize - 1,
            });
          }
        },
      });
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return null;
}

function RouteDiagnostics() {
  const location = useLocation();

  useEffect(() => {
    recordClientRoute({
      path: location.pathname,
      search: location.search,
      hash: location.hash,
      href: `${location.pathname}${location.search}${location.hash}`,
    });
  }, [location.hash, location.pathname, location.search]);

  return null;
}

function FreshResetBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(shouldShowFreshResetNotice());
  }, []);

  if (!show) return null;

  return (
    <div
      role="status"
      className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center justify-between text-xs text-amber-300"
    >
      <span>
        Unified multi-profile workbench upgrade: legacy browser-local resource
        state was reset. Server configuration and saved profiles are preserved.
      </span>
      <button
        onClick={() => {
          dismissFreshResetNotice();
          setShow(false);
        }}
        className="ml-4 font-semibold hover:underline text-amber-200"
      >
        Dismiss
      </button>
    </div>
  );
}

function LegacyDeepLinkNotice() {
  const location = useLocation();
  const check = checkLegacyDeepLink(location);

  if (!check.isLegacy) return null;

  return (
    <div
      role="alert"
      className="bg-red-500/10 border-b border-red-500/30 px-4 py-2 text-xs text-red-400"
    >
      {check.guidance}
    </div>
  );
}

export function DamHopperApp() {
  useBrowserShortcutGuard();
  useBrowserContextMenuSuppression();
  const qc = useQueryClient();
  const activeProfile = useServerProfile();
  const { host: sshForwardHost, environment: sshForwardEnvironment } =
    useSshForwardHost();
  const sshForwardAvailable =
    sshForwardHost !== null && sshForwardEnvironment.kind === "nativeDesktop";
  const activeProfileId = activeProfile?.id;
  const activeProfileUrl = activeProfile?.url;
  const activeProfileConnectionKey = JSON.stringify([
    activeProfileId ?? "",
    activeProfileUrl ? normalizeServerUrl(activeProfileUrl) : "",
    activeProfile?.authType ?? "",
    activeProfileId ? (getAuthToken(activeProfileId) ?? "") : "",
  ]);
  const routerBasename = normalizeRouterBasename(import.meta.env.BASE_URL);

  useEffect(() => {
    const settings = useSettingsStore.getState();
    syncFontSizeCssVar(settings.systemFontSize);
    const unsubscribe = useSettingsStore.subscribe((state) => {
      syncFontSizeCssVar(state.systemFontSize);
    });

    void settings.hydrate();
    // Migrate legacy single-server config to profile system
    migrateToProfiles();

    return unsubscribe;
  }, []);

  useEffect(() => {
    return subscribeToProfileChanges((event) => {
      if (event.type === "activeChanged") {
        syncActiveProfileConnection(event.activeProfileId);
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bootstrapProfiles = async () => {
      const profilesResult = readServerProfiles();
      if (profilesResult.status !== "available") return;

      for (const profile of profilesResult.profiles) {
        if (profile.autoConnect === false) continue;
        // Auto-login for "none" auth profiles if no token exists
        if (profile.authType === "none" && !getAuthToken(profile.id)) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const res = await fetch(`${profile.url}/api/auth/login`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
              signal: controller.signal,
            });
            clearTimeout(timeout);
            if (res.ok) {
              const data = await res.json();
              if (!cancelled && data.token) {
                setAuthToken(data.token, profile.id);
              }
            }
          } catch (err) {
            if (!cancelled) {
              logger.error("DamHopperApp", "no-auth auto-login failed", {
                profileId: profile.id,
                error: err,
              });
            }
          }
        }

        if (!cancelled) {
          void connectProfile(profile.id);
        }
      }
    };

    void bootstrapProfiles();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppZoomProvider>
      <EncryptProvider>
        <AndroidChromeInputPolicyProvider>
          <BrowserRouter basename={routerBasename}>
            <AndroidChromeKeyboardNotice />
            <GlobalShortcuts />
            <GlobalTerminalFontSizeShortcuts />
            <TerminalNotificationToastViewport />
            <RouteDiagnostics />
            <PassphrasePrompt />
            <FreshResetBanner />
            <LegacyDeepLinkNotice />
            <Routes>
              <Route
                path="/"
                element={
                  <ErrorBoundary>
                    <Suspense fallback={LOADING_FALLBACK}>
                      <DashboardPage />
                    </Suspense>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/workspace"
                element={
                  <ErrorBoundary>
                    <Suspense fallback={LOADING_FALLBACK}>
                      <WorkspacePage />
                    </Suspense>
                  </ErrorBoundary>
                }
              />
              {/* Backward-compat redirects — preserve search params for deep-links */}
              <Route
                path="/terminals"
                element={<LegacyRedirect to="/workspace" />}
              />
              <Route path="/ide" element={<LegacyRedirect to="/workspace" />} />
              <Route
                path="/git"
                element={
                  <ErrorBoundary>
                    <Suspense fallback={LOADING_FALLBACK}>
                      <GitPage />
                    </Suspense>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/settings"
                element={
                  <ErrorBoundary>
                    <Suspense fallback={LOADING_FALLBACK}>
                      <SettingsPage />
                    </Suspense>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/agent-store"
                element={
                  <ErrorBoundary>
                    <Suspense fallback={LOADING_FALLBACK}>
                      <AgentStorePage />
                    </Suspense>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/usage"
                element={
                  <ErrorBoundary>
                    <Suspense fallback={LOADING_FALLBACK}>
                      <UsagePage />
                    </Suspense>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/plugins/:installationId"
                element={
                  <ErrorBoundary>
                    <Suspense fallback={LOADING_FALLBACK}>
                      <PluginHostPage />
                    </Suspense>
                  </ErrorBoundary>
                }
              />
              {sshForwardAvailable ? (
                <Route
                  path="/ssh-forwarding"
                  element={
                    <ErrorBoundary>
                      <Suspense fallback={LOADING_FALLBACK}>
                        <SshForwardingPage />
                      </Suspense>
                    </ErrorBoundary>
                  }
                />
              ) : null}
            </Routes>
          </BrowserRouter>
        </AndroidChromeInputPolicyProvider>
      </EncryptProvider>
    </AppZoomProvider>
  );
}
