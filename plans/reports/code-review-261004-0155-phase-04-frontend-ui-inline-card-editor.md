# Code Review Summary: Phase 04 Inline Routing Editor

## Scope
- Files reviewed:
  - `packages/ui/src/advisor/policy-routing-validation.ts` (253 lines)
  - `packages/ui/src/advisor/components/RouteFieldset.tsx` (236 lines)
  - `packages/ui/src/advisor/components/PolicySummaryCard.tsx` (561 lines)
  - `packages/ui/src/advisor/views/ConfigurationView.tsx` (155 lines)
  - `packages/ui/src/advisor/AdvisorPanel.tsx` (977 lines)
  - `packages/ui/src/advisor/advisor.css` (+152 lines scoped)
  - `packages/ui/src/advisor/index.ts` (137 lines)
  - `packages/ui/src/advisor/policy-routing-validation.test.ts` (188 lines)
  - `packages/ui/src/advisor/components/PolicySummaryCard.test.tsx` (336 lines)
  - `packages/ui/src/advisor/AdvisorPanel.test.tsx` (536 lines)
- Lines of code analyzed: ~3,430 lines
- Review focus: Inline routing editor implementation, security sanitization, operation sequence fencing, backend contract parity, accessibility, and error handling.
- Updated plans: `plans/261003-1822-advisor-routing-model-selector/phase-04-frontend-ui-inline-card-editor.md`

## Overall Assessment
Solid engineering execution with strict parity to Rust backend policy validation contracts. Reuses existing `POLICY_COMMIT` reducer action cleanly without introducing unnecessary global state stores or heavyweight form libraries. Robust sequence fencing in `AdvisorPanel` prevents slow background policy reads from downgrading newer saves. Comprehensive ARIA attributes and focus management. 

Two actionable defects identified:
1. `PolicySummaryCard.tsx`'s `hasUpdatePerm` permits edit capability when `capabilities.length === 0`, violating Phase 04 requirement that write access requires explicit `policy.update`.
2. `PolicySummaryCard.tsx`'s `handleReload` suffers from a stale closure on `policy` and `revision` after awaiting `onReloadPolicy()`, setting `draft` and `baselineRevisionRef` back to obsolete values instead of fresh server data.

- **Score**: 8.5/10

---

## Critical Issues
None blocking compilation, execution, or automated test suites.

---

## Warnings (High Priority Findings)

### 1. `hasUpdatePerm` grants write access on empty capabilities array
- **Location**: `packages/ui/src/advisor/components/PolicySummaryCard.tsx:56`
- **Impact**: When server or probe reports disabled status or an unauthorized actor (`capabilities: []`), `hasUpdatePerm` evaluates to `true` due to `capabilities.length === 0`. This directly violates Requirement 19: *"Card's `capabilities.length === 0` read compatibility must not enable a write. Require explicit `policy.update`, usable callbacks, ready V2 policy, visible/active owner, and no pending save."*
- **Fix**:
```typescript
// packages/ui/src/advisor/components/PolicySummaryCard.tsx
const hasPolicyPerm = capabilities.length === 0 || capabilities.includes('policy.readCurrent');
const hasUpdatePerm = capabilities.includes('policy.update');
```
Ensure `canEdit` also confirms provider availability (`state.isAvailable`).

### 2. Stale closure in `handleReload` resets draft to outdated policy
- **Location**: `packages/ui/src/advisor/components/PolicySummaryCard.tsx:236-250` & `packages/ui/src/advisor/AdvisorPanel.tsx:831-863`
- **Impact**: `handleReloadPolicy` returns `Promise<void>`. After awaiting `onReloadPolicy()`, `handleReload` executes:
  ```typescript
  baselineRevisionRef.current = revision;
  baselinePolicyRef.current = policy;
  setDraft(createDraftFromPolicy(policy));
  ```
  `policy` and `revision` are closed over from the render prior to the reload dispatch. `state.contextEpoch` does not mutate during `POLICY_COMMIT`, so the epoch effect does not trigger. Consequently, `draft` and `baselineRevisionRef` are restored to the stale baseline rather than the reloaded server policy.
- **Fix**: Return `Promise<PolicyReadCurrentResultDto | null>` from `handleReloadPolicy` and `onReloadPolicy`, consuming the returned DTO directly:
```typescript
// packages/ui/src/advisor/AdvisorPanel.tsx
const handleReloadPolicy = useCallback(async (): Promise<PolicyReadCurrentResultDto | null> => {
  if (!mountedRef.current) return null;
  // ...
  const policy = await capturedProvider.readCurrentPolicy(reqId);
  if (/* guards */) {
    dispatch({ type: 'POLICY_COMMIT', policy, contextEpoch: epoch });
    return policy;
  }
  return null;
}, [/* deps */]);

// packages/ui/src/advisor/components/PolicySummaryCard.tsx
const handleReload = useCallback(async () => {
  if (!onReloadPolicy) return;
  setIsSaving(true);
  try {
    const res = await onReloadPolicy();
    if (res) {
      baselineRevisionRef.current = res.revision ?? 'none';
      baselinePolicyRef.current = res.policy as AdvisorPolicyV2 | undefined;
      setConflictDetected(false);
      setSaveError(null);
      setDraft(createDraftFromPolicy(res.policy as AdvisorPolicyV2 | undefined));
    }
  } finally {
    setIsSaving(false);
  }
}, [onReloadPolicy]);
```

---

## Medium Priority Improvements

### 1. `fetchCatalog` callback dependency instability causes redundant effect cycles
- **Location**: `packages/ui/src/advisor/components/PolicySummaryCard.tsx:100-134`
- **Impact**: `fetchCatalog` depends on `[onLoadRoutingModels, catalogs, catalogLoading]`. In `useEffect`, it triggers `fetchCatalog` for primary and backup backends. When `catalogLoading` updates, `fetchCatalog`'s reference changes, causing the effect to re-run multiple times during initial discovery.
- **Suggestion**: Use a ref for loading/catalog presence checks inside `fetchCatalog` or functional state updates, stabilizing `fetchCatalog`'s reference.

### 2. Layout shift / custom input flicker during initial catalog loading
- **Location**: `packages/ui/src/advisor/components/RouteFieldset.tsx:70-73`
- **Impact**: `const isModelInCatalog = catalogModels.some((m) => m.id === route.model);`
  When entering edit mode, `catalog` is initially `undefined`. `isModelInCatalog` evaluates to `false`, causing `showCustomInput` to be `true` and the select to display "Custom model…". Once discovery resolves, `isModelInCatalog` becomes `true`, causing the custom input to unmount abruptly.
- **Suggestion**: Suppress automatic fallback to custom mode while `isCatalogLoading` is active unless `isCustomMode` was explicitly set by user action.

---

## Low Priority Suggestions

1. **File size modularity**: `PolicySummaryCard.tsx` is 561 lines. Consider atomizing `<PolicyDisclosure>` and status banner branches into small sub-components to adhere to `<200` lines guideline.
2. **Memoize `handleBackendChange`**: Wrap `handleBackendChange` in `useCallback` to prevent unnecessary prop reference churn to `RouteFieldset`.
3. **Trace jsdom navigation errors**: In the full UI test suite, trace the two `Error: Not implemented: navigation` notices in jsdom to isolate and silence test stderr traces.

---

## Positive Observations
- **Contract Parity**: `policy-routing-validation.ts` faithfully mirrors `server/src/advisor/policy.rs` (backends, effort sets, 256/64-byte caps, control characters, `provider/model` slash syntax, exact duplicate triple logic).
- **Concurrency & Fencing**: Sequence counter (`policyOperationSeqRef`) prevents older background `refreshData` or slow reads from overwriting recent saves. Verified by dedicated race test.
- **Request Cancellation**: In-flight catalog requests are cleanly tracked and cancelled via `activeProvider.cancel(reqId)` on edit cancel and unmount.
- **Accessibility**: Semantic HTML (`<fieldset>`, `<legend>`, `<label htmlFor="...">`), `aria-invalid`, `aria-describedby`, live polite status region, Enter submission guards, and Escape key cancellation.
- **CSS Scoping**: All editor rules strictly scoped under `.native-advisor`, using existing design tokens with responsive layout down to narrow docks.

---

## Recommended Actions
1. Fix `hasUpdatePerm` in `PolicySummaryCard.tsx` to strictly check `capabilities.includes('policy.update')`.
2. Update `handleReloadPolicy` and `onReloadPolicy` signatures to return `Promise<PolicyReadCurrentResultDto | null>` and update `handleReload` to apply the reloaded DTO directly.
3. Guard `showCustomInput` in `RouteFieldset.tsx` during initial loading to eliminate UI flicker.

---

## Metrics
- **Type Coverage**: 100% strict TypeScript (`tsc --noEmit` clean)
- **Advisor Unit Tests**: 70/70 passed (100%)
- **Full UI Package Tests**: 2,283/2,283 passed across 299 files (100%)
- **Lint / Syntax Errors**: 0

## Validation Commands and Results
- `pnpm --filter @dam-hopper/ui test src/advisor/` -> 7 files passed, 70 passed, 0 failed (1.42s)
- `pnpm --filter @dam-hopper/ui exec tsc --noEmit -p tsconfig.json` -> Passed; 0 errors (16.07s)
- `pnpm --filter @dam-hopper/ui test` -> 299 test files passed, 2,283 passed, 0 failed (20.95s)

---

## Unresolved Questions
None. All specifications and contracts verified against code and server schemas.
