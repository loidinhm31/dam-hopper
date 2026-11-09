# Native Android Agent Hub Redesign Remediation — Cycle 6

## Score: 6/10 — changes requested

**Five critical issue groups remain partially unresolved.** The working tree contains genuine repairs, including projectless holder construction, consent-deferred session mutation, monotonic reauthorization fencing, single replacement publication and nonblocking notification checks. These repairs do not establish the complete required transactions. Green unit suites do not close the source-level gaps below.

## Scope and evidence

- Reviewed working-tree remediation in `native/android-app`, relevant production callers, eight changed test files, PDR/standards, redesign overview/binding C1–C10/acceptance matrix, Cycle 5 report and reported final test evidence. Approximately 3,000 source/test lines plus requirements/diffs inspected; not a full-repository audit.
- Loaded published development rules, primary workflow and `code-review/SKILL.md`. LSP status: no configured servers; source tracing used.
- No source, tests, plans or task state changed. This report is the only reviewer-authored artifact. Administrative closure intentionally unchanged; technical acceptance remains incomplete.
- Paths below: `common/` = `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`; `android/` = `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/`.
- Findings are high-confidence static observations. Runtime effects explicitly marked **[INFERENCE]**, not reproduced device results.

## Critical issues

### C-01 — Projectless holder is not an explicit workspace target; Hub terminal admission remains unqualified

**Evidence:** `common/ui/screens/DamHopperMobileApp.kt:361-380,846-875,1247,1265`; `common/features/workspace/ProjectWorkspaceState.kt:633-637`; `common/features/files/FileTreeState.kt:134-136`; `common/core/model/FilesystemTargetRef.kt:76-78`; `common/features/files/FileRepository.kt:74-80,96-118`; `android/platform/workspace/NativeWorkspaceViewModel.kt:1964-2002,2070-2112`; `common/features/workspace/AgentHubModels.kt:17-30`.

- Root now constructs a projectless holder, but passes project `"*"` through `ProjectTargetRef`. Its tree initializes as `FilesystemTargetRef.Project("*")`, not Workspace. Project repository requests explicitly serialize `targetType=project&project=*` / nested project target. No workspace conversion occurs on the inspected path.
- Workspace Files/Editor actions still pick the first retained state for a profile and only change its panel; they never select the requested Workspace browsing target. With other retained projects this can mutate a different, invisible holder. Workspace file clicks outside registered projects also do nothing (`common/features/files/FileScreens.kt:345-351`).
- Project-row session mutation correctly waits for consent, but its validator checks only connection presence. `action.incarnationExact` is not consumed; generation/account/endpoint/socket and current terminal lifetime are not checked. Free-terminal rows still lack their own profile identity; UI substitutes snapshot profile and the handler selects a raw ID without qualified routing.

**Impact [INFERENCE]:** workspace-root browsing remains unavailable/misdirected; stale or equal-ID cross-profile terminal rows can select a different live target.

**Correction:** select an actual explicit Workspace browsing target on the exact visible holder and carry that target through file opening. Reuse existing verified-terminal admission for project/free rows, preserving owner/socket/exact incarnation through consent. **C1/C2/C3/C4/C8; A02/A04/A08/A24.**

### C-02 — Missing canonical identity still authorizes editable admission and ordinary saves

**Evidence:** `common/features/editor/EditorContentLoader.kt:86-104`; `EditorTabsState.kt:374-417,438-465,637-669,859-896,1059-1095`; `EditorRepository.kt:115-131,177-201`; `EditorTabSaveCoordinator.kt:18-36,81-96`.

The loader correctly leaves unverified identity/canonicalPath null, but still returns editable NORMAL/DEGRADED Success. Tabs create writable documents with fallback target/path keys. Repository identity validation is conditional on `owner.workspaceEpoch != null`; unknown owner epoch bypasses it. More importantly, tab save/overwrite check only membership in the reconnect deny set, then call `saveFile`/`forceOverwrite`, not the identity-checking `saveDocument` port. An identity-less freshly opened document is not in that set.

**Impact [INFERENCE]:** malformed/unsupported identity can establish a writable baseline; canonical aliases can become independent dirty documents. This is a client authorization/identity invariant failure, not evidence of a backend authentication bypass.

**Correction:** reject missing/invalid same-read identity before editable publication, or expose explicitly read-only content. Require verified identity/current owner authority on every write path; unknown epoch must not bypass verification. **C4; A05/A06/A10.**

### C-03 — Monotonic fence repaired; write reauthorization is still keyed by dirty aliases rather than canonical documents

**Evidence:** `common/features/workspace/ProjectWorkspaceState.kt:277-405,519-525,545-548`; `common/features/editor/EditorTabsState.kt:342-359,859-868,1059-1068`; `android/platform/workspace/NativeWorkspaceViewModel.kt:1602-1606`.

`reauthEpoch` now increments on revoke/rebind and is checked before/after suspended stats; the empty-work branch no longer restores retired authority. Those Cycle 5 subfindings are fixed. However, rebind still records only currently dirty alias `DocumentId`s, clears retirement and reenables input. Clean retained documents receive no fresh verification; editing one afterward bypasses the deny set. A new alias to an unauthorized retained dirty canonical document likewise receives a new unblocked ID. Production invokes reauthorization only when that dirty-ID set is nonempty.

**Impact [INFERENCE]:** retained canonical baselines can regain write authority without fresh identity through clean-to-dirty edits or another alias, despite the repaired ABA fence.

**Correction:** store revoked/regranted authority on the retained canonical document, independent of tab IDs and current dirtiness; all aliases and write entrypoints consult that authority. Keep the monotonic fence. **C4; A06/A07/A25.**

### C-04 — Real save execution still has no exact-document lifetime lease

**Evidence:** `common/features/editor/EditorTabsState.kt:150-168,206-247,737-752,859-937`; `EditorRepository.kt:135-174`; `EditorSession.kt:104-119`; `EditorTabSaveCoordinator.kt:23-44,86-103`; `android/platform/editor/AndroidEditorDocument.kt:65-99,121-125`; `AndroidEditorSurface.kt:98-108`.

The single replacement publication and explicit discard marking are present. Nevertheless, `beginSaveTracking()` has no production caller (only its declaration and an instrumented test reference). Actual snapshots/saves never increment native `_inFlightSaveCount`. Forced discard bypasses the canonical-key save lock; final production surface release can therefore close the exact document while its save is suspended. The direct repository save path also holds no document lease. Production surface release bypasses registry retirement settlement, leaving a closed retired document retained until another registry operation.

**Impact [INFERENCE]:** premature native-buffer/history disposal during in-flight work and unnecessary retained references after final surface release.

**Correction:** real snapshot/save execution must hold the exact document through outcome/cleanup; discard cannot bypass that lease. Settle registry retirement on exact final view/save release. **C4; A06/A07/A25.**

### C-07 — Fresh notification resolution still follows navigation commit

**Evidence:** `android/platform/workspace/NativeWorkspaceViewModel.kt:2181-2233`; `common/ui/flow/AppFlowNavigation.kt:309-343,346-363`.

The synchronous validator is nonblocking and required incarnation is now passed into the route. However, `routeToTerminal` still commits route state first; only `onCommitted` launches fresh HTTP resolution. After dirty consent, cached `checkLive` therefore remains the only precommit check. Fresh refusal/movement skips callback work after navigation has already happened, without a refusal notice. The launched callback has no current navigation-intent fence and can later select the old profile/session after newer user navigation.

**Impact [INFERENCE]:** stale navigation after consent; delayed notification work can supersede newer navigation.

**Correction:** consent first, launch cancellable fresh resolution, recheck exact authority and current intent, then commit once. Refuse in place with visible explanation. Reuse `requestVerifiedTerminalRoute`/existing verified admission rather than introducing another coordinator. **C7/C8; A20/A24.**

## Warnings

1. **W-01 — Presentation qualification incomplete.** `android/platform/workspace/NativeWorkspaceViewModel.kt:1327-1329,1357-1358,2031-2044`. Hide correctly checks active profile before clearing selection. Reopen still selects only a raw ID; snapshot sets strip profile qualification and raw-ID compatibility branches remain. Preserve structured owner/instance identity throughout; remove compatibility fallback.
2. **W-02 — Uncertain-create account field remains unwired; incomplete success clears reservation.** `common/features/terminal/TerminalRepository.kt:26-30,111-150`; `TerminalModels.kt:10-15`; `android/platform/workspace/NativeWorkspaceViewModel.kt:2011`; `common/features/workspace/ProjectWorkspaceState.kt:339`. Production construction omits `accountUser`, so records remain null-account. Matching response ID is now required, but default zero incarnation and absent/invalid PTY epoch still remove uncertainty. Null storage bypass remains. Bind authenticated identity and settle only fully validated original success/definitive refusal; preserve ambiguous records.
3. **W-06 — Single replacement publication loses metadata and repeats full-buffer serialization.** `common/features/editor/EditorTabsState.kt:296-339,1258-1274`; `EditorSession.kt:68-70`. Listener derives only LARGE/NORMAL from read-only state, publishing NORMAL→DEGRADED as NORMAL; loaded size/mime/mtime are not propagated in that branch. Two `getText()` calls per alias each snapshot/UTF-8-copy the entire document. Carry exact successor load metadata through the existing publication path; reuse loaded text once.
4. **W-08 — Negative production-boundary coverage remains missing.** `shared/src/jvmTest/.../editor/EditorTabsStateTest.kt:88-153` still expects editing with no identity. `.../workspace/ProjectWorkspaceStateTest.kt:365-430` tests one dirty alias and direct authority rebind, not production transport replacement, clean-to-dirty, new alias or suspended-stat ABA. `androidApp/src/test/.../workspace/AgentHubLifecycleTest.kt:372-413` releases via registry, not the actual surface, and has no suspended real save. Added fixture identities do not prove denial paths.

## Architecture, performance and security assessment

- Positive: existing KMP/platform split retained; no new runtime/dependency/service. Consent-cancel session corruption repaired; Hide isolation repaired; unverified identity is not manufactured; reauth ABA/empty-work checks improved; replacement reconstruction deduplicated; O(1) mtime getter avoids snapshot allocation; notification revalidation no longer blocks UI; upload populated duplicate selectors removed; represented primitive command rename/delete reconciliation repaired; departure dialogs suppressed while privacy masked.
- Remaining security/correctness risk: incomplete client write/route authority transactions, not a demonstrated external exploit. Preserve backend authentication and CAS guarantees; do not describe these as proof of client canonical identity.
- KISS/DRY/YAGNI: finish existing verified routing, explicit filesystem-target and canonical-owner paths. Do not add a second coordinator or more fallback identities. Large ViewModel/tabs files increase tracing cost, but broad modularization is not required to fix these defects.

## Suggestions / recommended actions

1. Close the five critical groups before technical acceptance; record partial repairs rather than marking whole groups resolved.
2. Add focused regressions for rendered projectless Files/Editor and workspace-root file opening; free/cross-profile/stale row consent; identity-less admission and both save ports; clean-to-dirty/new-alias reauthorization; suspended real-save discard/final surface release; exact tier metadata; refused/delayed post-consent notification and superseding navigation.
3. Main should run coherent focused regressions, then `:shared:jvmTest :androidApp:testDebugUnitTest`, applicable Android compilation/packaging and device/live qualification after repairs. No reviewer reruns performed.
4. Documentation owner should reconcile plan/PDR source-level readiness and historical counts with final evidence. Administrative completion is not technical acceptance.

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

Changed tests (8; diff/relevant assertions): Android `AgentHubLifecycleTest.kt`; shared `EditorSaveRaceTest.kt`, `TestEditorDocument.kt`, `TransferCoordinatorTest.kt`, `GitWorkspaceSafetyTest.kt`, `ProjectWorkspaceStateTest.kt`, `RetainedGitTransportTest.kt`, `WorkspaceDepartureTest.kt`.

Supporting source excerpts: `EditorTabSaveCoordinator.kt`, `AndroidEditorSurface.kt`, `EditorTabsStateTest.kt`, `WorkspaceFileOwner.kt`, `FileRepository.kt`, `FileTreeState.kt`, `FileScreens.kt`, `ProjectTargetRef.kt`, `FilesystemTargetRef.kt`. Requirements/evidence: root and Android READMEs; `docs/{project-overview-pdr,code-standards}.md`; redesign `plan.md`, `architecture-contracts.md`, `acceptance-matrix.md`, `reports/live-api-qualification.md`; Cycle 5 report; final tester report.

## Validation commands/results

**Reviewer executed:** `git diff --stat && git status --short`; scoped `git diff --` for production/tests; static source reads/searches; LSP status (no servers). No build/test/lint/formatter/device execution, per main-agent validation ownership. Central remediation source search found no TODO/FIXME or `runBlocking`; missing comments do not establish acceptance.

**Reported evidence, not reviewer-executed final-tree certification:** `plans/reports/final-tester-261108-1158-android-agent-hub-remediation.md:20-42,48-76` records:

```text
cmd.exe /c gradlew.bat --no-parallel -Dkotlin.daemon.jvmargs="-Xmx6144m" -Dorg.gradle.jvmargs="-Xmx6144m" :shared:jvmTest :androidApp:testDebugUnitTest --rerun-tasks
```

Reported **BUILD SUCCESSFUL**, 44 tasks executed; shared **1,044 / 111 suites**, Android **256 / 31 suites**, combined **1,300 passed / 142 suites**, zero failures/errors/skips. This evidence predates the latest Cycle 6 source review; it is not a fresh validation of all final edits. No fresh lint, packaging, instrumented, physical-device or isolated dual-server result established here. Type/test coverage percentages unavailable; test pass rate is not coverage.

## Unresolved questions / qualification

No unresolved product-design question. Outstanding evidence: physical API29/API33+ privacy/IME/TalkBack/adaptive-layout qualification; connected instrumented lifecycle journeys; isolated live multi-server and Windows PTY termination; actual OS process-death uncertain-create restoration. Source defects above remain actionable independently of those environment gates.
