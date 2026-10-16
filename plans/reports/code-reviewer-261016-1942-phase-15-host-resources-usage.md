# Code Review — Phase 15 Host Resources Fleet & Usage (H01, U01)

Score: **4/10** — NOT ready to mark done. Models/SSE parser/tests green, but 4 requirements unmet and 3 functional bugs confirmed.

## Critical
1. **Usage summary never loads** (`UsageController.loadSummary/loadSessions/reloadAll`). Shared `queryGeneration`; `loadSummary` captures `++gen`, then `loadSessions(initial=true)` does `++gen` before the summary response lands, so summary result is discarded and `isLoadingSummary` stays true. **Reproduced** with throwaway JVM test (real `Dispatchers.Default`, local HTTP server): `summary=null loading=true`. Same on every `setTimeWindow/setBucket/setModelFilter/deleteUsage`. Existing tests miss it (no controller load test). Fix: per-request generation counters (summary/sessions/detail) or one generation bumped once in `reloadAll` and captured by all.
2. **Usage UI shows fabricated zeros** (`UsageScreens.kt:106-108,146`; `FleetScreens.kt:104-105,124,129`): `codex?.inputTokens ?: 0uL`, `Cores: ?: 0`, `Swap ... ?: 0 MB`. Violates "null/unsupported vs zero" (success criterion; U01 doc: "unavailable ... not fabricated zero"). With bug #1 the user always sees zeros. Also `Availability` (unsupported/degraded) on memory/swap/pressure sections never rendered.
3. **Usage settings/setup/health/retention/exporter flows have no UI/controller path.** `patchSettings`, `patchSetup`, `getHealth` have zero callers (grep). Controller only reads settings/setup into state; nothing renders it. Requirement 3 + todo "all current ... settings flows" unmet.
4. **Range deletion + filters absent.** `UsageDeleteDialog` always deletes all (no from/to, no scope text, no UTC-day/5-year validation); model + bucket filters not exposed in `UsageScreens` (only 24h/7d/30d chips). Requirement "explicit all/date-range deletion", "time/model/session filters" unmet.
5. **Demand never released; foreground never wired.** `FleetScreens` `LaunchedEffect(Unit){ registerViewDemand(...) }` discards the unregister lambdas (x3) -> interest leaks forever, stream + alert polling continue after leaving the panel. `setForeground` has no caller anywhere (grep) -> SSE not paused on app background/panel navigation, contrary to success criterion "stream counts bounded / visible-demand teardown" and the phase's own Android-offscreen risk. Also registers DETAIL_METRICS unconditionally with no detail view.
6. **Retry budget never resets** (`ResourceStreamCoordinator.handleFrame` -> `timers.armStableLiveWindow()` on every frame; it cancels+restarts the 60 s job). With ~5 s frame cadence it never elapses, `retryCount` accumulates across a long session -> after 5 cumulative drops permanent `REST_ONLY` latch (never cleared). Web ref (`host-resource-stream-coordinator.ts:913-924`) arms only if no timer pending. Fix: arm only when `stableWindowJob == null`/inactive.

## Warnings
- **Unknown coded error stalls stream**: `handleCodedError` calls `stopActiveStream()` first, then for `MFA_REQUIRED`/`AUTH_REQUIRED` (outcome null) does nothing -> mode stays LIVE/STARTING, no timer, no retry, no connection-drop notification. Also clean EOF (flow completes without exception) is not handled; reconnect waits for the 45 s byte-idle timer. Spec: EOF = transient failure -> retry.
- **Equal-revision baseline rejected on reconnect** (`ResourceFrameCommitter.commitPairedFrame` `newRev <= currentRev` regardless of attempt). Spec: "paired full frame can establish an equal-revision baseline on a new attempt". If the server revision is unchanged across reconnect (stalled sampler), frame is dropped, 10 s initial-data deadline fires, fails, retries -> REST_ONLY on a healthy stream.
- **401/403 unknown** retried 5x then REST_ONLY (spec: settle on REST-only immediately; MFA/session errors -> connection-drop path).
- **REST fallback fence incomplete** (`HostResourceController.pollRestData`): UI state written with REST data even when `commitRestPair` returned false (stream went LIVE / owner changed / switched during await) -> stale REST overwrites LIVE data. Spec requires predicate check before AND after await. Repository errors swallowed via `getOrNull()` (auth/network errors invisible; `errorMessage` never set). REST commit does not clear `freshness`, so FRESH/STALE chip keeps describing old SSE data while content comes from REST.
- **Thread-safety**: coordinator mutable state (`interestCounts`, latches, `retryCount`, `activeStreamJob`, timer jobs) mutated from UI thread, timer coroutines and the stream collector on multi-threaded dispatchers with no lock/confinement (`stateMutex` only guards `commitRestPair`). `_state.value = _state.value.copy(...)` and `_uiState.value = ...copy` are non-atomic read-modify-write across collector/REST/UI -> lost updates; use `update {}` or single-thread dispatcher.
- **Controller leaks/over-eager work**: `HostResourceController.init` launches state collector never cancelled in `dispose()` (leaks per profile switch on shared Workbench scope); REST (15 s) and alert (30 s) loops start at construction. Alert polling not gated on foreground/auth-blocked (spec: visible && not auth-blocked). `UsageController.init` fires 4 requests at profile connect even if Resources panel never opened.
- **Metrics fallback cadence** deviates: spec = snapshot 15 s, metrics 5 s only in visible detail; native polls both every 15 s.
- **Sessions ignore the time window**: `listSessions` called without from/to (server default 30 d) while summary uses selected 24h/7d -> inconsistent scope between totals and list; also cursor scope tied to a different range than shown.
- **Pagination double-load**: `loadSessions(initial=false)` has no in-flight guard; double tap sends same cursor twice -> duplicate rows appended.
- **Delete safety**: UI clears summary/sessions before outcome known; on failure (incl. ambiguous timeout) no reload, so state is neither old nor verified. No re-entry guard (`isDeleting`), no `disposed` check on completion. Do not replay is OK (no retry in ApiClient), but add post-failure refresh.
- **Staleness display**: FRESH/STALE computed in composition with `Clock.now()` and no ticker (only recomposes on state change); only snapshot age checked, metrics staleness ignored.
- Fleet UI is a single-owner host card; no multi-host fleet list/detail (`selectedDetailHost` unused). "ACTIVE ALERTS" renders REST history, not `snapshot.currentAlerts`.

## Suggestions
- SSE client: `readUTF8Line(MAX)` throws `TooLongLineException` for a >256 KiB single line -> generic failure instead of discard/REST-only; error-body loop counts chars not bytes (`line.length+1`) and `data.length > MAX_*` compares chars to byte caps; lone-CR line ends unsupported; no schemaVersion/canonical-revision/UUID-epoch validation (`toULongOrNull` accepts "+1", "007"; mismatch vs string compare in `updateFreshness`). Token read once per stream (fine) but not refreshed on reconnect failure path—verify `authTokenProvider` is fresh per attempt (it is called per `openEventStream`).
- Dead code / YAGNI: `ProjectionFreshness` `@Serializable` unused; `ResourceConsumerKind` DETAIL_* effectively identical lifecycle; `getHealth` unused; `UsageResult`/`HostResourceResult` duplicated sealed wrappers + 12 near-identical try/catch blocks in repositories (extract `runWithUnavailable(404,503)` helper — DRY).
- `CoroutineScope(Dispatchers.Default)` defaults in 3 classes create uncancelled scopes; require scope injection.
- `ResourceSourceMode.PAUSED` branch in `evaluateLifecycle` clobbers mode to STOPPED/PAUSED without clearing `restOnlyLatch`/`authBlockedLatch`; define explicit latch reset on owner/auth change (spec: auth/MFA/owner replacement invalidates stream state).
- Tests: add coordinator integration tests (timers via virtual time: stable-window reset, EOF, coded errors, equal-revision reconnect), controller load test for summary/sessions, REST-vs-LIVE race, unregister on dispose. Current invariant script is grep/string-presence only (80 assertions) and does not prove behavior; phase requires device/runtime proof (SSE disconnect/admission denial/proxy buffering/epoch restart/real usage setup & range deletion) — none recorded.

## Positive
- Pairing logic (status immediately before data, comment breaks adjacency, epoch+revision match), bounded 256 KiB/4 KiB caps, bounded error read, owner fencing via `registry.assertCurrentOwner` in SSE client, redirects disabled, exact decimal-string revision via `ULong`, epoch-aware reset, null-preserving DTOs (`ULong?`), no new telemetry/raw content collection, no FAB/WebView. Files <200 LOC, modular.

## Reviewed files
SSE client; all `features/host/*` (20 files, ~2.2k LOC); `WorkbenchScreen.kt` wiring (lines 182-186, 324-345, 411-416, 623-637, 1107-1117); 4 test files + `tests/test-phase-15-host-resources-usage.sh`; refs: `docs/architecture/host-resource-sse.md`, `docs/api/agent-usage-and-sessions.md`, `packages/ui/src/api/host-resource-stream-coordinator.ts`, QA report.

## Validation
- `./gradlew :shared:jvmTest --tests 'dev.damhopper.nativeapp.features.host.*' --offline` -> BUILD SUCCESSFUL, all host tests PASSED.
- `bash tests/test-phase-15-host-resources-usage.sh` -> 80 passed, 0 failed (static string checks only).
- Throwaway repro test (deleted afterwards): `UsageController` against local HTTP server -> `summary=null loading=true settings=true` (bug #1 confirmed).
- QA report (`qa-261016-1935-...`) claims 266 jvm + 63x2 android tests + assembleDebug pass; not re-run by me. Passing tests do not cover the findings above; no runtime/device evidence per phase acceptance.

## Plan status
Phase 15 should remain **in-progress/pending** (todo items 1-3 unmet; item 4 evidence ledger not done). Plan file not edited.

## Unresolved questions
- Should "fleet" mean multi-owner list (web fleet selector) or single connected owner? Phase text says fleet/server/detail.
- Is `ConnectionRegistry` owner replacement expected to clear latches within the coordinator, or is controller re-creation (Workbench) the only path?
- Which sessions range does product want when summary window is 24h/7d (pass from/to computed from window vs server default 30 d)?
- Device/proxy/server runtime proof (SSE buffering, admission denial 32/4) still has no owner/environment.
