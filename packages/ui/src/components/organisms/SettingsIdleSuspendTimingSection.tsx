import { useState } from "react";
import { Button } from "@/components/atoms/Button.js";
import { useIdleSuspendStatus, useUpdateIdleSuspendTiming } from "@/api/queries.js";
import {
  SettingsActionRow,
  SettingsStatusMessage,
} from "@/components/pages/settings-page/SettingsActionRow.js";
import { ApiRequestError } from "@/api/client.js";

export function SettingsIdleSuspendTimingSection() {
  const { data: status, isLoading, isError } = useIdleSuspendStatus();
  const updateTiming = useUpdateIdleSuspendTiming();

  const [quietInput, setQuietInput] = useState<string | null>(null);
  const [wakeInput, setWakeInput] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (isLoading) {
    return <div className="py-4 text-xs text-[var(--color-text-muted)]">Loading idle suspend configuration…</div>;
  }
  if (isError || !status) {
    return <div className="py-4 text-xs text-[var(--color-danger)]">Failed to load idle suspend status. Check server connection.</div>;
  }

  const effectiveQuiet = quietInput ?? String(status.quietPeriodSeconds);
  const effectiveWake = wakeInput ?? String(status.wakeAfterSeconds);

  const quietNum = parseInt(effectiveQuiet, 10);
  const wakeNum = parseInt(effectiveWake, 10);
  const isQuietValid = !isNaN(quietNum) && quietNum >= status.minQuietPeriodSeconds && quietNum <= status.maxQuietPeriodSeconds;
  const isWakeValid = !isNaN(wakeNum) && wakeNum >= status.minWakeAfterSeconds && wakeNum <= status.maxWakeAfterSeconds;
  const isSamePair = quietNum === status.quietPeriodSeconds && wakeNum === status.wakeAfterSeconds;
  const isHandedOff = status.state === "handedOff";
  const canMutate = status.timingMutable && !isHandedOff;
  const isPending = updateTiming.isPending;
  const canSave = isQuietValid && isWakeValid && !isSamePair && canMutate && !isPending;

  async function handleSave() {
    if (!canSave) return;
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      const resp = await updateTiming.mutateAsync({
        quietPeriodSeconds: quietNum,
        wakeAfterSeconds: wakeNum,
      });
      setQuietInput(null);
      setWakeInput(null);
      setSuccessMsg(
        resp.changed
          ? `Timing updated to ${resp.quietPeriodSeconds}s quiet / ${resp.wakeAfterSeconds}s wake (rev ${resp.statusRevision}).`
          : "Timing unchanged (values already active).",
      );
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.code === "idleSuspendHandoffInProgress" || err.status === 409) {
          setErrorMsg("Host suspend handoff is currently in progress. Updates blocked until resume.");
          return;
        }
        if (err.code === "idleSuspendTimingDisabledNoAuth") {
          setErrorMsg("Timing mutation is disabled in --no-auth development mode.");
          return;
        }
        if (err.code === "actorDisabled") {
          setErrorMsg("Your account is disabled. Mutation not permitted.");
          return;
        }
        setErrorMsg(err.message || "Failed to update idle suspend timing.");
      } else {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    }
  }

  const inputClass = "w-28 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-right text-xs font-mono text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50";

  return (
    <div className="space-y-4">
      {isHandedOff && (
        <div role="alert" className="rounded border border-[var(--color-warning)] bg-[var(--color-warning)]/10 px-3 py-2 text-xs text-[var(--color-warning)]">
          Host suspend handoff is in progress. Timing updates are blocked until resume reconciliation.
        </div>
      )}
      {!status.enabled && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Idle suspend is disabled at startup (capability: {status.capabilityCode}). Configured timing values can still be saved by authenticated operators.
        </p>
      )}
      <SettingsActionRow
        title="Quiet Period (seconds)"
        description={`Quiet duration with zero managed PTYs before suspend arms. Bounds: ${status.minQuietPeriodSeconds}s – ${status.maxQuietPeriodSeconds}s.`}
        action={
          <input
            type="number"
            aria-label="Quiet period in seconds"
            min={status.minQuietPeriodSeconds}
            max={status.maxQuietPeriodSeconds}
            value={effectiveQuiet}
            disabled={!canMutate || isPending}
            onChange={(e) => setQuietInput(e.target.value)}
            className={inputClass}
          />
        }
      />
      <SettingsActionRow
        title="Wake Duration (seconds)"
        description={`Scheduled RTC wake timer duration after entering suspend. Bounds: ${status.minWakeAfterSeconds}s – ${status.maxWakeAfterSeconds}s.`}
        action={
          <input
            type="number"
            aria-label="Wake duration in seconds"
            min={status.minWakeAfterSeconds}
            max={status.maxWakeAfterSeconds}
            value={effectiveWake}
            disabled={!canMutate || isPending}
            onChange={(e) => setWakeInput(e.target.value)}
            className={inputClass}
          />
        }
      />
      <div className="flex items-center justify-between pt-2">
        <div className="flex-1 pr-4">
          {successMsg && <SettingsStatusMessage tone="success">{successMsg}</SettingsStatusMessage>}
          {errorMsg && <SettingsStatusMessage tone="danger">{errorMsg}</SettingsStatusMessage>}
          {!isQuietValid && effectiveQuiet !== "" && (
            <SettingsStatusMessage tone="danger">
              Quiet period must be between {status.minQuietPeriodSeconds} and {status.maxQuietPeriodSeconds}s.
            </SettingsStatusMessage>
          )}
          {!isWakeValid && effectiveWake !== "" && (
            <SettingsStatusMessage tone="danger">
              Wake duration must be between {status.minWakeAfterSeconds} and {status.maxWakeAfterSeconds}s.
            </SettingsStatusMessage>
          )}
        </div>
        <Button type="button" onClick={() => void handleSave()} disabled={!canSave} aria-busy={isPending} className="shrink-0">
          {isPending ? "Saving…" : "Save Timing"}
        </Button>
      </div>
    </div>
  );
}
