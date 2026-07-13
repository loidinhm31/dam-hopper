import {
  SettingsActionRow,
  SettingsStatusMessage,
} from "./SettingsActionRow.js";

interface SettingsImportExportPanelProps {
  onExport: () => void;
  exportPending: boolean;
  exportMsg: string | null;
  exportErr: string | null;
  onImport: () => void;
  importPending: boolean;
  importMsg: string | null;
  importErr: string | null;
}

export function SettingsImportExportPanel({
  onExport,
  exportPending,
  exportMsg,
  exportErr,
  onImport,
  importPending,
  importMsg,
  importErr,
}: SettingsImportExportPanelProps) {
  return (
    <div className="divide-y divide-[var(--color-border)]">
      <SettingsActionRow
        title="Export Settings"
        description={
          <>
            Save a copy of the current{" "}
            <code className="text-[var(--color-primary)]">dam-hopper.toml</code>{" "}
            to a chosen location. Preserves all formatting and comments.
          </>
        }
        status={
          <>
            {exportMsg && (
              <SettingsStatusMessage tone="success">
                ✓ {exportMsg}
              </SettingsStatusMessage>
            )}
            {exportErr && (
              <SettingsStatusMessage tone="danger">
                ✗ {exportErr}
              </SettingsStatusMessage>
            )}
          </>
        }
        action={
          <button
            type="button"
            className="btn-bracket"
            onClick={onExport}
            disabled={exportPending}
          >
            {exportPending ? "Exporting…" : "Export"}
          </button>
        }
      />

      <SettingsActionRow
        title="Import Settings"
        description={
          <>
            Replace the current workspace config with a{" "}
            <code className="text-[var(--color-primary)]">.toml</code> file. The
            file is validated before being written.
          </>
        }
        status={
          <>
            {importMsg && (
              <SettingsStatusMessage tone="success">
                ✓ {importMsg}
              </SettingsStatusMessage>
            )}
            {importErr && (
              <SettingsStatusMessage tone="danger">
                ✗ {importErr}
              </SettingsStatusMessage>
            )}
          </>
        }
        action={
          <button
            type="button"
            className="btn-bracket"
            onClick={onImport}
            disabled={importPending}
          >
            {importPending ? "Importing…" : "Import"}
          </button>
        }
      />
    </div>
  );
}
