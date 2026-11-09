# Native Android Agent Hub Hardening — Review Cycle 8

## Code Review Summary

**Score: 6/10 — changes requested.** Shared canonical denial and native retirement settlement are substantive improvements. However, source does not support the claim that every remediation is complete: projectless file opening still constructs an invalid target; Hub terminal admission remains weak; identity-less reload becomes editable; notification admission is still non-atomic. New tier demotion also breaks media/binary presentation.

### Scope
- Requested branch: `feat/ai-os-redesign`; working-tree changes across `native/android-app`.
- Change manifest: **23 tracked files, +784/-243**. Production/test patches plus relevant callers and requirements inspected; approximately 3,500 source/test lines and supporting excerpts, not a full application/security audit.
- `common/` below = `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`; `android/` = `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/`; shared test names = corresponding `shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/` paths.
- Loaded published primary/development/documentation workflows, `code-review/SKILL.md` and verification reference; PDR/standards, C1–C10, plan/P08, Cycle 7 and fresh Cycle 2 tester evidence.
- Only this report written. No implementation/tests/plan/task-state edits; administrative closure intentionally unchanged. Existing plan closure is not technical acceptance.
- Findings are high-confidence static source observations; runtime impacts below are **[INFERENCE]**, not reviewer reproductions. No configured LSP server; source tracing used.

### Remediation disposition

| Item | Cycle 8 result |
|---|---|
| C-01 projectless | **Partial.** Nonblank wildcard restores root construction; explicit Workspace tree state and read/write selectors present. File-open constructor, holder lookup and remaining serializers incomplete. |
| C-01 terminal admission | **Open.** Required incarnation recorded, not validated; free rows still lose profile ownership. |
| C-02 identity | **Partial.** Initial text admission read-only and all write guards deny missing identity. Reload bypasses admission policy; read-only physical tiers incorrectly collapse to LARGE. |
| C-03 canonical authority | **Core repair present.** Shared registry deny set consulted by tab/overwrite/document ports. Identity/mtime checks restored; zero-mtime exception and duplicate holder-local state remain. |
| C-04 retirement | **Source repair present.** Exact-document production save leases use `finally`; retired documents receive disposal callbacks on final native release. Production-boundary regression evidence remains incomplete. |
| C-07 notifications | **Partial.** Epoch fencing helps some navigation; fresh resolution precedes commit; profile selected first. No atomic owner/profile/route admission, complete navigation invalidation or post-profile-suspension live check. |
| W-01 presentation/reopen | **Partial.** Cross-profile reopen no longer selects active profile's terminal; raw snapshot projections/free-row identity and unqualified same-profile reopen persist. |
| W-02 create response | **Main requested predicate present.** Matching ID, alive, positive ULong and nonblank PTY epoch required before removal. UUID validity/default-alive/null-store caveats remain. |
| W-06 metadata | **Partial.** Alias-open now carries metadata, but size is UTF-16 character count and MIME omitted; reload path carries actual load values. |
| W-08 tests | **Partial.** Initial identity admission covered; tests still do not exercise the named production boundaries. Green execution is not evidence those missing cases pass. |

## Critical issues

### C-01a — Workspace opening still crashes; wildcard lookup and serializer cutover incomplete

**Evidence:** `common/features/files/FileScreens.kt:345-351`; `common/core/model/ProjectTargetRef.kt:29-35`; `common/ui/screens/DamHopperMobileApp.kt:362-379`; `android/platform/workspace/NativeWorkspaceViewModel.kt:1210-1216,2101-2142`.

- Workspace root file outside a registered project still executes `ProjectTargetRef(project = "")`. Constructor requires nonblank. Restoring `"*"` in root construction does not repair this click path.
- Projectless holders now have project `"*"`, but Workspace Files/Editor search `it.project.isBlank()`. Fallback `activeWorkspaceStateOwner()` returns null when navigation has no active project. Thus those actions cannot find the projectless holder; from an existing project they can instead mutate a project holder without committing the requested workspace route. Editor opens with `ws.target`, not the requested Workspace authority.
- Partial wildcard serialization is inconsistent: `FileRepository.kt:77-83,109-141,215-221` and `FsWriteCoordinator.kt:82-85` send Workspace, while `FileRepository.kt:356-364`, `FileTreeSubscription.kt:296-300`, `TransferCoordinator.kt:68-73,258-265` still send `{type:"project",project:"*"}` for mutation/subscription/upload/encrypted put. C3 explicitly requires all applicable ports, not read/write alone.

**Impact [INFERENCE]:** root-file click throws; projectless capability actions no-op or operate on the wrong retained holder; workspace mutation/transfer requests use the wrong authority selector. **Confidence: high. C1/C3/C4.**

**Correction:** retain nonblank constructor invariants but carry the existing explicit Workspace target through file-open/action/port boundaries; resolve and commit the exact visible holder. Migrate remaining serializers using the existing target projections, not additional scattered wildcard branches. Regress real projectless holder creation, root-file click and outgoing envelopes.

### C-01b — Hub terminal click still admits an unverified/wrong-profile row

**Evidence:** `android/platform/workspace/NativeWorkspaceViewModel.kt:1301-1355,1975-2016`; `common/features/workspace/AgentHubModels.kt:17-30,79-87`; `common/ui/screens/DamHopperMobileApp.kt:1248,1266`.

Project-row consent continuation revalidates only `conn != null`. It does not compare captured generation, endpoint, account, socket or current terminal incarnation. Creating `requiredKey` from the action is not validation. Free rows carry no independent profile; UI substitutes the active snapshot profile, although inventory aggregates all connected profiles. Free-row handler selects a session without switching profile/project. Subsequent holder selection is also raw-ID based.

**Impact [INFERENCE]:** stale rows can route after owner/session replacement; equal-ID free terminals across profiles can select a different server's terminal. **Confidence: high. C2/C6/C8.**

**Correction:** retain owner/socket/instance qualification on each row and invoke existing verified admission after consent, including exact current inventory and profile/holder selection. Do not authorize through ambient snapshot profile or a stored required key alone.

### C-02 — Reload restores writable identity-less documents

**Evidence:** `common/features/editor/EditorContentLoader.kt:89-104`; `EditorTabsState.kt:726-749,1360-1399`; negative test `EditorTabsStateTest.kt:835-867`.

Initial unidentified text is correctly demoted to LARGE/read-only. On `reloadTab`, the loader again returns physical NORMAL/DEGRADED with null identity. Its fallback canonical key still matches. Because the current tab is LARGE, the tier-change branch creates a successor with `readOnly = res.tier.isReadOnly` (false), then publishes physical tier through replacement metadata. This path never applies initial admission's identity gate.

**Impact [INFERENCE]:** reload of an unidentified file produces an editable, unsavable baseline, reopening the C4 invariant failure despite write guards. **Confidence: high. C4.**

**Correction:** apply one identity/editability admission policy before every document publication/replacement, including reload. Preserve ordinary/overwrite/document-port denial. Extend the existing missing-identity test to reload, edit refusal and successor metadata; include invalid identity and unknown owner epoch.

### C-07 — Notification epoch does not close navigation/owner admission

**Evidence:** `android/platform/workspace/NativeWorkspaceViewModel.kt:1237-1239,2186-2300`; `common/ui/flow/AppFlowNavigation.kt:102-107,273-279,352-363,370-413,421-429`; `common/features/profiles/ProfileRepository.kt:137-140,161-180`; existing admission example `android/platform/workspace/TerminalAgentsActivationCoordinator.kt:295-305,328-395`.

- Notification admission increments only its own epoch; it does not cancel pending Agents activation. Verified manual activation likewise does not advance the notification epoch. Either continuation can overwrite the other's newer intent.
- Hub `requestWorkspaceTarget`, terminal `selectSession`, and Settings opening do not invoke the ordinary-navigation invalidator. A later Hub selection can therefore leave a suspended notification current.
- Last `checkLive` precedes suspending `selectProfile`. After that suspension only navigation epoch is checked, not connection/account/socket/terminal authority. Generic routing has the same post-suspension gap.
- `selectProfile` publishes active profile before suspending persistence; route commits separately afterward. Persistence failure/supersession can leave profile changed without matching route. `commitVerifiedTerminalRoute` explicitly assumes its caller already holds admission gates, but this caller holds none. Existing `commitExistingProfileRoute` and gated mutation-only leaf are not used.

**Impact [INFERENCE]:** older work wins over newer user/Agents navigation; owner changes during profile selection can still commit stale routes; profile/route state can split. **Confidence: high. C2/C7/C8.**

**Correction:** spend competing activation at intent admission and invalidate on every actual superseding user action. Use the existing exact profile/registry/socket/terminal admission transaction with non-suspending profile+route+selection publication; persistence/effects afterward. Revalidate after every suspension rather than moving the race earlier.

## High priority finding

### H-01 — Initial open converts every preview-only tier to LARGE

**Evidence:** `common/features/editor/EditorTabsState.kt:460-475,731-739`; `EditorRepository.kt:38-48`; `FileTierPolicy.kt:23-27`; `EditorScreens.kt:250-291`.

`isEditable = identity != null && !tier.isReadOnly`; every false result becomes LARGE. This includes verified BINARY and all IMAGE/VIDEO results, not just unidentified editable text. Preview-only loads intentionally return no content identity and empty text. UI dispatches on tier, so image/video preview and binary hex branches are bypassed in favor of an empty large-file view.

**Impact [INFERENCE]:** normal initial image/video/binary opening loses its intended renderer. **Confidence: high.**

**Correction:** preserve physical read-only tiers; demote only otherwise-editable unidentified text, e.g. `if (result.tier.isEditable && result.fileIdentity == null) LARGE else result.tier`. Apply consistently to tab/session/replacement metadata. Add initial-open tier/renderer assertions for IMAGE, VIDEO, BINARY and unidentified NORMAL/DEGRADED.

## Warnings / medium priority improvements

1. **W-01 — qualification still stripped/reopen still unverified.** `NativeWorkspaceViewModel.kt:1340-1341,1367-1368,2056-2067`: raw-ID compatibility branches and `substringAfter(":")` projections remain. Same-profile reopen selects raw ID on the active holder without target/socket/incarnation validation; other-profile reopen only unhides. Preserve structured row qualification and route reopening through exact admission. Cross-profile non-mutation repair is acknowledged.
2. **W-06 — alias-open metadata is not exact.** `EditorTabsState.kt:444-475,384-392`: metadata supplies `size = content.length.toLong()` and no MIME, though `openTab` has actual `result.size`/`result.mime`. Character count is not UTF-8/server file size; range content is not whole-file size. Surviving aliases receive wrong size and stale MIME. Pass actual load values into the existing metadata object. Regress multibyte text and clean alias-triggered tier change with changed size/MIME/mtime.
3. **C-03 residual — mtime verification has a bypass and authority remains duplicated.** `ProjectWorkspaceState.kt:413-420`: `doc.serverMtime == 0L` grants authority without matching server mtime. Require a known exact baseline or refuse/refresh safely; zero should not silently mean verified-anything. Shared registry is now consulted, fixing the previous cross-holder empty-deny bypass, but holder-local canonical/dirty sets remain additional unsynchronized sources of denial. Prefer the shared canonical authority as the single decision source; avoid adding a second registry/coordinator.
4. **W-02 residual — nonblank epoch is weaker than C6's UUID contract.** `TerminalRepository.kt:111-151`; `TerminalModels.kt:10-21`: malformed nonblank epoch passes; omitted `alive` decodes true; null storage still bypasses persistent admission. The four explicitly requested response predicates and active account wiring are present. Validate original epoch with existing UUID policy and make persistence mandatory for active create dispatch; use explicit required success fields where exact success is claimed. No current active-root null-store exploit established.
5. **W-08 — claimed negative coverage exceeds assertions.** `EditorSaveRaceTest.kt:449-496` manually invokes `beginSaveTracking` on `TestEditorDocument`, never starts a production suspended save or unmounts native surface. `ProjectWorkspaceStateTest.kt:444-510` revokes/rebinds ws1 only and never attempts ws2's denied save or production transport replacement. `NativeWorkspaceViewModelTest.kt:342-349` proves string keys differ, not action/snapshot isolation. Native lifecycle test `AgentHubLifecycleTest.kt:400-413` releases through registry, not direct surface callback. No new regression shown for projectless root-file opening, superseded notification/profile-persistence race, invalid create response settlement, alias-open full metadata, or identity-less reload. Add deterministic tests at these actual boundaries; do not rename simulations as production proof.

## Security, performance, architecture, KISS/DRY/YAGNI

- **Positive:** missing-identity writes deny at all three entry points; shared registry revocation reaches aliases; production save leases release in `finally`; retirement callbacks now settle retired registry entries on direct native release; reload replacement reuses loaded content; exact numeric ULong creation metadata preserved; active constructors bind authenticated account.
- Main risk remains client authority/navigation correctness, not demonstrated backend auth bypass or injection. Backend authorization/CAS does not replace the client contracts.
- No new dependency, runtime, poller or broad subsystem introduced. Prefer existing `FilesystemTargetRef` projections and verified profile-route admission over five parallel wildcard serializers and custom partial notification transaction. Consolidate identity/editability policy at its existing publication boundary.
- Retirement settlement addresses retained native history/reference risk. No measured performance regression or benchmark claim; alias metadata size is a correctness error, not an optimization. Avoid speculative caching/modularization.
- No separate low-priority style findings. Documentation owner should reconcile dirty-ID-only reauthorization claims in `docs/code-standards.md:69` / PDR `:101`, create settlement wording and historical evidence labels after source decisions settle.

## Reviewed files

**All 15 changed production files — patches and relevant source:**
- `android/platform/editor/AndroidEditorDocument.kt`
- `android/platform/workspace/NativeWorkspaceViewModel.kt`
- `common/core/model/FilesystemTargetRef.kt`
- `common/features/editor/{EditorDocument,EditorRepository,EditorTabSaveCoordinator,EditorTabsState}.kt`
- `common/features/files/{FileRepository,FileScreens,FileTreeState,FsWriteCoordinator}.kt`
- `common/features/terminal/TerminalRepository.kt`
- `common/features/workspace/ProjectWorkspaceState.kt`
- `common/ui/flow/AppFlowNavigation.kt`
- `common/ui/screens/DamHopperMobileApp.kt`

**All eight changed test files — patch/assertion review:** Android `NativeWorkspaceViewModelTest.kt`; shared `EditorSaveRaceTest.kt`, `EditorTabsStateTest.kt`, `TestEditorDocument.kt`, `FileEditorMutationTest.kt`, `GitWorkspaceSafetyTest.kt`, `ProjectWorkspaceStateTest.kt`, `WorkspaceDepartureTest.kt`.

**Supporting source excerpts:** `ProjectTargetRef.kt`, `WorkspaceFileOwner.kt`, `AgentHubModels.kt`, `EditorContentLoader.kt`, `FileTierPolicy.kt`, `EditorScreens.kt`, `TerminalModels.kt`, `ProfileRepository.kt`, `FileTreeSubscription.kt`, `TransferCoordinator.kt`, `AndroidEditorSurface.kt`, `TerminalAgentsActivationCoordinator.kt`, `AgentHubLifecycleTest.kt`.

**Requirements/evidence:** root/native READMEs, PDR/standards, redesign `plan.md`, `architecture-contracts.md`, P08 qualification task excerpts, Cycle 7 review and Cycle 2 tester report. Plan/P08 administrative status and unchecked qualification tasks intentionally not rewritten under report-only ownership.

## Validation commands/results

**Reviewer executed, read-only:**
- `git diff --stat -- native/android-app` — 23 changed files, +784/-243.
- `git diff -- native/android-app/shared/src/commonMain native/android-app/androidApp/src/main` — 15 production files, +539/-227; patch/source inspected.
- `git diff -- native/android-app/shared/src/jvmTest native/android-app/androidApp/src/test` — eight test files, +245/-16; patch/assertions inspected.
- Static source reads/searches; focused remediation search found no `TODO`, `FIXME` or `runBlocking` in `EditorTabsState`, `ProjectWorkspaceState`, `NativeWorkspaceViewModel`. This is not whole-app absence.
- LSP status — no configured language servers.
- **No reviewer build/test/lint/formatter/device commands**, preserving main/check-owner execution ownership. Static failure paths above were not executed by reviewer.

**Tester-reported evidence, not reviewer execution:** [Cycle 2 tester report](tester-261108-1453-android-agent-hub-hardening-cycle-2.md), lines 6–8, 26–58:

```text
cmd.exe /c gradlew.bat --no-parallel -Dkotlin.daemon.jvmargs="-Xmx6144m" -Dorg.gradle.jvmargs="-Xmx6144m" :shared:jvmTest :androidApp:testDebugUnitTest --rerun-tasks
```

Current rerun: **BUILD SUCCESSFUL**, 44 tasks executed; shared **1,047/111 suites**, Android **257/31 suites**, combined **1,304/1,304 passed**, zero failures/errors/skips. Prior Cycle 2 failure `EditorRepositoryTest.testLoadNormalFile` (expected NORMAL, was LARGE) is preserved in report lines 47–58; later pass established, causal repair provenance not established by tester. Tests compile their targets; this evidence is not a fresh APK package, lint, instrumentation or live multi-server result. No source hash/exact reviewed-tree fingerprint supplied by report.

**Metrics:** Type/test coverage percentages unavailable; pass rate is not coverage. Lint issues unmeasured. Review findings: four critical groups, one high-priority regression, five warnings; no low-priority style findings.

## Recommended actions

1. Repair exact Workspace opening/holder selection and remaining wire ports; close Hub owner/socket/incarnation admission.
2. Unify initial/reload editability admission without destroying physical preview tiers.
3. Reuse exact atomic profile/route admission and complete current-intent cancellation for notifications.
4. Complete full alias metadata and strict canonical-baseline/create semantics; add the missing deterministic boundary regressions.
5. Main/check owner: after stopped writers, run focused regressions then the coherent two-task Gradle command above; applicable packaging and connected/live qualification remain separate gates. Do not rerun historical failures merely to confirm them.

## Unresolved questions / evidence

No unresolved product-design question blocks the corrections. Remaining evidence: exact reviewed-tree test provenance; historical failure repair provenance; actual projectless MainActivity/file-open smoke; direct native surface release during real suspended saves; API29/API33+ privacy/permission/IME/TalkBack/adaptive journeys; isolated live multi-server/socket/Windows PTY behavior; OS process-death uncertain-create restoration. Existing missing-device/container qualification gates remain open, not new source findings or reasons to claim acceptance.
