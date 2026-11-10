# Phase 02 — Stream/input contracts and bounds

## Context links
[Overview](plan.md) · [Phase 01](phase-01-backend-authority-lifecycle.md) · [SI report](../reports/evc-code-reviewer-261109-2251-stream-input.md) · [Stream research](../reports/evc-researcher-261109-2251-stream-lifecycle.md) · [Original contracts §§2–8](../261108-0237-host-browser-cdp-streaming/architecture-contracts.md).

## Overview
Date: 2026-11-09 · Priority: P1 geometry/release/pair/recovery, then P2 counters/memory · Status: pending · Effort: not estimated. Depends on Phase 01 backend-core tasks; native Windows access is a final qualification prerequisite, not a Linux-repair blocker. Same integration owner serializes shared writes.

## Key Insights
- Reproduced: SI:SI-01 raw geometry drift/stale input, SI:SI-02 missing native release, SI:SI-08 string-epoch 422. SI:SI-04 is static concurrent lock inversion, not an unconditional resize freeze; ordinary numeric resize streamed.
- Finding map: `unify-geometry-counters` ← SI:SI-01,SI-04,SI-08; `enforce-paired-input-lifecycle` ← SI:SI-02,SI-05,SI-12; `recover-screencast-runs` ← SI:SI-06; `bound-browser-payloads` ← SI:SI-07. SI:SI-03,SI-09–SI-11 are Phase 03 client repairs.
- Keep working producer/viewer credit separation, target-only BHJF framing and immutable shared payloads. Pinned Chromium ACK/run semantics motivate failure tests; qualify actual installed binary rather than infer version parity.

## Requirements
- One geometry/epoch transaction spans SessionRegistry, native metrics, producer/cache and input pre-dispatch. Apply initial viewport; correlate raw flattened session→native target before mutation. Synchronously disable input/invalidate old frames before external geometry commands; reconcile metrics before trusted publication.
- Serialize start/stop/reconfigure without holding geometry/state locks across CDP awaits or inverted acquisition. Unexpected geometry/zoom stays inputTrusted:false until qualified; no guessed pointer projection.
- Every profileEpoch/viewportEpoch/navigationRevision/frameSeq/inputSeq boundary uses canonical positive decimal u64 strings, checked BigInt/u64 parsing and exhaustion identity renewal. Remove numeric unions/conversions, including all OS/settings/selection callers; no numeric compatibility shim.
- Pair-owned global viewer capacity reserves both media/control identity. Control input requires fully admitted matching pair and exact lease viewer; timer-reap half pairs without later traffic, release permits on failed upgrade. Revalidate exact live session/process/profile at ticket issue and consume/registration; close invalidates unconsumed tickets and failed producer attach cannot advertise ready.
- REST release, cancel, gap, overflow, expiry, disconnect and authority loss dispatch key+code/button releases on original target/channel before clearing native state/final lease. Active expiry timer; dispatch failure marks input unavailable/revokes, never successful silent release.
- ACK admission/enqueue is bounded and independent of waiting for ACK response or downstream credit. Lost ingress, malformed event or actor failure aborts ambiguous run, detaches old Page session and establishes fresh actor/session/run while current demand remains; never replay ambiguous native ACK.
- Reserve every covered ingress/raw-relay/command/candidate/transient decode+pack allocation before retention, including overlap. Share ingress instead of cloning strings; one complete BHJF Bytes publication charged once until last physical writer/cache/outstanding/pending clone drops. 128MiB payload ceiling is not native RSS/allocator/TLS overhead.

## Architecture
Reuse Phase 01 target owner: native target identity → ordered geometry operation → fenced epoch/cache/input state → native command/metrics reconciliation → trusted publication. Pair admission and lease revocation share exact immutable lifecycle identities. Dedicated Page session/run feeds bounded ACK admission and latest candidate; producer recovery replaces failed run, not viewer identity or credit. Global RAII reservation covers unique retained payloads before allocation, without a second diagnostics-only budget.

## Related code files
Modify existing files explicitly owned in task contracts. Geometry/wire cutover includes backend DTOs and every client caller in the listed browser-host/API/OS/dialog files; tests migrate with protocol. Reuse diagnostics.rs/command_budget.rs, no alternate payload framework. Remove obsolete numeric compatibility paths and duplicated geometry caches after migration; no unrelated deletion or new service. Phase 04 owns maintained docs/changelog.

## Implementation Steps
### unify-geometry-counters
1. Centralize geometry operations in existing target owner; propagate flattened relay mapping to synchronous epoch/input fence, initial viewport, metrics reconciliation and cache publication. Remove inverted producer lock order and stale producer-coordinate dispatch.
2. Migrate canonical counters across REST requests/responses, WS controls/input, selection/reset DTOs, UI appState and client tests. Reject malformed/overflow/zero/leading-zero values; exercise >2^53 and u64 maximum without Number/parseInt identity conversion.
### enforce-paired-input-lifecycle
3. Reserve/release capacity per exact pair, gate readiness/input, run independent mate timeout and handle issue→close→consume races atomically. Cancel outstanding target tickets on close/loss.
4. Consolidate release dispatch for every lease termination including PointerCancel and timer expiry; preserve captured key/code/button state until native outcome known, propagate failure and cancel channel on uncertainty.
### recover-screencast-runs
5. Separate prompt bounded ACK enqueue from response wait and candidate publication. Treat event loss/actor health/ACK ambiguity as fatal current run; detach/close old Page session, reconnect fresh run only while exact current demand survives. Preserve zero-demand stop and one bounded recovery screenshot per epoch, never static polling.
### bound-browser-payloads
6. Trace physical ownership from WS/serde ingress through encoded candidate, decoded JPEG, complete envelope and stalled writer. Reserve worst-case overlap before creation, tie commands/raw relays into global budget, retire charges only on final owner drop and expose honest high-water counters.

## Todo list
```evcrate-tasks
[
  {
    "id": "unify-geometry-counters", "title": "Unify geometry fencing and decimal-string counters end-to-end", "blocked_by": ["secure-artifact-logout"],
    "allowed_files": ["server/src/browser_host", "server/src/api/browser_host.rs", "server/src/api/auth.rs", "packages/ui/src/api/browser-host-types.ts", "packages/ui/src/api/browser-host-client.ts", "packages/ui/src/api/browser-host-client.test.ts", "packages/ui/src/api/auth-client.ts", "packages/ui/src/api/auth-types.ts", "packages/ui/src/api/auth-client.test.ts", "packages/ui/src/browser-host", "packages/ui/src/os/BrowserStreamKeepAliveHost.tsx", "packages/ui/src/os/apps/BrowserApp.tsx", "packages/ui/src/os/window-store.ts", "packages/ui/src/os/persistence.ts", "packages/ui/src/components/organisms/AccountLogoutDialog.tsx", "packages/ui/src/components/organisms/ServerProfilesDialog.tsx", "packages/ui/src/components/organisms/ServerSettingsDialog.tsx", "server/tests/browser_host_input.rs", "server/tests/browser_host_gateway.rs", "server/tests/browser_host_screencast.rs", "server/tests/browser_host_selection.rs", "server/tests/browser_host_logout.rs", "packages/ui/browser-tests/host-browser-input.browser.tsx"],
    "constraints": ["Reuse existing target owner, no parallel geometry registry; migrate all counter callers without number unions or compatibility shims; no CDP await under inverted state/geometry locks."],
    "acceptance": ["SI:SI-01,SI-04,SI-08 addressed: initial/requested/native geometry agree or input is disabled; raw same-target resize fences epoch before input, center click reaches displayed native center; concurrent start/resize progresses; canonical string DTOs round-trip losslessly above 2^53 and at u64 limits."],
    "verification": ["Future: cargo test --manifest-path server/Cargo.toml --test browser_host_input --test browser_host_gateway --test browser_host_screencast --test browser_host_selection --test browser_host_logout; pnpm --filter @dam-hopper/ui test src/browser-host src/api/browser-host-client.test.ts src/api/auth-client.test.ts; real initial/API/raw viewport DOM-marker coordinate oracle, paused start/resize race and REST/WS counter boundary round trips; Phase 04 runs compile/typechecks after integration."]
  },
  {
    "id": "enforce-paired-input-lifecycle", "title": "Enforce live pair admission and original-target native release", "blocked_by": ["unify-geometry-counters"],
    "allowed_files": ["server/src/browser_host/attachments.rs", "server/src/browser_host/input.rs", "server/src/browser_host/media.rs", "server/src/browser_host/session.rs", "server/src/browser_host/manager.rs", "server/src/api/browser_host.rs", "server/tests/browser_host_media.rs", "server/tests/browser_host_auth.rs", "server/tests/browser_host_input.rs", "server/tests/browser_host_admission.rs"],
    "constraints": ["Pair owns one global permit; unpaired control never input-ready; cleanup uses captured original native identity and propagates failed releases."],
    "acceptance": ["SI:SI-02,SI-05,SI-12 addressed: control-only sockets are bounded and timer-reaped; stale/closed tickets fail issue/consume/upgrade; lease cannot use foreign viewer; every termination emits native keyup/mouseup before clearing, active expiry works, dispatch failure is unavailable not released."],
    "verification": ["Future: cargo test --manifest-path server/Cargo.toml --test browser_host_media --test browser_host_auth --test browser_host_input --test browser_host_admission; real sockets held beyond 15s without traffic, simultaneous half-pair floods, failed upgrade, ticket-before-close consume; DOM keyup/mouseup oracles for REST/cancel/gap/overflow/expiry/disconnect/revoke and injected dispatch failure."]
  },
  {
    "id": "recover-screencast-runs", "title": "Recover producer demand after ingress, ACK and actor failures", "blocked_by": ["enforce-paired-input-lifecycle"],
    "allowed_files": ["server/src/browser_host/cdp.rs", "server/src/browser_host/command_budget.rs", "server/src/browser_host/screencast.rs", "server/src/browser_host/media.rs", "server/src/browser_host/manager.rs", "server/src/browser_host/diagnostics.rs", "server/tests/browser_host_adapter.rs", "server/tests/browser_host_screencast.rs", "server/tests/browser_host_media.rs"],
    "constraints": ["Prompt exactly-one current-run ACK attempt per accepted event, never ambiguous replay; viewer credits do not pace native ACK; fresh dedicated Page session on ambiguous failure."],
    "acceptance": ["SI:SI-06 addressed: bounded ingress cannot silently strand ACK obligation; actor/ACK failure stops old run and visibly recovers current demanded target with fresh identity; no-demand recovery does not restart, static screenshot polling remains zero."],
    "verification": ["Future: cargo test --manifest-path server/Cargo.toml --test browser_host_adapter --test browser_host_screencast --test browser_host_media; block ACK responses/writes, overflow ingress, kill actor and interleave pause/resume; observe actual production frame-marker advancement after fresh-run recovery, one ACK attempt ledger and no replay of old run credit."]
  },
  {
    "id": "bound-browser-payloads", "title": "Account for complete live payload ownership before allocation", "blocked_by": ["recover-screencast-runs"],
    "allowed_files": ["server/src/browser_host/cdp.rs", "server/src/browser_host/cdp_gateway.rs", "server/src/browser_host/command_budget.rs", "server/src/browser_host/screencast.rs", "server/src/browser_host/media.rs", "server/src/browser_host/protocol.rs", "server/src/browser_host/diagnostics.rs", "server/src/browser_host/config.rs", "server/tests/browser_host_bounds.rs", "server/tests/browser_host_adapter.rs", "server/tests/browser_host_media.rs", "server/tests/browser_host_screencast.rs"],
    "constraints": ["No per-viewer JPEG copy or server re-encode; include encoded/decode/pack overlap and raw/actor/command retention in one ceiling; no RSS-as-payload substitution."],
    "acceptance": ["SI:SI-07 addressed: every distinct covered live buffer is pre-reserved, complete shared BHJF charged once through final physical owner, reservations return on cancellation/failure, global high-water cannot exceed configured ceiling under cross-product load."],
    "verification": ["Future: cargo test --manifest-path server/Cargo.toml --test browser_host_bounds --test browser_host_adapter --test browser_host_media --test browser_host_screencast; production ingress/candidate/decode/pack overlap plus raw relay and stalled-writer load, including clone_data paths and closed subscription with live writer; record reservation ledger separately from allocator/native RSS for Phase 04 soak."]
  }
]
```
- [ ] <!-- evcrate-task:unify-geometry-counters --> Unify geometry and counter contracts
- [ ] <!-- evcrate-task:enforce-paired-input-lifecycle --> Enforce pair and lease cleanup
- [ ] <!-- evcrate-task:recover-screencast-runs --> Recover current producer demand
- [ ] <!-- evcrate-task:bound-browser-payloads --> Bound all covered payload ownership

## Success Criteria
All eight mapped SI defects close against real producer/attachment/input paths; old geometry cannot admit input, wrong socket cannot gain credits, failed release cannot report success, visible demand recovers and bounded allocation survives slow peers. Remaining four SI client findings explicitly Phase 03; full runtime/performance qualification Phase 04.

## Risk Assessment
Counter cutover is intentionally coordinated breaking cleanup: deploy matching backend/SPA, incompatible Browser fails closed. Recovery can over-ACK or restart after privacy/pause; retain exact run/demand fences. Rollback disables/drains Browser and preserves profile/tombstone; never revive numeric shim or old iframe.

## Security Considerations
Ticket issue/consume/session liveness are one authority boundary, not existence-only checks. Media/control identity and original-target release cannot be ambient. Raw CDP remains privileged, but must synchronously reconcile geometry before ordinary viewer input resumes.

## Next steps
After all four task contracts settle, Phase 03 first repairs reproduced shell-close portal failure, then owner/demand/lease/UI lifetime. Main executes coherent checks only after shared edits land; authoring ran none.
