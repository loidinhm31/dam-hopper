# Native Android Agent Hub Hardening — Review Cycle 9

## Code Review Summary

**Score: 7/10 — changes requested.** Editor admission/reload, physical preview tiers, exact positive baseline mtime, Workspace serializers and alias-load metadata improved. Two critical admission/navigation findings and one high-priority Workspace routing gap remain in inspected source. Passing tests do not establish their closure.

### Scope
- Requested branch: `feat/ai-os-redesign`; working-tree changes across `native/android-app`.
- Change manifest: **26 tracked files, +900/-266**: 18 production files (+615/-250), eight test files (+285/-16). Inspected patches and relevant callers/supporting sections; approximately 4,000 source/test lines. Not a whole-app security audit.
- Abbreviations: `common/` = `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`; `android/` = `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/`; shared tests reside under `shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/`.
- Applied published development/primary/documentation workflows and manually loaded `code-review/SKILL.md`; read README, native README, PDR/standards, C1–C10, plan/P08, Cycle 8 review and Cycle 3 tester report.
- Only this report written. **Updated plans: none**, preserving explicit report-only ownership/no task tracking. Existing administrative closure is not technical acceptance; P08 unchecked qualification tasks remain unchanged.
- Findings below are high-confidence static source observations. Runtime impacts are **[INFERENCE]**, not reviewer reproductions. LSP unavailable: no configured servers.

### Remediation disposition

| Cycle 8 item | Cycle 9 source/evidence disposition |
|---|---|
| C-01a Workspace opening | Root-file constructor repaired (`FileScreens.kt:345–351`); wildcard holder lookup and named FS serializers repaired. **Incomplete end-to-end:** capability actions still do not commit the requested Workspace route; project-holder fallback persists (H-01 below). |
| C-01b Hub terminal admission | `HubTerminalRow.profileId` reaches UI actions. **Not closed:** project rows check only connection existence; free rows never switch profile or verify runtime/instance (C-01 below). |
| C-02 identity / H-01 physical previews | **Source repair present.** Demotion only for `!tier.isReadOnly && fileIdentity == null`; reload applies the same predicate. IMAGE/VIDEO/BINARY remain physical tiers. Existing write denials preserved. |
| C-03 mtime | **Source repair present.** `doc.serverMtime > 0L && serverMtime == doc.serverMtime` (`ProjectWorkspaceState.kt:412–415`). Shared canonical denial remains; duplicate holder-local denial state remains a maintainability warning. |
| C-04 retirement | **Source wiring present.** Android/test documents call `onDisposalEligible` on final lease/save release; registry installs callbacks for retired entries. Production saves release tracking in `finally`. Actual native suspended-save boundary evidence remains incomplete. |
| C-07 notifications | **Partial.** Settings/workspace-target requests invalidate epoch; notification admission cancels pending Agents work; terminal route rechecks live after profile persistence. Atomic admission, generic post-suspension validation and competing manual-intent invalidation remain incomplete (C-07 below). |
| W-01 reopen/presentation | Cross-profile reopen no longer selects the active profile's terminal. Same-profile reopen remains raw-ID/unverified; snapshot pin/hidden projections still strip qualification. |
| W-02 create response | Matching ID, positive exact ULong, alive predicate and UUID-shaped epoch required before settlement. Missing `alive` still defaults true; optional-store bypass remains. |
| W-06 alias metadata | **Source repair present.** Initial `openTab` passes actual `result.size` and MIME into `SuccessorLoadMetadata` (`EditorTabsState.kt:731–744,472–479`). |
| W-08 tests | Tester reports **1,305/1,305 passed**, zero failures/errors/skips, 142 suites. Added reload and all-three-tier assertions inspected. This is execution evidence, not coverage of missing production admission/lifetime cases. |

## Critical issues

### C-01 — Hub SelectTerminal still lacks exact admission; free terminal does not switch profile

**Evidence:** `android/platform/workspace/NativeWorkspaceViewModel.kt:1979–2021`; `common/features/workspace/AgentHubModels.kt:17–30,80–85`; `common/ui/screens/DamHopperMobileApp.kt:1248,1266`; `common/ui/flow/AppFlowNavigation.kt:274–280,371–415`.

- Project-row `revalidate` is exactly `conn != null`. No comparison to captured generation, endpoint, authenticated account, socket, current terminal inventory, project/worktree or incarnation after dirty confirmation. Constructing `requiredKey` records an intent; it does not authorize it.
- Free rows now preserve their profile, but the `target == null` branch calls `selectSession` on the existing flow without changing its profile/project. It then mutates a holder found for the requested profile, which need not be the visible holder. There is no runtime validation or profile switch in this branch.
- Project-holder lookup remains first matching profile/project/worktree without endpoint/account/retired-owner qualification. Screen-side exact-instance fencing is useful defense in depth, but does not make these route/holder mutations verified.

**Impact [INFERENCE]:** stale Hub rows can change route after owner/session replacement; clicking profile B's free terminal while viewing A leaves the UI on A, with a B-qualified required instance and potentially a hidden B holder selection. This is not the claimed cross-profile routing behavior. **Confidence: high. Contracts C2/C6/C8.**

**Correction:** carry the row's structured current owner/socket/instance qualification into admission; refresh and validate exact terminal metadata after consent; publish profile, route and exact holder selection together. Reuse the existing gated admission pattern in `TerminalAgentsActivationCoordinator.kt:295–395` / `ProfileRepository.commitExistingProfileRoute`, rather than treating a nonnull connection or required-instance field as validation. Cover same-ID multi-profile free rows and replacement during consent through the actual action handler.

### C-07 — Notification routing remains split and does not spend every newer manual intent

**Evidence:** `android/platform/workspace/NativeWorkspaceViewModel.kt:1239–1243,2013–2019,2193–2230,2264–2309`; `common/ui/flow/AppFlowNavigation.kt:274–280,353–364,417–431`; `common/features/profiles/ProfileRepository.kt:137–140,161–180`; `android/platform/workspace/RetainedTerminalAgentsCoordinator.kt:134–138`; existing atomic leaf `TerminalAgentsActivationCoordinator.kt:382–411`.

1. **Newer manual selection can lose.** Free-terminal Hub selection and ordinary terminal selection call `selectSession`, which intentionally does not invoke the invalidator. Manual Agents activation goes directly through its verified admission, also without advancing `notificationRouteEpoch`. A notification suspended in resolution/profile persistence therefore remains current after these newer intents and can overwrite them. Cancellation currently works in the notification-to-Agents direction, not both directions.
2. **Profile and route remain non-atomic.** `selectProfile` publishes `_activeProfileId` before suspending storage, then `routeNotification` separately checks epoch/live state and commits route. Supersession or persistence failure can leave the selected repository profile changed without its matching flow route. `commitVerifiedTerminalRoute` explicitly requires authority gates held by its caller; this caller holds none of the existing profile/registry/socket/reducer admission transaction.
3. **Generic notifications retain a post-suspension gap.** After `selectProfile` returns, only the navigation epoch is checked before `onProfileAuthenticated`; owner generation/reachability/auth are not rechecked there. The added terminal post-profile `checkLive` does not repair this generic branch.

**Impact [INFERENCE]:** older notification work can overwrite newer terminal/Agents intent; stale generic notification can commit after owner change; profile and visible route can split on cancellation/failure. **Confidence: high. Contracts C2/C7/C8.** No backend authorization bypass demonstrated.

**Correction:** invalidate pending notification routing at actual user-intent entry points, not attachment/session-report synchronization callbacks. Use the existing exact owner admission and non-suspending profile+route+selection publication; persistence follows the committed transaction. Revalidate generic targets after suspension. Add deterministic delayed-resolution, competing-Agents, owner-retirement and failing-persistence tests. Do not restore unconditional invalidation in `selectSession`: the tester's historical failure correctly shows why intent and synchronization must be distinguished.

## High priority finding

### H-01 — Workspace capability action can mutate a hidden holder without opening Workspace

**Evidence:** `android/platform/workspace/NativeWorkspaceViewModel.kt:1210–1222,2105–2115,2126–2148`; visible holder selection `common/ui/screens/DamHopperMobileApp.kt:345–379`; `common/features/files/FileTreeState.kt:212–233`; `common/features/workspace/WorkspaceFileOwner.kt:37–42`; `common/features/files/FileRepository.kt:63–68`.

Wildcard lookup is repaired, but Workspace `OpenFiles` / `OpenEditor` never clear the active project or select the requested profile in navigation. If a retained `"*"` holder exists while a project is visible, actions change the hidden Workspace holder; root rendering still resolves the project holder. If none exists, fallback uses the active project holder. Its Workspace tree reset retains the original project target (`target to "Workspace Root"`), and Workspace editor open sends `project="*"` to a project-bound repository, which rejects that mismatch.

**Impact [INFERENCE]:** Workspace capability clicks can appear ineffective, show project contents under Workspace labeling, or fail editor load instead of opening the requested authority. Constructor and serializer fixes alone do not close C-01a. **Confidence: high. Contracts C1/C3/C4.**

**Correction:** admit and commit the exact projectless profile/route before resolving/creating its Workspace holder. Do not fall back to an unrelated project holder. Regress project → Workspace Files/Editor with and without a retained wildcard holder, plus the real root-file click path.

## Warnings / medium priority improvements

1. **W-01 — raw-ID reopen/projections remain.** `NativeWorkspaceViewModel.kt:1371–1372,2060–2070`: snapshot sets discard profile prefixes; same-profile reopen selects raw ID on the active holder without the row's project/socket/incarnation. Keep qualification through presentation and route reopen through exact admission. Cross-profile non-mutation improvement acknowledged.
2. **W-02 — create success still accepts omitted alive; optional persistence remains.** `TerminalModels.kt:10–21`; `TerminalRepository.kt:113–151`: missing `alive` deserializes to `true`, allowing an incomplete response with matching ID/incarnation/epoch to clear uncertainty. Nullable storage still skips reservation/settlement, though inspected active root callers supply storage and account. Require explicit create-success liveness and mandatory persistence on dispatching paths. UUID shape validation is now present; avoid a second policy that validates trimmed text but retains the original. Reuse established epoch policy where applicable (`TerminalModels.kt:155–159`) and avoid compiling a regex per response.
3. **W-08 — boundary coverage remains narrower than names/closure claims.** `EditorSaveRaceTest.kt:449–496` manually acquires a test-document save lease; it does not suspend a production save or unmount Android surface. `ProjectWorkspaceStateTest.kt:444–510` shares a document but attempts denied saves only through ws1, not ws2's empty-local-deny path; `NativeWorkspaceViewModelTest.kt:342–349` proves string keys differ, not action routing. Added `EditorTabsStateTest.kt:869–907` proves identity-less reload stays read-only and all three initial physical tiers survive; it does not mount media/hex renderers. Add focused real-boundary regressions for the remaining findings, alias-open metadata and direct native retired-release settlement rather than asserting full safety from suite count.
4. **C-03 residual — duplicated denial authority/docs.** Shared registry plus holder-local `unauthorizedCanonicalKeys` and `unauthorizedDirtyDocIds` remain concurrent decision sources (`EditorTabsState.kt:424`, `ProjectWorkspaceState.kt:306–315,338–345,415–420`). Conservative denial is safer than a bypass, but lifecycle ownership is harder to reason about. Prefer the existing shared canonical authority as the single decision source, not a new registry/coordinator. `docs/code-standards.md:69` / PDR `:101` still describe dirty-ID-only fencing; docs owner should reconcile after final source decisions.

## Security, performance, architecture, YAGNI/KISS/DRY

- **Security:** identity-less ordinary/overwrite/document-port saves deny; positive exact mtime restored; create settlement rejects wrong ID/zero incarnation/malformed epoch; Workspace wire ports now send explicit Workspace. Remaining principal risk is client authority/navigation consistency, not demonstrated injection or server-auth compromise.
- **Architecture:** no new runtime/service/poller/dependency. Existing canonical registry and verified route gates are appropriate reuse points. Custom partial notification transaction and wildcard branches duplicate authority policy instead of using established boundaries.
- **Performance:** replacement metadata reuses loaded content rather than adding network reads; explicit save/view leases support bounded native-history retirement. No benchmarks run or measured regression claimed. Avoid speculative caching and large cosmetic modularization.
- **KISS/DRY:** one publication predicate for initial/reload identity admission would be clearer than three identical `shouldDemote` branches (`EditorTabsState.kt:462,746,1387`); reuse existing filesystem target projections instead of repeating wildcard serialization across ports. These are follow-on simplifications, not substitutes for the admission fixes.
- **Low priority:** no separate style-only findings.

## Reviewed files

**All 18 changed production files — patch and relevant source:**
- `android/platform/editor/AndroidEditorDocument.kt`
- `android/platform/workspace/NativeWorkspaceViewModel.kt`
- `common/core/model/FilesystemTargetRef.kt`
- `common/features/editor/{EditorDocument,EditorRepository,EditorTabSaveCoordinator,EditorTabsState}.kt`
- `common/features/files/{FileRepository,FileScreens,FileTreeState,FileTreeSubscription,FsWriteCoordinator,TransferCoordinator}.kt`
- `common/features/terminal/TerminalRepository.kt`
- `common/features/workspace/{AgentHubModels,ProjectWorkspaceState}.kt`
- `common/ui/flow/AppFlowNavigation.kt`
- `common/ui/screens/DamHopperMobileApp.kt`

**All eight changed test files — patch/assertions:** Android `platform/workspace/NativeWorkspaceViewModelTest.kt`; shared `features/editor/{EditorSaveRaceTest,EditorTabsStateTest,TestEditorDocument}.kt`, `features/files/FileEditorMutationTest.kt`, `features/workspace/{GitWorkspaceSafetyTest,ProjectWorkspaceStateTest,WorkspaceDepartureTest}.kt`.

**Supporting source excerpts:** `EditorContentLoader.kt`, `EditorScreens.kt`, `WorkspaceFileOwner.kt`, `TerminalModels.kt`, `ProfileRepository.kt`, `ProjectTerminalScreen.kt`, `TerminalAgentsActivationCoordinator.kt`, `RetainedTerminalAgentsCoordinator.kt`, and `ui/flow/AppFlowNavigationTest.kt`.

**Requirements/evidence:** root/native READMEs; `docs/{project-overview-pdr,code-standards}.md`; redesign `{plan,architecture-contracts,phase-08-qualification-docs-handoff}.md`; prior Cycle 8 review; fresh Cycle 3 tester report.

## Validation commands/results

**Reviewer executed, read-only:**
- `git diff --stat -- native/android-app` — 26 files, +900/-266.
- `git diff -- native/android-app/shared/src/commonMain native/android-app/androidApp/src/main` — 18 production files, +615/-250; full patch/relevant source inspected.
- `git diff -- native/android-app/shared/src/jvmTest native/android-app/androidApp/src/test` — eight test files, +285/-16; full patch/assertions inspected.
- Static read/grep tracing of actual action, publication, profile and retirement boundaries. Focused `TODO|FIXME|runBlocking` search in `EditorTabsState`, `ProjectWorkspaceState`, `NativeWorkspaceViewModel`: no matches; not a whole-app claim.
- LSP status: **no configured language servers**.
- **No reviewer build/test/lint/formatter/device commands**, preserving main/check-owner execution ownership and avoiding re-running reported failures. Findings were not reproduced by executing product paths.

**Tester-reported, not reviewer execution:** [Cycle 3 tester report](tester-261108-1453-android-agent-hub-hardening-cycle-3.md), lines 8, 30–45, 52–76:

```text
cmd.exe /c gradlew.bat --no-parallel -Dkotlin.daemon.jvmargs="-Xmx6144m" -Dorg.gradle.jvmargs="-Xmx6144m" :shared:jvmTest :androidApp:testDebugUnitTest --rerun-tasks
```

Latest invocation: **BUILD SUCCESSFUL**, 44 tasks executed; shared **1,048/111 suites**, Android **257/31 suites**, combined **1,305/1,305 passed**, zero failures/errors/skips. Earlier invocation's `AppFlowNavigationTest...InvalidatesAtRequestTime...` failure (expected 4, observed 5) remains recorded; later pass followed removal of unconditional `selectSession` invalidation. This historical failure was not rerun by reviewer. Unit-task compilation is not fresh APK packaging, lint, instrumentation, live multi-server or device qualification. Tester report supplies no exact reviewed-tree source fingerprint.

**Metrics:** two critical findings, one high, four warnings; type/test coverage percentages unavailable; lint issues unmeasured. Pass rate is not coverage.

## Recommended actions

1. Close actual Hub terminal owner/socket/instance admission, including free cross-profile rows.
2. Make competing notification/manual intent cancellation bidirectional and reuse atomic profile/route publication with persistence afterward.
3. Commit exact Workspace capability navigation; remove project-holder fallback.
4. Add meaningful boundary regressions and explicit create-response liveness; reconcile documentation claims after source settles.
5. Main/check owner: after any repair and stopped writers, run affected focused regressions, then the coherent two-task Gradle command above. Packaging/lint/instrumentation/live/device gates remain separately scoped; do not rerun historical failure solely to confirm it.

## Unresolved questions / evidence

No unresolved product-design question. The supplied blanket remediation-closure claim is not supported by the inspected C-01b/C-07/Workspace action implementations. Remaining evidence: exact reviewed-tree test fingerprint; actual MainActivity Workspace/free-terminal smoke; production suspended-save/native unmount and final disposal; API29/API33+ permission/privacy/IME/TalkBack/adaptive journeys; isolated multi-server/socket/Windows PTY behavior; OS process-death uncertain-create restoration. Existing device/container qualification blockers remain open, not synthetic passes.
