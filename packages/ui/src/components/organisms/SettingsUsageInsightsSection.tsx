import { useState } from "react";
import { Play, Power } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/atoms/Button.js";
import {
  useConfigureUsageInsights,
  useUsageSetupStatus,
} from "@/api/queries.js";
import { SettingsActionRow } from "@/components/pages/settings-page/SettingsActionRow.js";
import { SettingsUsageInsightsCodexRow } from "./SettingsUsageInsightsCodexRow.js";

const focusClass =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]";

function sanitizeErrorDetail(detail: string) {
  return detail
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/\S*)?/gi,
      "[local endpoint redacted]",
    );
}

export function SettingsUsageInsightsSection() {
  const { data: settings, isLoading, error } = useUsageSetupStatus();
  const configure = useConfigureUsageInsights();
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const pending = configure.isPending;
  const collectorError = settings?.runtime.collectorError;
  const terminalState = !settings?.enabled
    ? "disabled"
    : settings.paused
      ? "paused"
      : settings.runtime.active
        ? "active"
        : "unavailable";
  const collectorUnavailable = Boolean(
    settings &&
    settings.enabled &&
    settings.collectorEnabled &&
    !settings.runtime.collector.running,
  );

  async function update(
    patch: {
      enabled?: boolean;
      paused?: boolean;
      codexExporter?: boolean;
      retryCollector?: boolean;
    },
    success: string,
  ) {
    setActionError(null);
    setMessage(null);
    try {
      await configure.mutateAsync(patch);
      setMessage(success);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const safeDetail = sanitizeErrorDetail(detail);
      setActionError(
        safeDetail || "Could not update Usage insights. Try again.",
      );
    }
  }

  function configureCodex(enabled: boolean) {
    void update(
      { codexExporter: enabled },
      enabled
        ? "Codex export is managed by DamHopper."
        : "Codex export management disabled.",
    );
  }

  const terminalCopy = {
    disabled:
      "Capture is off on this machine. Enable it to collect local terminal activity.",
    paused: "Capture is paused. Existing usage data remains available.",
    active: "DamHopper ready; open a new terminal.",
    unavailable:
      "The local receiver is unavailable. It will retry while DamHopper is running.",
  }[terminalState];

  if (isLoading)
    return (
      <p className="text-xs text-[var(--color-text-muted)]" aria-live="polite">
        Checking local usage capture…
      </p>
    );

  if (error || !settings)
    return (
      <p className="text-xs text-[var(--color-danger)]" role="alert">
        Usage insights settings are unavailable right now.
      </p>
    );

  return (
    <div className="divide-y divide-[var(--color-border)]" aria-busy={pending}>
      <SettingsActionRow
        title="Terminal capture"
        description={terminalCopy}
        status={
          <div className="space-y-1" aria-live="polite">
            {pending && (
              <p className="text-[var(--color-primary)]">
                Updating local capture…
              </p>
            )}
            {!pending && terminalState === "active" && (
              <p className="text-[var(--color-success)]">
                DamHopper ready; open a new terminal.
              </p>
            )}
            {message && (
              <p className="text-[var(--color-success)]">{message}</p>
            )}
            {actionError && (
              <p className="text-[var(--color-danger)]" role="alert">
                {actionError}
              </p>
            )}
          </div>
        }
        action={
          <Button
            type="button"
            size="sm"
            variant={terminalState === "active" ? "secondary" : "primary"}
            className={focusClass}
            loading={pending}
            disabled={pending}
            onClick={() =>
              void update(
                terminalState === "active"
                  ? { enabled: false }
                  : terminalState === "paused"
                    ? { paused: false }
                    : terminalState === "unavailable"
                      ? { enabled: true, retryCollector: true }
                      : { enabled: true },
                terminalState === "active"
                  ? "Terminal capture disabled."
                  : terminalState === "paused"
                    ? "Terminal capture resumed. DamHopper ready; open a new terminal."
                    : "Terminal capture enabled. DamHopper ready; open a new terminal.",
              )
            }
          >
            {terminalState === "active" ? (
              <Power className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {pending
              ? "Updating…"
              : terminalState === "active"
                ? "Disable"
                : terminalState === "paused"
                  ? "Resume"
                  : "Enable locally"}
          </Button>
        }
      />

      <SettingsUsageInsightsCodexRow
        settings={settings}
        pending={pending}
        collectorError={collectorError ?? null}
        collectorUnavailable={collectorUnavailable}
        focusClass={focusClass}
        onConfigureCodex={configureCodex}
        onRetryCollector={() =>
          void update(
            { enabled: true, retryCollector: true },
            "Codex receiver restarted.",
          )
        }
      />

      <div className="pt-4 text-xs leading-5 text-[var(--color-text-muted)]">
        Manage retention, project exclusions, or delete collected data in{" "}
        <Link
          to="/usage"
          className={`font-medium text-[var(--color-primary)] underline underline-offset-2 ${focusClass}`}
        >
          Usage
        </Link>
        .
      </div>
    </div>
  );
}
