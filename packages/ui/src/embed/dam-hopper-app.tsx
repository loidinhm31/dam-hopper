import { lazy, Suspense, useEffect, useLayoutEffect, useState } from "react";
import { logger } from "@dam-hopper/shared/logger";
import { Server, LogIn } from "lucide-react";
import { ServerProfilesDialog } from "@/components/organisms/ServerProfilesDialog.js";
import { ServerSettingsDialog } from "@/components/organisms/ServerSettingsDialog.js";
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
  registerConnectionRegistryQueryClient,
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
  type ServerProfile,
  subscribeToProfileChanges,
} from "@/api/server-config.js";
import { useServerProfile } from "@/hooks/use-server-profile.js";
import { TerminalNotificationToastViewport } from "@/components/organisms/TerminalNotificationToastViewport.js";
import { AgentStatusBridge } from "@/components/organisms/AgentStatusBridge.js";
import { EncryptProvider } from "@/contexts/EncryptContext.js";
import { AppZoomProvider } from "@/contexts/AppZoomContext.js";
import { TunnelReminderBanner } from "@/components/organisms/TunnelReminderBanner.js";
import { PassphrasePrompt } from "@/components/molecules/PassphrasePrompt.js";
import { HostSleepConsentHost } from "@/components/organisms/HostSleepConsentHost.js";
import { useCognitoModeInputGuard } from "@/hooks/use-cognito-mode-input-guard.js";
import { CognitoModeOverlay } from "@/components/organisms/CognitoModeOverlay.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useBrowserContextMenuSuppression } from "@/hooks/use-browser-context-menu-suppression.js";
import { installRootKeyboardCoordinator } from "@/os/action-dispatch.js";
import { normalizeRouterBasename } from "@/lib/router-basename.js";
import { recordClientRoute } from "@/lib/diagnostics-client.js";
import {
  shouldShowFreshResetNotice,
  dismissFreshResetNotice,
  checkLegacyDeepLink,
} from "@/lib/fresh-state-reset.js";
import { translateLegacyRoute } from "@/os/deep-links.js";
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
const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
const OsShell = lazy(() =>
  import("@/os/OsShell.js").then((m) => ({
    default: m.OsShell,
  })),
);

const LOADING_FALLBACK = (
  <div className="app-screen-height flex items-center justify-center text-xs text-[var(--color-text-muted)]">
    Loading…
  </div>
);

function LegacyRouteHandler() {
  const location = useLocation();
  const translation = translateLegacyRoute(location.pathname, location.search);

  if (translation.status === "redirect" && translation.targetUrl) {
    const hash = location.hash || "";
    return <Navigate to={`${translation.targetUrl}${hash}`} replace />;
  }

  if (translation.status === "unqualified") {
    return (
      <div className="flex flex-col h-full w-full">
        <div
          role="alert"
          data-testid="legacy-unqualified-notice"
          className="bg-red-500/10 border-b border-red-500/30 px-4 py-2 text-xs text-red-400 shrink-0 select-none z-50"
        >
          {translation.guidance}
        </div>
        <div className="flex-1 min-h-0">
          <AuthenticatedOsRoute />
        </div>
      </div>
    );
  }

  return <Navigate to="/" replace />;
}

function RemovedFeatureNotice({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div
      data-testid={`removed-route-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      className="flex h-full items-center justify-center p-8 text-center"
    >
      <div className="max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
        <h2 className="mb-2 text-lg font-semibold text-[var(--color-text)]">
          {title}
        </h2>
        <p className="text-sm text-[var(--color-text-muted)]">{description}</p>
      </div>
    </div>
  );
}

export function isRemovedRoutePath(pathname: string, basename = ""): boolean {
  let relative = pathname;
  if (basename && basename !== "/" && relative.startsWith(basename)) {
    relative = relative.slice(basename.length);
  }
  const clean = relative.replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
  const segment = clean.split("/")[0] ?? "";
  return segment === "usage" || segment === "ssh-forwarding";
}

function RemovedRouteScreen({ pathname }: { pathname: string }) {
  const isUsage = pathname.toLowerCase().includes("usage");
  return (
    <div
      data-testid={
        isUsage
          ? "removed-route-usage-telemetry-retired"
          : "removed-route-ssh-port-forwarding-retired"
      }
      className="app-screen-height flex items-center justify-center p-8 bg-[var(--color-bg)] text-[var(--color-text)]"
    >
      <RemovedFeatureNotice
        title={
          isUsage
            ? "Usage & Telemetry Retired"
            : "SSH Port Forwarding Retired"
        }
        description={
          isUsage
            ? "Usage telemetry and reporting services have been permanently removed."
            : "Native desktop SSH port forwarding has been removed. Use standard SSH client tunneling or server-managed port forwards."
        }
      />
    </div>
  );
}

function AuthenticatedOsRoute() {
  const profile = useServerProfile();
  const token = profile ? getAuthToken(profile.id) : null;
  const isAuthenticated = Boolean(
    profile && (profile.authType === "none" || token),
  );
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<ServerProfile | null | undefined>(undefined);

  if (!isAuthenticated) {
    return (
      <div
        data-testid="os-unauthenticated"
        className="flex h-full w-full items-center justify-center p-8 text-center bg-[var(--color-bg)]"
      >
        <div className="max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4 shadow-xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
            <Server className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              Authentication Required
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Connect to an active authenticated server profile to access DamHopper OS.
            </p>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setProfilesOpen(true)}
              data-testid="os-login-button"
              className="inline-flex items-center gap-2 rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-[var(--color-primary)]/90 transition-colors"
            >
              <LogIn className="h-4 w-4" />
              Manage Servers &amp; Log In
            </button>
          </div>
          {profilesOpen && (
            <ServerProfilesDialog
              open={profilesOpen}
              onClose={() => setProfilesOpen(false)}
              onEditProfile={(p) => setEditingProfile(p)}
            />
          )}
          {editingProfile !== undefined && (
            <ServerSettingsDialog
              open={editingProfile !== undefined}
              profile={editingProfile}
              onClose={() => setEditingProfile(undefined)}
            />
          )}
        </div>
      </div>
    );
  }

  return <OsShell />;
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
  if (location.pathname.startsWith("/os")) return null;
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

function DamHopperAppInner() {
  useCognitoModeInputGuard();
  useClientLayoutEffect(() => {
    return installRootKeyboardCoordinator();
  }, []);
  const routerBasename = normalizeRouterBasename(import.meta.env.BASE_URL);
  useBrowserContextMenuSuppression();
  const cognitoActive = useCognitoModeStore((state) => state.active);
  const qc = useQueryClient();
  const activeProfile = useServerProfile();
  const activeProfileId = activeProfile?.id;
  const activeProfileUrl = activeProfile?.url;
  const activeProfileConnectionKey = JSON.stringify([
    activeProfileId ?? "",
    activeProfileUrl ? normalizeServerUrl(activeProfileUrl) : "",
    activeProfile?.authType ?? "",
    activeProfileId ? (getAuthToken(activeProfileId) ?? "") : "",
  ]);

  useEffect(() => {
    return registerConnectionRegistryQueryClient(qc);
  }, [qc]);

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
      // Skip bootstrap when viewing retired feature notice to guarantee zero network/mutation
      if (typeof window !== "undefined") {
        const path = window.location.pathname;
        if (path.endsWith("/usage") || path.endsWith("/ssh-forwarding")) {
          return;
        }
      }

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
        <CognitoModeOverlay />
            <TerminalNotificationToastViewport />
            <AgentStatusBridge />
            <RouteDiagnostics />
            <div
              data-cognito-mode-content=""
              inert={cognitoActive ? true : undefined}
              aria-hidden={cognitoActive ? "true" : undefined}
              className="app-screen-height flex flex-col overflow-hidden"
            >
              <PassphrasePrompt />
              <FreshResetBanner />
              <LegacyDeepLinkNotice />
              <TunnelReminderBanner />
              <HostSleepConsentHost />
              <div className="app-route-viewport min-h-0 flex-1">
              <Routes>
                <Route
                  path="/"
                  element={
                    <ErrorBoundary>
                      <Suspense fallback={LOADING_FALLBACK}>
                        <AuthenticatedOsRoute />
                      </Suspense>
                    </ErrorBoundary>
                  }
                />
                <Route
                  path="/os"
                  element={
                    <ErrorBoundary>
                      <Suspense fallback={LOADING_FALLBACK}>
                        <AuthenticatedOsRoute />
                      </Suspense>
                    </ErrorBoundary>
                  }
                />
                <Route path="/workspace" element={<LegacyRouteHandler />} />
                <Route path="/terminals" element={<LegacyRouteHandler />} />
                <Route path="/ide" element={<LegacyRouteHandler />} />
                <Route path="/git" element={<LegacyRouteHandler />} />
                <Route path="/settings" element={<LegacyRouteHandler />} />
                <Route path="/devices" element={<LegacyRouteHandler />} />
                <Route path="/agent-store" element={<LegacyRouteHandler />} />
                <Route
                  path="/ssh-forwarding"
                  element={
                    <RemovedFeatureNotice
                      title="SSH Port Forwarding Retired"
                      description="Native desktop SSH port forwarding has been removed. Use standard SSH client tunneling or server-managed port forwards."
                    />
                  }
                />
                <Route
                  path="/usage"
                  element={
                    <RemovedFeatureNotice
                      title="Usage & Telemetry Retired"
                      description="Usage telemetry and reporting services have been permanently removed."
                    />
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              </div>
            </div>
      </EncryptProvider>
    </AppZoomProvider>
  );
}

function AppContentRouter() {
  const location = useLocation();
  if (isRemovedRoutePath(location.pathname)) {
    return <RemovedRouteScreen pathname={location.pathname} />;
  }
  return <DamHopperAppInner />;
}

export function DamHopperApp() {
  const routerBasename = normalizeRouterBasename(import.meta.env.BASE_URL);
  return (
    <BrowserRouter basename={routerBasename}>
      <AppContentRouter />
    </BrowserRouter>
  );
}
