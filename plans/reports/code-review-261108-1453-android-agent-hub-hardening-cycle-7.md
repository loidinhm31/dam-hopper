# Native Android Agent Hub Hardening — Cycle 7

## Score: 5/10 — changes requested

**Projectless Hub now fails a constructor invariant.** Other repairs are substantive but do not close the owner/document/navigation transactions. Four critical groups remain; green host-side suites do not establish production-boundary acceptance.

## Scope

- Reviewed working-tree diff in `native/android-app`: 19 tracked files, +574/-205; relevant production callers, regressions, C1–C10 contracts, plan/P08, PDR/standards and Cycle 6/tester reports. Approximately 3,000 source/test lines plus diff/requirements excerpts inspected; not a whole-codebase audit.
- `common/` below means `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`; `android/` means `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/`.
- Published development/primary workflows and `code-review/SKILL.md` read. LSP status: no configured servers; static source tracing used.
- Only this report authored. No implementation, tests, plans or task state changed; administrative closure intentionally unchanged. Scope remains technical review, not release acceptance.
- Findings: high-confidence static observations. Runtime consequences marked **[INFERENCE]**; no reviewer device reproduction.

## Cycle 6 remediation disposition

| Item | Cycle 7 disposition |
|---|---|
| C-01 — projectless filesystem/terminal admission | **Open; regression.** Blank project violates owner/target constructors. Hub terminal action still lacks exact admission. |
| C-02 — unconditional identity denial | **Partial.** Ordinary, overwrite and document-port saves now deny missing identity regardless of owner epoch; editable admission still accepts identity-less content. |
| C-03 — canonical reauthorization | **Partial.** All retained keys in a holder, clean-to-dirty and monotonic transport/repository fencing improved. Authority remains holder-local rather than canonical-document-owned. |
| C-04 — production save leases | **Core repair present.** Real save/overwrite/document-port execution acquires/releases exact document tracking. Registry retirement settlement remains incomplete. |
| C-07 — precommit notification resolution | **Partial.** Fresh suspending lookup now precedes route commit; current-intent cancellation and atomic profile/route admission still absent. |
| W-01 — qualified presentation/reopen | **Partial.** Cross-profile reopen no longer overwrites active selection; raw-ID projection/fallback and unqualified reopen remain. |
| W-02 — account/create response | **Partial.** Active root/ViewModel constructors bind authenticated account. Create still settles without positive incarnation/valid original PTY epoch. |
| W-06 — tier replacement metadata | **Partial.** Reload replacement carries exact metadata and reuses loaded text. Initial alias-open replacement does not. |
| W-08 — negative production coverage | **Partial.** New missing-identity write denial and clean-to-dirty assertions are useful; critical real boundaries remain unexercised. |

## Critical issues

### C-01 — Blank-project cutover breaks default Hub construction; terminal admission remains unverified

**Evidence:** `common/ui/screens/DamHopperMobileApp.kt:345-381`; `common/features/workspace/WorkspaceFileOwner.kt:31-35`; `common/core/model/ProjectTargetRef.kt:34-36`; `common/features/files/FileTreeState.kt:134-135,153`; `common/core/model/FilesystemTargetRef.kt:29-30,76-78`; `common/features/files/FileScreens.kt:345-351`; `android/platform/workspace/NativeWorkspaceViewModel.kt:1971-2012,2091-2138`.

- With no selected project, root now sets `effectiveProject = selectedProj.orEmpty()`, then constructs `WorkspaceFileOwner(project = "")`. That constructor requires a nonblank project. This is earlier than the tree failure: `ProjectTargetRef` and `FilesystemTargetRef.Project` also reject blank; tree initialization and `lastProjectTarget` still create Project targets. **[INFERENCE]** authenticated projectless Hub throws before its intended empty-root UI renders.
- New workspace-root file opening likewise constructs `ProjectTargetRef(project = "")`, which throws. Workspace Editor still calls `openTab(ws.target, ...)`, not an explicit Workspace document target. Workspace Files/Editor change a retained holder without changing flow to that exact holder; the fallback may still be a project holder.
- Terminal action now records an incarnation key but does not validate it. Project rows only recheck connection presence after consent; no captured generation/account/endpoint/socket/current-instance check. Free rows still lack their own profile on `HubTerminalRow`; UI substitutes snapshot profile and handler directly selects a raw ID without changing active profile/project.

**Impact [INFERENCE]:** default authenticated navigation crashes; workspace file opening remains invalid; stale/equal-ID terminal rows can select the wrong owner/session. **Confidence: high.**

**Correction:** carry actual Workspace authority/target through holder construction, tree and document ports; migrate all nonblank-project assumptions, not just one constructor. Commit the exact visible holder. Route project/free terminal rows through existing verified admission with captured owner/socket/instance and post-consent revalidation. Do not restore `"*"` or use blank project as a wire-target shim. **C1–C4/C8.**

### C-02 — Missing identity still creates an editable baseline

**Evidence:** `common/features/editor/EditorContentLoader.kt:89-104`; `EditorTabsState.kt:413-456,471-504,676-708`; `shared/src/jvmTest/.../editor/EditorTabsStateTest.kt:88-109,809-833`.

The loader strips missing/invalid identity but returns the original editable tier. Tabs install a writable native document with fallback target/path key. The new regression explicitly edits this unidentified document and asserts dirtiness before checking save refusal. The write-denial repair is real; it does not satisfy C4's separate admission invariant.

**Impact [INFERENCE]:** users can create unsavable dirty drafts, and unidentified aliases can acquire independent editable baselines. This is a client identity invariant failure, not evidence of backend authentication bypass. **Confidence: high.**

**Correction:** before editable publication, require valid same-content-response identity, or publish explicitly read-only/unavailable content with explanation. Preserve the unconditional write guards. Add negative admission coverage, not only negative save coverage. **C4.**

### C-03 — Revoked authority is still stored on a workspace holder, not the shared document

**Evidence:** `common/features/workspace/ProjectWorkspaceState.kt:161,186-187,281-354,357-432`; `common/features/editor/EditorTabsState.kt:101-106,375-396,427-436,898-910,1114-1125`; `android/platform/workspace/NativeWorkspaceViewModel.kt:1580-1588,1642-1665`; `shared/src/jvmTest/.../workspace/ProjectWorkspaceStateTest.kt:442-511`.

Canonical keys improve alias handling *inside the same holder*. However, `unauthorizedCanonicalKeys` remains a per-`ProjectWorkspaceState` flow; the shared registry/document records no revoked authority. A newly created project/worktree holder starts with empty deny sets and can acquire an existing retained dirty document from the owner-shared registry. Its write gates consult only its own empty sets. Reauthorizing one holder does not establish a canonical-document authority contract for every alias.

The new two-holder test revokes/rebinds only `ws1` and tests only `ws1`'s denial; it never tries `ws2`'s save. It calls `rebindAuthority`, not production `rebindTransports`. Reauthorization also no longer compares any server mtime before removing the key, so its successful result proves identity equality, not the claimed fresh matching baseline.

**Impact [INFERENCE]:** opening another holder/alias after reconnect can bypass denial for a retained shared dirty document; clean retained baselines can be declared reauthorized despite remote changes. Ordinary CAS remains a separate protection. **Confidence: high.**

**Correction:** retain revoked/regranted authority with the canonical document in the existing owner registry, independent of holder/tab/dirtiness. Every alias/write port must consult it. Keep monotonic repository/connection fences; verify baseline identity and mtime before regrant. Cover newly created holder aliases and suspended-stat ABA through transport replacement. **C4.**

### C-07 — Fresh resolution now precedes commit, but stale navigation can still win

**Evidence:** `android/platform/workspace/NativeWorkspaceViewModel.kt:1236-1237,2180-2287`; `android/MainActivity.kt:374-395`; `common/ui/flow/AppFlowNavigation.kt:352-363,416-429`; comparison: `android/platform/workspace/TerminalAgentsActivationCoordinator.kt:124-150,230-242,295-305`.

Consent → fresh suspending HTTP resolution → live check → route commit is now correctly ordered. But no request revision/job token ties the suspended notification operation to the latest user navigation. `onNewIntent` launches independent ViewModel jobs; ordinary navigation cancels only Agents activations. Both `requestVerifiedTerminalRoute` and `commitVerifiedTerminalRoute` intentionally omit the ordinary-navigation invalidator, so this new notification path also no longer spends an older Agents activation.

A delayed notification lookup can therefore commit after a newer project/terminal/back action, or an older Agents continuation can later overwrite the notification route. Profile selection is still a separate suspending operation *after* the route commit; failure is swallowed, leaving route/profile publication non-atomic.

**Impact [INFERENCE]:** old work can supersede newer navigation or leave mismatched profile/route state despite exact live terminal metadata. **Confidence: high.**

**Correction:** invalidate older navigation work at notification intent admission; fence/cancel its continuations on superseding navigation and recheck after each suspension. Use existing exact profile-route admission and verified routing transaction rather than unconditional route commit followed by best-effort profile selection. Preserve fresh precommit resolution/refusal UI. **C2/C7/C8.**

## Warnings

1. **W-01 — Presentation/reopen qualification remains incomplete.** `android/platform/workspace/NativeWorkspaceViewModel.kt:1336-1337,1363-1364,2052-2063`; `common/features/workspace/AgentHubModels.kt:17-30,87`. Snapshot still strips profile prefixes; pin/hidden checks retain raw-ID compatibility branches. Reopen carries no project/socket/epoch/incarnation and selects a raw ID on the active holder; other-profile reopen only unhides. Keep structured owner/instance identity throughout and use the same verified routing path. Cross-profile mutation guard is a genuine partial fix.

2. **W-02 — Create response settlement is not strict.** `common/features/terminal/TerminalRepository.kt:111-150`; `TerminalModels.kt:10-21`. Matching ID plus `alive` is insufficient: `alive` defaults true, incarnation defaults zero, and PTY epoch may be missing/malformed. Such a response still removes the persisted record. Nullable storage still bypasses persistence. Active root/ViewModel account wiring is repaired; the convenience `ProjectTerminalScreen.kt:1933-1947` and dormant `WorkbenchScreen` constructor remain null-account paths (not established active-root defects). Require positive exact numeric incarnation and valid originating epoch before settlement; retain ambiguous evidence. Missing persistence must not authorize a potentially ambiguous dispatch. **C6.**

3. **C-04 residual — Native leases protect saves, but final release does not settle registry references.** `common/features/editor/EditorTabSaveCoordinator.kt:22-76,90-139`; `EditorRepository.kt:136-171`; `EditorTabsState.kt:48-58,144-176,221-233`; `android/platform/editor/AndroidEditorDocument.kt:90-101,124-128`; `AndroidEditorSurface.kt:102-108`. Real production save tracking is now present, including `finally` release: the premature-disposal finding is repaired. But native final save/view release closes the document directly without removing it from `retiredDocuments`; cleanup awaits another registry operation. **[INFERENCE]** closed discarded documents/history references remain retained while the app otherwise idles. Settle the exact retired registry entry on final native release through existing lifetime ownership; do not add polling. **Medium severity.**

4. **W-06 — Metadata repair covers reload, not every canonical replacement.** `common/features/editor/EditorTabsState.kt:93-118,311-361,429-440,1334-1358`. Reload now supplies exact tier/mtime/size/mime/identity and loaded text, eliminating repeated full snapshots per alias on that path. `getOrCreateDocument` can still replace a clean document on alias-open read-only-tier change using `replaceDocumentAtomic(canonicalKey, created)` without metadata, before assigning successor identity. Existing aliases retain old mtime/size/mime and infer tier. Pass actual load metadata through this existing replacement path too; regress both reload and alias-open replacement.

5. **W-08 — New tests do not close production boundaries.** `shared/src/jvmTest/.../editor/EditorSaveRaceTest.kt:447-497` manually calls `doc.beginSaveTracking()` on `TestEditorDocument`; it never starts a real suspended save or mounts/unmounts `AndroidEditorSurface`. The reauthorization test never tests the second holder's denial or production transport replacement. `androidApp/src/test/.../workspace/NativeWorkspaceViewModelTest.kt:342-349` proves only string concatenation differs, not Hub snapshot/action isolation. Existing `AgentHubLifecycleTest.kt:372-413` still releases via the registry, unlike the real surface. Add real entry/factory/transport/continuation boundary regressions: projectless root and workspace file opening, free/cross-profile/stale rows, identity admission, new-holder aliases/ABA, native save-discard-release, all replacement metadata, delayed/refused/superseded notifications.

6. **Evidence gap — Final green rerun does not explain earlier failures.** Tester report `:37-61,117-118` retains five initial assertion failures and a subsequent successful rerun; daemon-session error causality is explicitly unproven. Preserve both outcomes. Also, report provenance lists 16 modified files while this review observed 19, including fixture identity additions; do not describe the earlier file manifest as an exact fingerprint of the reviewed tree.

## Security, performance and architecture

- Positive: missing-identity writes are denied at ordinary/overwrite/document ports; production saves now acquire exact-document leases; fresh notification HTTP resolution is suspending and precommit; reauthorization captures repository identity as well as monotonic epoch/connection; reload replacement preserves metadata and avoids per-alias full-buffer serialization; active account identity is explicitly supplied. No new service/runtime/dependency introduced.
- Main remaining risk: incomplete client authority transactions and unsafe navigation/lifetime boundaries, not a demonstrated external exploit. Backend auth/CAS must remain intact; neither substitutes for the client invariants.
- KISS/DRY/YAGNI: reuse Workspace targets, owner registry, exact profile admission and existing verified activation. Do not add fallback identities, another coordinator/poller or broad modularization to patch these paths. Three repeated identity-validation blocks and two holder-local deny sets are already drifting; centralize the invariant at its existing document authority boundary.
- No new hot-path allocation regression established. Reload text reuse is a concrete improvement. Registry retained references and unnecessary holder-local reauthorization remain maintainability/performance concerns.

## Suggestions / recommended actions

1. Fix the constructor/explicit-target cutover first; relaxing a nonblank guard alone does not complete filesystem authority.
2. Close editable admission, canonical shared authority and current-intent/atomic route admission before technical acceptance.
3. Complete create settlement, exact retirement cleanup, remaining replacement metadata and production-boundary regressions.
4. Documentation owner should reconcile source-level claims: PDR still documents `selectedProj ?: "*"` (`docs/project-overview-pdr.md:98`); standards still describe dirty-ID-only reauthorization (`docs/code-standards.md:69`). Preserve administrative closure separately from technical acceptance and historical evidence.
5. After repairs and stopped writers, main/check owner should run focused new regressions, coherent `:shared:jvmTest :androidApp:testDebugUnitTest`, applicable Android compilation/packaging, then live/device qualification. Do not rerun known failures merely to confirm them or equate pass count with coverage.

## Reviewed files

**Changed production (11), diff and relevant source:**
- `android/platform/editor/AndroidEditorDocument.kt`
- `android/platform/workspace/NativeWorkspaceViewModel.kt`
- `common/features/editor/{EditorDocument,EditorRepository,EditorTabSaveCoordinator,EditorTabsState}.kt`
- `common/features/files/FileScreens.kt`
- `common/features/terminal/TerminalRepository.kt`
- `common/features/workspace/ProjectWorkspaceState.kt`
- `common/ui/flow/AppFlowNavigation.kt`
- `common/ui/screens/DamHopperMobileApp.kt`

**Changed tests (8), diff/assertions:** Android `NativeWorkspaceViewModelTest.kt`; shared `EditorSaveRaceTest.kt`, `EditorTabsStateTest.kt`, `TestEditorDocument.kt`, `FileEditorMutationTest.kt`, `GitWorkspaceSafetyTest.kt`, `ProjectWorkspaceStateTest.kt`, `WorkspaceDepartureTest.kt`.

**Supporting excerpts:** `EditorContentLoader.kt`, `EditorSession.kt`, `FileTreeState.kt`, `FileRepository.kt`, `FilesystemTargetRef.kt`, `ProjectTargetRef.kt`, `WorkspaceFileOwner.kt`, `AgentHubModels.kt`, `TerminalModels.kt`, `TerminalPresentationPolicy.kt`, `ProjectTerminalScreen.kt`, `AndroidEditorSurface.kt`, `MainActivity.kt`, `TerminalAgentsActivationCoordinator.kt`, `AgentHubLifecycleTest.kt`.

**Requirements/evidence:** root/native READMEs; `docs/{project-overview-pdr,code-standards}.md`; redesign `plan.md`, `architecture-contracts.md`, `phase-08-qualification-docs-handoff.md`; Cycle 6 review; hardening tester report.

## Validation commands/results

**Reviewer executed:**
- `git diff --stat -- native/android-app && git diff --name-only -- native/android-app` — 19 changed files, +574/-205.
- `git diff -- native/android-app/shared/src/commonMain native/android-app/androidApp/src/main` — production patch inspected.
- `git diff -- native/android-app/shared/src/jvmTest native/android-app/androidApp/src/test` — test patch inspected.
- Static source reads/searches; central remediation search found no `TODO`, `FIXME` or `runBlocking`. LSP status: no language servers configured.
- **No build/test/lint/formatter/device checks run by reviewer**, respecting main-agent/check-owner execution ownership. No source-level runtime assertion is claimed as reproduced.

**Tester-reported evidence, not reviewer execution:** `plans/reports/tester-261108-1453-android-agent-hub-hardening.md:35-62`:

```text
cmd.exe /c gradlew.bat --no-parallel -Dkotlin.daemon.jvmargs="-Xmx6144m" -Dorg.gradle.jvmargs="-Xmx6144m" :shared:jvmTest :androidApp:testDebugUnitTest --rerun-tasks
```

Initial run: BUILD FAILED, shared 5 failures; Android 257 passed. Targeted isolations passed. Final full rerun: **BUILD SUCCESSFUL**, 44 tasks executed, shared **1,047/111 suites**, Android **257/31 suites**, total **1,304 passed/142 suites**, zero failures/errors/skips. Prior failure cause remains unconfirmed. These tasks include compilation for their test targets; no fresh standalone lint, APK packaging, connected instrumentation or live dual-server result established by this review.

**Metrics:** type/test coverage percentages unavailable; test pass rate is not coverage. Lint count not measured.

## Unresolved questions / qualification

No unresolved product-design question; source findings are actionable. Unresolved evidence: initial five assertion-failure root cause; exact final-tree test provenance; real projectless MainActivity smoke; physical API29/API33+ privacy/permission/IME/TalkBack/adaptive-layout journeys; connected native lifecycle/save-discard journeys; isolated live multi-server/socket/Windows PTY behavior; actual OS process-death uncertain-create restoration. Missing environment evidence is not a source repair or acceptance substitute.
