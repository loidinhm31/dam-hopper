import { describe, it, expect } from 'vitest';
import {
  selectHistoryQuery,
  selectFilteredRecords,
  selectSelectedRow,
  extractDomainFilters,
  extractDomainQuery,
  formatProjectName,
  formatRatioPercent,
} from './app-state-selectors.js';
import {
  aggregateEvaluationGroups,
  computeComparisonKey,
} from './evaluation-comparison-helpers.js';
import { INITIAL_STATE, type AppState } from './app-state-types.js';
import type { EvaluationDocumentV1 } from './advisor-types.js';

describe('app-state-selectors', () => {
  const validSha = 'a'.repeat(64);

  it('selectHistoryQuery returns unavailable if provider is not available', () => {
    const s: AppState = { ...INITIAL_STATE, isAvailable: false };
    const res = selectHistoryQuery(s);
    expect(res.available).toBe(false);
    expect(res.query).toBeNull();
    expect(res.reason).toContain('unavailable');
  });

  it('selectHistoryQuery in "all" scope returns projectId: null', () => {
    const s: AppState = {
      ...INITIAL_STATE,
      activityScope: 'all',
      filters: { taskRunId: 'task-1' },
    };
    const res = selectHistoryQuery(s);
    expect(res.available).toBe(true);
    if (res.available) {
      expect(res.query.projectId).toBeNull();
      expect(res.query.taskRunId).toBe('task-1');
    }
  });

  it('selectHistoryQuery in "workspace-project" scope requires valid SHA-256 hash', () => {
    // Missing project
    const sNoProj: AppState = { ...INITIAL_STATE, projectId: null };
    const resNo = selectHistoryQuery(sNoProj);
    expect(resNo.available).toBe(false);
    expect(resNo.reason).toContain('No active project selected');

    // Invalid hash
    const sBadHash: AppState = { ...INITIAL_STATE, projectId: 'not-a-hash' };
    const resBad = selectHistoryQuery(sBadHash);
    expect(resBad.available).toBe(false);
    expect(resBad.reason).toContain('Unresolved Workspace project ID hash');

    // Valid hash
    const sValid: AppState = { ...INITIAL_STATE, projectId: validSha };
    const resValid = selectHistoryQuery(sValid);
    expect(resValid.available).toBe(true);
    if (resValid.available) {
      expect(resValid.query.projectId).toBe(validSha);
    }
  });

  it('selectHistoryQuery in "workspace-project" scope resolves project name from inventory', () => {
    const sNamed: AppState = {
      ...INITIAL_STATE,
      projectId: 'evcrate',
      inventory: {
        entries: [{ projectId: validSha, label: 'evcrate', count: 10 }],
        totalProjects: 1,
        unfilteredTotalRecords: 10,
      },
    };
    const res = selectHistoryQuery(sNamed);
    expect(res.available).toBe(true);
    if (res.available) {
      expect(res.query.projectId).toBe(validSha);
    }
  });

  it('selectFilteredRecords returns entries', () => {
    const s: AppState = {
      ...INITIAL_STATE,
      historyPageEntries: [
        {
          recordRef: 'r1',
          projectId: 'p1',
          taskRunId: 't1',
          consultationId: 'c1',
          status: 'ADVICE_READY',
          route: { backend: 'omp', model: 'claude', effort: 'high' },
          checkpointDigest: 'cd',
          promptIdentity: 'pi',
          buildIdentity: 'bi',
          startedAt: 100,
          completedAt: 200,
          receiptElapsedMs: 100,
          outcomeState: 'valid',
          outcomeResult: 'resolved',
        },
      ],
    };
    expect(selectFilteredRecords(s)).toHaveLength(1);
  });

  it('selectSelectedRow finds row by consultation ID', () => {
    const s: AppState = {
      ...INITIAL_STATE,
      selectedConsultationId: 'c1',
      historyPageEntries: [
        {
          recordRef: 'r1',
          projectId: 'p1',
          taskRunId: 't1',
          consultationId: 'c1',
          status: 'ADVICE_READY',
          route: { backend: 'omp', model: 'claude', effort: 'high' },
          checkpointDigest: 'cd',
          promptIdentity: 'pi',
          buildIdentity: 'bi',
          startedAt: 100,
          completedAt: 200,
          receiptElapsedMs: 100,
          outcomeState: 'valid',
          outcomeResult: 'resolved',
        },
      ],
    };
    expect(selectSelectedRow(s)?.recordRef).toBe('r1');

    const sNone: AppState = { ...s, selectedConsultationId: 'other' };
    expect(selectSelectedRow(sNone)).toBeNull();
  });

  it('extractDomainFilters and extractDomainQuery build clean DTOs', () => {
    const filters = {
      taskRunId: 't-1',
      statuses: ['ADVICE_READY' as const],
      outcomeResults: ['resolved' as const],
    };
    const domainFilters = extractDomainFilters(filters);
    expect(domainFilters.statuses).toEqual(['ADVICE_READY']);
    expect(domainFilters.outcomeResults).toEqual(['resolved']);

    const query = extractDomainQuery(filters, 'proj-1');
    expect(query.projectId).toBe('proj-1');
    expect(query.taskRunId).toBe('t-1');
    expect(query.filters.statuses).toEqual(['ADVICE_READY']);
  });

  it('formatProjectName formats label or truncated hash', () => {
    expect(formatProjectName(validSha, 'My Workspace Project')).toBe('My Workspace Project');
    expect(formatProjectName(validSha, '')).toBe(`${validSha.slice(0, 8)}…`);
    expect(formatProjectName('short')).toBe('short');
  });

  it('formatRatioPercent formats percentage or Unavailable', () => {
    expect(formatRatioPercent(null)).toBe('Unavailable');
    expect(formatRatioPercent(undefined)).toBe('Unavailable');
    expect(formatRatioPercent(0.854)).toBe('85.4%');
    expect(formatRatioPercent(1)).toBe('100.0%');
    expect(formatRatioPercent(0)).toBe('0.0%');
  });

  it('aggregateEvaluationGroups groups documents by matching rubric and input digests', () => {
    const doc1: EvaluationDocumentV1 = {
      protocol: 'evcrate-advisor-counsel-evaluation',
      version: 1,
      evaluation_id: 'e-1',
      run_id: 'r-1',
      created_at: 1000,
      rubric_digest: 'rubric-alpha',
      rubric: { version: 1, dimensions: [], pass_threshold: 3 },
      candidates: [
        {
          candidate_id: 'cand-1',
          label: 'Candidate 1',
          route: { backend: 'omp', model: 'sonnet', effort: 'high' },
          prompt_identity: 'p1',
          build_identity: 'b1',
        },
      ],
      cases: [
        {
          case_id: 'case-1',
          name: 'Case 1',
          category: 'safety',
          input_digest: 'input-omega',
          input: {
            context: { goal: 'g', non_goals: [], authorized_paths: [] },
            executor_proposal: { hypothesis: 'h', intended_action: 'a' },
            evidence: { observed_failure: 'f', files: [], validation_command: 'npm test' },
          },
          observations: [
            {
              candidate_id: 'cand-1',
              response: {
                status: 'ADVICE_READY',
                result: {
                  recommendation: 'rec',
                  rationale: 'rat',
                  must_fix: [],
                  cautions: [],
                  assumptions: [],
                  success_checks: [],
                  unresolved_questions: [],
                },
                error: null,
                captured_at: 1000,
              },
              score: {
                provenance: 'automated',
                judge_id: 'judge-1',
                judge_version: '1.0',
                scored_at: 1100,
                dimensions: [{ dimension_id: 'dim-1', score: 4 }],
                average_score: 4.0,
                passed: true,
                issues: [],
              },
            },
          ],
        },
      ],
    };

    const key = computeComparisonKey('rubric-alpha', 'input-omega');
    expect(key).toBe('rubric-alpha:input-omega');

    const groups = aggregateEvaluationGroups([doc1]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe(key);
    expect(groups[0].cases).toHaveLength(1);
    expect(groups[0].responses).toHaveLength(1);
    expect(groups[0].responses[0].ready_count).toBe(1);
    expect(groups[0].automated_scores).toHaveLength(1);
    expect(groups[0].automated_scores[0].average_score).toBe(4.0);
  });
});
