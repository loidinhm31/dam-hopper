# Android Agent Hub comprehensive code review

## Score: 4/10

**Disposition: changes requested.** Good building blocks, but P01–P07 end-to-end behavior and C1–C10 compliance are not established. Several paths remain disconnected or fail open at identity/lifetime boundaries.

Scope: changed production code under `native/android-app`, supporting terminal/files transport and ownership implementations, relevant JVM/Android regression sources, architecture contracts, P08 evidence. Read-only source review; no source/plan/task-state modifications and no tests/build/lint executed by this reviewer. Independent tester report `plans/reports/full-suite-tester-261108-0035-android-agent-hub-redesign.md:19-43` reports 1,299 unit tests passing; that is attributed evidence, not this reviewer's execution. Findings below are static code-path analysis, not device reproductions. Paths below are relative to `native/android-app` unless explicitly stated.

## Critical Issues (8): MUST FIX

### C-01 — Hub contracts are not connected to the active UI
- Evidence: `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt:836-865,1077-1085,1142-1166`; `androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt:1180-1181,1863-2003`.
- Root chooses an empty-project card or the pre-existing project workspace. No production caller collects `services.hubSnapshot` or invokes `dispatchAction`; repository search finds only declaration/implementation and model tests. The empty Hub disables Files/Editor entirely. Consequently the implemented fleet/zero-session/free-terminal Hub model is not the active product. This is not merely a visual polish gap (C1/C2/C4).
- Correction: wire the existing retained snapshot/actions into the single active stage; support all already-connected owner-qualified inventory and workspace browsing without requiring a project first. Reuse existing lifetime owners rather than adding another state model.
- Confidence: high.

### C-02 — Editable documents are admitted without canonical read identity
- Evidence: `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorContentLoader.kt:83-98`; `features/editor/EditorTabsState.kt:325-365,378-410`; `androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocument.kt:69-70,493-503`.
- A successful UTF-8 read with no FileIdentity becomes editable. `resolveCanonicalKey` manufactures a target/path fallback, and `installSession` never installs its identity/canonicalPath parameters on the native document. Native save snapshots therefore retain null identity even for identity-bearing reads. Violates C4's explicit missing-identity prohibition; canonical equality and save authority can diverge.
- Correction: reject/read-only downgrade missing or invalid identity before editable publication; construct and retain the same-response identity with the baseline and carry it through every native snapshot/reload/save path. Do not invent a wire field unsupported by the server.
- Confidence: high.

### C-03 — Reconnection restores old document write authority without reauthorization
- Evidence: `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt:365-374`; `features/workspace/ProjectWorkspaceState.kt:302-320`; `features/editor/EditorTabsState.kt:314-322`; `androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt:1558-1586`.
- Production root creates owners without server workspace identity/epoch. Rebinding those equal owners immediately clears retirement and swaps repositories; no fresh read identity verifies that the old dirty document still denotes the current authorized file. A server workspace/root/epoch change at the same endpoint/account can therefore re-enable old dirty data against a new target; an mtime match is not identity proof (C4).
- Correction: keep each retained document unauthorized until fresh authorized identity matches its captured canonical baseline; isolate/refuse changed epochs and targets while keeping original dirty/undo recovery reachable.
- Confidence: high.

### C-04 — Final visible close/discard leaves orphaned documents; replacements lose disposal ownership
- Evidence: `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorTabsState.kt:156-174,177-188,682-698,1207`; `androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt:99-105`.
- Closing the last visible alias prunes while its view lease still exists, so pruning does nothing. Later surface release directly calls `document.releaseViewLease`, never registry pruning. For Discard the retained document remains dirty, so reopening can resurrect supposedly discarded edits. Tier replacement also drops the old registry entry without any retirement/disposal path; old native Content/listeners can remain alive. Zero-reference disposal is not end-to-end implemented (C4).
- Correction: retain explicit disposal ownership through replacement and both alias/view close orders; commit final discard intent, and invoke exact-document disposal evaluation when every alias/view/save lease settles. Never dispose a surviving alias or view.
- Confidence: high.

### C-05 — Privacy/input cover misses separate dialog windows and the notification feed
- Evidence: `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt:543-545,565-572,798-807,992-1012,1019-1020,1272-1275`; `ui/components/CognitoOverlay.kt:57-84`; `features/workspace/ProjectWorkspaceState.kt:460-483`.
- New project picker is an Android Compose Dialog (separate window), while Cognito is an in-content Box. An active picker/other dialog is not masked or touch-blocked by that Box. Separately, `notificationsOpen` is absent from both input-suspension and effective-cover derivation, so the retained terminal remains input-eligible under the expanded feed. Session/document edit gates also omit `_inputSuspended`; widget focus clearing alone is not the required three-layer boundary (C7/C8).
- Correction: make every dialog/portal participate in privacy masking/input blocking without losing retained intent; include feed/modal visibility in the single live cover and enforce it at session/document/platform dispatch. Add native IME/hardware/TalkBack regressions.
- Confidence: high for missing gates; native window behavior requires device validation.

### C-06 — Worktree terminal selection and creation silently target the project root/sibling
- Evidence: `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt:511-520,765-769,1627-1634,1750-1753`; `ui/screens/ProjectWorkspaceScreen.kt:308`.
- Screen receives `worktreePath` but filters sessions only by project, then can choose the first matching terminal from another worktree. Both visible create buttons omit worktreePath. Opening a linked worktree can therefore type into or create a terminal outside that worktree. This is an actual target-isolation failure, not a cosmetic grouping problem (C4/C6).
- Correction: match the exact qualified worktree identity for selection/attachment and pass the captured worktree in every creation request. No sibling/root fallback. Cover equal-project distinct-worktree journeys.
- Confidence: high.

### C-07 — Notification activation ignores its captured socket and stale post-consent terminal inventory
- Evidence: `androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/notifications/AndroidNotificationSink.kt:158,226`; `platform/workspace/NativeWorkspaceViewModel.kt:790-815,824-843,2063-2068`.
- Socket ID is serialized/deserialized, but no activation validator compares `target.socketInstanceId` to the active socket. After the initial `listDetailed`, dirty confirmation revalidates only cached reducer state; it does not recheck authoritative terminal inventory/project/worktree. A replacement socket or terminal mutation during confirmation can admit an old click despite C7's after-every-suspension requirement.
- Correction: require the original captured socket and exact owner/account throughout activation; after consent revalidate authoritative terminal identity and commit the exact incarnation, not just a raw ID.
- Confidence: high.

### C-08 — Project selection mutates shared target state before dirty consent
- Evidence: `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt:998-1006`; `androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt:1865-1877`; `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/flow/AppFlowNavigation.kt:238-246`.
- Picker/actions write `targetStore` first, then call navigation whose departure guard may cancel/defer. Cancelling the dirty prompt leaves target-store and visible owner disagreeing; no continuation revalidates ownership before the shared target commit. Explicitly prohibited by C8.
- Correction: use the existing guarded target-transition seam and atomically commit flow/store only after consent and owner revalidation. Cancel/busy/failure must leave both unchanged.
- Confidence: high.

## Warnings (10): SHOULD FIX

1. **Unqualified duplicate Hub state.** `androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/workspace/NativeWorkspaceViewModel.kt:1173-1174,1192-1197,1284-1290,1306-1316,1926-1939`: bare ID pin/hidden sets collide across profiles and incarnations; owner lookup falls back to any workspace of a profile, including wrong account/endpoint/target. These also duplicate `ProjectTerminalState`'s qualified sets. Use one retained qualified authority before wiring Hub actions. C2/C6.
2. **Incomplete stage/back cutover.** `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/DamHopperMobileApp.kt:430,477`; `ui/flow/AppFlowNavigation.kt:494-496`; `features/terminal/TerminalPresentationPolicy.kt:194-207`: HUB never satisfies TERMINAL-only registration branches; Back from selected-project Terminal routes to Profiles, not the Hub navigator. `canDismissWorkspace` has no production callers. Migrate every active caller and enforce authoritative live/hidden/restart/uncertain dismissal checks; remove obsolete enum aliases/stages after restore decoding. C1/C6/C8.
3. **Create identity/admission gaps.** `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRepository.kt:110-129,141-144`; `features/terminal/TerminalModels.kt:213-220`: intent IDs are timestamp strings, not required UUIDs; project-null pending creates do not block a different-ID replacement; persisted records omit endpoint/account. Any 4xx clears uncertainty, including potentially ambiguous upstream timeout responses. Capture a true explicit-intent UUID and logical owner; settle only exact success/known definitive refusal. C6.
4. **Protocol support is inferred, not negotiated.** `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/terminal/TerminalRepository.kt:47-61`; `TerminalPresentationPolicy.kt:124-129`: termination version header is never inspected; capability depends only on epoch/incarnation syntax. Require advertised version 1 and fresh matching inventory before destructive authority. C3/C6.
5. **Structured command rename/delete is incorrect.** `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/settings/RemoteConfigEditor.kt:544-548,687-693`: starts from the original command map and overlays current names. Removing one of multiple commands keeps it; renaming keeps the old command too. Reconcile original row identities while preserving genuinely unknown/unrepresented entries. C5.
6. **Upload clean cutover regresses to dual selectors.** `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/TransferCoordinator.kt:68-76`: sends nested target plus flat project/worktreePath. Current server supports compatibility fields, but C3 explicitly forbids this duplicate-selector payload. Remove obsolete flat fields/callers and assert exact serialization.
7. **Native lease token is unused; surface drops caller modifier.** `androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorDocument.kt:539-540,559-580`; `platform/editor/AndroidEditorSurface.kt:114-162`: detach checks widget identity only, ignoring active lease token; stale detach of a reused widget can release the successor. AndroidView no longer receives its `modifier`. Compare widget + lease and restore caller layout modifier; test same-widget/new-token detach.
8. **Avoidable full-document serialization for an mtime.** `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EditorSession.kt:28-32`; `EditorTabSaveCoordinator.kt:23-31`: serverMtime getter takes an entire UTF-8 save snapshot after save already captured one. Use the captured snapshot's mtime or an O(1) document-baseline accessor. Also remove the duplicate alias/session reconstruction after registry replacement (`EditorTabsState.kt:1207-1233`); replacement listeners already perform it. Performance/DRY.
9. **Responsive admission still uses guessed dimensions.** `shared/src/commonMain/kotlin/dev/damhopper/nativeapp/ui/screens/ProjectTerminalScreen.kt:1071-1077,1092`; `ProjectWorkspaceScreen.kt:80-84,209-212`; `DamHopperMobileApp.kt:1059`: accessory admission subtracts a fixed 104dp before IME padding; file rail pins at 600dp, leaving <360dp after its 280dp width; several targets are <48dp. Use measured insets/chrome/IME and the same stage-width admission policy. C8.
10. **P08 live gate is not live qualification; handoff docs remain stale.** `plans/261107-0305-android-agent-hub-redesign/reports/live-api-qualification.md:3,10-27` and `qualify-disposable-runtime-evidence.json:5-15` label unit/mock/oracle evidence as runtime verification. Required isolated multi-server/runtime qualification remains unexecuted. Device gate is correctly blocked in `device-visual-qualification.md:3,17-25`. `native/android-app/README.md:20-30` and `docs/code-standards.md:65` still describe the old linear flow. Mark live/device gates incomplete with exact prerequisites; update current architecture/docs/changelog honestly. C9/C10.

## Suggestions (3): NICE TO HAVE

1. Split the >2,000-line retained ViewModel and >2,500-line terminal Composable along existing ownership/presentation boundaries; do not create another coordinator/runtime.
2. Replace model-enum/manual-registry assertions with production-root interaction tests: collect real Hub snapshot, open aliases through `openTab`, close in both orders with a mounted native view, reject stale consent/socket, create in a linked worktree. Current native lifecycle tests manually insert/release registry entries and do not prove that wiring.
3. Keep redaction centralized: `SettingsDiagnostics.redact` is production-unused and rebuilds regexes per call. Retain the diagnostics allowlist, test actual exception/log/export sinks with credential canaries, and avoid maintaining a parallel redactor.

## Positive observations

- Redirects explicitly disabled in ApiClient; bearer attachment remains guarded.
- Notification PendingIntents remain explicit and immutable; lock-screen public strings are fixed generic constants.
- Uncertain-create records are synchronously committed before dispatch, and corrupted persistence blocks creation rather than silently overwriting evidence.
- Canonical key length-prefixing preserves path spelling; shared document leases and replacement notifications are useful foundations, despite incomplete disposal/authority integration.
- No new WebView/local PTY/local Git runtime introduced. Device evidence does not fabricate a hardware pass.

## C1–C10 conclusion

C1/C2: Hub contract not integrated; duplicate presentation state. C3: duplicate upload selectors and missing capability validation. C4: editable identity, reconnect authority, target isolation and final disposal need fixes. C5: command deletion/rename plus documentation/confirmation edge coverage need work; raw-object preservation is otherwise useful. C6: worktree selection, qualified view state, uncertainty and dismissal integration incomplete. C7: modal privacy and click socket/consent fencing incomplete. C8: pre-consent target mutation, Back/cover and sizing incomplete. C9: no claim that historical execution-wave barriers were independently audited. C10: unit evidence available; live multi-server and physical device qualification remain incomplete.

## Unresolved evidence

No reviewer-executed native/UI reproduction, live multi-server/crypto-isolated runtime, device/IME/TalkBack/visual acceptance, lint metrics, measured type/test coverage, or release-readiness proof. These are not passes. No source fixes performed in this review.
