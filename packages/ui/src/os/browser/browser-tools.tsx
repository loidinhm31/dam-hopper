import type { KeyboardEvent, ReactElement } from "react";
import { X } from "lucide-react";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { BrowserRecoveryPanel } from "./browser-recovery-panel.js";
import type { BrowserOwnerScope, BrowserTabRuntime, BrowserWindowClosingState } from "./browser-tab-types.js";

export interface BrowserToolsProps {
  panelId: string;
  windowId: string;
  owner: ConnectionRef;
  verifiedScope: BrowserOwnerScope | null;
  activeTab: BrowserTabRuntime;
  windowClosing?: BrowserWindowClosingState;
  privacyMasked: boolean;
  ownerMismatch: boolean;
  navigationError: string | null;
  selectionPending: boolean;
  selectionActive: boolean;
  controlPending: boolean;
  clearPending: boolean;
  clearStatus: { kind: "success" | "error"; message: string } | null;
  onAcquireControl: () => void;
  onReleaseControl: () => void;
  onToggleSelection: () => void;
  onClearRemembered: () => void;
  onCloseTools: () => void;
  onAttachSession: (session: BrowserSessionDto) => void;
  onWindowStateUpdated: () => void;
  onCloseUnknownWindowAllowed?: () => void;
}

export function BrowserTools({
  panelId, windowId, owner, verifiedScope, activeTab, windowClosing, privacyMasked, ownerMismatch,
  navigationError, selectionPending, selectionActive, controlPending, clearPending, clearStatus,
  onAcquireControl, onReleaseControl, onToggleSelection, onClearRemembered, onCloseTools,
  onAttachSession, onWindowStateUpdated, onCloseUnknownWindowAllowed,
}: BrowserToolsProps): ReactElement {
  const masked = privacyMasked || ownerMismatch;
  const isLive = activeTab.phase === "live" && Boolean(activeTab.sessionId);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCloseTools();
    }
  };

  return (
    <div
      id={panelId}
      role="region"
      aria-label="Browser tools"
      data-testid="browser-tools-panel"
      onKeyDown={handleKeyDown}
      className="os-browser-tools-panel"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {activeTab.isController ? (
            <button
              type="button"
              data-testid="browser-release-control-btn"
              disabled={!isLive || masked}
              onClick={onReleaseControl}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-[11px] font-medium text-[var(--color-text)] hover:bg-[var(--color-surface)] disabled:opacity-40"
            >
              Release
            </button>
          ) : (
            <button
              type="button"
              data-testid="browser-take-control-btn"
              disabled={!isLive || masked || controlPending}
              onClick={onAcquireControl}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-[11px] font-medium text-[var(--color-text)] hover:bg-[var(--color-surface)] disabled:opacity-40"
            >
              {controlPending ? "Acquiring…" : "Control"}
            </button>
          )}

          <button
            type="button"
            data-testid="browser-select-element-btn"
            disabled={!isLive || !activeTab.isController || !activeTab.leaseToken || selectionPending || masked}
            onClick={onToggleSelection}
            title={activeTab.isController ? "Select DOM element via CDP Overlay" : "Acquire Control first to select elements"}
            className={`rounded border px-2 py-1 text-[11px] font-medium disabled:opacity-40 ${
              selectionActive
                ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                : "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)]"
            }`}
          >
            {selectionActive ? "Cancel Select" : "Select Element"}
          </button>

          <button
            type="button"
            data-testid="browser-clear-remembered-btn"
            disabled={masked || clearPending || !verifiedScope}
            onClick={onClearRemembered}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-[11px] font-medium text-[var(--color-text)] hover:bg-[var(--color-surface)] disabled:opacity-40"
          >
            {clearPending ? "Clearing…" : "Clear remembered pages"}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span
            data-testid="browser-diagnostic-session-id"
            className="font-mono text-[10px] text-[var(--color-text-muted)]"
          >
            {masked ? "Session: Hidden" : activeTab.sessionId ? `Session: ${activeTab.sessionId.slice(0, 8)}` : `Phase: ${activeTab.phase}`}
          </span>
          <button
            type="button"
            data-testid="browser-tools-close-btn"
            aria-label="Close browser tools"
            onClick={onCloseTools}
            className="os-browser-icon-btn"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <p className="text-[11px] text-[var(--color-text-muted)]">
        Remembered ordinary addresses (including query/hash) stay local in plaintext unless cleared. Clearing metadata does not close open pages or reset server Chromium cookies/profiles.
      </p>

      {clearStatus && (
        <p role={clearStatus.kind === "error" ? "alert" : "status"} data-testid="browser-clear-remembered-status" className={`text-[11px] ${clearStatus.kind === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-success)]"}`}>
          {masked ? "Protected mode active — details hidden." : clearStatus.message}
        </p>
      )}
      {!masked && (navigationError || activeTab.unsupportedReason || activeTab.unavailableReason) && (
        <p role="alert" data-testid="browser-tools-diagnostic-error" className="text-[11px] text-[var(--color-danger)]">
          {navigationError || activeTab.unsupportedReason || activeTab.unavailableReason}
        </p>
      )}

      <BrowserRecoveryPanel
        windowId={windowId}
        owner={owner}
        verifiedScope={verifiedScope}
        windowClosing={windowClosing}
        activeTab={activeTab}
        privacyMasked={privacyMasked}
        ownerMismatch={ownerMismatch}
        onAttachSession={onAttachSession}
        onWindowStateUpdated={onWindowStateUpdated}
        onCloseUnknownWindowAllowed={onCloseUnknownWindowAllowed}
      />
    </div>
  );
}
