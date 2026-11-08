# Wave 06 code review

## Score: 4/10

## Scope and evidence

- Inspected all 33 modified files in `git diff -- native/android-app` (+3,788/-396), relevant callers, README/PDR/code standards, the plan, four W06 task contracts/allowlists and C1–C10.
- Changed Android source/test files fit the four W06 allowlists. No implementation or plan/task-status edits made.
- Static review only. No builds, tests, linters or device/live smoke executed: C9 reserves those checks to Main/coordinator. No passing qualification inferred from authored tests.
- Paths below: `shared/` = `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`; `platform/` = `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/`. Test paths are stated separately.

## Critical issues — MUST FIX [8]

### C1. Tier replacement can split one canonical file into two live buffers

**Evidence:** `shared/features/editor/EditorTabsState.kt:63-85,1122-1168,1170-1215`.

`getOrCreateDocument` overwrites the registry entry when a newly opened alias has different read-only tier, without checking dirty state/save admission or migrating existing aliases. Example: edit alias A, remote file grows into LARGE, open alias B: A retains its dirty document while B receives another authority under the same canonical key. `reloadTab` checks save admission only before the suspended read, not before replacement; a save begun during that read is not protected. The response's FileIdentity is not compared with the captured canonical identity before publication. Listener replacement also reconstructs the initiating aliases again after the listener already did so.

**Impact:** split dirty/undo authority, replacement during save, stale identity adoption; C4 violation. **Confidence:** high.

**Correction:** one captured identity/revision/save-admission transaction for alias admission and reload; revalidate after I/O, publish every alias once, preserve original on busy/stale/failure.

### C2. Workspace close leaves ghost aliases that bypass the final-dirty guard

**Evidence:** `shared/features/editor/EditorTabsState.kt:43-56,661-695,722-730`; `shared/features/editor/EditorSession.kt:324-330`; `shared/features/workspace/ProjectWorkspaceState.kt:508-526`.

`closeAll` releases document tokens through `session.close()` but never unregisters those aliases from `registry.activeAliases`. Open A/B at different access paths, dirty the shared document, close workspace A, then request close of B: `hasSurvivingAliases` sees nonexistent A, closes B without save/discard/cancel, and leaves the dirty document unreachable. Separately, registry aliases use tab keys rather than unique holder/lease identities, so equal routes in two holders collapse into one set entry.

**Impact:** unreachable unsaved edits; C4 violation. **Confidence:** high.

**Correction:** release/register through one token-based owner path, unregister every workspace alias, and require the final dirty guard against actual live leases.

### C3. Missing FileIdentity still establishes editable canonical authority

**Evidence:** `shared/features/editor/EditorTabsState.kt:304-343,357-389,571-594`; `platform/editor/AndroidEditorDocument.kt:69-70,494-502,624-639`.

Canonical resolution guesses a missing epoch from the owner or `0`, and builds a route/path key when identity is absent/incomplete. `openTab` still installs an editable session. The received identity is stored on tab metadata, not installed into the native document's identity-bearing snapshot fields; the factory does not populate them either.

**Impact:** missing server authority does not fail closed, and native save baselines lack the exact same-read identity; C4 explicitly prohibits this fallback. **Confidence:** high.

**Correction:** reject/disable editable admission without complete authorized FileIdentity; retain exact identity in the canonical document and validate it on reload/save/rebind. Do not manufacture canonical identity from routes.

### C4. Root-switch confirmation is not reachable from production Settings

**Evidence:** `shared/features/settings/RemoteConfigEditor.kt:312-365,419-459`; callers `GlobalSettingsView.kt:144-151`, `RemoteConfigScreen.kt:88-89,123-125`.

The editor now requires `confirmed=true` / `confirmRootChange=true`, but every production caller retains the default false. There is no root-change consent UI calling the admitted path. Set root and root-changing full-config saves therefore always refuse; helper tests using true do not implement the user workflow. `departureGuard` is optional and not supplied by these callers.

**Impact:** required C5 destructive operation cannot complete through the existing component. **Confidence:** high.

**Correction:** Main must authorize the necessary caller ownership extension; wire exact-target impact confirmation and dirty guard, then pass the captured consent. Do not weaken the new refusal to make old callers work.

### C5. Hidden sessions can be selected/rendered again without Reopen

**Evidence:** `shared/ui/screens/ProjectTerminalScreen.kt:496-502,709-741,834-840,1085-1089,1707-1726,1807-1815`.

Only tab rendering filters hidden entries. The screen-local selectable predicate and refresh selection still include them, so a later refresh can select the first hidden terminal and render its console without explicit Reopen. The nonretained path records fallback hidden IDs but always passes an empty hidden list into the dialog, making explicit reopen impossible there.

**Impact:** local hide/reopen contract fails in the actual production component; C6 violation. **Confidence:** high.

**Correction:** use one qualified visibility/selection predicate at all selection/render/attach boundaries; retain qualified hidden entries in both paths and expose those same entries to Reopen.

### C6. Exited-session Close View bypasses pinned refusal

**Evidence:** `shared/ui/screens/ProjectTerminalScreen.kt:1321-1336`; `shared/ui/screens/ProjectTerminalState.kt:231-280`.

The exited banner directly calls `hideSession`/`hideSessionById`, without the pin check used by the close dialog. Neither state method refuses pinned sessions. A pinned exited/restart-pending terminal can therefore be hidden without explicit unpin.

**Impact:** pinned-close acceptance fails. **Confidence:** high.

**Correction:** enforce pinned refusal in the shared hide admission, including the exited banner; test the actual handler rather than recreating an `if (!pinned)` in the test.

### C7. Uncertain-create presentation has no production data source

**Evidence:** `shared/ui/screens/ProjectTerminalState.kt:98,340-343`; `shared/ui/screens/ProjectTerminalScreen.kt:1122-1158,1570-1596,1686-1703`; `shared/features/terminal/TerminalRepository.kt:109-145`.

`uncertainCreates` starts empty; `syncUncertainCreates` has no production caller. The screen never reads the repository's persisted reservations or updates this list after an ambiguous create. New presentation helpers therefore display nothing after actual loss/process recovery, while ordinary Start/Create controls remain available and failures are generic. Repository-side reservation refusal is not the required blocked explanatory UI.

**Impact:** C6's uncertain-create deliverable is unwired, not end-to-end behavior. **Confidence:** high.

**Correction:** connect the current component/state to the existing storage port on entry and create settlement; show original qualified intent and Check status, block replacement controls without clearing uncertainty from list absence.

### C8. Termination refresh reintroduces selection retargeting

**Evidence:** `shared/ui/screens/ProjectTerminalScreen.kt:500-502,725-741,1762-1789`.

The new branch refreshes inventory while `destroyingSessionIds[target]` is still true. Refresh excludes the original target, sees it as unselectable, and selects another terminal. This occurs even on 409 refusal, despite presentation claiming the original target is preserved. W06 removes the earlier clear-before-refresh handling. Finally, the transient lock is removed regardless of outcome; pending acknowledgement is not retained as a separate lifecycle state.

**Impact:** destructive refusal/pending result retargets the user's active session; C6 violation and regression of prior handling. **Confidence:** high.

**Correction:** separate request-busy, pending termination and local visibility; preserve exact original selection on refusal/acknowledgement, and reconcile observed exit without selecting siblings as a side effect of temporary exclusion.

## Warnings — SHOULD FIX [8]

1. **Disposal/snapshot tracking is incomplete.** `EditorTabsState.kt:135-153,686-694,1168` ignores the replaced old document returned by the registry; native view cleanup (`AndroidEditorSurface.kt:99-105`) releases directly without triggering registry pruning. A clean document whose tab closes before its view releases can remain retained. `AndroidEditorDocument.beginSaveTracking` (`:84-93`) has only a test caller, so direct save ports do not use the new native in-flight count. Route disposal through the retained owner and exercise actual save/view-release ordering.
2. **Exact view lease is not enforced.** `AndroidEditorDocument.kt:533-580` stores but never validates `activeViewToken`; detach accepts and ignores its token. Successor attachment also leaves the predecessor widget editable against the same content until its later release. Fence widget+lease ownership and suppress predecessor input before handoff. Existing tests cover different-widget view-state preservation, not stale-token or predecessor-input behavior.
3. **Native editor modifier was dropped.** `AndroidEditorSurface.kt:114-162` no longer passes `modifier.fillMaxSize()` to `AndroidView`; the exposed modifier is unused. Restore layout propagation; device layout impact remains unmeasured.
4. **Structured command delete/rename no longer works correctly.** `RemoteConfigEditor.kt:680-686` copies every original command and overlays remaining names. Removing one command while another remains resurrects the removed entry; renaming preserves both old and new names. Track original names by stable row identity and remove only explicitly deleted/renamed known entries while preserving genuinely unknown data.
5. **The mtime getter serializes the entire document.** `EditorSession.kt:28-31` obtains a full UTF-8 save snapshot merely to read mtime; Android `snapshotForSave` allocates bytes (`AndroidEditorDocument.kt:494-500`). Save already captured a snapshot immediately beforehand. Use that snapshot's mtime or a nonallocating canonical baseline property; avoid the additional O(file-size) allocation on the UI path.
6. **Viewport collapse is not based on the effective measured viewport.** `ProjectTerminalScreen.kt:1033-1056` budgets before child IME padding and subtracts a fixed `104.dp`, ignoring actual chrome/banner heights. The new measured-height helpers are not used here. Measure the post-inset/IME content and real chrome/accessory sizes as C8 requires.
7. **Alias metadata is not synchronized with the shared document.** `EditorTabsState.kt:576-593,1303-1318` initializes a new alias from fresh server bytes with `isDirty=false`, even when adopting an existing dirty document; listeners update only the editing session's tab. Session reads remain shared, but nonactive tab indicators/preview metadata can describe stale content. Publish metadata from canonical document events for every alias, including immediately on adoption.
8. **Several new regressions assert reconstructed logic rather than production behavior.** `shared/src/jvmTest/.../EditorSaveRaceTest.kt:290-354` manually calls `completeSave` instead of issuing either save; `:391-426` never exercises the configured 409 handler; terminal pin/stale-dialog tests recreate guards locally. Replace these with production callback/save/deferred-I/O tests covering the failures above. Unit test names are not evidence of exercised network/concurrency behavior.

## Suggestions — NICE TO HAVE [2]

1. After correctness repairs, split the 1,320-line `EditorTabsState.kt` and 2,488-line `ProjectTerminalScreen.kt` into focused presentation/transaction pieces. Resolve the newly introduced `CanonicalDocumentRegistry` against C4's explicit no-new-registry/retained-owner contract rather than allowing a second lifetime convention.
2. Keep diagnostics allowlisted. The new `SettingsDiagnostics.redact` helper is unused in production exports and recompiles multiple regexes per call; remove it if unnecessary, or give it a real bounded diagnostic-text caller and precompiled patterns. Do not replace the stronger allowlist with regex-only sanitization.

## Positive/security observations

- Three existing channels remain `VISIBILITY_PRIVATE`; sink forces fixed generic public title/body independently of caller-supplied public strings (`AndroidNotificationPlatform.kt:27-57`; `AndroidNotificationSink.kt:110-134`).
- Immutable explicit PendingIntents remain; socket identity now round-trips. Posting checks permission and blocked channels without prompting; runtime permission request is API33+-guarded and user-action API only (`AndroidNotificationPlatform.kt:111-124`).
- Profile cancellation filters notification ownership, not global cancellation (`AndroidNotificationSink.kt:84-95`). Coordinator retains exact-key owner tracking; no new automatic permission call/keepalive introduced in the reviewed diff.
- Cancel initial focus is explicitly requested and applied to the close dialog; missing destructive identity does not disable local Close View. Actual focus/OS behavior needs coordinator device evidence.
- TOML bytes remain raw through import/export; structured edits now preserve unknown nested service/terminal fields. Local diagnostics continue typed allowlisting, excluding credentials/terminal output. SAF outcomes distinguish confirmed/not-submitted/rejected/unknown; import consent names the exact captured server and destructive impact.

## Completion / unresolved evidence

W06 is not technically acceptable on this static review. No claim that existing automated/device/live gates pass. Main owns compilation, focused regressions, separate meaningful smoke and evidence-backed status updates under C9/C10; physical OS privacy/permission, IME and native editor lifetime remain unobserved here. Root-confirmation caller fixes require ownership authorization because those UI files are outside the W06 Settings allowlist. No unresolved product-design question.
