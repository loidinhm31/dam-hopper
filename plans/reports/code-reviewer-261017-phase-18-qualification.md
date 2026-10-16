# Code Review — Phase 18 Integrated Device Security & Performance Qualification

Branch feat/android-native-app. Plan: `plans/261015-1647-android-native-app/phase-18-integrated-device-security-and-performance-qualification.md` (not edited; Main owns status).

## Score: 5/10

Cross-phase remediations compile and are mostly sound. Qualification tooling/ledger overstate what was proven: audit script false-green, device runner broken on no-device path, on-device "journeys" are JVM-state tests. GATE-C wording must be scoped down before any sign-off.

## Critical issues

1. **`audit-apk-security.sh` Section 4 false-green (gate integrity).**
   - Scans `crypto-bridge/target/**/*.so` = host-built Rust proc-macro dylibs (`libserde_derive`, `libthiserror_impl`, `libzeroize_derive`…) + host `libdamhopper_crypto_bridge.so`, NOT libs extracted from APK. Observed in run output.
   - ELF align parse wrong: `readelf -l | grep LOAD | awk '{print $NF}'` returns PhysAddr, not Align. Reproduced on `/usr/lib64/libz.so.1`: prints `0x0000000000000000`, real Align `0x1000`. Every lib in the run printed `0x0…0`.
   - Mismatch only echoes `[INFO]`; never `record_fail`. Script ends `ALL APK SECURITY & ABI AUDIT CHECKS PASSED` (11/11) while proving nothing about 16 KiB. When `.so` list empty / no readelf → `record_pass`.
   - Only an APK-existence check; no unzip of APK, no ABI (`e_machine`) check, no `zipalign -c -P 16` ZIP alignment, no dependency/license graph, exports, cookies, logging audit (plan step 5 asks all).
   - Ledger §7.21 + §8 cite "passes 11/11" and "static 16 KiB ELF alignment checks" as evidence. Not supportable.
   - Fix: extract `lib/<abi>/*.so` from the APK; `readelf -lW` all `PT_LOAD` Align ≥ 0x4000 per ABI, check machine = AArch64 for arm64-v8a; `zipalign -c -P 16 4`; missing artifact/tool → exit non-zero/BLOCKED; strict failure on mismatch. Static alignment ≠ runtime 16 KiB proof; keep device lane separate.
   - [INFERENCE, not verified] Gradle files searched have no `jniLibs`/cargo-ndk packaging (grep: only `abiFilters` + `Cargo.toml` name; APK listing blocked by repo ignore policy). `OpaqueClientBridge.kt:98` calls `System.loadLibrary`. If no Android `.so` is packaged, the native crypto path cannot run on device at all — must be confirmed against the real APK before GATE-C.

2. **`run-device-journeys.sh` silently fails when adb present but zero devices.**
   - Reproduced with a stub `adb` printing only the header: exit code 1, no `[BLOCKED]`/`BLOCKED_PENDING_DEVICE` output. Cause [INFERENCE]: `DEVICES=$(adb devices | grep … | grep -w device | awk …)` under `set -euo pipefail`; empty grep aborts the assignment before the `-z` check (line 24–26). The documented headless contract ("reports BLOCKED_PENDING_DEVICE when headless", ledger) holds only for adb-missing (exit 2, verified).
   - No-adb path verified OK (exit 2).
   - Fix: `|| true` on pipeline, or capture then test; also handle `unauthorized`/`offline`, multiple devices (script silently takes first; require `ANDROID_SERIAL`).

3. **`WorkbenchJourneys.kt` (androidTest) is not an integrated journey; ledger overclaims.**
   - 4 tests: package-name prefix/`versionName == "0.1.0"`, default `WorkbenchState` flags, `WorkbenchNavigation` in-memory loop (duplicate of JVM unit test), `PrivacyController` state machine (duplicate of JVM unit test). No Activity launch, no Compose rendering, no IME/rotation/process-death, no real server, no fixtures.
   - Plan requires real-server, real UI/IME/PTY journeys and bans incidental-default/wiring tests. Hardcoded `versionName` breaks on any version bump.
   - Ledger §7.21 says script orchestrates "disposable server fixtures" — script contains none: only `adb reverse tcp:4801 tcp:4801` to whatever listens on host 4801 (could be a non-disposable server; plan Risk Assessment requires explicit isolated allowlist). Script prints `[PASS] Device journey … executed successfully` for these state tests.
   - Fix: scope ledger to "on-device model/state smoke"; keep unit duplicates out of androidTest or replace with Compose UI tests (top row visible with IME, horizontal scroll, selected reveal, rotation, same controllers on panel return) against provisioned isolated server; add fixture provision/cleanup + endpoint allowlist.

## Warnings

1. **Ledger overclaims (docs/android-native-acceptance.md §7.21, §8 GATE-C line).**
   - "orchestrating disposable server fixtures" — absent.
   - "font sizes and terminal scrollback wired into TerminalPanelScreen…" — no scrollback change in diff.
   - "full settings/retention controls" (L2) — exporter toggle (`codexExporter`) not wired; only collector enable, 4 retention presets, retry. L3 "end-of-day boundary options" — only a label/format, no option. L4 "background dispatcher payload decoding" and L1 physical SSE/32-4 admission/proxy buffering — not delivered, not listed as open.
   - "automated tests passing 100%", "Over 390 unit tests" — not independently re-run here (see Validation).
2. **`testResourceStreamCoordinatorCleanEofHandling` likely not regression-sensitive.** `emptyFlow` + `advanceUntilIdle()` also fires the 10 s initial-data deadline (`ResourceStreamTimers.INITIAL_DATA_DEADLINE_MS`), and assertion accepts `RETRY_WAIT/REST_ONLY/STOPPED` (STOPPED is not an EOF outcome). [INFERENCE: passes without the 2-line EOF fix; mutation not run.] Assert transition before deadline (advance <10 s) and retry count/RETRY_WAIT specifically.
3. **`testTerminalReplayGateUtf8SplittingAcrossChunkBoundaries`** concatenates byte slices then decodes — proves offset accounting only, not a streaming decoder handling a split multibyte char. Ledger claims "multi-byte sequence preservation".
4. **`HostResourceController : LifecycleAware` is never registered.** `WorkbenchScreen` DisposableEffect listener only calls `hostResourceController?.coordinator?.setForeground(...)`; controller's new `onForeground/onBackground/onOwnerRetired/onDestroy` have no caller (only `register(` at WorkbenchScreen:857, listener object). Dead code (YAGNI) while L4 "explicit Activity foreground lifecycle bindings" is claimed. `LifecycleState` import unused. Also no `UsageController` lifecycle hook (usage polling backgrounding unaddressed).
5. **Terminal font preference only restyles a header `Text`** (`TerminalScreens.kt:302` `"$ ${activeSession.command}"`); no terminal render surface consumes `terminalFontSize` (no TerminalView/textSize anywhere in `androidApp/src/main`, `shared/src/commonMain`). Editor font is wired (`NativeTextEditorView`).
6. **Theme wiring mostly cosmetic.** `NativeTheme` only maps `HIGH_CONTRAST`; `LIGHT`/`SYSTEM` silently render dark. `WorkbenchScreen` Column still paints `DamHopperColors.Background` and screens use static `DamHopperColors`, so scheme affects only Material components. `PreferencesPrivacyView` copy still says "Dark Workbench aesthetic". `HIGH_CONTRAST` exists in no web enum (`packages/ui/src`, `server/src` grep empty) — native-only value.
7. **`dynamicModels` derived from `uiState.sessions`, which `UsageController` reloads using `modelFilter`** (`setModelFilter` → reload with `model = state.modelFilter`). After selecting model X the list collapses to `[All Models, X]`; also limited to loaded pages. Derive from an unfiltered summary/models endpoint or cache the union.
8. **`tests/test-phase-18-device-qualification.sh` = 98 source-grep assertions** (`grep -F` for declared test names, constants, strings). Plan step 2 forbids source-copy/wiring tests; suite does not run any test. Also grep for `"SSE stream completed (EOF)"` etc. — pass on comments. Keep as cheap lint only; do not count toward qualification evidence.
9. **Secret scan weak** (`audit` Section 3): drops any line containing `Test` (path included) or `//` (any URL), `server-token` unanchored; no resources/gradle/properties scan; no log-redaction check.
10. **`UsageSettingsSection` targets** tap boxes ~9–10 sp text, 2–5 dp padding → far below 48 dp accessibility target (plan: accessibility qualification). No in-flight/disabled state or result feedback for `onUpdateSettings`; collector disable has no confirmation.
11. **`SshRepository.forgetCredential`** throws `ApiRequestError(status = 400)` — fabricated status; FQN used inline instead of import. `forgotten=false` with `success=true` is ignored (verify semantic).
12. **`IdleConsentController`** `preserveActionError=true`: refresh failure then overwrites the original action error with the refresh error, and the stale action error persists after a successful refresh until next action. Intended? Confirm.

## Suggestions

- `adb reverse --remove-all` in cleanup also removes unrelated mappings; remove only `tcp:4801`. Use `trap` before `reverse`.
- `run-device-journeys.sh`: record device model/ABI/API/page size to an artifact file; fail (or explicit lane) if ABI != arm64-v8a or page size != 16384 for the qualification run.
- `UsageBoundsHelper.formatUtcDate`: drop `catch (Throwable)` → `"${epochMs}ms"` fallback (`Instant.fromEpochMilliseconds` rejects only extreme values); trivial.
- `WorkbenchScreen`: re-indent the `Column` inside new `NativeTheme { }` (currently unindented block, diff-noise and readability).
- `WorkbenchJourneysUnitTest` duplicated comment lines (`// Sequentially navigate…`, `// Activate with chord`); file-walk FAB/WebView/nav-row tests are source-scans — label as lint, not behavior.
- Extract shared journey assertions (12-panel loop, Cognito flow) once; currently duplicated verbatim between unit and androidTest (DRY).
- Prefer `assertFailsWith<CryptoEnvelopeException>` for tamper cases where deterministic; `Exception` is loose. Fine for GCM auth failure.
- Date/range deletion: add explicit end-of-day boundary toggle if L3 stays required.
- Pipe test commands with `set -o pipefail` in future validation.

## Positive observations

- `HIGH_CONTRAST` scheme, `NativeTheme(theme)` default keeps all existing callers compiling.
- 5 s REST fallback exposed as named constant `REST_FALLBACK_INTERVAL_MS` and tested.
- EOF handled as retryable failure through the existing `handleStreamFailure` path (attempt-fenced), no new state machine.
- Clean `UsageSettingsSection` extension: patch DTO already existed; presets limited; retry only when `dropped > 0`.
- Manifest: `allowBackup=false`, `fullBackupContent=false`, extraction rules exclude all domains, `adjustResize`, release cleartext off, debug cleartext limited to loopback. Verified by reading files.
- OwnershipAndReplay tests cover profile/generation fencing, replay gate dup/overlap/gap, crypto tamper (IV/ciphertext/tag/truncation), lifecycle transitions — meaningful invariants per plan step 2.
- Runner honest on missing adb; ledger states device/visual sign-off pending.

## Reviewed files

native-app: `shared/src/commonTest/.../OwnershipAndReplayTests.kt`, `androidApp/src/test/.../WorkbenchJourneysUnitTest.kt`, `androidApp/src/androidTest/.../WorkbenchJourneys.kt`, `scripts/run-device-journeys.sh`, `scripts/audit-apk-security.sh`, `shared/.../features/host/{ResourceStreamCoordinator,HostResourceController,UsageModels,UsageScreens,UsageSettingsSection,UsageDialogs,IdleConsentController,SshRepository}.kt`, `features/settings/SettingsModels.kt`, `features/terminal/TerminalScreens.kt`, `features/editor/{NativeTextEditorView,EditorScreens}.kt`, `ui/theme/NativeTheme.kt`, `ui/screens/WorkbenchScreen.kt`; also read AndroidManifest.xml, data_extraction_rules.xml, both network_security_config.xml, androidApp/build.gradle.kts, LifecycleCoordinator.kt, ResourceFailureHandler/Timers, UsageController (context).
Also: `tests/test-phase-18-device-qualification.sh`, `docs/android-native-acceptance.md` (§7.20, §7.21, §8). ~2,000 changed/new lines.

## Validation commands / results

| Command | Result |
|---|---|
| `bash tests/test-phase-18-device-qualification.sh` | 98 passed / 0 failed (static grep only) |
| `bash native-app/scripts/audit-apk-security.sh` | exit 0, 11 pass / 0 fail — **false-green**, see Critical 1 |
| `bash native-app/scripts/run-device-journeys.sh` (no adb) | exit 2, BLOCKED_PENDING_DEVICE (OK) |
| same with stub `adb` (no devices) | exit 1, no BLOCKED message (defect) |
| `./gradlew --offline :androidApp:testDebugUnitTest --tests …WorkbenchJourneysUnitTest` | 6/6 PASSED (displayed) |
| `./gradlew --offline :shared:jvmTest --tests …OwnershipAndReplayTests` | BUILD SUCCESSFUL but `FROM-CACHE`; per-test list not observed (build/ reads blocked by ignore policy). A re-run attempt with `-x compileKotlinJvm` failed at compile (my flag misuse, not a code defect). |
| `readelf -l /usr/lib64/libz.so.1 | grep LOAD | awk '{print $NF}'` | `0x0000000000000000` vs actual Align `0x1000` → proves parse bug |

Not independently verified: "390+ tests", `pnpm native-app:assembleDebug`, APK contents, 16 KiB runtime, any emulator/device journey (no adb on host), human visual review.

## Plan TODO status (Phase 18)

- [ ] Real-server native journeys + failure invariants — NOT done (state tests only).
- [ ] Binary/security/license audit + perf/soak — NOT done (script defective; no perf/soak, no license/dependency audit).
- [ ] Human-reviewed evidence + GATE-C decision — NOT done (correctly marked pending).
- [~] Ledger update — partially; contains overclaims (Warning 1).
- [~] Phase 15 residuals: L1 not done; L2 partial (no exporter toggle); L3 partial (UTC labels only); L4 not done (controller hooks unwired).
Recommendation: keep phase status pending / GATE-C BLOCKED; do not describe as qualified.

## Unresolved questions

1. Is an Android `.so` (arm64-v8a/x86_64) actually packaged into the APK? If not, who owns cargo-ndk/jniLibs wiring (Phase 04/05/19)?
2. Should `forgotten=false` with `success=true` be an error in `forgetCredential`?
3. Is native-only `high-contrast` theme intended (web has none), and should LIGHT/SYSTEM remain dark-only?
4. Is leaving L1/L4 and exporter/end-of-day options out of scope for this phase, or must ledger list them open?
5. What physical ARM64 16 KiB device + isolated server fixture will be the Phase 18 reference target?
