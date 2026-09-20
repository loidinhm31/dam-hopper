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
  resolveTargetOwner,
  type OwnerInput,
} from "@/api/queries.js";
import { useServerProfile } from "@/hooks/use-server-profile.js";
import { useWorkbenchSelectionsStore } from "@/stores/workbench-selections.js";
import { HostResourceDiagnosis } from "@/components/organisms/HostResourceDiagnosis.js";
import { HostResourceGlance } from "@/components/organisms/HostResourceGlance.js";
import {
  useHostResourceAlertPresentation,
  useHostResourceAlertPresentationStore,
} from "@/hooks/use-host-resource-alert-presentation.js";
import { HostIdleSuspendStatus } from "@/components/organisms/HostIdleSuspendStatus.js";
import { ForceSleepDialog } from "@/components/organisms/ForceSleepDialog.js";
import type { IdleSuspendStatusV1 } from "@/api/client.js";
import {
  formatAlertState,
  resolveHostResourceStatus,
  type HostResourceFleetSummary,
  type HostResourceStatusPresentation,
} from "@/lib/host-resource-state.js";
import { withUiConfigDefaults } from "@/lib/ui-config.js";
import { cn } from "@/lib/utils.js";
import { useMultiHostResources } from "@/hooks/use-multi-host-resources.js";
import { HostResourceFleetDeck } from "@/components/organisms/HostResourceFleetDeck.js";

export interface HostResourcePopoverProps {
  owner?: OwnerInput;
}

export function HostResourcePopover({ owner }: HostResourcePopoverProps = {}) {
  const multiResources = useMultiHostResources({ enabled: true });
  const fleetMode = owner === undefined && multiResources.configuredProfileCount > 1;

  const activeProfile = useServerProfile();
  const settingsProfileId = useWorkbenchSelectionsStore(
    (s) => s.settingsProfileId,
  );
  const effectiveOwner = owner ?? settingsProfileId ?? activeProfile?.id;
  const legacyResolvedOwner = resolveTargetOwner(effectiveOwner);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const fleetPillRef = useRef<HTMLButtonElement>(null);
  const profilePillsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const panelId = useId();

  const [open, setOpen] = useState(false);
  const [inspectedProfileId, setInspectedProfileId] = useState<string | null>(null);
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const [forceSleepOpen, setForceSleepOpen] = useState(false);
  const [forceSleepStatus, setForceSleepStatus] =
    useState<IdleSuspendStatusV1 | null>(null);

  const selectedEntry = fleetMode && inspectedProfileId
    ? multiResources.entries.find((e) => e.profile.id === inspectedProfileId)
    : undefined;
  const detailConnected = selectedEntry ? selectedEntry.connected : false;
  const detailOwner = fleetMode
    ? selectedEntry && detailConnected
      ? selectedEntry.owner
      : undefined
    : legacyResolvedOwner;
  const isDrilldown = !fleetMode || (inspectedProfileId !== null && detailConnected);

  const markAlertRead = useHostResourceAlertPresentationStore((s) => s.markRead);

  const { data: globalConfig } = useGlobalConfig(detailOwner);
  const updateUiConfig = useUpdateUiConfig(detailOwner);
  const snapshot = useHostResourceSnapshot(isDrilldown, detailOwner);
  const alerts = useHostResourceAlerts(isDrilldown, 20, detailOwner);
  const legacyMetrics = useHostMetrics(open && isDrilldown, detailOwner);
  const uiConfig = withUiConfigDefaults(globalConfig?.ui);

  const alert = snapshot.data?.alert;
  const currentAlerts = snapshot.data?.currentAlerts;
  const legacyAlertPresentation = useHostResourceAlertPresentation(
    alert,
    currentAlerts,
    legacyResolvedOwner?.profileId,
  );

  const singleStatus = resolveHostResourceStatus({
    snapshot: snapshot.data,
    isLoading: snapshot.isLoading,
    isFetching: snapshot.isFetching,
    isError: snapshot.isError,
    isStale: snapshot.isStale,
    unreadCount: legacyAlertPresentation.unreadCount,
  });

  const effectiveStatus: HostResourceStatusPresentation = fleetMode
    ? multiResources.summary.presentation
    : singleStatus;

  const singleSourceLabel =
    currentAlerts && currentAlerts.length > 0
      ? `${currentAlerts.length} active resource incident${currentAlerts.length === 1 ? "" : "s"}`
      : alert
        ? formatAlertState(alert.state)
        : singleStatus.label;
  const singleTriggerLabel =
    singleSourceLabel === singleStatus.label
      ? singleSourceLabel
      : `${singleSourceLabel}; ${singleStatus.label}`;

  const triggerLabel = fleetMode
    ? formatFleetTriggerLabel(multiResources.summary)
    : singleTriggerLabel;

  const savePinnedMount = (mountPoint: string | null) => {
    updateUiConfig.mutate({ hostResourcePinnedMount: mountPoint });
  };

  const handleInspectProfile = (profileId: string) => {
    const entry = multiResources.entries.find((e) => e.profile.id === profileId);
    if (!entry || !entry.connected) return;
    setInspectedProfileId(profileId);
    setDiagnosisOpen(false);
    markAlertRead(profileId);
    requestAnimationFrame(() => {
      profilePillsRef.current.get(profileId)?.focus();
    });
  };

  const handleSelectFleet = () => {
    setInspectedProfileId(null);
    setDiagnosisOpen(false);
    requestAnimationFrame(() => {
      fleetPillRef.current?.focus();
    });
  };

  const closeAndRestoreFocus = () => {
    setOpen(false);
    if (fleetMode) {
      setInspectedProfileId(null);
      setDiagnosisOpen(false);
    }
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const handleOpenForceSleep = (status: IdleSuspendStatusV1) => {
    setForceSleepStatus(status);
    setOpen(false);
    setForceSleepOpen(true);
  };

  const handleCloseForceSleep = () => {
    setForceSleepOpen(false);
    setForceSleepStatus(null);
    if (fleetMode) {
      const current = multiResources.entries.find((e) => e.profile.id === inspectedProfileId);
      if (!current || !current.connected) {
        setInspectedProfileId(null);
        setDiagnosisOpen(false);
      }
    }
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  // Reset drilldown to fleet view when inspected profile disappears or disconnects
  useEffect(() => {
    if (!fleetMode || inspectedProfileId === null) return;
    const current = multiResources.entries.find((e) => e.profile.id === inspectedProfileId);
    if (!current || !current.connected) {
      if (!forceSleepOpen) {
        setInspectedProfileId(null);
        setDiagnosisOpen(false);
        setForceSleepStatus(null);
      }
    }
  }, [fleetMode, inspectedProfileId, multiResources.entries, forceSleepOpen]);

  // Reset drilldown to fleet view when popover closes in fleet mode
  useEffect(() => {
    if (!open && fleetMode) {
      setInspectedProfileId(null);
      setDiagnosisOpen(false);
    }
  }, [open, fleetMode]);

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
  }, [open, fleetMode]);

  const detailSnapshot = snapshot.data ?? selectedEntry?.snapshot;
  const hostname = detailSnapshot?.host.hostname ?? (selectedEntry ? selectedEntry.profile.name : "Host");
  const osName = detailSnapshot?.host.osName ?? "System";
  const sampleLabel = detailSnapshot
    ? ` · sampled ${formatSampleAge(detailSnapshot.sampledAt)} ago`
    : "";
  const drilldownStatus = fleetMode
    ? selectedEntry?.status ?? multiResources.summary.presentation
    : singleStatus;

  const forceSleepEndpointLabel = fleetMode
    ? selectedEntry
      ? `${selectedEntry.profile.name} (${selectedEntry.profile.url})`
      : undefined
    : activeProfile?.name
      ? `${activeProfile.name} (${activeProfile.url})`
      : undefined;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() =>
          setOpen((value) => {
            if (!value && !fleetMode) legacyAlertPresentation.markRead();
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
        aria-expanded={open || forceSleepOpen}
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
          className="fixed left-1/2 top-[calc(var(--top-nav-height)_+_0.75rem)] z-[75] flex max-h-[min(38rem,calc(var(--app-viewport-height)_-_var(--top-nav-height)_-_var(--safe-area-bottom)_-_1.5rem))] w-[min(26rem,calc(var(--app-viewport-width)_-_1rem_-_var(--safe-area-left)_-_var(--safe-area-right)))] -translate-x-1/2 flex-col overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl outline-none sm:absolute sm:left-auto sm:right-0 sm:top-12 sm:w-[26rem] sm:max-h-[min(48rem,calc(var(--app-viewport-height)_-_var(--top-nav-height)_-_var(--safe-area-bottom)_-_0.5rem))] sm:translate-x-0"
        >
          <header className="flex flex-col gap-2.5 border-b border-[var(--color-border)] px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2
                  id={`${panelId}-title`}
                  className="text-xs font-bold text-[var(--color-text)]"
                >
                  Host resources
                </h2>
                <p className="min-w-0 [overflow-wrap:anywhere] text-[10px] text-[var(--color-text-muted)]">
                  Monitoring, diagnosis, and host sleep control
                </p>
                {!fleetMode && (
                  <>
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
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={closeAndRestoreFocus}
                className="flex min-h-11 min-w-11 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]"
                aria-label="Close host resources"
              >
                <X aria-hidden="true" size={15} />
              </button>
            </div>

            {fleetMode && (
              <div className="flex flex-col gap-2 pt-0.5">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] text-[var(--color-text-muted)]">
                  <span>
                    {multiResources.summary.connectedCount} of {multiResources.summary.watchedCount} watched connected
                  </span>
                  <div className="flex items-center gap-2">
                    {multiResources.summary.attentionCount > 0 && (
                      <span className="font-semibold text-[var(--color-warning)]">
                        {multiResources.summary.attentionCount} need{multiResources.summary.attentionCount === 1 ? "s" : ""} attention
                      </span>
                    )}
                    {multiResources.summary.unreadCount > 0 && (
                      <span className="rounded-full bg-[var(--color-danger)]/15 px-1.5 py-0.2 text-[9px] font-bold text-[var(--color-danger)]">
                        {multiResources.summary.unreadCount} unread
                      </span>
                    )}
                  </div>
                </div>

                <div
                  role="toolbar"
                  aria-label="Host resource view navigation"
                  className="flex flex-wrap items-center gap-1.5"
                >
                  <button
                    ref={fleetPillRef}
                    type="button"
                    aria-pressed={inspectedProfileId === null}
                    onClick={handleSelectFleet}
                    className={cn(
                      "inline-flex min-h-7 items-center rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                      "focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]",
                      inspectedProfileId === null
                        ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] shadow-xs"
                        : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]",
                    )}
                  >
                    Fleet
                  </button>

                  {multiResources.entries.map((entry) => {
                    const isSelected = inspectedProfileId === entry.profile.id;
                    const isConnected = entry.connected;
                    return (
                      <button
                        key={entry.profile.id}
                        ref={(node) => {
                          if (node) {
                            profilePillsRef.current.set(entry.profile.id, node);
                          } else {
                            profilePillsRef.current.delete(entry.profile.id);
                          }
                        }}
                        type="button"
                        disabled={!isConnected}
                        aria-pressed={isSelected}
                        aria-label={`${entry.profile.name}: ${entry.status.label}${!isConnected ? " (disconnected)" : ""}`}
                        title={`${entry.profile.name} (${entry.status.label})`}
                        onClick={() => handleInspectProfile(entry.profile.id)}
                        className={cn(
                          "inline-flex min-h-7 max-w-44 items-center gap-1.5 truncate rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                          "focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]",
                          !isConnected &&
                            "cursor-not-allowed opacity-50 bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
                          isConnected &&
                            isSelected &&
                            "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] shadow-xs",
                          isConnected &&
                            !isSelected &&
                            "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            !isConnected
                              ? "bg-[var(--color-text-muted)]"
                              : entry.status.rank === 3
                                ? "bg-[var(--color-danger)]"
                                : entry.status.rank === 2
                                  ? "bg-[var(--color-warning)]"
                                  : "bg-[var(--color-success)]",
                          )}
                        />
                        <span className="truncate">{entry.profile.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </header>

          <div className="min-h-0 overscroll-contain overflow-y-auto p-3">
            {fleetMode && (inspectedProfileId === null || !isDrilldown) ? (
              <HostResourceFleetDeck
                entries={multiResources.entries}
                selectedProfileId={inspectedProfileId ?? undefined}
                onInspect={handleInspectProfile}
              />
            ) : (
              <div className="flex flex-col">
                {fleetMode && selectedEntry && (
                  <div className="mb-3 border-b border-[var(--color-border)] pb-3">
                    <div
                      aria-label={`Host resource status: ${drilldownStatus.label}`}
                      className={cn(
                        "flex min-w-0 items-start gap-2 rounded border-l-2 px-2 py-1.5",
                        drilldownStatus.statusClassName,
                      )}
                    >
                      <StatusIcon presentation={drilldownStatus} />
                      <p className="min-w-0 [overflow-wrap:anywhere] text-xs font-bold text-[var(--color-text)]">
                        {drilldownStatus.label}
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
                )}

                {!detailSnapshot && drilldownStatus.mode === "sampling" && (
                  <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                    <Activity className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                    Sampling host
                  </div>
                )}
                {(!detailSnapshot || snapshot.isError) &&
                  !detailSnapshot &&
                  drilldownStatus.mode !== "sampling" && (
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
                {(detailSnapshot || legacyMetrics.data) && (
                  <HostResourceGlance
                    metrics={legacyMetrics.data}
                    snapshot={detailSnapshot}
                    pinnedMount={uiConfig.hostResourcePinnedMount}
                    metricsStale={legacyMetrics.isStale}
                    metricsError={legacyMetrics.isError}
                  />
                )}
                <div className="mt-3">
                  <HostIdleSuspendStatus
                    onForceSleep={handleOpenForceSleep}
                    owner={detailOwner}
                  />
                </div>
                {detailSnapshot && (
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
                        snapshot={detailSnapshot}
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
            )}
          </div>
        </section>
      )}
      {forceSleepStatus && (
        <ForceSleepDialog
          open={forceSleepOpen}
          onOpenChange={(isOpen) => {
            if (!isOpen) handleCloseForceSleep();
          }}
          initialStatus={forceSleepStatus}
          owner={detailOwner}
          endpointLabel={forceSleepEndpointLabel}
        />
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

function formatFleetTriggerLabel(summary: HostResourceFleetSummary): string {
  const parts: string[] = [
    `${summary.connectedCount} of ${summary.watchedCount} watched host${summary.watchedCount === 1 ? "" : "s"} connected`,
  ];
  if (summary.attentionCount > 0) {
    parts.push(
      `${summary.attentionCount} need${summary.attentionCount === 1 ? "s" : ""} attention`,
    );
  }
  if (summary.unreadCount > 0) {
    parts.push(`${summary.unreadCount} unread`);
  }
  return parts.join("; ");
}
