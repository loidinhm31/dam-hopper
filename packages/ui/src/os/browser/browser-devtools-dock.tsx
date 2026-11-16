import { useEffect, useRef, useState, type ReactElement } from "react";
import { Code2, PanelBottom, PanelRight, RotateCw, X } from "lucide-react";
import { buildBrowserDevToolsUrl, createBrowserDevToolsLease, revokeBrowserDevToolsLease } from "@/api/browser-host-client.js";
import { isCurrentConnection } from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { sanitizeBrowserError } from "./browser-navigation.js";

export interface BrowserDevToolsDockProps {
  owner: ConnectionRef;
  sessionId: string;
  browserIncarnation?: string;
  profileEpoch?: string;
  dockSide: "bottom" | "right";
  onToggleDockSide: () => void;
  onClose: () => void;
}

interface ActiveLeaseRef { owner: ConnectionRef; sessionId: string; token: string }
interface AttemptResult { key: string; lease: { token: string; url: string } | null; error: string | null }

function revokeLeaseQuietly(owner: ConnectionRef, sessionId: string, token: string): void {
  if (isCurrentConnection(owner)) {
    void revokeBrowserDevToolsLease(owner, sessionId, token).catch(() => {});
  }
}

export function BrowserDevToolsDock({
  owner, sessionId, browserIncarnation, profileEpoch, dockSide, onToggleDockSide, onClose,
}: BrowserDevToolsDockProps): ReactElement {
  const [reloadNonce, setReloadNonce] = useState(0);
  const [attemptResult, setAttemptResult] = useState<AttemptResult | null>(null);
  const requestKey = `${owner.profileId}:${owner.generation}:${sessionId}:${browserIncarnation ?? ""}:${profileEpoch ?? ""}:${reloadNonce}`;

  const mountedRef = useRef(true);
  const attemptIdRef = useRef(0);
  const activeLeaseRef = useRef<ActiveLeaseRef | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const attemptId = ++attemptIdRef.current;
    const ac = new AbortController();
    const capturedOwner: ConnectionRef = { profileId: owner.profileId, generation: owner.generation };

    void (async () => {
      let mintedToken: string | null = null;
      try {
        const lease = await createBrowserDevToolsLease(capturedOwner, sessionId, ac.signal);
        mintedToken = lease.token;
        const isCurrent =
          mountedRef.current && attemptId === attemptIdRef.current && !ac.signal.aborted && isCurrentConnection(capturedOwner);
        const matchesTarget =
          lease.browserSessionId === sessionId &&
          (!browserIncarnation || lease.browserIncarnation === browserIncarnation) &&
          (!profileEpoch || String(lease.profileEpoch) === String(profileEpoch));
        if (!isCurrent || !matchesTarget) {
          revokeLeaseQuietly(capturedOwner, sessionId, lease.token);
          if (mountedRef.current && attemptId === attemptIdRef.current && !ac.signal.aborted && isCurrent) {
            setAttemptResult({
              key: requestKey,
              lease: null,
              error: "Developer Tools target changed; retry to reconnect.",
            });
          }
          return;
        }
        const url = buildBrowserDevToolsUrl(capturedOwner, lease.token, "console");
        activeLeaseRef.current = { owner: capturedOwner, sessionId, token: lease.token };
        setAttemptResult({ key: requestKey, lease: { token: lease.token, url }, error: null });
      } catch (err) {
        if (mintedToken) revokeLeaseQuietly(capturedOwner, sessionId, mintedToken);
        if (ac.signal.aborted || !mountedRef.current || attemptId !== attemptIdRef.current) return;
        setAttemptResult({
          key: requestKey,
          lease: null,
          error: sanitizeBrowserError(err, "Failed to open Developer Tools."),
        });
      }
    })();

    return () => {
      ac.abort();
      const active = activeLeaseRef.current;
      activeLeaseRef.current = null;
      if (active) revokeLeaseQuietly(active.owner, active.sessionId, active.token);
    };
  }, [owner.profileId, owner.generation, sessionId, browserIncarnation, profileEpoch, reloadNonce, requestKey]);

  const isSettled = attemptResult?.key === requestKey;
  const leaseState = isSettled ? attemptResult.lease : null;
  const error = isSettled ? attemptResult.error : null;
  const loading = !isSettled;

  const dockClass =
    dockSide === "right"
      ? "w-[42%] min-w-[280px] max-w-[60%] h-full border-l border-[var(--color-border)]"
      : "h-[42%] min-h-[180px] max-h-[65%] w-full border-t border-[var(--color-border)]";
  const toggleLabel = dockSide === "bottom" ? "Dock DevTools to right" : "Dock DevTools to bottom";

  return (
    <section
      data-testid="browser-devtools-dock"
      data-dock-side={dockSide}
      aria-label="Chromium Developer Tools"
      className={`flex flex-col shrink-0 bg-[var(--color-surface)] min-w-0 min-h-0 ${dockClass}`}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-1 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Code2 className="w-3.5 h-3.5 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
          <span className="text-[11px] font-semibold text-[var(--color-text)] truncate">Developer Tools</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" data-testid="browser-devtools-dock-side-btn" aria-label={toggleLabel} title={toggleLabel} onClick={onToggleDockSide} className="os-browser-icon-btn">
            {dockSide === "bottom" ? <PanelRight className="w-3.5 h-3.5" aria-hidden="true" /> : <PanelBottom className="w-3.5 h-3.5" aria-hidden="true" />}
          </button>
          <button type="button" data-testid="browser-devtools-reload-btn" aria-label="Reload Developer Tools" title="Reload Developer Tools" onClick={() => setReloadNonce((n) => n + 1)} className="os-browser-icon-btn">
            <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button type="button" data-testid="browser-devtools-close-btn" aria-label="Close Developer Tools" title="Close Developer Tools" onClick={onClose} className="os-browser-icon-btn">
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {leaseState ? (
        <iframe
          key={`${leaseState.token}-${reloadNonce}`}
          data-testid="browser-devtools-iframe"
          title="Chromium Developer Tools"
          src={leaseState.url}
          referrerPolicy="no-referrer"
          className="w-full flex-1 min-h-0 border-0 bg-[#292a2d]"
        />
      ) : error ? (
        <div role="alert" data-testid="browser-devtools-error" className="flex-1 flex flex-col items-center justify-center gap-2 p-4 text-center text-xs text-[var(--color-danger)]">
          <span>{error}</span>
          <button type="button" data-testid="browser-devtools-retry-btn" onClick={() => setReloadNonce((n) => n + 1)} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text)] hover:bg-[var(--color-surface)]">
            Retry
          </button>
        </div>
      ) : (
        <div data-testid="browser-devtools-loading" role="status" aria-live="polite" className="flex-1 flex items-center justify-center p-4 text-xs text-[var(--color-text-muted)]">
          {loading ? "Connecting Developer Tools…" : "Developer Tools unavailable."}
        </div>
      )}
    </section>
  );
}
