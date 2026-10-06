# PR48 Three-Phase Hardening Code Review Report

- **Date:** 2026-10-06
- **Reviewer:** IntegratedHardeningReviewer (Independent Senior Code Reviewer)
- **Target:** PR48 hardening across all three authorized phases (Native baseline safety, Owner lifecycle and gutter, Contracts and qualification)
- **Status:** Review Complete — Approved for Final Integration (Pending Human Visual Sign-off)
- **Overall Score:** 9.8 / 10

---

## Code Review Summary

### Scope
- **Files reviewed:**
  - `server/src/git/blame.rs`
  - `server/src/git/commit_details.rs`
  - `server/src/git/diff.rs`
  - `server/src/git/repository.rs`
  - `server/src/git/types.rs`
  - `server/tests/git_blame_api.rs`
  - `server/tests/git_sha256_inspection.rs`
  - `Dockerfile`
  - `packages/ui/src/hooks/use-editor-git-blame.ts`
  - `packages/ui/src/hooks/use-editor-git-blame.test.tsx`
  - `packages/ui/src/hooks/use-blame-gutter-wheel-sync.ts`
  - `packages/ui/src/lib/editor-git-blame-gutter-layout.ts` (verified clean cutover; 56 lines of shims/fallbacks removed)
  - `packages/ui/src/lib/editor-git-blame.ts`
  - `packages/ui/src/lib/editor-git-blame.test.ts`
  - `packages/ui/src/components/molecules/EditorGitBlameRow.tsx`
  - `packages/ui/src/components/organisms/EditorGitBlameGutter.tsx`
  - `packages/ui/src/components/organisms/EditorGitBlameGutter.test.tsx` (verified mock namespace migration)
  - `packages/ui/src/components/organisms/EditorGitBlameContextMenu.tsx`
  - `packages/ui/src/components/organisms/MonacoHost.tsx`
  - `packages/ui/src/components/organisms/MonacoHost.test.tsx`
  - `packages/ui/src/components/organisms/CommitDetailsPanel.tsx`
  - `packages/ui/src/components/organisms/CommitDetailsPanel.test.tsx`
  - `packages/ui/src/api/client.ts`
  - `packages/ui/src/api/ws-transport.test.ts`
  - `packages/ui/browser-tests/editor-git-blame.browser.tsx`
  - `packages/ui/e2e/editor-git-blame/editor-git-blame.spec.ts`
  - `packages/ui/e2e/editor-git-blame/review.md`
  - `packages/ui/e2e/editor-git-blame/evidence.json`
  - `docs/api/git.md`
  - `docs/architecture/workbench-files-editor-and-git.md`
  - `docs/CHANGELOG.md`
  - `.omp/evcrate/scripts/worktree.cjs` (verified removal)
- **Lines of code analyzed:** ~5,600 lines modified/added across 40 paths.
- **Review focus:** Independent assessment of native baseline bounds/symlink/rename guards, early HEAD fencing, lifecycle owner/worktree matching and focus coalescing, real Monaco line geometry and wheel synchronization, stale-row reveal prevention, bounded exact SHA-256 inspection CLI safety, Serde/TS DTO synchronization, clean cutover of geometry fallbacks, test durability, and visual provenance preservation.
- **Updated plans:** None (Reviewer is strictly read-only per contract; plan progress tracked and owned by Parent integration).

---

## Commands Actually Executed by This Reviewer

In strict accordance with the read-only reviewer contract, this reviewer ran **ZERO** builds, tests, linters, formatters, or mutating commands. The analysis was conducted exclusively via static inspection and read-only fact queries:

| Category | Tools / Commands Actually Run | Purpose |
|---|---|---|
| FS & Code Analysis | `read`, `grep`, `glob` | Surgical line-by-line inspection of 32 source and test files |
| Repository Status | `git status --porcelain` | Enumerate uncommitted and modified working tree surface |
| Stat & Scope Inspection | `git diff --stat HEAD -- server/ packages/ui/ Dockerfile docs/ ...` | Quantify lines added/removed across reviewed paths |
| Hunk & Logic Inspection | `git diff HEAD -- ...` and `git diff -w HEAD -- ...` | Inspect algorithmic and behavioral modifications vs HEAD |

All test suite results, compiler runs, and live runtime executions cited in subsequent sections represent **upstream verification reported by Parent, Tester, Debugger, and HTTP runner**, verified through their emitted evidence logs.

---

## Overall Assessment

The integrated implementation across all three phases fulfills the architectural constraints and safety requirements established in the hardening plan. The codebase exhibits exemplary engineering hygiene:
1. **Native safety:** Unified entry validation applies identically to direct HEAD entries and staged rename origins. ODB headers are inspected before loading oversized payloads; symlinks in git trees are rejected even if deleted on disk; early HEAD checks fence all response return paths; and line normalization handles CRLF/lone-CR in a single pass.
2. **Lifecycle & geometry:** The hook eliminates TDZ hazards by evaluating all `useRef` calls ahead of identity checks. It protects against race conditions across disable/switch events and coalesces window focus events without polling. Monaco row geometry queries the typed `EditorOption.lineHeight` with verified 20px -> 31px transitions. The removal of all 56 lines of test-only constructor/fallback shims from `computeVisibleBlameRows` enforces a strict clean cutover.
3. **Commit inspection:** Exact 40-hex and 64-hex OIDs are strictly validated with zero shell interpolation. The SHA-256 CLI fallback bounds commit object stdout streaming and terminates runaway child processes. Full author and committer metadata (names, emails, timestamps, timezone offsets) flows correctly into React-escaped presentation.
4. **Governance:** Human visual sign-off is preserved in `PENDING_HUMAN_REVIEW` status; automation does not fabricate acceptance.

Zero critical blockers or breaking regressions were identified.

---

## Critical Issues (Must-Fix)
**Count: 0**

No critical security vulnerabilities, data loss risks, or breaking architectural defects found.

---

## High Priority Findings
**Count: 0**

All previously identified high-priority concerns from the planning phase (staged-rename baseline bypass, absent-disk symlinks, Monaco magic line-height constants, late-continuation state corruption, and 64-hex SHA-256 unhandled errors) have been resolved with regression tests.

---

## Medium Priority Improvements (Warnings)
**Count: 2**

### 1. Documented CRLF-Committed Baseline Attribution Boundary
- **Location:** `server/src/git/blame.rs:92-113`, `docs/api/git.md:288-292`
- **Evidence:** In `server/src/git/blame.rs`, input content is normalized to LF via `normalize_buffer_content`. When the committed baseline in HEAD has raw CRLF line endings, libgit2's `blame_buffer` performs byte comparison and marks lines as modified/Uncommitted.
- **Impact:** Live HTTP smoke confirmed this limitation: LF/CRLF/lone-CR editor buffers against an LF baseline retain author attribution, but a CRLF-committed baseline with normalized buffer displays as Uncommitted.
- **Status:** Documented in `docs/api/git.md` and `docs/CHANGELOG.md`. As defined in the contract, expanding native blame to EOL-insensitive history traversal is outside current scope. Kept as warning for documentation tracking.

### 2. Pre-existing Compiler Warning in Non-PR Test Code
- **Location:** `server/src/pty/tests.rs:14:16`
- **Evidence:** `warning: unused import: atomic::Ordering` observed during upstream `cargo test --lib git::`.
- **Impact:** Compiler diagnostic in user-owned PTY module, unrelated to Git blame or commit inspection.
- **Recommendation:** Can be cleaned in a routine housekeeping pass; not a blocker for PR48.

---

## Low Priority Suggestions & Static Boundary Notes
**Count: 2**

### 1. Unbounded Output Risk in Commit Files CLI numstat Output
- **Location:** `server/src/git/diff.rs:1076-1135`
- **Evidence:** `Command::new("git").args(["show", "--numstat", ...]).output()` collects full stdout into memory.
- **Static Boundary Note:** The 5 MiB commit object limit (`MAX_COMMIT_OBJECT_BYTES`) bounds the commit object itself (headers, message, root tree hash), but **does NOT bound** the number of referenced tree entries or changed files. A pathological commit touching hundreds of thousands of files could produce large stdout buffers. While scoped to read-only SHA-256 inspection where native bindings are unavailable, this represents an acknowledged unbounded output risk rather than a total resource bounding proof.

### 2. Acknowledged Engine Computation Boundaries
- **Location:** `server/src/git/blame.rs:241-250`
- **Static Boundary Note:** While application entry guards bound buffer content sizes (5 MiB), ODB blob headers, and commit object sizes, total execution time and memory during Git history traversal and rename similarity analysis remain engine-level operations within libgit2 and Git CLI. The application enforces two concurrency permits via semaphore to throttle simultaneous operations, but does not provide universal bounded total computation guarantees.

---

## Positive Observations & Static Evidence

1. **Clean Cutover in Gutter Layout (`packages/ui/src/lib/editor-git-blame-gutter-layout.ts:56-67`):**
   Removed all 56 lines of test-only constructor reflection, `getOption(0)`, and magic `19` fallback shims. If Monaco is not yet mounted (`!monaco`), `computeVisibleBlameRows` returns an empty array immediately. Once ready, `editor.getOption(monaco.editor.EditorOption.lineHeight)` serves as the sole, authoritative, strictly-typed source of line height. Test fixtures in `EditorGitBlameGutter.test.tsx` cleanly supply `mockMonaco`.

2. **Native Entry Guard Parity (`server/src/git/blame.rs:187-199`):**
   Direct HEAD entries and staged rename origins (resolved via `find_staged_rename_origin`) route through the identical `validate_baseline_entry` check. Renamed oversized files return 413, and renamed binary files return 415, with verified repository immutability (`server/tests/git_blame_api.rs:515-586`).

3. **ODB Header Inspection Before Payload Load (`server/src/git/blame.rs:275-289, 424-436`):**
   `odb.read_header` validates blob and commit object sizes against `MAX_BUFFER_CONTENT_BYTES` and `MAX_COMMIT_OBJECT_BYTES` before invoking `repo.find_blob` or `repo.find_commit`.

4. **Symlink Tree-Mode Enforcement (`server/src/git/blame.rs:414-420`):**
   Checks `entry.filemode()` against regular file modes (`0o100644 | 0o100755`), catching HEAD symlink entries even when the working copy file has been deleted from disk.

5. **Early HEAD Fencing (`server/src/git/blame.rs:159, 201, 219, 366`):**
   All return paths—unborn branch, empty buffer, non-existent HEAD entry, and normal completion—call `ensure_head_unchanged`, returning `GitBlameError::StaleRevision` (409) if a concurrent commit modified HEAD.

6. **Safe CLI Child Execution (`server/src/git/commit_details.rs:136-235`, `server/src/git/diff.rs:1048-1227`):**
   Uses argument arrays without shell interpolation. Passes `--no-replace-objects`, `GIT_NO_REPLACE_OBJECTS=1`, `-c safe.directory=*`, and `GIT_OPTIONAL_LOCKS=0`. Streams commit objects through `(&mut stdout).take((MAX_COMMIT_OBJECT_BYTES + 1) as u64).read_to_end(&mut buffer)` and kills runaway child processes.

7. **Lifecycle Synchronization & TDZ Resolution (`packages/ui/src/hooks/use-editor-git-blame.ts:173-231`):**
   All `useRef` calls execute before identity comparison. Identity changes synchronously clear attribution data, increment epochs, clear debounce timers, and abort active controllers.

8. **Late Continuation Protection (`packages/ui/src/hooks/use-editor-git-blame.ts:308-325, 458-468, 523-535`):**
   Post-await and catch blocks in both `runBlame` and `triggerRepositoryRefresh` verify mount status, active connection, tab key, feature enablement, model version, and epoch counters. Rejections occurring after the feature is toggled off preserve status `"off"`.

9. **Coalesced Refresh Without Polling (`packages/ui/src/hooks/use-editor-git-blame.ts:498-505`):**
   Window focus events inspect roots and coalesce with in-flight requests without re-triggering or aborting work. A 60-second idle period produces zero API calls.

10. **Public Monaco Line Height Geometry (`packages/ui/src/lib/editor-git-blame-gutter-layout.ts:65-99`):**
    Queries typed `monaco.editor.EditorOption.lineHeight`. Real browser suite (`packages/ui/browser-tests/editor-git-blame.browser.tsx`) passed 3/3 unconditionally, proving height alignment across 20px -> 31px transitions within 0.5px tolerance.

11. **Wheel Synchronization (`packages/ui/src/hooks/use-blame-gutter-wheel-sync.ts:17-45`):**
    Normalizes `deltaMode` and only intercepts wheel events when `targetScroll !== currentScrollTop`, avoiding page scroll entrapment at boundaries.

12. **Gated Row Reveal Affordance (`packages/ui/src/components/molecules/EditorGitBlameRow.tsx:31-41`, `MonacoHost.tsx:200-235`):**
    Both left mouse clicks and Enter keys route through `revealCommittedRow`. Uncommitted rows are strictly non-clickable. `handleRevealCommit` validates feature enablement, root ID match, and model version match.

13. **End-to-End DTO Synchronization & Escaping:**
    `authorEmail` and full committer metadata flow through Rust types, camelCase Serde serialization, TypeScript client validation, and render in `CommitDetailsPanel.tsx` with React-escaped text (`&lt;{authorEmail}&gt;`).

14. **Durability of Test Fixtures:**
    Deleted obsolete mock-echo tests (`ws-transport.test.ts`, `phase-03-client-smoke.test.ts`). Added 6 real SHA-256 scenarios (`tests/git_sha256_inspection.rs`) and dirty buffer test asserting typed row 6 while retaining rows 2/3 attribution (`editor-git-blame.spec.ts:111-145`).

15. **Clean Tooling & Visual Provenance:**
    Nonportable host symlink `.omp/evcrate/scripts/worktree.cjs` removed. Dockerfile includes `git` in production Debian image. `packages/ui/e2e/editor-git-blame/review.md` preserved with status `PENDING_HUMAN_REVIEW` and real execution fingerprints.

---

## Upstream Verification Reported by Integration & QA

The following verification outcomes were executed by Parent, Tester, Debugger, and HTTP smoke harnesses and recorded in project reports:

| Step / Suite | Command / Harness | Reported Result | Evidence Source |
|---|---|---|---|
| Native Git Lib Tests | `cargo test --lib git::` | 177 passed, 0 failed | `tester-261006-1135-pr48-hardening.md` |
| Native API & SHA-256 Tests | `cargo test --test git_blame_api --test git_sha256_inspection` | 18 passed, 0 failed | `tester-261006-1135-pr48-hardening.md` |
| Server Binary Build | `cargo build --bin dam-hopper-server` | Exit 0, binary created | `tester-261006-1135-pr48-hardening.md` |
| UI Scoped Vitest (13 files) | `pnpm --filter @dam-hopper/ui test ...` | 182 passed, 0 failed | `verification-261006-1205-pr48-hardening.md` |
| UI Typecheck & Build | `pnpm --filter @dam-hopper/ui build` | Exit 0, clean build | `verification-261006-1205-pr48-hardening.md` |
| UI E2E Typecheck | `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | Exit 0 | `verification-261006-1205-pr48-hardening.md` |
| Post-Cutover Focused Suite | Vitest focused run (Gutter + MonacoHost) | 21 passed, 0 failed | Parent IRC confirmation (bg27) |
| Post-Cutover UI Build | `pnpm --filter @dam-hopper/ui build` | Passed cleanly | Parent IRC confirmation (bg27) |
| Strengthened Monaco Browser | Vitest browser runner (`editor-git-blame.browser.tsx`) | 3 passed, 0 failed (20->31px verified) | Parent IRC confirmation (bg27) |
| Live HTTP Smoke Scenarios | Isolated loopback API test harness | 17 request scenarios passed | `http-261006-1201-pr48-hardening.json` |
| Real Production Browser Smoke | Authenticated container session | 19->20px font transition, exact OID reveal, SHA-256 inspection | `verification-261006-1205-pr48-hardening.md` |
| Production Container Image | `pnpm --filter @dam-hopper/ui test:e2e:build-images` | Passed (git runtime present) | `verification-261006-1205-pr48-hardening.md` |
| Production E2E Capture Run | `E2E_CAPTURE=1 pnpm ... editor-git-blame.spec.ts` | 1 passed, 5 captures recorded; fresh forced rebuild run underway | `review.md`, run `e2e-run-1791263289677-8d7be5de` (bg28 in flight) |

---

## Unresolved Acceptance Gates

1. **Human Visual Review Sign-off:**
   `packages/ui/e2e/editor-git-blame/review.md` remains in `PENDING_HUMAN_REVIEW` status. Parent is capturing fresh execution IDs via forced-image container E2E run (bg28). Operator visual inspection of rendered captures is an inviolable gate that cannot be certified by automation.
2. **Explicit Review Approval Before Finalization:**
   Per project policy, user approval is required before finalization and commit. Push remains strictly unauthorized.

---

## Conclusion & Recommendation

- **Report Path:** `plans/reports/code-reviewer-261006-1216-pr48-hardening.md`
- **Score:** 9.8 / 10
- **Must-Fix Issues Count:** 0
- **Warnings Count:** 2 (CRLF-committed baseline boundary; pre-existing PTY test warning)
- **Recommendation:** **PROCEED TO USER ACCEPTANCE / FINAL INTEGRATION**
  The codebase meets all hardening criteria across the three phases. The code is structurally sound, type-safe, resilient against race conditions, cleanly cut over without legacy/mock shims, and properly tested. Ready for user visual review and explicit commit approval.
