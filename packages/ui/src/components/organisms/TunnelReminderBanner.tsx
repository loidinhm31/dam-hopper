import { useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, X } from "lucide-react";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import {
  useTunnelReminders,
  type DueTunnelReminder,
} from "@/hooks/use-tunnel-reminders.js";

export function TunnelReminderBanner(): React.JSX.Element | null {
  const cognitoActive = useCognitoModeStore((state) => state.active);
  const { reminders, stopTunnel, dismissReminder } = useTunnelReminders();

  const [stoppingIds, setStoppingIds] = useState<Record<string, true>>({});
  const [stopErrors, setStopErrors] = useState<Record<string, string>>({});

  if (cognitoActive || reminders.length === 0) {
    return null;
  }

  async function handleStop(reminder: DueTunnelReminder) {
    const key = `${reminder.profileId}:${reminder.capturedOwner.generation}:${reminder.tunnelId}`;
    setStoppingIds((prev) => ({ ...prev, [key]: true }));
    setStopErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

    try {
      await stopTunnel(reminder);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to stop tunnel";
      setStopErrors((prev) => ({ ...prev, [key]: message }));
    } finally {
      setStoppingIds((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  return (
    <aside
      role="region"
      aria-label="Public tunnel exposure reminders"
      className="flex max-h-[40%] shrink-0 flex-col gap-1 overflow-y-auto border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200"
    >
      {reminders.map((reminder) => {
        const itemKey = `${reminder.profileId}:${reminder.capturedOwner.generation}:${reminder.tunnelId}`;
        const isStopping = Boolean(stoppingIds[itemKey]);
        const stopError = stopErrors[itemKey];

        return (
          <div
            key={itemKey}
            role="alert"
            aria-live="polite"
            data-testid={`tunnel-reminder-${reminder.profileId}-${reminder.tunnelId}`}
            className="flex flex-col gap-2 rounded bg-amber-500/5 p-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-2.5 min-w-0 flex-1">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5 font-medium">
                  <span className="rounded bg-amber-500/25 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-amber-300 uppercase">
                    3-Hour Reminder
                  </span>
                  <span className="min-w-0 break-all rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                    Profile: {reminder.profileId}
                  </span>
                  <span className="font-mono text-amber-300">
                    :{reminder.port}
                  </span>
                  {reminder.url ? (
                    <a
                      href={reminder.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={reminder.url}
                      className="inline-flex min-w-0 max-w-full items-center gap-1 break-all font-mono text-sky-400 underline hover:no-underline"
                    >
                      <span className="min-w-0 break-all">{reminder.url.replace(/^https?:\/\//, "")}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  ) : null}
                </div>
                <p className="text-[11px] text-amber-300/90 leading-relaxed">
                  Running for at least 3 hours. Forwarding stays enabled while
                  the origin is offline. Any service binding port {reminder.port}{" "}
                  remains public until you stop the tunnel.
                </p>
                {stopError ? (
                  <div className="flex items-center gap-2 text-[11px] text-red-400">
                    <span>{stopError}</span>
                    <button
                      type="button"
                      disabled={isStopping}
                      onClick={() => void handleStop(reminder)}
                      className="font-semibold underline hover:no-underline text-red-300"
                    >
                      Retry Stop
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
              <button
                type="button"
                disabled={isStopping}
                onClick={() => void handleStop(reminder)}
                className="inline-flex items-center gap-1 rounded bg-red-600/90 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-red-600 disabled:opacity-50"
              >
                {isStopping ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Stopping…
                  </>
                ) : (
                  "Stop Tunnel"
                )}
              </button>
              <button
                type="button"
                onClick={() => dismissReminder(reminder)}
                title="Dismiss reminder in this browser session"
                aria-label={`Dismiss reminder for port ${reminder.port}`}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-amber-300/80 hover:bg-amber-500/20 hover:text-amber-200 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                Dismiss
              </button>
            </div>
          </div>
        );
      })}
    </aside>
  );
}
