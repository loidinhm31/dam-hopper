import { useState, useEffect } from "react";
import { X, Server, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import {
  getServerUrl,
  setServerUrl,
  clearServerUrl,
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  isCrossOriginServer,
} from "@/api/server-config.js";

interface Props {
  open: boolean;
  onClose: () => void;
}

type TestState = "idle" | "testing" | "ok" | "fail";

export function ServerSettingsDialog({ open, onClose }: Props) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [testState, setTestState] = useState<TestState>("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      setUrl(getServerUrl());
      setToken(getAuthToken() ?? "");
      setTestState("idle");
      setTestError(null);
      setSaved(false);
    }
  }, [open]);

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
      const headers: Record<string, string> = {};
      const t = token.trim();
      if (t) headers["Authorization"] = `Bearer ${t}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(`${normalized}/api/health`, { headers, signal: controller.signal });
        setTestState(res.ok ? "ok" : "fail");
        if (!res.ok) setTestError(`HTTP ${res.status}`);
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
    const isSameOrigin = !normalized || normalized === `${location.protocol}//${location.host}`;

    if (isSameOrigin) {
      clearServerUrl();
    } else {
      setServerUrl(normalized); // setServerUrl also normalizes protocol
    }

    if (t) {
      setAuthToken(t);
    } else {
      clearAuthToken();
    }

    setSaved(true);
    // Reload for clean reconnect: ensures transport listeners, WS status, and React
    // query state all start fresh against the new server. Transport swap without reload
    // leaves stale listener closures in useIpc() effects.
    setTimeout(() => window.location.reload(), 800);
  }

  function handleReset() {
    setUrl(`${location.protocol}//${location.host}`);
    setToken("");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
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
          <button
            onClick={onClose}
            className="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
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

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--color-text)]">
              Auth Token {crossOrigin ? "(required)" : "(optional — leave empty for cookie auth)"}
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={crossOrigin ? "Paste your server token…" : "Leave empty for same-origin cookie auth"}
              className="w-full rounded-lg border px-3.5 py-2 text-sm font-mono transition-colors focus:outline-none focus:ring-2"
              style={{
                background: "var(--color-background)",
                borderColor: "var(--color-border)",
                color: "var(--color-text)",
                caretColor: "var(--color-primary)",
              }}
            />
          </div>

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
          <button
            onClick={handleReset}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Reset to default
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-3.5 py-2 text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saved || !urlSchemeValid}
              className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-60"
              style={{ background: saved ? "var(--color-success)" : "var(--color-primary)" }}
            >
              {saved ? "Saved!" : "Save & reconnect"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
