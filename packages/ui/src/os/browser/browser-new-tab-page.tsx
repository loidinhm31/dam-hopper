import { useId, useRef, type KeyboardEvent, type ReactElement } from "react";
import { AlertTriangle, Globe, Trash2 } from "lucide-react";

export interface BrowserNewTabPageProps {
  draftValue: string;
  navigationError: string | null;
  privacyMasked: boolean;
  ownerMismatch: boolean;
  clearPending: boolean;
  clearStatus: { kind: "success" | "error"; message: string } | null;
  unresolvedCount: number;
  onDraftChange: (value: string) => void;
  onSubmitAddress: () => void;
  onEscapeDraft: () => void;
  onClearRemembered: () => void;
  onOpenRecovery: () => void;
}

export function BrowserNewTabPage({
  draftValue, navigationError, privacyMasked, ownerMismatch,
  clearPending, clearStatus, unresolvedCount, onDraftChange, onSubmitAddress,
  onEscapeDraft, onClearRemembered, onOpenRecovery,
}: BrowserNewTabPageProps): ReactElement {
  const inputId = useId();
  const isComposingRef = useRef(false);
  const masked = privacyMasked || ownerMismatch;

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isComposingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      if (masked) return;
      e.preventDefault();
      onSubmitAddress();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!masked) onEscapeDraft();
    }
  };

  return (
    <div className="os-browser-new-tab-panel" data-testid="browser-new-tab-panel">
      <div className="w-full max-w-lg rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-4 shadow-md">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-[var(--color-primary)] shrink-0" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-[var(--color-text)]">New Tab</h3>
        </div>

        <p className="text-xs text-[var(--color-text-muted)]">
          Enter an HTTP or HTTPS URL. Scheme-less hosts default to https:// (localhost and 127.0.0.1 use http://); search phrases are not forwarded.
        </p>

        {navigationError && (
          <div role="alert" data-testid="browser-navigation-error" className="rounded border border-[var(--color-danger)] bg-[var(--color-danger)]/10 p-2 text-xs text-[var(--color-danger)]">
            {masked ? "Protected mode active — details hidden." : navigationError}
          </div>
        )}

        <div className="flex items-center gap-2">
          <label htmlFor={inputId} className="sr-only">Page URL</label>
          <input
            id={inputId}
            type="text"
            data-testid="browser-new-tab-url-input"
            value={masked ? "●●●●●●" : draftValue}
            readOnly={masked}
            disabled={ownerMismatch}
            placeholder="http://localhost:5173"
            onChange={(e) => { if (!masked) onDraftChange(e.target.value); }}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={() => { isComposingRef.current = false; }}
            onKeyDown={handleKeyDown}
            className="flex-1 min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-1.5 text-xs font-mono text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
          />
          <button
            type="button"
            data-testid="browser-new-tab-open-btn"
            disabled={masked}
            onClick={onSubmitAddress}
            className="shrink-0 rounded bg-[var(--color-primary)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-40"
          >
            Open
          </button>
        </div>

        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 space-y-2 text-[11px] text-[var(--color-text-muted)]">
          <p>
            Ordinary committed addresses (including query strings and hash fragments) are stored locally in plaintext and included if you export sessions or recipes.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span>Clearing remembered pages removes local URL metadata only; it does not close open pages or clear Chromium cookies/profiles.</span>
            <button
              type="button"
              data-testid="browser-clear-remembered-btn"
              disabled={masked || clearPending}
              onClick={onClearRemembered}
              className="inline-flex items-center gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            >
              <Trash2 className="w-3 h-3" aria-hidden="true" />
              {clearPending ? "Clearing…" : "Clear remembered pages"}
            </button>
          </div>
          {clearStatus && (
            <p
              role={clearStatus.kind === "error" ? "alert" : "status"}
              data-testid="browser-clear-remembered-status"
              className={clearStatus.kind === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}
            >
              {masked ? "Protected mode active — details hidden." : clearStatus.message}
            </p>
          )}
        </div>

        {unresolvedCount > 0 && (
          <div role="status" data-testid="browser-new-tab-recovery-notice" className="flex items-center justify-between gap-2 rounded border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-2.5 text-xs text-[var(--color-warning)]">
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {masked ? "Pending browser recovery notice hidden." : `${unresolvedCount} unresolved browser operation(s) require attention.`}
            </span>
            <button
              type="button"
              data-testid="browser-new-tab-open-recovery-btn"
              onClick={onOpenRecovery}
              className="shrink-0 rounded border border-[var(--color-warning)]/50 px-2 py-0.5 text-[11px] font-medium hover:bg-[var(--color-warning)]/20"
            >
              Open Recovery
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
