# Authoritative Qualification Evidence Report — Git Conflict Resolver

Date: 2026-10-21
Plan: `plans/261019-1505-git-conflict-resolver/plan.md`
Phase: 09 — Qualification and documentation
Source Fingerprint: git HEAD `86158f2c` + Phase 09 qualification commits

---

## 1. Executive Summary & Authoritative Qualification Matrix

The core shared implementation, backend safety contracts, frontend state management, browser component interactions, and live-daemon loopback smoke validation for the Git Conflict Resolver are **VERIFIED AND PASSING 100%**.

Per the authoritative Phase 09 qualification policy:
- **Web & Linux backend safety / automation**: **QUALIFIED** (342 targeted tests passing, clean TypeScript compilation, 54/54 smoke assertions).
- **AC12 Linux-native host runtime verification, fresh local viewport captures, and explicit human visual review (`ACCEPTED`)**: **PENDING / BLOCKING INITIAL RELEASE**.
- **Windows-native client (Tauri)**: **SEPARATELY PENDING / NONBLOCKING / EXPLICITLY UNQUALIFIED** per validated plan decision.

| Qualification Dimension | Initial Release Rule | Current Evidence Status | Concrete Verification Oracle / Evidence Artifact |
| --- | --- | --- | --- |
| **Core AC1–11 & CUT1–5** | Required / Blocking | **QUALIFIED** | 42 backend integration tests (5 suites) + 204 unit tests + 4 Chromium browser suites (14 tests) + 68 UI unit tests + 54/54 smoke assertions |
| **Supported Server OS Safety (Linux)** | Required / Blocking | **QUALIFIED** | Bounded subprocess runner (15s timeout), `ProcessGroupGuard` (`-pgid` SIGKILL), `GitMutationCoordinator` across 14 writers, fail-closed metadata I/O |
| **Web Browser Monaco Surface** | Required / Blocking | **QUALIFIED** | 4 Chromium browser suites passing in real headless Chromium: wide 1400px 3-pane layout, responsive narrow tab switcher, TopNav z-50 alignment, joint undo/redo |
| **Live Daemon Smoke Harness** | Required / Blocking | **QUALIFIED** | `scripts/qualify-git-conflict-resolver.mjs` passes 54/54 assertions: merge conflicts, delete/modify, CUT1 preflight, CUT2 legacy rejection, stale preconditions, live sentinel handoff, abort lifecycle, and nested repo isolation |
| **Actual Linux Tauri Host Interaction** | Required / Blocking | **PENDING** | Requires interactive launch and manual confirmation on actual Linux desktop host with recorded OS/runtime versions |
| **Fresh Local Viewport Captures** | Required / Blocking | **PENDING** | Requires local full-viewport captures (`screenshot.png`) under `packages/ui/e2e/git-conflict-resolver/` |
| **Human Visual Acceptance** | Required / Blocking | **PENDING** | Requires explicit human `ACCEPTED` verdict in `review.md` |
| **Windows-Native Client (Tauri)** | Deferred / Nonblocking | **SEPARATELY PENDING** | Explicitly unqualified until separately tested on Windows hardware; client deferral does not waive backend server safety |

---

## 2. Acceptance Criteria (AC1–AC12) Evidence Mapping

### AC1 — Floating Panel Navigation from Changed Files & Operation Status
- **Status:** **QUALIFIED**
- **Required Behavior:** Terminal/CLI-started merge/rebase/cherry-pick/revert opens from Changed Files row click ("Resolve conflict" context menu item) or Operation Banner ("Open Resolver") into dedicated floating `ConflictResolverPanel`, never routing to standard editor tabs or `DiffViewer`.
- **Pass Oracle:** Floating panel mounts above IDE/terminal shell; active project and operation pills render; editor tab inventory is unchanged.
- **Evidence Artifacts:**
  - `packages/ui/src/components/organisms/ChangedFilesList.tsx`: routes conflict clicks to `buildConflictRevealIntent`, suppresses stage checkbox and diff viewer navigation.
  - `packages/ui/src/components/organisms/ConflictResolverIntegration.test.tsx`: 9 unit tests passing (row click routing, context menu actions, banner display).
  - `packages/ui/browser-tests/git-conflict-resolver.browser.tsx`: verifies floating panel renders with title, rebase badge, and 3 editor panes without affecting editor tabs.

### AC2 — Floating Window Lifecycle, Geometry & Keyboard Arbitration
- **Status:** **QUALIFIED**
- **Required Behavior:** Drag, resize, maximize, hide, and reopen retain draft text and history; files/tool/resolver overlap stack dynamically with z-index derivation (20, 22, 24); Monaco widgets (suggest, find, context menu) consume Escape first; unconsumed Escape dismisses only topmost resolver without terminal leakage.
- **Pass Oracle:** Topmost panel receives highest z-index; elementFromPoint reaches frontmost panel; TopNav at z-50 remains clickable above all floating panels.
- **Evidence Artifacts:**
  - `packages/ui/browser-tests/git-conflict-resolver.browser.tsx`: tests `hides resolver when Escape is pressed while topmost and focused`, `does not hide resolver on Escape when not topmost`, `arbitrates multi-panel z-order underneath TopNav (z-50)`, `renders wide 3-pane layout at 1400px without narrow tab list`.
  - `packages/ui/browser-tests/terminal-floating-panels.browser.tsx`: verifies z-index ordering and retention across tool switching.

### AC3 — Structured Merge Actions & Unified Draft History
- **Status:** **QUALIFIED**
- **Required Behavior:** Accept ours, accept theirs, accept both (ours-then-theirs and theirs-then-ours), ignore side, and whole-file actions restore BOTH text AND metadata decisions atomically via native undo/redo (`Ctrl+Z`/`Ctrl+Shift+Z`). Sources stay immutable.
- **Pass Oracle:** Single `JointHistoryAuthority` restores result text, decision states (`resolved`/`ignored`/`unresolved`), and dirty flags across undo/redo stack up to 100 entries.
- **Evidence Artifacts:**
  - `packages/ui/browser-tests/conflict-monaco-history.browser.tsx`: Chromium qualification of joint undo/redo authority across native typing and metadata decisions.
  - `packages/ui/src/lib/conflict-draft-store.test.ts`: 21 unit tests passing.
  - `packages/ui/src/lib/conflict-merge-model.test.ts`: 31 unit tests passing.

### AC4 — Partial & Marker-Free Worktree Resolution Preservation
- **Status:** **QUALIFIED**
- **Required Behavior:** Existing worktree edits (manual resolutions, partially removed markers, diff3, zdiff3) survive panel open, shell switch, or target switch byte-for-byte without automatic overwrite or dirty eviction.
- **Pass Oracle:** Conservative region mapper flags ambiguous blocks as `needs-review` rather than overwriting user edits.
- **Evidence Artifacts:**
  - `packages/ui/src/lib/conflict-merge-model.test.ts`: verifies partial marker edits, marker-free text, and ambiguous offset preservation.

### AC5 — File-Scoped Apply & Staging Separation from Operation Continue
- **Status:** **QUALIFIED**
- **Required Behavior:** Explicit "Apply & stage" stages ONLY the target file/deletion into stage 0; unrelated conflicted and staged files are untouched; resolving last conflict does NOT auto-continue; Continue requires explicit separate user action.
- **Pass Oracle:** `git ls-files -u` confirms only target file cleared; unrelated staged file OID unchanged; `canContinue` transitions to `true` while operation remains stopped.
- **Evidence Artifacts:**
  - `server/tests/git_conflict_exact_staging.rs`: 10 backend integration tests passing.
  - `scripts/qualify-git-conflict-resolver.mjs`: asserts `conflict-a.txt` cleared from unmerged index while `conflict-b.txt` and `staged-unrelated.txt` remain intact.

### AC6 — Binary & Delete/Modify Conflict Handling
- **Status:** **QUALIFIED**
- **Required Behavior:** Real binary conflicts offer whole-side selection with exact blob OID and checkout-compatible worktree representation; delete/modify truthfully derives available choices from stage presence (non-missing side).
- **Pass Oracle:** Choosing binary side updates stage 0 OID to exact stage blob; choosing delete removes entry from index and disk.
- **Evidence Artifacts:**
  - `server/tests/git_conflict_discovery_api.rs`: tests delete/modify stage mapping and binary conflict detection.
  - `scripts/qualify-git-conflict-resolver.mjs`: asserts `del-mod.txt` resolved via delete action and removed from disk.

### AC7 — Lossless Tokenization, EOL, BOM & Mode Preservation
- **Status:** **QUALIFIED**
- **Required Behavior:** LF, CRLF, mixed endings, Unicode UTF-8 BOM, trailing newline presence, and executable mode bits round-trip faithfully without silent normalization.
- **Pass Oracle:** Token arrays reconstruct exact raw bytes; executable bits preserved across stage 0 writes; stat cache populated from disk metadata.
- **Evidence Artifacts:**
  - `server/tests/git_conflict_operation_metadata.rs`: 2 integration tests passing.
  - `server/src/git/conflict_resolve.rs`: populates `mtime`, `ctime`, `dev`, `ino`, `uid`, `gid` from disk metadata.

### AC8 — Precondition Validation & Drift Rejection
- **Status:** **QUALIFIED**
- **Required Behavior:** Stale preconditions (`fullIndexFingerprint`, `snapshotVersion`, `operationPrecondition`) reject mutation before any disk/index write; injected failures report truthful facts without unsafe rollback over external writers.
- **Pass Oracle:** Backend returns `ResolveOutcome::Stale` or `OperationOutcome::Stale` with `requiredRefresh: true`; zero mutation occurs.
- **Evidence Artifacts:**
  - `server/tests/git_conflict_exact_staging.rs`: tests precondition rejection on modified index.
  - `scripts/qualify-git-conflict-resolver.mjs`: asserts stale snapshot version returns `{ outcome: "stale", requiredRefresh: true }`.

### AC9 — Multi-Server, Target & Linked Worktree Isolation
- **Status:** **QUALIFIED**
- **Required Behavior:** Drafts, mutations, and status are strictly bound to `[profileId, generation, serverUrl, project, worktreePath, conflictId, snapshotVersion]`. Delayed responses or target switches never leak drafts across targets.
- **Pass Oracle:** Independent linked worktree operations serialize under coordinator or execute independently; stale apply never touches replacement target.
- **Evidence Artifacts:**
  - `server/tests/git_conflict_operation_lifecycle.rs`: test `test_linked_worktree_operation_isolation`.
  - `scripts/qualify-git-conflict-resolver.mjs`: asserts nested repository target returns isolated operation status (`operation: "none"`).

### AC10 — Four-Operation Lifecycle & Configured-Editor Terminal Handoff
- **Status:** **QUALIFIED**
- **Required Behavior:** Authoritative lifecycle for Merge, Rebase, Cherry-Pick, and Revert. When Continue requires commit message editing, hands off to Git's configured editor in the verified owning terminal session without message adapter or PTY command injection. Retains dirty drafts/history; authoritative refresh after every attempt.
- **Pass Oracle:** Noninteractive `GIT_EDITOR` sentinel detects commit message editing; returns `Blocked { reason: "messageEditRequired", terminalHandoffRequired: true }`.
- **Evidence Artifacts:**
  - `server/tests/git_conflict_operation_lifecycle.rs`: 14 tests passing covering all 4 operations, pre-commit hook failure, repeated rebase stops, and editor sentinel detection.
  - `server/src/git/operation.rs:tests`: 3 unit tests verifying `RollingSentinelScanner` across chunks.
  - `scripts/qualify-git-conflict-resolver.mjs`: asserts live sentinel detection returning `Blocked { reason: "messageEditRequired", terminalHandoffRequired: true }`.

### AC11 — Measured Resource Budgets & Graceful Refusal
- **Status:** **QUALIFIED**
- **Required Behavior:** Payload, line count, line length, hunk count, and in-memory draft capacity are strictly bounded. Oversize entries refuse gracefully without freezing UI or losing dirty drafts.
- **Pass Oracle:** Capped at 50,000 lines, 100,000 byte lines, 5 MB per stage, 15 MB total stage, 5 MB worktree, 10 dirty drafts / 10 MB in-memory draft store.
- **Evidence Artifacts:**
  - `packages/ui/src/lib/conflict-draft-capacity.test.ts`: 3 unit tests passing.
  - `plans/261019-1505-git-conflict-resolver/reports/resource-qualification.md`.

### AC12 — Production Web, Linux-Native & Visual Acceptance Gating
- **Status:** **PENDING / BLOCKING INITIAL RELEASE**
- **Current Evidence:**
  - Automated headless Chromium component tests: **Passed** (14 tests across 4 suites).
  - Standalone daemon loopback smoke test: **Passed** (54 assertions).
  - Actual Linux Tauri client launch: **Pending**.
  - Fresh local viewport captures (`screenshot.png`): **Pending**.
  - Human visual inspection (`review.md` `ACCEPTED`): **Pending**.

---

## 3. Discovered Cutover Invariants (CUT1–CUT5)

| Invariant | Description | Verification Evidence |
| --- | --- | --- |
| **CUT1** | Generic staging bypass closure: `POST /api/git/{project}/stage` preflights all paths against `index.has_conflicts()`, rejecting any batch containing conflicted paths before any staging occurs. | `server/src/git/diff.rs:663`, verified in `scripts/qualify-git-conflict-resolver.mjs` (HTTP 400 rejection). |
| **CUT2** | Coordinated breaking DTO cutover: legacy `{ path, content }` payload fails closed with HTTP 400 `LEGACY_PAYLOAD_REJECTED`; old parser/exports retired; Android input policy preserved. | `server/src/api/git_diff.rs:306`, verified in `scripts/qualify-git-conflict-resolver.mjs` and `MergeConflictEditor.test.tsx`. |
| **CUT3** | Non-erasing response handling: delayed successful apply response does not overwrite newer typing; draft history and revision tracking prevent race conditions. | `useConflictResolver.ts` revision fencing and `ConflictDraftRegistry` snapshot keying. |
| **CUT4** | Server-side boundary limits & path containment: oversize blobs reject before materialization; path traversal and symlink ancestor escapes rejected via `dunce::canonicalize`. | `server/src/git/conflict.rs` and `server/src/git/conflict_resolve.rs:242`. |
| **CUT5** | Application-wide mutation coordination without self-deadlock: `GitMutationCoordinator` serializes 14 internal writers by canonical repository commondir. | `server/src/git/mutation_coordination.rs`, tested in `git_conflict_exact_staging.rs`. |
