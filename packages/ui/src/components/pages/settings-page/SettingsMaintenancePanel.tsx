import { AlertTriangle } from "lucide-react";
import { DiagnosticsExportButton } from "@/components/organisms/DiagnosticsExportButton.js";
import {
  SettingsActionRow,
  SettingsStatusMessage,
} from "./SettingsActionRow.js";
import type { DiagnosticsExportScopeContext } from "@/lib/diagnostics-export.js";

interface SettingsMaintenancePanelProps {
  diagnosticsScope: DiagnosticsExportScopeContext;
  onClearCache: () => void;
  clearCachePending: boolean;
  clearMsg: string | null;
  clearErr: string | null;
  onResetWorkspace: () => void;
  resetPending: boolean;
  resetErr: string | null;
}

export function SettingsMaintenancePanel({
  diagnosticsScope,
  onClearCache,
  clearCachePending,
  clearMsg,
  clearErr,
  onResetWorkspace,
  resetPending,
  resetErr,
}: SettingsMaintenancePanelProps) {
  return (
    <div className="divide-y divide-[var(--color-border)]">
      <SettingsActionRow
        title="Revalidate Cache"
        description="Clear all cached query data so every panel refetches fresh data from disk. Useful after external changes."
        status={
          <>
            {clearMsg && (
              <SettingsStatusMessage tone="success">
                ✓ {clearMsg}
              </SettingsStatusMessage>
            )}
            {clearErr && (
              <SettingsStatusMessage tone="danger">
                ✗ {clearErr}
              </SettingsStatusMessage>
            )}
          </>
        }
        action={
          <button
            type="button"
            className="btn-bracket"
            onClick={onClearCache}
            disabled={clearCachePending}
          >
            {clearCachePending ? "Clearing…" : "Revalidate"}
          </button>
        }
      />

      <SettingsActionRow
        title="Export Diagnostics"
        description="Download a scoped local JSON bundle. Use the page header to choose a short window and keep noisy data down."
        action={
          <DiagnosticsExportButton
            className="justify-start sm:justify-end"
            terminalIds={[]}
            scope={diagnosticsScope}
          />
        }
      />

      <SettingsActionRow
        title="Nuclear Reset"
        description="Kill all terminal sessions, clear cached state, and return to workspace selection. This cannot be undone."
        danger
        status={
          resetErr ? (
            <SettingsStatusMessage tone="danger">
              ✗ {resetErr}
            </SettingsStatusMessage>
          ) : null
        }
        action={
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-[var(--color-danger)] bg-transparent px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-danger)] transition-all duration-150 hover:bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={onResetWorkspace}
            disabled={resetPending}
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {resetPending ? "Resetting…" : "Nuclear Reset"}
          </button>
        }
      />
    </div>
  );
}
