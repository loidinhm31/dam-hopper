import { useState, useRef, useEffect } from "react";
import {
  Copy,
  Check,
  QrCode,
  X,
  Cloud,
  Loader2,
  Download,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import QRCode from "react-qr-code";
import { cn } from "@/lib/utils.js";
import { usePorts, type PortEntry, type InstallState } from "@/hooks/usePorts.js";
import { useCopyToClipboard } from "@/hooks/useClipboard.js";
import { isLocalServer } from "@/api/server-config.js";

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

// ── Port row ──────────────────────────────────────────────────────────────────

const DANGER_PORTS = new Set([22, 25, 53, 110, 143, 3306, 5432, 6379, 27017]);

function PortRow({
  entry,
  isLocal,
  onStartTunnel,
  onStopTunnel,
}: {
  entry: PortEntry;
  isLocal: boolean;
  onStartTunnel: (port: number, label: string) => Promise<void>;
  onStopTunnel: (id: string) => Promise<void>;
}) {
  const [showQr, setShowQr] = useState(false);
  const { copied, copy } = useCopyToClipboard();
  const qrRef = useRef<HTMLDivElement>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const tunnelStatus = entry.tunnel?.status ?? null;
  const isStarting = tunnelStatus === "starting";
  const isReady = tunnelStatus === "ready";
  const isFailed = tunnelStatus === "failed";

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

  const dotColor = isReady
    ? "bg-green-500"
    : isFailed
      ? "bg-red-500"
      : isStarting
        ? "bg-amber-400 animate-pulse"
        : entry.state === "listening"
          ? "bg-[var(--color-primary)]"
          : "bg-[var(--color-text-muted)]/40";

  async function handleStartTunnel() {
    setLaunchError(null);
    try {
      await onStartTunnel(entry.port, entry.project ?? `port-${entry.port}`);
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Failed to start tunnel");
    }
  }

  return (
    <li className="group flex flex-col pl-2 pr-2 py-1 text-xs hover:bg-[var(--color-surface-2)] transition-colors">
      {/* Port info row */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={cn("h-2 w-2 rounded-full shrink-0", dotColor)} />
        <span className="font-mono text-[var(--color-text-muted)] shrink-0">:{entry.port}</span>
        {entry.project && (
          <span className="truncate text-[var(--color-text)]">{entry.project}</span>
        )}
        {entry.state === "provisional" && (
          <span className="text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1 rounded shrink-0">
            provisional
          </span>
        )}
        {entry.state === "lost" && (
          <span className="text-[10px] bg-[var(--color-text-muted)]/15 text-[var(--color-text-muted)] px-1 rounded shrink-0">
            lost
          </span>
        )}
        {isReady && (
          <span className="shrink-0 text-[10px] bg-amber-500/20 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded font-semibold">
            PUBLIC
          </span>
        )}
      </div>

      {/* Tunnel URL (State C) */}
      {isReady && entry.tunnel?.url && (
        <a
          href={entry.tunnel.url}
          target="_blank"
          rel="noopener noreferrer"
          title={entry.tunnel.url}
          className="ml-3.5 block truncate max-w-[180px] text-[var(--color-primary)] hover:underline text-[11px]"
        >
          {entry.tunnel.url.replace(/^https?:\/\//, "")}
        </a>
      )}

      {/* State B: starting */}
      {isStarting && (
        <span className="ml-3.5 text-[var(--color-text-muted)] italic text-[11px]">Starting…</span>
      )}

      {/* State B-failed: error message */}
      {isFailed && entry.tunnel?.error && (
        <span
          className="ml-3.5 text-red-500 text-[11px] truncate"
          title={entry.tunnel.error}
        >
          {entry.tunnel.error}
        </span>
      )}

      {/* Error from start attempt */}
      {launchError && (
        <div className="ml-3.5 flex items-center gap-1 text-red-500 text-[11px]">
          <AlertCircle size={10} />
          <span className="truncate">{launchError}</span>
        </div>
      )}

      {/* Action bar — visible on group-hover */}
      <div className="ml-3.5 flex items-center gap-0.5 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {/* Open shortcut — only when same-host and port not lost */}
        {isLocal && entry.state !== "lost" && (
          <a
            href={`http://${location.hostname}:${entry.port}`}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open http://${location.hostname}:${entry.port}`}
            aria-label={`Open http://${location.hostname}:${entry.port}`}
            className="rounded p-0.5 hover:bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            <ExternalLink size={11} />
          </a>
        )}

        {/* State A: no tunnel or failed — start/retry */}
        {(tunnelStatus === null || isFailed) && (
          <button
            onClick={() => void handleStartTunnel()}
            title={isFailed ? "Retry tunnel" : "Start tunnel"}
            aria-label={isFailed ? "Retry tunnel" : "Start tunnel"}
            className="rounded p-0.5 hover:bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            <Cloud size={11} />
          </button>
        )}

        {/* State B: starting — spinner (not interactive) */}
        {isStarting && (
          <Loader2 size={11} className="text-amber-400 animate-spin" />
        )}

        {/* State C: ready — copy + QR + stop */}
        {isReady && (
          <>
            {entry.tunnel?.url && (
              <>
                <button
                  onClick={() => void copy(entry.tunnel!.url!)}
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
                        value={entry.tunnel.url}
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

            <button
              onClick={() => void onStopTunnel(entry.tunnel!.id)}
              title="Stop tunnel"
              aria-label="Stop tunnel"
              className="rounded p-0.5 hover:bg-red-500/20 hover:text-red-500 text-[var(--color-text-muted)] transition-colors"
            >
              <X size={11} />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

// ── Add port form ─────────────────────────────────────────────────────────────

function AddPortForm({ onSubmit }: { onSubmit: (port: number) => Promise<void> }) {
  const [port, setPort] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError("Port 1–65535");
      return;
    }
    if (DANGER_PORTS.has(portNum)) {
      setError("Unsafe port");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(portNum);
      setPort("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="flex items-center gap-1 px-2 py-1.5 border-t border-[var(--color-border)]"
    >
      <input
        type="number"
        placeholder="port"
        value={port}
        onChange={(e) => setPort(e.target.value)}
        min={1}
        max={65535}
        className="w-16 bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-1.5 py-0.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)]"
      />
      <button
        type="submit"
        disabled={submitting || !port}
        title="Start tunnel for port"
        aria-label="Start tunnel for port"
        className="flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--color-primary)]/20 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/30 transition-colors disabled:opacity-50 text-xs"
      >
        <Cloud size={10} />
        tunnel
      </button>
      {error && (
        <span className="text-[10px] text-red-500 truncate">{error}</span>
      )}
    </form>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function PortsPanel() {
  const { ports, isLoading, isError, createTunnel, stopTunnel, installCloudflared, installState } =
    usePorts();
  const [binaryMissing, setBinaryMissing] = useState(false);
  const [warned, setWarned] = useState(() => !!localStorage.getItem(WARNED_KEY));
  const localServer = isLocalServer();

  // Auto-dismiss installer row 1.5s after successful install
  useEffect(() => {
    if (installState.status === "done") {
      const t = setTimeout(() => setBinaryMissing(false), 1500);
      return () => clearTimeout(t);
    }
  }, [installState.status]);

  function dismissWarning() {
    localStorage.setItem(WARNED_KEY, "1");
    setWarned(true);
  }

  async function handleStartTunnel(port: number, label: string) {
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

  return (
    <section className="border-t border-[var(--color-border)] pt-1">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1">
        <p className="text-[10px] text-[var(--color-text-muted)] font-semibold tracking-widest uppercase opacity-60">
          └─ ports
        </p>
        {ports.length > 0 && (
          <span className="text-[10px] text-[var(--color-text-muted)] opacity-40">
            {ports.length}
          </span>
        )}
      </div>

      {/* Warning banner — shown once */}
      {!warned && <WarningBanner onDismiss={dismissWarning} />}

      {/* Binary missing hint */}
      {binaryMissing && (
        <InstallerRow
          installState={installState}
          onInstall={() => void installCloudflared()}
          onDismiss={() => setBinaryMissing(false)}
        />
      )}

      {/* Port list */}
      {isLoading ? (
        <div className="px-3 py-1 text-[10px] text-[var(--color-text-muted)] opacity-60">
          Loading…
        </div>
      ) : isError ? (
        <div className="px-3 py-1 text-[10px] text-red-500 opacity-80">
          Failed to load ports
        </div>
      ) : (
        <ul className="flex flex-col">
          {ports.map((entry) => (
            <PortRow
              key={entry.port}
              entry={entry}
              isLocal={localServer}
              onStartTunnel={handleStartTunnel}
              onStopTunnel={stopTunnel}
            />
          ))}
          {ports.length === 0 && (
            <li className="px-3 py-1 text-[10px] text-[var(--color-text-muted)] opacity-50 italic">
              No ports detected
            </li>
          )}
        </ul>
      )}

      {/* Custom port form */}
      <AddPortForm onSubmit={(port) => handleStartTunnel(port, `port-${port}`)} />
    </section>
  );
}
