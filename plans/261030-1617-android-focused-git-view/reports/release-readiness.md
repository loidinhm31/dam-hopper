# Focused Android Git Release Readiness and Qualification Ledger

- **Date:** 2026-10-30
- **Plan:** `plans/261030-1617-android-focused-git-view/`
- **Target Branch:** `feat/android-native-features`
- **Current Server Target:** `dam-hopper-server` v0.15.3 (current loopback Axum binary)
- **Client Architecture:** Kotlin Multiplatform + Jetpack Compose (`native/android-app`)
- **Overall Release Disposition:** **GATE-C BLOCKED — RELEASE BLOCKED PENDING CONNECTED DEVICE QUALIFICATION** (Predecessor terminal regressions reported resolved in source; connected device journeys not run; missing host `adb`, physical ARM64 hardware, API 29 coverage, and live emulator execution remain open release blockers)
- **Authority:** [phase-08-documentation-release-evidence.md](../phase-08-documentation-release-evidence.md), [contracts.md](../contracts.md), [acceptance-matrix.md](../acceptance-matrix.md), [git-qualification.md](git-qualification.md), [device-qualification.md](device-qualification.md), [request-contract-audit.md](request-contract-audit.md)

---

## 1. Executive Summary

This report synthesizes implementation status, wire contract compliance, independent Git oracle qualification, live current-server smoke testing, and device readiness for the Focused Android Git increment.

The focused Git view (`WorkspacePanel.GIT`) integrates Git capabilities directly into the guided mobile workflow (`ProjectTerminalScreen`) alongside Terminal, Files, and Editor within the single content host. Key architectural deliverables include:
1. **Three Primary Sections & Nested Routes:** Changes (`GitChangesView`), History (`GitHistoryView`), and Branches/Worktrees (`GitBranchesWorktreesView`), with nested commit details dialog (`GitCommitDetailsDialog`) and strictly read-only file diff view (`GitFileDiffView`).
2. **Four Working Identities:** Authenticated logical owner (`profileId`), connection generation (`generation`), workspace project target (`targetWorktree`), and repository root (`root`), preventing cross-profile contamination and stale-generation state leakage.
3. **Pure Ancestry OID Graph Layout:** `GitGraphLayout` computes DAG commit lanes strictly from commit OIDs and parent links; renders linear commits, 2-parent merges, multi-parent octopus merges, skewed timestamps, and stub parents; flat literal search list disables squash.
4. **Safe History Rewrites & Leased Publication:** Differentiates checked-out active branch actions from inactive local branch CAS message edits and oldest-first contiguous squashes; signed commit consent guard; separate leased publication (`/push/prepare` + `/push/publish`) without blind `--force`.
5. **Workspace Safety & Protections:** Worktree removal prechecks verify active PTY inventory and dirty editor buffers across all matching owners; clean-only buffer reload; read-only conflict and stopped operation handoff; secondary root fetch/pull restrictions.
6. **Drop-Ack Safety & Reconciliation:** Mutating requests forward without automatic client retry or offline write queues (observed single forward under fault injection; client does not assert distributed exactly-once execution); authoritative reconciliation executes on refresh (`GitRefreshReason.RECONCILE`).

**Release Disposition:** The increment is **UNIT- AND SMOKE-VERIFIED; RELEASE BLOCKED (GATE-C & CODE REVIEW WARNINGS)**. All 1,168 automated unit tests are reported passing (937 shared JVM + 231 Android unit tests, 0 failures/errors/skips, with predecessor terminal presentation policy regressions resolved in source; reported in `plans/reports/tester-261031-0029-c1-verification.md` and `plans/reports/code-review-261031-0035-android-focused-git-view-cycle-3.md`). Cycle 3 code review scored 6/10 (CHANGES REQUIRED; 0 Critical findings remaining in current changes, but High/Medium warnings W1–W12 remain open including runtime revocation fencing, post-dispatch uncertainty handling, affected-document transactions, and confirmation dialog binding). Connected device qualification is **BLOCKED_PENDING_DEVICE (GATE-C)**; missing host `adb` blocks connected journey execution, and physical ARM64 hardware, API 29 coverage, live emulator execution, and human visual review remain open release gates alongside code review remediations.

---

## 2. Acceptance Criteria Verification Matrix (AC01–AC10)

| ID | Criterion & Invariants | Landed Implementation Components | Verification Suite / Oracle Authority | Result / Disposition |
|---|---|---|---|---|
| **AC01** | Root navigation, sections (Changes/History/Branches), nested details/diff/Back, retention across panel switch/rotation, and IME/keyboard input isolation. | `WorkspacePanel.GIT`, `ProjectTerminalScreen.kt`, `GitPanelScreen.kt`, `GitChangesView.kt`, `GitHistoryView.kt`, `GitBranchesWorktreesView.kt`, `GitCommitDetailsDialog.kt`, `GitFileDiffView.kt`. | `NativeGitWorkspaceJourneys.kt` (`journey01_rootNavigationSectionsBackAndInputIsolation`); Compose state retention tests. | **PASSED (Compile & State Logic); Connected Device Run BLOCKED_PENDING_DEVICE (GATE-C).** |
| **AC02** | Daily changes workflow: staged + unstaged edits on same file, untracked, binary assets, deleted files, empty files; stage, unstage, commit, amend, confirmed discard; terminal refresh; real domain errors. | `GitChangesController.kt`, `GitQueryRepository.kt`, `GitMutationRepository.kt`, `GitStatusModels.kt`. Mutation invalidation runs strictly after server success (`GitOutcomeKind.SUCCEEDED`). | `NativeGitWorkspaceJourneys.kt` (`journey02_dailyChangesStageUnstageCommitAmendDiscard`); `git-workspace-fixture.mjs` Oracle verification (`getStatusPorcelainV2`, `getRevParse`). | **PASSED (Compile & Fixture Oracle); Connected Device Run BLOCKED_PENDING_DEVICE (GATE-C).** |
| **AC03** | Native graph OID edges, parent links, octopus/merge commits, skewed timestamps, upward edges, off-page stubs, and literal search filtering (disabling squash). | `GitGraphLayout.kt`, `GitHistoryController.kt`, `GitCommitRow.kt`, `GitHistoryModels.kt`. Computed per changed dataset; literal search renders flat list and disables squash selection. | `NativeGitWorkspaceJourneys.kt` (`journey03_nativeGraphSearchAndPageBoundaries`); deterministic graph oracle tests; `git log --all --format=%H:%P`. | **PASSED (Compile & Graph Engine); Connected Device Run BLOCKED_PENDING_DEVICE (GATE-C).** |
| **AC04** | Active vs inactive message edit/squash with CAS snapshots; occupancy guards; signed commit consent guard. | `GitHistoryActionController.kt`, `GitRewriteActionController.kt`, `GitCommitMessageEditDialog.kt`, `GitSquashDialog.kt`, `GitRewriteModels.kt`. CAS snapshot matching `expectedBranch` and `expectedHeadOid`; `allowSignatureRemoval` guard. | `NativeGitWorkspaceJourneys.kt` (`journey04_activeInactiveRewritesAndConsentGuard`); `git cat-file -p` signature header oracle verification. | **PASSED (Compile & Consent Guard); Connected Device Run BLOCKED_PENDING_DEVICE (GATE-C).** |
| **AC05** | Separate leased publication after both rewrite types; prepare leased publication snapshot; bare remote drift rejection without `--force`. | `LeasedPublishController.kt`, `GitPublishRepository.kt`, `LeasedPushDialog.kt`, `GitPublicationModels.kt`. Separate `/push/prepare` and `/push/publish` steps with exact remote OID check; zero `--force`. | `NativeGitWorkspaceJourneys.kt` (`journey05_leasedPublicationSeparateFlow`); bare remote verification via independent Git CLI; stale remote abort. | **PASSED (Compile & Publication Logic); Connected Device Run BLOCKED_PENDING_DEVICE (GATE-C).** |
| **AC06** | Worktree create/open/remove/prune; projected mappings and punctuation paths (`wt & spaces + punct # test=val`); dirty editor and active terminal blockers. | `WorktreeMutationController.kt`, `GitBranchWorktreeRepository.kt`, `WorktreeDialogs.kt`, `ProjectWorktreeModels.kt`. Projected path encoding; dirty editor check (`EditorTabsState.isDirtyTarget`); terminal PTY precheck. | `NativeGitWorkspaceJourneys.kt` (`journey06_worktreeCreationProjectedMappingsAndSafety`); `git worktree list --porcelain` oracle check. | **PASSED (Compile & Path Escaping); Connected Device Run BLOCKED_PENDING_DEVICE (GATE-C).** |
| **AC07** | Unsaved editor protections for checkout/discard/switch/destructive history; Cancel preserves drafts; Discard reloads clean. | `WorkspaceGitSafety.kt`, `GitHostPorts.kt` (`withMutationGuard`), `EditorTabsState.kt`. Cancel preserves drafts; clean reload only; dirty documents never overwritten by Git operations. | `NativeGitWorkspaceJourneys.kt` (`journey07_unsavedEditorProtections`); unit mutation guard dispatch/block tests. | **PASSED (Compile & Guard Verification); Connected Device Run BLOCKED_PENDING_DEVICE (GATE-C).** |
| **AC08** | Slow-read/mutation scope isolation; drop-ack handling: no automatic client retry or offline write queue; outcome reconciled on refresh (fault injection observed a single forwarded request; not a distributed idempotence guarantee). | `GitWorkspaceRuntime.kt`, `GitOperationScope.kt`, `GitRefreshReason.RECONCILE`. Monotonic generation and request sequence fencing; single forward observed in fault test; authoritative refresh reconciliation. | `NativeGitWorkspaceJourneys.kt` (`journey08_slowReadAndDroppedAckIdempotence`); `TransparentGitProxy` drop-ack fault injection; audit log assertion. | **PASSED (Compile & Drop-Ack Fault Test); Connected Device Run BLOCKED_PENDING_DEVICE (GATE-C).** |
| **AC09** | Conflict state handoff via `GET /conflicts` and `GET /operation`; terminal recovery guidance; non-Git 409 `GIT_NOT_INITIALIZED` distinct from empty repo. | `GitConflictSummary.kt`, `GitOperationStatus.kt`, `GitQueryRepository.kt`, `GitErrorDialog.kt`. Read-only conflict/operation decoders; terminal recovery banners; zero `POST /resolve` or `POST /operation`. | `NativeGitWorkspaceJourneys.kt` (`journey09_conflictsAndActiveOperationHandoff`); unmerged repository fixture assertions. | **PASSED (Compile & Read-Only Handoff); Connected Device Run BLOCKED_PENDING_DEVICE (GATE-C).** |
| **AC10** | Request inventory compliance: zero calls to forbidden routes (`POST /resolve`, `POST /operation`, secondary fetch/pull); selected root ordinary push without force. | `GitSyncController.kt`, `ApiClient.kt`, `GitHostPorts.kt`. Secondary root fetch/pull visibly disabled with zero wire dispatch; ordinary push root-qualified and fast-forward only. | `NativeGitWorkspaceJourneys.kt` (`journey10_contractAuditZeroSecondaryFetchesAndPush`); `request-contract-audit.md` proxy audit logs. | **PASSED (Compile & Proxy Route Audit); Connected Device Run BLOCKED_PENDING_DEVICE (GATE-C).** |

---

## 3. Unit, JVM, and Local Smoke Test Evidence Summary

| Test Suite / Authority | Command / Target | Scope / Invariants Verified | Result | Failure Ledger / Notes |
|---|---|---|---|---|
| **Node Git Fixture Self-Test** | `node native/android-app/scripts/git-workspace-fixture.mjs --self-test` | Independent Git oracle, complex topologies (staged+unstaged, binary, deleted, empty, renamed, linear, merge, octopus, skewed dates, punctuation worktrees, signed commit headers, conflict repos), proxy drop-ack fault injection. | **PASSED (0 failures)** | None. Validated against external host Git CLI (2.48.1.windows.1). |
| **Current-Server Live Smoke** | `node native/android-app/scripts/git-workspace-fixture.mjs --smoke-current-server` | Live loopback server (`dam-hopper-server` v0.15.3), SQLite auth seeding (`application_e2e_seed`), JWT bearer auth, transparent proxy root discovery, external Git status query. | **PASSED (0 failures)** | None. Smoke evidence verified in isolated directory. |
| **Instrumentation Test Compile** | `./native/android-app/gradlew.bat -p native/android-app :androidApp:compileDebugAndroidTestKotlin` | Complete journey suite (`NativeGitWorkspaceJourneys.kt`) and device test fixtures (`NativeGitServerFixture.kt`). | **PASSED** | Compiled in 2.2s. |
| **Android Debug Unit Tests** | `./native/android-app/gradlew.bat -p native/android-app :androidApp:testDebugUnitTest` | Android platform unit tests, manifest security tests, network security config assertions. | **PASSED (0 failures)** | All Android unit tests passing cleanly. |
| **Shared KMP JVM & Android Tests** | `./native/android-app/gradlew.bat -p native/android-app :shared:jvmTest :androidApp:testDebugUnitTest` | Domain models, ownership, serialization, Git workspace runtime, graph layout, controllers, transport, and platform unit tests. | **1,168 / 1,168 PASSED (0 failures)** | Reported by tester: 937 shared JVM + 231 Android unit tests passing cleanly; `TerminalPresentationPolicyTest` regressions resolved in source. |
| **Debug APK Assembly** | `./native/android-app/gradlew.bat -p native/android-app :androidApp:assembleDebug` | Debug packaging and resource merging for Android target (debug build does not exercise R8/ProGuard code shrinking). | **PASSED** | Built clean APK in 29.2s. |
| **Wire Contract Audit** | Static source audit + `TransparentGitProxy` network audit logs | Verification against frozen wire operation inventory (`contracts.md`). | **PASSED (0 violations)** | Confirmed 0 calls to `POST /resolve`, 0 calls to `POST /operation`, 0 secondary fetch/pull calls, and 0 `--force` flags. |

---

## 4. Historical Limitations Re-Evaluation (H1–H5)

| Historical Defect | Original Problem Statement | Current Architectural Resolution | Qualification Disposition |
|---|---|---|---|
| **H1 (Branch checkout scope sync)** | `GitBranchController.refreshBranches()` cancelled in-flight reloads; history entries not reloaded on checkout, leaving eligibility gated against old branch. | Resolved by `GitWorkspaceRuntime`. Branch mutations emit `GitMutationEvent(impact = GitMutationImpact.REFS)`. Host port triggers coordinated refresh across both `GitBranchController` and `GitHistoryController`, re-evaluating state atomically. | **RESOLVED** |
| **H2 (Repeat identical failure suppression)** | `GitModalsHost` suppressed redisplay of identical error dialogs because `modalState.actionErrorResult` was not cleared on dismiss. | Resolved in contracts. Error state is tracked by monotonically increasing controller-local event identity (`GitMutationEvent` / modal event sequence), ensuring dismissed errors re-present on fresh identical failures. | **RESOLVED** |
| **H3 (Details dialog mutation invalidation bypass)** | File-variant mutations in commit details dialog (cherry-pick-files, revert-files, drop-files) bypassed invalidation hooks and error dialog handling. | Resolved. All file mutations route through `GitHostPorts.withMutationGuard` with `GitMutationImpact.FILES`, which invalidates cached authority and schedules refresh across changes and details view upon completion. | **RESOLVED** |
| **H4 (Premature discard invalidation)** | Discard invalidation hook fired before async request completed and fired on failure. | Resolved. Invalidation and reconciliation occur strictly inside the post-completion callback of `onMutationOutcome` when the server responds with success (`GitOutcomeKind.SUCCEEDED`). | **RESOLVED** |
| **H5 (Query parameter encoding corruption)** | Raw query component encoding left special characters (`& + # =`) unescaped for special worktree paths. | Resolved. All query parameters in `NativeGitServerFixture`, `ApiClient`, and `git-workspace-fixture.mjs` pass through strict URL-encoding (`URLEncoder.encode(..., "UTF-8")` and `encodeURIComponent`), preserving complex worktree path segments. | **RESOLVED** |

---

## 5. Honest Hardware and Device Blocker Ledger (GATE-C)

### 5.1 Host Environment Inventory

| Host Component | Status / Observation | Impact on Release |
|---|---|---|
| **OS / Architecture** | Microsoft Windows 10.0.26200 x64 | Host builds and runs unit/smoke tests. |
| **Android SDK Platform-Tools (`adb`)** | **NOT FOUND IN HOST PATH** | **HARD RELEASE BLOCKER (GATE-C)**. Cannot communicate with Android devices or emulators. |
| **Physical ARM64 Test Device** | **NONE ATTACHED** | **HARD RELEASE BLOCKER (GATE-C)**. ARM64 execution, touch interaction, and hardware keyboard/IME unverified. |
| **Android 10 (API 29) Target** | **NONE AVAILABLE** | **HARD RELEASE BLOCKER (GATE-C)**. Minimum supported SDK runtime behavior unverified. |
| **Android Emulator Instance** | **NONE RUNNING** | **HARD RELEASE BLOCKER (GATE-C)**. Connected instrumentation journeys cannot execute. |

### 5.2 Runner Execution Evidence

- **Script Attempted:** `bash native/android-app/scripts/run-git-workspace-journeys.sh`
- **Exit Code:** `2 (BLOCKED)`
- **Observed Terminal Output:**
  ```text
  === DamHopper Phase 07 Git Workspace Journey Runner ===
  Working directory: /mnt/g/ws/sharing/dam-hopper/native/android-app
  [BLOCKED] ADB command not found in PATH.
  Physical hardware or emulator qualification requires Android SDK platform-tools.
  GATE-C device journeys status: BLOCKED_PENDING_DEVICE
  ```

### 5.3 Open Qualification Gates (Deferred to Hardware Lab)

1. **Physical ARM64 Device Execution:** Verification of UI rendering, native touch targets (min 48dp), memory consumption, and background lifecycle on real ARM64 hardware.
2. **API 29 (Android 10) Minimum SDK Verification:** Verification that Java 17 bytecode desugaring and Jetpack Compose runtime operate correctly on Android 10 without runtime class-not-found issues.
3. **Emulator Execution (API 34/35):** Execution of the full `NativeGitWorkspaceJourneys` 10-journey instrumentation suite against an active Android runtime.
4. **Form-Factor Visual Inspection (Phone vs Tablet Qualification Targets):**
   - *Phone layout target:* Single-column docked Git surface (`GitPanelScreen`), nested full-screen Diff and Details screens with hardware Back and toolbar Back affordances.
   - *Tablet layout target:* Multi-pane master-detail view with persistent Git branch tree, wide graph canvas rendering, and side-by-side hunk diff review.
   - *Visual & Accessibility target:* High-contrast commit graph lane palette (`#4CAF50`, `#2196F3`, `#9C27B0`, `#FF9800`, etc.), screen-reader descriptions on action buttons and commit graph rows (architectural design invariants to be qualified on physical hardware).
5. **Phase 18 & Phase 19 Obligations:** Preserved intact. No synthetic waivers, mock test passes, or fake hardware numbers are recorded.

---

## 6. Safe Rollback Procedures

### 6.1 Principle of Reversibility

**CRITICAL INVARIANT:** Rollback procedures apply **STRICTLY TO THE CLIENT ARTIFACT**.
- **NEVER** run `git reset --hard`, `git push --force`, or destructive Git history commands on the development repository or server repositories.
- **NEVER** drop or mutate server database state (`dam-hopper.db` or Mongo) as a client rollback mechanism.
- **NEVER** kill server daemon processes or disrupt other active sessions.

### 6.2 Client Artifact Rollback Steps
In the event that an assembled debug or release APK exhibiting runtime defects must be rolled back:

1. **Compatible In-Place Reinstall / Downgrade (Persisted State Preserved; In-Memory Drafts Lost):**
   ```bash
   adb install -r -d <path-to-prior-verified-apk>.apk
   ```
   *Alternative via Gradle:*
   Check out prior commit reference or branch containing verified client code and run:
   ```bash
   ./native/android-app/gradlew -p native/android-app :androidApp:installDebug
   ```
   *Prerequisites and constraints:*
   - Requires matching application signing keys (debug keystore or production release key); mismatched signatures will be rejected by Android OS.
   - Requires matching package name and compatible database/schema migrations; `-d` flag permits version code downgrade on supported debuggable platforms, but is not guaranteed for production builds without matching schema compatibility.
   - *Draft warning:* Reinstallation terminates the running app process, which preserves *persisted* SharedPreferences and Keystore credentials, but discards unsaved in-memory editor drafts or transient terminal input.

2. **Temporary Cache Clearing (Does Not Roll Back Binaries or Retain Drafts):**
   - Navigate to **Android System Settings → Apps → DamHopper → Storage → Clear Cache**.
   - *Effect:* Cleans volatile image/HTTP cache files. Note that clearing cache does not recover an older binary, repair schema defects, or preserve process-local in-memory drafts.

3. **Destructive Client Artifact Uninstall / Data Wipe (Data Loss Warning):**
   - **WARNING:** Uninstalling the app or selecting "Clear Data" permanently destroys all client-side private storage (`/data/data/dev.damhopper.nativeapp/`), wiping Android Keystore master keys, saved server profile tokens, and all unsaved editor drafts.
   ```bash
   adb uninstall dev.damhopper.nativeapp
   ```
   - Or navigate to **Android System Settings → Apps → DamHopper → Storage → Clear Data / Clear Storage**.
   - Destroys client credentials; does not alter server state or server-side Git repositories.

4. **Verify Server & Repository Integrity Post-Rollback:**
   - Verify that the server daemon remains healthy:
     ```bash
     curl -s http://127.0.0.1:4803/api/system/health
     ```
   - Compare server Git repositories against the pre-rollback captured commit and ref baseline (do not assume an unconditionally clean tree if earlier operations were in flight):
     ```bash
     git -C <repo-path> status --porcelain=v2
     git -C <repo-path> log -n 5 --oneline
     git -C <repo-path> rev-parse HEAD
     ```
   - Reconnect the rolled-back client to the server using standard profile login and re-authenticate.
