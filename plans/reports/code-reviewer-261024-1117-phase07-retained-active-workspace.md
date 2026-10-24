# Phase 07 Code Review

## Verdict

**3/10 — changes required; Contract C7 acceptance not satisfied.** Kotlin compilation and focused tests pass according to the separate test runner, but production integration does not implement the retained workspace/document/terminal lifetime being tested. Review read-only for source and plan/task state; only this report created. Phase07 task checkboxes remain unchecked, correctly pending Main's acceptance decision.

Code-review skill and published primary/development workflows read. Reviewed security, performance, architecture, YAGNI/KISS/DRY and C7, with supporting C1/C2/C4 contracts. Findings below are static source findings, not device reproductions.

## Critical issues

### C1. Active workspace bypasses the retained runtime owner — draft-loss risk

**Evidence:** `DamHopperMobileApp.kt:190-211`; `NativeWorkspaceViewModel.kt:52-89`; `MainActivity.kt:48-54`.

The active root constructs `ProjectWorkspaceState` inside composition `remember`, rather than obtaining it from `NativeWorkspaceViewModel.getOrCreateWorkspaceState`. A repository-wide `native-app` search finds the latter's declaration, not a production caller. Rotation, leaving the workspace, or connection-generation changes therefore do not retain that workspace's panel/tree/document/terminal owner. Old states also have no matching close at this creation site; their independent scopes can retain old runtime state without making drafts recoverable. ViewModel detachment and final cleanup operate on a different, unused map.

The `remember` key excludes `apiClient` and `wsConnection`, although both start null and are populated asynchronously. On recreation with an existing registry generation, the null workspace result can remain memoized after clients become available, leaving the root on the terminal-only fallback. Authenticated account identity is also absent from the key, and missing authentication is assigned guessed `dev-user` identity at line 199.

**Correction:** Inject the retained runtime's exact-owner workspace lookup/binding into the active root; retain actual clients/transports and initialize once in that runtime. Derive identity only from authenticated session, include worktree, and keep detached states reachable under their original owner. Wire deterministic final cleanup. Do not merely add more composition keys: that would still lose drafts on replacement.

**Confidence:** High. C7 retained-root/rotation/recovery requirements fail structurally.

### C2. Forced authority loss and owner-changing navigation lack the required boundary

**Evidence:** `DamHopperMobileApp.kt:130-142`; `MainActivity.kt:64-77`; `AppFlowNavigation.kt:56-66`; `ProjectWorkspaceScreen.kt:109-129`; `ProjectWorkspaceState.kt:119-142`; `NativeWorkspaceViewModel.kt:112-114`.

Auth loss invokes ordinary `navigateToProfiles()` without first revoking workspace authority. The installed guard can consequently prompt for Save while auth is already lost, instead of immediately detaching and retaining buffers. Searches find no production invocation of `revokeAllAuthority`, or registration forwarding lifecycle/retirement to these workspace methods. Connection generation changes replace composition state rather than retaining and reconciling it.

Deep links mutate `ProfileRepository.selectProfile` directly; root profile synchronization then calls `onProfileAuthenticated`, which changes stage/owner and clears project/session without consulting the departure guard. Thus dirty workspace departure can occur before consent. No active-root route exposes the old detached buffers after these transitions.

`rebindAuthority` is not a safe repair: it clears a flag, fabricates `ConnectionRef(profileId, 1L)`, and performs no server reconciliation or transport replacement; terminal rebinding validates only profile ID and leaves its original connection unchanged (`ProjectTerminalState.kt:124-128`).

**Correction:** Centralize voluntary owner-changing intents before profile/target/route mutation. Add a separate forced transition that synchronously retires authority, retains original-owner state, then routes authentication. Rebind using actual owner/connection/socket authority and reconcile before enabling writes. Never restore authority by fabricated generation or a boolean alone.

**Confidence:** High. This violates the explicit security/loss-prevention ordering in C1/C7; no claim that server authorization itself is bypassed.

## Warnings

### W1 — High: Android editor is not wired into the active workspace

`DamHopperMobileApp.kt:202-209` does not inject `AndroidEditorDocumentFactory`; `ProjectWorkspaceState.create` defaults it to null (`ProjectWorkspaceState.kt:209-221`). `EditorTabsState.installSession` immediately returns without a factory (`EditorTabsState.kt:82`). MainActivity also supplies neither `AndroidNativeEditorSurfaceHost` nor its CompositionLocal (`MainActivity.kt:40-55`); the local defaults null (`NativeTextEditorView.kt:28,46-74`). Therefore Files → Editor cannot provide the planned interactive native document. Wire both Android factory and Activity-scoped surface host through retained state and presentation boundaries respectively; verify actual editing/undo after rotation.

### W2 — High: Terminal selection has two authorities; retained policy disables valid input

`ProjectTerminalScreen.kt:170-184,269-299` keeps selection, epochs and attachment tokens in composition-local state. `isEligibleForInput` delegates to retained state (`235-239`), whose `activeSessionId` remains null unless its own `selectSession` is called (`ProjectTerminalState.kt:78-81,140-145,156-179`). The screen never calls that method; it also uses its own controller factory rather than the retained factory. Once passed a retained state, selecting a terminal in the screen does not make it eligible under the retained gate.

Further, terminal state is installed asynchronously into an ordinary non-observable property (`ProjectWorkspaceScreen.kt:95-107`), so initial rendering can use the fallback maps and later panel entry use different retained maps. Existing controllers retain callbacks capturing the previous composition (`ProjectTerminalScreen.kt:361-460`). Event collectors and the FIFO consumer remain composition-scoped (`301-359,529-578`), rather than having a coherent retained owner.

**Fix:** One retained selection/epoch/controller/callback/queue lifetime; render and invoke that authority, rather than mirror it. Test a real write before/after Files/Editor switches and Activity recreation.

### W3 — High: Lifecycle gating is implemented in isolation, not connected

`AndroidLifecycleCoordinator.kt:21-26` forwards only to `LifecycleCoordinator`. The workspace does not implement/register a lifecycle listener, and the `lifecycleCoordinator` parameter in `DamHopperMobileApp` is unused. `ProjectWorkspaceState.onAppBackground/Foreground` merely updates flags and never invokes `FileTreeState.pauseWatching/resumeWatching` (`ProjectWorkspaceState.kt:99-112`; `FileTreeState.kt:448-453`). Thus foreground/background input policy and watcher reconciliation are not enforced by the mounted app. Register exact-owner listeners; pause watches and input on background; reconcile on foreground before restoring write readiness.

### W4 — High: Departure save is not a retained, final revision transaction

`WorkspaceDepartureIntent.WorkspaceLeave` stores IDs, not captured dirty revisions (`ProjectWorkspaceState.kt:38-42`). Snapshots are taken only when Save is clicked, and each document is checked immediately after its own save (`ProjectWorkspaceScreen.kt:304-324`). There is no final all-document revision/dirty-set validation before departure: an earlier document can change while a later save suspends. A missing document becomes revision zero and is accepted after Confirmed. New exit requests overwrite the pending intent instead of coalescing (`111-120,156-158`). Saving state/job are composition-owned (`ProjectWorkspaceScreen.kt:86,92-93,302`).

Also, Save All from Terminal or Files deterministically reaches the editor repository's `Input blocked` gate: those panels disable `EditorTabsState.isInputAllowed` (`ProjectWorkspaceState.kt:185-189`; `EditorTabsState.kt:56-66`). Save permission must be authority/readiness based, not identical to interactive edit permission.

**Fix:** Retain captured action/revisions and its save transaction, keep one outstanding departure, distinguish save versus edit eligibility, and perform one final owner/dirty-set/all-revision check before committing. Preserve Cancel/failure/Unknown without leaving.

### W5 — High: Retained tab-close guard is disconnected

The only `WorkspaceDepartureIntent.TabClose` usage found outside its declaration is its renderer (`ProjectWorkspaceScreen.kt:362-425`); there is no producer. The mounted editor still uses a separate `remember` close intent and composition coroutine (`EditorScreens.kt:36,94-97,254-310`). Its pending close is not retained across rotation/panel switches. The new renderer's successful-save path calls `confirmClose(intent)` with decision SAVE (`ProjectWorkspaceScreen.kt:389-391`), but `EditorTabsState.confirmClose` intentionally does nothing for SAVE (`EditorTabsState.kt:412-425`). Use the shared retained close/departure coordinator, and commit close explicitly after a confirmed current-revision save.

### W6 — High: Shared header removes required terminal controls

`ProjectWorkspaceScreen.kt:210-223` sets `showHeader=false`. Font controls, Diag and New Terminal are all inside that conditional (`ProjectTerminalScreen.kt:724-835`), and the new shared header contains no replacements (`ProjectWorkspaceScreen.kt:137-200`). Fresh projects lose the visible New Terminal action; diagnostics/font buttons also disappear. Keep these actions in the shared single-header design. The terminal-only fallback header still clears selection before calling navigation (`ProjectTerminalScreen.kt:742-744`), contrary to the before-mutation departure requirement.

### W7 — High: Passing tests do not exercise the broken integration

- `RetainedWorkspaceLifecycleTest.kt:25-58` recreates MainActivity but checks ViewModel/navigation identity only, not an actual workspace document, undo, panel/tree, terminal write, widget detach or close counts.
- `ProjectTerminalVisibilityTest.kt:124-163` manually evaluates eligibility and invokes an item callback; it neither enqueues input nor exercises the production consumer, keyboard/paste/IME, reconnect or replay path.
- `WorkspaceDepartureTest.kt:267-285` only compares two revisions; it does not run production save/departure commit. Its failed-save test can fail earlier at the terminal-panel input gate, before the injected server failure (`246-264`).

Add production-path regression coverage for the findings above, including multi-document save races, forced auth, owner-changing deep link, save from hidden Editor, and real mounted terminal submission. State-helper tests cannot qualify C7.

## Suggestions

- Complete the clean cutover: remove redundant terminal state/methods and unconditional fallback scope/channel/map allocations once all active callers use the retained owner. Currently both families are allocated (`ProjectTerminalScreen.kt:186-211`), increasing complexity and teardown ambiguity.
- Remove unused `WORKSPACE`/`FOCUSED_WORKSPACE` aliases unless a real caller needs them (`AppFlowState.kt:12-15`). Prefer one existing stage convention, not compatibility vocabulary.
- Remove duplicate terminal preference writes: `ProjectTerminalScreen.updateTerminalFontSize` writes the same store after retained state's method already writes it (`223-230`; `ProjectTerminalState.kt:131-137`).
- Propagate cancellation rather than treating it as an ordinary save error (`ProjectWorkspaceScreen.kt:325-328`); persist operation state in the retained owner.
- Keep qualification wording honest: helper-test success and compilation are not mounted input, document-retention, real-server or device acceptance.

## Positive observations

- New Android services use applicationContext, and Activity destruction no longer directly calls shared runtime destruction.
- Existing VtTerminalSurface/replay controller architecture remains; no WorkbenchScreen/WebView/server schema expansion.
- Bounded 64-item terminal write channel, explicit outcome handling, font clamping, structured owner comparison and one visible panel are sensible foundations; production wiring must make their intended policies authoritative.

## Reviewed files

Changed scope (all 15):

1. `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceState.kt`
2. `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt`
3. `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/lifecycle/AndroidLifecycleCoordinator.kt`
4. `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt`
5. `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowState.kt`
6. `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigation.kt`
7. `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt`
8. `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalState.kt`
9. `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt` (changed state/activation/dispatch/lifecycle/header sections; unrelated rendering not exhaustively audited)
10. `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectWorkspaceScreen.kt`
11. `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/ProjectWorkspaceStateTest.kt`
12. `native-app/androidApp/src/androidTest/kotlin/dev/damhopper/nativeapp/RetainedWorkspaceLifecycleTest.kt`
13. `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/ProjectTerminalVisibilityTest.kt`
14. `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigationTest.kt`
15. `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/workspace/WorkspaceDepartureTest.kt`

Supporting inspected sections: README; PDR/code standards; assigned phase plan/contracts; `EditorTabsState.kt`, `EditorRepository.kt`, `EditorScreens.kt`, `NativeTextEditorView.kt`, `ProfileRepository.kt`, `WorkspaceFileOwner.kt`, `FileRepository.kt`, `FileTreeState.kt`, and `LifecycleCoordinator.kt`. Approximately 3,000 implementation/test lines inspected, plus contracts/docs; no full-codebase audit.

## Validation commands/results

**Executed by sibling Phase07TestRunner; results read from its terminal report. Reviewer did not duplicate builds/tests or change source/tests/CI.** Commands from `native-app`:

1. `gradlew.bat :shared:jvmTest --tests dev.damhopper.nativeapp.features.workspace.* --tests dev.damhopper.nativeapp.features.terminal.ProjectTerminalVisibilityTest --tests dev.damhopper.nativeapp.ui.flow.AppFlowNavigationTest --rerun-tasks`
   - Reported BUILD SUCCESSFUL; 41 passed, 0 failed, 0 skipped; 27s; 8 tasks executed. Initial invocation without rerun used FROM-CACHE.
2. `gradlew.bat :androidApp:compileDebugKotlin :androidApp:compileDebugAndroidTestKotlin --rerun-tasks`
   - Reported BUILD SUCCESSFUL; requested Kotlin compilations executed; 23s; 36 tasks executed. Initial invocation without rerun was UP-TO-DATE.
3. `gradlew.bat :androidApp:testDebugUnitTest --rerun-tasks`
   - Reported BUILD SUCCESSFUL; 96 passed, 0 failed, 0 skipped; 24s; 36 tasks executed. Initial invocation without rerun was UP-TO-DATE.

137 executed tests reported passing. Connected instrumentation/device tests, full unfiltered shared JVM suite, mounted IME/paste/reconnect journey, full APK build/security audit and performance/memory qualification not run by this review. Gradle deprecation and Kotlin warnings reported; exact warning inventory/lint count, coverage and type-coverage percentage not measured. Test runner reported build result-file reads blocked by host `.evcrateignore`; its terminal outputs are the evidence source.

Reviewer checks: `git diff --stat`, targeted `git diff -- ...MainActivity.kt ...DamHopperMobileApp.kt ...ProjectTerminalScreen.kt`, ranged source/contract reads and repository-wide targeted call-site searches. Advisor consulted on final assessment; findings retained only with inspected call-site evidence.

## Unresolved questions

- No product/design clarification blocks correction. Device/server qualification and actual workspace/document/terminal recreation evidence remain absent; Phase07 must not be marked accepted on these test counts alone.
