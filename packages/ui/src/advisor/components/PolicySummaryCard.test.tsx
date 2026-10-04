// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PolicySummaryCard } from './PolicySummaryCard.js';
import { INITIAL_STATE, type AppState } from '../app-state-types.js';
import type {
  AdvisorModelsResultDto,
  PolicyReadCurrentResultDto,
  PolicyUpdateParamsDto,
} from '../advisor-types.js';

describe('PolicySummaryCard inline editor', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  const mockOmpCatalog: AdvisorModelsResultDto = {
    backend: 'omp',
    source: 'harness',
    models: [
      { id: 'openai/gpt-4o', label: 'GPT-4o', efforts: ['low', 'medium', 'high'] },
      { id: 'anthropic/claude-3-7-sonnet', label: 'Claude 3.7 Sonnet', efforts: ['medium', 'high'] },
    ],
    efforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'medium',
    observedAt: 1000,
  };

  const mockClaudeCatalog: AdvisorModelsResultDto = {
    backend: 'claude',
    source: 'fallback',
    models: [
      { id: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet', efforts: ['low', 'medium', 'high'] },
      { id: 'claude-3-5-haiku', label: 'Claude 3.5 Haiku', efforts: ['low', 'medium'] },
    ],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'medium',
    observedAt: 1000,
  };

  const sampleState: AppState = {
    ...INITIAL_STATE,
    capabilities: ['policy.readCurrent', 'policy.update'],
    currentPolicy: {
      status: 'ready',
      scope: 'account',
      temporal: 'current',
      revision: 'a'.repeat(64),
      observedAt: 2000,
      policy: {
        version: 2,
        advisor: {
          primary: { backend: 'omp', model: 'openai/gpt-4o', effort: 'high' },
          backup: { backend: 'claude', model: 'claude-3-7-sonnet', effort: 'medium' },
        },
        wait: { mode: 'until_terminal', warnAfterMs: 5000, warnEveryMs: 2000 },
        history: { retentionDays: 30, maxBytes: 10485760 },
      },
    },
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
    container = null;
    root = null;
  });

  it('renders read-only summary initially with Edit Routing button', () => {
    act(() => {
      root?.render(<PolicySummaryCard state={sampleState} onSaveRouting={vi.fn()} />);
    });

    expect(container?.textContent).toContain('Active Owner Policy');
    expect(container?.textContent).toContain('omp / openai/gpt-4o');
    expect(container?.textContent).toContain('claude / claude-3-7-sonnet');
    expect(container?.querySelector('.edit-routing-btn')).not.toBeNull();
  });

  it('does not render Edit Routing button when policyStatus is not ready', () => {
    const unready = {
      ...sampleState,
      currentPolicy: {
        ...sampleState.currentPolicy!,
        status: 'migration_required' as const,
      },
    };

    act(() => {
      root?.render(<PolicySummaryCard state={unready} onSaveRouting={vi.fn()} />);
    });

    expect(container?.textContent).toContain('Migration Required');
    expect(container?.querySelector('.edit-routing-btn')).toBeNull();
  });

  it('opens inline editor on clicking Edit Routing and discovers catalogs', async () => {
    const onLoadRoutingModels = vi.fn().mockImplementation((backend: string) => {
      if (backend === 'omp') return Promise.resolve(mockOmpCatalog);
      if (backend === 'claude') return Promise.resolve(mockClaudeCatalog);
      return Promise.resolve(null);
    });

    act(() => {
      root?.render(
        <PolicySummaryCard
          state={sampleState}
          onLoadRoutingModels={onLoadRoutingModels}
          onSaveRouting={vi.fn()}
        />,
      );
    });

    const editBtn = container?.querySelector('.edit-routing-btn') as HTMLButtonElement;
    expect(editBtn).not.toBeNull();

    await act(async () => {
      editBtn.click();
    });

    expect(container?.querySelector('.policy-routing-editor')).not.toBeNull();
    expect(container?.querySelector('.primary-route-fieldset')).not.toBeNull();
    expect(container?.querySelector('.backup-route-fieldset')).not.toBeNull();

    // Verify catalog fetching triggered for draft backends
    expect(onLoadRoutingModels).toHaveBeenCalledWith('omp');
    expect(onLoadRoutingModels).toHaveBeenCalledWith('claude');

    // Wait for catalog options to settle
    await act(async () => {
      await Promise.resolve();
    });

    expect(container?.textContent).toContain('source: harness');
    expect(container?.textContent).toContain('source: fallback');
  });

  it('cancels editing on Cancel click and resets form', async () => {
    const onCancelRoutingEdit = vi.fn();
    act(() => {
      root?.render(
        <PolicySummaryCard
          state={sampleState}
          onSaveRouting={vi.fn()}
          onCancelRoutingEdit={onCancelRoutingEdit}
        />,
      );
    });

    const editBtn = container?.querySelector('.edit-routing-btn') as HTMLButtonElement;
    await act(async () => {
      editBtn.click();
    });

    expect(container?.querySelector('.policy-routing-editor')).not.toBeNull();

    const cancelBtn = container?.querySelector('.cancel-routing-btn') as HTMLButtonElement;
    await act(async () => {
      cancelBtn.click();
    });

    expect(container?.querySelector('.policy-routing-editor')).toBeNull();
    expect(onCancelRoutingEdit).toHaveBeenCalled();
  });

  it('disables Save Routing and displays error on duplicate route triple', async () => {
    act(() => {
      root?.render(<PolicySummaryCard state={sampleState} onSaveRouting={vi.fn()} />);
    });

    await act(async () => {
      (container?.querySelector('.edit-routing-btn') as HTMLButtonElement).click();
    });

    // Change backup backend to omp
    const backupBackend = container?.querySelector('#backup-backend') as HTMLSelectElement;
    await act(async () => {
      backupBackend.value = 'omp';
      backupBackend.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Update backup custom model input to match primary ('openai/gpt-4o')
    const backupCustomInput = container?.querySelector('#backup-custom-model') as HTMLInputElement;
    expect(backupCustomInput).not.toBeNull();
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(backupCustomInput, 'openai/gpt-4o');
      backupCustomInput.dispatchEvent(new Event('input', { bubbles: true }));
      backupCustomInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Set backup effort to high (matching primary)
    const backupEffort = container?.querySelector('#backup-effort') as HTMLSelectElement;
    await act(async () => {
      backupEffort.value = 'high';
      backupEffort.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container?.textContent).toContain('Duplicate Route Error');
    const saveBtn = container?.querySelector('.save-routing-btn') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // Changing effort to medium resolves the duplicate!
    await act(async () => {
      backupEffort.value = 'medium';
      backupEffort.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container?.textContent).not.toContain('Duplicate Route Error');
    expect(saveBtn.disabled).toBe(false);
  });

  it('handles save successfully and updates baseline view', async () => {
    const updatedPolicyResult: PolicyReadCurrentResultDto = {
      status: 'ready',
      scope: 'account',
      temporal: 'current',
      revision: 'b'.repeat(64),
      observedAt: 3000,
      policy: {
        version: 2,
        advisor: {
          primary: { backend: 'omp', model: 'openai/gpt-4o', effort: 'medium' },
          backup: { backend: 'claude', model: 'claude-3-7-sonnet', effort: 'medium' },
        },
      },
    };

    const onSaveRouting = vi.fn().mockResolvedValue(updatedPolicyResult);

    act(() => {
      root?.render(<PolicySummaryCard state={sampleState} onSaveRouting={onSaveRouting} />);
    });

    await act(async () => {
      (container?.querySelector('.edit-routing-btn') as HTMLButtonElement).click();
    });

    // Change primary effort to medium to make it dirty
    const priEffort = container?.querySelector('#primary-effort') as HTMLSelectElement;
    await act(async () => {
      priEffort.value = 'medium';
      priEffort.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveBtn = container?.querySelector('.save-routing-btn') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);

    await act(async () => {
      saveBtn.click();
    });

    expect(onSaveRouting).toHaveBeenCalledWith({
      expectedRevision: 'a'.repeat(64),
      advisor: {
        primary: { backend: 'omp', model: 'openai/gpt-4o', effort: 'medium' },
        backup: { backend: 'claude', model: 'claude-3-7-sonnet', effort: 'medium' },
      },
    });

    // Editor closes on success
    expect(container?.querySelector('.policy-routing-editor')).toBeNull();
  });

  it('handles 409 conflict and shows Reload Policy action', async () => {
    const conflictError = Object.assign(new Error('Policy conflict: expected revision mismatch'), {
      status: 409,
    });
    const onSaveRouting = vi.fn().mockRejectedValue(conflictError);
    const onReloadPolicy = vi.fn().mockResolvedValue(sampleState.currentPolicy);

    act(() => {
      root?.render(
        <PolicySummaryCard
          state={sampleState}
          onSaveRouting={onSaveRouting}
          onReloadPolicy={onReloadPolicy}
        />,
      );
    });

    await act(async () => {
      (container?.querySelector('.edit-routing-btn') as HTMLButtonElement).click();
    });

    const priEffort = container?.querySelector('#primary-effort') as HTMLSelectElement;
    await act(async () => {
      priEffort.value = 'low';
      priEffort.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveBtn = container?.querySelector('.save-routing-btn') as HTMLButtonElement;
    await act(async () => {
      saveBtn.click();
    });

    expect(container?.textContent).toContain('Conflict Detected');
    const reloadBtn = container?.querySelector('.reload-policy-btn') as HTMLButtonElement;
    expect(reloadBtn).not.toBeNull();

    await act(async () => {
      reloadBtn.click();
    });

    expect(onReloadPolicy).toHaveBeenCalled();
  });

  it('cancels edit on Escape key press', async () => {
    act(() => {
      root?.render(<PolicySummaryCard state={sampleState} onSaveRouting={vi.fn()} />);
    });

    await act(async () => {
      (container?.querySelector('.edit-routing-btn') as HTMLButtonElement).click();
    });

    const form = container?.querySelector('.policy-routing-editor') as HTMLFormElement;
    expect(form).not.toBeNull();

    await act(async () => {
      form.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(container?.querySelector('.policy-routing-editor')).toBeNull();
  });
});
