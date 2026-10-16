# Code Review — Phase 15 Cycle 2 (Host resources fleet + usage, H01/U01)

Score: **5/10** — Cycle-1 criticals 1,2(mostly),5,6 fixed. Two NEW server-contract defects make session pagination and range deletion non-functional against the real server. Settings/model-filter UI still partial. Not ready to mark done.

## Critical
1. **Session pagination always fails on page 2.** `UsageController.loadSessions` recomputes `from=now-window`, `to=now` with fresh `now` on every call, incl. `initial=false`. Server (`server/src/api/usage_sessions/cursor.rs:57-61,115`): both `from`+`to` present => `explicit_range`; cursor decode rejects if `query.from/to != payload.from/to` => HTTP 400 invalid. Page-1 cursor carries page-1 `to`; page 2 `to` differs => every "Load More" errors. Also window not in {24h,7d,30d} => `from=null,to=now` => server `invalid()` (`(None,Some)` arm). Fix: persist `from/to` (or `response.range`) from page 1 in `UsageUiState`/controller and resend identically with cursor, or omit both on cursor pages (server then takes cursor range). Add controller test asserting page-2 `from/to` == page-1 and a mock that rejects mismatch (current tests: single-page only, nextCursor=null).
2. **Range deletion always rejected by server.** `UsageDeleteDialog` sends `from=now-days*86_400_000`, `to=now`. Server `parse_delete_range` (`server/src/api/usage.rs:542-555`) requires both `rem_euclid(DAY_MS)==0` and span <= 5*365 days. Unaligned => `invalid()`. Dialog also lets user pick 1825 days (OK) but never states UTC-day alignment / exact range being deleted (phase: "exact range/cursor scoping" + explicit confirmation). Fix: floor `to` to UTC-day boundary (or next midnight), `from=to-days*DAY_MS`, show the resolved UTC date range in the dialog before confirm; add unit test for the aligned bounds. Full-delete path is OK.

## Warnings
- **Settings/setup UI incomplete (claim #3 overstated).** Only a Pause/Resume toggle is wired. `updateSetup` has zero callers; enable/disable, Codex exporter enable, `retryCollector`, retention-days patch have no controls (grep: only `UsageScreens.kt:137` calls `updateSettings(paused)`). Phase req "health/setup/enable/pause/retention/exporter settings" partially unmet. `setModelFilter` has no UI caller either => model filter missing (claim #4 only bucket + range delete done).
- **Fabricated values remain in `UsageSettingsSection`**: `h?.collector?.dropped ?: 0uL` (health null => "Dropped Events: 0"), `Collector: Inactive` when settings not loaded, `Exporter: N/A`. Contradicts cycle-2 claim #2 / null-vs-zero criterion. Show `--` / "Unknown".
- **Delete failure leaves UI blank/unverified**: `deleteUsage` clears summary/sessions/selection before outcome; on failure (incl. ambiguous timeout) no reload, no `isDeleting` re-entry guard, no `disposed` check. Do-not-replay is right, but add `reloadAll()` on failure so UI reflects server truth. Selected session id not cleared.
- **Heavy decode on Main**: `WorkbenchScreen` passes `rememberCoroutineScope()` (Main) to coordinator/controllers; SSE `decodeFromString` + `decodeFromJsonElement` (up to 256 KiB / ~5 s), REST decode and per-line `armByteIdleDeadline` (cancel+launch per line, duplicated in `handleFrame`) run on Main. Move decode to `Dispatchers.Default` (`withContext`/`flowOn`) to avoid jank. (Upside: single-thread => cycle-1 thread-safety concern is mitigated in prod; still wrong for the `Dispatchers.Default` default args — drop defaults, require injected scope.)
- **Eager usage load**: `UsageController.init` => `reloadAll()` (summary+sessions+settings+setup+health = 5 requests) at every profile connect, before Resources panel is ever opened (`setForeground(false)` arrives after, does not cancel). `loadSettingsAndSetup` also re-runs on every filter change (3 needless requests). Init as backgrounded; load settings once / on foreground.
- **`evaluateLifecycle` bypasses backoff**: any `registerInterest`/unregister while `mode==RETRY_WAIT` or `PAUSED->` calls `startStreamAttempt()` immediately (mode not LIVE/STARTING) — a second consumer mounting during RETRY_WAIT cancels the retry timer and reconnects now, defeating 1/2/4/8/16 s backoff and the 5-retry budget logic (retryCount not incremented on this path => unbounded reconnect churn on flapping nav).
- **Cycle-1 stream warnings still open (not in cycle-2 scope list)**: unknown coded error (`MFA_REQUIRED`/`AUTH_REQUIRED` => `handleCodedError` outcome null) stops the stream and leaves mode LIVE/STARTING with no timer/retry; clean EOF not treated as transient failure (waits 45 s idle); 401/403 retried 5x before REST_ONLY; REST `getOrNull()` swallows auth/network errors (`errorMessage` never set); `restOnlyLatch`/`authBlockedLatch` never cleared except by controller re-creation. Decide explicitly or record as accepted limitations.
- **Freshness UI**: `isSnapshotStale` returns `false` when `snapshotAgeMs==null` => green "FRESH" for unknown age; computed in composition with no ticker (never flips to STALE without another state change); metrics staleness ignored.
- **Alerts section**: "ACTIVE ALERTS" renders REST alert history, not `snapshot.currentAlerts`; label inaccurate. Fleet UI is single-owner card (selectedDetailHost unused) — confirm acceptable as "fleet".
- **Coverage gap vs claims**: no behavioral tests for fixes #6 (stable window via virtual time) and #7 (equal-revision reconnect baseline), no unregister-on-dispose test, no page-2/range-delete controller test. Invariant script (81) is static string presence only. No device/runtime proof (SSE disconnect, 32/4 admission denial, proxy buffering, epoch restart) — phase success criterion says compile/tests alone insufficient.
- **App-level foreground**: `setForeground` wired only to active panel (`LaunchedEffect(activePanel)`); no Activity/process lifecycle (app backgrounded while Resources panel active keeps stream/polls). Confirm Android lifecycle hook lives elsewhere or add.

## Suggestions
- SSE client: `readUTF8Line(MAX)` throws `TooLongLineException` on oversize line (generic failure => 5 retries then REST_ONLY rather than FRAME_TOO_LARGE REST_ONLY); error-body loop counts chars not bytes; `data.length > MAX_*` compares chars with byte caps; `trimStart()` strips more than SSE's single leading space; `onByteProgress(line.length+1)` counts chars.
- Sessions list uses client-clock `now`; summary uses server `window`. Prefer `summary.range` from/to for sessions to keep totals/list scope identical.
- DRY: 12 near-identical `try/catch(ApiRequestError 404|503)` blocks in two repositories + duplicate sealed wrappers `UsageResult`/`HostResourceResult` -> single `runCatchingUnavailable` helper / one generic result type. Unused: `ProjectionFreshness` `@Serializable`, `isMetricsStale`, `ResourceConsumerKind` DETAIL_* identical lifecycle.
- `armStableLiveWindow` null-check redundancy (`!= null && isActive`) -> `isActive == true`; self-null inside job races with `clearAll`.
- Delete dialog hard-codes `"delete-usage-data"` in 3 places (dialog, controller, test) -> single const.

## Positive
- Cycle-1 items verified fixed in code: separate `summaryGeneration`/`sessionsGeneration` + `update{}` atomics (UsageController); `?: "--"` for null tokens/memory/mount point in Usage+Fleet screens; demand released via `DisposableEffect.onDispose` (FleetScreens); panel foreground wired (WorkbenchScreen); stable window armed only if inactive; `isNewAttemptBaseline` equal-revision baseline (still rejects regressions); REST fence now gated on `commitRestPair` result; bounded error read (<=4 KiB) and byte-progress callback; per-attempt `streamAttempt` fencing; `registry.assertCurrentOwner` in SSE client; `isCurrentOwner` null-safe registry validation; redirects off; ULong decimal-string revisions; null-preserving DTOs; no raw prompt/command telemetry; zero FAB/WebView; files all < 210 LOC.
- Auth header per attempt via suspend `authTokenProvider`; no secrets in UI diagnostics.

## Reviewed files
`core/transport/HostResourceSseClient.kt` (diff), `ui/screens/WorkbenchScreen.kt` (diff + wiring 305-360, 400-425), all `features/host/*.kt` (ResourceStreamCoordinator, Timers, FrameCommitter, FailureHandler, HostResourceController, HostResourceRepository, UsageController, UsageRepository, UsageScreens, UsageDialogs, UsageSettingsSection, UsageSettingsModels, FleetScreens, ResourcesUnifiedPanelScreen, ResourceStreamModels), tests (`UsageControllerLoadingTest`, `ResourceStreamCoordinatorTest` grep), `tests/test-phase-15-host-resources-usage.sh`; server refs `usage_sessions/cursor.rs`, `usage.rs` (`parse_delete_range`, `parse_query`), `docs/api/agent-usage-and-sessions.md`; prior `code-reviewer-261016-1942`, QA cycle-2 report.

## Validation
- `bash tests/test-phase-15-host-resources-usage.sh` -> 81 passed, 0 failed (static).
- `./gradlew :shared:jvmTest --tests 'dev.damhopper.nativeapp.features.host.*' --offline -q` -> exit 0 (no failures).
- QA cycle-2 report claims 395 unit executions + 1034 assertions + assembleDebug pass; not re-run by me. Passing tests do not cover criticals 1-2 (verified by reading server cursor/delete validators, not by executing against the server).
- No device/runtime proof exists.

## Plan status
Phase 15 file overview updated: in-progress, Cycle 2 not accepted. `plan.md` row left `pending`; do not mark completed until criticals 1-2 fixed + tests, settings/model-filter UI finished (or scope reduction explicitly approved), runtime proof recorded.

## Unresolved questions
- Settings scope: is pause-only toggle acceptable, or must enable/exporter/retention/retry controls ship (phase text says all)?
- "Fleet" = single connected owner (current) or multi-host list?
- Should unknown coded errors / EOF / 401-403 handling be fixed this phase or recorded as accepted limitations?
- Who owns device/proxy runtime proof (SSE buffering, 32/4 admission)?
- Range-delete UX: days-back picker vs explicit UTC date picker?
