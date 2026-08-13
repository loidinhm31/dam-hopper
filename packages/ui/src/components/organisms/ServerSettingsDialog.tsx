import { useState, useEffect, useRef } from "react";
import { X, Server, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { revokeCurrentMediaSession } from "@/api/media-session.js";
import type { ServerProfile } from "@/api/server-config.js";
import {
  getServerUrl,
  haveServerUrlsChanged,
  normalizeServerUrl,
  shouldClearAuthTokenForUrlChange,
  setServerUrl,
  clearServerUrl,
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  isCrossOriginServer,
  getAuthUsername,
  setAuthUsername,
  clearAuthUsername,
  hasServerUrl,
  getActiveProfile,
  getActiveProfileId,
  clearActiveProfile,
  createProfile,
  getProfiles,
  saveProfiles,
  updateProfile,
  setActiveProfile,
} from "@/api/server-config.js";
import { useAndroidChromeInputPolicy } from "@/contexts/AndroidChromeInputPolicyContext.js";

interface Props {
  open: boolean;
  onClose: () => void;
  closable?: boolean;
  profile?: ServerProfile | null; // null = new profile, undefined = legacy mode
  onSaved?: (profile: ServerProfile) => void;
}

type TestState = "idle" | "testing" | "ok" | "fail";

function secureBearerHeaders(
  serverUrl: string,
  token: string | null,
): Record<string, string> {
  if (!token) return {};
  try {
    return new URL(serverUrl).protocol === "https:"
      ? { Authorization: `Bearer ${token}` }
      : {};
  } catch {
    return {};
  }
}

export function ServerSettingsDialog({
  open,
  onClose,
  closable = true,
  profile,
  onSaved,
}: Props) {
  const { isAndroidChromeNativeInputSuppressed } =
    useAndroidChromeInputPolicy();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<"basic" | "none">("basic");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [initialUrl, setInitialUrl] = useState("");
  const [initialToken, setInitialToken] = useState("");
  const [testState, setTestState] = useState<TestState>("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const latestUrlRef = useRef("");
  const latestProfileIdRef = useRef<string | undefined>(profile?.id);
  const testRequestIdRef = useRef(0);
  latestProfileIdRef.current = profile?.id;

  const isEditMode = profile !== undefined;

  useEffect(() => {
    if (open) {
      const storedUrl =
        profile?.url ?? (profile === undefined ? getServerUrl() : "");
      latestUrlRef.current = normalizeServerUrl(storedUrl);
      testRequestIdRef.current += 1;
      if (profile) {
        // Edit existing profile
        setName(profile.name);
        setUrl(profile.url);
        setAuthType(profile.authType);
        setUsername(profile.username || "");
        setPassword("");
      } else if (isEditMode) {
        // New profile (profile = null)
        setName("");
        setUrl("");
        setAuthType("basic");
        setUsername("");
        setPassword("");
      } else {
        // Legacy mode (profile = undefined)
        setName("");
        setUrl(getServerUrl());
        setAuthType("basic");
        setUsername(getAuthUsername());
        setPassword("");
      }
      const tokenProfileId =
        profile?.id ??
        (profile === undefined
          ? (getActiveProfileId() ?? undefined)
          : undefined);
      const storedToken =
        profile === null ? "" : (getAuthToken(tokenProfileId) ?? "");
      setInitialUrl(storedUrl);
      setInitialToken(storedToken);
      setToken(storedToken);
      setTestState("idle");
      setTestError(null);
      setSaved(false);
    }
  }, [open, profile, isEditMode]);

  if (!open) return null;

  const rawUrl = url.trim();
  // Auto-prepend protocol for display normalization (matches setServerUrl behavior)
  const normalized = normalizeServerUrl(rawUrl);

  /** Reject non-http(s) schemes to prevent javascript:, data:, etc. */
  const hasUnsupportedScheme =
    /^[a-z][a-z\d+.-]*:/i.test(rawUrl) &&
    !/^https?:\/\//i.test(rawUrl) &&
    !/^(?:[a-z\d.-]+|\[[0-9a-f:]+\]):\d+(?:[/?#]|$)/i.test(rawUrl);
  const urlSchemeValid =
    !rawUrl ||
    (!hasUnsupportedScheme &&
      Boolean(normalized) &&
      /^https?:\/\/.+/i.test(normalized));
  const crossOrigin =
    urlSchemeValid && normalized ? isCrossOriginServer(normalized) : false;
  const invalidateConnectionTest = () => {
    testRequestIdRef.current += 1;
    setTestState("idle");
    setTestError(null);
  };

  async function testConnection() {
    if (isAndroidChromeNativeInputSuppressed) return;
    if (!normalized || !urlSchemeValid) return;
    const requestId = ++testRequestIdRef.current;
    const requestUrl = normalized;
    const requestProfileId = profile?.id;
    latestUrlRef.current = requestUrl;
    const isCurrentRequest = () =>
      requestId === testRequestIdRef.current &&
      requestUrl === latestUrlRef.current &&
      requestProfileId === latestProfileIdRef.current;

    setTestState("testing");
    setTestError(null);
    try {
      // Different body based on auth type
      const u = username.trim();
      const p = password.trim();
      const bodyContent =
        authType === "none" ? {} : { username: u, password: p };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(`${normalized}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyContent),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);

        if (!isCurrentRequest()) return;

        if (res.ok && data?.token) {
          setToken(data.token);
          setTestState("ok");

          // Show dev mode indicator if applicable
          if (data.dev_mode) {
            setTestError("✓ Dev mode active");
          }
        } else {
          setTestState("fail");
          setTestError(data?.error || `HTTP ${res.status}`);
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (e) {
      if (isCurrentRequest()) {
        setTestState("fail");
        setTestError(e instanceof Error ? e.message : String(e));
      }
    }
  }

  async function handleSave() {
    if (isAndroidChromeNativeInputSuppressed) return;
    if (!urlSchemeValid) return;

    const t = token.trim();
    const urlChanged = haveServerUrlsChanged(initialUrl, normalized);
    const tokenMustBeCleared = shouldClearAuthTokenForUrlChange(
      initialUrl,
      normalized,
      initialToken,
      t,
    );

    if (isEditMode) {
      const previousProfiles = getProfiles();
      const previousActiveProfileId = getActiveProfileId();
      const previousProfileToken = profile?.id
        ? getAuthToken(profile.id)
        : null;
      const shouldRevokePreviousProfileSession = Boolean(
        profile &&
        previousProfileToken &&
        (urlChanged || previousProfileToken !== t),
      );
      const restoreProfileState = (profileId: string): boolean => {
        const profilesRestored = saveProfiles(previousProfiles);
        const activeProfileRestored = previousActiveProfileId
          ? setActiveProfile(previousActiveProfileId)
          : clearActiveProfile();
        const tokenRestored = previousProfileToken
          ? setAuthToken(previousProfileToken, profileId)
          : clearAuthToken(profileId);
        return profilesRestored && activeProfileRestored && tokenRestored;
      };
      // Profile mode: create or update profile
      const profileData = {
        name: name.trim() || "Unnamed Server",
        url: normalized,
        authType,
        username:
          authType === "basic" ? username.trim() || undefined : undefined,
      };

      let tokenClearedForUrlChange = false;
      const clearPreviousProfileToken = async () => {
        if (shouldRevokePreviousProfileSession) {
          // Persist profile changes first: local persistence failure must not
          // revoke a still-active remote media session.
          await revokeCurrentMediaSession(profile!.url, previousProfileToken!);
        }
        if (!clearAuthToken(profile!.id)) {
          restoreProfileState(profile!.id);
          setTestState("fail");
          setTestError(
            "Unable to clear the old login token; server URL was not changed",
          );
          return false;
        }
        tokenClearedForUrlChange = true;
        return true;
      };

      let savedProfile: ServerProfile;
      if (profile) {
        // Update existing profile
        if (!updateProfile(profile.id, profileData)) {
          const restored = restoreProfileState(profile.id);
          setTestState("fail");
          setTestError(
            restored
              ? "Unable to persist the server profile in this browser"
              : "Unable to persist the server profile and restore the old login",
          );
          return;
        }
        savedProfile = { ...profile, ...profileData };
      } else {
        // Create new profile
        savedProfile = createProfile(profileData);
        const persistedProfile = getProfiles().find(
          (candidate) => candidate.id === savedProfile.id,
        );
        if (
          !persistedProfile ||
          normalizeServerUrl(persistedProfile.url) !== normalized
        ) {
          setTestState("fail");
          setTestError("Unable to persist the server profile in this browser");
          return;
        }
        if (!setActiveProfile(savedProfile.id)) {
          const restored = restoreProfileState(savedProfile.id);
          setTestState("fail");
          setTestError(
            restored
              ? "Unable to activate the new server profile"
              : "Unable to activate the new profile and restore the previous state",
          );
          return;
        }
      }

      // Never carry a token across a backend URL change. A newly tested token
      // for the replacement URL may be stored instead.
      if (profile && urlChanged && !(await clearPreviousProfileToken())) {
        return;
      }
      if (!tokenClearedForUrlChange && (tokenMustBeCleared || !t)) {
        if (shouldRevokePreviousProfileSession) {
          await revokeCurrentMediaSession(profile!.url, previousProfileToken!);
        }
        if (!clearAuthToken(savedProfile.id)) {
          const restored = restoreProfileState(savedProfile.id);
          setTestState("fail");
          setTestError(
            restored
              ? "Unable to clear the login token in this browser"
              : "Unable to clear the login token and restore the previous state",
          );
          return;
        }
      }
      if (t && !tokenMustBeCleared && shouldRevokePreviousProfileSession) {
        await revokeCurrentMediaSession(profile!.url, previousProfileToken!);
      }
      if (t && !tokenMustBeCleared && !setAuthToken(t, savedProfile.id)) {
        const restored = restoreProfileState(savedProfile.id);
        setTestState("fail");
        setTestError(
          restored
            ? "Unable to persist the login token in this browser"
            : "Unable to persist the login token and restore the previous state",
        );
        return;
      }

      setSaved(true);

      // Notify parent and close
      onSaved?.(savedProfile);

      // Reload only when the live connection changed. Editing an inactive
      // profile must not interrupt the active server session.
      if (savedProfile.id === getActiveProfileId()) {
        setTimeout(() => window.location.reload(), 800);
      }
    } else {
      // Legacy mode: direct URL/token storage
      const isSameOrigin =
        !normalized || normalized === `${location.protocol}//${location.host}`;

      const activeProfileId = getActiveProfileId() ?? undefined;
      const previousLegacyToken = getAuthToken(activeProfileId);
      const shouldRevokePreviousLegacySession = Boolean(
        previousLegacyToken && (urlChanged || previousLegacyToken !== t),
      );
      const previousUrlWasExplicit = hasServerUrl();
      const restoreLegacyState = (): boolean => {
        const urlRestored = previousUrlWasExplicit
          ? setServerUrl(initialUrl)
          : clearServerUrl();
        const tokenRestored = previousLegacyToken
          ? setAuthToken(previousLegacyToken, activeProfileId)
          : clearAuthToken(activeProfileId);
        return urlRestored && tokenRestored;
      };
      let tokenClearedForUrlChange = false;
      const clearPreviousLegacyToken = async () => {
        if (shouldRevokePreviousLegacySession) {
          // Persist the replacement URL first so failed local storage does not
          // revoke a session whose credentials are restored locally.
          await revokeCurrentMediaSession(
            initialUrl || getServerUrl(),
            previousLegacyToken!,
          );
        }
        if (!clearAuthToken(activeProfileId)) {
          restoreLegacyState();
          setTestState("fail");
          setTestError(
            "Unable to clear the old login token; server URL was not changed",
          );
          return false;
        }
        tokenClearedForUrlChange = true;
        return true;
      };
      const urlPersisted = isSameOrigin
        ? clearServerUrl()
        : setServerUrl(normalized);
      if (!urlPersisted) {
        const restored = restoreLegacyState();
        setTestState("fail");
        setTestError(
          restored
            ? "Unable to persist the server URL in this browser"
            : "Unable to persist the server URL and restore the old login",
        );
        return;
      }
      if (urlChanged && !(await clearPreviousLegacyToken())) {
        return;
      }
      if (
        !tokenClearedForUrlChange &&
        (tokenMustBeCleared || !t) &&
        !clearAuthToken(activeProfileId)
      ) {
        const restored = restoreLegacyState();
        setTestState("fail");
        setTestError(
          restored
            ? "Unable to clear the login token in this browser"
            : "Unable to clear the login token and restore the previous state",
        );
        return;
      }
      if (t && !tokenMustBeCleared && shouldRevokePreviousLegacySession) {
        await revokeCurrentMediaSession(
          initialUrl || getServerUrl(),
          previousLegacyToken!,
        );
      }
      if (t && !tokenMustBeCleared && !setAuthToken(t, activeProfileId)) {
        const restored = restoreLegacyState();
        setTestState("fail");
        setTestError(
          restored
            ? "Unable to persist the login token in this browser"
            : "Unable to persist the login token and restore the previous state",
        );
        return;
      }

      if (username) {
        setAuthUsername(username.trim());
      } else {
        clearAuthUsername();
      }

      setSaved(true);
      setTimeout(() => window.location.reload(), 800);
    }
  }

  function handleReset() {
    const defaultUrl = `${location.protocol}//${location.host}`;
    invalidateConnectionTest();
    latestUrlRef.current = normalizeServerUrl(defaultUrl);
    setUrl(defaultUrl);
    setToken("");
    setUsername("");
    setPassword("");
  }

  async function handleLogout() {
    const storedProfile = profile?.id
      ? getProfiles().find((candidate) => candidate.id === profile.id)
      : getActiveProfile();
    const targetProfileId =
      storedProfile?.id ??
      profile?.id ??
      (profile === undefined ? (getActiveProfileId() ?? undefined) : undefined);
    // The dialog may outlive a concurrently deleted profile. Its immutable
    // prop still identifies the origin whose session must be revoked before
    // removing the remaining profile-scoped token.
    const targetServerUrl =
      storedProfile?.url ?? profile?.url ?? getServerUrl();
    const targetToken = getAuthToken(targetProfileId);
    if (targetToken) {
      // Local logout must complete even when the old server is unreachable; its
      // bounded media-session TTL remains the cleanup fallback.
      await revokeCurrentMediaSession(targetServerUrl, targetToken);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      await fetch(`${targetServerUrl}/api/auth/logout`, {
        method: "POST",
        headers: secureBearerHeaders(targetServerUrl, targetToken),
        credentials: "include",
        signal: controller.signal,
      });
    } catch {
      // ignore network errors on logout
    } finally {
      clearTimeout(timeout);
    }
    if (targetToken && getAuthToken(targetProfileId) === targetToken) {
      if (!clearAuthToken(targetProfileId)) {
        setTestState("fail");
        setTestError("Unable to clear the login token in this browser");
        return;
      }
    }
    clearAuthUsername();
    setToken("");
    setUsername("");
    setPassword("");
    setTestState("idle");
    setSaved(false);
    // Only the active profile needs a full app reload.
    if (profile === undefined || profile?.id === getActiveProfileId()) {
      window.location.reload();
    } else {
      onClose();
    }
  }

  const targetProfileId =
    profile?.id ??
    (profile === undefined ? (getActiveProfileId() ?? undefined) : undefined);
  const hasToken = profile !== null && Boolean(getAuthToken(targetProfileId));

  return (
    <div
      className="safe-area-inline safe-area-bottom fixed inset-0 z-50 flex items-center justify-center p-3"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => {
        if (closable && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="dialog-viewport-fit flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] shadow-2xl"
        style={{ background: "var(--color-surface)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-[var(--color-primary)]" />
            <span className="text-sm font-semibold text-[var(--color-text)] tracking-wide">
              Server Connection
            </span>
          </div>
          {closable && (
            <button
              onClick={onClose}
              className="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          {isEditMode && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--color-text)]">
                Profile Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Server"
                disabled={isAndroidChromeNativeInputSuppressed}
                className="w-full rounded-lg border px-3.5 py-2 text-sm transition-colors focus:outline-none focus:ring-2"
                style={{
                  background: "var(--color-background)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text)",
                  caretColor: "var(--color-primary)",
                }}
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--color-text)]">
              Server URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => {
                testRequestIdRef.current += 1;
                latestUrlRef.current = normalizeServerUrl(e.target.value);
                setUrl(e.target.value);
                setTestState("idle");
              }}
              placeholder="http://localhost:4800"
              disabled={isAndroidChromeNativeInputSuppressed}
              className="w-full rounded-lg border px-3.5 py-2 text-sm font-mono transition-colors focus:outline-none focus:ring-2"
              style={{
                background: "var(--color-background)",
                borderColor: !urlSchemeValid
                  ? "var(--color-error, #ef4444)"
                  : "var(--color-border)",
                color: "var(--color-text)",
                caretColor: "var(--color-primary)",
              }}
            />
            {!urlSchemeValid && (
              <p className="mt-1.5 text-xs text-red-400">
                URL must start with http:// or https://
              </p>
            )}
            {urlSchemeValid && crossOrigin && (
              <p className="mt-1.5 text-xs text-yellow-400/80">
                Cross-origin server — Bearer token required.
              </p>
            )}
          </div>

          {isEditMode && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--color-text)]">
                Authentication Type
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-[var(--color-text)] cursor-pointer">
                  <input
                    type="radio"
                    name="authType"
                    value="basic"
                    checked={authType === "basic"}
                    onChange={() => {
                      invalidateConnectionTest();
                      setAuthType("basic");
                    }}
                    className="cursor-pointer"
                  />
                  Basic Auth
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--color-text)] cursor-pointer">
                  <input
                    type="radio"
                    name="authType"
                    value="none"
                    checked={authType === "none"}
                    onChange={() => {
                      invalidateConnectionTest();
                      setAuthType("none");
                    }}
                    className="cursor-pointer"
                  />
                  No Auth (Dev Mode)
                </label>
              </div>
            </div>
          )}

          {authType === "basic" && (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--color-text)]">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => {
                    invalidateConnectionTest();
                    setUsername(e.target.value);
                  }}
                  placeholder="Username"
                  disabled={isAndroidChromeNativeInputSuppressed}
                  className="w-full rounded-lg border px-3.5 py-2 text-sm font-mono transition-colors focus:outline-none focus:ring-2"
                  style={{
                    background: "var(--color-background)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text)",
                    caretColor: "var(--color-primary)",
                  }}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--color-text)]">
                  Password {crossOrigin ? "(required)" : ""}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    invalidateConnectionTest();
                    setPassword(e.target.value);
                  }}
                  placeholder="Password"
                  disabled={isAndroidChromeNativeInputSuppressed}
                  className="w-full rounded-lg border px-3.5 py-2 text-sm font-mono transition-colors focus:outline-none focus:ring-2 mb-2"
                  style={{
                    background: "var(--color-background)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text)",
                    caretColor: "var(--color-primary)",
                  }}
                />
              </div>
            </>
          )}

          {/* Test connection */}
          <div className="flex items-center gap-3">
            <button
              onClick={testConnection}
              disabled={
                isAndroidChromeNativeInputSuppressed ||
                !normalized ||
                !urlSchemeValid ||
                testState === "testing"
              }
              title={
                isAndroidChromeNativeInputSuppressed
                  ? "Unavailable on Android Chrome: text entry is disabled"
                  : undefined
              }
              className="rounded-lg px-3.5 py-2 text-xs font-semibold transition-opacity disabled:opacity-40"
              style={{
                background: "var(--color-surface-2)",
                color: "var(--color-text)",
              }}
            >
              {testState === "testing" ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" /> Testing…
                </span>
              ) : (
                "Test connection"
              )}
            </button>

            {testState === "ok" && (
              <span className="flex items-center gap-1 text-xs text-[var(--color-success)]">
                <CheckCircle2 size={13} /> Reachable
              </span>
            )}
            {testState === "fail" && (
              <span className="flex items-center gap-1 text-xs text-red-400">
                <XCircle size={13} /> {testError ?? "Unreachable"}
              </span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--color-border)] px-5 py-4">
          <div className="flex gap-4 items-center">
            <button
              onClick={handleReset}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              Reset to default
            </button>
            {hasToken && (
              <button
                onClick={handleLogout}
                className="text-xs font-semibold text-red-500 hover:text-red-400 transition-colors"
              >
                Logout
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {closable && (
              <button
                onClick={onClose}
                className="rounded-lg px-3.5 py-2 text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={
                isAndroidChromeNativeInputSuppressed ||
                saved ||
                !urlSchemeValid ||
                testState !== "ok" ||
                (authType === "basic" && (!username || !password))
              }
              title={
                isAndroidChromeNativeInputSuppressed
                  ? "Unavailable on Android Chrome: text entry is disabled"
                  : undefined
              }
              className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-60"
              style={{
                background: saved
                  ? "var(--color-success)"
                  : "var(--color-primary)",
              }}
            >
              {saved
                ? "Saved!"
                : isEditMode
                  ? "Save profile"
                  : "Save & reconnect"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
