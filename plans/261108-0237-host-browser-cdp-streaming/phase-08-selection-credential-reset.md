# Phase 08 — Secure selection artifacts and confirmed logout reset

## Context links
- [Overview](plan.md) · [Architecture contracts](architecture-contracts.md) · [Acceptance matrix](acceptance-matrix.md) · [Execution ownership](execution-ownership.md).
- [Backend evidence](reports/backend-boundaries.md) · [Viewer evidence](reports/viewer-boundaries.md) · [Protocol research](research/stream-protocol.md) · [Settled direction](reports/design-direction.md).
- Relevant bounded evidence: `reports/backend-boundaries.md:36–53; reports/design-direction.md:56–60; current browser_debug/store.rs:20–35,56–85; api/auth.rs:613–640; coordinator superseding logout/artifact corrections in architecture-contracts.md`. Research recommendations superseded by architecture contract where explicitly stated.

## Overview
- Priority: P2. Status: DONE (2026-11-09). Effort: not-estimated.
- Deliverable: Secure selection artifacts and confirmed logout reset. Marked DONE per user approval with noted issues after Cycle 3 code review (2026-11-09; score 7/10; 0 critical issues; 237/237 scoped checks passing + 3,718/3,718 full UI unit suite; live-server Playwright E2E `packages/ui/e2e/os-host-browser/selection.spec.ts` typechecked only, container runtime execution deferred to Phase 09). Phase 09 unblocked; 9 warnings W1–W9 (5 High, 4 Medium) tracked as carryovers into Phase 09.

## Key insights
Existing artifact endpoints/store have no actor binding; adding host captures without hardening would expose managed content to ordinary users. Same subject after demotion is insufficient: immutable server-set source class must enforce current Browser admission for managed artifacts.

## Requirements
CDP-native bounded BrowserSelectionV1/PNG with actor+immutable source-class authorization and terminal-safe handoff; preserve Cooperative owner extension workflow. UI offers Log out, keep Browser data / Log out and clear shared Browser data / Cancel with **no preselected choice (V1 user validation)**. Both logout branches call server revoke-FIRST; only fully live admitted confirmed clear/reset wipes after process exit. Passive expiry/revoke and old clients without reset consent retain credentials.

## Architecture
Sequential integration owner migrates store signatures/callers/tests first, then adds host selection and reset/logout flows. Cooperative and ManagedBrowser source classes are immutable internal metadata, never accepted from HTTP body.
- Follow exact API/envelope/limits/auth/reset ordering in architecture-contracts.md; no second protocol or undocumented task engine.

## Related code files / actions
Every path below is absolute; new/dependency-created files are explicitly classified. Task contracts carry the equivalent normalized repository-relative writable paths. No deletion of entire independent modules is authorized; obsolete Browser iframe symbols are removed only at the phase07 cutover.

### File map — actor-bind-debug-artifacts
| Action | Full path | Purpose |
|---|---|---|
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/browser_debug/mod.rs` | Bind every artifact operation to owner and immutable source class; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/browser_debug/store.rs` | Bind every artifact operation to owner and immutable source class; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/browser_debug/tests.rs` | Bind every artifact operation to owner and immutable source class; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/api/browser_debug.rs` | Bind every artifact operation to owner and immutable source class; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/tests/browser_debug_artifacts.rs` | Bind every artifact operation to owner and immutable source class; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/state.rs` | Wire existing AppState artifact store to Browser admission/reset source-class authority; no unrelated state restructuring. |

### File map — select-cdp-and-handoff
| Action | Full path | Purpose |
|---|---|---|
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/src/browser_host/selection.rs` | Implement CDP selection preview and atomic terminal delivery; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/mod.rs` | Implement CDP selection preview and atomic terminal delivery; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/api/browser_host.rs` | Implement CDP selection preview and atomic terminal delivery; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/manager.rs` | Implement CDP selection preview and atomic terminal delivery; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/src/browser-host/selection-controller.ts` | Implement CDP selection preview and atomic terminal delivery; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/os/apps/BrowserApp.tsx` | Implement CDP selection preview and atomic terminal delivery; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/hooks/use-browser-debug.ts` | Implement CDP selection preview and atomic terminal delivery; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/hooks/use-browser-debug.test.ts` | Implement CDP selection preview and atomic terminal delivery; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/browser-tests/host-browser-selection.browser.tsx` | Implement CDP selection preview and atomic terminal delivery; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/e2e/os-host-browser/selection.spec.ts` | Own actual post-cutover managed selection SPA e2e with real authenticated API/provisioned browser; no dependency on phase09 fixture. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_selection.rs` | Implement CDP selection preview and atomic terminal delivery; exact responsibilities in numbered steps below. |

### File map — secure-profile-reset-logout
| Action | Full path | Purpose |
|---|---|---|
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/api/auth.rs` | Implement fully authorized destructive reset and logout ordering; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/src/api/router.rs` | Implement fully authorized destructive reset and logout ordering; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/api/browser_host.rs` | Implement fully authorized destructive reset and logout ordering; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/manager.rs` | Implement fully authorized destructive reset and logout ordering; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/server/src/browser_host/attachments.rs` | Implement fully authorized destructive reset and logout ordering; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/server/tests/browser_host_logout.rs` | Implement fully authorized destructive reset and logout ordering; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/server/tests/auth_device_sessions.rs` | Implement fully authorized destructive reset and logout ordering; exact responsibilities in numbered steps below. |

### File map — migrate-account-logout-ui
| Action | Full path | Purpose |
|---|---|---|
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/api/auth-client.ts` | Migrate every active logout caller and explain local profile removal; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/api/auth-types.ts` | Migrate every active logout caller and explain local profile removal; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/api/auth-client.test.ts` | Migrate every active logout caller and explain local profile removal; exact responsibilities in numbered steps below. |
| Modify dependency-created | `/home/loidinh/WS/dam-hopper/packages/ui/src/api/browser-host-client.ts` | Migrate every active logout caller and explain local profile removal; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/ServerProfilesDialog.tsx` | Migrate every active logout caller and explain local profile removal; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/ServerSettingsDialog.tsx` | Migrate every active logout caller and explain local profile removal; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/ServerSettingsDialog.test.tsx` | Migrate every active logout caller and explain local profile removal; exact responsibilities in numbered steps below. |
| Modify existing | `/home/loidinh/WS/dam-hopper/packages/ui/src/components/organisms/ServerProfilesDialog.test.tsx` | Migrate every active logout caller and explain local profile removal; exact responsibilities in numbered steps below. |
| Create new (planned) | `/home/loidinh/WS/dam-hopper/packages/ui/browser-tests/host-browser-logout.browser.tsx` | Migrate every active logout caller and explain local profile removal; exact responsibilities in numbered steps below. |

## Numbered implementation steps

### actor-bind-debug-artifacts
- Dependencies: bind-browser-window-policy.
- Bounded outcome: Bind every artifact operation to owner and immutable source class.
1. Add immutable owner subject and source enum Cooperative or ManagedBrowser with principal/profileEpoch/incarnation metadata set only by trusted server creation path. Legacy POST schema unchanged and always Cooperative; client cannot choose/change class or owner.
2. Require authenticated actor on every existing create/upload/handoff/delete call, store reservation and completion recheck; foreign records return same not-found as absent. ManagedBrowser additionally evaluates current enabled Admin/guarded dev Browser admission at every access, including same-subject demotion.
3. Migrate every internal store consumer/test sequentially, preserving extension/protocol and cooperative debug component/bridge harness behavior for ordinary authenticated owners; component definitions are not proof of a mounted current SPA, no unrequested mount/restoration. Preserve selection64KiB,PNG4MiB,TTL10min and existing narrower field validator.
4. Provide revoke_managed_by_principal/profileEpoch hook for manager reset, invalidate upload/handoff reservations and delete managed artifact files before profile deletion. Bound artifact entries/bytes and cleanup; never infer ownership from terminal ID or caller profileId.
- Consumer-visible acceptance:
  - Every ManagedBrowser legacy operation requires actor ownership AND current enabled Admin/guarded-dev Browser admission; same-subject demotion is denied, while Cooperative ordinary-owner workflow remains functional.
  - Client-forged source/owner is rejected by unchanged schema; concurrent upload/handoff/reset recheck cannot resurrect revoked managed artifact.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test browser_debug_artifacts -- --nocapture`
  - `cargo test --manifest-path server/Cargo.toml browser_debug -- --nocapture`
  - Smoke: create both classes, demote same admin, attempt upload/handoff/delete of managed record and own cooperative record; only cooperative remains authorized.

### select-cdp-and-handoff
- Dependencies: actor-bind-debug-artifacts.
- Bounded outcome: Implement CDP selection preview and atomic terminal delivery.
1. Use Overlay inspect events plus DOM/Runtime allowlisted bounded extraction to build existing BrowserSelectionV1; omit values/passwords/HTML/console secrets. NavigationRevision invalidates node handles, preview and pending handoff.
2. Selection screenshot is explicit CDP PNG artifact only, within4MiB and bounded crop/geometry; stream remains JPEG. Create ManagedBrowser source via internal store API with actor/admission/source binding, never legacy client-supplied selection class.
3. UI host selection preview reuses existing terminal owner/generation/incarnation/revision capture semantics, not extension DOM postMessage. Keep independent use-browser-debug cooperative path unchanged except shared safe typed handoff integration.
4. Before artifact create/PNG completion/handoff recheck Browser session/owner/navigation revision and selected terminal incarnation. Store claim plus write_if_incarnation is atomic against terminal replacement; failed write releases only same claim and never falls back to ambient active terminal.
5. selection.spec.ts owns actual post-cutover SPA fixture setup via existing application-fixture/application-services patterns with synthetic auth, provisioned native engine and matching compiled web assets. Any native prebuild uses absolute-root Cargo compiler-artifact resolution and separate scoped setup deadline before readiness per architecture section2; fixture setup contained within this owned spec, no dependency on future phase09 host-browser-app.ts. Existing component/bridge harnesses cover cooperative definitions only; no new cooperative SPA mount.
- Consumer-visible acceptance:
  - Actual post-cutover SPA managed CDP selection shows bounded preview+PNG and hands only artifact reference to exact terminal; cooperative preservation proved by existing component/bridge harnesses, not invented SPA mount.
  - Navigation/owner/terminal/demotion/reset races prevent stale PTY writes; extension protocol/picker and HtmlPreview regressions exercised in existing harnesses without adding cooperative SPA mount.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_selection -- --nocapture`
  - `pnpm --filter @dam-hopper/ui test:browser -- browser-tests/host-browser-selection.browser.tsx`
  - `pnpm --filter @dam-hopper/ui test:e2e -- os-host-browser/selection.spec.ts`
  - `pnpm --filter @dam-hopper/ui test -- src/hooks/use-browser-debug.test.ts`
  - `pnpm --filter @dam-hopper/ui test:browser -- browser-tests/browser-debug-panel.browser.tsx browser-tests/browser-debug-keep-alive.browser.tsx`
  - `pnpm --filter @dam-hopper/browser-bridge test`
  - `pnpm --filter @dam-hopper/browser-extension typecheck`
  - Smoke: actual managed Browser SPA selects element, replaces terminal before handoff (no stale bytes), then normal CDP preview/PNG/reference path; separately run existing use-browser-debug and bridge/component harness regression, no cooperative SPA mounting claim.

### secure-profile-reset-logout
- Dependencies: select-cdp-and-handoff.
- Bounded outcome: Implement fully authorized destructive reset and logout ordering.
1. Capture full live Admin/session evaluation for this request before revoking it, but always perform existing idempotent session revocation, fs/media-ticket revocation and cookie clearing FIRST before any destructive Browser work. Decoded/expired claims remain non-destructive; authenticated reset endpoint separately requires live Browser admission.
2. Only fully evaluated live Admin receipt plus CSRF/Origin (Origin-less native bearer allowed), confirmed browserReset, expectedProfileEpoch and operationId permits wipe. Missing/stale reset preconditions must NOT fail logout for old SPA/native/script/expired clients: return200 with browserCredentialsRetained/resetRequired, never claim credentials cleared. Stale reset endpoint itself remains409.
3. Confirmed branch uses pre-revocation live admission receipt, rechecks current enabled role and expected epoch under principal lock, persists new epoch/tombstone in stable manager files OUTSIDE deletable user-data, fences targets/attachments and revokes managed artifacts/tickets/releases input before terminate-and-wait/delete. Direct cancellation never waits behind congested writer.
4. Account logout remains idempotent200 with cleared/cleanupPending/retained/unknown Browser outcome; session/media revoke already happened. Manager reset worker responds cleanupPending within2s after durable intent if unfinished, continues bounded10s terminate+10s delete independently. Reset endpoint200/202 preserves login; account logout never202. Same operation replay idempotent, dirty relaunch blocked, status requires reauthentication after logout.
- Consumer-visible acceptance:
  - Logout revokes session/media and clears cookie FIRST; old/expired/missing/stale-confirmation clients still receive200 with browserCredentialsRetained/resetRequired, never false cleared.
  - Only fully live admitted+confirmed Admin logout/reset can wipe, after proven descendants exit; passive revoke preserves profile and cleanup failure stays durable pending.
- Future verification (from repository root; new targets above are planned):
  - `cargo test --manifest-path server/Cargo.toml --test browser_host_logout -- --nocapture`
  - `cargo test --manifest-path server/Cargo.toml --test auth_device_sessions -- --nocapture`
  - Smoke: old/stale-confirmation client logout200 revokes session/media FIRST and reports retained/resetRequired; then confirmed fresh login with kill/delete failure returns cleanupPending within2s of intent, survives restart without dirty relaunch.

### migrate-account-logout-ui
- Dependencies: secure-profile-reset-logout.
- Bounded outcome: Migrate every active logout caller and explain local profile removal.
1. Replace direct fetch/local-only account Logout paths with one owner-captured capability/preflight typed flow offering Log out, keep Browser data / Log out and clear shared Browser data / Cancel. **V1: no preselected logout choice**; initial focus goes to Cancel, Escape cancels, neither logout button is default/autofocused, and Enter on initial focus dispatches neither logout nor wipe. Include ServerProfilesDialog.handleLogout, ServerSettingsDialog direct fetch and auth-client exported logout; bounded search for remaining active references before editing, escalate newly found writable callers.
2. Keep-data branch still invokes server logout (without browserReset intent), always session/media revoke+cookie clear FIRST then200 retained/resetRequired or truthful unknown/absent; not local-only signout. Clear-data branch warns all sibling shared Browser targets/logins, requires full live Admin admission+Origin/CSRF+explicit confirmation+expected epoch+operationId. Cancel preserves login/profile. HTTP request timeout10s; server returns completed or cleanupPending within2s after durable intent. Display cleared/pending/retained/unknown distinctly; after logout pending status requires reauthentication, never retry wipe with revoked token or claim credentials cleared on timeout.
3. Local Remove server profile remains explicitly local configuration removal, not authenticated logout or proof of wipe; confirmation says server Browser credentials retained and offers separate account logout choices first (server-revoking keep-data or confirmed destructive clear-data). Reachable account logout still calls compatibility server logout for nonadmin/expired tokens; unreachable clients may clear local tokens only with remote revocation status unknown, never remote-success/deletion claim. Logout200 retained/resetRequired prompts reauthentication+confirmed reset if credentials must be cleared; do not retry wipe with revoked token.
4. Browser reset UI uses same principal-wide confirmation and status, preserving current login. Immediately blank/pause local views on accepted reset/logout; stale async callback cannot mutate a replacement profile. Preserve fs media revocation and current device-session behavior.
- Consumer-visible acceptance:
  - All actual account Logout callers offer keep-data/server revoke-FIRST+200 retained/resetRequired, fully live confirmed clear-data with sibling warning/Origin/epoch, or Cancel; neither logout choice is preselected/default/autofocused, initial focus is Cancel, and initial Enter/Escape cancels without logout or wipe (V1).
  - Local profile removal explicitly says server Browser credentials retained; cancellation, logout200 retained/resetRequired, stale epoch, pending cleanup and offline outcomes are truthful.
- Future verification (from repository root; new targets above are planned):
  - `pnpm --filter @dam-hopper/ui test -- src/api/auth-client.test.ts src/components/organisms/ServerSettingsDialog.test.tsx src/components/organisms/ServerProfilesDialog.test.tsx`
  - `pnpm --filter @dam-hopper/ui test:browser -- browser-tests/host-browser-logout.browser.tsx`
  - Smoke: open logout dialog, assert focus on Cancel and neither logout choice preselected/default/autofocused; initial Enter or Escape sends no logout/wipe request. Explicit keep-data revokes server login and preserves sibling cookie; explicit confirmed clear closes shared Browser views/deletes cookie; Cancel preserves login. Expiry/local removal never implies wipe.

## Durable task contracts / todo
Exactly one fence; task IDs/markers stable across revisions. No tasks.json or hydration in this planning assignment.

```evcrate-tasks
[
  {
    "id": "actor-bind-debug-artifacts",
    "title": "Bind every artifact operation to owner and immutable source class",
    "blocked_by": [
      "bind-browser-window-policy"
    ],
    "allowed_files": [
      "server/src/browser_debug/mod.rs",
      "server/src/browser_debug/store.rs",
      "server/src/browser_debug/tests.rs",
      "server/src/api/browser_debug.rs",
      "server/tests/browser_debug_artifacts.rs",
      "server/src/state.rs"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Every ManagedBrowser legacy operation requires actor ownership AND current enabled Admin/guarded-dev Browser admission; same-subject demotion is denied, while Cooperative ordinary-owner workflow remains functional.",
      "Client-forged source/owner is rejected by unchanged schema; concurrent upload/handoff/reset recheck cannot resurrect revoked managed artifact."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_debug_artifacts -- --nocapture",
      "cargo test --manifest-path server/Cargo.toml browser_debug -- --nocapture",
      "Smoke: create both classes, demote same admin, attempt upload/handoff/delete of managed record and own cooperative record; only cooperative remains authorized."
    ]
  },
  {
    "id": "select-cdp-and-handoff",
    "title": "Implement CDP selection preview and atomic terminal delivery",
    "blocked_by": [
      "actor-bind-debug-artifacts"
    ],
    "allowed_files": [
      "server/src/browser_host/selection.rs",
      "server/src/browser_host/mod.rs",
      "server/src/api/browser_host.rs",
      "server/src/browser_host/manager.rs",
      "packages/ui/src/browser-host/selection-controller.ts",
      "packages/ui/src/os/apps/BrowserApp.tsx",
      "packages/ui/src/hooks/use-browser-debug.ts",
      "packages/ui/src/hooks/use-browser-debug.test.ts",
      "packages/ui/browser-tests/host-browser-selection.browser.tsx",
      "packages/ui/e2e/os-host-browser/selection.spec.ts",
      "server/tests/browser_host_selection.rs"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Actual post-cutover SPA managed CDP selection shows bounded preview+PNG and hands only artifact reference to exact terminal; cooperative preservation proved by existing component/bridge harnesses, not invented SPA mount.",
      "Navigation/owner/terminal/demotion/reset races prevent stale PTY writes; extension protocol/picker and HtmlPreview regressions exercised in existing harnesses without adding cooperative SPA mount."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_host_selection -- --nocapture",
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/host-browser-selection.browser.tsx",
      "pnpm --filter @dam-hopper/ui test:e2e -- os-host-browser/selection.spec.ts",
      "pnpm --filter @dam-hopper/ui test -- src/hooks/use-browser-debug.test.ts",
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/browser-debug-panel.browser.tsx browser-tests/browser-debug-keep-alive.browser.tsx",
      "pnpm --filter @dam-hopper/browser-bridge test",
      "pnpm --filter @dam-hopper/browser-extension typecheck",
      "Smoke: actual managed Browser SPA selects element, replaces terminal before handoff (no stale bytes), then normal CDP preview/PNG/reference path; separately run existing use-browser-debug and bridge/component harness regression, no cooperative SPA mounting claim."
    ]
  },
  {
    "id": "secure-profile-reset-logout",
    "title": "Implement fully authorized destructive reset and logout ordering",
    "blocked_by": [
      "select-cdp-and-handoff"
    ],
    "allowed_files": [
      "server/src/api/auth.rs",
      "server/src/api/router.rs",
      "server/src/api/browser_host.rs",
      "server/src/browser_host/manager.rs",
      "server/src/browser_host/attachments.rs",
      "server/tests/browser_host_logout.rs",
      "server/tests/auth_device_sessions.rs"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "Logout revokes session/media and clears cookie FIRST; old/expired/missing/stale-confirmation clients still receive200 with browserCredentialsRetained/resetRequired, never false cleared.",
      "Only fully live admitted+confirmed Admin logout/reset can wipe, after proven descendants exit; passive revoke preserves profile and cleanup failure stays durable pending."
    ],
    "verification": [
      "cargo test --manifest-path server/Cargo.toml --test browser_host_logout -- --nocapture",
      "cargo test --manifest-path server/Cargo.toml --test auth_device_sessions -- --nocapture",
      "Smoke: old/stale-confirmation client logout200 revokes session/media FIRST and reports retained/resetRequired; then confirmed fresh login with kill/delete failure returns cleanupPending within2s of intent, survives restart without dirty relaunch."
    ]
  },
  {
    "id": "migrate-account-logout-ui",
    "title": "Migrate every active logout caller and explain local profile removal",
    "blocked_by": [
      "secure-profile-reset-logout"
    ],
    "allowed_files": [
      "packages/ui/src/api/auth-client.ts",
      "packages/ui/src/api/auth-types.ts",
      "packages/ui/src/api/auth-client.test.ts",
      "packages/ui/src/api/browser-host-client.ts",
      "packages/ui/src/components/organisms/ServerProfilesDialog.tsx",
      "packages/ui/src/components/organisms/ServerSettingsDialog.tsx",
      "packages/ui/src/components/organisms/ServerSettingsDialog.test.tsx",
      "packages/ui/src/components/organisms/ServerProfilesDialog.test.tsx",
      "packages/ui/browser-tests/host-browser-logout.browser.tsx"
    ],
    "constraints": [
      "Follow architecture-contracts.md; preserve unrelated workflows; escalate any required write outside this literal file set."
    ],
    "acceptance": [
      "All actual account Logout callers offer keep-data/server revoke-FIRST+200 retained/resetRequired, fully live confirmed clear-data with sibling warning/Origin/epoch, or Cancel; neither logout choice is preselected/default/autofocused, initial focus is Cancel, and initial Enter/Escape cancels without logout or wipe (V1).",
      "Local profile removal explicitly says server Browser credentials retained; cancellation, logout200 retained/resetRequired, stale epoch, pending cleanup and offline outcomes are truthful."
    ],
    "verification": [
      "pnpm --filter @dam-hopper/ui test -- src/api/auth-client.test.ts src/components/organisms/ServerSettingsDialog.test.tsx src/components/organisms/ServerProfilesDialog.test.tsx",
      "pnpm --filter @dam-hopper/ui test:browser -- browser-tests/host-browser-logout.browser.tsx",
      "Smoke: open logout dialog, assert focus on Cancel and neither logout choice preselected/default/autofocused; initial Enter or Escape sends no logout/wipe request. Explicit keep-data revokes server login and preserves sibling cookie; explicit confirmed clear closes shared Browser views/deletes cookie; Cancel preserves login. Expiry/local removal never implies wipe."
    ]
  }
]
```

- [x] <!-- evcrate-task:actor-bind-debug-artifacts --> Bind every artifact operation to owner and immutable source class
- [x] <!-- evcrate-task:select-cdp-and-handoff --> Implement CDP selection preview and atomic terminal delivery
- [x] <!-- evcrate-task:secure-profile-reset-logout --> Implement fully authorized destructive reset and logout ordering
- [x] <!-- evcrate-task:migrate-account-logout-ui --> Migrate every active logout caller and explain local profile removal

> Completion note (2026-11-09): Marked DONE per user approval after Cycle 3 code review (score 7/10; 0 critical issues; 237/237 scoped Phase 08 checks + 3,718/3,718 full UI unit suite passing; live-server `packages/ui/e2e/os-host-browser/selection.spec.ts` typechecked, container runtime deferred to Phase 09). Carryovers tracked into Phase 09: 5 High (W1 post-fence handoff/entries write race, W2 UI reset token/generation & pre-guard fence/context ordering, W3 nav watcher overflow entry cleanup, W4 missing-credential public logout `sessionRevoked: true`, W5 post-intent `409 resetFailed` + pre-tombstone `last_reset_operation_id` replay) and 4 Medium (W6 5s nav suppression correlation, W7 cleanup quota release before `remove_file`, W8 selection single-flight polling, W9 `ServerProfilesDialog` `isDeleting` guard).

## Success criteria
- Every task acceptance above is observed with applicable compile/typecheck, behavioral tests and real smoke evidence; missing or failed proof keeps task incomplete.
- Acceptance matrix rows owned by this phase have precise observations, not source-text assertions or mocked-only feature success.
- Writable scope and prerequisite outputs match execution-ownership.md; no competing shared-file writers or product verification storms.

## Risk assessment / failure and rollback
V1 user validation settled no preselected logout choice. Destructive clear still requires full live admission, Origin/confirmation/epoch and sibling warning; no accidental default action on Enter. Keep-data remains a real server logout, not local-only credential removal.
- On a defect, stop dependent work, reopen the producing task and rerun impacted behavioral checks under the single integration owner; do not narrow acceptance. Disable Browser capability if safe operation cannot be established, never restore iframe fallback.

## Security considerations
Managed artifacts require current Browser admission even for same-subject demotion; Cooperative owner remains ordinary-user compatible. Account logout revokes session/media FIRST; missing/stale confirmation still200 retained/resetRequired, never blocked logout or false cleared. Accepted reset revokes managed artifacts before profile deletion.
- Do not store/log bearer/tickets/raw loopback endpoints, real site credentials or sensitive page/selection payload in diagnostics/evidence.

## Next steps
Phase 08 is DONE (2026-11-09) per user approval after Cycle 3 code review (score 7/10, 0 critical issues). Phase 09 (Qualify full app security platforms and efficiency) is unblocked and inherits Phase 08 carryovers W1–W9 (5 High: post-fence handoff/entries write race, UI reset token/generation & pre-guard fence/context ordering, nav watcher overflow entry cleanup, missing-credential public logout `sessionRevoked: true`, post-intent `409 resetFailed` + pre-tombstone `last_reset_operation_id` replay; 4 Medium: 5s nav suppression correlation, cleanup quota release before `remove_file`, selection single-flight polling, `ServerProfilesDialog` `isDeleting` guard) plus live-server container runtime execution of `packages/ui/e2e/os-host-browser/selection.spec.ts`. Shared auth/device-login/extension writers remain serialized by the single integration owner.
- Parent owns independent plan review/optional validation and implementation permission. This phase text neither executes tasks nor supplies approval.

## Unresolved questions
- No unresolved user decision. Compatibility/platform/performance and human observations remain future gates, not passes.
