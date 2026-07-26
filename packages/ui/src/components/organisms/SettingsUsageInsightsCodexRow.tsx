import { AlertTriangle, Settings2 } from "lucide-react";
import { Button } from "@/components/atoms/Button.js";
import { SettingsActionRow } from "@/components/pages/settings-page/SettingsActionRow.js";
import type { UsageSetupStatus } from "@/api/client.js";

interface SettingsUsageInsightsCodexRowProps {
  settings: UsageSetupStatus;
  pending: boolean;
  collectorError: string | null;
  collectorUnavailable: boolean;
  focusClass: string;
  onConfigureCodex: (enabled: boolean) => void;
  onRetryCollector: () => void;
}

export function SettingsUsageInsightsCodexRow({
  settings,
  pending,
  collectorError,
  collectorUnavailable,
  focusClass,
  onConfigureCodex,
  onRetryCollector,
}: SettingsUsageInsightsCodexRowProps) {
  const codexStatus = settings.collectorSetup.codexExporter;
  const description =
    codexStatus === "managed"
      ? "Codex usage export is managed locally. User prompts are redacted and no extra model usage is created."
      : codexStatus === "conflict"
        ? "Codex already has export configuration that DamHopper will not replace."
        : "Optionally include local Codex token usage. User prompts are redacted and this does not make extra model requests.";

  return (
    <SettingsActionRow
      title="Codex usage (optional)"
      description={description}
      status={
        <div className="space-y-1" aria-live="polite">
          {codexStatus === "managed" && (
            <p className="text-[var(--color-success)]">Managed locally.</p>
          )}
          {codexStatus === "conflict" && (
            <p className="text-[var(--color-danger)]" role="alert">
              Configuration conflict — no changes were made.
            </p>
          )}
          {collectorError ? (
            <p className="text-[var(--color-danger)]" role="alert">
              Receiver unavailable. {collectorError}
            </p>
          ) : collectorUnavailable ? (
            <p className="text-[var(--color-text-muted)]">
              Receiver unavailable. Retry the local receiver before managing
              Codex export.
            </p>
          ) : null}
          {settings.collectorSetup.restartRequired && (
            <p className="text-[var(--color-text-muted)]">
              Restart or start a new Codex session.
            </p>
          )}
        </div>
      }
      action={
        codexStatus === "conflict" ? (
          <Button type="button" size="sm" disabled className={focusClass}>
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            Conflict
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className={focusClass}
            loading={pending}
            disabled={pending || !settings.enabled}
            onClick={() =>
              collectorUnavailable
                ? onRetryCollector()
                : onConfigureCodex(codexStatus !== "managed")
            }
          >
            {collectorUnavailable ? (
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {collectorUnavailable
              ? "Retry receiver"
              : codexStatus === "managed"
                ? "Disable Codex export"
                : "Manage Codex"}
          </Button>
        )
      }
    />
  );
}
