/**
 * ActivityScopeControl component.
 *
 * Toggles between current Workspace Project scope and All History scope.
 */

import type { FC } from 'react';
import type { ActivityScope } from '../app-state-types.js';
import { formatProjectName } from '../app-state-selectors.js';

export interface ActivityScopeControlProps {
  readonly scope: ActivityScope;
  readonly projectId: string | null;
  readonly projectLabel: string | null;
  readonly isAvailable: boolean;
  readonly onScopeChange: (scope: ActivityScope) => void;
}

export const ActivityScopeControl: FC<ActivityScopeControlProps> = ({
  scope,
  projectId,
  projectLabel,
  isAvailable,
  onScopeChange,
}) => {
  const hasProject = Boolean(projectId && projectId.trim().length > 0);
  const displayLabel = hasProject
    ? formatProjectName(projectId!, projectLabel)
    : 'No Project Selected';

  return (
    <div className="activity-scope-control" role="region" aria-label="Activity Scope">
      <div className="scope-button-group" role="group" aria-label="History activity scope">
        <button
          type="button"
          className={`btn btn-scope ${scope === 'workspace-project' ? 'active btn-primary' : 'btn-secondary'}`}
          disabled={!hasProject || !isAvailable}
          onClick={() => onScopeChange('workspace-project')}
          aria-pressed={scope === 'workspace-project'}
          title={hasProject ? `Scope to workspace project (${displayLabel})` : 'No workspace project selected'}
        >
          <span className="scope-title">Workspace Project</span>
          {hasProject && (
            <span className="scope-badge" title={displayLabel}>
              ({displayLabel})
            </span>
          )}
        </button>

        <button
          type="button"
          className={`btn btn-scope ${scope === 'all' ? 'active btn-primary' : 'btn-secondary'}`}
          disabled={!isAvailable}
          onClick={() => onScopeChange('all')}
          aria-pressed={scope === 'all'}
          title="View all accessible consultation history across projects"
        >
          <span className="scope-title">All History</span>
        </button>
      </div>

      {!hasProject && scope === 'workspace-project' && (
        <div className="scope-notice text-muted" aria-live="polite">
          Please select a project in Workspace to inspect consultations, or switch to All History.
        </div>
      )}

      {!isAvailable && (
        <div className="scope-notice text-warning">
          History provider is currently unavailable.
        </div>
      )}
    </div>
  );
};
