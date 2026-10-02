/**
 * DiagnosticPanel component.
 *
 * Renders diagnostics produced during history scans.
 */

import type { FC } from 'react';
import type { HistoryDiagnosticDto, ScanDiagnostic } from '../advisor-types.js';

export type DiagnosticItem = HistoryDiagnosticDto & Partial<ScanDiagnostic> & {
  relative_path?: string;
  project_id?: string;
  bytes?: number | null;
  observed_schema_version?: number | string | null;
};

export interface DiagnosticPanelProps {
  readonly diagnostics: readonly DiagnosticItem[];
  readonly suppressedCount?: number;
}

export const DiagnosticPanel: FC<DiagnosticPanelProps> = ({
  diagnostics,
  suppressedCount = 0,
}) => {
  if (diagnostics.length === 0 && suppressedCount === 0) {
    return (
      <div className="diagnostic-panel-empty">
        <p className="text-muted">
          No scan diagnostics recorded. All scanned records conformed to schema.
        </p>
      </div>
    );
  }

  return (
    <div className="diagnostic-panel" aria-label="Scan diagnostics">
      <div className="diagnostic-header">
        <h4 className="diagnostic-title">
          Scan Diagnostics ({diagnostics.length}
          {suppressedCount > 0 ? ` + ${suppressedCount} suppressed` : ''})
        </h4>
        {suppressedCount > 0 && (
          <p className="diagnostic-warning">
            Note: {suppressedCount} additional diagnostic entries were suppressed due to budget limits.
          </p>
        )}
      </div>

      <div className="diagnostic-table-wrapper">
        <table className="diagnostic-table">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Task Run ID</th>
              <th scope="col">Consultation ID</th>
            </tr>
          </thead>
          <tbody>
            {diagnostics.map((diag, index) => (
              <tr key={`${diag.code}-${diag.consultationId ?? diag.taskRunId ?? index}`}>
                <td>
                  <code className="diagnostic-code">{diag.code}</code>
                </td>
                <td>
                  <span className="diagnostic-path">
                    {diag.taskRunId ? `${diag.taskRunId.slice(0, 8)}…` : '—'}
                  </span>
                </td>
                <td>
                  <code className="diagnostic-id">
                    {diag.consultationId ? `${diag.consultationId.slice(0, 8)}…` : '—'}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
