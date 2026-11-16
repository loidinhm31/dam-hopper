# T1Geometry — unify-geometry-counters (SI-01, SI-04, SI-08)

## Changes
Server (new): `browser_host/decimal_counter.rs` (single `parse_canonical_u64` + serde `positive|nonneg|positive_opt`), `raw_geometry_fence.rs` + `raw_session_targets.rs` (<200 lines each).
- `protocol.rs`: `validate_decimal_sequence` delegates to shared parser.
- `input.rs`: `InputMessage` profileEpoch/inputSeq/viewportEpoch decimal strings; `fence_viewport_epoch()` (epoch 0 sentinel rejects all input).
- `attachments.rs`: ticket `profileEpoch` string. `selection.rs`: summary/artifact DTO counters strings.
- `api/browser_host.rs`, `api/auth.rs`: removed `deserialize_*_or_string` shims; navigate/history/reload/viewport/selection/reset/logout bodies strict strings; reset/selection/logout responses emit strings; DTO re-parse via shared helper; `apply_single_viewport_step` fences input epoch BEFORE native command, rolls back on failure.
- `session.rs`: `checked_add` counters (exhausted => Conflict / input unavailable, no saturate-reuse), `GeometryFence`, `sessions_for_native_target`, `fence_geometry_and_advance_epoch` returns committed fences, adopts dims only when reported; `set_counters_for_test`.
- `screencast.rs`: `update_geometry(geom, target_epoch)` holds lifecycle `state` write lock then `page_setup` (order state->page_setup; Starting never observed; page session cannot appear mid-decision); no geometry lock across CDP (also `ensure_page_session`); monotonic epoch commit (stale dropped); `geometry_trusted` flag; frame `input_trusted` = capture trust && native frame metadata agrees (size ±1px, no zoom); `begin/commit_external_geometry_fence`.
- `cdp_gateway.rs`: per-connection session->target correlation (attach responses/events), fence runs detached (cancel-safe) before relay forwards; unmapped session => conservative fence w/o adopting geometry; sessionless browser-level cmd ignored.
- `media.rs`: pointer dispatch dropped when producer geometry untrusted.
UI: `browser-host-types.ts` (all counters `string`, no unions), `browser-host-client.ts` (+reset status rejects non-canonical epoch, no `?? 1`), `auth-client/types` (`parsePositiveEpoch` -> canonical string via shared validator), `input-controller.ts` (string epochs, bigint inputSeq, exhaustion stop, stale-epoch pending drop, no fabricated epoch), `selection-controller.ts`, `BrowserStreamKeepAliveHost.tsx`, `BrowserApp.tsx`, `browser-session-sync.ts`, `ServerSettingsDialog.tsx` (no fabricated epoch 1). No `Number(`/`parseInt` on counters remain (grep).

## Tests added
Rust: input `test_rest_counters_reject_numbers_and_non_canonical_strings`, `test_rest_counters_round_trip_at_two_pow_53_plus_1_and_u64_max`, `test_input_message_wire_counters_are_canonical_decimal_strings` (red first: 3 failed before impl); auth `test_issue_ticket_profile_epoch_is_canonical_decimal_string`; logout numeric/leading-zero epoch scenarios; decimal_counter unit; gateway `test_raw_flattened_resize_fences_registry_input_and_producer_before_relay`, `..._only_the_addressed_native_target`, `..._unmapped_session_fences_conservatively_without_guessing_geometry`, `..._page_socket_sessionless_resize_and_clear_fence_its_target` (replaced old target-less test); screencast `native_frame_metadata_divergence_revokes_input_trust_and_agreement_restores_it`, `concurrent_start_and_resize_progress_and_native_matches_producer_geometry` (paused native metrics cmd), `real_raw_resize_fences_epoch_and_center_click_lands_at_native_center` (real Chromium, DOM click oracle, raw flattened session resize).
UI: input-controller "canonical decimal wire counters" (4), browser-host-client "canonical decimal string counters" (4), auth-client "browser profile epoch decimal strings" (3). Existing tests migrated to strings (Rust selection/logout/admission/auth/security/input; UI unit + browser-mode).

## Results
- `cargo build --features vendored` OK. Verification suites (before final split-module build): gateway 19, input 12, logout 12, screencast 23, selection 21 all pass; auth 11 pass. Full browser_host_* ring: see addendum below.
- UI: `tsc --noEmit` clean; full unit 3950 passed / 0 failed (baseline 3939 + 11 new); browser-mode host-browser-{lifecycle,input,decoder,logout,selection,android}, os-lifecycle, quality-keyboard 50/50.

## Not done / notes
- Red-first for geometry tests was by construction (new API/signatures); old code not re-run for them.
- "Exhaustion identity renewal" = fail closed (Conflict "exhausted; recreate session", input unavailable); no automatic new-identity minting.
- No re-trust path after raw `clearDeviceMetricsOverride` other than a later native frame agreeing or a REST resize that changes geometry (REST no-op when sanitized geometry equals registry geometry).
- Edits used python/sed for some mechanical bulk renames (repo rule says edit tool).
- Docs untouched (Phase 04).

## Unresolved questions
- Should a REST viewport request equal to current geometry re-apply native metrics when `input_available=false` (recovery after raw clear)?
- Terminal incarnation in selection artifacts kept as nonneg decimal string (UI already sent string) — confirm acceptable scope.

## Addendum: final Rust ring (after module split, `--features vendored`, chromium)
adapter 18, admission 24, auth 11 (+1 new), bounds 6, compat 2, gateway 19, input 12 (+3), lifecycle 22, logout 12, media 20, platform 6, process 27(+1 helper), screencast 23 (+3), security 7, selection 21, shutdown 4 — 0 failures; counts match baseline plus added tests. UI tsc clean; full unit 3950/0.
