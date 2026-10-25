# Android Settings and notifications — final source review

## Score
**7/10 — changes required.** One high-priority readiness-lifetime defect remains. The mutex and direct-terminal focus corrections remove their specific earlier defects, but do not close the complete feature acceptance gate.

## Scope and evidence
- Reviewed working-tree inventory: 73 modified files (+13,098/-4,745), plus new Settings, notification, platform, consumer and test files. Detailed source review concentrated on ownership/security boundaries, all named final fixes and their callers; not an exhaustive line-by-line audit of every changed file.
- Principal sources: retained VM/runtime/readiness/route resolver; `ConnectionRegistry`, `ApiClient`, `ProfileRepository`; `SettingsRepository`, `SettingsPorts`, `RemoteConfigEditor`, `AgentIntegrationRepository/View`, `HardwareShortcutRegistry`; `AgentStatusReducer`, `NotificationCoordinator`; Android notification sink/audio, preference/history storage; root navigation, terminal input, host confirmation, usage and language-filter consumers. Supporting targeted tests, PDR, code standards, frozen contracts, overview/qualification phase and previous review inspected.
- Path shorthand: **A/** = `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/`; **S/** = `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`.
- **Reported validation:** 901 passing unit tests (725 shared + 176 androidApp), zero failures. Accepted as supplied; not rerun. No build, test, lint, instrumentation, device, performance or live-server execution performed by this reviewer. Coverage percentages unavailable.
- Product source and plan/task state unchanged; this report only. Advisor consulted; recommendations checked against inspected source rather than treated as execution evidence.

## Critical issues
**None identified in inspected scope.** This is not a security certification or release approval. W1 blocks correctness sign-off.

## Warnings

### W1 — High: mutation fence settles invalidation, not the remote mutation
**Evidence:** `A/platform/workspace/NativeWorkspaceViewModel.kt:181-225,625-645,883-892,995-1003,1059-1075,1097-1103`; `S/features/settings/AgentIntegrationRepository.kt:148-181`; `SettingsRepository.kt:453-473,747-751,946-974`; `RemoteConfigEditor.kt:254-291`.

`invalidateRuntimeWithMutationFence` begins a token, awaits coordinator invalidation, then ends that token and advances the provider revision. Each actual mutation request occurs **after this callback returns**. Publication checks current busy state but no provider settlement revision marks completion of the real write.

**Failure [INFERENCE; source-traced, not executed]:** invalidation completes → token ends → verification captures the resulting revision and reads old server evidence → mutation writes → busy clears → delayed verification publishes with that same revision. Asynchronous busy→idle refresh/cancellation cannot atomically exclude this ordering. Changing the selected source additionally clears its busy token while an already-admitted write can still be running. Provider publication does not compare `SettingsRepository.agentPathsRevision`.

**Impact:** pre-mutation path/install/config evidence can become VERIFIED and authorize notification effects after remote state changed. Config saves also lack an explicit save-settlement refresh watcher; shown refresh wiring covers source paths and integration actions only.

**Correction:** carry an exact-owner operation token through revocation and the actual request outcome. Settle the token/revision under the existing provider mutex before permitting fresh publication, then explicitly request authoritative verification, including config saves. Never hold the mutex across network work. Unknown/canceled admitted writes must remain honestly unresolved; local coroutine completion is not proof the server finished applying them.

**Required regression:** suspend pre-write verification, settle the write, then release verification and deny its publication/effects. Cover overlapping operations, source A ≠ target B, selection change after admission and config save. The inspected readiness test file covers provider invalidation/retirement, not this full-operation lifetime. **Confidence: high.**

### W2 — Medium: canceled cleanup can strand an active mutation token
**Evidence:** `A/platform/workspace/NativeWorkspaceViewModel.kt:181-198,1097-1103`; `S/core/notifications/NotificationCoordinator.kt:192-194`.

`endMutation` now suspends on the correct provider mutex, but the caller invokes it from an ordinary cancellable `finally`. If cancellation occurs while invalidation/settlement waits for a contended gate, reacquiring that gate for cleanup can throw before token removal. `isMutatingLocked` then continues vetoing publication and effects.

**Impact [INFERENCE; contention/cancellation not executed]:** a canceled Settings action can leave alerts suppressed until explicit cleanup or owner lifetime replacement; another ordinary successful mutation cannot remove the stranded token. No automatic token reconciliation is shown.

**Correction:** make the short exact-token bookkeeping cleanup cancellation-safe, e.g. `withContext(NonCancellable) { endMutation(...) }`, preserving original cancellation and cleanup failures. Do not put the network operation there or equate cleanup with reauthorization after an uncertain write. Make settlement idempotent: only a successfully removed token should advance settlement state; absent/duplicate tokens currently also advance the revision when the set is empty.

**Required regression:** hold the provider gate, cancel the operation while cleanup waits, then release the gate and assert the exact token is settled without swallowing cancellation. Cover duplicate settlement separately. **Confidence: high for the missing cancellation protection; failure ordering unexecuted.**

### W3 — Medium: exceptional AudioTrack initialization can leak the allocated track
**Evidence:** `A/platform/notifications/AndroidNotificationAudio.kt:138-164`.

`createTrack` builds a track, then checks state and calls `track.write`. Normal unsuccessful initialization releases it, but a `RuntimeException` after `build()` enters the outer catch and returns null without releasing the already-created track. The caller never obtains ownership and cannot clean it up.

**Impact [INFERENCE; platform failure not induced]:** repeated initialization/write failures can retain native audio resources, contrary to the adapter's documented release guarantee.

**Correction:** keep track ownership in a local variable and release in a failure/finally path; transfer ownership only after full initialization succeeds. Preserve the current bounded single-playing-track behavior. **Confidence: high for the exception-path ownership gap.**

### W4 — Qualification/documentation closeout remains open
**Evidence:** `plans/261024-2042-android-notifications-settings/plan.md:4,17-24,62-70`; its `phase-05-qualification-and-docs.md:19-33`; `docs/code-standards.md:73`; architecture/PDR baseline descriptions.

The plan still records pending phases and unexecuted server/device qualification. Code standards retain scroll 1..20 while the frozen feature contract requires 1..50/default 5. This does not invalidate the supplied unit results; it prevents a truthful claim of complete acceptance. Preserve unrelated baseline caveats when the assigned documentation owner reconciles verified behavior. This reviewer intentionally did not change task status.

## Named final-fix disposition
| Area | Source assessment |
|---|---|
| Readiness single-mutex synchronization | Specific mixed-lock defect corrected: begin/end, revisions, invalidate and admission now share `gate`. Full mutation lifetime remains W1; cancellation cleanup W2. |
| Source-path busy lookup | Uses `preferencesProfileId` for `AGENT_PATHS`; A/B distinction retained. Busy state alone is not an operation-lifetime fence. |
| Integration confirmation A→B→A | Private captured execution carries opening owner/revision; confirmation checks both before mutation. Specific opening-dialog ABA defect addressed at source level. |
| Direct terminal composition/shortcuts | Direct IME receiver updates composition and clears it on blur without claiming command-draft focus. Root passes composition to shortcut conversion and bypasses shortcuts during composition. Specific blanket terminal-focus veto removed; mounted input not exercised. |
| Notification retained target | Worktree equality and retired-authority exclusion present; live account equality applied when account exists. Remaining null-account permissiveness is a hardening suggestion below. |
| Force-suspend conflict confirmation | Original ticket retained; no conflict-triggered recapture found. |

## Suggestions — security, performance, architecture, YAGNI/KISS/DRY
1. Resolve W1/W2 using the existing owner/token/gate lifecycle. Avoid another runtime, generic permission framework, retry loop or presentation-state authority.
2. Require a non-null current authenticated account when activating a retained workspace; `expectedAccount == null || ...` in `NativeWorkspaceViewModel.kt:1292-1299` fails open at that lookup. Revalidate account with the route commit; prefer exact logical-owner lookup over a partial map scan. Other runtime/registry checks reduce exposure, so no independently demonstrated cross-account exploit is claimed.
3. After correctness, split the 1,340-line retained VM along its existing readiness/runtime/target-service ownership boundaries. Keep one owner and one cleanup graph, not duplicated coordinators. Large files alone do not justify a new abstraction.
4. Exercise mounted-root keyboard regressions: normal focused-terminal chord dispatch once with repeat/release consumption; composition dispatch none; command draft retains editing precedence. Registry-only unit cases do not establish producer/consumer wiring.
5. Retain bounded feed/history/scans and PCM caching. No measured performance regression established. Platform notification/audio calls execute synchronously inside the authorization gate; profile on named devices before changing this serialization guarantee.

## Positive observations
- Request-local single-use guards, explicit outcome taxonomy, redirect rejection and awaited registry retirement preserve a coherent fail-closed transport boundary.
- Notification feed and tracked OS entries are bounded; canonical string identity avoids hash collisions. Private lockscreen presentation and immutable explicit PendingIntents are present.
- Reducer silent baseline, socket/owner qualification and high-water handling remain separate from notification delivery policy; Codex remains status-only.
- Command history is opt-in, bounded, owner/project-scoped and stored in app-private no-backup storage. Preference migration preserves corrupt/legacy bytes instead of overwriting them.
- No added local PTY/Git/AI execution, backend schema expansion, background service or speculative retry mechanism found in inspected changes.

## Unresolved evidence
- W1/W2/W3 exception/concurrency scenarios are source findings, not reproduced runtime failures. Targeted regressions should be exercised by the main verification owner after correction; do not rerun suites merely to reconfirm the supplied 901 result.
- Actual MainActivity + two live servers, API29/API33+ notification permissions/channels/lockscreen, SAF rotation, hardware keyboard/IME, physical ARM64 performance and human visual review remain separate acceptance gates.
- No unresolved product decision is needed to correct the identified defects. No test/type/lint coverage percentage available.
