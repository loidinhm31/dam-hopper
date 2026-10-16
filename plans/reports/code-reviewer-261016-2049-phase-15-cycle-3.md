# Code Review — Phase 15 Cycle 3 (Host resources fleet + usage, H01/U01)

Score: **7/10**. Both Cycle-2 criticals fixed and match server contract. No new criticals. Phase NOT done: settings/model-filter UI still partial, delete-range semantics/dialog display gaps, no device/runtime proof.

## Critical
- None new. Cycle-2 criticals 1 (page-2 400) and 2 (unaligned delete bounds) resolved (verified vs server source, below).

## Verified fixes
1. Page-2 pagination: `UsageController.loadSessions` sends `from/to` only when `cursor==null` (L96-97). Server `parse_list_query` => `(None,None)` => `explicit_range=false` => `decode_cursor` skips range equality check and uses payload range (`usage_sessions/cursor.rs:57-61,115`). Cursor AAD = model only (`cursor_scope`) and model is still sent on page 2 => OK. Reset on window/bucket/model change clears cursor => no stale-cursor reuse.
2. Delete bounds: `UsageBoundsHelper.calculateUtcDayRange` floors to UTC midnight; both bounds `% DAY_MS == 0`, span `days*DAY_MS <= 1825d` = `MAX_DAILY_RANGE_MS` (`usage.rs:542-555`). Accepted by validator.
3. Delete safety: re-entrancy + `disposed` guard (L171); failure => `isDeleting=false`, `deleteError`, `reloadAll()`, data preserved; success => both generations bumped (fences stale loads), reload. No replay of ambiguous request (correct). Dialog buttons disabled while deleting.
4. Settings section: no fabricated zeros (`--` for null settings/health).

## Warnings
1. **Range delete excludes today (semantics).** `to = todayUtc` (start of today); server delete is `[from, to)` (`store.rs` `occurred_at_utc_ms >= ?1 AND < ?2`). Field label "Days to delete (most recent)"; entering 1 deletes *yesterday only*, today's events survive. For a privacy-deletion action that is surprising. Either use `to = todayUtc + DAY_MS` (includes today; span ≤ 1825d still validated server-side, cap days at 1824 or accept `<=`) or relabel "full UTC days before today, today excluded".
2. **Claim #2 overstated: dialog shows epoch-ms, not "resolved UTC dates".** `UsageDialogs.kt:69` prints `"Aligned UTC bounds: $fromUtc .. $todayUtc"` (raw Long). Format as `yyyy-MM-dd` UTC (kotlinx-datetime `Instant.fromEpochMilliseconds(..).toLocalDateTime(UTC).date`) and state exclusive end. Also `now` read in composition each recompose; confirm uses same captured values (ok) but can drift across midnight while dialog open — compute once via `remember`.
3. **Test gap for #2**: `testRangeDeletionSendsUtcAlignedBounds` tests helper + repository only; dialog→controller wiring (the actual cycle-2 bug site) is untested. Extract `from/to` computation call into controller (e.g. `deleteUsageDays(days)`) so it is unit-testable and the Compose dialog cannot diverge.
4. **Settings scope still unmet (carried from cycle-2 W1).** Only Pause/Resume is wired. `updateSetup` zero callers; no enable/exporter/retention/retryCollector controls; section is read-only otherwise. Phase req: "health/setup/enable/pause/retention/exporter settings". QA report lists this as "consider later" — that is a silent scope reduction; needs explicit approval or implementation.
5. **Hard-coded model filter chips** (`UsageScreens.kt:92`): `"All Models"`, `"gpt-4"`. Fabricated model id; real models come from sessions/summary (`models` list). Derive options from loaded sessions' `model`/`models`.
6. **Pause toggle inconsistency** (`UsageScreens.kt` onTogglePause vs `UsageSettingsSection:41`): label uses `settings ?: health ?: false`, patch uses `settings?.paused ?: false`. If settings failed to load but health says paused, button says "Resume" and sends `paused=true`. Use a shared `isPaused` value (or disable toggle when settings null). `updateSettings` failure is silent (no error state) and success doesn't refresh health.
7. Exporter label renders raw enum name (`NOT_CONFIGURED`). Map to readable text.
8. Still-open cycle-2 warnings (not in cycle-3 scope, not recorded as accepted): eager 5-request `UsageController.init` load before panel open; settings/setup/health reloaded on every filter change; heavy SSE/REST decode on Main scope; `evaluateLifecycle` bypassing retry backoff; unknown coded errors/clean EOF/401-403 handling in stream; `isSnapshotStale` null-age => FRESH, no ticker; app-level (Activity) foreground. Decide: fix or record as accepted limitations in plan.
9. `loadSettingsAndSetup` swallows errors via `getOrNull()` => user sees `--` with no reason; `selectedSessionId` not cleared after delete success.
10. No device/runtime proof (SSE disconnect, 32/4 admission denial, proxy buffering, epoch restart, real usage pagination/delete against server). Phase success criterion: compile/tests alone insufficient. Static invariant script (81) is string-presence only.

## Suggestions
- Sessions list uses client clock (`now`) while summary uses server `window`; use `summary.range` for list scope to keep totals/list aligned, and avoid client-clock skew (`to` in future harmless today, but skew can drop newest sessions).
- DRY: 6 repeated `try/catch(ApiRequestError 404|503)` blocks in `UsageRepository` + near-duplicate `HostResourceResult`; one helper.
- Single const for `"delete-usage-data"` (dialog, controller, model default).
- `UsageController` default `Dispatchers.Default` scope is only used by tests; require injected scope.
- Tests use `Thread.sleep` polling loops (flaky risk); prefer `runTest` + virtual time / awaiting `uiState` via `first {}`.

## Positive
- Fixes are minimal, root-caused against server code, with behavior tests for pagination page 2 (asserts omitted `from=/to=`, append, cursor clear) and delete failure/re-entry/retry.
- Honest null rendering (`--`), no raw prompt/command telemetry, aggregate-only, no secrets in UI.
- Generation fencing for stale loads after delete; server capture barrier semantics respected, no ambiguous replay.
- Modular file split (all files <210 LOC).

## Reviewed files
`features/host/UsageController.kt`, `UsageDialogs.kt`, `UsageModels.kt`, `UsageScreens.kt`, `UsageSettingsSection.kt`, `UsageSettingsModels.kt`, `UsageUiState.kt`, `UsageRepository.kt`; tests `UsageControllerLoadingTest`, `UsageRepositoryAndControllerTest` (cycle-3 tests); server refs `api/usage_sessions/cursor.rs`, `api/usage.rs` (`parse_delete_range`), `telemetry/store.rs` (`delete_range_tx`); `tests/test-phase-15-host-resources-usage.sh`; QA cycle-3 report; cycle-2 review. Stream/coordinator/WorkbenchScreen/SSE client unchanged in cycle 3 (not re-reviewed beyond cycle-2 findings).

## Validation
- `./gradlew :shared:jvmTest --tests 'dev.damhopper.nativeapp.features.host.*' --offline -q` => no failure output (only JVM native-access warnings); note shell exit code shown was of the piped `tail`, absence of test-failure output is the evidence.
- `bash tests/test-phase-15-host-resources-usage.sh` => 81 passed, 0 failed.
- QA-reported 398 unit tests / 1034 assertions / assembleDebug: not re-run by me.
- Server contract verified by reading source, not executing against a live server.

## Plan status
Phase 15 file updated: in-progress, Cycle 3 review 7/10, criticals closed, not accepted as done (see W1, W2, W4, W5, W10). `plan.md` row left pending.

## Unresolved questions
- Range delete: should "N days" include today (to = tomorrow midnight) or stay exclusive of today? Which does the product intend?
- Is read-only settings (pause only) approved scope reduction, or must enable/exporter/retention/retry controls ship?
- Model filter: derive from data, or drop the chip?
- Cycle-2 stream warnings (backoff bypass, coded errors, EOF, Main decode, eager load): fix this phase or accepted limitations?
- Who owns device/proxy runtime proof?
