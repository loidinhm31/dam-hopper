/**
 * StatusBanner component.
 *
 * Displays native Advisor availability, scan progress, warnings, and source errors
 * (such as final-root symlink rejection), without plugin isolation banners.
 */

import type { FC } from 'react';
import type { ViewerStatus } from '../app-state-types.js';
import type { HistoryScanSummaryDto } from '../advisor-types.js';

export interface StatusBannerProps {
  readonly status: ViewerStatus;
  readonly staleReason: string | null;
  readonly unsupportedReason: string | null;
  readonly scan: HistoryScanSummaryDto | null;
  readonly scannedAt?: number | null;
  readonly sourceError?: string | null;
  readonly sourcePath?: string | null;
}

export const StatusBanner: FC<StatusBannerProps> = ({
  status,
  staleReason,
  unsupportedReason,
  scan,
  scannedAt,
  sourceError,
}) => {
  return (
    <aside className={`status-banner status-${status}`} role="status" aria-label="System status">
      <div className="status-main">
        {sourceError && (
          <div className="status-message status-error">
            <strong>Source Unavailable:</strong> {sourceError}
          </div>
        )}

        {status === 'unsupported' && (
          <div className="status-message status-error">
            <strong>Unsupported Configuration:</strong>{' '}
            {unsupportedReason ?? 'The advisor history layout is incompatible with this server.'}
          </div>
        )}

        {status === 'revoked' && (
          <div className="status-message status-error">
            <strong>Context Revoked:</strong>{' '}
            {staleReason ?? 'Host or session authorization revoked. Prior data cleared.'}
          </div>
        )}

        {status === 'idle' && !sourceError && (
          <div className="status-message status-info">
            <strong>No history snapshot loaded.</strong> Click &ldquo;Refresh History&rdquo; to scan records.
          </div>
        )}

        {status === 'selecting' && (
          <div className="status-message status-info">
            <strong>Connecting to workspace source...</strong>
          </div>
        )}

        {status === 'scanning' && (
          <div className="status-message status-pending">
            <strong>Scanning history records...</strong> Please wait while records are parsed and validated.
          </div>
        )}

        {status === 'fresh' && (
          <div className="status-message status-success">
            {scan?.status === 'incomplete' || scan?.limitHit ? (
              <>
                <strong className="status-badge-inline badge-warning">Incomplete Snapshot</strong> — Limit reached; scanned {scan?.acceptedRecords ?? 0} records
                {scannedAt ? ` at ${new Date(scannedAt).toLocaleTimeString()}` : ''}.
              </>
            ) : scan?.status === 'complete_with_errors' ? (
              <>
                <strong>Fresh Snapshot (With Warnings)</strong> — Scanned {scan?.acceptedRecords ?? 0} records
                {scannedAt ? ` at ${new Date(scannedAt).toLocaleTimeString()}` : ''}.
              </>
            ) : (
              <>
                <strong>Fresh Snapshot</strong> — Scanned {scan?.acceptedRecords ?? 0} records
                {scannedAt ? ` at ${new Date(scannedAt).toLocaleTimeString()}` : ''}.
              </>
            )}
            {scan && scan.diagnostics.length > 0 && (
              <span className="status-warning-inline">
                {' '}
                ({scan.diagnostics.length} diagnostics
                {scan.suppressedDiagnostics > 0 ? `, ${scan.suppressedDiagnostics} suppressed` : ''})
              </span>
            )}
          </div>
        )}

        {status === 'stale' && (
          <div className="status-message status-warning">
            <strong>Stale Data Retained:</strong>{' '}
            {staleReason ?? 'Prior snapshot retained due to scan interruption.'}
            {scannedAt && (
              <span className="status-timestamp text-muted">
                {' '}
                (Observed: {new Date(scannedAt).toLocaleTimeString()})
              </span>
            )}
            {scan && (
              <span className="status-counts">
                {' '}
                (Discovered: {scan.consultationsDiscovered} consultations, {scan.diagnostics.length} diagnostics)
              </span>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
