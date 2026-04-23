import { useState, useRef, useEffect } from "react";
import {
  Plus,
  Copy,
  Check,
  QrCode,
  X,
  RefreshCw,
  Download,
  AlertCircle,
  Loader2,
} from "lucide-react";
import QRCode from "react-qr-code";
import { cn } from "@/lib/utils.js";
import { useTunnels, type InstallState } from "@/hooks/useTunnels.js";
import { useCopyToClipboard } from "@/hooks/useClipboard.js";
import type { TunnelInfo } from "@/api/client.js";

// ── Warning banner ────────────────────────────────────────────────────────────

const WARNED_KEY = "tunnel_warning_acknowledged";

function WarningBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 text-xs p-2 rounded mx-2 mb-1"
    >
      Public URL — anyone with the link can reach your port. Stop when done.
      <button
        onClick={onDismiss}
        className="ml-2 underline hover:no-underline transition-all"
      >
        Got it
      </button>
    </div>
  );
}

// ── Tunnel row ────────────────────────────────────────────────────────────────

function TunnelRow({
  tunnel,
  onStop,
  onRetry,
}: {
  tunnel: TunnelInfo;
  onStop: (id: string) => void;
  onRetry: (port: number, label: string) => void;
}) {
  const [showQr, setShowQr] = useState(false);
  const { copied, copy } = useCopyToClipboard();
  const qrRef = useRef<HTMLDivElement>(null);

  // Close QR popover on outside click
  useEffect(() => {
    if (!showQr) return;
    function handler(e: MouseEvent) {
      if (qrRef.current && !qrRef.current.contains(e.target as Node)) {
        setShowQr(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showQr]);

  const dotColor =
    tunnel.status === "ready"
      ? "bg-green-500"
      : tunnel.status === "failed"
        ? "bg-red-500"
        : tunnel.status === "starting"
          ? "bg-amber-400 animate-pulse"
          : "bg-[var(--color-text-muted)]/30";

  return (
    <li className="group flex items-start gap-1.5 pl-2 pr-2 py-1 text-xs hover:bg-[var(--color-surface-2)] transition-colors">
      <span className={cn("h-2 w-2 rounded-full shrink-0 mt-1", dotColor)} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <span className="font-mono text-[var(--color-text-muted)] shrink-0">
            :{tunnel.port}
          </span>
          <span className="truncate text-[var(--color-text)]">{tunnel.label}</span>
          {tunnel.status === "ready" && (
            <span className="shrink-0 text-[10px] bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded font-semibold">
              PUBLIC
            </span>
          )}
        </div>

        {tunnel.status === "starting" && (
          <span className="text-[var(--color-text-muted)] italic">Starting…</span>
        )}
        {tunnel.status === "ready" && tunnel.url && (
          <a
            href={tunnel.url}
            target="_blank"
            rel="noopener noreferrer"
            title={tunnel.url}
            className="block truncate max-w-[180px] text-[var(--color-primary)] hover:underline"
          >
            {tunnel.url.replace(/^https?:\/\//, "")}
          </a>
        )}
        {tunnel.status === "failed" && (
          <span className="text-red-500 truncate" title={tunnel.error}>
            {tunnel.error ?? "Failed"}
          </span>
        )}
      </div>

      {/* Actions — visible on group-hover */}
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {tunnel.status === "ready" && tunnel.url && (
          <>
            <button
              onClick={() => void copy(tunnel.url!)}
              title="Copy URL"
              aria-label="Copy URL"
              className="rounded p-0.5 hover:bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              {copied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
            </button>

            <div className="relative" ref={qrRef}>
              <button
                onClick={() => setShowQr((v) => !v)}
                title="Show QR code"
                aria-label="Show QR code"
                className="rounded p-0.5 hover:bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
              >
                <QrCode size={11} />
              </button>
              {showQr && (
                <div className="absolute z-50 right-0 top-6 bg-white border border-[var(--color-border)] rounded p-2 shadow-lg">
                  <QRCode
                    value={tunnel.url}
                    size={160}
                    bgColor="#ffffff"
                    fgColor="#000000"
                  />
                  <button
                    onClick={() => setShowQr(false)}
                    title="Close QR"
                    aria-label="Close QR code"
                    className="absolute top-1 right-1 rounded p-0.5 hover:bg-gray-100 text-gray-500"
                  >
                    <X size={10} />
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {tunnel.status === "failed" && (
          <button
            onClick={() => onRetry(tunnel.port, tunnel.label)}
            title="Retry"
            aria-label="Retry tunnel"
            className="rounded p-0.5 hover:bg-amber-500/20 text-amber-500 transition-colors"
          >
            <RefreshCw size={11} />
          </button>
        )}

        <button
          onClick={() => onStop(tunnel.id)}
          title="Stop tunnel"
          aria-label="Stop tunnel"
          className="rounded p-0.5 hover:bg-red-500/20 hover:text-red-500 text-[var(--color-text-muted)] transition-colors"
        >
          <X size={11} />
        </button>
      </div>
    </li>
  );
}

// ── New tunnel dialog ─────────────────────────────────────────────────────────

function NewTunnelDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (port: number, label: string) => Promise<void>;
  onClose: () => void;
}) {
  const [port, setPort] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError("Port must be 1–65535");
      return;
    }
    if (!label.trim()) {
      setError("Label is required");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(portNum, label.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tunnel");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-2 mb-2 p-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-xs">
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-1.5">
        <input
          type="number"
          placeholder="Port (e.g. 3000)"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          min={1}
          max={65535}
          className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)]"
          autoFocus
        />
        <input
          type="text"
          placeholder="Label"
          value={label}
          maxLength={64}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)]"
        />
        {error && <p className="text-red-500 text-[11px]">{error}</p>}
        <div className="flex gap-1 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-2 py-0.5 rounded bg-[var(--color-primary)]/20 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/30 transition-colors disabled:opacity-50"
          >
            {submitting ? "…" : "Expose"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Installer row ─────────────────────────────────────────────────────────────

function InstallerRow({
  installState,
  onInstall,
  onDismiss,
}: {
  installState: InstallState;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  const { status, downloaded, total, error } = installState;
  const pct = total > 0 ? Math.round((downloaded / total) * 100) : null;

  return (
    <div className="mx-2 mb-2 p-2 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-xs flex items-start gap-2">
      {status === "installing" ? (
        <Loader2 size={12} className="shrink-0 mt-0.5 text-[var(--color-text-muted)] animate-spin" />
      ) : status === "done" ? (
        <Check size={12} className="shrink-0 mt-0.5 text-green-500" />
      ) : (
        <Download size={12} className="shrink-0 mt-0.5 text-[var(--color-text-muted)]" />
      )}
      <div className="flex-1 min-w-0">
        {status === "idle" || status === "error" ? (
          <>
            <p className="text-[var(--color-text)] font-medium mb-0.5">
              cloudflared not found on server
            </p>
            <p className="text-[var(--color-text-muted)] leading-relaxed mb-1.5">
              Linux / arm64 server:{" "}
              <button
                onClick={onInstall}
                className="underline hover:no-underline cursor-pointer"
              >
                auto-install
              </button>
              <br />
              macOS server:{" "}
              <code className="font-mono bg-[var(--color-surface)] px-1 rounded">
                brew install cloudflared
              </code>
              <br />
              Other:{" "}
              <a
                href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:no-underline"
              >
                downloads page
              </a>
            </p>
            {error && (
              <p className="text-red-500 leading-relaxed">{error}</p>
            )}
            <button
              onClick={onInstall}
              className="mt-0.5 px-2 py-0.5 bg-[var(--color-accent)] text-white rounded hover:opacity-80 transition-opacity font-medium"
            >
              Auto-install on server
            </button>
          </>
        ) : status === "installing" ? (
          <>
            <p className="text-[var(--color-text)] font-medium mb-1">
              Installing cloudflared on server…
            </p>
            <div className="w-full bg-[var(--color-surface)] rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-[var(--color-accent)] transition-all duration-300"
                style={{ width: pct !== null ? `${pct}%` : "40%" }}
              />
            </div>
            {pct !== null && (
              <p className="text-[var(--color-text-muted)] mt-0.5">{pct}%</p>
            )}
          </>
        ) : (
          <p className="text-green-500 font-medium">
            cloudflared installed — try creating a tunnel now
          </p>
        )}
      </div>
      <button
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss installer prompt"
        className="shrink-0 rounded p-0.5 hover:bg-[var(--color-surface)] text-[var(--color-text-muted)]"
      >
        <X size={10} />
      </button>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function TunnelPanel() {
  const { tunnels, isLoading, error, createTunnel, stopTunnel, installCloudflared, installState } = useTunnels();
  const [showDialog, setShowDialog] = useState(false);
  const [binaryMissing, setBinaryMissing] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [warned, setWarned] = useState(() => !!localStorage.getItem(WARNED_KEY));

  // Auto-dismiss installer row 1.5s after successful install
  useEffect(() => {
    if (installState.status === "done") {
      const t = setTimeout(() => setBinaryMissing(false), 1500);
      return () => clearTimeout(t);
    }
  }, [installState.status]);

  function dismiss() {
    localStorage.setItem(WARNED_KEY, "1");
    setWarned(true);
  }

  async function handleCreate(port: number, label: string) {
    setBinaryMissing(false);
    try {
      await createTunnel(port, label);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.toLowerCase().includes("binary not found")) {
        setBinaryMissing(true);
      }
      throw err;
    }
  }

  async function handleRetry(port: number, label: string) {
    setRetryError(null);
    try {
      await handleCreate(port, label);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Retry failed");
    }
  }

  return (
    <section className="border-t border-[var(--color-border)] pt-1">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1">
        <p className="text-[10px] text-[var(--color-text-muted)] font-semibold tracking-widest uppercase opacity-60">
          └─ tunnels
        </p>
        <button
          onClick={() => setShowDialog((v) => !v)}
          title="New tunnel"
          aria-label="New tunnel"
          className="p-0.5 rounded hover:bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Warning banner — shown once */}
      {!warned && <WarningBanner onDismiss={dismiss} />}

      {/* Binary missing hint */}
      {binaryMissing && (
        <InstallerRow
          installState={installState}
          onInstall={() => void installCloudflared()}
          onDismiss={() => setBinaryMissing(false)}
        />
      )}

      {/* Retry error */}
      {retryError && (
        <div className="mx-2 mb-1 flex items-center gap-1 text-[11px] text-red-500">
          <AlertCircle size={11} />
          <span className="truncate">{retryError}</span>
        </div>
      )}

      {/* New tunnel dialog */}
      {showDialog && (
        <NewTunnelDialog
          onSubmit={handleCreate}
          onClose={() => setShowDialog(false)}
        />
      )}

      {/* Tunnel list */}
      {isLoading ? (
        <div className="px-3 py-1 text-[10px] text-[var(--color-text-muted)] opacity-60">
          Loading…
        </div>
      ) : error ? (
        <div className="px-3 py-1 text-[10px] text-red-500 opacity-80">
          Failed to load tunnels
        </div>
      ) : (
        <ul className="flex flex-col">
          {tunnels.map((t) => (
            <TunnelRow
              key={t.id}
              tunnel={t}
              onStop={(id) => void stopTunnel(id)}
              onRetry={(port, label) => void handleRetry(port, label)}
            />
          ))}
          {tunnels.length === 0 && !showDialog && (
            <li className="px-3 py-1 text-[10px] text-[var(--color-text-muted)] opacity-50 italic">
              No active tunnels
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
