# Wave 06 — Cycle 3 final code review

## Score: 6/10

Improved, but not technically acceptable. Four safety-critical findings remain; the claimed K3 identity-baseline fix is not present in the inspected production source.

## Scope and evidence

- Reviewed 36 changed Android production/test files identified by the initial diff (+4,016/-407), relevant production callers, Cycle 2 report, plan, P03–P06 acceptance and C1–C10. Loaded code-review skill, published development rules, README, PDR and code standards.
- Production files reviewed: editor registry/tabs, repository, session, save coordinator, Android document/surface, workspace factory; terminal screen/state/presentation/policy/accessory keyboard; GlobalSettingsView, RemoteConfigScreen/Editor/Repository, SettingsConfirmDialogs, MaintenanceView, SettingsDiagnostics; Android notification platform/sink. Inspected the changed JVM, Android unit and instrumentation regressions for those features.
- Static review only. Main reports successful `:shared:compileKotlinJvm`, `:androidApp:compileDebugKotlin`, and 197/197 focused regressions. No reviewer build/test/lint/device execution; C9 assigns execution to coordinator. Those supplied successes do not prove the missing production-path assertions below.
- No product edits, plan/task-status edits, or TODO tracking. Plan remains Main-owned. This report is the only authored artifact. Unrelated untracked `.openidea/` and `apps/native/` excluded.
- Path shorthand: `shared/` = `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`; `platform/` = `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/`. Test references are under `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/` unless noted.

## Cycle 2 K1–K7 disposition

| Issue | Source assessment |
|---|---|
| K1 reload/save transaction | **Partial.** Post-read registry/alias-save checks and canonical-key comparison added (`EditorTabsState.kt:1175-1186`). Direct production save port still bypasses admission; canonical transaction publication still incomplete. Critical C1 below. |
| K2 rekey ghost aliases | **Specific rename-registration leak repaired in source.** `rekeyPath` now calls `rekeyAlias` (`:954-956`). Holder-unique lease accounting remains incomplete; W1. No rename → close → final-dirty regression was found in the inspected changed tests. |
| K3 exact FileIdentity baseline | **Unresolved.** `installSession` still never installs identity on the document; native identity fields still initialize to null with no production assignments in the inspected editor sources. Missing identity still admits editable sessions. Critical C2. |
| K4 root-change consent/guard | **Partial.** Both screens now render the impact dialog; ordinary raw root Save can pass consent. Workspace dirty guard remains unwired; root-changing conflict Overwrite drops its overwrite flag. Critical C3. |
| K5 hidden/reopen/input consistency | **Original memoization and changed-incarnation defects repaired in source.** `remember` includes hidden-state sizes/fallback set/selection epoch; input checks incarnation. Still not fully qualified by PTY epoch, and fallback state remains raw-ID-only. W2. |
| K6 ambiguous-create presentation | **Substantially repaired, incomplete admission UI.** Persisted records now reach retained and fallback presentation on mount/refresh/both create-finally paths; empty-state Start is disabled. New/Create controls and in-flight admission remain unfenced in UI. W3. |
| K7 refusal/pending termination | **Partial.** Status 0/5xx now maps to uncertainty and a local map fences mounted-screen input. Default first-sibling fallback no longer replaces a non-null selection. Pending state is not retained/qualified, repeat End remains enabled, and the initial-selection branch can still retarget. Critical C4. |

## Critical issues [4]

### C1 / K1 — Canonical save admission still excludes a real production save path

**Evidence:** `shared/features/editor/EditorRepository.kt:115-164`; `shared/features/editor/EditorTabsState.kt:296-310,1150-1197`; production consumers `shared/features/workspace/ProjectWorkspaceState.kt:397-400` and `shared/ui/screens/ProjectWorkspaceScreen.kt:579-582`.

`saveDocument` checks a tab-local gate and reserves an access path, but never enters the canonical registry save lock, marks the tab saving, or increments native save tracking. A workspace departure/close save can therefore be suspended while `reloadTab` sees neither busy condition and replaces/reloads its document. The old save later calls `markSaved` on the captured document. The newly added post-I/O checks do not observe this path. An alias save completed during another holder's suspended reload also does not advance the reloading session's local edit epoch; checking only current busy state is not a captured canonical save/baseline version.

**Impact [INFERENCE]:** replacement during save, stale clean publication and divergence between saved disk bytes and retained authority. **Confidence:** high.

**Correction:** all production save ports must enter the same canonical admission/lifetime transaction. Capture and revalidate document identity plus canonical baseline/revision/save generation, not only one alias's current flags. Exercise deferred read/save through the real workspace-departure port.

### C2 / K3 — Same-read identity still never reaches native save authority; missing identity grants editing

**Evidence:** `shared/features/editor/EditorTabsState.kt:325-365,378-410,592-614,1200-1207`; `platform/editor/AndroidEditorDocument.kt:69-70,494-503,624-639`; `shared/features/editor/EditorContentLoader.kt:53-54,71-72`.

The loaded identity is used for a registry lookup and tab metadata only. `installSession` does not assign it to the returned document; the factory accepts no identity; native `fileIdentity`/`canonicalPath` remain null and those null values enter `DocumentSaveSnapshot`. The fallback key still fabricates a route-based identity and guesses epoch from owner or `0`; `openTab` installs an editable session even when FileIdentity is absent/incomplete. Reload successors likewise receive no identity-bearing baseline.

**Impact [INFERENCE]:** C4's fail-closed/same-content-response identity requirement is unmet; writes lack the promised exact authorized baseline. This is not merely a missing test. **Confidence:** high.

**Correction:** require complete same-read authorized identity before editable admission; install it through the shared document load/baseline contract before publication, preserve it across canonical adoption, and validate it on reload/save/rebind. Do not mutate a dirty canonical baseline using a later alias read.

### C3 / K4 — Destructive root workflow still lacks workspace guard and captured consent; conflict Overwrite is broken

**Evidence:** `shared/features/settings/GlobalSettingsView.kt:51-57,228-237`; `RemoteConfigScreen.kt:89-95,159-166`; `RemoteConfigEditor.kt:320-373,426-455`; unchanged production host `SettingsHostView.kt:125-135`; dialog `SettingsConfirmDialogs.kt:143-169`.

Neither root-changing screen passes `departureGuard`; checking whether the config draft is dirty is not checking dirty workspace documents. The host does not supply a guard either. Global consent is an unkeyed remembered boolean, not a captured target/path operation, and the dialog omits Admin Target B endpoint/identity. In the raw config conflict branch, Overwrite opens the dialog but confirmation calls `saveFullConfig(confirmRootChange = true)` without `overwriteConflict = true`; preflight then refuses the advertised action.

**Impact [INFERENCE]:** destructive host mutation bypasses workspace dirty protection; consent may survive a target replacement; root-changing conflict overwrite cannot complete. **Confidence:** high.

**Correction:** carry captured owner/endpoint/path/draft revision and overwrite intent through one confirmation operation; wire the real workspace guard, then revalidate after suspension. Do not recapture the current editor/draft on confirmation.

### C4 / K7 — Pending termination is composition-local/raw-ID state, and refusal can still retarget

**Evidence:** `shared/ui/screens/ProjectTerminalScreen.kt:351,481-488,733-735,763-770,1135-1147,1830-1864,2496-2502`; `shared/ui/screens/ProjectTerminalState.kt:93-98,214-222`; `shared/features/terminal/TerminalPresentationPolicy.kt:124-135`.

`pendingTerminationIds` is a `remember` map, not retained owner state. Navigate away/remount while a 202/unknown operation remains unresolved and the fence is lost; fresh alive inventory's `terminationState` is not consumed to rebuild it. Keys are raw IDs, so replacement instances inherit stale fences. The map is not consulted by End admission/dialog eligibility: after `finally` clears transient busy, users can send another End while the first remains unresolved. The generic exception branch also records no uncertainty.

The non-null-selection fallback repair is real, but `refreshSessions` still reapplies `initialSessionId` whenever it differs from current selection (`:765-767`). Example: screen opened at B, user selects A, End A returns 409, refresh selects B. No-retarget-on-refusal is therefore not end to end.

**Impact [INFERENCE]:** input/destructive actions can resume before authoritative settlement, stale fences affect successors, and refusal can move selection to a sibling. **Confidence:** high.

**Correction:** retain exact owner/PTY-epoch/incarnation lifecycle state in the existing owner, consume authoritative inventory/exit evidence, and gate input plus repeated End consistently. Apply initial selection only as initial intent, never as refresh fallback; preserve the refused logical target even when unavailable.

## Warnings [11]

1. **K2 residual: alias accounting still uses route strings, not unique holder leases.** `EditorTabsState.kt:32,43-61,113-123,749-751` collapses identical tab keys from separate holders into one set entry; closing one removes the other's registration. Use stable holder-qualified alias lease identity and test duplicate-route holders plus rename/close ordering. Specific rekey leak is repaired; this is not a claim that the same ghost persists.
2. **K5 residual: visibility/input qualification still differs.** `ProjectTerminalState.kt:221` checks raw ID/incarnation but not PTY epoch/project/worktree; `TerminalPresentationPolicy.kt:97-103` has a different predicate. An old hidden epoch E1/incarnation 1 leaves E2/incarnation 1 visible but input-blocked. Fallback hidden state remains `Set<String>` (`ProjectTerminalScreen.kt:344,518-519,1792,1883-1892`) and suppresses replacement instances; exited-banner Close View still only invokes retained-state methods (`:1388-1391`). Use one qualified reactive policy for both supported screen paths.
3. **K6 residual: New/Create still enabled during uncertainty.** `ProjectTerminalScreen.kt:1103,1116,1746-1770,2206-2216,2423-2433` exposes creation despite the blocked-state notice. Only empty-state Start is disabled (`:1622`); no UI reservation publication occurs until settlement. Repository rejection protects the normal persisted path, but users still receive a dispatch-looking action/error rather than consistently disabled explanatory UI. Gate every creation entrypoint and publish admitted/in-flight state immediately.
4. **Owner disposal still incomplete.** `EditorTabsState.kt:156-174,1207` returns but ignores replaced old documents; the initiator also rebuilds aliases after its registered replacement callback already did so (`:250-293,1209-1254`). `AndroidEditorSurface.kt:99-105` directly releases a view lease without owner pruning. Replaced or late-view-released clean documents lack deterministic owner disposal. Publish aliases once and use one owner release/prune path.
5. **Exact native widget lease not enforced.** `AndroidEditorDocument.kt:533-547,559-580` records but never validates `leaseToken`; successor attachment does not fence predecessor editability against shared content. Validate widget plus token and disable old-widget input on handoff. Existing late-old-widget detach improvement is real but narrower than exact lease safety.
6. **Surface modifier dropped.** `AndroidEditorSurface.kt:91-96,114-162` accepts `modifier` but never passes it to `AndroidView`. Propagate supplied layout modifier; actual rendered sizing remains unmeasured.
7. **Structured command delete/rename resurrects old commands.** `RemoteConfigEditor.kt:687-693` starts from all original command names and overlays current rows. Removing one of several or renaming one leaves its old name. Remove known deleted/renamed names by stable row identity while preserving genuinely unknown fields.
8. **Scalar mtime getter serializes the entire document.** `EditorSession.kt:28-31` calls `snapshotForSave`; `EditorTabSaveCoordinator.kt:23-31` already captured a snapshot. Android snapshot allocates UTF-8 bytes (`AndroidEditorDocument.kt:494-503`). Reuse `snapshot.mtime` or expose a nonallocating canonical baseline scalar.
9. **Viewport policy remains guessed and pre-IME.** `ProjectTerminalScreen.kt:1069-1092` measures outer height before child `imePadding` and subtracts fixed `104.dp`; actual chrome/banners are not measured. Added measured-height helpers are not wired here. Resolve post-insets/IME usable height and measured chrome/accessory/banner geometry.
10. **Alias metadata diverges from canonical content/dirty state.** `EditorTabsState.kt:597-614` marks an alias clean and publishes disk bytes when adopting an existing dirty document; `:1342-1355` updates only the edited session's tab; preview reads tab text (`:1326-1329`). Shared-buffer correctness does not make preview/dirty indicators correct. Publish canonical content/revision/dirty events to every alias, including initial adoption.
11. **Regression oracles miss the failing production paths.** `EditorSaveRaceTest.kt:336-351` manually completes saves; `:392-426` installs a 409 handler but never saves. `EditorTabsStateTest.kt:620-643` sets a preexisting lock, not a save admitted during a suspended read. `ProjectTerminalVisibilityTest.kt:492-520` wraps the pin check itself; `TerminalScreenBindingTest.kt:258-280` duplicates the action condition with a local request counter. Added native instrumentation exercises a distinct-widget detach but not wrong-token/reused-widget handling. Coordinator should require real production deferred-save/read, mounted hide/reopen/create/termination, and confirmation/overwrite oracles; 197 passes do not cover these absent assertions.

## Suggestions [2]

1. After safety repair, split the 1,359-line editor state and 2,572-line terminal screen into small transaction/presentation units. Keep the existing retained owner authoritative; do not add a second lifetime model.
2. `SettingsDiagnostics.redact` (`SettingsDiagnostics.kt:49-60`) remains production-unused and constructs regexes per call. Remove it if unnecessary, or use a bounded real diagnostic-text caller with precompiled patterns. Keep the stronger typed export allowlist.

## Positive observations

- Post-read busy/key checks, route rekey registration, hidden-state memo dependencies and create-finally synchronization address real parts of Cycle 2 findings.
- 0/5xx termination uncertainty is now honestly classified; mounted-screen input consults the pending map.
- Android notification changes keep generic public strings fixed in the sink, preserve explicit immutable PendingIntents/socket identity, check blocked channels, and retain profile-scoped cancellation. No new notification security defect found in the inspected changes.
- Config/TOML preservation and typed diagnostic export remain conservative; dirty raw config edits made during save are no longer blindly marked clean.

## Recommended actions / completion assessment

1. Repair C1–C4 through actual production entrypoints before technical acceptance; address W2/W3 alongside terminal lifecycle fixes.
2. Add production-path regressions for these concrete races/handlers, then have Main run the existing focused checks once on the coherent stopped tree.
3. Main must separately supply required task-local component/live/native smoke and independent disposition. Full root integration, device/IME/TalkBack/privacy and release qualification remain future gates; source review and focused compilation are not substitutes.

W06 acceptance is incomplete: canonical identity/lifetime, destructive Settings protection and terminal pending lifecycle still fail the task contracts. Do not mark these tasks technically complete merely because the reported focused checks pass.

## Metrics / unresolved evidence

- Kotlin review; TypeScript type coverage not applicable. Code/test coverage percentages and lint counts not measured.
- Main-reported 197/197 focused tests and both compile targets were not rerun or independently certified here.
- No device, instrumentation execution, meaningful live/component smoke, or physical native lifetime proof established by this review.
- No unresolved product-design question. Remaining issues are implementation/evidence gaps, not permission to narrow acceptance.
