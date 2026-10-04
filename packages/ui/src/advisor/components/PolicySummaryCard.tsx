/**
 * PolicySummaryCard component.
 *
 * Renders the active account-wide advisor routing policy.
 * Provides an accessible inline editor for primary and backup routes,
 * with live validation, harness model discovery, custom model fallback,
 * and authoritative server policy commitment.
 */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type FC,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type { AppState } from '../app-state-types.js';
import type {
  AdvisorBackend,
  AdvisorModelsResultDto,
  PolicyReadCurrentResultDto,
  PolicyUpdateParamsDto,
  AdvisorPolicyV2,
} from '../advisor-types.js';
import {
  isKnownBackend,
  validateRoutingDraft,
  isDraftDirty,
  createDraftFromPolicy,
  type PolicyRoutingDraft,
} from '../policy-routing-validation.js';
import { RouteFieldset } from './RouteFieldset.js';

export interface PolicySummaryCardProps {
  readonly state: AppState;
  readonly onLoadRoutingModels?: (backend: AdvisorBackend) => Promise<AdvisorModelsResultDto | null>;
  readonly onSaveRouting?: (params: PolicyUpdateParamsDto) => Promise<PolicyReadCurrentResultDto | null>;
  readonly onCancelRoutingEdit?: () => void;
  readonly onReloadPolicy?: () => Promise<PolicyReadCurrentResultDto | null>;
}

export const PolicySummaryCard: FC<PolicySummaryCardProps> = ({
  state,
  onLoadRoutingModels,
  onSaveRouting,
  onCancelRoutingEdit,
  onReloadPolicy,
}) => {
  const { currentPolicy, capabilities, policyState } = state;
  const policy = (currentPolicy?.policy ?? policyState?.policy?.policy) as AdvisorPolicyV2 | undefined;

  const hasPolicyPerm = capabilities.length === 0 || capabilities.includes('policy.readCurrent');
  const hasUpdatePerm = capabilities.includes('policy.update');
  const policyStatus =
    policyState?.status && policyState.status !== 'ready' && policyState.status !== 'idle'
      ? policyState.status
      : currentPolicy?.status ?? 'not_configured';

  const revision = currentPolicy?.revision ?? policyState?.policy?.revision ?? 'none';
  const observedAt = currentPolicy?.observedAt ?? policyState?.policy?.observedAt;

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<PolicyRoutingDraft>(() => createDraftFromPolicy(policy));
  const [customModelMode, setCustomModelMode] = useState<{ primary: boolean; backup: boolean }>({
    primary: false,
    backup: false,
  });
  const [crossBackendNotice, setCrossBackendNotice] = useState<{
    primary: string | null;
    backup: string | null;
  }>({
    primary: null,
    backup: null,
  });
  const [catalogs, setCatalogs] = useState<Partial<Record<AdvisorBackend, AdvisorModelsResultDto>>>({});
  const [catalogLoading, setCatalogLoading] = useState<Partial<Record<AdvisorBackend, boolean>>>({});
  const [catalogErrors, setCatalogErrors] = useState<Partial<Record<AdvisorBackend, string>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictDetected, setConflictDetected] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const baselineRevisionRef = useRef<string>(revision);
  const baselinePolicyRef = useRef<AdvisorPolicyV2 | undefined>(policy);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const primaryBackendRef = useRef<HTMLSelectElement | null>(null);
  const lastEpochRef = useRef(state.contextEpoch);

  const canEdit =
    hasPolicyPerm &&
    hasUpdatePerm &&
    policyStatus === 'ready' &&
    policy?.version === 2 &&
    typeof onSaveRouting === 'function';

  // Catalog loading helper
  const fetchCatalog = useCallback(
    async (backend: AdvisorBackend) => {
      if (!onLoadRoutingModels || !isKnownBackend(backend)) return;
      if (catalogs[backend] || catalogLoading[backend]) return;

      setCatalogLoading((prev) => ({ ...prev, [backend]: true }));
      setCatalogErrors((prev) => ({ ...prev, [backend]: undefined }));
      try {
        const res = await onLoadRoutingModels(backend);
        if (res && res.backend === backend) {
          setCatalogs((prev) => ({ ...prev, [backend]: res }));
        }
      } catch (err: unknown) {
        setCatalogErrors((prev) => ({
          ...prev,
          [backend]: err instanceof Error ? err.message : 'Discovery unavailable',
        }));
      } finally {
        setCatalogLoading((prev) => ({ ...prev, [backend]: false }));
      }
    },
    [onLoadRoutingModels, catalogs, catalogLoading],
  );

  // Lazy catalog discovery on edit or backend switch
  useEffect(() => {
    if (isEditing) {
      if (isKnownBackend(draft.primary.backend)) {
        void fetchCatalog(draft.primary.backend as AdvisorBackend);
      }
      if (isKnownBackend(draft.backup.backend)) {
        void fetchCatalog(draft.backup.backend as AdvisorBackend);
      }
    }
  }, [isEditing, draft.primary.backend, draft.backup.backend, fetchCatalog]);

  // Context epoch reset
  useEffect(() => {
    if (lastEpochRef.current !== state.contextEpoch) {
      lastEpochRef.current = state.contextEpoch;
      setIsEditing(false);
      setSaveError(null);
      setConflictDetected(false);
      setIsSaving(false);
      setCatalogs({});
      setCatalogLoading({});
      setCatalogErrors({});
      setDraft(createDraftFromPolicy(policy));
    }
  }, [state.contextEpoch, policy]);

  const validation = useMemo(() => validateRoutingDraft(draft, catalogs), [draft, catalogs]);
  const isDirty = useMemo(
    () => isDraftDirty(draft, baselinePolicyRef.current),
    [draft],
  );
  const isStaleBaseline = isEditing && revision !== baselineRevisionRef.current;
  const canSave = isDirty && validation.isValid && !isSaving;

  // Handlers
  const handleOpenEdit = useCallback(() => {
    baselineRevisionRef.current = revision;
    baselinePolicyRef.current = policy;
    const initialDraft = createDraftFromPolicy(policy);
    setDraft(initialDraft);
    setCustomModelMode({
      primary: false,
      backup: false,
    });
    setCrossBackendNotice({ primary: null, backup: null });
    setIsEditing(true);
    setSaveError(null);
    setConflictDetected(false);
    setTimeout(() => {
      primaryBackendRef.current?.focus();
    }, 0);
  }, [policy, revision]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setSaveError(null);
    setConflictDetected(false);
    setDraft(createDraftFromPolicy(baselinePolicyRef.current));
    onCancelRoutingEdit?.();
    setTimeout(() => {
      editButtonRef.current?.focus();
    }, 0);
  }, [onCancelRoutingEdit]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSave || !onSaveRouting || !validation.normalized) return;

      setIsSaving(true);
      setSaveError(null);
      setConflictDetected(false);

      try {
        const res = await onSaveRouting({
          expectedRevision: baselineRevisionRef.current,
          advisor: {
            primary: validation.normalized.primary,
            backup: validation.normalized.backup,
          },
        });
        if (res) {
          setIsEditing(false);
          setIsSaving(false);
          baselineRevisionRef.current = res.revision ?? revision;
          baselinePolicyRef.current = res.policy as AdvisorPolicyV2 | undefined;
          setTimeout(() => {
            editButtonRef.current?.focus();
          }, 0);
        }
      } catch (err: unknown) {
        setIsSaving(false);
        const msg = err instanceof Error ? err.message : String(err);
        const isConflict =
          msg.toLowerCase().includes('conflict') ||
          msg.toLowerCase().includes('expected revision') ||
          msg.toLowerCase().includes('mismatch') ||
          (err !== null && typeof err === 'object' && 'status' in err && err.status === 409);
        if (isConflict) {
          setConflictDetected(true);
          setSaveError(
            'Conflict detected: Policy revision was modified by another session. Reload policy to review current state.',
          );
        } else {
          setSaveError(msg || 'Failed to save routing policy.');
        }
      }
    },
    [canSave, onSaveRouting, validation.normalized, revision],
  );

  const handleReload = useCallback(async () => {
    if (!onReloadPolicy) return;
    setIsSaving(true);
    try {
      const reloaded = await onReloadPolicy();
      if (reloaded) {
        baselineRevisionRef.current = reloaded.revision ?? 'none';
        baselinePolicyRef.current = reloaded.policy as AdvisorPolicyV2 | undefined;
        setConflictDetected(false);
        setSaveError(null);
        setDraft(createDraftFromPolicy(reloaded.policy as AdvisorPolicyV2 | undefined));
      }
    } finally {
      setIsSaving(false);
    }
  }, [onReloadPolicy]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLFormElement>) => {
      if (e.key === 'Escape') {
        if (!isSaving) {
          e.preventDefault();
          e.stopPropagation();
          handleCancel();
        }
      }
    },
    [isSaving, handleCancel],
  );

  const handleBackendChange = (routeKey: 'primary' | 'backup', newBackend: AdvisorBackend) => {
    const oldBackend = draft[routeKey].backend;
    if (oldBackend === newBackend) return;

    const cat = catalogs[oldBackend as AdvisorBackend];
    const wasCatalogModel = Boolean(cat?.models.some((m) => m.id === draft[routeKey].model));

    let notice: string | null = null;
    if (wasCatalogModel) {
      notice = `Selected model from ${oldBackend} retained as custom for ${newBackend}. Choose a model from the ${newBackend} catalog or keep custom.`;
    }

    setCrossBackendNotice((prev) => ({ ...prev, [routeKey]: notice }));
    setCustomModelMode((prev) => ({ ...prev, [routeKey]: true }));
    setDraft((prev) => ({
      ...prev,
      [routeKey]: {
        ...prev[routeKey],
        backend: newBackend,
      },
    }));
    void fetchCatalog(newBackend);
  };

  const statusBadge =
    !hasPolicyPerm || policyStatus === 'forbidden' ? (
      <span className="badge badge-danger">Forbidden</span>
    ) : policyStatus === 'missing' ? (
      <span className="badge badge-danger">Missing</span>
    ) : policyStatus === 'migration_required' ? (
      <span className="badge badge-warning">Migration Required</span>
    ) : policyStatus === 'ready' ? (
      <span className="badge badge-success">Ready</span>
    ) : policyStatus === 'not_configured' ? (
      <span className="badge badge-secondary">Not Configured</span>
    ) : policyStatus === 'loading' ? (
      <span className="badge badge-info">Loading...</span>
    ) : (
      <span className="badge badge-danger">{String(policyStatus)}</span>
    );

  const primary = policy?.advisor?.primary;
  const backup = policy?.advisor?.backup;
  const waitMode = policy?.wait?.mode ?? 'until_terminal';
  const waitObj = policy?.wait as Record<string, unknown> | undefined;
  const historyObj = policy?.history as Record<string, unknown> | undefined;
  const waitWarnAfter =
    policy?.wait?.warnAfterMs ??
    (typeof waitObj?.warn_after_ms === 'number' ? waitObj.warn_after_ms : '—');
  const waitWarnEvery =
    policy?.wait?.warnEveryMs ??
    (typeof waitObj?.warn_every_ms === 'number' ? waitObj.warn_every_ms : '—');
  const retentionDays =
    policy?.history?.retentionDays ??
    (typeof historyObj?.retention_days === 'number' ? historyObj.retention_days : '—');
  const maxBytes =
    policy?.history?.maxBytes ??
    (typeof historyObj?.max_bytes === 'number' ? historyObj.max_bytes : '—');

  return (
    <div className="config-card policy-card">
      <div className="policy-card-header">
        <div className="policy-card-title-group">
          <h3 className="card-subtitle">Active Owner Policy</h3>
          {canEdit && !isEditing && (
            <button
              ref={editButtonRef}
              type="button"
              className="btn btn-sm btn-outline-primary edit-routing-btn"
              onClick={handleOpenEdit}
            >
              Edit Routing
            </button>
          )}
        </div>
        <div className="policy-badge-row">
          <span className="badge badge-info">Current account policy — not filtered by History project</span>
          {statusBadge}
          <span className="badge badge-secondary">Revision: {revision.slice(0, 12)}…</span>
          {observedAt && (
            <span className="text-muted stat-sub">
              Observed: {new Date(observedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {!isEditing && (!hasPolicyPerm || policyStatus === 'forbidden') ? (
        <div className="policy-state-banner alert alert-danger" role="alert">
          <strong>Forbidden:</strong> Policy inspection is not permitted under current administrator role.
        </div>
      ) : !isEditing && policyStatus === 'missing' ? (
        <div className="policy-state-banner alert alert-danger" role="alert">
          <strong>Missing Policy:</strong> Current routing policy document could not be located or was removed.
        </div>
      ) : !isEditing && policyStatus === 'not_configured' ? (
        <div className="policy-state-banner alert alert-info">
          <strong>Not Configured:</strong> No account-wide advisor routing policy is configured at $HOME/.evcrate/advisor-routing.json.
        </div>
      ) : !isEditing && policyStatus === 'migration_required' ? (
        <div className="policy-state-banner alert alert-warning">
          <strong>Migration Required:</strong> Policy uses legacy v1 format. Update to v2 specification with primary and backup routes.
        </div>
      ) : !isEditing && policyStatus === 'loading' ? (
        <div className="policy-state-banner alert alert-info">
          <strong>Loading Policy:</strong> Loading active advisor routing policy…
        </div>
      ) : !isEditing && policyStatus !== 'ready' ? (
        <div className="policy-state-banner alert alert-danger">
          <strong>Policy inspection status:</strong> <code>{String(policyStatus)}</code>
          {policyState?.error && <div className="policy-error-msg">{policyState.error}</div>}
        </div>
      ) : (
        <div className="policy-content">
          {/* Inline Route Editor */}
          {isEditing ? (
            <form
              className="policy-routing-editor"
              onSubmit={handleSubmit}
              onKeyDown={handleKeyDown}
              noValidate
              aria-label="Edit Routing Policy"
            >
              {conflictDetected && (
                <div className="editor-alert alert alert-warning" role="alert">
                  <div>
                    <strong>Conflict Detected:</strong> {saveError}
                  </div>
                  <div className="mt-2">
                    <button
                      type="button"
                      className="btn btn-sm btn-warning reload-policy-btn"
                      disabled={isSaving}
                      onClick={handleReload}
                    >
                      Reload Policy
                    </button>
                  </div>
                </div>
              )}

              {isStaleBaseline && !conflictDetected && (
                <div className="editor-alert alert alert-warning" role="status">
                  <small>
                    Notice: Active policy revision has changed in the background. Saving with current revision will be verified against the server.
                  </small>
                </div>
              )}

              {saveError && !conflictDetected && (
                <div className="editor-alert alert alert-danger" role="alert">
                  <strong>Save Failed:</strong> {saveError}
                </div>
              )}

              {validation.isDuplicate && (
                <div className="editor-alert alert alert-danger" role="alert">
                  <strong>Duplicate Route Error:</strong> {validation.errors.routes}
                </div>
              )}

              <div className="route-fieldsets-container">
                <RouteFieldset
                  routeKey="primary"
                  label="Primary Route"
                  route={draft.primary}
                  catalog={catalogs[draft.primary.backend as AdvisorBackend]}
                  isCatalogLoading={catalogLoading[draft.primary.backend as AdvisorBackend]}
                  catalogError={catalogErrors[draft.primary.backend as AdvisorBackend]}
                  crossBackendNotice={crossBackendNotice.primary}
                  isCustomMode={customModelMode.primary}
                  disabled={isSaving}
                  errors={validation.errors}
                  warnings={validation.warnings}
                  backendSelectRef={primaryBackendRef}
                  onBackendChange={(b) => handleBackendChange('primary', b)}
                  onModelChange={(m, isCustom) => {
                    setCustomModelMode((prev) => ({ ...prev, primary: isCustom }));
                    setCrossBackendNotice((prev) => ({ ...prev, primary: null }));
                    setDraft((prev) => ({ ...prev, primary: { ...prev.primary, model: m } }));
                  }}
                  onEffortChange={(eff) => {
                    setDraft((prev) => ({ ...prev, primary: { ...prev.primary, effort: eff } }));
                  }}
                />

                <RouteFieldset
                  routeKey="backup"
                  label="Backup Route"
                  route={draft.backup}
                  catalog={catalogs[draft.backup.backend as AdvisorBackend]}
                  isCatalogLoading={catalogLoading[draft.backup.backend as AdvisorBackend]}
                  catalogError={catalogErrors[draft.backup.backend as AdvisorBackend]}
                  crossBackendNotice={crossBackendNotice.backup}
                  isCustomMode={customModelMode.backup}
                  disabled={isSaving}
                  errors={validation.errors}
                  warnings={validation.warnings}
                  onBackendChange={(b) => handleBackendChange('backup', b)}
                  onModelChange={(m, isCustom) => {
                    setCustomModelMode((prev) => ({ ...prev, backup: isCustom }));
                    setCrossBackendNotice((prev) => ({ ...prev, backup: null }));
                    setDraft((prev) => ({ ...prev, backup: { ...prev.backup, model: m } }));
                  }}
                  onEffortChange={(eff) => {
                    setDraft((prev) => ({ ...prev, backup: { ...prev.backup, effort: eff } }));
                  }}
                />
              </div>

              <div className="editor-actions">
                <button
                  type="submit"
                  className="btn btn-primary save-routing-btn"
                  disabled={!canSave}
                >
                  {isSaving ? 'Saving…' : 'Save Routing'}
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary cancel-routing-btn"
                  disabled={isSaving}
                  onClick={handleCancel}
                >
                  Cancel
                </button>
                <span className="status-region sr-only" aria-live="polite">
                  {isSaving ? 'Saving routing policy…' : ''}
                </span>
              </div>
            </form>
          ) : (
            /* Authoritative Read-Only Summary */
            primary && backup && (
              <div className="policy-routes-summary">
                <div className="policy-route-item primary-route">
                  <span className="route-role-badge badge badge-info">Primary</span>
                  <div className="route-details">
                    <code className="route-target-code">
                      {primary.backend} / {primary.model}
                    </code>
                    <span className="text-submuted">({primary.effort})</span>
                  </div>
                </div>
                <div className="policy-route-item backup-route">
                  <span className="route-role-badge badge badge-secondary">Backup</span>
                  <div className="route-details">
                    <code className="route-target-code">
                      {backup.backend} / {backup.model}
                    </code>
                    <span className="text-submuted">({backup.effort})</span>
                  </div>
                </div>
              </div>
            )
          )}

          <details className="policy-disclosure">
            <summary className="policy-disclosure-summary">
              <span className="disclosure-label">View full routing policy &amp; runtime parameters</span>
            </summary>
            <div className="policy-disclosure-content">
              <dl className="detail-dl policy-params-dl">
                <dt>Policy Version</dt>
                <dd><code>{policy?.version ?? 2}</code></dd>
                <dt>Primary Route</dt>
                <dd>
                  <code>{primary ? `${primary.backend} / ${primary.model}` : '—'}</code> ({primary?.effort ?? '—'})
                </dd>
                <dt>Backup Route</dt>
                <dd>
                  <code>{backup ? `${backup.backend} / ${backup.model}` : '—'}</code> ({backup?.effort ?? '—'})
                </dd>
                <dt>Wait Mode</dt>
                <dd><code>{waitMode}</code></dd>
                <dt>Wait Warning</dt>
                <dd>Warn after {waitWarnAfter} ms (repeat every {waitWarnEvery} ms)</dd>
                <dt>History Policy</dt>
                <dd>Retention: {retentionDays} days &bull; Max: {maxBytes} bytes</dd>
              </dl>

              <div className="policy-json-wrapper">
                <span className="json-label">Raw Policy JSON:</span>
                <pre className="policy-json-block">
                  <code>{JSON.stringify(policy, null, 2)}</code>
                </pre>
              </div>
            </div>
          </details>
        </div>
      )}

      <div className="card-disclaimer text-muted">
        <em>Observational notice:</em> This displays current account-wide owner policy only (not filtered by History project). It is not historical route evidence and does not represent past execution configurations.
      </div>
    </div>
  );
};
