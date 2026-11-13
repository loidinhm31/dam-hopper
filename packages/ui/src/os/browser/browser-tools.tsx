import type { KeyboardEvent, ReactElement } from "react";
import { X } from "lucide-react";
import type { BrowserSessionDto, QualityPreference, StreamQualityEvent } from "@/api/browser-host-types.js";
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
  qualityPreference?: QualityPreference;
  qualityStatus?: StreamQualityEvent | null;
  qualityPending?: boolean;
  onQualityPreferenceChange?: (preference: QualityPreference) => void;
}

export function BrowserTools({
  panelId, windowId, owner, verifiedScope, activeTab, windowClosing, privacyMasked, ownerMismatch,
  navigationError, selectionPending, selectionActive, controlPending, clearPending, clearStatus,
  onAcquireControl, onReleaseControl, onToggleSelection, onClearRemembered, onCloseTools,
  onAttachSession, onWindowStateUpdated, onCloseUnknownWindowAllowed,
  qualityPreference = "auto", qualityStatus = null, qualityPending = false, onQualityPreferenceChange,
}: BrowserToolsProps): ReactElement {
  const masked = privacyMasked || ownerMismatch;
  const isLive = activeTab.phase === "live" && Boolean(activeTab.sessionId);
  const qualitySelectId = `${panelId}-quality-select`;

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

          <div className="flex items-center gap-1.5">
            <label
              htmlFor={qualitySelectId}
              className="text-[11px] font-medium text-[var(--color-text)]"
            >
              Quality
            </label>
            <select
              id={qualitySelectId}
              data-testid="browser-quality-selector"
              aria-label="Stream quality preference"
              disabled={!isLive || masked}
              value={qualityPreference}
              onChange={(e) => onQualityPreferenceChange?.(e.target.value as QualityPreference)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-[11px] font-medium text-[var(--color-text)] hover:bg-[var(--color-surface)] disabled:opacity-40"
            >
              <option value="auto">Auto</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            {qualityPending && (
              <span
                role="status"
                aria-live="polite"
                data-testid="browser-quality-pending"
                className="text-[10px] text-[var(--color-text-muted)] font-mono"
              >
                Switching…
              </span>
            )}
            {(!isLive || masked) && (
              <span
                data-testid="browser-quality-unavailable"
                className="text-[10px] text-[var(--color-text-muted)] font-mono"
              >
                (unavailable)
              </span>
            )}
          </div>
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
      {!masked && isLive && qualityStatus && (
        <div className="space-y-1.5" data-testid="browser-quality-diagnostics">
          <div className="flex items-center gap-3 flex-wrap text-[11px] text-[var(--color-text-muted)] bg-[var(--color-surface-2)] px-2 py-1.5 rounded border border-[var(--color-border)]">
            {qualityStatus.status === "warming" || qualityStatus.status === "unavailable" ? (
              <div>
                <span>Status: </span>
                <span
                  data-testid="browser-quality-status"
                  className="font-mono text-[10px] text-[var(--color-text)]"
                >
                  {qualityStatus.status === "warming" ? "Warming…" : "Unavailable"}
                </span>
              </div>
            ) : (
              <>
                <div>
                  <span>Shared tier: </span>
                  <strong
                    data-testid="browser-quality-shared-tier"
                    className="text-[var(--color-text)] font-semibold uppercase"
                  >
                    {qualityStatus.sharedTier}
                  </strong>
                </div>
                <div data-testid="browser-quality-scale-jpeg">
                  <span>Resolution: </span>
                  <span className="font-mono text-[10px] text-[var(--color-text)]">
                    {qualityStatus.imageWidth}×{qualityStatus.imageHeight} (
                    {Math.round(qualityStatus.scale * 100)}%, q{qualityStatus.jpegQuality})
                  </span>
                </div>
                <div data-testid="browser-quality-fps">
                  <span>FPS: </span>
                  <span className="font-mono text-[10px] text-[var(--color-text)]">
                    {qualityStatus.fps}
                  </span>
                </div>
                <div>
                  <span>Status: </span>
                  <span
                    data-testid="browser-quality-status"
                    className="font-mono text-[10px] text-[var(--color-text)] capitalize"
                  >
                    {qualityStatus.status}
                  </span>
                </div>
              </>
            )}
            {qualityStatus.audioSuppressed && qualityStatus.audioReason && (
              <div data-testid="browser-quality-audio-suppression">
                <span>Audio: </span>
                <span
                  data-testid="browser-quality-audio-reason"
                  className="text-[var(--color-warning)] font-medium"
                >
                  {qualityStatus.audioReason === "muted"
                    ? "Muted"
                    : qualityStatus.audioReason === "bandwidth"
                      ? "Bandwidth constrained"
                      : qualityStatus.audioReason === "hidden"
                        ? "Hidden"
                        : "Stalled"}
                </span>
              </div>
            )}
          </div>
          {(qualityStatus.status === "effective" || qualityStatus.status === "switching") &&
            ((qualityPreference !== "auto" && qualityPreference !== qualityStatus.sharedTier) ||
              qualityStatus.viewerTier !== qualityStatus.sharedTier) && (
              <p
                data-testid="browser-quality-shared-limit-note"
                className="text-[11px] text-[var(--color-text-muted)] italic"
              >
                Fidelity is shared and limited by the slowest visible viewer (a faster viewer may see lower pixels).
              </p>
            )}
        </div>
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
