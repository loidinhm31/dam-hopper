# Phase 01 — Terminal font resize

## Context links

- [Canonical plan and preflight](./plan.md).
- [Native app overview](../../native-app/README.md#2-core-mobile-flow--navigation-lifecycle), [native architecture](../../docs/architecture/android-native-client.md#terminal-lifetime), [Kotlin standards](../../docs/code-standards.md#kotlin-multiplatform-and-android-native-client-native-app).
- [Presentation policies](../../native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalPresentationPolicy.kt), [active terminal UI](../../native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt), [app root](../../native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt).
- [Preference interface](../../native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/PreferencesStore.kt), [preference model](../../native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/SettingsModels.kt), [Android store](../../native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidPreferencesStore.kt), [host injection](../../native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/MainActivity.kt).
- [Policy tests](../../native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalPresentationPolicyTest.kt), [flow journey tests](../../native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/SimpleFlowJourneysTest.kt).
- [Overlapping icon/font plan](../261023-0747-android-icon-font-reuse/plan.md), [informational ANR baseline](../261023-0232-android-terminal-anr-remediation/plan.md).

## Overview

- Priority: P2. Status: completed. Effort: 4h (design docs 0.25h; implementation/tests 2h; integrated verification 1.5h; final docs 0.25h).
- Deliver one app-wide local terminal font preference through two equivalent interactions: header buttons and two-finger pinch.
- Main owns orchestration, preflight writer arbitration, independent review, final validation and evidence acceptance. One implementation owner edits all five Kotlin files sequentially. Planning author writes only this file and `plan.md`; no source edits or execution-state hydration.

## Key Insights

1. `ProjectTerminalScreen` currently hardcodes 12sp/16sp but already measures `M` with the displayed style. `cellMetrics` feeds `terminalGeometry`; `LaunchedEffect(geometry, activeController)` deduplicates through the retained reading state's `TerminalGeometryPolicy` before `activeController.resize`.
2. `WorkbenchPreferences` already defines `terminalFontSize = 13` and bounds 10..32. Reading it intentionally changes the fresh-install rendering to 13sp/17sp; do not silently force 12 or migrate the schema.
3. `MainActivity` already injects `AndroidPreferencesStore` into `DamHopperMobileApp`; only its onward screen wiring is absent. The Android store uses serialized SharedPreferences with `apply()`. Its in-memory fallback is suitable for previews/tests, not the production persistence path.
4. The convenience `ProjectTerminalScreen(ProfileRepository, ...)` overload delegates to the repository-based screen. Extend/forward the same store there to avoid a disconnected preference path.
5. `SimpleFlowJourneysTest` currently mixes navigation tests and structural source checks, with no Compose UI test dependency. Keep new structural checks honest: they do not prove touch handling, persistence across process recreation, or server resize delivery.
6. Keep JetBrains Mono, `fontFeatureSettings = "calt 0"`, centered/untrimmed line-height settings, `softWrap = false`, stable `lineIds`, atomic snapshots and controller ownership. Do not route this feature into the separate unmounted workbench shell.

## Requirements

### Functional

- Accept `preferencesStore: PreferencesStore = remember { InMemoryPreferencesStore() }` on the screen API; forward it through both overloads. In `DamHopperMobileApp.kt`, pass `preferencesStore = preferencesStore` to `ProjectTerminalScreen(...)`.
- Initialize `terminalFontSize` with `WorkbenchPreferences.clampFont(preferencesStore.loadPreferences().terminalFontSize)`, remembered by store identity. Recomposition and terminal selection must not reset it.
- Define `updateTerminalFontSize(newSize: Int)`: clamp, exit if unchanged, update local state, then persist `preferencesStore.savePreferences(preferencesStore.loadPreferences().copy(terminalFontSize = clamped))`. No save during initial read or same-size updates. Do not persist a stale whole preference snapshot.
- Header action order: compact `A-`, `${terminalFontSize}sp` readout, `A+`, `Diag`, `+ New Terminal`; minus/plus call the shared updater with ±1 helpers. Readout is not a new reset action. Boundary attempts are harmless no-ops.
- Output `BoxWithConstraints` recognizes only two-or-more-finger pinch; gestures that remain single-finger keep existing scroll/tap/focus. Pinch release/cancellation must not open the IME or send terminal input accidentally.
- Font state drives the displayed `TextStyle`, measured metrics and existing active-controller geometry effect; no new controller, attach, PTY, or parallel resize path.
- Remembered size survives composition re-entry via the same persisted store; Android activity/app relaunch restores it from the existing production store.

### Non-functional

- No dependencies, new preference keys, remote settings synchronization, timers, worker queues, per-frame object collections, or terminal engine changes.
- Save immediately for each changed integer size, including during pinch; no gesture-end-only persistence or debounce, because both controls share the required updater. Repeated factors that round to the current integer cause no write/reflow.
- Keep state/updater references current inside a long-lived gesture coroutine; never key `pointerInput` on font size. Accumulate fractional zoom so small changes eventually cross an integer boundary.
- Preserve active owner/input fencing and paused-follow intent. Initial store access and updates are UI-thread serialized in the current flow; fresh load/copy/save is not a multi-writer transaction. Do not claim atomicity or introduce a general synchronization layer.
- Visually compact controls retain accessible increase/decrease names and usable touch targets. Keep Projects, Diag and New Terminal reachable on narrow widths/enlarged system text; reuse horizontal scrolling for header actions if needed, without a second toolbar or overflow menu.

## Architecture

### Pure policies — `TerminalPresentationPolicy.kt`

Add the existing preference-model import and these exact contracts:

```kotlin
internal fun terminalLineHeightSp(fontSizeSp: Int): Int = WorkbenchPreferences.clampFont(fontSizeSp) + 4
internal fun stepTerminalFontSize(currentSp: Int, delta: Int): Int = WorkbenchPreferences.clampFont(currentSp + delta)
internal fun pinchedTerminalFontSize(startFontSizeSp: Int, zoomFactor: Float): Int
```

- Line height preserves 12sp → 16sp baseline and scales by a constant +4sp across 10..32sp (14..36sp line height); this is not a constant ratio across the range.
- Step callers provide clamped current state and `delta = -1` or `+1`; do not broaden the exact helper to arbitrary overflow-safe integer arithmetic.
- Pinch rounds `startFontSizeSp * zoomFactor` to nearest integer, then clamps through `WorkbenchPreferences.clampFont` to 10..32. Use `roundToInt()` (ties toward positive infinity). Invalid factor (`NaN`, either infinity, zero, negative) returns the clamped starting size.
- For valid very large factors, avoid conversion overflow: compute product in `Double` and bound it to the font interval before integer rounding/conversion. This is equivalent to round-then-clamp for finite valid products. Tiny positive factors saturate to 10; huge finite factors to 32.

### Store-backed screen state and data flow

`MainActivity.AndroidPreferencesStore → DamHopperMobileApp.preferencesStore → ProjectTerminalScreen.preferencesStore → clamped state → header/pinch updater → fresh load/copy/save`.

Remember store-keyed integer state using existing Compose state conventions (`remember(preferencesStore)` and `mutableIntStateOf`). The default in-memory store stays remembered. Both screen overloads forward the same instance. Keep session/controller keys unchanged; font state is a local app preference, not profile/session-owned state.

Rendering contract:

```kotlin
val terminalTextStyle = remember(terminalFontSize) {
    TextStyle(
        // Preserve current color, font family, feature settings and LineHeightStyle.
        fontSize = terminalFontSize.sp,
        lineHeight = terminalLineHeightSp(terminalFontSize).sp,
    )
}
```

This excerpt describes changes, not replacement of the existing style. Keep `cellMetrics` keyed by the complete style, measurer and density/font scale. Existing constraint/metric keys recompute `terminalGeometry`; existing `LaunchedEffect` resizes only the current controller when whole-cell dimensions change. Do not multiply viewport pixels or independently resize on button/pinch callbacks. Preserve existing grid limits (1..200 columns, 1..80 rows), content padding and IME size handling.

### Gesture arbitration and accumulation

Attach `pointerInput(preferencesStore)` to the existing output `BoxWithConstraints` modifier without replacing its tap-to-focus `clickable` or the nested `LazyColumn`.

1. Inside `awaitEachGesture`, await the first down with `requireUnconsumed = false`; observe pointer events on `PointerEventPass.Initial` so multi-touch consumption precedes the child's scroll handling. Do not consume a lone initial down.
2. Count `event.changes` with `pressed == true`. Only when `pressedCount >= 2` call `calculateZoom()` and consume changes. Do not calculate zoom or consume one-finger/release-only events.
3. On entry to a multi-touch segment, snapshot the **current** font size and initialize a fractional continuous size. Use current state or `rememberUpdatedState` for the size/updater rather than a stale first-composition callback; do not restart detection when the font changes.
4. For each valid finite positive incremental zoom factor, multiply the continuous size, clamp the continuous value to 10f..32f, then call `pinchedTerminalFontSize(segmentStartSp, continuousSize / segmentStartSp)` and the shared updater. Retain fractional progress, not repeatedly rounded integers. Clamp the accumulator itself so reversal from either limit responds immediately rather than traversing an overshoot dead zone.
5. Ignore invalid incremental factors without corrupting the accumulator. Consume multi-touch changes even for neutral, invalid or boundary-clamped factors to prevent competing scrolling. No list allocation solely to count pointers.
6. Below two pressed pointers, reset only the multi-touch segment baseline; observe until all pointers lift. After a recognized pinch, the remaining finger must not resume scrolling or trigger focus before all pointers lift; a fresh one-finger gesture restores normal behavior. Adding a second pointer again starts a pinch segment from the latest integer state. No trailing-release consumption is added outside the required `pressedCount >= 2` gate.
7. Initial-pass consumption is the proposed cancellation mechanism, not verified behavior on the pinned Compose version. It must cancel the existing click/scroll recognizers. Acceptance explicitly covers `1→2→1→0`, already-running single-finger scroll becoming a pinch, cancellation and repeated segments. If arbitration fails or a final tap leaks, stop that acceptance gate and revise scoped modifier arbitration; do not silently swallow fresh one-finger gestures or drop the requirement.

### Design choices and preflight

Reuse the existing store and geometry policies, not a new settings repository, platform gesture detector or `graphicsLayer` scale. A visual-only transform would leave PTY dimensions wrong. Generic transform detectors can claim one-finger gestures, contrary to the requested contract.

The architecture document still describes fixed 12sp/16sp geometry. **Coordinator-owned design gate:** reconcile that text with this intended store/state/measurement flow before implementation. The author cannot edit it under the current two-file boundary. Main also resolves shared ownership with the icon/font plan before scheduling any source writer; preserve current typography rather than rerunning its migration. **Pre-implementation plan review and final route validation are separate pending gates**; later implementation review cannot substitute for either.

## Related code files

All paths below are repository-relative and literal; modify existing files only. No implementation file creation/deletion.

| Action | Path | Change |
| --- | --- | --- |
| Modify | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalPresentationPolicy.kt` | Three pure font policies |
| Modify | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt` | Forward app store |
| Modify | `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt` | Both screen APIs, state/updater, header controls, pinch, keyed style |
| Modify | `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalPresentationPolicyTest.kt` | Behavioral font-policy/geometry regression tests |
| Modify | `native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/SimpleFlowJourneysTest.kt` | Focused structural store/control/gesture wiring guards |
| Modify, docs owner | `docs/architecture/android-native-client.md` | Preflight intended design; final accurate variable-metric/lifecycle contract |
| Modify, docs owner | `native-app/README.md` | User controls, persistence, default and truthful verification status |

Read-only contracts: `PreferencesStore.kt`, `SettingsModels.kt`, `AndroidPreferencesStore.kt`, `MainActivity.kt`, terminal engine/controller/viewport and Gradle configuration. Escalate if another writable path is required; no opportunistic refactor of the large screen.

## Implementation Steps

### `document-font-resize-design` — coordinator/docs owner

1. Resolve the related font plan's actual writer ownership; status alone is insufficient. Read current affected source before implementation begins.
2. Reconcile the architecture's fixed metric statement with variable persisted font, +4sp line height, unchanged remote PTY ownership and existing measured resize path. Record this as intended design, not deployed behavior. This closes the outstanding design gate without granting this planning author external write authority.

### `implement-terminal-font-resize` — single implementation owner

3. Add three policy helpers and behavioral tests. Fixed independent examples: line heights 10→14, 12→16, 13→17, 32→36; out-of-range input clamps; step 12±1 and boundary no-ops; pinch 12×1.5→18, 20×0.5→10, 13×1→13, 13×1.5→20; over/under limits and invalid factors return their specified results. Include very large/small finite factors. Keep existing policy tests.
4. Thread `preferencesStore = preferencesStore` through the app call and convenience overload. Add store-keyed clamped initial state and exact changed-only fresh-copy persistence updater; preserve all unrelated fields.
5. Add compact header controls/readout in the required order, accessible names and usable targets. Restrict changes to the existing header; preserve navigation and diagnostics/create actions.
6. Replace only style size/line-height constants and its remember key; keep real style measurement and existing controller effect. Add geometry regression examples showing larger cells yield fewer rows/columns and equivalent whole-cell geometry does not cause redundant resize.
7. Add the multi-touch-only handler with fractional bounded accumulation and current callback access. Preserve one-finger scrolling/focus and controller identity. Do not add a separate persistence/resize path.
8. Extend `SimpleFlowJourneysTest` following existing structural conventions to guard app-store forwarding, screen API/read-copy-save wiring, header labels/order, font-keyed style and multi-pointer gate. Check meaningful contracts, not an entire copied function. Explicitly label these as structural guards; do not claim they exercise gestures or persistence.

### `verify-terminal-font-resize` — Main's integrated verifier

9. After source owner is terminal, run checks once over the coherent change. Windows repository-root command: `.\native-app\gradlew.bat -p native-app :shared:jvmTest :androidApp:testDebugUnitTest :androidApp:assembleDebug`. POSIX equivalent: `./native-app/gradlew -p native-app :shared:jvmTest :androidApp:testDebugUnitTest :androidApp:assembleDebug`. Record exact command, task outcomes, failures/skips and environment; no invented test totals or reduced suite replacing these gates.
10. On an authorized emulator/device with genuine multi-touch injection or physical two-finger touch and a test-owned remote session, execute every scenario in Success Criteria. Use existing installation/device tooling only; missing device, endpoint/auth or multitouch capability means BLOCKED for that gate, not PASS from source assertions. Do not weaken network security or expose `--no-auth` over LAN.
11. Observe final local grid and server PTY geometry after rapid zoom, session switching and IME resize; verify reflow using long lines, Unicode/wide cells and a full-screen TUI. Check resize without detach/duplicate attach or remote PTY restart. Capture minimal sanitized evidence and clean up only test-owned resources.
12. Main obtains scoped independent **implementation** review, reconciles actual evidence and resolves findings. This follows, and does not replace, the coordinator's pre-implementation independent **plan** review/final route validation. Never infer implementation approval or route validation from this author's artifact inspection.

### `document-terminal-font-resize` — docs owner after verification

13. Update native README and reconcile architecture to actual implementation, including 13sp/17sp default, `A-`/`A+`, two-finger pinch, local persistence, measured geometry and unchanged ownership. Record only exercised checks; keep broader pending device/IME qualification honest. No unrelated docs overhaul or other-plan edits.

## Todo list

Exactly one durable-task fence; IDs and marker lines below are the authoritative authored task graph. No task-state file is created by authoring. Tasks are sequential to avoid shared-doc/source ownership conflicts.

```evcrate-tasks
[
  {
    "id": "document-font-resize-design",
    "title": "Reconcile terminal font design and preflight ownership",
    "blocked_by": [],
    "allowed_files": ["docs/architecture/android-native-client.md"],
    "constraints": ["Coordinator/docs owner only; planning author remains limited to the two selected plan Markdown files.", "Resolve ProjectTerminalScreen.kt writer overlap with the icon/font plan before source work; preserve its installed typography.", "Document intended variable font/measurement flow without claiming implementation or runtime approval."],
    "acceptance": ["Architecture design no longer constrains the active terminal to fixed 12sp/16sp; intended persisted font plus 4sp line height and unchanged ownership are explicit.", "Main establishes one source writer before the dependent implementation starts."],
    "verification": ["Review the affected architecture section against this phase and current screen/store contracts; Main records design-gate disposition and writer arbitration."]
  },
  {
    "id": "implement-terminal-font-resize",
    "title": "Implement persisted header and pinch terminal font resizing with regression tests",
    "blocked_by": ["document-font-resize-design"],
    "allowed_files": ["native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalPresentationPolicy.kt", "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt", "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt", "native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalPresentationPolicyTest.kt", "native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/SimpleFlowJourneysTest.kt"],
    "constraints": ["One serialized implementation owner; no dependencies, preference schema, transport, engine or controller-lifetime changes.", "Implement the three exact helper contracts; clamp 10..32sp, +4sp line height, safe pinch rounding and invalid-factor handling.", "Forward the same PreferencesStore through both overloads; clamp initial state and use changed-only fresh-load/copy/save persistence.", "pointerInput(preferencesStore) uses awaitEachGesture; calculateZoom and consumption only at pressedCount >= 2. Preserve single-finger scroll/tap and use current callbacks with bounded fractional accumulation.", "Keep JetBrains Mono, calt 0, stable snapshots/row IDs, follow intent and existing measured active-controller resize path. No mid-flight builds/tests/formatters; integrated verifier runs afterward."],
    "acceptance": ["A-, size readout and A+ precede Diag/New Terminal; both buttons and pinch update one persisted integer font state without unrelated preference loss.", "The keyed displayed style uses terminalFontSize.sp and terminalLineHeightSp; cell metrics and whole-cell geometry update without replacement controllers.", "Policy tests cover fixed line-height/step/pinch examples, boundaries, invalid and extreme factors; journey tests guard wiring without claiming runtime gesture coverage.", "Gesture design retains small fractional changes, reverses promptly at limits and does not restart detection on font recomposition."],
    "verification": ["Main runs the dependent integrated verification task after implementation terminates; return exact changed paths and unverified interaction risks, not a runtime success claim."]
  },
  {
    "id": "verify-terminal-font-resize",
    "title": "Verify integrated font policies, Android build and real touch persistence journeys",
    "blocked_by": ["implement-terminal-font-resize"],
    "allowed_files": [],
    "constraints": ["Verification-only; no Kotlin/build/config edits. Preserve failed/blocked/skipped outcomes; obtain separate repair authority for changes.", "Use authorized test-owned endpoints/sessions and real multi-touch capability. Source checks and synthetic geometry arithmetic do not qualify Compose interaction/server behavior.", "Main owns coherent verification and independent review; no duplicate concurrent full suites."],
    "acceptance": ["Shared JVM tests, Android debug unit tests and debug assembly pass with actual recorded results.", "All Success Criteria touch, geometry, focus, persistence, narrow-header and lifecycle scenarios are exercised; unavailable mandatory evidence remains blocked.", "Independent review has no unresolved severe findings; no stray input, PTY recreation or preference corruption is observed within exercised scope."],
    "verification": ["Run .\\native-app\\gradlew.bat -p native-app :shared:jvmTest :androidApp:testDebugUnitTest :androidApp:assembleDebug from repository root and record exact per-task results.", "Execute Success Criteria device scenarios including pinch 1-to-2-to-1-to-0 with no remaining-finger scroll until all-up, cancellation, slow accumulation, boundary reversal, one-finger scroll/tap, relaunch and local/server final geometry; capture sanitized evidence.", "Use scoped debugger breakpoints on the real updater and store save boundary to prove changed-only saves and inspect preservation of unrelated non-secret fields, following the Save filtering procedure.", "Main reviews source scope and independent implementation reviewer findings; blocked device/ownership/review gates prevent completion."]
  },
  {
    "id": "document-terminal-font-resize",
    "title": "Document delivered font controls and accurate verification boundaries",
    "blocked_by": ["verify-terminal-font-resize"],
    "allowed_files": ["native-app/README.md", "docs/architecture/android-native-client.md"],
    "constraints": ["Docs owner only after integrated verification; preserve unrelated documentation and broader qualification gaps.", "Do not claim unexercised touch, process-recreation, performance or live-server behavior from unit/source tests."],
    "acceptance": ["README explains A-/A+, readout, pinch, 10..32sp bounds and local persistence; existing preference default 13sp is explicit.", "Architecture describes variable displayed metrics plus 4sp line height, existing controller resize and unchanged remote PTY ownership; evidence status matches actual runs."],
    "verification": ["Inspect rendered Markdown/link targets and compare documented behavior, default and evidence with the final implementation and integrated verifier report."]
  }
]
```

- [x] <!-- evcrate-task:document-font-resize-design --> Reconcile architecture design and writer ownership.
- [x] <!-- evcrate-task:implement-terminal-font-resize --> Implement policies, screen wiring, controls, pinch and tests.
- [x] <!-- evcrate-task:verify-terminal-font-resize --> Collect integrated build/test/device/review evidence.
- [x] <!-- evcrate-task:document-terminal-font-resize --> Publish accurate user and architecture documentation.

## Success Criteria

| Scenario / layer | Required observation / oracle |
| --- | --- |
| Pure policy tests | Fixed expected cases above reject wrong bounds, wrong +4 line height, missing rounding and unsafe invalid/extreme factors. Existing follow/replay/geometry tests remain intact. |
| Initial preference / UI | Stored 20 displays `20sp` with 24sp line height; fresh default displays `13sp` with 17sp line height; no initialization write. Clamping follows existing model. |
| Header / UI | Minus/plus change exactly one sp, readout and text agree; at 10/32 additional boundary actions make no save/state change. Projects, Diag and New Terminal still work. |
| Persistence / real boundary | Change a non-font preference, resize, leave/re-enter Terminal, recreate activity, then normally close/relaunch the app: final font survives and unrelated fields are unchanged. Do not claim abrupt-process-kill durability from asynchronous apply(). |
| Save filtering / scoped debugger oracle | In an isolated debug run, set breakpoints at the actual screen updater entry and `AndroidPreferencesStore.savePreferences`; disable unrelated UI edits. Record save hits before/after initial composition, ten boundary taps and a neutral/rounding-equivalent pinch: delta must be zero. A single +1 action must produce one save. At a paused updater entry, change one non-secret unrelated field through the real store on the same UI thread before resuming; inspect the saved argument and reloaded preferences to confirm that field survives the fresh load/copy/save. Inspect only font/non-secret fields, remove breakpoints afterward, and do not use debugger-altered timings as performance evidence. |
| Pinch / real touch | Outward/inward pinch increases/decreases font; slow sub-integer motion accumulates; 10/32 limits hold; reversing direction responds without overshoot dead zone. |
| Gesture ownership / real touch | `1→2→1→0`, third-finger changes, repeated two-finger segments, cancellation/navigation and one-finger scroll becoming pinch cause no unintended click-to-focus, IME opening or terminal input. After recognized pinch, remaining-finger movement causes no list scroll until all pointers lift; a fresh one-finger gesture works normally. |
| One finger / real touch | A gesture that stays one-finger scrolls the LazyColumn and pauses/resumes follow as before; tap focuses/shows keyboard as before. Header taps retain existing focus behavior. |
| Metrics / real rendering | At 10, 12, 13, 20 and 32sp, rows remain single-line and grid matches measured text/padding. Larger font reduces available cells; density/system font scale/IME changes recompute correctly. |
| Resize / real server | A test-owned PTY/TUI reflects final observed local rows/columns after rapid zoom; reflow preserves content under existing retention rules; no replacement controller, duplicate attachment or PTY restart. |
| Retained sessions / lifecycle | Switch sessions after resizing, resize again, and navigate back/re-enter: active controller receives correct dimensions, input stays owner-fenced and paused-follow policy remains intact. |
| Responsive/accessibility / UI | Narrow phone portrait, landscape and enlarged system text keep all header actions reachable with meaningful accessibility labels and usable targets; no second toolbar/FAB. |
| Build/review/docs | All three Gradle gates have actual outcomes, independent findings resolved, and docs agree with exercised behavior. Missing native evidence blocks acceptance rather than disappearing. |

## Risk Assessment

- **Pointer arbitration / high:** Initial-pass handling must cancel nested scroll/click during pinch without consuming lone-pointer events. Native transition/cancellation tests are mandatory; do not paper over failure by swallowing single-finger input.
- **Stale closure / medium:** store-only pointer key intentionally survives font changes. Read current state/callback via stable state or `rememberUpdatedState`; test successive gestures and store replacement.
- **Rounding and bounds / medium:** fractional accumulator prevents dead motion; continuous clamping prevents overshoot dead zones. Pinch policy guards invalid factors and conversion overflow.
- **UI-thread persistence/reflow / medium:** SharedPreferences serializes preferences and resize can reflow scrollback. Filter unchanged integers and deduplicate geometry using existing policy; exercise rapid zoom under output load. Required immediate persistence remains; no speculative throttling layer or performance guarantees.
- **Concurrent preference writers / medium:** fresh copy preserves unrelated changes already stored, not truly concurrent multi-threaded mutations. Current flow serializes local UI edits; broader concurrent settings synchronization is outside scope and requires a separate decision if observed.
- **Header width/accessibility / medium:** retain compact visuals but not inaccessible hit targets. Reuse constrained horizontal actions scrolling if required; verify Projects remains usable.
- **Related writers/design / preflight:** font-reuse plan shares the screen, and architecture text is stale for this intended change. Main must settle ownership/design before scheduling source work.
- **Rollback:** implementation owner reverts only this feature's scoped changes, restoring the prior style/header/modifier and removing new callers/helpers/tests coherently. Keep the existing preference schema/value and typography; no destructive Git operation, preference clearing or PTY reset. Docs owner reconciles behavior/evidence. Rollback is a strategy, not authorization to execute it.

## Security Considerations

Font size is non-secret app-local preference data. Persist only its integer via the existing store; no terminal output, command text, credentials, URLs or profile secrets. No new logs, permissions, network calls or remote preference write path. Keep input/replay/connection fences and remote PTY ownership unchanged. Device evidence uses test-owned sessions and sanitized captures; retain TLS/request guards and never expose loopback-only development authentication over LAN.

## Next steps

Return these two authored artifacts to Main for linked-contract inspection, independent route review/final validation and the pending architecture/ownership gates. Main owns session activation, any authorized hydration and implementation scheduling. No implementation or runtime test has been run as part of authoring.

Unresolved product questions: none. Pending coordinator gates and later native verification are not authoring defects or passing evidence.
