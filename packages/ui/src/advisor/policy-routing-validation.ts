/**
 * Pure validation and normalization for Advisor routing policy drafts.
 *
 * Enforces server-compatible rules:
 * - Backends: 'omp' | 'codex' | 'claude' | 'pi'
 * - Model: trimmed non-empty, max 256 UTF-8 bytes, no control characters
 * - OMP / Pi model syntax: 'provider/model' with non-empty provider and model parts
 * - Effort: trimmed non-empty, max 64 UTF-8 bytes, no control characters, backend-specific allowed set
 * - Duplicate detection: exact normalized triple equality (backend + model + effort)
 *   (Same backend and model with differing effort is permitted)
 */

import type {
  AdvisorBackend,
  AdvisorRouteTarget,
  AdvisorPolicyV2,
  AdvisorModelsResultDto,
} from './advisor-types.js';

export const ENABLED_BACKENDS: readonly AdvisorBackend[] = ['omp', 'codex', 'claude', 'pi'] as const;

export const CUSTOM_MODEL_SENTINEL = '__custom__';

export const BACKEND_EFFORTS: Record<AdvisorBackend, readonly string[]> = {
  codex: ['low', 'medium', 'high', 'xhigh'],
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  omp: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  pi: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
};

export const DEFAULT_BACKEND_EFFORT: Record<AdvisorBackend, string> = {
  codex: 'medium',
  claude: 'medium',
  omp: 'medium',
  pi: 'medium',
};

export interface RouteDraft {
  readonly backend: string;
  readonly model: string;
  readonly effort: string;
}

export interface PolicyRoutingDraft {
  readonly primary: RouteDraft;
  readonly backup: RouteDraft;
}

export interface RoutingValidationResult {
  readonly isValid: boolean;
  readonly isDuplicate: boolean;
  readonly errors: Readonly<Record<string, string>>;
  readonly normalized: {
    readonly primary: AdvisorRouteTarget;
    readonly backup: AdvisorRouteTarget;
  } | null;
  readonly warnings: Readonly<Record<string, string>>;
}

const CONTROL_CHAR_REGEX = /[\u0000-\u001f\u007f]/;
const textEncoder = new TextEncoder();

export function isKnownBackend(backend: string): backend is AdvisorBackend {
  return (ENABLED_BACKENDS as readonly string[]).includes(backend);
}

export function isValidEffortForBackend(backend: string, effort: string): boolean {
  if (!isKnownBackend(backend)) return false;
  return BACKEND_EFFORTS[backend].includes(effort);
}

export function validateRoute(
  route: RouteDraft,
  routeKey: 'primary' | 'backup',
  catalog?: AdvisorModelsResultDto | null,
): {
  normalized: AdvisorRouteTarget | null;
  errors: Record<string, string>;
  warnings: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const warnings: Record<string, string> = {};

  const backend = route.backend.trim();
  const model = route.model.trim();
  const effort = route.effort.trim();

  // Backend validation
  if (!backend) {
    errors[`${routeKey}.backend`] = 'Backend is required.';
  } else if (!isKnownBackend(backend)) {
    errors[`${routeKey}.backend`] = `Unsupported backend "${backend}". Supported: ${ENABLED_BACKENDS.join(', ')}.`;
  }

  // Model validation
  if (!model) {
    errors[`${routeKey}.model`] = 'Model identifier is required.';
  } else if (textEncoder.encode(model).length > 256) {
    errors[`${routeKey}.model`] = 'Model identifier exceeds maximum length (256 bytes).';
  } else if (CONTROL_CHAR_REGEX.test(model)) {
    errors[`${routeKey}.model`] = 'Model identifier contains invalid control characters.';
  } else if (backend === 'omp' || backend === 'pi') {
    const slashIdx = model.indexOf('/');
    if (slashIdx === -1) {
      errors[`${routeKey}.model`] = `${backend.toUpperCase()} models require "provider/model" syntax.`;
    } else {
      const providerPart = model.slice(0, slashIdx).trim();
      const modelPart = model.slice(slashIdx + 1).trim();
      if (!providerPart || !modelPart) {
        errors[`${routeKey}.model`] = `${backend.toUpperCase()} models require non-empty provider and model parts ("provider/model").`;
      }
    }
  }

  // Effort validation
  if (!effort) {
    errors[`${routeKey}.effort`] = 'Effort level is required.';
  } else if (textEncoder.encode(effort).length > 64) {
    errors[`${routeKey}.effort`] = 'Effort level exceeds maximum length (64 bytes).';
  } else if (CONTROL_CHAR_REGEX.test(effort)) {
    errors[`${routeKey}.effort`] = 'Effort level contains invalid control characters.';
  } else if (isKnownBackend(backend) && !isValidEffortForBackend(backend, effort)) {
    const allowed = BACKEND_EFFORTS[backend as AdvisorBackend].join(', ');
    errors[`${routeKey}.effort`] = `Invalid effort "${effort}" for ${backend}. Allowed: ${allowed}.`;
  }

  // Catalog compatibility warning (advisory only, does not invalidate if effort is valid for backend)
  if (catalog && catalog.backend === backend && model && effort) {
    const matchedModel = catalog.models.find((m) => m.id === model);
    if (matchedModel && matchedModel.efforts && matchedModel.efforts.length > 0) {
      if (!matchedModel.efforts.includes(effort)) {
        warnings[`${routeKey}.effort`] = `Model "${model}" advertises efforts: ${matchedModel.efforts.join(', ')}. Current selection is "${effort}".`;
      }
    } else if (catalog.efforts && catalog.efforts.length > 0 && !catalog.efforts.includes(effort)) {
      warnings[`${routeKey}.effort`] = `${backend} catalog advertises efforts: ${catalog.efforts.join(', ')}.`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { normalized: null, errors, warnings };
  }

  return {
    normalized: {
      backend,
      model,
      effort,
    },
    errors,
    warnings,
  };
}

/**
 * Validates the full routing draft: primary and backup routes, plus duplicate check.
 */
export function validateRoutingDraft(
  draft: PolicyRoutingDraft,
  catalogs?: Partial<Record<AdvisorBackend, AdvisorModelsResultDto>> | null,
): RoutingValidationResult {
  const priBackend = draft.primary.backend.trim() as AdvisorBackend;
  const bakBackend = draft.backup.backend.trim() as AdvisorBackend;

  const priCatalog = catalogs && isKnownBackend(priBackend) ? catalogs[priBackend] : null;
  const bakCatalog = catalogs && isKnownBackend(bakBackend) ? catalogs[bakBackend] : null;

  const priRes = validateRoute(draft.primary, 'primary', priCatalog);
  const bakRes = validateRoute(draft.backup, 'backup', bakCatalog);

  const errors: Record<string, string> = {
    ...priRes.errors,
    ...bakRes.errors,
  };

  const warnings: Record<string, string> = {
    ...priRes.warnings,
    ...bakRes.warnings,
  };

  let isDuplicate = false;

  // Check duplicate route triple (backend, model, effort)
  if (priRes.normalized && bakRes.normalized) {
    const p = priRes.normalized;
    const b = bakRes.normalized;
    if (p.backend === b.backend && p.model === b.model && p.effort === b.effort) {
      isDuplicate = true;
      errors['routes'] =
        'Primary and backup routes cannot have the exact same backend, model, and effort.';
    }
  }

  const isValid = Object.keys(errors).length === 0;

  return {
    isValid,
    isDuplicate,
    errors,
    warnings,
    normalized:
      isValid && priRes.normalized && bakRes.normalized
        ? { primary: priRes.normalized, backup: bakRes.normalized }
        : null,
  };
}

/**
 * Checks whether the current draft differs from the baseline policy routes.
 */
export function isDraftDirty(
  draft: PolicyRoutingDraft,
  baselinePolicy: AdvisorPolicyV2 | null | undefined,
): boolean {
  if (!baselinePolicy?.advisor) return true;
  const pri = baselinePolicy.advisor.primary;
  const bak = baselinePolicy.advisor.backup;
  if (!pri || !bak) return true;

  const priDirty =
    draft.primary.backend.trim() !== pri.backend ||
    draft.primary.model.trim() !== pri.model ||
    draft.primary.effort.trim() !== pri.effort;

  const bakDirty =
    draft.backup.backend.trim() !== bak.backend ||
    draft.backup.model.trim() !== bak.model ||
    draft.backup.effort.trim() !== bak.effort;

  return priDirty || bakDirty;
}

/**
 * Creates an initial draft from a baseline policy or sensible defaults.
 */
export function createDraftFromPolicy(
  policy: AdvisorPolicyV2 | null | undefined,
): PolicyRoutingDraft {
  const pri = policy?.advisor?.primary;
  const bak = policy?.advisor?.backup;

  return {
    primary: {
      backend: pri?.backend ?? 'omp',
      model: pri?.model ?? '',
      effort: pri?.effort ?? 'medium',
    },
    backup: {
      backend: bak?.backend ?? 'claude',
      model: bak?.model ?? '',
      effort: bak?.effort ?? 'medium',
    },
  };
}
