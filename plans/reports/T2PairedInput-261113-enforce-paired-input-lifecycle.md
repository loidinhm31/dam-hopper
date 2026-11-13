# T2PairedInput — enforce-paired-input-lifecycle (SI-02, SI-05, SI-12)

Status: DONE (Rust ring green; no UI file touched, wire contract unchanged).

## State machine implemented
```
Control/Media socket arrives -> ticket consumed -> live session identity re-checked (Running, exact owner/dev/profileEpoch/incarnation)
  -> pair slot: first socket acquires ONE global ViewerPermit (Arc, owned by socket TASKS; slot holds Weak), arms 15s reaper (tokio timer)
  -> mate joins same permit; control "ready" only when media producer attached + control connected (watch -> control re-sends snapshot)
  -> reaper/close/revoke/unregister drop slot; permit returns when last socket task ends (also on task abort / never-started upgrade)
Input: pair gate -> lease.viewer == control socket viewer -> capture native identity -> enqueue -> ordered dispatch (native_gate)
Any termination (REST release, revoke, holder teardown, seq gap, overflow, expiry, session delete, auth revoke, principal fence):
  lease cleared -> snapshot(held keys+code, buttons+last pointer) -> release on CAPTURED identity (no state lock across CDP)
  -> ok: forget exactly the snapshot (generation CAS) | err: release_failed, input unavailable, REST 503 `inputUnavailable`
PointerCancel: held buttons released natively (keys stay). Failure => control channel closed + `Status{inputAvailable:false}` surfaced.
```

## Changes per file
- `browser_host/attachments.rs`: `PairedSlot` rework (id, media_attached, media_failed, `Weak<ViewerPermit>`, readiness `watch`); `register_pair_connection` (permit closure called only for the first socket; returns `PairRegistration{connection_id,cancel_token,permit}`); `register_connection` now rejects media/control; independent per-slot reaper timer (`PAIR_WAIT_TIMEOUT`, not-ready => cancel+remove); `mark_media_attached`/`fail_media_attach`/`subscribe_pair`; slot-id check so stale sockets cannot remove a newer slot; `revoke_by_browser_session` also drops pair slots + unconsumed tickets; `AttachmentError::ViewerCapacityExceeded`; stale-slot heal.
- `browser_host/input.rs`: manager rewrite — viewer-bound `enqueue_input_for_viewer`, `end_lease` (single termination path), `release_native`, `release_pointer_buttons`, `fence_lease` (in-memory half for the reset fence), `revoke_lease_if_holder`, `expire_if_due`, `begin_dispatch` gate, `capture_native_target`, `release_failure`, `with_lease_ttl`/`new_shared` + active expiry watcher, held state tracks key->code and last pointer, generation CAS, tokio `Instant`, `InputError::ReleaseFailed`; acquire retries a failed release first.
- NEW `browser_host/input_native_release.rs` (<200): `NativeInputTarget` + expiry watcher. NEW `browser_host/control_input.rs` (<200): control-socket input path (pair gate, viewer lease, identity capture, ordered dispatch, PointerCancel release, unavailable status). `mod.rs`: 2 module lines.
- `browser_host/media.rs`: media + control handlers use pair registration (control no longer bypasses capacity), live session check before+after register, producer attach marks/fails pair, producer-less media drops permit early (Phase 04 `unavailable` quality behaviour kept), control snapshot `inputAvailable` gated on pair readiness and re-sent on change; teardown through `revoke_lease_if_holder`; `dispatch_input_event_to_cdp` now returns `Result<(), CdpError>` (pure `input_event_command` builder; NaN fractions no longer dispatch).
- `browser_host/session.rs`: `verify_attachment_identity`.
- `api/browser_host.rs`: ticket issue requires live exact identity (404 stale/foreign, 409 not running); input managers created with active expiry; release/revoke/fence/session-end paths release natively (`release_session_input`; reset fence stays in-memory, native release in teardown); `InputError::ReleaseFailed` -> 503; `ViewerCapacityExceeded` -> 429.
- Tests migrated: media journey (pair registration + permit counting, mock producer for live journey), auth pairing, attachments unit.

## New tests (red first for wire-level ones; run against old code: 8 live-input + 5 pair_live failed)
- input (13): `live::` real-Chromium DOM keyup/mouseup oracle for REST release, PointerCancel, sequence gap, control disconnect, session DELETE, active expiry (1.5s TTL, no traffic), foreign viewer, unpaired control (+ becomes served + advertised once media joins), overflow+revoke (manager on real page identity); `native_release::` every termination path on captured identity with exact key/code/button/position, PointerCancel scope, foreign viewer, injected dispatch failure (REST 503 not `released`, acquire refused, recovers on retry).
- media (7, `pair_live`): control-only reaped at 15s with no traffic (paused clock), half pairs hold capacity until reaped, one permit per media+control pair, failed producer attach holds no capacity + blocks control pairing, closed/stale tickets (issue/consume/upgrade), consume-time check without revoke, simultaneous 8-way half-pair flood with real sockets.
- admission (1): 24-way concurrent half-pair flood bounded to cap, timer-reaped, capacity returns. auth (1): REST ticket issue liveness + DELETE invalidates tickets. attachments unit (5) + input unit adjusted.

## Commands (cwd server/, `--features vendored`, `DAM_HOPPER_BROWSER_EXECUTABLE=/usr/bin/chromium`)
- `cargo build --features vendored` OK, no warnings in touched files.
- Ring (all 0 failed): adapter 18, admission 25 (+1), auth 12 (+1), bounds 6, compat 2, gateway 19, input 25 (+13), lifecycle 22, logout 12, media 27 (+7), platform 6, process 27 (+1 helper, 4 ignored as before), screencast 23, security 7, selection 21, shutdown 4.
- `cargo test --lib browser_host::` 108 passed (attachments +5). admission/input/media re-run twice more after the final edit: 25/25/27 each time, 0 flakes.
- UI: no file touched, vitest not run.

## Decisions / not done
- Control-only socket DOES take the pair's permit (capacity bound for floods) — advisor diagram showed "no permit" for ControlPending; bullet "control must acquire/share it" followed. Flip = pass a no-permit closure for control-first.
- Producer-less media socket stays accepted (Phase 04 test requires `unavailable` quality event), releases permit early, and is reaped at 15s; control cannot join it (403).
- `enqueue_input(msg)` (token-only) kept for in-process callers/other suites; socket path uses `enqueue_input_for_viewer`. Not forced to one API to avoid editing gateway/screencast/security tests outside allowed files.
- `native_gate` mutex is held across a CDP dispatch/release by design (orders dispatch vs release); no `lease`/`held_state`/queue lock is held across CDP.
- Release failure on session delete/auth revoke is only logged (session ends). A release against an already-dead native target fails fast via closed CDP client.
- Overflow is unreachable via socket (queue drained per frame): covered at manager level on a real page.
- Used python for the mod.rs 2-line registration and test-file one-liner renames (rule prefers edit tool).
- Docs untouched (Phase 04).

## Unresolved questions
- Should control-first (no media yet) hold capacity, or only the pair once complete (advisor diagram)? Current: holds.
- 404 vs 409 for closed-session ticket issue: 404 stale/foreign, 409 not-running chosen.
