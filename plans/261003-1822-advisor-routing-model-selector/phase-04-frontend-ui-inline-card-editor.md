# Phase 04 — PolicySummaryCard Inline Editor

## Context Links

- [Plan/preflight/side effects](./plan.md); [current progress](./progress.md); [Phase 03 transport](./phase-03-frontend-transport-data-provider.md); [Phase 05 qualification](./phase-05-verification-quality-gates.md).
- [Scout UI findings](../reports/scout-261003-1822-advisor-routing-model-selector.md#3-advisor-ui-and-state-integration).
- [PolicySummaryCard](../../packages/ui/src/advisor/components/PolicySummaryCard.tsx), [ConfigurationView](../../packages/ui/src/advisor/views/ConfigurationView.tsx), [AdvisorPanel](../../packages/ui/src/advisor/AdvisorPanel.tsx), [native ownership](../../docs/architecture/native-advisor.md#native-ownership-and-dataflow).

## Overview

- Date: 2026-10-03. Priority: P2. Status: implemented, reviewed; captured statuses historical. Effort: 8h.
- Add inline edit mode to the existing **Active Owner Policy** card, not a modal/settings page/new tab. Preserve observational summary, wait/history disclosure, and historical route groups.

## Key Insights

- Card and `ConfigurationView` currently receive only `state`; panel owns provider requests. Keep network ownership in panel and draft UI in card.
- `POLICY_COMMIT` already updates `currentPolicy` and bound policy state with context-epoch checks; reuse it for successful save.
- `refreshData` makes independent policy reads after history loading. Provider+epoch fences alone do not prevent an older policy read from overwriting a newer save; add a policy operation sequence fence.
- Card's `capabilities.length === 0` read compatibility must not enable a write. Require explicit `policy.update`, usable callbacks, ready V2 policy, visible/active owner, and no pending save.
- Backend names describe harnesses. `omp`/`pi` model IDs may include provider prefixes; never split/drop that prefix for the stored model value.

## Requirements

### User Journey

1. Ready V2 card exposes **Edit Routing**; non-editable/unauthorized states retain existing status notices and no active edit action.
2. Click opens two labeled fieldsets, **Primary Route** and **Backup Route**, in the same card. Initialize draft and `expectedRevision` from the authoritative displayed policy.
3. Each route offers backend selector (`omp`, `codex`, `claude`, `pi`), model picker populated by its backend catalog, **Custom model…** selection with labeled text input, and effort selector.
4. Discover catalogs lazily on entering edit mode and when selected backend changes. Loading/fallback/diagnostic state visible per backend; fallback source clearly labeled. Discovery failure never removes custom entry or the existing route.
5. Existing model absent from catalog remains preserved as custom; existing effort not in catalog remains visible as current value until a deliberate replacement. Do not silently substitute first model/effort on initial load.
6. Validate live: trimmed nonempty model, known backend, producer-compatible effort, size/control-character rules, and exact normalized triple duplication. Same backend/model with different effort is allowed.
7. **Save Routing** disabled while unchanged, invalid, loading a necessary effort contract, or saving. **Cancel** discards draft and closes edit without a write; disabled during dispatched save to avoid implying rollback. Controls disabled while saving; one mutation per click/keyboard submission.
8. On success show server-returned policy/revision immediately and close editor. On validation/write failure retain draft and display sanitized inline error; on conflict retain draft, show **Reload Policy** action, do not auto-overwrite or auto-retry.
9. Wait/history fields remain read-only disclosure. Current owner policy stays account-wide regardless of History project/activity filters.

### Accessibility / Presentation

- Form with fieldsets/legends, associated labels, select/input focus styling, `aria-invalid`/`aria-describedby`, inline `role="alert"`, and polite status region.
- Focus first field on open; return focus to Edit Routing on successful save/cancel. Keyboard Enter submits only valid form; Escape cancels edit before outer panel close when not saving, with intentional event propagation.
- During in-flight save, Escape must not cancel the durable operation or falsely announce cancellation; host closure may hide/unmount UI and will suppress late publication.
- Responsive single-column route controls in compact/narrow layouts; existing theme variables and `.native-advisor` CSS scoping only. No global button/select/reset rules or new select dependency.

## Architecture

- `PolicySummaryCard`: local edit/draft/custom-entry/catalog-display/errors state and pure validation; display server authoritative summary outside draft mode.
- `AdvisorPanel`: owner-bound `onLoadRoutingModels(backend)`, `onSaveRouting(params)`, `onCancelRoutingEdit()` callbacks, request IDs/abort bookkeeping, authoritative `POLICY_COMMIT` publication. `ConfigurationView` passes these callbacks unchanged.
- Panel tracks catalog request IDs by backend and save request ID. Card derives unique required backends from two draft rows; load once per backend per edit session, retain completed catalogs only within the captured owner/edit session. Backend changes cancel no-longer-needed requests, never another row's still-needed backend query.
- Use a small callbacks object/type only if existing prop conventions favor it; no shared global model store, generic form framework, or new reducer subsystem. Proposed pure helper `validateRoutingDraft` in `policy-routing-validation.ts` centralizes UI rules and normalization for tests.
- `policyOperationSeqRef` increments on each policy read/save. Existing `refreshData` policy read and new save commits require matching provider, epoch, sequence, and mounted/active context; stale pre-save reads cannot downgrade the new policy.
- Editor session token/React key includes provider identity revision + context epoch. Context switch/disconnect/revoke/unmount cancels catalog requests, discards draft/catalogs, and rejects obsolete continuations. Mutation cancellation never promises disk rollback.

## Related Code Files

| Action | Repository path | Change |
|---|---|---|
| Modify | `packages/ui/src/advisor/components/PolicySummaryCard.tsx` | Inline form, local draft, custom model, catalog notices, validation, focus |
| Modify | `packages/ui/src/advisor/views/ConfigurationView.tsx` | Forward typed routing callbacks; historical section untouched |
| Modify | `packages/ui/src/advisor/AdvisorPanel.tsx` | Owner-bound catalog/save operations, request cleanup, sequence fences, policy commit/reload |
| Modify | `packages/ui/src/advisor/advisor.css` | Scoped form/route/control/status/responsive styling |
| Create | `packages/ui/src/advisor/policy-routing-validation.ts` | Small pure normalizer/validator, duplicate triple logic; no transport |
| Create | `packages/ui/src/advisor/policy-routing-validation.test.ts` | Pure validation and effort/custom identity cases |
| Create | `packages/ui/src/advisor/components/PolicySummaryCard.test.tsx` | Editor behavior using existing React `createRoot`/`act` jsdom pattern |
| Modify | `packages/ui/src/advisor/AdvisorPanel.test.tsx` | Save/catalog wiring and old-read/old-owner races |
| Modify only if required | `app-actions.ts`, `app-state-types.ts`, `app-state-reducer.ts`, related tests under `packages/ui/src/advisor/` | Prefer existing `POLICY_COMMIT`; add no broad draft/catalog reducer state unless current lifecycle requires it |
| Delete | None | Read summary/disclosure and historical groups retained |

## Implementation Steps

1. Define callback props in card/view and wire them from panel. Establish editor-session identity, explicit write permission, pending state, and cancellation semantics before controls. No card access to global `api` or Settings profile.
2. Add routing operation handlers in panel using `makeRequestId`, captured provider/epoch, mounted state, and per-operation sequence. Catalog handlers validate response backend equals requested backend and return only current-session results. Cancellation uses `provider.cancel(id)` for editor-owned IDs only.
3. Introduce shared policy sequence fencing for both existing `refreshData` reads and save. A save invalidates older policy reads; a new read must not start while save is committing, or must wait and then become authoritative. Do not dispatch optimistic `POLICY_COMMIT` with draft values.
4. Add Edit Routing action to card's ready-policy header. Opening captures routes/revision once, not on every props update. Background reread/revision change while dirty displays a stale-baseline notice; never overwrite unsaved draft. Keep server expectedRevision check as authority.
5. Render native select controls and labeled custom input. Model picker value is exact catalog ID; use a collision-safe custom sentinel not stored as a model. Include current out-of-catalog route as custom. Backend change preserves user-entered custom text; a previously selected catalog model is not silently treated as valid for another backend—switch explicitly to custom, show cross-backend notice, and require user confirmation/selection before Save.
6. Load unique draft backends. Show `source: harness` or `source: fallback` with sanitized issue explanation. Never block a custom model solely because absent from a list. Late catalog from prior backend/edit session cannot replace active model/effort or error state.
7. Populate efforts from model-specific `efforts`, otherwise backend `efforts`; preserve current value if not advertised and mark compatibility feedback. Changing backend/model does not silently reset effort: prompt user to choose valid value when existing value is unsupported. Server remains final validator.
8. Implement `validateRoutingDraft`: outer trim only, backend closed union, printable model (at most 256 UTF-8 bytes)/effort (at most 64), `provider/model` syntax for OMP/Pi, their closed producer thinking set, and exact equality of backend/model/effort. Use catalog effort compatibility feedback where available without making custom model membership mandatory; do not reject a bounded custom Codex model merely because its effort catalog is unavailable. Run on each change and before submission; disabled Save + inline duplicate message and field associations. Compare normalized draft to baseline for dirty state.
9. Save route-only payload with captured revision; disable controls/double-submit. Successful handler dispatches existing `POLICY_COMMIT` with returned DTO and matching context; card closes only for current session. Failure keeps draft. Conflict offers intentional policy-only Reload, warns draft will be replaced, and never automatically resubmits. Post-commit uncertainty triggers/recommends current-policy reread before another save.
10. Wire Cancel/Escape/close/disconnect/unmount cleanup and focus restoration. Avoid success/error announcements after unmount or owner switch. On provider/epoch change clear all previous owner's draft, catalogs, and validation errors.
11. Add `.native-advisor .policy-routing-editor`, route-grid, form-field, actions, error/status, and narrow viewport rules beside existing policy styles. Retain theme tokens and Radix patch; no replacement of unrelated controls.
12. Author jsdom and panel race tests alongside feature changes; Phase 05 owns executing browser/unit verification and docs update.

## Todo List

- [x] Typed callbacks and panel owner/request/sequence fencing.
- [x] Inline primary/backup controls, custom entry, dynamic/fallback catalogs.
- [x] Pure normalized validation and producer-compatible effort selection.
- [x] Save/cancel/conflict/uncertain-failure flows with authoritative policy commit.
- [x] Cleanup on lifecycle changes, keyboard/focus behavior, scoped responsive styling.
- [x] Card/panel/validation tests authored; no implementation completion claimed before qualification.

## Success Criteria

- User completes requested journey entirely inside Active Owner Policy card; exact selected/custom values appear in saved summary/revision.
- Duplicate route feedback updates immediately and blocks Save; changing only effort can resolve duplicate.
- Harness/fallback catalog labels and custom option work independently for all four backends; prefix-qualified IDs remain intact.
- Cancel produces zero mutation calls; double-submit produces one; failures retain draft; conflict reload requires deliberate action.
- Older read after save, older backend catalog, destroyed provider, and switched owner cannot publish stale data. Switching History filter does not scope the saved policy to a project.
- Wait/history display and historical route groups retain existing values/behavior; selectors, CSS, focus, and narrow layouts remain accessible.

## Risk Assessment

- **Old read overwrites new save:** policy sequence fence in panel, test deferred read resolves after successful mutation.
- **Catalog changes unexpectedly reset input:** preserve existing/current custom values; stable exact IDs; explicit user choice on incompatibility.
- **Draft appears on another profile:** reset by captured provider+context identity and abort all editor-owned requests.
- **Host Escape interaction:** editor stops propagation only for local cancel; no modal or global listener.
- **Overbuilt state:** keep ephemeral draft/catalog state local, authoritative policy in existing reducer, no second provider/store.

## Security Considerations

- Explicit write capability, server admin+enabled authority, fixed route-only payload. No credentials/path/config fields or raw command output in UI.
- React text rendering for model IDs and error descriptions; no `dangerouslySetInnerHTML`.
- Profile/connection owner captured at dispatch. Cancellation suppresses response/UI; does not undo a durable server commit.

## Next Steps

Phase 05 exercises `pnpm --filter @dam-hopper/ui test src/advisor` and focused Vitest Browser Mode editor coverage. Parent reviews screenshots/keyboard flow at compact and wide widths; no full-stack E2E claim from mocked browser tests.

## Unresolved Questions

None requiring user input.
