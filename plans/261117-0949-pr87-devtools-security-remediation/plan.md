---
title: "PR #87 DevTools security and isolation remediation"
description: "Confine DevTools download effects, attribute frame downloads correctly, bind control authority and suppress foreign targets."
status: completed
priority: P1
effort: 40h
branch: feat/browser-enhancement
tags: [bugfix, backend, frontend, auth, security]
created: 2026-11-17
---
# PR #87 DevTools security and isolation remediation

## Outcome and route
Phase 01, Phase 02, Phase 03, and Phase 04 implementations completed; this plan now tracks the remaining qualification/documentation phase (Phase 05). The completed [native DevTools feature](../261116-0223-browser-native-chromium-devtools/plan.md) remains historical context, not a security closure receipt. Phases 01–04 do not imply full qualification or closure before Phase 05 completes.

Close four findings end-to-end: F1 client download-directory override; F2 iframe download cross-tab attribution; F3 DevTools bypass of viewer control; F4 foreign worker/child-target metadata or attachment, including non-Target ServiceWorker authority. Planning evidence did not include deployed Chromium reproduction; Phase 01–04 reported test results and status are recorded below.

## Phases
| Phase | Scope | Status | Effort |
|---|---|---|---|
| [01](phase-01-command-effect-boundary.md) | Command/download policy, ServiceWorker deny and bounded analogous effect inventory | DONE (2026-11-17 12:44:55 EST) | 5h |
| [02](phase-02-frame-download-ownership.md) | Positive frame ownership and GUID-pinned download routing | DONE (2026-11-19 01:23:01 EST) | 8h |
| [03](phase-03-control-capability-lifecycle.md) | Control binding, ordered revocation and shared UI/CDP held-input accounting, all UI callers | DONE (2026-11-19 03:45 EST) | 10h |
| [04](phase-04-target-session-isolation.md) | Positive target/session filtering plus non-Target worker metadata/control closure | DONE (2026-11-19 EST) | 10h |
| [05](phase-05-regressions-qualification-docs.md) | Real-Chromium attacks/input-release/compatibility matrix and canonical API docs | DONE (2026-11-19 12:55:14 EST) | 7h |
Nine durable tasks; strictly sequential graph. Estimates exclude unavailable environment waits. Main is integration/scheduling owner; assign one writer at a time for overlapping sources/tests.
## Phase 01 completion receipt
- **Status:** DONE (2026-11-17 12:44:55 EST), explicitly approved by the user with noted limitations.
- **Validation reported PASS:** latest targeted tester report: unit 5/5; integration 5/5, including the real-Chromium test. The project-manager status update did not rerun checks.
- **Review:** 9/10; accepted with noted limitations.
- **Deferred limitations / scope:** memory-accounting and write-buffer lifetime concerns remain deferred. Phase 02+ ownership work and Phase 05 worker compatibility remain out of scope for this approval and are still pending. This receipt does not claim deployed-Chromium qualification or completion of the four findings.

## Phase 02 completion receipt
- **Status:** DONE (2026-11-19 01:23:01 EST), explicitly approved by the user with noted warnings.
- **Scope:** `resolve-frame-target-ownership` and `route-downloads-by-guid` (positive frame/child-target ownership and GUID-pinned download routing).
- **Validation reported PASS (285/285):** `browser_host::` unit tests 223/223 passed (`target_ownership::tests` 27/27, `manager::ordered_position_tests` 22/22); integration tests 62/62 passed (`browser_host_adapter` 21/21, `browser_host_bounds` 6/6, `browser_host_devtools` 5/5 including real `/usr/bin/chromium` same-process <-> OOPIF round-trip download qualification with `DAM_HOPPER_REQUIRE_BROWSER=1`, `browser_host_selection` 30/30). The project-manager status update did not rerun checks.
- **Review:** 7/10; user explicitly approved with noted warnings.
- **Noted warnings / remaining scope:** global `OwnershipFence::fail_projection` reset without full `ObserverState` resync; `ChildAttached` refusing paused OOPIFs while parent is seeding & `close_page` `"iframe"` absence check; 16 MiB `FRAME_TREE_STAGING_RESERVATION_BYTES` amplification; `frame_rx` token-mismatch `result.is_some()` leak. Phases 03–05 (including Phase 05 two-tab cross-tab real-Chromium gate) remain pending; this receipt does not claim full-plan completion or full remediation closure.

## Phase 03 completion receipt
- **Status:** DONE (2026-11-19 03:45 EST).
- **Scope:** `bind-devtools-control-epoch`, `fence-devtools-command-admission`, and `migrate-devtools-control-ui` (control-bound DevTools capability lifecycle, ordered command fencing and shared UI/CDP held-input ledger/release, and DevTools UI/typed client cutover).
- **Validation reported PASS:** `225` Rust lib tests, `97` integration tests with Chromium, UI build + `56` Vitest tests, and `pnpm lint` (0 errors). The project-manager status update did not rerun checks.
- **Remaining scope:** Phases 04–05 (target/session isolation, Phase 05 real-Chromium attacks/input-release/compatibility matrix, and canonical API docs) remain pending; this receipt does not claim full-plan completion or full remediation closure.

## Phase 04 completion receipt
- **Status:** DONE (2026-11-19 EST), approved by the user after follow-up code review and post-review hardening.
- **Scope:** `enforce-owned-target-sessions` (`devtools_filter.rs`, `target_ownership.rs`, `manager.rs`, `api/browser_host.rs`, `tests/browser_host_devtools.rs`): replaced obsolete `foreign_targets` negative cache and `should_forward_devtools_upstream_message` with `DevToolsSessionFilter` positive target/child-session lifecycle (`Unknown`/`Pending`/`Owned`/`Foreign`/`Detached`), bounded request/target/session/internal-detach tracking, `Target.*` & `ServiceWorker.*` / nonlocal enforcement on root and children, signed 32-bit CDP ID partitioning (`<= i32::MAX`), `OwnershipFence` snapshot provenance + `watch` notifications + `retire_session_for_reseed`, child `Input.*` accounting (`NotWrittenChildDetached`), and real-Chromium multi-tab worker/OOPIF/ServiceWorker isolation tests.
- **Validation reported PASS (99/99):** `browser_host::devtools_filter` 11/11, `browser_host::target_ownership` 27/27, `browser_host_devtools` 10/10 (`DAM_HOPPER_BROWSER_EXECUTABLE=/usr/bin/chromium DAM_HOPPER_REQUIRE_BROWSER=1`), `browser_host_adapter` 21/21, `browser_host_selection` 30/30 (`0` failed, `0` ignored).
- **Review:** Initial 7/10 (`Request changes`) -> Follow-up 9/10 (`Approve with minor notes`); remaining Medium note (`notify_state_changed()` on failure paths) and test/consistency notes fixed and re-verified before user approval.
- **Remaining scope:** Phase 05 (`phase-05-regressions-qualification-docs.md`) full qualification matrix & UI frontend acceptance gates remain pending.

## Phase 05 completion receipt
- **Status:** DONE (2026-11-19 12:55:14 EST), user-approved at Step 4 gate.
- **Scope:** `qualify-devtools-security` and `reconcile-security-docs` (`server/tests/browser_host_devtools.rs`, `packages/ui/e2e/fixtures/{host-browser-app,host-browser-journey-target}.ts`, `packages/ui/e2e/os-host-browser/devtools-security.spec.ts`, `plans/261117-0949-pr87-devtools-security-remediation/reports/phase-05-qualification.md`, `docs/{api/browser-host.md,api-reference.md,architecture/host-browser-cdp-streaming.md,system-architecture.md,project-roadmap.md,CHANGELOG.md}`).
- **Post-review re-verified runs (after 2 review warnings resolved):** `browser_host_devtools` `13/13` (`DAM_HOPPER_BROWSER_EXECUTABLE=/usr/bin/chromium DAM_HOPPER_REQUIRE_BROWSER=1`), `tsc -p tsconfig.e2e.json` exit `0`, `NODE_OPTIONS="--max-old-space-size=4096" ... e2e/os-host-browser/devtools-security.spec.ts --project=chromium --workers=1` `2 passed (51.1s)`.
- **Phase 05 baseline runs:** `browser_host::` lib `230/230`, integration `166/166` across 7 passing suites (`adapter` 21, `auth` 12, `devtools` 13, `gateway` 19, `input` 59, `logout` 12, `selection` 30), `browser_host_media` `31/32` (pre-existing unrelated `test_real_chromium_media_stealth_and_pcm_audio_bridge` timeout at `tests/browser_host_media.rs:1337:10`), UI DevTools unit `56/56` across 3 files, and `@dam-hopper/ui` build exit `0`.
- **Review:** `evc-code-reviewer` `8.5 / 10` (`APPROVED WITH NOTES`; 0 critical, 2 warnings resolved & re-verified).
- **Explicit limits:** Qualified on Linux x86_64 against Chromium `156.0.8078.79` only; Windows fail-closed, no Windows/Android/performance parity claims; `/api/browser/cdp/*` remains an explicit privileged exception outside cooperative viewer control.


## Settled design
- Native full DevTools is active page control, not a read-only inspector. Require current authenticated viewer's control lease, including Runtime/DOM/navigation, not only Input.*. Do not introduce a read-only mode.
- A valid holder cannot change server-owned download policy: deny Page.setDownloadBehavior plus Browser.*, geometry/lifecycle escapes and opaque routing bypasses. ServiceWorker commands default-deny and events suppress unless an enforceable target-scoped contract is proven; context-wide lifecycle commands always deny. Inventory analogous currently-forwarded nonlocal effects narrowly, not a protocol redesign.
- Resolve child/OOPIF frames positively; bind GUID to exact logical session, native target and process/profile incarnation. Unknown/ambiguous frame ownership means no attribution, never all-watchers fallback. Progress follows GUID only.
- Capabilities bind auth session/principal/viewer/logical/native target/incarnation/profile/control epoch. Reuse existing authority owner and shared pending/confirmed UI/CDP native-hold ledger: fence old authority → cancel/drain commands → release holds on captured identity → confirm → publish successor. Ambiguous write/release keeps control unavailable until reconcile/retire; revoked token requires remint.
- Targets/child sessions: Unknown → Owned only with causal live ownership proof; Unknown/Foreign suppressed and unusable; Detached/Retired removed. Origin/type/opener guesses and shared browser process are not proof. Ambiguous shared/service workers stay denied.
- Existing `/api/browser/cdp/*` remains explicitly privileged instance-wide raw automation, outside cooperative viewer control. Audit/document this authority, do not claim universal exclusivity or that these fixes sandbox trusted raw CDP/local host users.
- Preserve owned Console/Network/Elements/Issues, safe native downloads, server geometry ownership and current privacy/logout fences. Clean API cutover; no bodyless-mint compatibility shim.

## Dependencies and serialization
- [Host Browser review remediation](../261109-2251-host-browser-review-remediation/plan.md): concurrent writable overlap, not superseded or an imported whole-plan dependency. Phase 02 `unify-geometry-counters`, `enforce-paired-input-lifecycle`, `recover-screencast-runs`, `bound-browser-payloads` share input/actor/media/API/gateway/tests. Phase 03 `reconcile-browser-ownership` and `wire-browser-interaction` share BrowserApp/API/types/input. Phase 04 shares docs and qualification.
- BLOCK scheduling until Main confirms exclusive shared-file handoff against that plan's current uncommitted work and rechecks live interfaces. Current overview says Phase 02 failures; its detailed handoff reports repairs plus unresolved qualification/review. Neither is approval. Do not require unrelated Windows/Android/soak tasks to finish before reachable Linux security repairs.
- Existing overlapping Phase 03 says downloads denied; completed feature and current source permit native downloads. This plan preserves approved native host downloads. Coordinator must reconcile that stale scope at integration without this author editing the other plan.
- Canonical `docs/api/browser-host.md` overlaps the other plan's Phase 04 `reconcile-release-docs`; Main must serialize that file's explicit handoff with this plan's `reconcile-security-docs`, as well as architecture/system/roadmap docs. API index remains a link, not a duplicate specification.
- Preferred `docs/architecture.md` and root `ARCHITECTURE.md` absent. Relevant baseline `docs/architecture/host-browser-cdp-streaming.md` exists; intended design is recorded here because planner cannot edit maintained docs. Phase 05 publishes reconciled actual contracts, not a claim of prior Gate 1 publication.

## Acceptance and evidence gates
All four attacks denied or correctly isolated through DamHopper routes; owned commands/downloads/frontend still succeed. Assert filesystem bytes/path, per-session DTO/events, DOM outcomes, foreign metadata absence plus independently live B-worker after A's ServiceWorker attempts, and observable UI/CDP native release before safe successor. [Phase 05](phase-05-regressions-qualification-docs.md) gives exact future commands/oracles; skipped native scenarios never pass.

## Accepted independent review triage
[Independent review](reports/independent-plan-review.md): complete, **revision required** (R1 high; R2/R3 medium); report remains reviewer-owned and unchanged. Main/advisor accepted all findings. This revision records design disposition, not resolved findings or approval.
- **R1 accepted:** Phase 01 policy/inventory → Phase 04 enforcement → Phase 05 actual-proxy ServiceWorker metadata/liveness and positive frontend gates. Upstream evidence is not deployed-engine qualification.
- **R2 accepted:** Phase 03 shared authority/held-input lifecycle → Phase 05 CDP and mixed-channel release, failure/race and successor-safety gates; no rollback promise for prior JavaScript.
- **R3 accepted:** Phase 05 owns canonical API JSON/control/asset/WS/revocation/worker/raw-exception docs with cross-plan serialization; no shared docs edits in this planning assignment.

## Planning status and handoff gates
- Selected artifacts revised in place; nine stable tasks, no tasks.json hydration or product edits. Authoring structure inspected on actual linked artifacts before return.
- Initial challenge and [targeted follow-up](reports/independent-plan-review-followup.md) complete: R1–R3 consistently propagated; no residual material planning finding established on reviewed surfaces. This is not implementation finding closure.
- Final `prompt` validation **complete** (2026-11-17): user selected all three existing defaults—raw CDP `retain-privileged` (authenticated instance-wide exception, no cooperative viewer-control coverage); stateful Input `tracked-core` (shared UI/CDP key/mouse ledger, unsupported touch/drag/gesture denied unless cleanup proven); worker scope `deny-ambiguous` (positive target-scoped proof only).
- No material decision changed; existing review/follow-up receipts remain applicable. No repeat review or phase/task changes required.
Phases 01–05 are DONE as recorded above on Linux x86_64 / Chromium `156.0.8078.79`. Unrelated `browser_host_media::test_real_chromium_media_stealth_and_pcm_audio_bridge` failed by timeout; `/api/browser/cdp/*` remains an explicit privileged admin/automation exception, and Windows/physical Android/performance gates remain outside this plan's qualification scope.

## Unresolved questions / blockers
- Active-plan setter was invoked from the published harness; `EVCRATE_SESSION_ID` is unset, so session persistence is unavailable. Carry this explicit selected path; no activation claimed.
1. Main: exclusive source/input/canonical API docs handoff against the active [Host Browser remediation plan](../261109-2251-host-browser-review-remediation/plan.md), including current writers/live interfaces and stale download-denial wording at integration. Scheduling remains blocked until explicit handoff.
2. Implementer/qualifier: prove deployed frame/OOPIF/worker provenance and actual ServiceWorker route behavior against selected executable/protocol. Unknown worker scope stays denied; context-wide methods never gain holder authorization. Required owned frontend/child compatibility and native held-input release/successor safety remain unexecuted.
3. Qualifier: executable/version, supported Linux runner, isolated fixtures and real frontend journey availability unverified. No platform parity claimed.
