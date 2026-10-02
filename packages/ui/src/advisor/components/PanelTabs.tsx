/**
 * PanelTabs component.
 *
 * Local panel navigation tabs with roving focus index.
 * Does not write or listen to window.location.hash.
 * Does not intercept Escape key (passes through to host).
 */

import { useRef, useCallback, type FC, type KeyboardEvent } from 'react';
import type { AdvisorView } from '../app-state-types.js';

export const ADVISOR_VIEWS: readonly AdvisorView[] = Object.freeze([
  'overview',
  'history',
  'configuration',
  'evaluations',
]);

export interface PanelTabsProps {
  readonly activeView: AdvisorView;
  readonly onSelectView: (view: AdvisorView) => void;
  readonly counts?: {
    readonly historyRecords?: number;
    readonly evaluationDocs?: number;
  };
}

const TAB_LABELS: Record<AdvisorView, string> = {
  overview: 'Overview',
  history: 'History Records',
  configuration: 'Configuration',
  evaluations: 'Evaluations',
};

export function getNextRovingView(currentView: AdvisorView, key: string): AdvisorView | null {
  // Invariant: Do NOT intercept Escape — host panel needs it for close/dismiss
  if (key === 'Escape') return null;
  const idx = ADVISOR_VIEWS.indexOf(currentView);
  if (idx === -1) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return ADVISOR_VIEWS[(idx + 1) % ADVISOR_VIEWS.length];
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return ADVISOR_VIEWS[(idx - 1 + ADVISOR_VIEWS.length) % ADVISOR_VIEWS.length];
  }
  if (key === 'Home') {
    return ADVISOR_VIEWS[0];
  }
  if (key === 'End') {
    return ADVISOR_VIEWS[ADVISOR_VIEWS.length - 1];
  }
  return null;
}

export const PanelTabs: FC<PanelTabsProps> = ({
  activeView,
  onSelectView,
  counts,
}) => {
  const tabRefs = useRef<Record<AdvisorView, HTMLButtonElement | null>>({
    overview: null,
    history: null,
    configuration: null,
    evaluations: null,
  });

  const activateTab = useCallback(
    (view: AdvisorView) => {
      onSelectView(view);
      const target = tabRefs.current[view];
      if (target) {
        target.focus();
        target.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      }
    },
    [onSelectView],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, currentView: AdvisorView) => {
      const nextView = getNextRovingView(currentView, e.key);
      if (nextView !== null) {
        e.preventDefault();
        activateTab(nextView);
      }
    },
    [activateTab],
  );

  return (
    <nav className="hash-tabs-nav" aria-label="Advisor views">
      <ul className="hash-tabs-list" role="tablist">
        {ADVISOR_VIEWS.map((view) => {
          const isActive = view === activeView;
          const label = TAB_LABELS[view];
          let badge: number | null = null;
          if (view === 'history' && counts?.historyRecords !== undefined) {
            badge = counts.historyRecords;
          } else if (view === 'evaluations' && counts?.evaluationDocs !== undefined) {
            badge = counts.evaluationDocs;
          }

          return (
            <li key={view} className="hash-tab-item" role="presentation">
              <button
                type="button"
                ref={(el) => {
                  tabRefs.current[view] = el;
                }}
                role="tab"
                id={`tab-${view}`}
                tabIndex={isActive ? 0 : -1}
                aria-selected={isActive}
                aria-controls={`panel-${view}`}
                className={`hash-tab-link ${isActive ? 'active' : ''}`}
                onClick={() => activateTab(view)}
                onKeyDown={(e) => handleKeyDown(e, view)}
              >
                <span className="tab-label">{label}</span>
                {badge !== null && <span className="tab-badge">{badge}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
