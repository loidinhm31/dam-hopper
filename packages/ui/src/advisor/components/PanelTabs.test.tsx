// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelTabs, getNextRovingView } from './PanelTabs.js';
import type { AdvisorView } from '../app-state-types.js';

describe('PanelTabs', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  function renderTabs(
    activeView: AdvisorView = 'overview',
    onSelectView = vi.fn(),
    counts?: { historyRecords?: number; evaluationDocs?: number },
  ) {
    act(() => {
      root?.render(
        <PanelTabs
          activeView={activeView}
          onSelectView={onSelectView}
          counts={counts}
        />,
      );
    });
  }

  it('renders all 4 tabs with proper roles and labels', () => {
    renderTabs('overview');
    const tabs = container?.querySelectorAll<HTMLButtonElement>('[role=tab]');
    expect(tabs).toHaveLength(4);

    const labels = Array.from(tabs ?? []).map((t) => t.textContent?.trim());
    expect(labels).toContain('Overview');
    expect(labels).toContain('History Records');
    expect(labels).toContain('Configuration');
    expect(labels).toContain('Evaluations');
  });

  it('displays badge counts for history and evaluations when present', () => {
    renderTabs('overview', vi.fn(), { historyRecords: 42, evaluationDocs: 7 });
    const historyBadge = container?.querySelector('#tab-history .tab-badge');
    const evalBadge = container?.querySelector('#tab-evaluations .tab-badge');

    expect(historyBadge?.textContent).toBe('42');
    expect(evalBadge?.textContent).toBe('7');
  });

  it('sets aria-selected and tabIndex correctly on active vs inactive tabs', () => {
    renderTabs('history');
    const historyTab = container?.querySelector<HTMLButtonElement>('#tab-history');
    const overviewTab = container?.querySelector<HTMLButtonElement>('#tab-overview');

    expect(historyTab?.getAttribute('aria-selected')).toBe('true');
    expect(historyTab?.getAttribute('tabindex')).toBe('0');
    expect(historyTab?.classList.contains('active')).toBe(true);

    expect(overviewTab?.getAttribute('aria-selected')).toBe('false');
    expect(overviewTab?.getAttribute('tabindex')).toBe('-1');
    expect(overviewTab?.classList.contains('active')).toBe(false);
  });

  it('calls onSelectView when clicked without modifying window.location.hash', () => {
    const onSelect = vi.fn();
    window.location.hash = '';
    renderTabs('overview', onSelect);

    const configTab = container?.querySelector<HTMLButtonElement>('#tab-configuration');
    act(() => {
      configTab?.click();
    });

    expect(onSelect).toHaveBeenCalledWith('configuration');
    expect(window.location.hash).toBe('');
  });

  it('supports roving focus navigation via arrow keys, Home, and End', () => {
    const onSelect = vi.fn();
    renderTabs('overview', onSelect);

    const overviewTab = container?.querySelector<HTMLButtonElement>('#tab-overview');
    overviewTab?.focus();

    // ArrowRight -> history
    act(() => {
      overviewTab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith('history');

    // End -> evaluations
    act(() => {
      overviewTab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith('evaluations');

    // Home -> overview
    act(() => {
      overviewTab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith('overview');

    // Escape does not trigger onSelectView
    onSelect.mockClear();
    act(() => {
      overviewTab?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('getNextRovingView returns null for Escape', () => {
    expect(getNextRovingView('overview', 'Escape')).toBeNull();
    expect(getNextRovingView('history', 'ArrowRight')).toBe('configuration');
    expect(getNextRovingView('overview', 'ArrowLeft')).toBe('evaluations');
    expect(getNextRovingView('configuration', 'Home')).toBe('overview');
    expect(getNextRovingView('overview', 'End')).toBe('evaluations');
  });
});
