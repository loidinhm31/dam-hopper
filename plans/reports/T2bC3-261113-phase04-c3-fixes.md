# T2bC3 — Phase 04 C3-W1..W6 fixes (2026-11-13)

Spec: `evc-code-reviewer-261113-phase-04-cycle-3.md`. Method: re-located each warning by symbol in the CURRENT tree (HEAD already contains the earlier C3Server/C3Client/C3UI fix pass + T1/T2 working-tree changes), probed for residual defects, red test first, minimal fix. No git commit/stash/reset; T1/T2 untouched.

## Disposition

| W | Disposition |
|---|---|
| W1 | Partly stale (slot-owned gen/seq, expiry sync, source-scoped watermark already landed). 3 real residual defects found + fixed (below). |
| W2 | Premise stale: server applied floor is monotonic (`screencast.rs` ~1050-1060, `max` over run floor, never native fallback), client keeps bounded per-run fence map, placeholders never touch it (`stream-controller.ts:157,502-517,566-625`). Residual: floor advanced on governor policy notification WITHOUT a revision bump -> fixed under W4. Tests strengthened. |
| W3 | Premise stale: `browser-tools.tsx:126` already `value={qualityPreference}`. Tests already cover non-Auto initial, tab change, panel reopen, generation reset, real keyboard (`browser-tools.test.tsx:105`, `BrowserApp.test.tsx:811`, `browser-tools-quality-keyboard.browser.tsx:119,137,178`). No code change. |
| W4 | Real. Fixed with a version protocol + guards on every event-affecting mutation (below). |
| W5 | Premise stale for the controller (latch armed in `attach` `:298`, close/error/control-close/detach notify once `:343-386,1199-1203,1411`, status -> disconnected from connecting `:349`). Added host+REAL controller tests over fake sockets (close-before-open, error->close, control-only close, no double clear). |
| W6 | Done where feasible; see list. |

## W1 residual defects (all red-first)
1. **(run, seq) not coherent / stale sequence leaks across sources.** `latest_audio_seq` (scalar, reset only on next source start) and `audio_source_run` were read separately; a reopen while NO source was live recorded `(None, N_old)` and the next source's chunks 1..N were suppressed (red: `reopen_without_a_live_audio_source_does_not_suppress_the_next_source`, got 3 expected 0). Fix: sequence is per source — `AudioSource{run,cancel,seq}` (`screencast.rs:98-103`), `audio_boundary()` reads `(run, seq)` under the source lock (`:815`), admission counts on the live source's own counter (`admit_and_broadcast_audio_chunk`), no `audio_seq.store(0)`, no scalar. Boundary still sampled inside the adaptive lock at every gate transition (`adaptive_report`, `set_viewer_*`, `evaluate`, `register`).
2. **Write-time check was four lock acquisitions** (read-only gate, read-only gen, then `gate_info` ignoring its gate). Fix: `ScreencastProducer::audio_slot_admissible` decides slot gen + seq + gate + source identity from ONE adaptive-lock state (`screencast.rs:867`); `media.rs:1213 audio_chunk_admissible` delegates. Slot already carried its own `admitted_gen/audio_seq` (`media_writer.rs:39-45,95-101,433`); no shared atomic exists.
3. **Held-backlog barrier was not deterministic**: the old hook only gated *creation* of the audio future, so a future already awaiting `recv()` consumed chunk 6 while "held". Replaced by a `watch` barrier that parks before the receiver is polled and re-parks if engaged while waiting (`media.rs` audio arm; `screencast.rs:909-920`). New ledger counter `audio_dropped_by_boundary` is the oracle.
- Already correct, verified: read-time expiry synced before `last_report` mutates (`adaptive_stream_controller.rs:547-569`, test `expiry_recovery_bumps_generation_and_records_watermark`); source-scoped watermark (`:50-72`, live restart case in media test 4c).

Tests: `browser_host_screencast`: `reopen_without_a_live_audio_source_does_not_suppress_the_next_source`, `audio_slots_are_validated_against_their_own_generation_and_sequence`; `browser_host_media::test_live_media_session_withholds_muted…`: counter equals baseline while held (chunks 6,7 / 9,10 unread), exactly +2 after release, both tier/stall (Hidden report) and wire-unmute recoveries; mute acks now also matched to their own `subscriptionEpoch` and asserted consumed (`mute_ack_seen`/`wm_mute_ack`).

## W2
`capture_version_is_monotonic_during_switching_after_governor_fps_convergence` now asserts the exact retained value `"2"` while switching (was `>= 2`) and drives convergence to `"3"` asserting the advertised version never decreases. Client tests already present: `stream-controller.test.ts:1600,1636` (A/v2 -> warming B/v3 -> A/v1 rejected, B/v2 accepted).

## W4 (revision protocol)
- `capture_tier.rs:480-565`: `QualityRevision` (one atomic: version<<16 | writers in flight) + RAII `QualityMutation` (`begin`/drop bumps, `discard` = no-op mutation, `bump`). Readers accept a snapshot only if no writer was in flight at start and the atomic is unchanged at end.
- `screencast.rs`: guards on every commit of event inputs: run set/clear (start, failed start x2, stop, capture switch, retire), proven frame state (bump only when changed), shared target publish (bump only when changed; `revert_to_effective`), geometry (external fence adopt, `update_geometry` commit; bump only when value changed), applied-version floor advance on governor policy notification (`:~2001`), `reconfigure`.
- `stream_quality_snapshot` (`:934`): waits out in-flight writers (8 x 1 ms), validates, returns `{event, revision: Option}`; unsettled => warming placeholder with `revision: None`. `media.rs emit_stream_quality_if_changed` binds the memoized digest to the snapshot's coherent revision (`UNSETTLED_QUALITY_REVISION` sentinel otherwise) instead of the revision at digest time.
- Tests: `capture_tier` unit x2 (protocol), `geometry_only_change_bumps_revision_and_updates_the_warming_event` (+ no-op stays quiet), `failed_start_run_disappearance_bumps_revision`, `event_snapshot_waits_for_in_flight_mutations_and_reports_unstable_when_they_persist` (forced mutation during construction), `governor_only_policy_change_advances_the_applied_floor_with_a_revision_bump`. Red confirmed for geometry, failed-start, floor tests before the fix.

## W5/W6 UI
`BrowserStreamKeepAliveHost.test.tsx`: stream-controller mock factory can now delegate to the REAL `BrowserStreamController` (`streamState.useRealController`), driven by `FakeSocket`. New describe "with the real stream controller (C3-W6)": (1) first media-open wire payload = stored preference (`high`) then `muteState{muted:false}` derived by the host before attach, nothing sent before open; (2) real media socket close before open: one reset, tuple status/ack/pending cleared, preference kept, mate-socket close does not double-clear; (3) opened socket error->close once, control-only close once. Mutation check: removing `notifyStreamQualityReset()` from `media.onclose` fails (2); restored (file byte-identical to HEAD).
`host-browser-lifecycle.browser.tsx`: new test with two windows on ONE session id (`sess-shared-quality-target`): real selector `selectOptions` high/low independent, store + rendered values, closing one releases only its own preference. Not provable offline: shared capture running at the slowest eligible viewer's fidelity with per-viewer FPS/audio on a live shaped link (documented in the test; server ladder covered by controller/screencast suites).
Real keyboard selection: already in `browser-tools-quality-keyboard.browser.tsx` (userEvent.selectOptions, focus+ArrowDown); no manual DOM assignment remains.

## Commands / counts
Rust (`server/`, `--features vendored`, `DAM_HOPPER_BROWSER_EXECUTABLE=/usr/bin/chromium`, `--no-fail-fast`): build OK; adapter 18, admission 25, auth 12, bounds 6, compatibility 1 pass + 1 FLAKY (see below; 2/2 when green), gateway 19, input 25, lifecycle 22, logout 12, media 27, platform 6, process 27 (+1 helper, 4 ignored), screencast 29 (+6 vs 23), security 7, selection 21, shutdown 4; `--lib browser_host::` 110 (+2 capture_tier). 0 other failures.
UI (Node 24.22.3): `tsc --noEmit` clean; full vitest 3953 passed / 0 failed (400 files; baseline 3950 + 3); browser-mode host-browser-{lifecycle,input,decoder,android,logout,selection}, os-lifecycle, browser-tools-quality-keyboard: 51 passed (baseline 50 + 1).

## Known flake (not attributable to this work)
`browser_host_compatibility::test_authoritative_visual_marker_geometry_and_zoom_qualification` fails intermittently at case "Nonzero Visual Viewport Offsets (PageScale 2.0 …)": "no click was recorded by target element". Observed: 2/2 ring runs failed (without `--no-fail-fast` the ring stops there), 3/9 isolated runs failed right after compiles, 1/12 failed on an idle machine (11 passes). The test uses raw `CdpClient` + Chromium only (imports `cdp`, `process`, `protocol`; no producer/media/screencast/capture code), none of which this task edits; the mouse-wheel visual-viewport pan is load-sensitive. No A/B against HEAD: an isolated `git archive HEAD server` copy does not compile standalone. Baseline notes list a known geometry flake; not retried into green — counted above as 1 pass + 1 flaky.

## Not done / limits
- No media-level event-build / outgoing-message counter for steady frames (revision equality only; not claimed as measured).
- Race delivery of sampled-boundary-before-lock remains structural (ordering argument documented at `adaptive_report`), not reproduced by a black-box test.
- Docs not touched (outside allowed paths; `docs/project-roadmap.md:72` quotes old counts 104/142/185/10).
- Edits used the edit tool only; throw-away mutation/baseline copies lived in /tmp (deleted).

## Unresolved questions
- Should the producer-less/unsettled event path skip emission instead of sending a non-memoized warming placeholder when a writer never settles (currently sends)?
- Docs roadmap counts (`docs/project-roadmap.md:72`) need refresh by the docs owner.
