# Phase 03 — Profile-qualified Agent Store settings navigation

## Context links
- [Overview/ownership](plan.md), [frozen navigation contract](contracts.md#phase-3-navigation-module-and-page-boundary), [main contract](reports/02-planner-contract.md).
- [Code evidence](reports/01-codebase-analysis.md), [harness research](research/researcher-02-report.md), [risk review H3](reports/03-design-risk-review.md).
- Read-only: `packages/ui/src/api/connections.ts`, `packages/ui/src/api/server-config.ts`, `packages/ui/src/api/ownership.ts`, `packages/ui/src/api/queries.ts`, `packages/ui/src/components/organisms/AgentSettings.tsx`, `packages/ui/src/components/organisms/MemoryEditor.tsx`, `packages/ui/src/components/organisms/ShipDialog.tsx`, `packages/ui/src/components/organisms/ImportDialog.tsx`.
- Standards/boundary: `docs/code-standards.md`, `docs/project-overview-pdr.md`, `docs/architecture/agent-store-ports-and-browser.md`, `docs/architecture/agent-status.md`.

## Parallelization Info
- Group A; independent authoring with phases 1/2. No runtime/model dependency; existing Agent Store and connection APIs suffice.
- Owns 4 paths. Integrator consumes `buildAgentSettingsHref`; navigator receives finished href as string. No source overlap or shared type/schema setup.
- Author tests without execution; phase 4 runs page/helper coverage once with integrated application journey.

## Overview
- Date: 2026-10-08. Priority: P2. Estimate: 3h.
- Description: Resolve Settings intent to deliberate server profile/current owner generation without ambient fallback.
- Implementation status: authored, validated, user-approved; controller completion pending (NOT DONE). Review status: cycle 2 terminal reviewer 9/10 approved, canonical advice ADVICE_READY, user approved.

## Delivered Implementation & APIs
- Exported helper types and functions (`packages/ui/src/lib/agent-store-navigation.ts`):
  - `AgentStoreTab`: `"store" | "memory" | "settings" | "import"`
  - `AgentStoreProfileRequest`: `{ readonly kind: "default" } | { readonly kind: "choose" } | { readonly kind: "explicit"; readonly profileId: string } | { readonly kind: "invalid" }`
  - `AgentStoreLocation`: `{ readonly tab: AgentStoreTab; readonly profile: AgentStoreProfileRequest }`
  - `buildAgentSettingsHref(profileId: string | null): string`: builds `/agent-store?tab=settings` when null, or `/agent-store?tab=settings&profileId=<encoded>` when profileId provided.
  - `parseAgentStoreLocation(search: string): AgentStoreLocation`: parses tab and profile independently; recognizes invalid empty/repeated profiles; preserves chooser intent on settings tab when profile is absent.
- Delivered page-local connected boundary & chooser behavior (`packages/ui/src/components/pages/AgentStorePage.tsx`):
  - Chooser-only disabled tabs: all four tab buttons (`store`, `memory`, `settings`, `import`) have `disabled={location.profile.kind === "choose"}`. This structurally blocks tab navigation from escaping an unresolved chooser before deliberate profile selection. Direct bare entry still uses ordinary default profile.
  - Registered-connected keyed child denial: `ConnectedAgentStore` mounts ONLY when `owner && selectedProfile` (where `owner` requires `snapshot?.status === "connected"` and `snapshot.owner.profileId === selectedProfile.id`), uniquely keyed by `key={connectionKey(owner)}`.
  - Under invalid, chooser, disconnected, or removed profile states, the query-bearing child is not mounted; inline denial and the profile picker remain visible. No page-owned store, matrix, or project query requests execute, and owner-bound child/dialog state retires. Existing app-root connection/status work is separate from this boundary.
  - Deliberate profile selection sets URL `tab` and `profileId` search params without modifying global active profile. Tab changes on default selection persist the selected profile ID in URL.
  - Reconciled documentation: parent-owned finalization reconciled `docs/architecture/agent-store-ports-and-browser.md` to document removal denial instead of obsolete automatic fallback.

## Scoped Validation & Verification Links
- Scoped actual validation links: [Batch A Validation Report — Actual validation](reports/07-batch-a-validation.md#actual-validation) and [Post-correction evidence](reports/07-batch-a-validation.md#post-correction-evidence).
- Test evidence: 19 tests in `agent-store-navigation.test.ts` and 26 tests in `AgentStorePage.test.tsx` (45 tests total) passing; verified in full UI suite (326/326 files, 2694/2694 tests pass, UI build exit 0).
- Actual browser smoke: Real Vite UI with two isolated real authenticated SQLite-backed fixture servers confirmed:
  - Chooser-only tab disablement prevented tab escape under ownerless Settings, generating zero Agent Store requests;
  - Deliberate B selection mounted real Settings with inventory and matrix requests routed exclusively to B's origin, leaving global active profile A unchanged;
  - Browser Back restored ownerless chooser with disabled tabs; Forward restored explicit B Settings;
  - Ordinary bare entry selected valid default A;
  - Unknown, empty, disconnected, and removed explicit profiles retained denial through tab navigation with zero Agent Store requests.
- Scoped qualification limits: URL routing, encoding, chooser-only disablement, and query mount boundaries verified; complete settings workflow, installer actions, live harness events, and integrated application qualification remain phase 4-owned.

## Key Insights
- Agent Store catalog is artifacts/inventory, not live agents. Existing Agent Settings already configures OMP/Codex/Claude paths/readiness; no installation backend rewrite.
  - Before cutover, the page fell back to the first profile and memoized owner only by profile ID. The delivered boundary now reacts to same-profile generation changes and denies removed explicit targets.
- Existing inventory/matrix/projects hooks without an owner route through ambient APIs. Passing `undefined` or synthetic generation 0 is not denial.
- Local query-bearing connected child prevents accidental API work for invalid/disconnected targets without widening query APIs or modifying shared modules.

## Requirements
- Exact helper exports/types from contracts: `AgentStoreTab`, `AgentStoreProfileRequest`, `AgentStoreLocation`, `buildAgentSettingsHref(profileId: string | null): string`, `parseAgentStoreLocation(search: string): AgentStoreLocation`.
- Link concrete registered target `/agent-store?tab=settings&profileId=<encoded-value>`; disconnected target retains that ID. Null -> `/agent-store?tab=settings` with explicit chooser semantics.
- Parse tab/profile separately with one URLSearchParams decode. Explicit nonempty value is never interpreted as default; empty/repeated/unknown/removed explicit profiles fail closed. Ordinary bare Agent Store route retains normal default selection.
- React to current URL intent on initial load, reload, in-app same-page links and Back/Forward. User selection deliberately updates local target/route; never global active profile.
- Preserve unavailable explicit profile and show clear connection state; no automatic connect/install/notification toggle/mutation. Chooser offered even if only one profile exists when no owner is specified.
- Re-resolve exact selected profile generation via existing `useConnectionSnapshot`; mount queries/Settings/dialogs only for registered connected owner. Old owner-bound dialog/item/feedback state retires on generation change.

## Architecture
- Small pure navigation helper; no route registry addition, generic adapter, shared schema or global state.
- Page shell owns URL/current tab/target/profile chrome and validity. Existing profile subscription remains stable; current connection subscription supplies concrete snapshot owner.
- Refactor query-owning area to one **page-local** child in `AgentStorePage.tsx`, receiving `{ owner: ConnectionRef; profileId: string; activeTab: AgentStoreTab }`. Mount/key it by `connectionKey(owner)` only while registered and connected. No child mounted in choose/invalid/removed/disconnected/loading/unsupported state.
- Connected child contains existing useAgentStoreItems/useAgentStoreMatrix/useProjects and item/dialog state; passes concrete captured owner through HealthStatus, DistributionMatrix, MemoryEditor, AgentSettings, ShipDialog and ImportDialog as before.
- Invalid/disconnected shell renders explanation + deliberate profile picker; selected request is not rewritten to first profile. Keep explicit removed requested identity until user chooses another, even when global active profile changes.
- Ordinary no-target entry may choose valid active/first profile initially, matching current workflow; after target removal no silent replacement. Settings intent without profile means choose rather than initial-default branch.
- Use existing API owner guards. Reactivity/remount clears actionable stale children; do not add retry behavior or mutate API/query transports. No no-owner API props.

## Related code files
- Create/proposed `/home/loidinh/WS/dam-hopper/packages/ui/src/lib/agent-store-navigation.ts` — href/parser/types.
- Create/proposed `/home/loidinh/WS/dam-hopper/packages/ui/src/lib/agent-store-navigation.test.ts` — URI round-trip/intent cases.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/pages/AgentStorePage.tsx` — reactive URL profile resolution and connected query boundary.
- Modify `/home/loidinh/WS/dam-hopper/packages/ui/src/components/pages/AgentStorePage.test.tsx` — routing/owner-denial/reconnect behavior.
- Parent-owned finalization: `docs/architecture/agent-store-ports-and-browser.md` — reconcile the obsolete selected-profile-removal fallback statement after review/approval, without changing other subsystem documentation.

## File Ownership
| Absolute path | Action | Exclusive owner |
|---|---|---|
| `/home/loidinh/WS/dam-hopper/packages/ui/src/lib/agent-store-navigation.ts` | Create/proposed | Phase 03 |
| `/home/loidinh/WS/dam-hopper/packages/ui/src/lib/agent-store-navigation.test.ts` | Create/proposed | Phase 03 |
| `/home/loidinh/WS/dam-hopper/packages/ui/src/components/pages/AgentStorePage.tsx` | Modify | Phase 03 |
| `/home/loidinh/WS/dam-hopper/packages/ui/src/components/pages/AgentStorePage.test.tsx` | Modify | Phase 03 |
No deletions; no query/store/connections/settings component/backend changes.

## Implementation Steps
1. Implement frozen helper: recognized tabs only; classify default/choose/explicit/invalid without truthiness fallback. Concrete href encodes profile value only; null chooser href remains distinguishable by settings intent.
2. Add existing React Router search/location hooks to page. Recognize current request reactively; ordinary no-target initial selection uses validated active/first profile, explicit request holds exact ID, settings-without-ID starts chooser. Unknown/removed/empty explicit target retains denial until deliberate selection.
3. Make selector available for chooser/invalid/unavailable, not only `profiles.length > 1`. Deliberate selection writes valid `profileId` into query while preserving current tab; route changes re-resolve intent. Update tab URL or equivalent controlled state consistently so Back/Forward/same-page links do not resurrect stale tab/target.
4. Replace nonreactive owner useMemo with `useConnectionSnapshot` for the exact selected ID. Do not fabricate owner generation, connect an unrelated server or pass absent owner to remote child.
5. Move query-bearing feature content/dialog state into page-local connected child; keep page actions/tab/chooser layout and loading/error semantics. Key owner-bound child by `connectionKey(owner)` and unmount on disconnected/invalid/removed owner before queries/settings/mutations can mount.
6. Retain existing Agent Settings/import/memory/distribution functionality and pass captured owner/profile into each existing consumer. No installer rewrite, automatic policy changes, inventory/runtime confusion or ambient APIs.
7. Adapt existing tests to MemoryRouter and explicit mocked profile/connection subscriptions; current no-loop and tab switching cases still behave, not just superficial label assertions.
8. Helper tests cover standard ID and reserved characters (`&`, `?`, `#`, `%`, spaces/Unicode), single encode/decode round-trip; default store entry; settings-without-profile choose; empty/repeated profile invalid; explicit ID independent of tab; unknown tab default without erasing explicit target.
9. Page behavior tests: active A + requested B goes Settings B; disconnected B remains unavailable B; explicit unknown/empty/removed never mounts query/settings subtree or calls any owner/ambient API; chooser requires deliberate selection; B removed after load retires child/dialog. Assert no work, not only visual empty state.
10. Same-profile generation replacement refreshes owner/query keys and retires actionable item/dialog state; old responses cannot appear current. In-app URL change/Back/Forward and ordinary bare route maintain intended behavior. Assert no global profile selection/policy/install/connect mutation.
11. Deliver exact 4-file slice, no checks during authoring. Phase 4 consumes href builder and owns full app entry-through-sidebar proof.

## Todo list
- [x] Implement narrow pure URL helper and intent parser.
- [x] Add reactive target/connection resolution and connected child boundary.
- [x] Author route, encoding, denial-before-work and reconnect cases.
- [x] Hand off complete slice, with all shared APIs unchanged.

## Success Criteria
- Settings link reaches explicit B regardless of active A. Removed/unknown/empty explicit target never falls back to A/first; no-owner Settings opens chooser.
- Disconnected target remains identifiable/unavailable and performs no remote work. Reconnect uses B's current generation for subsequent operations.
- Existing tabs and owner-bound inventory/memory/import/settings behavior remain complete; no ambient branch triggered by absence of owner.
- Test coverage proves query mount/work denial and retirement of old actionable children, not merely rendering labels. Final runtime evidence waits for phase 4.

## Conflict Prevention
- No changes to navigator/display, model, browser/application fixtures, shared query API, connection registry, AgentSettings or docs.
- Export signatures/href intent frozen; phase 4 cannot assume no-profile means current profile. Any needed public interface adjustment requires owner coordination before editing.
- Keep page-local split minimal and domain-specific, not another state/connection abstraction.

## Risk Assessment
- Absent owner accidentally invokes ambient queries: structural connected child boundary prevents hook mount.
- Route intent races with local selection: deliberate URL selection + reactive location resolution, negative Back/Forward/removal cases.
- Same profile new generation: reactive connection snapshot/keyed child; owner profile name alone never used as memo key.
- Missing profiles: chooser/denial, not automatic first profile or invented runtime inventory.

## Security Considerations
- URL profile is a target identifier, never credential; encode value separately and validate registered membership before API work.
- No logging of credentials/native paths/provider payloads. No cross-profile fallback, global active-profile mutation, auto-connect/install or notification enablement.
- Existing API captures/rechecks owner; disconnected/removed child cannot leak actionable state or route requests through another transport.

## Next steps
- Phase 4 adds section link from validated selected-project context and exercises actual app settings entry/denial.
- No unresolved technical question; runtime credentials needed later for real harness qualification. Optional layout/wording questions remain in overview, not this routing contract.
