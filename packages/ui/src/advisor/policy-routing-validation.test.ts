/**
 * Unit tests for policy-routing-validation pure functions.
 */

import { describe, it, expect } from 'vitest';
import {
  validateRoutingDraft,
  validateRoute,
  isValidEffortForBackend,
  isKnownBackend,
  isDraftDirty,
  createDraftFromPolicy,
  type PolicyRoutingDraft,
} from './policy-routing-validation.js';
import type { AdvisorPolicyV2, AdvisorModelsResultDto } from './advisor-types.js';

describe('policy-routing-validation', () => {
  describe('isKnownBackend & isValidEffortForBackend', () => {
    it('recognizes supported backends', () => {
      expect(isKnownBackend('omp')).toBe(true);
      expect(isKnownBackend('codex')).toBe(true);
      expect(isKnownBackend('claude')).toBe(true);
      expect(isKnownBackend('pi')).toBe(true);
      expect(isKnownBackend('gpt')).toBe(false);
      expect(isKnownBackend('')).toBe(false);
    });

    it('enforces backend-specific effort sets', () => {
      expect(isValidEffortForBackend('codex', 'medium')).toBe(true);
      expect(isValidEffortForBackend('codex', 'xhigh')).toBe(true);
      expect(isValidEffortForBackend('codex', 'max')).toBe(false);
      expect(isValidEffortForBackend('codex', 'off')).toBe(false);

      expect(isValidEffortForBackend('claude', 'max')).toBe(true);
      expect(isValidEffortForBackend('claude', 'off')).toBe(false);

      expect(isValidEffortForBackend('omp', 'off')).toBe(true);
      expect(isValidEffortForBackend('omp', 'minimal')).toBe(true);
      expect(isValidEffortForBackend('omp', 'max')).toBe(true);

      expect(isValidEffortForBackend('pi', 'off')).toBe(true);
      expect(isValidEffortForBackend('pi', 'minimal')).toBe(true);
    });
  });

  describe('validateRoute', () => {
    it('validates a correct OMP route', () => {
      const res = validateRoute(
        { backend: 'omp', model: 'anthropic/claude-3-7-sonnet', effort: 'high' },
        'primary',
      );
      expect(res.normalized).toEqual({
        backend: 'omp',
        model: 'anthropic/claude-3-7-sonnet',
        effort: 'high',
      });
      expect(Object.keys(res.errors)).toHaveLength(0);
    });

    it('rejects OMP model missing slash or provider/model parts', () => {
      const noSlash = validateRoute({ backend: 'omp', model: 'claude-3-7-sonnet', effort: 'high' }, 'primary');
      expect(noSlash.errors['primary.model']).toContain('provider/model');

      const emptyProvider = validateRoute({ backend: 'omp', model: '/claude-3-7-sonnet', effort: 'high' }, 'primary');
      expect(emptyProvider.errors['primary.model']).toContain('non-empty provider');

      const emptyModel = validateRoute({ backend: 'omp', model: 'anthropic/', effort: 'high' }, 'primary');
      expect(emptyModel.errors['primary.model']).toContain('non-empty provider');
    });

    it('accepts Codex model without slash', () => {
      const res = validateRoute({ backend: 'codex', model: 'gpt-4o', effort: 'medium' }, 'backup');
      expect(res.normalized).toEqual({
        backend: 'codex',
        model: 'gpt-4o',
        effort: 'medium',
      });
      expect(Object.keys(res.errors)).toHaveLength(0);
    });

    it('rejects model exceeding 256 bytes or containing control chars', () => {
      const longModel = 'a'.repeat(257);
      const res1 = validateRoute({ backend: 'claude', model: longModel, effort: 'low' }, 'primary');
      expect(res1.errors['primary.model']).toContain('256 bytes');

      const ctrlModel = 'claude\x00model';
      const res2 = validateRoute({ backend: 'claude', model: ctrlModel, effort: 'low' }, 'primary');
      expect(res2.errors['primary.model']).toContain('control characters');
    });

    it('rejects effort exceeding 64 bytes or containing control chars', () => {
      const longEffort = 'e'.repeat(65);
      const res1 = validateRoute({ backend: 'claude', model: 'claude-3', effort: longEffort }, 'primary');
      expect(res1.errors['primary.effort']).toContain('64 bytes');

      const ctrlEffort = 'low\x1f';
      const res2 = validateRoute({ backend: 'claude', model: 'claude-3', effort: ctrlEffort }, 'primary');
      expect(res2.errors['primary.effort']).toContain('control characters');
    });

    it('warns when effort is not advertised by catalog for that model', () => {
      const catalog: AdvisorModelsResultDto = {
        backend: 'codex',
        source: 'harness',
        models: [{ id: 'gpt-4o', label: 'GPT-4o', efforts: ['low', 'medium'] }],
        efforts: ['low', 'medium', 'high'],
        defaultEffort: 'medium',
        observedAt: 12345,
      };

      const res = validateRoute(
        { backend: 'codex', model: 'gpt-4o', effort: 'high' },
        'primary',
        catalog,
      );
      expect(res.normalized).not.toBeNull();
      expect(res.warnings['primary.effort']).toContain('advertises efforts: low, medium');
    });
  });

  describe('validateRoutingDraft & duplicate detection', () => {
    it('accepts valid distinct primary and backup routes', () => {
      const draft: PolicyRoutingDraft = {
        primary: { backend: 'omp', model: 'openai/gpt-4o', effort: 'high' },
        backup: { backend: 'claude', model: 'claude-3-7-sonnet', effort: 'medium' },
      };
      const res = validateRoutingDraft(draft);
      expect(res.isValid).toBe(true);
      expect(res.isDuplicate).toBe(false);
      expect(res.normalized).toEqual({
        primary: { backend: 'omp', model: 'openai/gpt-4o', effort: 'high' },
        backup: { backend: 'claude', model: 'claude-3-7-sonnet', effort: 'medium' },
      });
    });

    it('allows same backend and model with differing effort', () => {
      const draft: PolicyRoutingDraft = {
        primary: { backend: 'claude', model: 'claude-3-7-sonnet', effort: 'high' },
        backup: { backend: 'claude', model: 'claude-3-7-sonnet', effort: 'low' },
      };
      const res = validateRoutingDraft(draft);
      expect(res.isValid).toBe(true);
      expect(res.isDuplicate).toBe(false);
      expect(res.errors['routes']).toBeUndefined();
    });

    it('rejects exact duplicate route triple (backend, model, effort)', () => {
      const draft: PolicyRoutingDraft = {
        primary: { backend: 'claude', model: 'claude-3-7-sonnet', effort: 'high' },
        backup: { backend: 'claude', model: 'claude-3-7-sonnet', effort: 'high' },
      };
      const res = validateRoutingDraft(draft);
      expect(res.isValid).toBe(false);
      expect(res.isDuplicate).toBe(true);
      expect(res.errors['routes']).toContain('exact same backend, model, and effort');
    });
  });

  describe('isDraftDirty & createDraftFromPolicy', () => {
    const basePolicy: AdvisorPolicyV2 = {
      version: 2,
      advisor: {
        primary: { backend: 'omp', model: 'openai/gpt-4o', effort: 'medium' },
        backup: { backend: 'claude', model: 'claude-3-7', effort: 'low' },
      },
    };

    it('creates draft from baseline policy', () => {
      const draft = createDraftFromPolicy(basePolicy);
      expect(draft.primary).toEqual({ backend: 'omp', model: 'openai/gpt-4o', effort: 'medium' });
      expect(draft.backup).toEqual({ backend: 'claude', model: 'claude-3-7', effort: 'low' });
      expect(isDraftDirty(draft, basePolicy)).toBe(false);
    });

    it('detects changes in draft as dirty', () => {
      const draft = createDraftFromPolicy(basePolicy);

      // Model change
      expect(isDraftDirty({ ...draft, primary: { ...draft.primary, model: 'openai/o3' } }, basePolicy)).toBe(true);

      // Effort change
      expect(isDraftDirty({ ...draft, primary: { ...draft.primary, effort: 'high' } }, basePolicy)).toBe(true);

      // Backend change
      expect(isDraftDirty({ ...draft, primary: { ...draft.primary, backend: 'pi' } }, basePolicy)).toBe(true);
    });
  });
});
