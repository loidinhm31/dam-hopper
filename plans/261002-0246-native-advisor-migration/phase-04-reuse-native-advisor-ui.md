# Phase 04: Reuse Advisor UI and replace plugin provider

## Context links

- [Parent plan](./plan.md); [architecture proposal](../../docs/architecture/native-advisor.md).
- [Native contracts and acceptance](./reports/native-design-contract.md).
- [Validated decisions](./reports/validated-decisions.md); decisions already incorporated below.
- [Advisor source inventory](./research/evcrate-advisor-source.md); [retirement inventory](./research/plugin-retirement.md).
- Dependencies: Phase 01 contract frozen; consumes Phases 02–03 APIs.

## Overview

- Date: 2026-10-02. Priority: P2.
- Implementation: pending. Review: pending. Progress: 0%.
- Owner: React Advisor worker; no WorkspacePage/shared client ownership. Estimated implementation effort: 10h.
- Planning only; instructions below are for the later implementation run.

## Key Insights

Reusable source is Evcrate viewer, not generated plugin/ui/index.html. Viewer app imports DamHopperPortProvider by default, provider lifecycle/frame fields, global CSS and window hash tabs. Copying bootstrap verbatim would preserve plugin coupling and corrupt native routing/styles.

## Requirements

All four views, metrics/provenance, history filters/details, configuration status and evaluations comparison. Native owner-bound transport with abort/late-result fences. No path-hash utility presentation or source identity field. No iframe, srcdoc, MessagePort, nested React root, sibling checkout imports or copied ambient React declarations.

## Architecture

CREATE packages/ui/src/advisor/{AdvisorPanel.tsx,advisor-data-provider.ts,native-advisor-provider.ts,advisor-types.ts,app-state-reducer.ts,app-state-selectors.ts,app-state-types.ts,advisor.css,components/,views/}. Preserve pure domain logic, rename generic app files if needed to existing kebab-case convention. Component filenames PascalCase. One small provider adapter retains domain operations, not generic plugin capability/lifecycle framework.

## Related code files

COPY/ADAPT /home/loidinh/WS/evcrate/viewer/src/{app.tsx,app-state*.ts,app-actions.ts,components/,views/,styles.css} into /home/loidinh/WS/dam-hopper/packages/ui/src/advisor/.
COPY only used pure helpers from /home/loidinh/WS/evcrate/src/protocol/ into native owned domain modules; retain producer source in Evcrate.
CREATE /home/loidinh/WS/dam-hopper/packages/ui/src/advisor/native-advisor-provider.ts; consume ApiClient.advisor (integration owner).
DO NOT COPY /home/loidinh/WS/evcrate/{plugin/ui/index.html,plugin/ui/plugin-main.tsx,viewer/src/react-ambient.d.ts,viewer/src/providers/dam-hopper-port-provider.ts,viewer/src/providers/bridge-contract.ts}.

## Implementation Steps

1. Use source dependency-closure inventory to copy only UI-used domain validators/formatters/types. Collapse plugin-specific error constants and enums into native domain error/status types; no dependency on plugin-sdk or Node builtins in browser bundle.
2. Require an explicit native provider/owner input; delete default DamHopperPortProvider construction, frameSession/activationGeneration and bridge lifecycle state. Preserve request sequence/query revision checks using actual profile/connection/source identity.
3. Implement eight provider methods over captured ApiClient; request IDs map to AbortControllers. Existing REST transport must carry signal through supported seam; do not fake cancellation by no-op. Rejected/aborted late responses cannot commit reducer state after owner/query replacement.
4. Preserve reducer transitions: refresh/stale, selected project/all activity, filter/query revision, detail changed/missing, policy and evaluation states, comparison eligibility. Owner replacement clears inaccessible data; changing layout within same owner preserves tabs/filters/detail.
5. Replace hash tab writes/listeners with local panel state and native owner-qualified state if persistence already exists. Preserve arrow/Home/End roving-tab behavior and Escape pass-through; do not change Workspace route/hash for Advisor tabs.
6. Scope every copied CSS selector/variable/reset/media rule under `.native-advisor`; replace :root/body/global element rules with panel root styles and Dam-Hopper theme tokens. Scope keyframes and generic class names to prevent surrounding controls changing.
7. Remove plugin isolation/registration banners and capability toggles. Render native source path availability and meaningful error states, including explicit final-root symlink rejection. No path-hash field, generation/copy action or hashing error state. Source hash-tabs means URL routing only; replace it with panel-local tabs, not a path utility.
8. Evaluation view consumes actual native discovered sources from Phase 03; no new local picker/upload feature. Preserve selected comparison/detail only within captured owner; clear on profile change or disable.
9. After backend/client integration, exercise real browser four views with fixture values, filter changes and changed-revision details. Compare visible metrics/statuses against baseline; record screen captures across light/dark and narrow layouts.

## Todo list

- [ ] Use source dependency-closure inventory to copy only UI-used domain validators/formatters/types. Collapse plugin-specific error constants and enums into native domain error/status types; no dependency on plugin-sdk or Node builtins in browser bundle.
- [ ] Require an explicit native provider/owner input; delete default DamHopperPortProvider construction, frameSession/activationGeneration and bridge lifecycle state. Preserve request sequence/query revision checks using actual profile/connection/source identity.
- [ ] Implement eight provider methods over captured ApiClient; request IDs map to AbortControllers. Existing REST transport must carry signal through supported seam; do not fake cancellation by no-op. Rejected/aborted late responses cannot commit reducer state after owner/query replacement.
- [ ] Preserve reducer transitions: refresh/stale, selected project/all activity, filter/query revision, detail changed/missing, policy and evaluation states, comparison eligibility. Owner replacement clears inaccessible data; changing layout within same owner preserves tabs/filters/detail.
- [ ] Replace hash tab writes/listeners with local panel state and native owner-qualified state if persistence already exists. Preserve arrow/Home/End roving-tab behavior and Escape pass-through; do not change Workspace route/hash for Advisor tabs.
- [ ] Scope every copied CSS selector/variable/reset/media rule under `.native-advisor`; replace :root/body/global element rules with panel root styles and Dam-Hopper theme tokens. Scope keyframes and generic class names to prevent surrounding controls changing.
- [ ] Remove plugin isolation/registration banners and capability toggles. Render native source path availability and meaningful error states, including explicit final-root symlink rejection. No path-hash field, generation/copy action or hashing error state. Source hash-tabs means URL routing only; replace it with panel-local tabs, not a path utility.
- [ ] Evaluation view consumes actual native discovered sources from Phase 03; no new local picker/upload feature. Preserve selected comparison/detail only within captured owner; clear on profile change or disable.
- [ ] After backend/client integration, exercise real browser four views with fixture values, filter changes and changed-revision details. Compare visible metrics/statuses against baseline; record screen captures across light/dark and narrow layouts.

## Success Criteria

Native panel shows source-equivalent four tabs and fixture content with no iframe or path-hash utility. Tabs do not alter Workspace route; CSS does not restyle surrounding shell. Aborted/stale requests never display old-owner data. All existing operation-driven UI functions work; no perpetual placeholders or fake transport.

## Risk Assessment

Retaining source reducer blindly leaks plugin frame state. CSS collision and route hash interference are user-visible regressions. Source UI is nontrivial; dependency closure must be complete before Evcrate integration deletion.

## Security Considerations

Render policy/record/evaluation strings through React escaped content and existing safe markdown policy; never raw HTML. Current admin role drives access; no credentials inside provider descriptors or source dumps.

## Next steps

Hand native component/provider to Phase 05; source integration remains until full parity gate.

Unresolved questions: see parent plan; do not silently reduce acceptance or invent missing source behavior.
