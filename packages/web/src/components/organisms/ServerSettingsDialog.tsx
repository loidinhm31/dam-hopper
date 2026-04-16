import { useState, useEffect } from "react";
import { X, Server, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import type { ServerProfile } from "@/api/server-config.js";
import {
  getServerUrl,
  setServerUrl,
  clearServerUrl,
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  isCrossOriginServer,
  getAuthUsername,
  setAuthUsername,
  clearAuthUsername,
  buildAuthHeaders,
  createProfile,
  updateProfile,
  getActiveProfile,
  setActiveProfile,
} from "@/api/server-config.js";

interface Props {
  open: boolean;
  onClose: () => void;
  closable?: boolean;
  profile?: ServerProfile | null;  // null = new profile, undefined = legacy mode
  onSaved?: (profile: ServerProfile) => void;
}

type TestState = "idle" | "testing" | "ok" | "fail";

export function ServerSettingsDialog({ open, onClose, closable = true, profile, onSaved }: Props) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<"basic" | "none">("basic");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [testState, setTestState] = useState<TestState>("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isEditMode = profile !== undefined;

  useEffect(() => {
    if (open) {
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
      setToken(getAuthToken() ?? "");
      setTestState("idle");
      setTestError(null);
      setSaved(false);
    }
  }, [open, profile, isEditMode]);

  if (!open) return null;

  const rawUrl = url.trim();
  // Auto-prepend protocol for display normalization (matches setServerUrl behavior)
  const normalized = rawUrl && !/^https?:\/\//i.test(rawUrl)
    ? `http://${rawUrl}`.replace(/\/$/, "")
    : rawUrl.replace(/\/$/, "");

  /** Reject non-http(s) schemes to prevent javascript:, data:, etc. */
  const urlSchemeValid = !normalized || /^https?:\/\/.+/i.test(normalized);
  const crossOrigin = urlSchemeValid && normalized ? isCrossOriginServer(normalized) : false;

  async function testConnection() {
    if (!normalized || !urlSchemeValid) return;
    setTestState("testing");
    setTestError(null);
    try {
      // Different body based on auth type
      const u = username.trim();
      const p = password.trim();
      const bodyContent = authType === "none" ? {} : { username: u, password: p };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(`${normalized}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyContent),
          signal: controller.signal
        });
        const data = await res.json().catch(() => null);

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
      setTestState("fail");
      setTestError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleSave() {
    if (!urlSchemeValid) return;

    const t = token.trim();
    
    if (isEditMode) {
      // Profile mode: create or update profile
      const profileData = {
        name: name.trim() || "Unnamed Server",
        url: normalized,
        authType,
        username: authType === "basic" ? username.trim() || undefined : undefined,
      };
      
      let savedProfile: ServerProfile;
      if (profile) {
        // Update existing profile
        updateProfile(profile.id, profileData);
        savedProfile = { ...profile, ...profileData };
      } else {
        // Create new profile
        savedProfile = createProfile(profileData);
        setActiveProfile(savedProfile.id);
      }
      
      // Store token for this profile
      if (t) {
        setAuthToken(t);
      }
      
      setSaved(true);
      
      // Notify parent and close
      onSaved?.(savedProfile);
      
      // Reload for clean reconnect
      setTimeout(() => window.location.reload(), 800);
    } else {
      // Legacy mode: direct URL/token storage
      const isSameOrigin = !normalized || normalized === `${location.protocol}//${location.host}`;

      if (isSameOrigin) {
        clearServerUrl();
      } else {
        setServerUrl(normalized);
      }

      if (t) {
        setAuthToken(t);
      } else {
        clearAuthToken();
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
    setUrl(`${location.protocol}//${location.host}`);
    setToken("");
    setUsername("");
    setPassword("");
  }

  async function handleLogout() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      await fetch(`${getServerUrl()}/api/auth/logout`, {
        method: "POST",
        headers: buildAuthHeaders(),
        signal: controller.signal
      });
    } catch {
      // ignore network errors on logout
    } finally {
      clearTimeout(timeout);
    }
    clearAuthToken();
    clearAuthUsername();
    setToken("");
    setUsername("");
    setPassword("");
    setTestState("idle");
    setSaved(false);
    // Reload page to force AuthGuard to lock the app
    window.location.reload();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (closable && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--color-border)] shadow-2xl"
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
              onChange={(e) => { setUrl(e.target.value); setTestState("idle"); }}
              placeholder="http://localhost:4800"
              className="w-full rounded-lg border px-3.5 py-2 text-sm font-mono transition-colors focus:outline-none focus:ring-2"
              style={{
                background: "var(--color-background)",
                borderColor: !urlSchemeValid ? "var(--color-error, #ef4444)" : "var(--color-border)",
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
                    onChange={() => setAuthType("basic")}
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
                    onChange={() => setAuthType("none")}
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
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
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
                     setPassword(e.target.value);
                  }}
                  placeholder="Password"
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
              disabled={!normalized || !urlSchemeValid || testState === "testing"}
              className="rounded-lg px-3.5 py-2 text-xs font-semibold transition-opacity disabled:opacity-40"
              style={{ background: "var(--color-surface-2)", color: "var(--color-text)" }}
            >
              {testState === "testing" ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" /> Testing…
                </span>
              ) : "Test connection"}
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
            {getAuthToken() && (
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
                saved || 
                !urlSchemeValid || 
                testState !== "ok" ||
                (authType === "basic" && (!username || !password))
              }
              className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-60"
              style={{ background: saved ? "var(--color-success)" : "var(--color-primary)" }}
            >
              {saved ? "Saved!" : (isEditMode ? "Save profile" : "Save & reconnect")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
