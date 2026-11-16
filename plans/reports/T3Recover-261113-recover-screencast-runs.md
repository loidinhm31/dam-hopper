# T3Recover — recover-screencast-runs (SI-06)

Status: INCOMPLETE — worker interrupted; its claims below require independent review. Focused adapter, screencast and media suites passed (88 tests) after interruption; no independent full-ring receipt.

## State machine implemented
```
Running{run, page_session}
  frame accepted -> ONE ACK attempt enqueued synchronously (CdpClient::enqueue_screencast_ack; never awaits Chromium,
                    independent of viewer credit); ≤8 unanswered per run (Semaphore) else fatal
  ingress Lagged | ingress Closed | actor closed | ACK Err | ACK timeout | ACK backlog | oversize frame | enqueue Err
     -> fail_run(run, cause) -> [state lock] CAS current_run==run (stale => no-op)
        retire_locked (Stopped, run None, token cancel, audio source torn down, caches cleared, QualityMutation bump)
        pointer trust withheld (full-scale runs) until an agreeing native frame of the next run
        one-shot recovery screenshot allowance re-armed; old Page session detached (bounded 2s) / forgotten if actor dead
        -> single-flight supervisor (requested/active handoff, explicit stop bumps epoch):
             failures>max_attempts => `unavailable` (quality revision bump), stop, no timers
             backoff (0, base, 2base.. cap) -> state lock -> epoch/state/demand re-verified under lock
             no visible demand => Idle (no restart, no screenshot)
             open_fresh_page_session_locked (reconnect actor if dead, detach old, attach, Page.enable, metrics, stealth)
             start_run_locked (same start path as the capture-tier switch): NEW producerRun, new audio source
Guard: ack/frame/status of a run != current run is dropped (session/run checks), never grants credit; a stale abort is a no-op.
New demand after exhaustion runs one normal start (heals dead actor too); success clears `unavailable`.
```

## Changes per file
- `browser_host/cdp.rs`: `PendingCommand`/`PendingAck`; `dispatch` split into sync `enqueue` (everything up to non-waiting `try_send`) + `PendingCommand::wait`; `enqueue_screencast_ack` (sync, returns before any response); `ack_screencast_frame` kept as thin wrapper (compat suite). Reconnectable actor: `ActorLink`/`ActorShared`, `CdpClient::reconnect()` (dials the same endpoint, same broadcast channels so subscribers survive; refused for endpoint-less clients and for clients carrying the browser-wide request policy). `is_closed/closed/close` read the current link.
- `browser_host/screencast.rs`: inline ACK await removed; `handle_incoming_frame` returns `Option<AbortCause>`; run loop: actor-lost arm (`cdp_client.closed()`), `Lagged`/`Closed` fatal (was warn/continue), test barrier `ingress_gate`; `ensure_page_session` split into fast path + `attach_page_session_locked`; `session_for_start` (dead actor => fresh session); `note_run_started`; explicit `stop_screencast`/`retire_producer_on_fatal_error` cancel pending recovery; stealth child-target listener cancelled when a session is replaced; `Unavailable` status in `build_stream_quality_from_snapshot` inside the revision-validated read; 8 ledger counters (`acks_completed/abandoned`, `ingress_lagged`, `runs_aborted`, `recovery_attempts`, `recoveries_succeeded/exhausted`); `acks_enqueued` now counts admitted ACK attempts (previously successful ones).
- NEW `screencast/recovery.rs` (184 lines: `RecoveryPolicy`, `AbortCause`, `RecoveryState`, builder + hooks), `screencast/recovery_supervisor.rs` (162: ack watcher, abort, supervisor), `screencast/fresh_page_session.rs` (69: reconnect/detach/attach/stealth, bounded).
- `browser_host/media.rs`: `producer_is_current` keeps a producer that is recovering its own actor; `follow_page_session_changes` re-binds the session navigation watcher (filters by Page session id) after recovery replaced the session.
- Not edited (not needed): command_budget.rs, diagnostics.rs, manager.rs.

## Tests (red-first was by construction: new API; behaviour proven by mutation below)
`browser_host_screencast` (+10, 29 -> 39): `blocked_ack_responses_never_stall_later_acks_and_expire_into_a_fresh_run`, `failed_ack_aborts_the_run_and_recovers_without_replaying_old_credit` (also trust withheld/restored), `ingress_overflow_is_fatal_and_recovers_with_a_fresh_run_session_and_audio_source`, `lost_actor_reconnects_a_fresh_actor_session_and_run_and_frames_resume`, `no_demand_never_restarts_and_issues_no_screenshot_polling` (+ demand heals dead actor), `demand_that_disappears_while_recovery_backs_off_is_not_restarted`, `pause_and_resume_during_recovery_start_exactly_one_fresh_run`, `persistent_recovery_failure_is_bounded_visible_and_cleared_by_new_demand`, `persistently_failing_acks_cannot_spin_runs`, `real_chromium_actor_loss_recovers_a_fresh_run_and_frame_marker_advances` (real Chromium, rAF DOM marker + frame_seq advance). Existing burst test now also asserts `ingress_lagged==0`/`runs_aborted==0` on a real stream (no false aborts).
`browser_host_adapter` (+3, 18 -> 21): `test_cdp_ack_enqueue_returns_before_any_response_and_wait_observes_it`, `test_cdp_reconnect_replaces_a_dead_actor_and_keeps_existing_subscribers`, `test_cdp_client_without_an_endpoint_cannot_reconnect`.
`browser_host_media` (+1, 27 -> 28): `pair_live::producer_recovery_keeps_the_viewer_socket_and_serves_the_fresh_run_then_reports_unavailable` (same media socket sees run1 -> run2 frames, then `unavailable`).
Mutation checks (restored byte-identical from backup): lag made non-fatal -> ingress test fails ("never started a fresh run"); inline ACK await (old behaviour) -> blocked-ACK test fails (ACK attempts 1 not 3).

## Commands / counts (`server/`, `--features vendored`, `DAM_HOPPER_BROWSER_EXECUTABLE=/usr/bin/chromium`)
- `cargo build --features vendored` OK (only pre-existing warnings).
- Ring, `--no-fail-fast`, 0 failures: adapter 21, admission 25, auth 12, bounds 6, compatibility 2 (green this run; known flake not hit), gateway 19, input 25, lifecycle 22, logout 12, media 28, platform 6, process 27 (+4 ignored, +1 helper), screencast 39, security 7, selection 21, shutdown 4.
- Library test receipt unavailable: worker interrupted before reporting the result.
- Flake checks: screencast suite run 6 times (39/39 each); media+adapter repeated twice.

## Not done / limits
- Capture-tier switch double failure and `update_geometry` rollback failure still retire fail-closed WITHOUT recovery (existing tested behaviour, outside SI-06 triggers).
- `follow_page_session_changes` (nav watcher re-bind) compiled and reasoned but has no dedicated automated test (needs a full manager-materialized producer); active selection inspect overlay is not re-armed on the replacement Page session (selection is stale until re-picked).
- Held input leases keep their captured old-session identity; their release against a detached session fails and surfaces as input unavailable (fail-safe).
- Real-Chromium ingress lag/ACK-failure cannot be induced without a fault proxy (Chromium flow control keeps <=2 frames in flight); those paths use the scripted mock peer. Real Chromium covers actor loss + marker advance.
- Chromium in-flight limit assumption (<=2 frames) vs ingress capacity 2: no false lag in 6+ real runs (`ingress_lagged==0` asserted); if a Chromium build allowed 3 in flight a slow loop could churn runs (bounded by backoff/unavailable).
- Oversize base64 frame is now run-fatal (was silently dropped, stranding its credit).
- Docs untouched (Phase 04).

## Unresolved questions
- Should capture-switch double failure also go through the recovery supervisor (would change `failed_retry_after_failed_switch_retires_the_producer_fail_closed`)?
- Default bounds (5 attempts, 250ms..4s backoff, 10s ACK timeout, 10s stable-run reset) acceptable, or should they come from `BrowserBudgets` config?
