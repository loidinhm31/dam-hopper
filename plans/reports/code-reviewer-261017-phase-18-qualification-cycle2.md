# Code Review — Phase 18 Qualification, Cycle 2

Branch feat/android-native-app. Plan: `plans/261015-1647-android-native-app/phase-18-integrated-device-security-and-performance-qualification.md` (not edited; still `pending`/0%; Main owns status).

## Score: 6/10 (was 5/10)

3 of 5 remediations verified good (device runner, lifecycle registration, knownModels). APK audit now inspects real APK but still has gaps. Ledger remediation is NOT actually applied: the §7.21 overclaims from Cycle 1 are still in the file despite "fully updated" claim.

## Remediation verification

| # | Item | Verdict |
|---|---|---|
| 1 | `audit-apk-security.sh` real APK + readelf | PARTIAL. Real APK unpack + `readelf -W -l` works (run: 13 pass/0 fail; `libandroidx.graphics.path.so` align `0x4000`, x2 = 2 ABIs). Gaps below (W1–W3). |
| 2 | `run-device-journeys.sh` empty adb | FIXED. Stub adb header-only → exit 2 + `BLOCKED_PENDING_DEVICE`. Stub `unauthorized` device → exit 2 BLOCKED (excluded by `grep -w device`). No adb → exit 2. |
| 3 | `hostResourceController` ↔ `lifecycleCoordinator` | FIXED. `WorkbenchScreen` `DisposableEffect(lifecycleCoordinator, hostResourceController)` registers, `onDispose` unregisters. `register()` replays `onForeground()` when already FOREGROUND. Minor redundancy (S2). |
| 4 | `knownModels` | FIXED functionally. `UsageUiState.knownModels` accumulates in `loadSessions` `.distinct()`; `setModelFilter`→`resetPaginationAndReload` copy keeps it; `UsageScreens.dynamicModels` unions known + loaded. Chips no longer collapse. No unit test for it (W5). |
| 5 | Ledger honesty | NOT FIXED. See Critical 1. |

## Critical issues

1. **Ledger §7.21 / §8 still overclaim (`docs/android-native-acceptance.md`).** Diff vs HEAD shows the Cycle 1 flagged lines unchanged; only GATE-C line (§8, L799) was reworded.
   - L765: "orchestrating disposable server fixtures" — script has none; only `adb reverse tcp:4801 tcp:4801` to whatever listens on host 4801 (also script comment "Setup isolated disposable server fixtures").
   - L770: "font sizes and terminal scrollback wired into `TerminalPanelScreen`…" — no scrollback consumer in diff; terminal font only sizes header `Text` (`$ ${activeSession.command}`) [Cycle 1 W5, not rechecked].
   - L768: "full settings/retention controls" — exporter toggle, end-of-day boundary option not delivered; L1 (physical SSE/32-4 admission/proxy buffering) and L4 (background dispatcher payload decoding) not listed as open.
   - L765: `WorkbenchJourneys.kt` "validating full 12-panel navigation… Cognito input gating" — JVM-state tests, no Activity/Compose/IME; reads as integrated journey.
   - L775: "audit … passes 11/11 checks" — script now reports 13 and the checks are partly weak (W1–W3); drop count or restate precisely.
   - L773: "Over 390 automated unit tests" / §8 "automated tests passing 100%" — counts not evidenced in ledger (Cycle 1 not independently counted).
   - Fix: reword §7.21 to "on-device model/state smoke only; real-server UI/IME/PTY journeys, perf/soak, license audit, L1, L4, exporter toggle, end-of-day option, terminal scrollback: OPEN". Remove "disposable fixtures". Plan TODOs 1,2,3,5 stay unchecked. GATE-C = BLOCKED, not "tooling delivered" success.

## Warnings

1. **Audit false-green path persists.** `else` branch (no `.so` found) still calls `record_pass "APK native packaging audit complete (zero unaligned .so…)"`. If APK missing, script records FAIL for artifact then also PASS here (contradictory). Should fail/BLOCK when APK absent or `unzip`/`readelf` missing (currently silently skipped via `command -v … &&`).
2. **Only the first `LOAD` segment is checked** (`head -n 1`). 16 KiB requirement applies to every `PT_LOAD`. Use `awk '/LOAD/ {print $NF}'` and require all ≥ `0x4000`.
3. **Real crypto bridge is absent from APK and audit says nothing.** Run lists only `libandroidx.graphics.path.so` (x2). `OpaqueClientBridge` does `System.loadLibrary("damhopper_crypto_bridge")` and swallows `UnsatisfiedLinkError`. No Gradle jniLibs/cargo-ndk packaging (grep: only `abiFilters`). Audit passes 13/13 with the native crypto path unshippable on device. Add explicit required-lib assertion (`libdamhopper_crypto_bridge.so` per ABI) or record as documented BLOCKER in ledger. Also: no `e_machine` check (AArch64 for arm64-v8a), no `zipalign -c -P 16 4` ZIP alignment (zipalign not installed on host; script should say so, not skip), no dependency/license audit (plan step).
4. **Device runner gaps (non-blocking for headless).** Multiple devices silently take first (require `ANDROID_SERIAL`); no enforcement of `arm64-v8a`/page size 16384 for qualification; `adb reverse --remove-all` clobbers unrelated mappings and `trap` set after `reverse`; no endpoint allowlist for the :4801 server.
5. **No test covers `knownModels`** or `HostResourceController` lifecycle dispatch via `LifecycleCoordinator.register` (OwnershipAndReplayTests uses its own listener at L247). Both fixes unguarded against regression.
6. Cycle 1 warnings not addressed/outside this cycle scope, still open: EOF test not mutation-sensitive (W2), UTF-8 split test (W3), cosmetic theme wiring (W6), 98 source-grep assertions counted as evidence (W8), weak secret scan (W9), 48 dp targets in `UsageSettingsSection` (W10). Track, not blockers for this cycle.

## Suggestions

1. `WorkbenchScreen` listener still calls `hostResourceController?.coordinator?.setForeground(...)` in addition to registered `hrc.onForeground/onBackground` → redundant double dispatch (idempotent). Remove direct calls from anonymous listener (DRY).
2. `HostResourceController.onOwnerRetired` disposes; ensure `WorkbenchScreen` doesn't keep rendering a disposed controller after retirement (not verified).
3. Add `knownModels` reset on profile/owner change if `UsageController` is ever reused across profiles (currently per-profile [INFERENCE]).
4. Audit: print per-ABI path (`lib/arm64-v8a/…`) not basename; both x86_64/arm64 lines are identical in output.
5. Re-indent `Column` inside `NativeTheme { }` in `WorkbenchScreen` (carried).
6. Replace inline FQN `dev.damhopper.nativeapp.ui.theme.NativeTheme` with import.

## Positive observations

- Audit now unzips `lib/*/*.so` from the real APK, uses `readelf -W -l`; parse yields real Align (`0x4000`) instead of PhysAddr — Cycle 1 parse bug resolved.
- Device runner: pipeline `|| true` fix works; exit code 2 consistent across no-adb / empty / unauthorized.
- Lifecycle registration uses keyed `DisposableEffect` with symmetrical unregister.
- `knownModels` minimal, localised change; `distinct()` retains order.

## Reviewed files

`native-app/scripts/audit-apk-security.sh`, `native-app/scripts/run-device-journeys.sh`, `native-app/shared/.../ui/screens/WorkbenchScreen.kt` (lifecycle block 828-870), `.../features/host/{HostResourceController,UsageController,UsageUiState,UsageScreens}.kt`, `.../core/lifecycle/LifecycleCoordinator.kt`, `native-app/androidApp/build.gradle.kts`, `OpaqueClientBridge.kt` (grep), `docs/android-native-acceptance.md` (§7.21, §8), `tests/test-phase-18-device-qualification.sh`, prior report `code-reviewer-261017-phase-18-qualification.md`. ~120 changed lines this cycle.

## Validation commands / results

| Command | Result |
|---|---|
| `bash native-app/scripts/audit-apk-security.sh` | exit 0; 13 pass / 0 fail; packaged `.so`: `libandroidx.graphics.path.so` ×2, Align `0x4000` (real APK). Native crypto lib not present; not flagged. |
| `bash native-app/scripts/run-device-journeys.sh` (no adb on host) | exit 2, `BLOCKED_PENDING_DEVICE` |
| same, stub adb header-only | exit 2, BLOCKED (Cycle 1 defect fixed) |
| same, stub adb `ABC unauthorized` | exit 2, BLOCKED |
| `bash tests/test-phase-18-device-qualification.sh` | 98 pass / 0 fail (static grep only) |
| `./gradlew --offline :shared:jvmTest :androidApp:testDebugUnitTest --rerun-tasks -q` (pipefail) | exit 0, no failures printed; per-test counts not observed (quiet mode) |
| `grep` ledger for `disposable server`, `11/11`, `scrollback wired`, `390`, `full settings` | all 5 still present (L765, 768, 770, 773, 775) |

Not verified: physical/emulator device (no adb), 16 KiB runtime, zipalign, `pnpm native-app:assembleDebug` re-run (APK pre-existing), human visual review, test counts.

## Plan TODO status (Phase 18)

- [ ] Real-server native journeys — NOT done.
- [ ] Binary/security/license audit + perf/soak — partial (real-APK ELF align done; perf/soak/license absent).
- [ ] Human evidence + GATE-C — pending (correctly).
- [ ] Ledger update — NOT honest yet (Critical 1).
- [~] Phase 15 residuals: L2 model filter now fixed; exporter toggle, L1, L4, L3 end-of-day still open.
- Recommendation: keep GATE-C BLOCKED; fix Critical 1 + W1–W3 before sign-off.

## Unresolved questions

1. Who owns cargo-ndk/jniLibs packaging for `libdamhopper_crypto_bridge.so` — Phase 18 gate or Phase 19? Gate-C cannot be qualified without it.
2. Is `zipalign -P 16` available in CI SDK build-tools (not on this host)?
3. Which physical ARM64 16 KiB device + isolated server fixture is the reference target?
4. Are exporter toggle, end-of-day option, L1, L4 explicitly deferred (if so, list as OPEN in ledger)?
