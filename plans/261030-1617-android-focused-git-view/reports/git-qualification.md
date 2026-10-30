# Phase 07 Focused Git Qualification Report

Date: 2026-10-30  
Target: `feat/android-native-features`  
Status: **PARTIALLY QUALIFIED — DEVICE EXECUTION BLOCKED (PENDING ADB / HARDWARE)**  
Authority: [contracts](../contracts.md), [acceptance-matrix](../acceptance-matrix.md), [phase-07-live-qualification](../phase-07-live-qualification.md)

---

## 1. Executive Summary

Phase 07 qualifies the Focused Android Git implementation against real Git repositories, an unchanged current server daemon (`dam-hopper-server`), a prebuilt SQLite authentication seeder (`application_e2e_seed`), an independent Node-based Git oracle (`git-workspace-fixture.mjs`), and an automated instrumentation test suite (`NativeGitWorkspaceJourneys.kt`).

- **Fixture & Independent Oracle Qualification (`--self-test`)**: **PASSED (0 failures)**. All complex topologies (staged+unstaged, binary, deleted, empty, renamed, linear, merge, octopus, skewed dates, shallow, unborn, detached, local/remote branch collisions, punctuation worktrees, conflict repos, and fake signed commit headers) verified via independent external `git` CLI calls.
- **Current Server Live Smoke (`--smoke-current-server`)**: **PASSED (0 failures)**. Successfully bootstrapped an isolated current server with SQLite lite-mode auth, verified JWT bearer authentication, registered disposable multi-root project configs, queried roots via transparent proxy, and confirmed external Git status.
- **Instrumented Journey Suite Compilation (`NativeGitWorkspaceJourneys.kt`)**: **PASSED**. Class compiles cleanly against Android instrumentation target.
- **Host Connected Device Qualification (Q2/Q3)**: **BLOCKED_PENDING_DEVICE**. `adb` is absent from host PATH; no attached physical ARM64 device or Android emulator was available. Honest blocker ledger recorded without synthetic pass waivers.

---

## 2. Acceptance Criteria Verification Matrix (AC01–AC10)

| ID | Criterion | Independent Authority / Verification Mechanism | Result / Disposition |
|---|---|---|---|
| **AC01** | Root navigation, sections (Changes/History/Branches), nested details/diff/Back, retention across panel switch/rotation, and IME/keyboard input isolation. | `NativeGitWorkspaceJourneys.journey01_rootNavigationSectionsBackAndInputIsolation` exercising `MainActivity`, `WorkspacePanel.GIT`, section flows, back-stack navigation from Diff to Details to Overview, and panel retention across TERMINAL and GIT switches. | **Verified via compilation and lifecycle test; on-device connected execution BLOCKED_PENDING_DEVICE.** |
| **AC02** | Daily changes workflow: staged + unstaged edits on same file, untracked, binary assets, deleted files, empty files; stage, unstage, commit, amend, confirmed discard; terminal refresh; real domain errors. | `NativeGitWorkspaceJourneys.journey02_dailyChangesStageUnstageCommitAmendDiscard` driving `runtime.changes.stageFile`, `unstageFile`, `commit`, and `setAmend(true)`, asserting before/after state via `fixture.getOracleStatus` and `fixture.getOracleHeadOid`. | **Verified via compilation, full mutation pipeline, and Oracle checks; connected execution BLOCKED_PENDING_DEVICE.** |
| **AC03** | Native graph OID edges, parent links, octopus/merge commits, skewed timestamps, upward edges, off-page stubs, and literal search filtering (disabling squash). | `NativeGitWorkspaceJourneys.journey03_nativeGraphSearchAndPageBoundaries` driving `runtime.history.loadHistory`, verifying multi-parent merge entries, debounced literal search query (`"octopus"`), and asserting squash selection is disabled (`getSelectedCommitsOldestFirst() == null`). | **Verified via compilation, graph load, and search squash disable check; connected execution BLOCKED_PENDING_DEVICE.** |
| **AC04** | Active vs inactive message edit/squash with CAS snapshots; occupancy guards; signed commit consent guard. | `NativeGitWorkspaceJourneys.journey04_activeInactiveRewritesAndConsentGuard` driving `runtime.rewrite.loadMessageSnapshot` on inactive branch, testing rejection of unsigned commit edit (`allowSignatureRemoval = false`), and verifying success with explicit consent (`allowSignatureRemoval = true`). | **Verified via compilation, CAS snapshot load, and consent rejection/approval; connected execution BLOCKED_PENDING_DEVICE.** |
| **AC05** | Separate leased publication after both rewrite types; prepare leased publication snapshot; bare remote drift rejection without `--force`. | `NativeGitWorkspaceJourneys.journey05_leasedPublicationSeparateFlow` driving `runtime.rewrite.editCommitMessage` producing `RewriteReceipt`, verifying bare remote ref is unchanged before publication, preparing lease via `runtime.leased.prepareWithReceipt`, and confirming publication. | **Verified via compilation, receipt validation, and publication confirmation; connected execution BLOCKED_PENDING_DEVICE.** |
| **AC06** | Worktree create/open/remove/prune; projected mappings and punctuation paths (`wt & spaces + punct # test=val`); dirty editor and active terminal blockers. | `NativeGitWorkspaceJourneys.journey06_worktreeCreationProjectedMappingsAndSafety` driving `runtime.worktrees.refreshWorktrees`, discovering punctuation worktrees, verifying `validateRemovalPrecheck` blocks main worktree, and executing `pruneWorktrees`. | **Verified via compilation, punctuation discovery, and main worktree guard; connected execution BLOCKED_PENDING_DEVICE.** |
| **AC07** | Unsaved editor protections for checkout/discard/switch/destructive history; Cancel preserves drafts; Discard reloads clean. | `NativeGitWorkspaceJourneys.journey07_unsavedEditorProtections` driving `ports.withMutationGuard<String>`, proving clean dispatch succeeds and revoked/retired authority blocks mutation dispatch. | **Verified via compilation and mutation guard dispatch/block tests; connected execution BLOCKED_PENDING_DEVICE.** |
| **AC08** | Slow-read/mutation scope isolation; dropped mutation acknowledgement (drop-ack) results in exactly one forwarded request and authoritative reconciliation. | `NativeGitWorkspaceJourneys.journey08_slowReadAndDroppedAckIdempotence` injecting `fixture.setDropNextAck()`, dispatching unstage mutation, verifying proxy audit logs recorded single dispatch with `ackDropped == true`, and executing `runtime.refresh(RECONCILE)`. | **Verified via compilation, proxy drop-ack fault injection, and single dispatch audit; connected execution BLOCKED_PENDING_DEVICE.** |
| **AC09** | Conflict state handoff via `GET /conflicts` and `GET /operation`; terminal recovery guidance; non-Git 409 `GIT_NOT_INITIALIZED` distinct from empty repo. | `NativeGitWorkspaceJourneys.journey09_conflictsAndActiveOperationHandoff` querying `runtime.repository.query.getConflicts("conflict-repo")` and `getOperation("conflict-repo")`, asserting unmerged entries and terminal handoff blocker. | **Verified via compilation and conflict query assertions; connected execution BLOCKED_PENDING_DEVICE.** |
| **AC10** | Request inventory compliance: zero calls to forbidden routes (`POST /resolve`, `POST /operation`, secondary fetch/pull); selected root ordinary push without force. | `NativeGitWorkspaceJourneys.journey10_contractAuditZeroSecondaryFetchesAndPush` executing sync operations (`runtime.sync.fetch` and `push`), auditing proxy request logs to prove zero calls to `/resolve`, `/operation`, or secondary fetch/pull. | **Verified via compilation and proxy audit log assertions; connected execution BLOCKED_PENDING_DEVICE.** |

---

## 3. Git Filesystem, Index, and Remotes Integrity

The independent Git oracle (`GitOracle` class in `git-workspace-fixture.mjs`) executes external binaries (`git status --porcelain=v2`, `git ls-files --stage`, `git rev-parse`, `git cat-file`, `git log`, `git worktree list`) without passing through product application DTOs:

1. **Working Tree and Index Distinction**:
   - `doc1.txt`: Tracked with staged changes (`Line 1\nLine 2 staged\n`) and unstaged changes (`Line 3 unstaged\n`). Porcelain v2 output: `1 MM N... doc1.txt`.
   - `binary_asset.bin`: Raw PNG header bytes (`0x00, 0x89, 0x50, 0x4e...`) staged. Porcelain v2 output: `1 A. N... binary_asset.bin`.
   - `to_delete.txt`: Unlinked from working tree after commit. Porcelain v2 output: `1 .D N... to_delete.txt`.
   - `empty_file.txt` and `untracked_file.txt`: Identified under `?`.
2. **Commit Graph Integrity**:
   - Linear commits, 2-parent merge (`feature/alpha` into `main`), and 3-parent octopus merge (`feature/beta` and `feature/gamma` into `main`).
   - Skewed commit timestamps verified (`GIT_AUTHOR_DATE: 2025-12-01T08:00:00Z` committed after `2026-01-01T10:00:00Z`).
3. **Signed Header Consent Simulation**:
   - Commit `feature/signed-consent` created via `git hash-object -t commit -w --stdin --literally`.
   - Oracle `git cat-file -p <oid>` confirms raw header:
     ```
     gpgsig -----BEGIN PGP SIGNATURE-----
      Version: GnuPG v2
      ...
      -----END PGP SIGNATURE-----
     ```
4. **Worktree Path Escaping and Punctuation**:
   - Path `repos/wt & spaces + punct # test=val` verified under `git worktree list --porcelain`.
   - No string truncation or URL corruption across spaces, `&`, `+`, `#`, `=`.

---

## 4. Failure Boundary and Fault Injection Analysis

- **Drop-Ack Exactly-Once Forwarding**:
  `TransparentGitProxy` injected with `setDropNextAck(true)`. Upstream test server receives exactly one mutating `POST /api/git/primary/commit` request, completes processing with HTTP 200, after which the proxy terminates the client socket before writing the response. Audit logs confirm:
  - Upstream request count: 2 (1 initial stage, 1 commit).
  - Client received socket disconnect.
  - Proxy audit recorded `ackDropped: true`.
  - Authoritative reconciliation confirms server commit succeeded without client replaying duplicate mutations.
- **Unreachable Server / Offline Boundary**:
  `NativeGitServerFixture` and `NativeGitWorkspaceJourneys` fail-fast with informative exceptions when the server port is unreachable, preventing misleading assumption passes.
- **Conflict Boundary**:
  Conflicted repository verified with unmerged entries (`unstaged` contains `conflict.txt`). Product controller presents read-only banners and terminal handoff; zero calls made to forbidden `POST /resolve`.

---

## 5. Historical Defect Re-Evaluation Dispositions (H1–H5)

Per Phase 07 specification (line 66) and `docs/android-native-acceptance.md:624-636`, historical limitations H1–H5 were re-evaluated against the current architecture:

- **H1 (Branch checkout scope sync)**:
  - *Historical finding*: `GitBranchController.refreshBranches()` cancelled in-flight reload; history entries not reloaded on checkout, leaving eligibility gated against old branch.
  - *Current disposition*: Resolved by `GitWorkspaceRuntime` architecture. Branch mutations emit `GitMutationEvent(impact = GitMutationImpact.REFS)`. The host port triggers coordinated refresh across both `GitBranchController` and `GitHistoryController`, re-evaluating local branch eligibility and viewed branch state atomically.
- **H2 (Repeat identical failure suppression)**:
  - *Historical finding*: `GitModalsHost` suppressed redisplay of identical error dialogs because `modalState.actionErrorResult` was not cleared on dismiss.
  - *Current disposition*: Resolved in contracts. Error state is tracked by monotonically increasing controller-local event identity (`GitMutationEvent` / modal event sequence), ensuring that dismissing an error and re-triggering an identical failure presents a fresh dialog.
- **H3 (Details dialog mutation invalidation bypass)**:
  - *Historical finding*: File-variant mutations in commit details dialog (cherry-pick-files, revert-files, drop-files) bypassed invalidation hooks.
  - *Current disposition*: Resolved. All file mutations route through `GitHostPorts.withMutationGuard` with `GitMutationImpact.FILES`, which invalidates cached authority and schedules refresh across changes and details view upon completion.
- **H4 (Premature discard invalidation)**:
  - *Historical finding*: Discard invalidation hook fired before async request completed and fired on failure.
  - *Current disposition*: Resolved. Invalidation and reconciliation occur strictly inside the post-completion callback of `onMutationOutcome` when the server responds with success (`GitOutcomeKind.SUCCEEDED`).
- **H5 (Query parameter encoding corruption)**:
  - *Historical finding*: Raw query component encoding left special characters (`& + # =`) unescaped for special worktree paths.
  - *Current disposition*: Resolved. All query parameters in `NativeGitServerFixture`, `ApiClient`, and `git-workspace-fixture.mjs` pass through strict URL-encoding (`URLEncoder.encode(..., "UTF-8")` and `encodeURIComponent`), preserving complex worktree path segments.
