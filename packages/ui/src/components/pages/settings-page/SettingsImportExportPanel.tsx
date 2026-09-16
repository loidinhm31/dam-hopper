import { useRef, type ChangeEvent } from "react";
import {
  SettingsActionRow,
  SettingsStatusMessage,
} from "./SettingsActionRow.js";

interface SettingsImportExportPanelProps {
  onExport: () => void;
  exportPending: boolean;
  exportMsg: string | null;
  exportErr: string | null;
  onImportFile: (file: File) => void;
  importPending: boolean;
  importMsg: string | null;
  importErr: string | null;
}

export function SettingsImportExportPanel({
  onExport,
  exportPending,
  exportMsg,
  exportErr,
  onImportFile,
  importPending,
  importMsg,
  importErr,
}: SettingsImportExportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) {
      onImportFile(file);
    }
  }
  return (
    <div className="divide-y divide-[var(--color-border)]">
      <SettingsActionRow
        title="Export Settings"
        description={
          <>
            Download the active workspace{" "}
            <code className="text-[var(--color-primary)]">dam-hopper.toml</code>.
            Preserves all formatting and comments.
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
            Replace the active workspace configuration with a{" "}
            <code className="text-[var(--color-primary)]">.toml</code> file.
            Validates syntax, schema, and paths before writing; creates an automatic backup.
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
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".toml"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={handleFileChange}
            />
            <button
              type="button"
              className="btn-bracket"
              onClick={handleImportClick}
              disabled={importPending}
            >
              {importPending ? "Importing…" : "Import"}
            </button>
          </>
        }
      />
    </div>
  );
}
