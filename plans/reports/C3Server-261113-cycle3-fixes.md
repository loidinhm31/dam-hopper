# C3Server Cycle-3 Fixes Report

Date: 2026-11-13
Agent: C3Server

- C3-W1(a): `latest_audio_seq` and `audio_source_run` read inside `adaptive` lock across gate transitions; SeqCst fetch_update ordering guarantees broadcast chunks have seq <= watermark.
- C3-W1(b): `QueuedAudioSlot` carries `admitted_gen` and `audio_seq`; writer validates slot's own values at write time; removed shared `queued_audio_gen` atomic.
- C3-W1(c): `report_with_seq` syncs gate before updating `last_report`, ensuring expiry transitions to Suppressed then Allowed, bumping generation and recording watermark. Added unit regression.
- C3-W1(d): `AudioWatermark` is source-scoped (`source_run`); ignores/resets watermark when audio run changes. Added regression and live integration test for retained subscription.
- C3-W2: `applied_event_version` monotonic per run; retains advanced version on governor FPS convergence during subsequent Switching, never falling back to older native snapshot. Added regression.
- C3-W6: Added `hold_audio_drain`/`release_audio_drain` test barrier for deterministic held backlog; verified tier/stall and wire unmute recovery; asserted wire mute ACK before observation window; noted ScreencastLedger has no event-build counter and quality_revision invariance directly guarantees 0 builds.

## Verification
- `cargo test --features vendored --lib browser_host`: 104 passed
- 9 integration suites (media, screencast, input, bounds, lifecycle, gateway, admission, selection, shutdown): 142 passed

## Unresolved Questions
- None.
