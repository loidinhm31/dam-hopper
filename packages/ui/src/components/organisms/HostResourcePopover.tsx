import { useEffect, useId, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  X,
} from "lucide-react";
import {
  useGlobalConfig,
  useHostMetrics,
  useHostResourceAlerts,
  useHostResourceSnapshot,
  useUpdateUiConfig,
} from "@/api/queries.js";
import { HostResourceDiagnosis } from "@/components/organisms/HostResourceDiagnosis.js";
import { HostResourceGlance } from "@/components/organisms/HostResourceGlance.js";
import { useHostResourceAlertPresentation } from "@/hooks/use-host-resource-alert-presentation.js";
import {
  formatAlertState,
  resolveHostResourceStatus,
  type HostResourceStatusPresentation,
} from "@/lib/host-resource-state.js";
import { withUiConfigDefaults } from "@/lib/ui-config.js";
import { cn } from "@/lib/utils.js";

export function HostResourcePopover() {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const { data: globalConfig } = useGlobalConfig();
  const updateUiConfig = useUpdateUiConfig();
  const snapshot = useHostResourceSnapshot();
  const alerts = useHostResourceAlerts(true);
  const legacyMetrics = useHostMetrics(open);
  const uiConfig = withUiConfigDefaults(globalConfig?.ui);
  const alert = snapshot.data?.alert;
  const currentAlerts = snapshot.data?.currentAlerts;
  const alertPresentation = useHostResourceAlertPresentation(
    alert,
    currentAlerts,
  );
  const effectiveStatus = resolveHostResourceStatus({
    snapshot: snapshot.data,
    isLoading: snapshot.isLoading,
    isFetching: snapshot.isFetching,
    isError: snapshot.isError,
    isStale: snapshot.isStale,
    unreadCount: alertPresentation.unreadCount,
  });
  const sourceLabel =
    currentAlerts && currentAlerts.length > 0
      ? `${currentAlerts.length} active resource incident${currentAlerts.length === 1 ? "" : "s"}`
      : alert
        ? formatAlertState(alert.state)
        : effectiveStatus.label;
  const triggerLabel =
    sourceLabel === effectiveStatus.label
      ? sourceLabel
      : `${sourceLabel}; ${effectiveStatus.label}`;

  const savePinnedMount = (mountPoint: string | null) => {
    updateUiConfig.mutate({ hostResourcePinnedMount: mountPoint });
  };

  const closeAndRestoreFocus = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;

    const focusFrame = requestAnimationFrame(() => panelRef.current?.focus());
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node))
        closeAndRestoreFocus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndRestoreFocus();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          panelRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        ).filter((element) => !element.closest("[hidden]"));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (document.activeElement === panelRef.current) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const hostname = snapshot.data?.host.hostname ?? "Host";
  const osName = snapshot.data?.host.osName ?? "System";
  const sampleLabel = snapshot.data
    ? ` · sampled ${formatSampleAge(snapshot.data.sampledAt)} ago`
    : "";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() =>
          setOpen((value) => {
            if (!value) alertPresentation.markRead();
            return !value;
          })
        }
        className={cn(
          "relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm text-[var(--color-text-muted)] transition-colors",
          "hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]",
          effectiveStatus.triggerClassName,
          open && "bg-[var(--color-surface-2)]",
        )}
        title={`Host resources: ${triggerLabel}`}
        aria-label={`Host resources: ${triggerLabel}`}
        aria-describedby={
          effectiveStatus.badgeLabel
            ? `${panelId}-badge-description`
            : undefined
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
      >
        <Activity aria-hidden="true" size={16} />
        {effectiveStatus.badgeText && effectiveStatus.badgeLabel && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute -right-0.5 -top-0.5 min-w-4 rounded-full px-1 text-center text-[9px] font-bold leading-4 shadow-sm",
              effectiveStatus.badgeClassName,
            )}
          >
            {effectiveStatus.badgeText}
          </span>
        )}
      </button>
      {effectiveStatus.badgeLabel && (
        <span id={`${panelId}-badge-description`} className="sr-only">
          {effectiveStatus.badgeLabel}
        </span>
      )}

      {open && (
        <section
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          aria-labelledby={`${panelId}-title`}
          className="fixed left-1/2 top-[calc(var(--top-nav-height)+0.75rem)] z-[75] flex max-h-[min(38rem,calc(100dvh-var(--top-nav-height)-var(--safe-area-bottom)-1.5rem))] w-[min(26rem,calc(100vw-1rem-var(--safe-area-left)-var(--safe-area-right)))] -translate-x-1/2 flex-col overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl outline-none sm:absolute sm:left-auto sm:right-0 sm:top-12 sm:w-[26rem] sm:max-h-[min(48rem,calc(100dvh-var(--top-nav-height)-var(--safe-area-bottom)-0.5rem))] sm:translate-x-0"
        >
          <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-3 py-2.5">
            <div className="min-w-0">
              <h2
                id={`${panelId}-title`}
                className="text-xs font-bold text-[var(--color-text)]"
              >
                Host resources
              </h2>
              <p className="min-w-0 [overflow-wrap:anywhere] text-[10px] text-[var(--color-text-muted)]">
                Read-only monitoring and diagnosis
              </p>
              <div
                aria-label={`Host resource status: ${effectiveStatus.label}`}
                className={cn(
                  "mt-2 flex min-w-0 items-start gap-2 rounded border-l-2 px-2 py-1.5",
                  effectiveStatus.statusClassName,
                )}
              >
                <StatusIcon presentation={effectiveStatus} />
                <p className="min-w-0 [overflow-wrap:anywhere] text-xs font-bold text-[var(--color-text)]">
                  {effectiveStatus.label}
                </p>
              </div>
              <p className="mt-2 min-w-0 [overflow-wrap:anywhere] text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
                {hostname}
              </p>
              <p className="min-w-0 [overflow-wrap:anywhere] text-[10px] text-[var(--color-text-muted)]">
                {osName}
                {sampleLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={closeAndRestoreFocus}
              className="flex min-h-11 min-w-11 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]"
              aria-label="Close host resources"
            >
              <X aria-hidden="true" size={15} />
            </button>
          </header>

          <div className="min-h-0 overscroll-contain overflow-y-auto p-3">
            {!snapshot.data && effectiveStatus.mode === "sampling" && (
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <Activity className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                Sampling host
              </div>
            )}
            {(!snapshot.data || snapshot.isError) &&
              !snapshot.data &&
              effectiveStatus.mode !== "sampling" && (
                <>
                  <div className="flex items-center gap-2 text-xs text-[var(--color-danger)]">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Resource snapshot unavailable
                  </div>
                  {legacyMetrics.data && (
                    <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                      Deep metrics unavailable; showing compatible basic
                      metrics.
                    </p>
                  )}
                </>
              )}
            {(snapshot.data || legacyMetrics.data) && (
              <HostResourceGlance
                metrics={legacyMetrics.data}
                snapshot={snapshot.data}
                pinnedMount={uiConfig.hostResourcePinnedMount}
                metricsStale={legacyMetrics.isStale}
                metricsError={legacyMetrics.isError}
              />
            )}
            {snapshot.data && (
              <section className="mt-3 border-t border-[var(--color-border)] pt-3">
                <h3>
                  <button
                    type="button"
                    className="flex min-h-11 min-w-11 w-full cursor-pointer items-center justify-between gap-3 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]"
                    aria-expanded={diagnosisOpen}
                    aria-controls={`${panelId}-diagnosis`}
                    onClick={() => setDiagnosisOpen((value) => !value)}
                  >
                    <span>Diagnostics and storage controls</span>
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        "h-4 w-4 shrink-0 transition-transform",
                        diagnosisOpen &&
                          "rotate-180 text-[var(--color-primary)]",
                      )}
                    />
                  </button>
                </h3>
                <div
                  id={`${panelId}-diagnosis`}
                  hidden={!diagnosisOpen}
                  className="mt-3"
                >
                  <HostResourceDiagnosis
                    snapshot={snapshot.data}
                    alerts={alerts.data ?? []}
                    legacyMetrics={legacyMetrics.data}
                    pinnedMount={uiConfig.hostResourcePinnedMount}
                    onPin={savePinnedMount}
                    isPinPending={updateUiConfig.isPending}
                    pinError={
                      updateUiConfig.error instanceof Error
                        ? updateUiConfig.error
                        : null
                    }
                  />
                </div>
              </section>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function StatusIcon({
  presentation,
}: {
  presentation: HostResourceStatusPresentation;
}) {
  if (presentation.icon === "healthy") {
    return (
      <CheckCircle2
        aria-hidden="true"
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          presentation.statusIconClassName,
        )}
      />
    );
  }
  if (presentation.icon === "alert") {
    return (
      <AlertTriangle
        aria-hidden="true"
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          presentation.statusIconClassName,
        )}
      />
    );
  }
  return (
    <Activity
      aria-hidden="true"
      className={cn(
        "mt-0.5 h-4 w-4 shrink-0",
        presentation.statusIconClassName,
      )}
    />
  );
}

function formatSampleAge(sampledAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - sampledAt) / 1_000));
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}
