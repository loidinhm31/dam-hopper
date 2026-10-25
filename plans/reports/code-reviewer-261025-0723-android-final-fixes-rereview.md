# Android final fixes — source re-review

## Score
**7/10 — changes required.** Two high-priority readiness defects remain; one medium shortcut regression. Not release approval.

## Scope and evidence
- Focus: five named final fixes, affected callers, mutation/readiness lifecycle, notification routing, terminal input and host confirmation.
- Principal sources: `NativeWorkspaceViewModel.kt`, `AgentIntegrationView.kt`, `AgentIntegrationRepository.kt`, `SettingsRepository.kt`, `RemoteConfigEditor.kt`, `ProjectTerminalScreen.kt`, `ProjectTerminalState.kt`, `DamHopperMobileApp.kt`, `HostControlScreens.kt`, `HardwareShortcutRegistry.kt`, `AppFlowNavigation.kt`; supporting ownership/auth models, readiness/integration/shortcut tests, PDR, code standards, architecture, contracts and prior review.
- Reviewed working-tree change inventory; not an exhaustive line-by-line audit of every changed file.
- Assignment reports **901 passing unit tests: 725 shared + 176 androidApp; zero failures**. Accepted as reported, not independently rerun. No build, test, lint, device or live-server checks performed. Coverage percentages unavailable.
- Product code and plan/task state unchanged. This report only.

Path shorthand: **A/** = `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/`; **S/** = `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`.

## Critical issues
**None confirmed in inspected scope.** Remaining high findings block correctness sign-off; absence of a confirmed critical issue is not proof of security or release readiness.

## Warnings

### W1 — High: token settlement still precedes the actual remote mutation
**Evidence:** `A/platform/workspace/NativeWorkspaceViewModel.kt:181-198,204-224,625-645,1097-1103`; `S/features/settings/AgentIntegrationRepository.kt:148-181`; `RemoteConfigEditor.kt:254-291`; `SettingsRepository.kt:946-974`.

`invalidateRuntimeWithMutationFence` starts a token, awaits `coordinator.invalidateRuntime`, then ends the token and advances the provider revision. All three mutation callers perform their HTTP write **after that callback returns**. Thus the new settlement revision settles invalidation, not the mutation.

**Failure [INFERENCE; source-traced, unexecuted]:** invalidation completes → refresh captures the new provider revision → refresh reads old server integration/config evidence while the write is pending → write completes and UI busy clears → refresh publishes with the same revision. Publication checks current busy state, not whether its evidence overlapped the mutation. Busy→idle refresh/cancellation is asynchronous, so it is not an atomic admission fence. Settings selection changes also clear UI busy tokens (`SettingsRepository.kt:453-473,747-751`) without settling admitted requests.

**Impact:** pre-mutation evidence can become VERIFIED and authorize notification effects after configuration/install changes. Token sequence fixes overlapping invalidations, but not full-operation lifetime. Config saves additionally have no equivalent deterministic settlement-refresh wiring in `NativeWorkspaceViewModel.kt:995-1003,1059-1075`.

**Correction:** retain an exact-owner operation token through the actual mutation outcome; settle token/revision under the provider gate before unblocking publication, then request fresh verification. Keep unresolved/Unknown outcomes honest; do not add retries or release protection merely because the selected UI target changed.

**Needed regression:** pause a remote write, start verification that reads pre-write state, settle the write, release verification and assert it cannot publish. Cover source A ≠ target B, selection changes after admission, overlapping operations and config-save refresh. Inspected readiness tests cover invalidation/retirement, not this lifecycle. **Confidence: high.**

### W2 — High: revisions are accessed under incompatible locks
**Evidence:** `A/platform/workspace/NativeWorkspaceViewModel.kt:154-162,187-194,204-238,878-879`.

`endMutation` mutates/copies `revisions: HashMap` under `synchronized(activeMutationTokens)`. `invalidate` mutates/copies the same map under `gate: Mutex`; `publish`/`withVerified` read it under that gate. Runtime work uses `Dispatchers.Default`, so single-thread confinement is not established. `@Volatile revisionView` safely publishes a reference, but does not synchronize the mutable source map.

**Failure/impact [INFERENCE; concurrency not executed]:** simultaneous retirement/invalidation and mutation cleanup can lose revision increments or race while copying/reading the map, invalidating the monotonic stale-result fence. The implementation no longer meets its documented single readiness/effect-gate invariant.

**Correction:** use the same existing provider gate for mutation-token transitions, revision changes and publication checks; hold it only around state transitions, never across network work. Token settlement should be idempotent: currently an absent/already-ended token can also increment a revision.

**Needed regression:** deterministic concurrent settlement/invalidation, including different profiles and duplicate token settlement. **Confidence: high for the data race; manifestation unexecuted.**

### W3 — Medium: focused direct terminal now disables every root shortcut outside composition
**Evidence:** `S/ui/screens/ProjectTerminalScreen.kt:1432-1435,1477-1479`; `DamHopperMobileApp.kt:489-505`; `S/features/settings/HardwareShortcutRegistry.kt:43-44,118-138`.

The invisible direct PTY input now sets `isCommandInputFocused=true` whenever it has focus. Root interprets that as editing and returns before shortcut matching, even when `isImeComposing=false`. Therefore ordinary focused-terminal Search/font/Files/Projects/Cognito chords are bypassed, not merely IME composition or command-draft edits. This conflicts with the registry's stated editable-focus policy that modifier chords still work, and the prior review's explicit requirement to preserve terminal shortcuts outside composition.

**Impact [INFERENCE; mounted input not exercised]:** the fix prevents IME interception by disabling shortcuts at the main terminal input location. Configured chords fall through to the focused input instead of the app action.

**Correction:** distinguish direct-terminal focus, explicit command-draft editing and active composition. Preserve the required editable/IME veto without blanket-disabling normal terminal shortcuts. Keep state in the existing input owner; avoid another dispatch framework.

**Needed regression:** mounted root + focused direct terminal, no composition: supported chord dispatches once and consumes repeat/release; composition: no dispatch; command draft keeps intended editing precedence. Existing registry-only tests do not cover this producer/consumer wiring. **Confidence: high for bypass behavior.**

## Named fix disposition
| Fix | Source assessment |
|---|---|
| Mutation token sequence / settlement revision | Overlap representation improved; W1/W2 remain. |
| `preferencesProfileId` | Correct source-side selector spelling present; A/B distinction retained. |
| Private captured integration execution + opening revision/target | Present; ordinary opening-dialog A→B→A now rejects by opening revision and owner before mutation. Prior opening-time ABA finding closed in this inspected path; dialog behavior not executed. |
| Direct IME composition/focus propagation | Composition reaches `toShortcutInput`; broad focus veto introduces W3. |
| Notification retained workspace activation | Exact current account comparison and retired-authority exclusion added; previous stale-retained-entry case substantially addressed. Null current-account branch remains permissive; prefer fail-closed lookup. |
| Force-suspend ticket recapture | Removed. Conflict handling retains original ticket; no silent authority renewal found. |

## Suggestions — security, performance, architecture, YAGNI/KISS/DRY
1. Fix W1/W2 with existing provider/operation lifetimes, not a second runtime, generic authorization framework or retry loop. Do not use presentation busy state as operation authority.
2. Keep one meaningful input-focus authority. `ProjectWorkspaceState.isCommandInputFocused` duplicates the terminal-owned state; use explicit names for command draft vs direct terminal vs composition.
3. For notification activation, require a non-null current authenticated account rather than `(expectedAccount == null || ...)` (`NativeWorkspaceViewModel.kt:1292-1299`). Exact owner-key lookup is clearer than a partial scan; retain old dirty workspaces rather than deleting them as a workaround.
4. Reconcile closeout docs: code standards still state terminal scroll 1..20, while the feature contract specifies 1..50; architecture/PDR retain intended/unimplemented descriptions. Preserve all genuine live-server/device/visual caveats. No plan status edited by this reviewer.
5. Keep lifecycle state centralized, but after correctness split the oversized VM along existing readiness/runtime/target-service boundaries only where it reduces coupling. No measured performance regression established; new token operations are bounded by in-flight operations, not terminal output volume.

## Positive observations
- No new backend execution path or local PTY/Git/agent boundary introduced by the final fixes.
- Captured integration inputs/repository plus opening selection revision improve destructive-intent integrity without adding a parallel authority system.
- Account/retirement checks improve retained navigation isolation; original force-suspend confirmation authority is preserved.
- Readiness effects remain behind a common authorization gate; the required fix is to restore that gate's complete state/lifetime ownership, not bypass it.

## Unresolved evidence
- No unresolved product decision required to correct W1/W2. W3 needs mounted-root behavior coverage and one consistent focus policy.
- Reported 901 unit passes do not establish the named overlap/settlement/input scenarios. Main should exercise those targeted regressions; do not rerun suites merely to reconfirm the supplied result.
- MainActivity/live-server, physical keyboard/IME, API29/API33+ delivery/permissions, lockscreen, physical-device performance and visual qualification remain separate gates.
