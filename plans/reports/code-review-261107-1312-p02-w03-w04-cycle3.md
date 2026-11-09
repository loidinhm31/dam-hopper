# P02/W03–W04 Code Review — Cycle 3

## Score: 7/10

**Disposition: requested edits present; terminal-lifetime acceptance still blocked by acknowledgement-driven retargeting.**

## Scope / evidence

Reviewed relevant implementation and regression sections of all 11 assigned files, plus supporting `LiveDaemonSmokeTest.kt`, `PreferencesStore.kt`, Android durable-store methods, `ApiClient.kt`, Gradle smoke selection, previous review and P02 contract. Applied published code-review skill and project standards. Source/plan unchanged; this report is the only authored artifact. No compilation, tests, lint or live smoke run; execution verification belongs to Main.

Path shorthand: `common/` = `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`; `tests/` = `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/`.

## Requested verification

1. **Atomic admission: fixed in source.** `common/features/terminal/TerminalRepository.kt:31-33,109-132` uses one companion Mutex around both pending-record lookup and durable reservation; both public create methods share `executeGuardedCreate`. Covers repository instances sharing the production store, not just one caller. No concurrent regression was found in assigned tests.
2. **202 direct eviction: fixed; full C6 behavior incomplete.** `common/ui/screens/ProjectTerminalScreen.kt:1672-1675` sets `Termination requested; awaiting process exit`, retains the controller and backing session list, and no longer invokes `removeSessionLocal` on 202. Its refresh still indirectly changes selection; see critical finding.
3. **Canonical DTO validation: fixed.** `common/features/terminal/TerminalModels.kt:154-168` matches original lowercase UUID and requires canonical positive decimal syntax plus `toULongOrNull()`. Rejects zero, leading zeros, signs and overflow. `tests/features/terminal/TerminalLifetimeContractTest.kt:168-201` includes uppercase and max-u64+1 rejection plus max-u64 acceptance. Repository still normalizes its own epoch argument before constructing the DTO (`TerminalRepository.kt:180-184`).
4. **Smoke null assertion: tightened.** `tests/features/terminal/LiveDaemonSmokeTest.kt:73-74` explicitly asserts the inventory row exists after refusal; it cannot silently pass through a nullable predicate. This proves presence, not `alive == true` or observed exit.
5. **Settings sparse semantics retained.** Explicit shortcut unbinds serialize as JsonNull (`SettingsRepository.kt:365-394`); inbound nulls hydrate through `unboundFields` (`RemoteConfigRepository.kt:46-51`; `SettingsModels.kt:623-633`). Assigned settings regressions assert outgoing omission and inbound unbinding (`SettingsRepositoryTest.kt:305-337`).

## Critical issues list

1. **202 still retargets the active terminal through reconciliation — Cycle 2 C1 only partially resolved.** `ProjectTerminalScreen.kt:1658` sets `destroyingSessionIds[targetId] = true`; the 202 branch calls `refreshSessions()` before clearing that marker (`:1672-1675,1688-1691`). `isSessionSelectable` excludes that row (`:487-489`), and refresh selects the first remaining row or null when the active row is excluded (`:695-727`). With normal non-exact selection, a successful still-live inventory therefore switches away from the pending terminal even though no exit occurred. The row/controller maps survive, but C6 explicitly forbids acknowledgement-driven retargeting (`plans/261107-0305-android-agent-hub-redesign/phase-02-atomic-api-cutover.md:193`). **Impact:** focus/input can move to a sibling terminal solely from a 202. **Correction:** keep the acknowledged terminal selectable/selected during reconciliation; separate mutation/input suppression from selectable lifetime state. Same pattern exists in Restart (`:1234,1257-1259`). **Confidence: high, source-path evidence.**

## Warnings list

1. **High — proven non-submission still leaves a permanent create barrier.** `TerminalRepository.kt:121-149` persists PENDING, but cleans up only decoded success or HTTP 4xx. A local owner/admission rejection before dispatch leaves the project blocked across reconnection. Use request-local admission evidence to settle proven non-submission; retain genuinely unknown delivery.
2. **Medium — create success settlement remains under-validated.** `TerminalRepository.kt:134-143` removes the reservation without requiring 201, matching response ID, positive incarnation or valid original epoch; missing epoch becomes empty string. Timestamp-derived intent IDs (`:110`) also remain contrary to the UUID contract. Validate exact original response identity before settling.
3. **High — supporting live Settings smoke reuses a consumed guard.** `LiveDaemonSmokeTest.kt:97,106,123` supplies the same `TestGuard` to two mutations. `SettingsRepositoryTest.kt:750-755` rejects its second admission. The sparse-patch/preservation assertions are therefore unreachable after a successful seed. Use one fresh guard per request. Static finding; not executed.
4. **High — live qualification remains unsafe/incomplete.** `shared/build.gradle.kts:77-88` excludes only `*LiveSmoke.class`, not `LiveDaemonSmokeTest.class`. The latter contacts a fixed external daemon, mutates preferences without restoration (`LiveDaemonSmokeTest.kt:23,99-148`) and accepts HTTP 500 as a valid termination-mapping result (`:82-88`). Ordinary JVM tests should not run this fixture; successful termination/observed exit remains unproved.
5. **Medium — dormant caller and local-hide carryovers remain.** `WorkbenchScreen.kt:1111-1120` ignores termination outcome/refusal. Local Remove (`ProjectTerminalScreen.kt:1308-1310`) is reversed by the next full inventory assignment (`:688`), rather than persisting a qualified hidden-view/reopen state.
6. **Coverage limitation:** assigned tests exercise sequential preseeded admission (`TerminalRepositoryIntegrationTest.kt:236-274`) and repository status mapping (`:140-209`), not simultaneous callers or production End/Restart selection. Settings preservation test proves unknown keys are omitted from requests, not arbitrary server-side storage round-trip preservation.

## Suggestions list

1. Fix the refresh/selectability coupling before closing C1. Main should exercise 202 + still-live inventory with active target and sibling, asserting identical selected ID/controller; also 202 + failed refresh and refusal retention.
2. Add deterministic two-repository/shared-store concurrent-admission regression with the first response held; require exactly one POST. Cover rejected-before-dispatch versus unknown-after-dispatch settlement separately.
3. Keep smoke explicitly opt-in, fixture-owned and isolated; use fresh guards and restore state. Do not report 500 mapping as successful termination.
4. Consolidate duplicated sparse field enumerations in `RemoteConfigModels.kt:64-132` and shortcut-unbind key enumeration in `SettingsRepository.kt:366-382`; remove unused patch abstractions only after checking consumers.

## Unresolved evidence

No checks executed here. Main still owns compile/regression execution, production UI outcome tests, concurrent admission, Android process/store recreation and successful live termination/observed exit. No unresolved product-design question blocks the correction.
