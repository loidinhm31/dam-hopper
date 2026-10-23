# Phase 06 — Admin-Only Global Hot Toggle; Bundled Engines Only

## Context links

- Parent: [latest validation and row06 policy](./plan.md#validation-summary).
- Direct dependency: [Phase 05 authenticated gateway](./phase-05-authenticated-semantic-websocket-gateway.md); transitively [Phase 03 immutable tuple/initial bounds](./phase-03-pinned-tool-provisioning-and-resource-controls.md), [Phase 04 lifecycle owner](./phase-04-semantic-session-supervisor.md).
- Current authority: [UserRole](../../server/src/auth/model.rs), [AuthenticatedActor/dev_user/VerifiedAuthClaims](../../server/src/api/auth.rs), [fresh AuthService evaluation](../../server/src/auth/mod.rs).
- Current persistence surfaces: [global schema](../../server/src/config/schema.rs), [global writer](../../server/src/config/global.rs), [config APIs](../../server/src/api/config.rs), [settings import](../../server/src/api/settings.rs), [replacement guard](../../server/src/config/replacement.rs), [FS API](../../server/src/api/fs.rs), [WS file operations](../../server/src/api/ws.rs).
- Integration: [runtime transition precedent](../../server/src/api/usage.rs), [Settings page](../../packages/ui/src/components/pages/SettingsPage.tsx).

## Overview

- Date: 2026-10-23
- Description: Add current-admin-only server-global no-restart ON/OFF, protect every semantic config mutation path and keep engine selection immutable/bundled-only.
- Priority: P1
- Implementation status: DONE (2026-10-23) — Administratively complete under approved exceptions; release qualification pending
- Review status: Approved by user on 2026-10-23 under tracked exceptions (Score: 7.5/10, Cycle 2, 0 critical issues)
- Effort: 20h
- Direct dependencies: 05.
- Estimate rationale: removes unsafe override work but adds real current-role reauthorization, import/raw/shared-writer closure, serialized read–modify–write and explicit disk/runtime failure semantics beyond historical 16h.

## Key Insights

- `UserRole::{User,Admin}` exists now. `AuthenticatedActor.dev_user()` is `User`, not Admin; `--no-auth` is no authority for global semantic mutation.
- Middleware actor role is a request-time snapshot. Introduce a new bounded server-side current-admin check; do not invent an existing `require_admin` helper or trust UI/body/JWT role claims.
- Ordinary authenticated users may use already-enabled semantic navigation and read safe status; the privilege boundary is global semantic mutation, not every document operation.
- Only persisted semantic setting is enabled intent. No custom executable, arguments, environment, path, selected profile or host opt-in exists through flags/env/local config/import/API/UI.
- ON is passive integrity/config checks only, zero child. Protocol execution belongs to bounded spike/release qualification or first authorized lazy session; OFF and normal navigation need no daemon restart.
- A local OS operator can edit owned files under OS authority, which cannot be prevented by HTTP role checks. This is not an authenticated API bypass or permission to configure arbitrary semantic commands.

## Requirements

- Persist `GlobalConfig.semantic.enabled`, default false with absent legacy section. New semantic section denies unknown/override fields; never accept a shadow workspace/project semantic command or copied unsafe-profile field.
- Dedicated `GET /api/semantic/settings` returns safe configured intent, actual runtime state, integrity/protocol readiness separately, current tuple identifier, policy/resource capability and warning, child/overlay counts, generation, transition/error and caller mutation capability. No command fields or host opt-in.
- Dedicated `PATCH /api/semantic/settings` accepts only typed `{enabled:boolean}` plus concurrency revision if required by existing config conventions. Every actual mutation requires a currently valid signed authenticated session and fresh current Admin role; no-auth always denied before mutation/spawn/write.
- Current-admin policy must cover dedicated API, accepted imports/replacements/raw config mutations, and every shared writer capable of changing semantic intent. Omitted semantic fields preserve current state; explicit false/removal/reset is a mutation too. Reject unknown fields before serde can silently drop them.
- Protect semantic data against unrelated read–modify–write writers: a stale global UI/default/workspace-registry snapshot must not overwrite enabled intent. All global writers use one serialized current-state mutation boundary, preserving unrelated fields and semantic revision.
- Generic workspace import/PUT cannot introduce a second semantic config location. Raw/global writes that can change semantic fields must either use the same authorized transaction or be explicitly denied and direct Admin to dedicated PATCH; never write disk then rely on later reload authorization.
- Retain existing access for unrelated ordinary-user settings where semantic intent is unchanged; do not silently widen scope into an unrelated application-wide RBAC project.
- OFF success requires admission revoked, all pending work cancelled, complete trees reaped, overlay/queues/backoff cleared and false intent atomically persisted. Status notification is best effort, never a prerequisite for cleanup.
- ON validates bundled integrity/configuration without execution, persists/applies enabled-idle under serialized ownership and starts zero children. Missing optional hard controls may warn `portable-only` but do not prevent bounded ON/use.
- Bundled engine updates arrive through an integrated qualified server release, normally restarting the daemon; no runtime profile swap or custom executable even via trusted local config.

## Architecture

`SemanticConfig` is server-global enabled intent only. `SemanticRuntimeStatus` is supervisor-owned actual state, never inferred from disk. A typed settings API invokes a shared authorized semantic transition/coordinator. Existing `write_global_config_at` performs atomic replacement, but is not by itself a concurrency lock or auth guard; change the owning read–modify–write boundary so every relevant writer participates.

### Proposed current-admin authorization — new work, not an existing helper

1. Require `AuthenticatedActor`, `CredentialMechanism` and `VerifiedAuthClaims` produced by current middleware. Reject `state.no_auth`, `NoAuthDev`, missing verified claims/session, or actor/claims mismatch, even on loopback. Never synthesize Admin for the development actor.
2. Under the shared async config-mutation/transition lock, bound `AuthService.evaluate_claims(&claims)` with the initial2s store budget. It reads current session and user from the selected real auth backend and applies current account-enabled, revocation, auth/credential versions, MFA and expiry policy.
3. Accept only `AuthDecision::Authenticated { user, session }` matching the captured subject/session/versions and `user.role == UserRole::Admin`. User/missing role gets stable403; invalid session/MFA follows auth denial; store error/timeout/unavailable fails closed with a safe unavailable result. No cached UI/actor-role grant.
4. Validate/configure first; re-evaluate current-admin immediately before disk/runtime commit, particularly after OFF cleanup or passive integrity I/O. For raw WS routes without middleware claim extensions, retain verified upgrade claims or use equivalent server-store identity validation; never reconstruct authority from client-supplied role/subject.
5. Role check linearizes at the fresh store evaluation immediately preceding commit. The config lock does not serialize external MongoDB/SQLite operator demotions; do not promise an atomic DB-role+filesystem transaction. Demotion observed before that check denies; later requests must recheck and UI can become stale without granting authority.

No persistent privilege token/cached admin grant or new public role-promotion API. Tests exercise both current stores/current policy; ordinary enabled navigation continues independently of Admin status.

### Serialized config/runtime safety

Use one documented async lock order for global config read–modify–write then semantic transition ownership; no synchronous lock held across await and no competing reverse acquisition. Every global writer loads current state inside this boundary, preserves unrelated fields, validates the candidate and publishes disk/in-memory revisions consistently. Prevent import/UI/default/workspace-registry writers from losing semantic changes via stale snapshots. Config file replacement alone is not sufficient.

| Transition/outcome | Required result |
|---|---|
| OFF begins | Revoke admission/bump runtime generation first, cancel requests and begin full-tree cleanup independently of client notification |
| OFF cleanup succeeds | Fresh-admin recheck, atomic false intent write, publish disabled with zero children/overlays, then success |
| OFF cleanup fails | Remain admission-disabled, report cleanup failure, retain ownership/reaper and block reenable; never claim zero trees or successful OFF |
| OFF persist or final authorization fails after cleanup | Preserve prior durable intent/revision, remain safely disabled with explicit configured/runtime mismatch and error; no automatic resurrection/replay of prior users' overlays |
| ON from disabled, or explicit safe-disabled recovery | Passive integrity/config checks, fresh-admin precommit check, atomic true intent write and enabled-idle publication; zero child, lazy authorized session probes later; recovery requires all prior cleanup complete |
| ON validation/authorization/persist fails from disabled/recovery | Keep prior durable intent and actual admission-disabled state; no partially enabled admission or candidate process |
| Already healthy enabled → enabled | Fresh-current-admin authorized no-op: no persistence, generation change, session disposal or revalidation probe; failed authorization leaves existing healthy runtime untouched |
| Other no-op request | Check current privilege anyway; safe idempotence never becomes a no-auth/User write bypass |

Status truthfully distinguishes configured intent, actual admission, passive integrity and executable protocol qualification. Failed irreversible teardown cannot magically restore killed sessions. Recovery requires an explicit authorized retry/re-enable after cleanup/integrity is safe. Process crash between durable write and publication reloads configured intent at startup but creates zero semantic children; startup passive validation must still pass before admission.

Local operator file changes are trusted OS administration, not remote admin credentials. At startup or an explicitly supported reload they undergo the same schema, immutable-engine, integrity and safe transition checks, using an explicit internal operator context rather than fabricating `dev-user` Admin. Do not add hot file-watching or arbitrary custom command selection. An authenticated API writing that same file is not local-operator authority.

### Import/raw/shared-write closure

Inventory dedicated config APIs, workspace TOML import/export, JSON config replacement, raw filesystem writes/uploads/renames/deletes, existing WS file operations, global UI/default updates and workspace registry read–modify–write helpers. Protect the canonical global semantic config file and aliases/hardlinks/in-place edits using established file identity/secure-path boundaries; a path-string-only check is insufficient. Direct authenticated generic writes to this protected file are denied or routed through the same current-admin coordinator with validated atomic runtime transition, including deletion/reset. The chosen simple default is deny generic raw mutation and direct callers to PATCH; no silent semantic filtering or elevation.

Workspace import and JSON PUT retain existing protected-setting guards and reject misplaced semantic/override sections. Any future supported global import that actually changes semantic intent must use this current-admin transition path. Unrelated shared writers preserve the current semantic section under the shared mutation boundary. Protecting config API sinks does not remove pre-existing server-account terminal/OS file authority; trusted workspaces and operator boundary remain explicit.

## Related code files

- Modify: `server/src/config/schema.rs`, `server/src/config/global.rs`, `server/src/config/tests.rs` — enabled-only strict semantic schema/default-OFF, shared serialized mutation and preservation/round-trip contracts.
- Modify: `server/src/state.rs`, `server/src/semantic/supervisor.rs` — shared mutation/transition ownership, explicit intent/runtime status and safe failure states.
- Modify: `server/src/api/auth.rs` — introduce bounded current-admin decision helper using existing verified claims and `AuthService.evaluate_claims`; do not add a fake role model or imply helper already exists.
- Create: `server/src/api/semantic_settings.rs`; modify `server/src/api/router.rs`, `server/src/api/mod.rs` — GET/PATCH and typed authorized transitions.
- Modify: `server/src/api/config.rs`, `server/src/api/settings.rs`, `server/src/config/replacement.rs` and discovered shared writer callsites — reject misplaced/unsafe semantic config, preserve current intent and close import/raw/shared-write bypasses.
- Modify as required by protected file identity: `server/src/api/fs.rs`, `server/src/api/ws.rs`, `server/src/fs/` mutation/upload/rename/delete sinks — no authenticated raw replacement bypass of semantic policy.
- Modify: `packages/ui/src/api/client.ts`, `packages/ui/src/api/queries.ts`; dedicated semantic client status transport in Phase 07 — owner-bound settings/status, not existing `/ws` kind multiplexing.
- Create: `packages/ui/src/components/organisms/SettingsSemanticNavigationSection.tsx` and colocated test; modify `packages/ui/src/components/pages/SettingsPage.tsx` — server-owned global-impact toggle/status and read-only User/dev presentation, no command/profile fields.
- Modify: `server/src/api/tests.rs`, `server/tests/settings_import_export.rs`; create `server/tests/semantic_settings.rs` — real auth/current-role/store, concurrency, failure and complete-tree OFF cases.
- Delete: no live override feature exists to remove; delete superseded implementation instructions only. Do not add unsafe flags/env/config/UI/audit/probe/profile-swap machinery to `main.rs` or elsewhere.

## Implementation Steps

1. Require passed Phase 01 and implemented Phases 02–05 contracts; keep public semantic child-creation exposure unavailable until this privilege boundary passes.
2. Inventory every global/config import/raw/shared writer and target-file alias route. Define one async config read–modify–write coordinator and documented transition lock order; preserve ordinary unrelated settings access.
3. Add enabled-only strict global schema/default false and explicit safe status. Reject custom executable/args/path/env/profile/host-opt-in and misplaced semantic sections, including aliases/casing/imports that would otherwise be ignored.
4. Implement proposed bounded fresh-current-admin helper and stable denial mapping. Deny no-auth/dev actor before side effects; use real current user role, not middleware/UI/body snapshot.
5. Implement GET/PATCH with captured owner transport and serialized candidate validation, fresh-admin precommit recheck and exact status/generation publication. Protect raw/import/reset/deletion paths before disk write; deny generic protected-file mutations rather than inventing bypass authority.
6. Implement cancellation-first OFF, full-tree cleanup independent of socket sends, durable false commit and truthful cleanup/persistence/authorization failure states. Never auto-restore killed session overlays.
7. Implement passive zero-child ON from disabled or explicit safe-disabled recovery, with atomic true intent/admission publication; healthy enabled→enabled is a fresh-admin-authorized no-op preserving all sessions. Real protocol probe occurs only on first authorized lazy session after ownership setup, or in bounded release/spike qualification.
8. Integrate all global writers into the shared current-state mutation boundary, including UI/default/workspace registry helpers; prove concurrent unrelated writes cannot restore stale semantic intent or lose fields.
9. Add Settings UI: current server ownership, Admin-only actionable toggle, User/dev read-only state, global-impact copy, pending lockout, configured-vs-runtime mismatch, stable error/retry and prominent runnable `portable-only` warning. UI privilege hint never authorizes server mutation.
10. Add future real-store and bundled-child tests: User/Admin/no-auth, role demotion between request and commit, auth/backend timeout, imports/raw aliases/reset/deletion, concurrent writers, zero-child ON, OFF during startup/request/stalled socket, cleanup/persist failures and explicit recovery. Record race semantics honestly.

## Todo list

- [x] Add strict enabled-only global config and truthful runtime status.
- [x] Implement bounded fresh-current-admin helper and no-auth denial.
- [x] Protect dedicated/import/raw/reset/alias/shared mutation paths.
- [x] Serialize all global read–modify–write operations without lost semantic updates.
- [x] Implement passive zero-child ON and cancellation-first complete-tree OFF.
- [x] Define/test safe intent/runtime mismatch and explicit retry recovery.
- [x] Add owner-bound Admin/User/dev Settings states with no command/profile controls.

## Success Criteria

- Signed current Admin can hot OFF/ON without daemon restart; ordinary User and `--no-auth` cannot mutate intent through PATCH, import, JSON replacement, protected raw write/upload/rename/delete, shared writer, field removal/reset, unknown override field or alias. Initial authorization denial causes no persistence/runtime mutation or spawned process.
- Fresh store role/session evaluation immediately precedes commit; request-time Admin demoted before that check is denied, missing/unavailable backend fails closed, and UI/body role claims are ignored. If initially authorized OFF already performed irreversible teardown before final recheck detects demotion, keep durable intent unchanged and actual runtime safely disabled with explicit mismatch/error; test this exact case. External demotion after the defined check is not falsely advertised as atomically excluded.
- Ordinary authenticated User can navigate using enabled semantics; Admin-only controls do not turn every semantic request into an Admin-only operation.
- OFF stops admission/cancels immediately and reports success only after full tree/overlay/queue cleanup and false persistence. Full socket queues cannot postpone it; failures report actual safe-disabled/mismatch/cleanup state rather than fake rollback or success.
- ON from disabled/recovery integrity/config checks spawn zero processes and publish enabled-idle only after durable success; healthy enabled→enabled is an authorized no-op, and its authorization failure cannot disable healthy sessions. First authorized lazy session starts its owned tree; protocol failure reaps it. Portable-only remains runnable with warning and no hard RSS claim.
- Concurrent semantic toggle + unrelated global UI/default/registry writes preserve newest semantic revision and unrelated fields; stale read–modify–write snapshots cannot reenable/reset semantics.
- No custom executable/args/env/profile/host opt-in exists in flags, env, local semantic config, import, API, UI or command probes. Runtime engine updates only follow integrated qualified release installation, normally daemon restart.
- Non-Admin/dev UI is read-only and honest about selected server/global effect; role hint staleness never grants mutation. Native origin guard unchanged and native/Windows/Android qualification not implied.

## Risk Assessment

- Auth snapshot/demotion race: bounded fresh evaluation immediately precommit, explicit linearization semantics; no claim config locks serialize external auth-store updates.
- Disk/live split-brain after irreversible OFF: remain safely admission-disabled, expose durable-intent mismatch, retain cleanup ownership and require explicit authorized recovery.
- Shared writer lost updates or file aliases: serialized current-state mutation plus protected file identity across all reachable raw sinks; atomic rename alone is insufficient.
- Scope creep: protect global semantic enabled intent, not a new plugin system, arbitrary-engine audit flow or wholesale unrelated settings RBAC rewrite.

## Security Considerations

- Global mutations require server-verified current Admin and live session/MFA/version validity. No silent development elevation, host flag, request-body role or local-file authority masquerading as HTTP authorization.
- Trusted OS operator/server-account terminal authority is outside this new config API privilege boundary; do not claim tamperproof local filesystem control. Even local semantic config cannot nominate custom engines.
- No command secrets, raw source/paths, credentials or unsanitized child output in status/audit/logs. Resource capability and immutable tuple identifier may be non-sensitive; no arbitrary command fingerprint/audit surface is needed.

## Next steps

- Phase 07 consumes owner-bound status and exact semantic client protocol; Phase 08 wires global/owner/target invalidation and stale callback fencing.
- Phase 09 attacks role/import/raw/shared-write races and measures auth/cleanup/resource bounds. Phase 11 documents only qualified Admin control, trusted workspace and bundled release-update behavior.
- Validation status: Implementation administratively complete under authorized exceptions; release qualification remains pending. Verified across 115 focused tests per QA execution report (`plans/reports/tester-261023-1819-phase-06-toggle.md`: 7 integration tests in `tests/semantic_settings.rs`, 50 regression integration tests in `tests/semantic_*.rs`, 42 semantic/config unit tests in `server/src/`, and 16 frontend component tests) with 3,140/3,140 tests passing in the full UI suite. Code reviewer Cycle 2 report (`plans/reports/code-reviewer-261023-1845-phase-06-toggle-cycle-2.md`) reported 7/7 semantic_settings, 43/43 semantic lib, 108/108 config::tests, and 8/8 semantic_resources tests passing with score 7.5/10 and 0 critical issues; approved by user on 2026-10-23 under tracked items. Six tracked review warnings (W1 cancellation safety during detached transition, W2 child terminal status and leak propagation in shutdown, W3 re-enable block while unclean sessions exist, W4 teardown timeout margin, W5 failure regression tests, W6 transition error sanitization) carried into Phase 08/09.
- Unresolved technical gates: Phase 01 spike demonstrated G0–G7 in tested spike configuration; Phase 06 sink guards and serialized config-lock integration implemented across wired filesystem mutation paths (`persist_temp`, `persist_temp_sync`, `write_bytes`, `atomic_write_with_check`, `atomic_persist_with_check`, `assert_safe_mutation`). Open items include W1 cancellation safety, W2 terminal child status/leak detection, W3 re-enable block while unclean sessions exist, W4 teardown timeout margin, W5 failure regression tests, W6 transition error sanitization, `decrypt_and_write` sink hardening (S1), production hook suppression (G6), unopened destination freshness G5 (tracked for Phase 07/09), and G8 live web navigation (tracked for Phases 07 & 10). Release qualification remains pending.
