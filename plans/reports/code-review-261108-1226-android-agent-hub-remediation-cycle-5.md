# Native Android Agent Hub Remediation — Cycle 5

## Score: 6/10 — changes requested

**5 critical issue groups; 4 warnings.** Real improvements landed, but the inspected source does not support closing all Cycle 4 findings. In particular, no monotonic reauthorization epoch exists in the inspected implementation; null identity still permits editable admission and saves; projectless workspace construction remains gated on a selected project. Automated pass evidence does not close these source-level gaps.

## Scope

- Target: `native/android-app`; working-tree remediation diff and relevant production callers/tests, not full-repository audit.
- Reviewed requirements: README, PDR, code standards, redesign overview, binding C1–C10 and acceptance matrix; Cycle 4 review and final tester report.
- Loaded published development rules and code-review skill. LSP status: no language servers configured; used source tracing.
- No product/test/plan/task-state edits. This report is the sole reviewer-authored artifact. Administrative plan closure intentionally unchanged; technical acceptance remains incomplete.
- Paths below use `common/` = `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`; `android/` = `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/`.
- Findings are static-source observations; runtime impacts marked [INFERENCE], not reproduced device results. Confidence high unless stated otherwise.

## Critical issues

### C-01 — Projectless capability stage remains unreachable; Hub row routing still lacks exact authority

**Evidence:** `common/ui/screens/DamHopperMobileApp.kt:344-377,843-859,1190-1207,1246,1264`; `android/platform/workspace/NativeWorkspaceViewModel.kt:1964-2002,2070-2112`; `common/features/workspace/AgentHubModels.kt:17-30`.

- Root workspace construction still requires `selectedProj != null` at line 361. When projectless, `activeWorkspaceState` is therefore null and line 845 always selects `AgentHubEmptyRoot`. The new `proj ?: "Workspace"` label does not construct or select a workspace browsing target. Workspace Files/Editor handlers still mutate the first retained project workspace, or do nothing when none exists.
- Deferring project-terminal session mutation into `requestWorkspaceTarget.onCommitted` repairs the specific cancelled-consent mutation. However, its validator checks only connection presence, not captured generation, endpoint/account, socket or terminal incarnation. `action.incarnationExact` remains unused.
- Free-terminal rows have no independent profile owner; the UI substitutes `hubSnapshot.profileId`. The free-terminal handler selects a raw ID in the current workspace without switching/validating its actual owner.

**Impact [INFERENCE]:** fresh-login Files/Editor clicks do nothing; retained unrelated panels can change invisibly; stale or cross-profile/equal-ID rows can select the wrong terminal.

**Correction:** implement/select an actual workspace-scoped content stage using the explicit filesystem target. Route qualified Hub rows, including free terminals, through the existing verified-terminal admission flow; capture and revalidate exact owner/socket/incarnation after consent before any mutation. **C1/C2/C4/C8; A01/A02/A08/A24.**

### C-02 — Null identity remains editable and write-eligible

**Evidence:** `common/features/editor/EditorContentLoader.kt:89-105`; `EditorTabsState.kt:374-415,432-465,637-669`; `EditorRepository.kt:115-149`; `EditorTabSaveCoordinator.kt:18-36,81-96`.

The loader correctly nulls unverified identity/canonicalPath, but still returns editable `Success` with NORMAL/DEGRADED tier. Tabs create editable native sessions using target/path/epoch-zero fallback keys. `saveDocument` checks epoch only inside `if (fid != null)`; missing identity is not denied. Ordinary tab save/overwrite calls the separate `saveFile`/`forceOverwrite` paths, bypassing even that conditional check.

**Impact [INFERENCE]:** unsupported/malformed identity can establish a writable baseline; aliases can acquire separate dirty buffers without canonical authority. A noncanonical-looking fallback string is not an authorization boundary.

**Correction:** reject missing/invalid same-read identity before editable publication, or explicitly expose read-only content. Require verified identity and applicable owner epoch on every write path, not just one repository port. **C4; A05/A06/A10.**

### C-03 — Reauthorization still uses dirty alias IDs and generation alone; claimed monotonic fence absent

**Evidence:** `common/features/workspace/ProjectWorkspaceState.kt:277-283,290-398,537-544`; `common/features/editor/EditorTabsState.kt:342-359,859-868,1059-1068`; `android/platform/workspace/NativeWorkspaceViewModel.kt:1602-1606`.

- Rebind records only currently dirty tab `DocumentId`s, clears retirement and reenables input. Clean retained documents are not reauthorized; dirtying one afterward does not put it in the deny set. A new alias to a retained dirty canonical document similarly has a new unblocked ID.
- `reauthorizeRetainedDocuments` captures only numeric connection generation, repeatedly dereferences mutable `fileRepository`, and has no monotonic reauthorization/retirement token or exact repository/socket comparison. A same-generation retire/rebind during suspended stat can accept the old response and remove a current deny entry.
- The empty-dirty-tabs branch clears `_isAuthorityRetired` before any authority check, so an unauthoritative call can restore editing on a retired clean workspace.

**Impact [INFERENCE]:** stale retained baselines regain write authority through clean-to-dirty edits, new aliases or ABA; a late response can authorize replacement authority.

**Correction:** revoke/regrant authority on the retained canonical document, independently of alias IDs/dirtiness. Capture an exact transport and monotonic retirement/rebind token; recheck after every suspension and before publication. Empty work must not restore retired authority. **C4; A06/A07/A25.**

### C-04 — Actual saves still do not hold exact-document lifetime leases

**Evidence:** `common/features/editor/EditorTabsState.kt:153-168,206-247,737-752,885-937`; `EditorSession.kt:104-119`; `EditorTabSaveCoordinator.kt:23-44`; `android/platform/editor/AndroidEditorDocument.kt:85-99,121-125`; `AndroidEditorSurface.kt:98-108`.

Dirty tier replacement now marks the old document discarded and uses one reconstruction publication path: those specific repairs are present. However, `beginSaveTracking()` still has no production caller. Native `_inFlightSaveCount` remains zero during real saves. Forced discard bypasses registry save locks, and view release can close the exact document while its save is suspended. Snapshot construction itself establishes no lease.

Production surfaces release directly on the document, bypassing registry retirement settlement; `retiredDocuments` can continue retaining the already closed document until another registry operation.

**Impact [INFERENCE]:** premature native-buffer/history disposal relative to in-flight saves and retained references after final surface release.

**Correction:** make real snapshot/save execution hold an exact-document lease through outcome/cleanup; explicit discard cannot bypass it. Settle registry retirement on every final view/save release using the exact document, including production surfaces. **C4; A06/A07/A25.**

### C-07 — Blocking network call removed, but fresh notification validation now happens after navigation commit

**Evidence:** `android/platform/workspace/NativeWorkspaceViewModel.kt:792-848,2181-2233`; `common/ui/flow/AppFlowNavigation.kt:318-343`.

The synchronous validator now calls nonblocking `checkLive`, removing the reviewed `runBlocking` ANR path. But `routeToTerminal` first calls `commitRouteState`, then `onCommitted` launches fresh server resolution. After dirty-departure consent, authoritative HTTP validation is therefore too late to prevent stale navigation. A refusal or changed project/worktree simply skips callback work: navigation already happened and no refusal notice is published. The launched callback also lacks a request/navigation-intent fence; a slow result can select the old profile/session after the user navigates elsewhere.

**Impact [INFERENCE]:** a removed/moved terminal can commit a stale route; delayed notification work can supersede newer user navigation. Avoiding UI blocking did not restore the required transaction ordering.

**Correction:** consent first, then launch cancellable fresh resolution; immediately revalidate exact authority and current intent before a single atomic route commit. Surface post-consent refusal without changing the original route. Reuse existing verified-terminal routing rather than adding another coordinator. **C7/C8; A20/A24.**

## Warnings

1. **W-01 — Presentation qualification incomplete.** `android/platform/workspace/NativeWorkspaceViewModel.kt:1330-1331,1357-1358,2031-2044`. Hide now correctly checks active profile before clearing selection. Reopen still calls raw `selectSession` without selecting its profile/project/exact instance; snapshot sets strip qualification and raw-ID compatibility checks remain. Use the existing structured presentation identity throughout; remove raw compatibility paths.
2. **W-02 — Uncertain-create account binding not wired; settlement still accepts incomplete success.** `common/features/terminal/TerminalRepository.kt:26-30,111-150`; `TerminalModels.kt:10-12`; `android/platform/workspace/NativeWorkspaceViewModel.kt:2011`. Constructor/persistence support and response-ID checking are present, and endpoint filtering is an improvement. All inspected production constructors omit `accountUser`, including the create path; it remains null in records. Null storage still skips reservations. A matching-ID 2xx with default zero incarnation or missing/invalid PTY epoch removes uncertainty. Bind the authenticated owner at production construction and settle only a validated original success/refusal; preserve ambiguous records.
3. **W-06 — Single replacement path loses tier metadata and still duplicates serialization.** `common/features/editor/EditorTabsState.kt:296-339,1258-1274`; `EditorSession.kt:68-70`. Replacement listener derives only LARGE/NORMAL from `isReadOnly`, so NORMAL→DEGRADED is published as NORMAL; fresh response mtime/size/mime are not propagated there. Two `getText()` calls per alias each snapshot/UTF-8-copy the whole buffer. Carry exact loaded successor metadata through the single existing publication path and reuse loaded text once. Duplicate session reconstruction itself is fixed.
4. **W-08 — Tests still miss the remaining production boundaries.** `shared/src/jvmTest/.../editor/EditorTabsStateTest.kt:88-153` still expects editing without identity. `.../workspace/ProjectWorkspaceStateTest.kt:365-430` covers a dirty alias with direct `rebindAuthority`, not clean-to-dirty, another alias, same-generation transport replacement or suspended-stat ABA. `androidApp/src/test/.../workspace/AgentHubLifecycleTest.kt:372-413` uses direct registry release, not production surface release or a suspended real save. Current fixture identity additions do not supply these negative regressions.

## Positive observations / architecture

- Project-terminal session mutation moved behind consent; cross-profile Hide no longer clears another profile's equal-ID selection.
- Unverified loader identity remains null rather than being substituted with a path.
- Dirty replacement marks the exact old document discarded; redundant caller reconstruction removed.
- `serverMtime` is now O(1), avoiding the prior snapshot allocation just to read mtime.
- Notification revalidation no longer uses `runBlocking`.
- Version-1 response header gates adopted terminal termination epochs; duplicate populated upload selectors removed; represented primitive command rename/delete merge repaired; separate-window departure dialogs suppressed during privacy masking.
- Existing KMP/platform boundary retained; no added runtime/dependency/service. Remaining defects are incomplete transactions/authority ownership, not a need for more abstraction. Apply KISS/DRY by reusing verified routing, canonical ownership and one replacement publication path.

## Suggestions / recommended actions

1. Close C-01/C-02/C-03/C-04/C-07 before technical acceptance; do not infer closure from labels, null assignments, added optional constructor fields or green suites.
2. Add negative regressions at production boundaries: projectless rendered clicks, free/cross-profile equal IDs, stale/cancelled row consent, identity-less writes through both ports, canonical reconnect authority, suspended-save discard, tier metadata, delayed/refused post-consent notification and superseding navigation.
3. Keep administrative completion separate from acceptance. Main's documentation owner should reconcile remaining source gaps with PDR/projectless claims and plan residuals; no reviewer task-state changes.
4. After repairs, Main should run coherent focused regressions plus `:shared:jvmTest :androidApp:testDebugUnitTest`, Android compilation/packaging and applicable instrumented/live gates. No extra coordinator or compatibility shim needed.

## Reviewed files

Changed production Kotlin (18):
- `android/platform/editor/AndroidEditorDocument.kt`
- `android/platform/workspace/NativeWorkspaceViewModel.kt`
- `common/features/editor/{EditorContentLoader,EditorDocument,EditorRepository,EditorSession,EditorTabsState}.kt`
- `common/features/files/TransferCoordinator.kt`
- `common/features/settings/RemoteConfigEditor.kt`
- `common/features/terminal/{TerminalModels,TerminalPresentationPolicy,TerminalRepository}.kt`
- `common/features/workspace/{AgentHubModels,ProjectWorkspaceState}.kt`
- `common/ui/flow/AppFlowNavigation.kt`
- `common/ui/screens/{DamHopperMobileApp,ProjectTerminalScreen,ProjectWorkspaceScreen}.kt`

Changed test Kotlin (8; inspected diff/relevant assertions):
- `androidApp/src/test/.../platform/workspace/AgentHubLifecycleTest.kt`
- `shared/src/jvmTest/.../features/editor/{EditorSaveRaceTest,TestEditorDocument}.kt`
- `shared/src/jvmTest/.../features/files/TransferCoordinatorTest.kt`
- `shared/src/jvmTest/.../features/workspace/{GitWorkspaceSafetyTest,ProjectWorkspaceStateTest,RetainedGitTransportTest,WorkspaceDepartureTest}.kt`

Supporting source excerpts: `EditorTabSaveCoordinator.kt`, `AndroidEditorSurface.kt`, `EditorTabsStateTest.kt`. Requirements/evidence: root README; docs PDR/standards; redesign `plan.md`, `architecture-contracts.md`, `acceptance-matrix.md`; Cycle 4 review; final tester report. Approx. 3,000 source/test lines plus supporting requirements inspected.

## Validation commands/results

**Reviewer executed:** `git diff --stat && git status --short`, scoped `git diff -- <listed source/test paths>`, static reads/searches; LSP status returned no configured servers. No build/test/lint/formatter/device execution by reviewer, per assignment ownership. TODO/FIXME search in the four central remediation files returned no matches; absence of comments does not close acceptance gaps.

**Reported evidence, not reviewer-executed or independently current-tree certified:** `plans/reports/final-tester-261108-1158-android-agent-hub-remediation.md:20-42` records:

```text
cmd.exe /c gradlew.bat --no-parallel -Dkotlin.daemon.jvmargs="-Xmx6144m" -Dorg.gradle.jvmargs="-Xmx6144m" :shared:jvmTest :androidApp:testDebugUnitTest --rerun-tasks
```

Reported BUILD SUCCESSFUL; 44 tasks executed; shared 1,044 passed / 111 suites; Android 256 passed / 31 suites; combined **1,300 passed / 142 suites, zero failures/errors/skips**. This report precedes the Cycle 5 review and is not a fresh reviewer validation of the final edits. No fresh lint, packaging, instrumented, dual-server or physical-device result established here. Type/test coverage percentages unavailable; pass rate is not coverage.

## Unresolved questions / evidence

No unresolved product-design question. Remaining qualification: physical API29/API33+ device privacy/IME/TalkBack and adaptive layout; connected instrumented lifecycle journeys; isolated live multi-server and Windows PTY termination; actual process-death uncertain-create restoration. Current headless evidence does not close these gates.
