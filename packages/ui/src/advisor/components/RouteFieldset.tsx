/**
 * RouteFieldset component.
 *
 * Renders an accessible fieldset for editing an advisor route (primary or backup),
 * including backend selection, catalog-driven model picking with custom fallback,
 * effort selection, and associated error/status indicators.
 */

import type { FC, Ref } from 'react';
import type {
  AdvisorBackend,
  AdvisorModelsResultDto,
} from '../advisor-types.js';
import {
  ENABLED_BACKENDS,
  BACKEND_EFFORTS,
  CUSTOM_MODEL_SENTINEL,
  type RouteDraft,
} from '../policy-routing-validation.js';

export interface RouteFieldsetProps {
  readonly routeKey: 'primary' | 'backup';
  readonly label: string;
  readonly route: RouteDraft;
  readonly catalog?: AdvisorModelsResultDto | null;
  readonly isCatalogLoading?: boolean;
  readonly catalogError?: string | null;
  readonly crossBackendNotice?: string | null;
  readonly isCustomMode: boolean;
  readonly disabled?: boolean;
  readonly errors: Readonly<Record<string, string>>;
  readonly warnings: Readonly<Record<string, string>>;
  readonly backendSelectRef?: Ref<HTMLSelectElement>;
  readonly onBackendChange: (newBackend: AdvisorBackend) => void;
  readonly onModelChange: (newModel: string, isCustom: boolean) => void;
  readonly onEffortChange: (newEffort: string) => void;
}

export const RouteFieldset: FC<RouteFieldsetProps> = ({
  routeKey,
  label,
  route,
  catalog,
  isCatalogLoading,
  catalogError,
  crossBackendNotice,
  isCustomMode,
  disabled = false,
  errors,
  warnings,
  backendSelectRef,
  onBackendChange,
  onModelChange,
  onEffortChange,
}) => {
  const backendId = `${routeKey}-backend`;
  const modelSelectId = `${routeKey}-model-select`;
  const customModelId = `${routeKey}-custom-model`;
  const effortId = `${routeKey}-effort`;

  const backendError = errors[`${routeKey}.backend`];
  const modelError = errors[`${routeKey}.model`];
  const effortError = errors[`${routeKey}.effort`];
  const effortWarning = warnings[`${routeKey}.effort`];

  const backend = route.backend as AdvisorBackend;
  const availableEfforts = BACKEND_EFFORTS[backend] || BACKEND_EFFORTS.omp;

  const catalogModels = catalog?.models ?? [];
  const isModelInCatalog = catalogModels.some((m) => m.id === route.model);
  const showCustomInput = isCustomMode || !isModelInCatalog;
  const modelSelectValue = showCustomInput ? CUSTOM_MODEL_SENTINEL : route.model;

  return (
    <fieldset className={`route-fieldset ${routeKey}-route-fieldset`}>
      <legend className="route-legend">{label}</legend>

      {crossBackendNotice && (
        <div className="cross-backend-notice alert alert-warning" role="status">
          <small>{crossBackendNotice}</small>
        </div>
      )}

      <div className="route-controls-grid">
        {/* Backend selection */}
        <div className="form-group route-field backend-field">
          <label htmlFor={backendId} className="field-label">
            Backend
          </label>
          <select
            id={backendId}
            ref={backendSelectRef}
            className="form-control route-backend-select"
            value={route.backend}
            disabled={disabled}
            aria-invalid={Boolean(backendError)}
            aria-describedby={backendError ? `${backendId}-error` : undefined}
            onChange={(e) => onBackendChange(e.target.value as AdvisorBackend)}
          >
            {ENABLED_BACKENDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          {backendError && (
            <span id={`${backendId}-error`} className="field-error-text" role="alert">
              {backendError}
            </span>
          )}
        </div>

        {/* Model selection */}
        <div className="form-group route-field model-field">
          <div className="model-label-row">
            <label htmlFor={modelSelectId} className="field-label">
              Model
            </label>
            <div className="catalog-status-indicator">
              {isCatalogLoading && (
                <span className="badge badge-info catalog-loading-badge">Discovering…</span>
              )}
              {!isCatalogLoading && catalog && (
                <span
                  className={`badge ${catalog.source === 'harness' ? 'badge-success' : 'badge-warning'} catalog-source-badge`}
                  title={catalog.source === 'fallback' ? 'Using static fallback catalog' : 'Discovered from harness CLI'}
                >
                  source: {catalog.source}
                </span>
              )}
              {!isCatalogLoading && catalogError && (
                <span className="badge badge-danger catalog-error-badge" title={catalogError}>
                  Discovery unavailable
                </span>
              )}
            </div>
          </div>

          <select
            id={modelSelectId}
            className="form-control route-model-select"
            value={modelSelectValue}
            disabled={disabled}
            onChange={(e) => {
              const val = e.target.value;
              if (val === CUSTOM_MODEL_SENTINEL) {
                onModelChange(route.model, true);
              } else {
                onModelChange(val, false);
              }
            }}
          >
            {catalogModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label ? `${m.label} (${m.id})` : m.id}
              </option>
            ))}
            <option value={CUSTOM_MODEL_SENTINEL}>Custom model…</option>
          </select>

          {showCustomInput && (
            <div className="custom-model-wrapper">
              <label htmlFor={customModelId} className="field-sublabel">
                Custom Model Identifier:
              </label>
              <input
                id={customModelId}
                type="text"
                className="form-control route-custom-model-input"
                value={route.model}
                disabled={disabled}
                placeholder={
                  route.backend === 'omp' || route.backend === 'pi'
                    ? 'provider/model (e.g. openai/gpt-4o)'
                    : 'model-identifier'
                }
                aria-invalid={Boolean(modelError)}
                aria-describedby={modelError ? `${customModelId}-error` : undefined}
                onChange={(e) => onModelChange(e.target.value, true)}
              />
            </div>
          )}

          {modelError && (
            <span id={`${customModelId}-error`} className="field-error-text" role="alert">
              {modelError}
            </span>
          )}
        </div>

        {/* Effort selection */}
        <div className="form-group route-field effort-field">
          <label htmlFor={effortId} className="field-label">
            Effort
          </label>
          <select
            id={effortId}
            className="form-control route-effort-select"
            value={route.effort}
            disabled={disabled}
            aria-invalid={Boolean(effortError)}
            aria-describedby={
              effortError
                ? `${effortId}-error`
                : effortWarning
                  ? `${effortId}-warning`
                  : undefined
            }
            onChange={(e) => onEffortChange(e.target.value)}
          >
            {availableEfforts.map((eff) => (
              <option key={eff} value={eff}>
                {eff}
              </option>
            ))}
            {/* If the current effort is outside availableEfforts, keep it visible */}
            {!availableEfforts.includes(route.effort) && (
              <option value={route.effort}>{route.effort} (unsupported)</option>
            )}
          </select>

          {effortError && (
            <span id={`${effortId}-error`} className="field-error-text" role="alert">
              {effortError}
            </span>
          )}
          {!effortError && effortWarning && (
            <span id={`${effortId}-warning`} className="field-warning-text" role="status">
              <small>{effortWarning}</small>
            </span>
          )}
        </div>
      </div>
    </fieldset>
  );
};
