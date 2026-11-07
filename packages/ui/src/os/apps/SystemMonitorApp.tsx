import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  FolderGit2,
  Moon,
  RefreshCw,
  RotateCw,
  Search,
  Server,
  ShieldAlert,
  Square,
  Terminal,
  Wrench,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import type { OsWindow } from "../types.js";
import { useWindowStore } from "../window-store.js";
import { dispatchIntent, createIntent } from "../intents.js";
import { useMultiHostResources } from "@/hooks/use-multi-host-resources.js";
import { useAggregatedProjects } from "@/hooks/use-aggregated-projects.js";
import {
  useAggregatedTerminalSessions,
  type AggregatedSessionInfo,
} from "@/hooks/use-aggregated-terminal-sessions.js";
import {
  useHostMetrics,
  useHostResourceSnapshot,
  useHostResourceAlerts,
  useGlobalConfig,
  useUpdateUiConfig,
} from "@/api/queries.js";
import { getConnectionSnapshot, getApi, isCurrentConnection } from "@/api/connections.js";
import {
  terminalTargetKey,
  type TerminalTarget,
  type TerminationOrigin,
  type TerminationState,
} from "@/api/terminal-session-contract.js";
import { requestGuardedTermination } from "@/lib/terminal-session-actions.js";
import {
  terminalActionCoordinator,
  useAllTerminalActions,
} from "@/lib/terminal-session-action-coordinator.js";
import { profileQueryKey } from "@/api/query-client.js";
import { logger } from "@dam-hopper/shared/logger";
import { useHostResourceAlertPresentationStore } from "@/hooks/use-host-resource-alert-presentation.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { HostResourceFleetDeck } from "@/components/organisms/HostResourceFleetDeck.js";
import { HostResourceGlance } from "@/components/organisms/HostResourceGlance.js";
import { HostResourceDiagnosis } from "@/components/organisms/HostResourceDiagnosis.js";
import { HostIdleSuspendStatus } from "@/components/organisms/HostIdleSuspendStatus.js";
import { ForceSleepDialog } from "@/components/organisms/ForceSleepDialog.js";
import { DiagnosticsExportButton } from "@/components/organisms/DiagnosticsExportButton.js";
import {
  getSessionStatus,
  getStatusDotColor,
  getStatusGlowClass,
} from "@/lib/session-status.js";

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  command: Terminal,
  service: Activity,
  terminal: Terminal,
  shell: Terminal,
  custom: Wrench,
};

function formatUptime(startedAt: number): string {
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

export interface SessionRowProps {
  session: SessionInfo & { profileName?: string; profileId?: string };
  onNavigate: (id: string, profileId?: string) => void;
  onKill: (id: string, profileId?: string) => void;
  isKillDisabled?: boolean;
}

export function SessionRow({
  session,
  onNavigate,
  onKill,
  isKillDisabled = false,
}: SessionRowProps) {
  const Icon = TYPE_ICON[session.type] ?? Terminal;
  const status = getSessionStatus(session);
  const dotColor = getStatusDotColor(status);
  const glowClass = getStatusGlowClass(status);

  const statusTooltip = (() => {
    if (status === "alive") return "Running";
    if (status === "restarting") {
      const restartInSec = session.restartInMs
        ? Math.round(session.restartInMs / 1000)
        : 0;
      return `Restarting in ${restartInSec}s`;
    }
    if (status === "crashed")
      return `Crashed (exit code ${session.exitCode ?? "?"})`;
    return `Exited (code ${session.exitCode ?? 0})`;
  })();

  const showRestartBadge = (session.restartCount ?? 0) > 0;

  return (
    <li
      role="button"
      tabIndex={0}
      className="flex items-center gap-3 px-3 py-2 rounded cursor-pointer hover:bg-[var(--color-surface-2)] transition-colors group"
      onClick={() => onNavigate(session.id, session.profileId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onNavigate(session.id, session.profileId);
      }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]/60" />
      {session.profileName && (
        <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-[var(--color-surface)] text-[var(--color-text-muted)] truncate max-w-[20%]">
          {session.profileName}
        </span>
      )}
      <span className="text-xs font-medium text-[var(--color-text)] truncate shrink-0 max-w-[25%]">
        {session.project}
      </span>
      <span className="text-xs text-[var(--color-text-muted)] truncate flex-1 min-w-0">
        {session.name ?? session.command}
      </span>
      <span className="text-[10px] text-[var(--color-text-muted)]/60 tabular-nums shrink-0">
        {formatUptime(session.startedAt)}
      </span>
      {showRestartBadge && (
        <span
          className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] bg-yellow-500/10 text-yellow-500 shrink-0"
          title={`Restarted ${session.restartCount} time(s)`}
        >
          <RotateCw className="h-2.5 w-2.5" />
          {session.restartCount}
        </span>
      )}
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor} ${glowClass} shrink-0`}
        title={statusTooltip}
      />
      <button
        type="button"
        disabled={isKillDisabled}
        className={`shrink-0 transition-opacity p-0.5 rounded ${
          isKillDisabled
            ? "opacity-40 cursor-not-allowed text-[var(--color-text-muted)]"
            : "opacity-0 group-hover:opacity-100 hover:bg-[var(--color-danger)]/20 text-[var(--color-danger)]/60 hover:text-[var(--color-danger)]"
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onKill(session.id, session.profileId);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onKill(session.id, session.profileId);
          }
        }}
        title="Kill session"
      >
        <Square className="h-3 w-3" />
      </button>
    </li>
  );
}
import { withUiConfigDefaults } from "@/lib/ui-config.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/Dialog.js";
import type { IdleSuspendStatusV1, SessionInfo } from "@/api/client.js";
import type { ConnectionRef } from "@/api/ownership.js";

export interface SystemMonitorAppProps {
  window: OsWindow;
}

interface ConfirmKillTarget {
  sessionId: string;
  sessionName: string;
  command: string;
  profileId: string;
  profileName: string;
  generation?: number;
  incarnation?: number | string;
  target?: TerminalTarget | null;
  origin?: TerminationOrigin;
}

function isProjectClean(project: unknown): boolean {
  if (project && typeof project === "object" && "status" in project) {
    const status = project.status;
    if (status && typeof status === "object" && "isClean" in status) {
      return status.isClean === true;
    }
  }
  return false;
}

function isProjectDirty(project: unknown): boolean {
  if (project && typeof project === "object" && "status" in project) {
    const status = project.status;
    if (status && typeof status === "object" && "isClean" in status) {
      return status.isClean === false;
    }
  }
  return false;
}

export function SystemMonitorApp({ window }: SystemMonitorAppProps) {
  const qc = useQueryClient();
  const cognitoActive = useCognitoModeStore((state) => state.active);
  const multiResources = useMultiHostResources({ enabled: true });
  const { allProjects } = useAggregatedProjects();
  const { sessions: aggregatedSessions = [], observations = [], isLoading: sessionsLoading } =
    useAggregatedTerminalSessions();

  // Selected profile filter for drilldown: persisted in appState
  const persistedProfileId = (window.appState?.inspectedProfileId as string | undefined) ?? null;
  const [inspectedProfileId, setInspectedProfileId] = useState<string | null>(persistedProfileId);

  // Sync prop changes from intents (e.g., monitor:alert)
  useEffect(() => {
    if (window.appState?.inspectedProfileId !== undefined) {
      setInspectedProfileId(window.appState.inspectedProfileId as string | null);
    }
  }, [window.appState?.inspectedProfileId]);

  const selectedIncidentId = (window.appState?.selectedIncidentId as string | undefined) ?? null;

  const handleSelectProfile = useCallback(
    (profileId: string | null) => {
      setInspectedProfileId(profileId);
      useWindowStore.getState().updateAppState(window.id, {
        inspectedProfileId: profileId,
        selectedIncidentId: null,
      });
    },
    [window.id],
  );

  const handleAcknowledgeAlert = useCallback(() => {
    if (inspectedProfileId) {
      useHostResourceAlertPresentationStore.getState().markRead(inspectedProfileId);
      useWindowStore.getState().updateAppState(window.id, {
        selectedIncidentId: null,
      });
    }
  }, [inspectedProfileId, window.id]);

  // Session filtering
  const [sessionProfileFilter, setSessionProfileFilter] = useState<string>("all");
  const [sessionTypeFilter, setSessionTypeFilter] = useState<string>("all");
  const [sessionSearch, setSessionSearch] = useState<string>("");

  // Confirmation state for process kill
  const [confirmKill, setConfirmKill] = useState<ConfirmKillTarget | null>(null);
  const [killError, setKillError] = useState<string | null>(null);
  const [killPending, setKillPending] = useState(false);
  const retainedActions = useAllTerminalActions();
  const promptTokenRef = useRef(0);

  const targetKey = terminalTargetKey;
  useEffect(() => {
    terminalActionCoordinator.reconcileWithObservations(observations);
  }, [observations]);

  // Force sleep dialog state with frozen owner target
  const [forceSleepOpen, setForceSleepOpen] = useState(false);
  const [forceSleepTarget, setForceSleepTarget] = useState<{
    status: IdleSuspendStatusV1;
    owner: ConnectionRef;
  } | null>(null);

  // Determine target entry for drilldown
  const selectedEntry = useMemo(() => {
    if (!inspectedProfileId) return null;
    return multiResources.entries.find((e) => e.profile.id === inspectedProfileId) ?? null;
  }, [inspectedProfileId, multiResources.entries]);

  const isSelectedConnected = selectedEntry ? selectedEntry.connected : false;
  const isSelectedStale = isSelectedConnected ? (selectedEntry?.isStale ?? false) : false;

  // Host detail telemetry and storage config hooks for selected profile
  const hostSnapshot = useHostResourceSnapshot(
    Boolean(selectedEntry && isSelectedConnected),
    selectedEntry?.owner,
  );
  const hostMetrics = useHostMetrics(
    Boolean(selectedEntry && isSelectedConnected),
    selectedEntry?.owner,
  );
  const hostAlerts = useHostResourceAlerts(
    Boolean(selectedEntry && isSelectedConnected),
    20,
    selectedEntry?.owner,
  );

  const { data: globalConfig } = useGlobalConfig(selectedEntry?.owner);
  const updateUiConfig = useUpdateUiConfig(selectedEntry?.owner);
  const uiConfig = withUiConfigDefaults(globalConfig?.ui);

  // Project statistics
  const totalProjects = allProjects.length;
  const cleanProjects = allProjects.filter((p) => isProjectClean(p.project)).length;
  const dirtyProjects = allProjects.filter((p) => isProjectDirty(p.project)).length;

  // Filtered session list across fleet
  const filteredSessions = useMemo(() => {
    return aggregatedSessions.filter((s) => {
      if (sessionProfileFilter !== "all" && s.profileId && s.profileId !== sessionProfileFilter) {
        return false;
      }
      if (sessionTypeFilter !== "all" && s.type !== sessionTypeFilter) {
        return false;
      }
      if (sessionSearch.trim()) {
        const query = sessionSearch.toLowerCase();
        const matchesName = (s.name ?? "").toLowerCase().includes(query);
        const matchesCmd = (s.command ?? "").toLowerCase().includes(query);
        const matchesProject = (s.project ?? "").toLowerCase().includes(query);
        if (!matchesName && !matchesCmd && !matchesProject) return false;
      }
      return true;
    });
  }, [aggregatedSessions, sessionProfileFilter, sessionTypeFilter, sessionSearch]);

  const aliveSessions = useMemo(() => filteredSessions.filter((s) => s.alive), [filteredSessions]);

  const aliveTerminalOptions = useMemo(
    () =>
      aliveSessions.map((session, idx) => ({
        id: `${session.profileId}:${session.id}`,
        label: cognitoActive
          ? `Terminal ${idx + 1}`
          : session.name ?? `${session.project ?? "free"} · ${session.command}`,
      })),
    [aliveSessions, cognitoActive],
  );

  // Jump to terminal session via exact placement intent
  const handleNavigateToSession = useCallback(
    (sessionId: string, profileId?: string) => {
      const targetProfileId = profileId ?? inspectedProfileId ?? "default";
      const session = aggregatedSessions.find(
        (s) => s.id === sessionId && (!profileId || s.profileId === profileId),
      );

      if (session && session.terminationTarget) {
        void dispatchIntent(
          createIntent(
            "terminal:place-existing",
            {
              sourceHubWindowId: window.id,
              target: session.terminationTarget,
              action: "focus-existing",
            },
            window.id,
          ),
        );
      } else {
        void dispatchIntent(
          createIntent(
            "terminal:focus",
            {
              profileId: targetProfileId,
              terminalId: sessionId,
            },
            window.id,
          ),
        );
      }
    },
    [aggregatedSessions, inspectedProfileId, window.id],
  );

  // Request kill with displayed session snapshot and guarded termination target
  const handleRequestKill = useCallback(
    (sessionId: string, profileId?: string) => {
      const session = aggregatedSessions.find(
        (s) => s.id === sessionId && (!profileId || s.profileId === profileId),
      );
      if (!session) return;
      const targetProfile = session.profileId;
      const snapshot = getConnectionSnapshot(targetProfile);

      if (!session.terminationTarget) {
        promptTokenRef.current++;
        if (session.incarnation === undefined && !session.incarnationExact) {
          setKillError("Cannot terminate process: session incarnation is unavailable.");
        } else {
          setKillError(
            "Cannot terminate session: server does not support guarded termination protocol. Upgrade server to DamHopper Termination Protocol v1.",
          );
        }
        setConfirmKill({
          sessionId,
          sessionName: session.name ?? session.command ?? sessionId,
          command: session.command ?? "",
          profileId: targetProfile,
          profileName: session.profileId,
          generation: snapshot?.owner.generation,
          incarnation: session.incarnationExact ?? session.incarnation,
          target: null,
        });
        return;
      }

      promptTokenRef.current++;
      const existingAction = retainedActions.get(terminalTargetKey(session.terminationTarget));
      if (existingAction?.status === "refused") {
        setKillError(`Termination refused (${existingAction.error.code}): ${existingAction.error.error}`);
      } else if (existingAction?.status === "failed") {
        setKillError(`Termination failed (${existingAction.error.category}): ${existingAction.error.message}`);
      } else if (existingAction?.status === "outcomeUnknown") {
        setKillError(
          `Termination outcome unknown (${existingAction.error?.category ?? "network"}). Retained pending observation.`,
        );
      } else {
        setKillError(null);
      }

      const origin: TerminationOrigin =
        session.terminationState === "restartPending" && !session.alive
          ? "restartPending"
          : "live";

      setConfirmKill({
        sessionId,
        sessionName: session.name ?? session.command ?? sessionId,
        command: session.command ?? "",
        profileId: targetProfile,
        profileName: session.profileId,
        generation: session.terminationTarget.generation,
        incarnation: session.terminationTarget.incarnation,
        target: session.terminationTarget,
        origin,
      });
    },
    [aggregatedSessions],
  );

  // Execute confirmed kill using guarded termination protocol
  const handleConfirmKill = useCallback(async () => {
    if (!confirmKill || !confirmKill.target) return;
    const reservation = terminalActionCoordinator.reserveDispatch(
      confirmKill.target,
      confirmKill.origin ?? "live",
    );
    if (!reservation.allowed) {
      return;
    }
    const attemptToken = reservation.attemptToken;
    setKillPending(true);
    setKillError(null);

    try {
      const currentSnap = getConnectionSnapshot(confirmKill.profileId);
      if (!currentSnap || currentSnap.status !== "connected") {
        const failedState: TerminationState = {
          status: "failed",
          target: confirmKill.target,
          origin: confirmKill.origin ?? "live",
          error: {
            category: "abort" as const,
            message: `Target profile '${confirmKill.profileName}' is disconnected. Kill aborted to prevent orphan action.`,
          },
        };
        terminalActionCoordinator.recordOutcome(confirmKill.target, failedState, attemptToken);
        setKillError(failedState.error.message);
        return;
      }

      const checkCurrent = () =>
        isCurrentConnection({
          profileId: confirmKill.target!.profileId,
          generation: confirmKill.target!.generation,
        });

      if (!checkCurrent()) {
        const failedState: TerminationState = {
          status: "failed",
          target: confirmKill.target,
          origin: confirmKill.origin ?? "live",
          error: {
            category: "abort" as const,
            message: `Connection generation changed for '${confirmKill.profileName}'. Session may have been replaced or reconnected. Kill aborted.`,
          },
        };
        terminalActionCoordinator.recordOutcome(confirmKill.target, failedState, attemptToken);
        setKillError(failedState.error.message);
        return;
      }

      // Currency check: verify process incarnation has not changed in aggregated sessions
      const latestSession = aggregatedSessions.find(
        (s) => s.id === confirmKill.sessionId && s.profileId === confirmKill.profileId,
      );
      if (
        latestSession &&
        confirmKill.incarnation !== undefined &&
        latestSession.incarnation !== undefined &&
        String(latestSession.incarnationExact ?? latestSession.incarnation) !==
          String(confirmKill.incarnation)
      ) {
        setKillError(
          "Process incarnation changed before confirmation. Session may have restarted or been replaced. Kill aborted.",
        );
        return;
      }

      const client = getApi(currentSnap.owner);
      const result = await requestGuardedTermination(
        confirmKill.target,
        confirmKill.origin ?? "live",
        client,
        checkCurrent,
      );

      terminalActionCoordinator.recordOutcome(confirmKill.target, result, attemptToken);

      if (result.status === "refused") {
        setKillError(`Termination refused (${result.error.code}): ${result.error.error}`);
        return;
      }
      if (result.status === "failed") {
        setKillError(`Termination failed (${result.error.category}): ${result.error.message}`);
        return;
      }
      if (result.status === "outcomeUnknown") {
        setKillError(
          `Termination outcome unknown (${result.error?.category ?? "network"}). Retained pending observation.`,
        );
        return;
      }

      const ownerKey = profileQueryKey(currentSnap.owner, "terminal-sessions");
      void qc.invalidateQueries({ queryKey: ownerKey });
      void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
      setConfirmKill(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("SystemMonitorApp", "Process kill rejected or failed", { error: err });
      setKillError(msg);
    } finally {
      setKillPending(false);
    }
  }, [confirmKill, qc, aggregatedSessions]);

  return (
    <div
      data-os-system-monitor={window.id}
      data-testid={`system-monitor-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none text-xs"
    >
      {/* Top App Header / Fleet Deck Navigation */}
      <div className="p-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] shrink-0 space-y-3">
        {/* Statistics & Overview ribbon */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <span className="font-bold tracking-wider text-[var(--color-primary)] font-mono text-sm flex items-center gap-1.5">
              <Activity className="h-4 w-4" />
              SYSTEM MONITOR
            </span>

            {/* Quick Fleet Summary Badges */}
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[11px] font-mono">
                {cognitoActive ? "●●●" : `${totalProjects} Projects (${cleanProjects} clean)`}
              </span>
              <span className="px-2 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[11px] font-mono">
                {cognitoActive ? "●●●" : `${aliveSessions.length} Active PTYs`}
              </span>
              <span className="px-2 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[11px] font-mono text-[var(--color-text-muted)]">
                {multiResources.configuredProfileCount} Configured Profiles
              </span>
            </div>
          </div>

          {/* Actions & Diagnostics */}
          <div className="flex items-center gap-2">
            <DiagnosticsExportButton
              compact
              terminalIds={aliveSessions.map((session) => session.id)}
              terminalOptions={aliveTerminalOptions}
              defaultTerminalLabel="All active terminals"
              scope={{
                page: "system-monitor",
                route: "/os",
                terminalIds: aliveSessions.map((session) => session.id),
                frontendScopes: ["SystemMonitorApp", "system-monitor"],
              }}
            />
          </div>
        </div>

        {/* Fleet Deck */}
        <HostResourceFleetDeck
          entries={multiResources.entries}
          selectedProfileId={inspectedProfileId ?? undefined}
          onInspect={(profileId) => handleSelectProfile(profileId)}
          onSelectAll={() => handleSelectProfile(null)}
          layout="horizontal"
        />
      </div>

      {/* Main Two-Column View */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[var(--color-border)] overflow-y-auto">
        {/* Left Column: Host Telemetry & Diagnosis Drilldown */}
        <div className="flex flex-col min-h-0 p-4 overflow-y-auto space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5" />
              {inspectedProfileId ? (
                <>Host Telemetry & Pressure ({cognitoActive ? "Protected" : selectedEntry?.profile.name ?? inspectedProfileId})</>
              ) : (
                <>Fleet Telemetry Overview</>
              )}
            </h2>
            {inspectedProfileId && (
              <button
                type="button"
                onClick={() => handleSelectProfile(null)}
                className="text-[11px] text-[var(--color-primary)] hover:underline flex items-center gap-0.5"
              >
                <span>View All Fleet</span>
              </button>
            )}
          </div>

          {/* Drilldown Body */}
          {!inspectedProfileId ? (
            <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed border-[var(--color-border)] rounded-lg text-[var(--color-text-muted)] space-y-2">
              <Server className="h-8 w-8 text-[var(--color-text-muted)]/50" />
              <p className="text-xs font-medium">Select a host from the Fleet Deck above to inspect telemetry, memory pressure, and idle status.</p>
              <p className="text-[11px] text-[var(--color-text-muted)]/70">Metrics stream directly from the shared coordinator with zero duplicate leases.</p>
            </div>
          ) : !selectedEntry ? (
            <div className="p-4 rounded-lg bg-[var(--color-surface-2)] text-[var(--color-text-muted)] text-center">
              Selected profile '{cognitoActive ? "Protected" : inspectedProfileId}' not found in active fleet.
            </div>
          ) : !isSelectedConnected ? (
            <div className="p-4 rounded-lg border border-yellow-500/20 bg-yellow-500/5 text-yellow-500 space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                Host is Disconnected / Offline
              </div>
              <p className="text-[11px] text-[var(--color-text-muted)]">
                Live metrics and pressure diagnosis are unavailable while the host is disconnected. Existing terminals remain preserved on the server if running in background.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Target Incident Revealed Banner */}
              {selectedIncidentId && (
                <div
                  data-testid="highlighted-incident-banner"
                  className="p-2.5 rounded border border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-xs text-[var(--color-text)] flex items-center justify-between"
                >
                  <span className="font-semibold flex items-center gap-1.5 text-[var(--color-primary)]">
                    <AlertTriangle className="h-4 w-4" />
                    Inspecting Incident: {selectedIncidentId}
                  </span>
                  <button
                    type="button"
                    onClick={handleAcknowledgeAlert}
                    className="px-2 py-0.5 rounded bg-[var(--color-primary)] text-white text-[10px] font-medium hover:bg-[var(--color-primary)]/90"
                  >
                    Acknowledge Alert
                  </button>
                </div>
              )}

              {/* Honest Connection Status Banner */}
              <div className="flex items-center justify-between px-3 py-1.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[11px]">
                <span className="flex items-center gap-1.5 font-mono">
                  <span
                    className={`h-2 w-2 rounded-full ${isSelectedStale ? "bg-yellow-500" : "bg-emerald-500"}`}
                  />
                  <span>
                    Status: {selectedEntry.status?.label ?? (isSelectedStale ? "SSE Stale (Fallback)" : "SSE Live Streaming")}
                  </span>
                </span>
                <span className="text-[var(--color-text-muted)]">
                  Gen: {selectedEntry.owner.generation}
                </span>
              </div>

              {/* Host Resource Glance */}
              <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Resource Glance
                </h3>
                <HostResourceGlance
                  metrics={hostMetrics.data}
                  snapshot={hostSnapshot.data}
                  pinnedMount={uiConfig.hostResourcePinnedMount}
                  metricsStale={isSelectedStale}
                  metricsError={hostMetrics.isError}
                />
              </div>

              {/* Host Resource Diagnosis */}
              {hostSnapshot.data && (
                <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                      Pressure Diagnosis & Incidents
                    </h3>
                    {selectedIncidentId && (
                      <button
                        type="button"
                        onClick={handleAcknowledgeAlert}
                        className="px-2 py-0.5 rounded bg-[var(--color-primary)]/20 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/30 text-[10px] font-medium"
                      >
                        Acknowledge Alert
                      </button>
                    )}
                  </div>
                  <HostResourceDiagnosis
                    snapshot={hostSnapshot.data}
                    alerts={hostAlerts.data ?? []}
                    legacyMetrics={hostMetrics.data ?? undefined}
                    pinnedMount={uiConfig.hostResourcePinnedMount}
                    onPin={(mount) => updateUiConfig.mutate({ hostResourcePinnedMount: mount })}
                    isPinPending={updateUiConfig.isPending}
                    pinError={updateUiConfig.error instanceof Error ? updateUiConfig.error : null}
                    highlightIncidentId={selectedIncidentId}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Active Terminal Sessions + Idle Suspend Controls */}
        <div className="flex flex-col min-h-0 divide-y divide-[var(--color-border)] overflow-y-auto">
          {/* Active Terminal Sessions (Top Half) */}
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] pb-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5" />
                Active Terminal Sessions ({filteredSessions.length})
              </h2>

              {/* Filters */}
              <div className="flex items-center gap-1.5">
                {multiResources.configuredProfileCount > 1 && (
                  <Select
                    value={sessionProfileFilter}
                    onValueChange={(val) => setSessionProfileFilter(val)}
                  >
                    <SelectTrigger
                      aria-label="Filter sessions by profile"
                      className="h-6 w-auto min-w-[100px] rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] text-[var(--color-text)]"
                    >
                      <SelectValue placeholder="All Profiles" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">All Profiles</SelectItem>
                      {multiResources.entries.map((e, idx) => (
                        <SelectItem key={e.profile.id} value={e.profile.id} className="text-xs">
                          {cognitoActive ? `Profile ${idx + 1}` : e.profile.name ?? e.profile.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {(["all", "terminal", "build", "run"] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSessionTypeFilter(type)}
                    className={`px-2 py-0.5 rounded text-[10px] capitalize transition-colors ${
                      sessionTypeFilter === type
                        ? "bg-[var(--color-primary)]/20 text-[var(--color-primary)] font-semibold"
                        : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
              <input
                type="text"
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                placeholder="Filter sessions by command, project or name…"
                className="w-full pl-8 pr-3 py-1 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/50 focus:outline-none focus:border-[var(--color-primary)]"
              />
            </div>

            {/* Sessions List */}
            {sessionsLoading ? (
              <div className="p-4 text-center text-[var(--color-text-muted)]">
                Loading terminal sessions…
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="p-6 text-center text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-md">
                No active terminal sessions matching criteria.
              </div>
            ) : (
              <ul role="list" className="space-y-1 max-h-[360px] overflow-y-auto">
                {filteredSessions.map((session) => {
                  const displaySession = cognitoActive
                    ? {
                        ...session,
                        project: "protected-proj",
                        command: "protected-cmd",
                        name: "protected-session",
                        profileName: "Protected",
                      }
                    : session;
                  const actionState = session.terminationTarget
                    ? retainedActions.get(targetKey(session.terminationTarget))
                    : null;
                  const isKillDisabled = Boolean(
                    actionState &&
                      (actionState.status === "dispatching" ||
                        actionState.status === "terminationRequested" ||
                        actionState.status === "outcomeUnknown"),
                  );
                  return (
                    <SessionRow
                      key={`${session.profileId}:${session.id}`}
                      session={displaySession}
                      isKillDisabled={isKillDisabled}
                      onNavigate={(id, profileId) => handleNavigateToSession(id, profileId)}
                      onKill={(id, profileId) => handleRequestKill(id, profileId)}
                    />
                  );
                })}
              </ul>
            )}
          </div>

          {/* Idle Suspend & Host Controls (Bottom Half) */}
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] flex items-center gap-1.5">
                <Moon className="h-3.5 w-3.5" />
                Idle Suspend & System Controls
              </h2>
            </div>

            {inspectedProfileId && selectedEntry ? (
              <HostIdleSuspendStatus
                owner={selectedEntry.owner}
                onForceSleep={(status) => {
                  setForceSleepTarget({ status, owner: selectedEntry.owner });
                  setForceSleepOpen(true);
                }}
              />
            ) : (
              <div className="p-3 text-center text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded text-[11px]">
                Select a specific profile from the fleet above to view host sleep inhibitor status and configure idle suspend timing.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Dialog for Process Kill using standard Dialog primitive */}
      {confirmKill && (
        <Dialog open={true} onOpenChange={(open) => !open && !killPending && setConfirmKill(null)}>
          <DialogContent
            aria-labelledby="confirm-kill-title"
            data-os-modal="true"
            onKeyDown={(e) => e.stopPropagation()}
            className="sm:max-w-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)]"
          >
            <DialogHeader>
              <DialogTitle id="confirm-kill-title" className="text-[var(--color-danger)] flex items-center gap-1.5 text-sm font-bold">
                <AlertTriangle className="h-4 w-4" />
                Confirm Process Kill
              </DialogTitle>
            </DialogHeader>

            <p className="text-xs text-[var(--color-text)]">
              Are you sure you want to terminate the terminal session below?
            </p>

            <div className="rounded bg-[var(--color-surface-2)] p-2.5 font-mono text-[11px] space-y-1">
              <div>
                <span className="text-[var(--color-text-muted)]">Profile: </span>
                <span className="font-semibold text-[var(--color-text)]">
                  {cognitoActive ? "Protected" : confirmKill.profileName}
                </span>
              </div>
              <div>
                <span className="text-[var(--color-text-muted)]">Session: </span>
                <span className="text-[var(--color-text)]">
                  {cognitoActive ? "Protected" : confirmKill.sessionName}
                </span>
              </div>
              {!cognitoActive && confirmKill.command && (
                <div>
                  <span className="text-[var(--color-text-muted)]">Command: </span>
                  <span className="text-[var(--color-text)] truncate">{confirmKill.command}</span>
                </div>
              )}
              {confirmKill.incarnation !== undefined && (
                <div>
                  <span className="text-[var(--color-text-muted)]">Incarnation: </span>
                  <span className="text-[var(--color-text)]">{confirmKill.incarnation}</span>
                </div>
              )}
            </div>

            {killError && (
              <div className="p-2 rounded bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 text-[var(--color-danger)] text-[11px]">
                {cognitoActive ? "Process termination failed. Action aborted." : killError}
              </div>
            )}

            <DialogFooter className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmKill(null)}
                disabled={killPending}
                className="px-3 py-1.5 rounded border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] transition-colors text-xs"
              >
                Cancel
              </button>
              {(() => {
                const actionState = confirmKill.target
                  ? retainedActions.get(targetKey(confirmKill.target))
                  : null;
                const isUnresolved = Boolean(
                  actionState &&
                    (actionState.status === "dispatching" ||
                      actionState.status === "terminationRequested" ||
                      actionState.status === "outcomeUnknown"),
                );
                return (
                  <button
                    type="button"
                    onClick={handleConfirmKill}
                    disabled={killPending || !confirmKill.target || isUnresolved}
                    className="px-3 py-1.5 rounded bg-[var(--color-danger)] hover:bg-[var(--color-danger)]/90 text-white font-medium transition-colors flex items-center gap-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {killPending && <RefreshCw className="h-3 w-3 animate-spin" />}
                    <span>Kill Session</span>
                  </button>
                );
              })()}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Force Sleep Dialog */}
      {forceSleepOpen && forceSleepTarget && (
        <ForceSleepDialog
          open={forceSleepOpen}
          onOpenChange={setForceSleepOpen}
          initialStatus={forceSleepTarget.status}
          owner={forceSleepTarget.owner}
        />
      )}
    </div>
  );
}
