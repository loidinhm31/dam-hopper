import {
  useState,
  useEffect,
  type ReactElement,
} from "react";
import type { ConnectionSnapshot } from "@/api/connections.js";
import { getApi } from "@/api/connections.js";
import type { OsDesktop, OsWindow } from "../types.js";
import type { LaunchRecordV1, RecipeV1 } from "./types.js";
import {
  preflightRecipeLaunch,
  executeRecipeLaunch,
  type RecipePreflightResult,
} from "./recipe-engine.js";
import {
  createLaunchRecord,
  getLaunchRecord,
  loadAllLaunchRecords,
  lockedDismissLaunchStep,
  lockedReconcileOutcomeUnknownStep,
  lockedRetryFailedStep,
  persistLaunchRecord,
  withRecipeLaunchLock,
} from "./launch-records.js";
import { dispatchIntent, createIntent } from "../intents.js";
import { useWindowStore } from "../window-store.js";
import { useAgentStatusStore } from "@/stores/agent-status.js";
export interface LaunchReviewProps {
  recipe: RecipeV1;
  activeDesktop: OsDesktop;
  connections: ReadonlyMap<string, ConnectionSnapshot>;
  windows: Record<string, OsWindow>;
  onClose: () => void;
}

export function LaunchReview({
  recipe,
  activeDesktop,
  connections,
  windows,
  onClose,
}: LaunchReviewProps): ReactElement {
  const switchDesktop = useWindowStore((state) => state.switchDesktop);
  const focusWindow = useWindowStore((state) => state.focusWindow);

  const connSnapshot = connections.get(recipe.profileId);
  const agentProfile = useAgentStatusStore(
    (state) => state.profiles.get(recipe.profileId),
  );
  const isAgentStatusCurrent =
    connSnapshot?.status === "connected" &&
    agentProfile &&
    agentProfile.owner.generation === connSnapshot.owner.generation &&
    agentProfile.availability === "ready" &&
    typeof agentProfile.epoch === "number";

  const realServerEpoch = isAgentStatusCurrent ? String(agentProfile.epoch) : null;

  const [consentedMoves, setConsentedMoves] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [activeRecord, setActiveRecord] = useState<LaunchRecordV1 | null>(() => {
    const all = loadAllLaunchRecords();
    const match = Object.values(all)
      .filter(
        (r) =>
          r.recipeId === recipe.id &&
          r.desktopId === activeDesktop.id &&
          r.profileId === recipe.profileId,
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return match ?? null;
  });

  // Preflight launch with real authoritative serverEpoch
  const preflight: RecipePreflightResult = preflightRecipeLaunch({
    recipe,
    connections,
    existingWindows: windows,
    targetDesktopId: activeDesktop.id,
    capturedServerEpoch: realServerEpoch,
  });

  const hasUnknown = Object.values(activeRecord?.steps ?? {}).some(
    (s) => s.status === "outcomeUnknown",
  );
  // Reconcile unknown steps
  // Reconcile unknown steps under Web Lock with live session list
  const handleReconcileUnknown = async (stepKey: string) => {
    if (!activeRecord) return;
    setLaunchError(null);
    try {
      const conn = connections.get(recipe.profileId);
      if (!conn || conn.status !== "connected") {
        throw new Error(`Host profile "${recipe.profileId}" is disconnected`);
      }
      const apiClient = getApi(conn.owner);
      const liveSessions = await apiClient.terminal.listDetailed().catch(() => []);
      const hostContext = {
        currentServerEpoch: preflight.serverEpoch,
        aliveSessionsOnHost: liveSessions,
      };
      const res = await lockedReconcileOutcomeUnknownStep(
        activeRecord.launchId,
        stepKey,
        hostContext,
      );
      setActiveRecord(res.record);
      if (!res.reconciled) {
        setLaunchError(res.message);
      }
    } catch (err) {
      setLaunchError((err as Error).message);
    }
  };

  // Dismiss unknown step under Web Lock
  const handleDismissStep = async (stepKey: string) => {
    if (!activeRecord) return;
    try {
      const updated = await lockedDismissLaunchStep(activeRecord.launchId, stepKey);
      setActiveRecord(updated);
    } catch (err) {
      setLaunchError((err as Error).message);
    }
  };

  // Retry failed step under Web Lock
  const handleRetryFailed = async (stepKey: string) => {
    if (!activeRecord) return;
    try {
      const updated = await lockedRetryFailedStep(activeRecord.launchId, stepKey);
      setActiveRecord(updated);
      await handleStartLaunch(false);
    } catch (err) {
      setLaunchError((err as Error).message);
    }
  };

  // Launch execution
  const handleStartLaunch = async (isNewRun = false) => {
    setLaunchError(null);
    setIsLaunching(true);

    try {
      const conn = connections.get(recipe.profileId);
      if (!conn || conn.status !== "connected") {
        throw new Error(`Host profile "${recipe.profileId}" is disconnected`);
      }

      if (isNewRun && hasUnknown) {
        throw new Error(
          "Cannot start a new run while active run has unresolved blocked steps",
        );
      }

      let targetRecord = activeRecord;
      if (!targetRecord || isNewRun) {
        targetRecord = createLaunchRecord({
          recipe,
          desktopId: activeDesktop.id,
          serverEpoch: preflight.serverEpoch,
        });
        persistLaunchRecord(targetRecord);
        setActiveRecord(targetRecord);
      }

      const apiClient = getApi(conn.owner);
      const executed = await executeRecipeLaunch({
        launchId: targetRecord.launchId,
        apiClient,
        preflight,
        userConsentedMoves: consentedMoves || preflight.movesNeeded.length === 0,
      });

      setActiveRecord(executed);
    } catch (err) {
      setLaunchError((err as Error).message);
    } finally {
      setIsLaunching(false);
    }
  };

  // Jump to terminal
  const handleFocusTerminal = (termId: string) => {
    dispatchIntent(
      createIntent("terminal:focus", {
        profileId: recipe.profileId,
        terminalId: termId,
      }),
    );
  };

  return (
    <div
      data-testid="recipe-launch-review"
      className="flex flex-col h-full w-full overflow-hidden bg-[var(--color-surface)] text-[var(--color-text)] text-xs"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-[var(--color-primary)]">
            🚀 Launch Recipe: {recipe.name}
          </span>
          <span className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
            {recipe.profileId} • {recipe.project}
          </span>
        </div>

        <button
          type="button"
          data-testid="recipe-launch-close-btn"
          onClick={onClose}
          className="px-2.5 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-xs"
        >
          Close
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 max-w-2xl">
        {/* Preflight Blockers */}
        {!preflight.canLaunch && (
          <div
            data-testid="recipe-preflight-blockers"
            className="p-3 rounded border border-red-500/40 bg-red-500/10 text-red-500 text-xs flex flex-col gap-1"
          >
            <span className="font-bold">Cannot launch recipe — preflight blockers:</span>
            <ul className="list-disc pl-4">
              {preflight.blockers.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Singleton Instance Moves Consent Dialog */}
        {preflight.movesNeeded.length > 0 && (
          <div
            data-testid="recipe-move-consent-card"
            className="p-3 rounded border border-amber-500/40 bg-amber-500/10 flex flex-col gap-2"
          >
            <span className="font-bold text-amber-500 text-xs">
              ⚠ Singleton Window Move Required
            </span>
            <span className="text-[var(--color-text-muted)]">
              The following application instance already exists on another desktop and will be
              moved to this desktop ({activeDesktop.name}):
            </span>
            <div className="flex flex-col gap-1">
              {preflight.movesNeeded.map((m) => (
                <div
                  key={m.windowId}
                  className="p-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-between text-xs"
                >
                  <span className="font-semibold">{m.title}</span>
                  <span className="font-mono text-[10px] text-[var(--color-text-muted)]">
                    Move from {m.fromDesktopId} ➔ {m.toDesktopId}
                  </span>
                </div>
              ))}
            </div>

            <label className="flex items-center gap-2 pt-1 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                data-testid="recipe-consent-moves-checkbox"
                checked={consentedMoves}
                onChange={(e) => setConsentedMoves(e.target.checked)}
                className="rounded text-[var(--color-primary)]"
              />
              <span className="font-medium">
                I consent to moving these existing window instances across desktops
              </span>
            </label>
          </div>
        )}

        {/* Launch Error */}
        {launchError && (
          <div
            data-testid="recipe-launch-error"
            className="p-2.5 rounded border border-red-500/30 bg-red-500/10 text-red-500 text-xs"
          >
            {launchError}
          </div>
        )}

        {/* Steps Review List */}
        <div className="flex flex-col gap-2">
          <span className="font-semibold text-xs text-[var(--color-text-muted)]">
            Execution Steps ({recipe.terminalSteps.length} Terminals, {recipe.appSteps.length}{" "}
            Apps):
          </span>

          <div className="flex flex-col gap-2">
            {recipe.terminalSteps.map((step) => {
              const stepRecord = activeRecord?.steps[step.key];
              const status = stepRecord?.status ?? "pending";
              const isUnknown = status === "outcomeUnknown";
              const isConfirmed = status === "confirmed";

              return (
                <div
                  key={step.key}
                  data-testid={`recipe-step-card-${step.key}`}
                  className={`p-3 rounded border flex flex-col gap-2 bg-[var(--color-bg)] ${
                    isUnknown
                      ? "border-amber-500/60 bg-amber-500/5"
                      : isConfirmed
                        ? "border-emerald-500/50"
                        : "border-[var(--color-border)]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs flex items-center gap-1.5">
                      {">_"} {step.name}
                    </span>
                    <span
                      data-testid={`recipe-step-status-${step.key}`}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                        status === "confirmed"
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                          : status === "dispatched"
                            ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                            : status === "outcomeUnknown"
                              ? "bg-amber-500/20 text-amber-500 border border-amber-500/40"
                              : status === "failed"
                                ? "bg-red-500/20 text-red-400 border border-red-500/30"
                                : "bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)]"
                      }`}
                    >
                      {status}
                    </span>
                  </div>

                  <div className="p-1.5 rounded bg-[var(--color-surface)] font-mono text-[11px] text-[var(--color-text-muted)]">
                    $ {step.command}
                  </div>

                  {/* Outcome Unknown Blocked Controls */}
                  {isUnknown && (
                    <div
                      data-testid={`recipe-unknown-banner-${step.key}`}
                      className="p-2.5 rounded bg-amber-500/10 border border-amber-500/30 flex flex-col gap-2"
                    >
                      <span className="font-bold text-amber-500 text-xs">
                        ⏸ Blocked: Outcome Unknown
                      </span>
                      <span className="text-[11px] text-[var(--color-text-muted)]">
                        Terminal creation was dispatched to host, but network response was lost or
                        interrupted. Server reserves incarnation before slow spawn; the process may
                        still be spawning. Relaunching another session is prohibited to prevent
                        duplicate processes.
                      </span>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          data-testid={`recipe-reconcile-btn-${step.key}`}
                          onClick={() => handleReconcileUnknown(step.key)}
                          className="px-2 py-1 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-xs"
                        >
                          Check Status
                        </button>

                        <button
                          type="button"
                          data-testid={`recipe-dismiss-btn-${step.key}`}
                          onClick={() => handleDismissStep(step.key)}
                          className="px-2 py-1 rounded bg-amber-500/20 text-amber-500 hover:bg-amber-500/30 border border-amber-500/40 text-xs"
                        >
                          Dismiss Step (No Relaunch)
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Failed Step Retry Actions */}
                  {status === "failed" && (
                    <div className="flex items-center justify-between p-2 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                      <span>Failed: {stepRecord?.error ?? "Creation error"}</span>
                      <button
                        type="button"
                        data-testid={`recipe-retry-btn-${step.key}`}
                        onClick={() => handleRetryFailed(step.key)}
                        className="px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 text-white font-medium"
                      >
                        Retry (Fresh ID)
                      </button>
                    </div>
                  )}

                  {/* Confirmed alive actions */}
                  {isConfirmed && stepRecord?.terminalId && (
                    <div className="flex items-center justify-end gap-2 pt-1 border-t border-[var(--color-border)]/50">
                      <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                        Incarnation: {stepRecord.incarnation ?? 1}
                      </span>
                      <button
                        type="button"
                        data-testid={`recipe-focus-terminal-btn-${step.key}`}
                        onClick={() => handleFocusTerminal(stepRecord.terminalId!)}
                        className="px-2 py-0.5 rounded bg-[var(--color-primary)] text-white text-[11px] font-medium"
                      >
                        Focus Terminal
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Action Button */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--color-border)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-xs font-medium"
          >
            Cancel
          </button>
          {activeRecord && (
            <button
              type="button"
              data-testid="recipe-new-run-btn"
              disabled={isLaunching || hasUnknown}
              onClick={() => handleStartLaunch(true)}
              className="px-3 py-1.5 rounded bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-xs font-medium"
            >
              Start New Run
            </button>
          )}
          <button
            type="button"
            data-testid="recipe-start-launch-btn"
            disabled={
              !preflight.canLaunch ||
              isLaunching ||
              hasUnknown ||
              (preflight.movesNeeded.length > 0 && !consentedMoves)
            }
            onClick={() => handleStartLaunch(false)}
            className="px-4 py-1.5 rounded bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50 font-medium text-xs transition-opacity flex items-center gap-1.5"
          >
            {isLaunching
              ? "Launching..."
              : activeRecord
                ? "Resume / Execute Run"
                : "Execute Launch"}
          </button>
        </div>
      </div>
    </div>
  );
}
