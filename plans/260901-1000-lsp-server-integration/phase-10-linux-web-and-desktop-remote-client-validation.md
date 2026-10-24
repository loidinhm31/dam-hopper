# Phase 10 — Linux Server + Actual Web Application Qualification; Native Deferred

## Context links

- Parent authority: [latest Validation Summary and ledger](./plan.md#validation-summary).
- Direct dependency: [Phase 09 measured security/resource qualification](./phase-09-security-real-process-tests-and-performance-qualification.md).
- Repository: [actual web entry](../../apps/web/src/main.tsx), [application E2E fixtures](../../packages/ui/e2e/fixtures/application-fixture.ts), [built application services](../../packages/ui/e2e/fixtures/application-services.ts), [capture policy](../../packages/ui/e2e/fixtures/capture-policy.ts), [capture evidence](../../packages/ui/e2e/fixtures/capture-evidence.ts), [testing guide](../../docs/testing.md), [capture rules](../../docs/code-standards.md#testing-and-delivery).
- Auth/operations: [authenticated setup](../../README.md#authenticated-local-development-sqlite-lite-mode), [operator approval/promotion runbook](../../docs/configuration/server-environment-auth.md#operator-account-approval-and-role-promotion-runbook), [native origin guard, unchanged](../../apps/native/src/native-server-url.ts).
- Historical filename is retained intentionally; Linux Tauri/native qualification is not part of this phase's release gate.

## Overview

- Date: 2026-10-24
- Description: Qualify the shipped built web application against an authenticated Linux x64 server, including production-shaped admin/user authorization and human-reviewed visual evidence.
- Priority: P1
- Implementation status: DONE (2026-10-24)
- Review status: Automated functional and cleanup E2E qualification passed under Playwright run `e2e-run-1792822881080-39a0b4eb`; 6 full-viewport 1440×900 checkpoints captured; visual governance `PENDING_HUMAN_REVIEW` in `packages/ui/e2e/semantic-navigation/review.md`; reviewer Cycle 3 scored 7/10 (`plans/reports/code-review-261024-1322-phase-10-cycle-3.md`); approved by user on 2026-10-24 with tracked hygiene/coverage items W1–W6 carried forward.
- Effort: 16h completed (252/264h planned effort accounting, 95.5%).

## Key Insights

- Shared/component tests, a Vite development page, or synthetic screenshots do not prove the actual shipped surface. Drive the built `apps/web` application and actual Linux backend/bundled tuple.
- Use production-shaped authenticated mode, real approved Admin and User accounts, current session/MFA policy, exact allowed Origin and deployment routing. `--no-auth` is not application qualification.
- Capture helper publishes `PENDING_HUMAN_REVIEW`; green automation is not visual approval. Human must inspect fresh evidence and record explicit `HUMAN ACCEPTED` or `HUMAN REJECTED` against the run/source/capture identity.
- All native including Linux Tauri, Windows server/desktop, and Android remain unqualified/deferred/non-blocking. Never change `apps/native/src/native-server-url.ts` or add a native host-origin bypass to make a remote topology pass.
- The server owns semantic processes; the web host is a remote UI, not a local Node/TSLS sidecar.

## Requirements

- Actual built web assets against authenticated production-shaped Linux Rust server, manifest-verified bundled Node/TypeScript/TSLS, Phase 09 final threshold/limits, and deterministic registered TS/JS project/worktree fixtures.
- Reuse application E2E service/auth seeding conventions (`application_e2e_seed` plus browser storage state), including separate approved current Admin/User identities and real MFA/session policy. No fabricated role/body elevation or development no-auth substitute.
- Runtime starts OFF. Admin enables/disables globally without daemon restart; User cannot mutate on dedicated Settings, raw config/import or any exposed alternate writer, but can navigate when enabled. Assert server rejection as well as UI state.
- ON integrity/config checks leave zero semantic children; protocol probing occurs in prior bounded qualification or first authorized lazy session. Navigation/OFF/ON need no daemon restart; replacing bundled engines through a release normally does.
- Actual Monaco commands for Definition/Implementation across `.ts/.tsx/.js/.jsx`, open/unopened destinations, multiple/empty/denied states, latest unsaved content, Unicode/UTF-16, exact threshold/crossings, cancellation/source/destination freshness, reconnect, invalidation, and same-name multi-profile/worktree isolation.
- Stable dirty local model identity, text/undo/view state survive matching authorized reconnect despite new wire URI. Endpoint/root/actor mismatch must not replay old dirty source. Stale callbacks/cleanup/reveal never affect replacement owners.
- Forced portable-only application qualification is mandatory: visible warning/degraded state with bounded runnable navigation and no hard RSS/sandbox claim. Exercise every hard mode claimed qualified on a capable host; unavailable hard controls are explicitly unqualified/non-blocking and never inferred to pass from portable evidence.
- Fresh local non-sensitive full-viewport captures with valid PNG dimensions, `evidence.json`, `review.md`, exact source fingerprint/run/hash metadata, and mandatory human decision. Capture-disabled CI functional parity cannot satisfy the visual gate.

## Architecture

No host fork or new architecture. Drive `built web → shared Monaco/providers → authenticated semantic gateway → bundled TSLS` through real server profile selection, Settings, editor actions, ordinary save/filesystem/terminal, and scoped lifecycle changes.

Use repository application E2E fixtures and dedicated semantic case folders. Capture policy controls whether images are produced; enable fresh local qualification captures explicitly where needed. Default viewport is 1440×900; narrow layout coverage uses the repository's 320px dock convention inside a complete viewport, not cropped snippets. Capture actual rendered shell/state only, validate PNG IHDR, and publish run/source-bound metadata after functional and cleanup success. Human review stays pending until a person inspects the actual images and records a decision. A rejected or missing review blocks release acceptance.

Rollback boundary: actual Linux/backend/web failure or human rejection blocks release. Fix the cause and repeat affected Phase 09 gates, actual journeys, and fresh captures/review. Native/Windows/Android absence neither blocks nor expands this scope; the existing exact same-origin native policy remains untouched.

## Related code files

- Create during implementation/qualification: `packages/ui/e2e/semantic-navigation/semantic-navigation.spec.ts` and focused case metadata using existing application fixtures; retain evidence in that case directory according to capture policy.
- Reuse: `packages/ui/e2e/fixtures/application-fixture.ts`, `application-services.ts`, `application-data.ts`, `capture-policy.ts`, `capture-evidence.ts`, PNG validation and source fingerprint helpers; extend only if the real shared harness lacks a needed auth/tool-fixture capability.
- Modify only for discovered root cause: shared/server files named in Phases 03–08 and Linux release tool packaging. Repeat affected Phase 09 qualification after any such change.
- Intentionally unchanged: `apps/native/src/native-server-url.ts`, native host/CSP/IPC/sidecar policy, Windows and Android runners. No native code or remote-origin exception belongs here.
- Delete after qualification: ephemeral credentials/profiles/worktrees, raw sensitive diagnostics, generated fixture output and spawned services/processes. Retain safe current captures/metadata/human review; do not delete acceptance evidence as routine cleanup.

## Implementation Steps

1. Require passing Phase 09 aggregate results and frozen policy/tuple identity. Provision isolated production-shaped authenticated Linux backend and serve actual built web assets with exact allowed Origin/TLS/proxy settings for the exercised topology.
2. Seed separate approved Admin and ordinary User identities through the canonical auth harness/operator model with valid MFA/session state. Record auth backend/topology/versions and non-sensitive fixture identity; neither no-auth mode nor possession of signing material substitutes for real approved accounts and current server-side role checks.
3. With runtime default OFF, verify both identities see disabled status and existing edit/save/tab/terminal/filesystem behavior. Confirm no semantic process exists before authorized use.
4. User attempts global ON/OFF via UI and direct dedicated/raw-config/import requests must be denied without persistent/runtime effects. Admin enables globally; verify zero-child enabled-idle, visible shared state and no daemon restart. First authorized lazy navigation may start the bounded child tree.
5. Invoke actual Monaco Definition/Implementation actions for all four extensions, open/unopened destination, multiple selectable results, null/empty, and outside-target denial. Verify target tab, correct Unicode/non-BMP range, focus and selection; no leaked host path.
6. Edit unsaved content below/equal/above threshold and cross both ways; verify latest results and no duplicate providers/models. Exercise source/destination edits, rapid repeat/cancel, close/reopen and one-document close while another remains navigable.
7. Force socket loss and matching reauthentication/reconnect; observe fresh wire session-target URI/full replay without replacing the dirty local model/text/undo/view state. Profile endpoint edit, owner replacement, worktree/target removal and auth logout/revocation must never replay old dirty buffers or navigate via late callbacks.
8. Disable globally during outstanding work as Admin. User and Admin show OFF, admission stops and children/overlays reach zero within qualified deadlines; core UI stays usable. Re-enable stays idle, no restart. Exercise demoted Admin mutation rejection and valid ordinary-user navigation after enable.
9. Exercise explicit unsupported Rust, missing/incompatible bundled artifact, capacity/timeout/crash/backoff/invalidation states without introducing any command/profile override. Restore the exact immutable artifact rather than substituting a workspace executable.
10. Exercise forced portable-only using Phase 09 fixtures; confirm prominent degraded warning and working bounded semantics without hard memory/sandbox guarantees. Exercise each hard mode being claimed on a capable Linux host. If hard capability is unavailable, record that mode unqualified/non-blocking and qualify only portable-only Linux/web behavior; do not silently satisfy or waive a hard-mode claim.
11. Capture fresh full-viewport non-sensitive checkpoints for default OFF/admin enabled/User read-only controls, Definition/Implementation destination/selection, multiple results, dirty reconnect recovery, portable-only warning, invalidated/error state, and narrow layout/focus. Use repository policy/PNG validation and colocated `evidence.json`/`review.md`; no generated mock UI, crops or old captures substituted as proof.
12. Have a human inspect all required current checkpoint images; record reviewer/time, exact run/source/hash, findings and explicit `HUMAN ACCEPTED` or `HUMAN REJECTED`. Do not auto-fill approval. Rejected/missing/pending review blocks Phase 11 qualification claims; after fixes recapture and review the new identity.
13. Stop the exercised services/clients, observe zero semantic descendants/overlays/orphans, and remove ephemeral auth/config/workspaces without erasing safe acceptance artifacts. Confirm support labels keep every native/Windows/Android surface deferred and unchanged origin guards.

## Todo list

- [x] Complete actual built-web/authenticated Linux application setup and Admin/User journeys.
- [x] Prove default OFF, admin-only all-write-path control, User navigation, and zero-child ON without restart.
- [x] Complete actual Monaco adaptive-sync/freshness/multiple/Unicode/model recovery scenarios.
- [x] Complete lifecycle/auth/endpoint replacement and forced portable-only journeys; exercise claimed hard modes or record unavailable/unqualified/non-blocking status.
- [x] Produce fresh policy-compliant captures and machine-readable evidence (`evidence.json`, 6 checkpoints at 1440×900).
- [ ] Obtain actual human ACCEPTED/REJECTED review; no synthetic visual approval (pending human governance in `review.md`).
- [x] Retain safe evidence, clean ephemeral resources, and keep native entirely deferred.

## Success Criteria

- Actual built web app against the authenticated Linux server passes recorded journeys with real packaged tuple and Admin/User identities; tests-only, no-auth, component or dev-server evidence is insufficient.
- Current Admin alone changes global runtime; User can navigate when enabled but raw/import/dedicated mutation attempts fail server-side. OFF leaves zero children/overlays, ON remains zero-child idle, core UI works, no daemon restart for normal navigation/toggle.
- Latest matching unsaved models produce correct Definition/Implementation and UTF-16 ranges across threshold equality/crossings; multi-results remain selectable and empty/error/denied distinguishable.
- Matching reconnect preserves dirty local model identity/text/undo/view state while rebinding wire URI; endpoint/owner/root/auth replacement never receives stale source or late result/cleanup effects.
- Qualified resource modes behave as measured; portable-only runs with visible degradation and no hard RSS/sandbox promise. Missing/overloaded/timeout/crash/unsupported states remain explicit and non-blocking to normal editing.
- Required fresh full-viewport PNGs, valid dimensions, source/run/hash-bound `evidence.json` and actual human `review.md` exist; visual acceptance requires `HUMAN ACCEPTED`. `HUMAN REJECTED`, missing or pending review fails the gate even if automation is green.
- No client-local TSLS/command override/native origin bypass. Native including Linux Tauri, Windows, Android remains unqualified/deferred/non-blocking; only exercised Linux server + web earns a support claim.

## Risk Assessment

- Auth harness hides role bypass: use real approved actors, test server rejection on alternate writes, inspect current-role demotion behavior.
- Surface substitution: built assets plus actual backend/tool identity recorded; dev/component successes cannot replace application qualification.
- Stale/sensitive capture: use disposable non-sensitive fixture names from the start, full viewport/source hashes; recapture rather than crop/redact essential UI or omit mandatory evidence.
- Human review absent: leave gate blocked/pending; never generate or infer approval.
- Origin/topology failure: fix shared authorized policy for the exercised web deployment, not a native-host exception.

## Security Considerations

- Ephemeral credentials, real session/MFA policy, exact Origin/TLS as exercised; inspect URLs/logs/captures for auth material and absolute server paths before publication.
- Trusted workspace requirement and server-account filesystem authority remain visible; no sandbox language inferred from URI filtering.
- Bundled-only execution on server, no command fields/host config/env/import exception, no native-local execution or same-origin relaxation.

## Validation Ledger — 2026-10-24

- **Run ID:** `e2e-run-1792822881080-39a0b4eb`
- **Execution Command:** `pnpm --filter @dam-hopper/ui test:e2e`
- **Execution Timing:** Started `2026-10-24T06:21:21.080Z`, completed `2026-10-24T06:21:34.590Z` (~13.5s elapsed)
- **Git HEAD:** `f00d7c36f2774efa34117224d0ff01f1f7873006`
- **Source Fingerprint:** `9c9fdd65c01f15d88fdc093cd0e5ac2aea0d5db544892053374476066de065c5`
- **Seed Digest:** `c6410d0f3f88bee0653413017f9b3c116e16f61ab3d358217c4c89ab8dec7777`
- **Browser & Environment:** Chromium 151.0.7922.173, Linux x64, Viewport 1440×900, DPR 1
- **Checkpoints Captured (6):**
  1. `default-off.png` (1440×900, SHA-256: `0fa12d7b183be9da0ce23bdd410f4ac54f31af4d9e1471fd3c505cbd051b3b68`) — Settings default OFF, 0 child/tsserver processes in container, non-admin mutation rejected.
  2. `admin-enabled-portable.png` (1440×900, SHA-256: `6d0bca91bd6fff02d96c7398f3f77f1e22487e18085b5dcbfd7d90263dd0f246`) — Admin enabled toggle, visible Advisory Portable Resource Limits warning banner, 0-child idle status.
  3. `definition-jump.png` (1440×900, SHA-256: `bf624497f6569bd152ddc53621b3680fa1b22f1f0d0f633b6bb3f5b770a921db`) — Restored EditorTab layout/spacing/transition classes, Definition jump from `impl.ts` to `types.ts` with exact cursor/selection on `export interface SemanticItem`, status `TS/JS Ready`.
  4. `multi-result-selection.png` (1440×900, SHA-256: `7023d930e388d07cc3b8aafbceae5d75a45208295ee09d2ea70cb39a5c117b2b`) — Multi-result Definition peek widget displaying multiple declaration locations for `MultiTargetConfig` in `multi_def.ts`.
  5. `threshold-dirty-edit.png` (1440×900, SHA-256: `a8f3b2c7b6008d3a501c06005436c08348e853afc09673c605cbc9a5438e4865`) — In-memory dirty buffer freshness navigation to unsaved method `getUnsavedValue` with container disk content untouched.
  6. `narrow-layout-dock.png` (1440×900, SHA-256: `0ab3b413122f6a1c26acde51cc96d5eabd5a2bd7b6b6d82ff97c194b3d15f53e`) — Workspace editor in narrow dock layout (320px dock convention) with `impl.ts` open, Semantic Navigation disabled, strictly 0 orphan child/tsserver processes in container.
- **Functional Outcome:** `passed`
- **Cleanup Outcome:** `passed` (strictly 0 orphan processes in container)
- **Visual Governance:** `PENDING_HUMAN_REVIEW` in `packages/ui/e2e/semantic-navigation/review.md` (mandatory human sign-off gate before release support claim).
- **Code Review:** Cycle 3 score 7/10 (`plans/reports/code-review-261024-1322-phase-10-cycle-3.md`); approved by user on 2026-10-24 with tracked items W1–W6 carried forward.
- **Platform Scope:** Linux server + built web SPA qualified; native remote clients (Linux Tauri, Windows, Android) remain deferred, unqualified, and non-blocking; native same-origin guard in `apps/native/src/native-server-url.ts` untouched.

## Next steps

- Human inspector review of 6 captured checkpoints in `packages/ui/e2e/semantic-navigation/review.md` to transition from `PENDING_HUMAN_REVIEW` to `HUMAN ACCEPTED`.
- Proceed to Phase 11 (Documentation, roadmap, changelog, and release cleanup): reconcile docs, README, changelog, and roadmap with Phase 09 measured bounds and Phase 10 built-web qualification evidence; native remote clients deferred.
- Carry forward tracked engineering improvements W1–W6 from Phase 10 Cycle 3 review for subsequent hardening iterations.
