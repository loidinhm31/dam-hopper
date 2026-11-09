# Native Android Agent Hub Redesign — Implementation Handoff & Qualification Report

**Date:** 2026-11-08  
**Status:** Approved with noted issues after 3 code review cycles (explicit user approval; technical acceptance, safety invariant verification, and release qualification remain open)  
**Repository Root:** `G:/ws/sharing/dam-hopper`  
**Native Android Client:** `native/android-app`  
**Implementation Plan:** `plans/261107-0305-android-agent-hub-redesign/plan.md`  

---

## 1. Executive Summary & Delivery Scope

The Native Android Agent Hub Redesign adapts the native Android client (`native/android-app`) to current web Agent Hub, filesystem, session, Settings, and notification semantics without adopting the desktop OS windowing or 12-panel dormant shell.

### Architectural Deliverables (Phases P01–P08)

1. **Agent Hub Primary Stage (`AppFlowStage.HUB`):**
   - Replaces the legacy three-stage linear flow with a 2-stage mobile model: `PROFILE_LOGIN` → `HUB`.
   - Primary `AgentHubNavigator` observes attached profile runtimes without synthetic keepalives or auto-connections.
   - Provides workspace project/worktree grouping, zero-session open references, persistent pins, hidden session states, and qualified jump-to-session routing.

2. **Two-Row Chrome Architecture:**
   - **Row 1 (Context & Status Header):** Displays profile and project/worktree context with header triggers for unread notifications (badged bell), Settings gear, and visual Cognito Privacy Mode toggle. Pinned at top and visible across soft keyboard appearances (`adjustResize`).
   - **Row 2 (Docked Capability Navigation Row):** Single-line horizontal docking row with **Terminal**, **Files**, **Editor**, and **Git** (`WorkspacePanel.GIT`). Enforces minimum 48dp touch targets and zero multi-row wrapping.
   - **Adaptive Hub Navigator:** Responsive rail (>=360dp width) on wide/tablet/landscape viewports vs dismissible modal sheet with scrim on compact mobile viewports.

3. **Canonical Document Registry & File Leases (Phase P06):**
   - Explicit filesystem target discrimination: `FilesystemTargetRef.Workspace` (canonical browse root authority) vs `FilesystemTargetRef.Project(name, worktreePath)`.
   - Open document leases under retained owner keyed by `(profileId, endpoint, account, workspaceId, workspaceEpoch, canonicalPath)`.
   - In-memory dirty buffers and undo/redo stacks shared across route aliases without duplicate buffers.
   - Safe-save CAS mtime protection (`baselineMtime`), clean auto-reload, and dirty-departure guards (`DepartureRequest`).

4. **Guarded PTY Lifecycle (Phases P02, P03, P07):**
   - Fail-closed terminal lifecycle with guarded backend termination via atomic `POST /api/terminal/{id}/terminate` gated by manager-lifetime UUID epoch (`X-DamHopper-PTY-Epoch`) and positive u64 `incarnationExact`.
   - Clean separation of presentation-only `Close View` (local surface disposal, retaining server PTY) from destructive `End Session` backend process termination.
   - Persistent uncertain-create records across process recreation, blocking duplicate replacement until settled.
   - Replay gate byte reconciliation (`reconcileTerminalOutput`) with outbound query suppression preventing terminal echo loops.

5. **Notification Delivery Architecture (Phases P05, P07, Phase 17):**
   - In-memory attention feed bounded to 50 history entries and 3 transients.
   - Fenced admission: live semantic attention only (OMP and runtime-qualified Claude; Codex is status-only), with silent baseline snapshot; reconnects, revision gaps, snapshots, and replay reconcile silently.
   - Single-use token-qualified activation (`coordinator.activate(token)`).
   - Three private Android notification channels: `channel_terminal_attention` (High), `channel_transfers` (Low), and `channel_idle_suspend` (High) with `Notification.VISIBILITY_PRIVATE` and generic lock-screen text.
   - User-initiated API 33+ permissions (`POST_NOTIFICATIONS`); in-app Cognito visual and input protection.

6. **Retained Settings Scopes (Phase P04):**
   - Three distinct scopes: `This Device` (local preferences, theme, font scaling, terminal accessory keyboard, scroll step bounded 1..50), `Preference Source A` (remote user preferences, sparse patches with JSON null unbind serialization), and `Admin Target B` (system daemon config, remote idle suspend, SSH keys).
   - Destructive workspace root switch warning dialog with PTY disposal protection.

---

## 2. Automated Test Verification Evidence

Automated suites were executed in a forced rerun on 2026-11-08 with zero test failures:

| Gate | Command / Target | Scope | Result | Status |
|---|---|---|---|---|
| **JVM Unit & Integration** | `:shared:jvmTest` | 111 test suites | **1,044 / 1,044 passed** (0 failed, 0 skipped) | **PASS** |
| **Android App Unit** | `:androidApp:testDebugUnitTest` | 31 test suites | **255 / 255 passed** (0 failed, 0 skipped) | **PASS** |
| **Combined Unit Total** | Both Tasks | 142 test suites | **1,299 / 1,299 passed** (0 failed, 0 skipped) | **PASS** |
| **Debug APK Packaging** | `:androidApp:assembleDebug` | Debug build variant | **BUILD SUCCESSFUL** (debug APK produced) | **PASS** |
| **Test Compilation** | `:androidApp:compileDebugAndroidTestKotlin` | Instrumented test sources | **BUILD SUCCESSFUL** (0 compilation errors) | **PASS** |
| **Git Fixture Oracle** | `git-workspace-fixture.mjs --self-test` | Safe Git operations | **12 / 12 assertions passed** (0 failed) | **PASS** |

*Note on test scope:* The 1,299 passing tests represent the multiplatform shared JVM and Android application debug unit suites. They do NOT represent physical-device instrumented execution or live multi-server runtime validation.

---

## 3. Authoritative Code Review Findings Ledger (Cycle 3)

The independent Code Review Cycle 3 (`plans/reports/code-review-261108-0225-android-agent-hub-redesign-cycle-3.md`) evaluated the full implementation against contracts C-01 through C-08 with a score of **5/10** and a reviewer technical disposition of **changes requested**. Following this review, the user explicitly approved proceeding as **Approved with noted issues**. The 7 critical issues and 7 warnings are tracked as open technical debt:

### Critical Issues (7)

1. **C-01 — Rendered Hub Row Actions miss Active Hub Contract:**
   - *Evidence:* Clicking a rendered terminal row searches an owner only within `selectedProject`, dropping the row's exact project/worktree/profile. From a project-null Hub, owner lookup returns null and the row fails to activate. Files and Editor open the project picker when project is null; Editor dispatches `OpenFiles`.
   - *Target remediation:* Route captured qualified rows through verified activation; retain workspace-scoped Files/Editor stage and distinguish capability selection from explicit creation.
2. **C-02 — Editable Reads Manufacture Identity on Missing Server Identity:**
   - *Evidence:* `loadFullText` publishes editable success when server `fileIdentity` is null/invalid. `resolveCanonicalKey` builds fallback path with guessed epoch zero, giving write authority to unverified baselines.
   - *Target remediation:* Validate same-response workspace ID, epoch, and canonical path before editable publication; fail closed or downgrade to read-only.
3. **C-03 — Reconnection Rebinds Retained Dirty Documents without Fresh Baseline:**
   - *Evidence:* Rebinding repositories to the same nullable owner clears `_isAuthorityRetired` without reading and matching each retained document's canonical baseline against the server.
   - *Target remediation:* Keep document write authority revoked until a fresh authorized read confirms the canonical identity matches.
4. **C-04 — Explicit Discard Settlement Rejects Dirty Document Disposal:**
   - *Evidence:* `pruneDocument(forceDiscard=true)` checks `canDispose`, which always rejects dirty documents; discarded dirty documents retain in-memory references and never receive deterministic `close()`.
   - *Target remediation:* Track disposal ownership through view/save settlement; close discarded dirty documents once views unmount.
5. **C-05 — Dirty-Departure Dialogs Mount in Separate Unmasked Windows:**
   - *Evidence:* Both departure `AlertDialog` branches mount in separate system windows outside the in-content Cognito privacy overlay, exposing private file paths and unmasked buttons.
   - *Target remediation:* Omit or independently mask every separate dialog window while privacy is active.
6. **C-07 — Notification Commit Relies on Cached Authority After Consent:**
   - *Evidence:* Authoritative terminal existence is fetched before dirty-departure consent. The post-consent callback checks cached reducer state rather than fresh server inventory, dropping the resolved incarnation.
   - *Target remediation:* Perform fresh authoritative resolution after consent and commit the exact captured incarnation.
7. **C-08 — Target Commit Validation Accepts Replacement Connections/Accounts:**
   - *Evidence:* Post-consent project target callbacks only verify `getCurrentConnection != null`, without matching the captured connection generation, endpoint, or logical owner.
   - *Target remediation:* Capture exact connection generation and authenticated owner on request start; reject changed owners after consent.

### Warnings (7)

1. **W-01 — Unqualified Hub Presentation State:** Raw session IDs used in pin/hidden sets across profiles.
2. **W-02 — Uncertain-Create Admission Gaps:** Timestamp intent IDs used instead of strict UUIDs; blanket 4xx clears uncertainty.
3. **W-03 — Inferred Termination Support:** Version header advertisement (`X-DamHopper-Termination-Version: 1`) not required before enabling End Session UI.
4. **W-04 — Command Rename/Delete Reconciliation:** Merging remote config preserves obsolete original represented keys.
5. **W-05 — Duplicate Upload Target Selectors:** `FsUploadBegin` sends nested target plus flat selectors.
6. **W-06 — Redundant Document Serialization:** Reading mtime and session reconstruction serializes buffers repeatedly.
7. **W-07 — Qualification Documentation Labeling:** Historical mock/oracle tests labeled as disposable live runtime in earlier reports.

*(Note: Critical C-06 — Exact worktree session filter and creation payloads — was confirmed addressed in inspected source).*

---

## 4. Open Release Qualification Gates

The following release qualification gates remain strictly open and unexecuted:

1. **Connected Physical Device Execution (`GATE-C`):**
   - **Status:** **`BLOCKED_PENDING_DEVICE`** (0 connected physical devices or emulators observed via `adb devices`).
   - **Prerequisites:** Physical ARM64 device running Android 10+ (API 29) and Android 13+ (API 33+).
   - **Required Journeys:** `AgentHubRootJourneys`, `RetainedWorkspaceLifecycleTest`, `NativeEditorExplorerJourneys`, `AndroidNotificationDeliveryTest`.
   - **Visual Verification:** Phone and tablet adaptive layouts, soft keyboard IME candidate composition under `adjustResize`, TalkBack accessibility focus, and human visual review.

2. **Live Multi-Server Containerized Runtime Qualification:**
   - **Status:** **`DEFERRED_PENDING_CONTAINER_RUNTIME`**.
   - **Prerequisites:** Dedicated containerized Linux runtime with isolated filesystems and loopback networking on ports 4804 and 4805.
   - **Reason:** Host Windows OPAQUE storage (`~/.config/dam-hopper`) is host-shared and not isolated by `XDG_CONFIG_HOME`.

3. **Live Windows Signal-Dispatch Termination:**
   - **Status:** **Open**.
   - **Verification:** Verification of process kill signals and HTTP 202/500 handling on live Windows server daemons.

4. **Android OS Process-Death Recovery:**
   - **Status:** **Open**.
   - **Verification:** Persistent reservation barrier validation across actual Android OS process death and Activity recreation.

---

## 5. Documentation Synchronization Ledger

The following documentation and project artifacts were updated and verified to reflect the redesign state:

| File | Updates Performed | Line Count Status |
|---|---|---|
| `native/android-app/README.md` | Documented 2-stage flow (`PROFILE_LOGIN` → `HUB`), two-row chrome, canonical document registry, guarded PTY lifecycle, notification delivery architecture, and current test evidence (1,299 passed). | 501 LOC (<= 800 LOC limit) |
| `docs/CHANGELOG.md` | Added conventional changelog entry `feat(android): Native Android Agent Hub redesign` under `# Unreleased`. | 720 LOC (<= 800 LOC limit) |
| `docs/project-roadmap.md` | Synchronized status, test evidence, review findings, and open qualification gates. | 113 LOC (<= 800 LOC limit) |
| `docs/android-native-acceptance.md` | Added §7.25 full implementation ledger with Cycle 3 findings and updated milestone records. | 451 LOC (<= 800 LOC limit) |
| `docs/codebase-summary.md` | Updated Android Native Client Map and Core App Flow table row for `AppFlowStage.HUB`. | 407 LOC (<= 800 LOC limit) |
| `plans/261107-0305-android-agent-hub-redesign/plan.md` | Synchronized frontmatter, phase status, evidence, Cycle 3 review findings, and open gates. | 121 LOC (<= 800 LOC limit) |
| `plans/.../reports/implementation-handoff.md` | Created comprehensive implementation handoff and qualification report. | ~200 LOC (<= 800 LOC limit) |

*Note on documentation validator:* Script `.omp/evcrate/scripts/validate-docs.cjs` was not present in the workspace and was recorded as **not run**.

---

## 6. Rollback & Remediation Runbook

If operational rollback of the redesign is required prior to production staging:

1. **Working Tree & Git Rollback Baseline:**
   - Branch: `feat/ai-os-redesign`
   - Baseline commit prior to Native Android Agent Hub redesign: `d39ee812 docs(os): complete phase 10 final documentation refresh and hand-off`.
   - Redesign commits: `e396eb39` (P01/P02 cutover), `cdda27cf` (Wave 5 feature components).
   - *Working Tree State:* The active working tree contains substantial uncommitted changes spanning P01–P08 across dozens of files. Reverting commits alone without addressing working-tree modifications will produce conflicting or invalid states.
2. **Reversion Procedure:**
   - Preserve work on a backup branch if needed:
     ```bash
     git checkout -b backup/android-hub-redesign-checkpoint
     git checkout feat/ai-os-redesign
     ```
   - Discard uncommitted working-tree changes (Caution: irreversible):
     ```bash
     git reset --hard HEAD
     git clean -fd
     ```
   - Revert committed redesign increments:
     ```bash
     git revert --no-commit cdda27cf e396eb39
     ```
   - Rebuild shared multiplatform and Android modules:
     ```bash
     ./native/android-app/gradlew -p native/android-app :shared:jvmTest :androidApp:assembleDebug
     ```
3. **Downstream Remediation Sequence:**
   - To address the 7 critical review findings without rollback:
     1. Remediate C-01 (Hub terminal row owner resolution) and C-08 (Target commit owner matching) in `NativeWorkspaceViewModel.kt` and `DamHopperMobileApp.kt`.
     2. Remediate C-02 (Canonical identity validation) and C-03 (Document reauthorization baseline) in `EditorContentLoader.kt` and `EditorTabsState.kt`.
     3. Remediate C-04 (Discarded dirty document disposal) in `EditorTabsState.kt` and `AndroidEditorDocument.kt`.
     4. Remediate C-05 (Dialog window privacy masking) in `ProjectWorkspaceScreen.kt`.
     5. Remediate C-07 (Post-consent fresh inventory verification) in `NativeWorkspaceViewModel.kt`.
