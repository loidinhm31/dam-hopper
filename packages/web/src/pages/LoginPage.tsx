import { useState } from "react";
import { getServerUrl, setAuthToken, isCrossOriginServer } from "@/api/server-config.js";

interface LoginPageProps {
  onLogin: () => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    const serverUrl = getServerUrl();
    const crossOrigin = isCrossOriginServer(serverUrl);

    try {
      if (crossOrigin) {
        // Cross-origin: verify token via Bearer header, store in sessionStorage
        const res = await fetch(`${serverUrl}/api/auth/status`, {
          headers: { Authorization: `Bearer ${trimmed}` },
        });
        if (res.ok) {
          setAuthToken(trimmed);
          onLogin();
        } else {
          setError("Invalid token. Check the server console for your token.");
        }
      } else {
        // Same-origin: login sets httpOnly cookie
        const res = await fetch(`${serverUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token: trimmed }),
        });
        if (res.ok) {
          onLogin();
        } else {
          const body = await res.json() as { error?: string };
          setError(body.error ?? "Invalid token. Check the server console for your token.");
        }
      }
    } catch {
      setError("Failed to connect to the server. Check your network connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)]">
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-2xl"
        style={{ backdropFilter: "blur(12px)" }}
      >
        {/* Logo / title */}
        <div className="mb-8 text-center">
          <div
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ background: "var(--color-primary)" }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--color-text)" }}>
            Dev Hub
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Enter your server token to continue
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="token"
              className="mb-1.5 block text-sm font-medium"
              style={{ color: "var(--color-text)" }}
            >
              Server Token
            </label>
            <input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your 64-character token…"
              autoFocus
              className="w-full rounded-lg border px-3.5 py-2.5 text-sm font-mono transition-colors focus:outline-none focus:ring-2"
              style={{
                background: "var(--color-background)",
                borderColor: error ? "var(--color-error, #ef4444)" : "var(--color-border)",
                color: "var(--color-text)",
                caretColor: "var(--color-primary)",
              }}
              disabled={loading}
            />
          </div>

          {error && (
            <p className="rounded-lg px-3 py-2 text-sm" style={{ color: "var(--color-error, #ef4444)", background: "rgba(239,68,68,0.08)" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !token.trim()}
            className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
            style={{ background: "var(--color-primary)" }}
          >
            {loading ? "Authenticating…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs" style={{ color: "var(--color-text-muted)" }}>
          The token is displayed in the server console on startup.
          <br />
          It is stored at{" "}
          <code className="rounded px-1 py-0.5 font-mono" style={{ background: "var(--color-surface-hover, rgba(255,255,255,0.05))" }}>
            ~/.config/dev-hub/server-token
          </code>
        </p>
      </div>
    </div>
  );
}
