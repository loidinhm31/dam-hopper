# Documentation Finalization Report: PR48 Review and Hardening

- **Date:** 2026-10-06
- **Author:** ApprovedDocsFinalizer (Technical Documentation Specialist)
- **Target Files:**
  - `docs/api/git.md`
  - `docs/architecture/workbench-files-editor-and-git.md`
  - `docs/CHANGELOG.md`
- **Output Report:** `plans/reports/docs-manager-261006-1227-pr48-finalization.md`

---

## 1. Executive Summary and Scope Boundaries

Documentation across maintained API references, architecture guides, and the changelog has been reconciled against the final reviewed implementation and verification evidence for PR48 (three-phase hardening).

### Scope Adherence
- Strictly edited only assigned files: `docs/api/git.md`, `docs/architecture/workbench-files-editor-and-git.md`, `docs/CHANGELOG.md`, and this report.
- Performed zero mid-flight test/build/lint/format executions (parent agent owns final validation and commit).
- Maintained documentation style without broad restructuring or creating redundant markdown pages.

---

## 2. Reconciled Technical Details

### A. Author Email and Committer Metadata
- **`GitBlameCommit`:** Reconciled response schema to include `authorEmail` alongside `hash`, `authorName`, `authorTimestamp`, `authorTimezoneOffsetMinutes`, and `subject`.
- **`GitCommitDetails`:** Confirmed inclusion of full committer metadata (`committerName`, `committerEmail`, `committerTimestamp`, `committerTimezoneOffsetMinutes`) alongside author fields and full commit message bodies.
- **`CommitDetailsPanel`:** Confirmed UI inspection mode displays escaped React text for both author and committer metadata blocks.

### B. Typed Geometry as Sole Authority (Clean Cutover)
- Documented that typed `EditorOption.lineHeight` is the sole authority for gutter row heights and vertical offsets, paired with public model-line top positions.
- Documented removal of 56 lines of legacy fallback shims (constructor probing, mock `getOption(0)`, magic 19px fallback constants). Unmounted or unavailable editors safely yield empty rows rather than synthetic approximations.

### C. Row Click, Enter, and Menu Reveal Guards
- Confirmed "Show Commit in Git" action is protected by a unified guard: ready attribution status, matching document model version, and resolved owning VCS root are strictly required before revealing an exact OID.
- Documented that uncommitted lines (`commitIndex: null`) and stale buffer rows cannot trigger reveal navigation via mouse click, Enter keypress, or context menu.

### D. Baseline Safety, Symlink Rejection, and EOL Boundaries
- **Baseline Guards:** Direct HEAD paths and staged rename origins share unified regular-file mode, object-header size/type, and binary baseline validation. HEAD symlinks missing on disk are rejected (`415 GIT_BLAME_UNSUPPORTED_FILE`).
- **Early Publication Fencing:** Revalidates HEAD commit OID before returning responses on empty buffers, untracked files, or unborn repositories.
- **CRLF Committed Baseline Boundary:** Documented that LF, CRLF, and lone-CR buffer inputs normalize to LF while preserving Monaco display row counts. However, a CRLF-committed baseline compared against a normalized LF buffer evaluates as `Uncommitted` due to native byte-level mismatch. Expanded EOL-insensitive attribution is explicitly documented as out of scope.

### E. Native Commit 5 MiB Bound vs File-List/Engine Total Bounds
- Explicitly clarified that the 5 MiB ceiling applies specifically to raw commit object stdout decoding (`git cat-file -p`).
- Referenced trees, changed-file lists (`git show --numstat` / `--name-status`) and engine history/rename computation are not universally bounded by the raw commit limit. No total execution-time or memory guarantee is claimed.

### F. SHA-256 Read-Only Inspection and Git PATH Requirement
- Clarified that SHA-256 support covers exact commit details, changed-file lists, historical diffs, and supporting root status/log queries via read-only Git CLI paths.
- Native libgit2 blame, branches, and repository mutation operations remain SHA-1.
- Documented requirement for `git` CLI on the server `PATH`, which is provided in the runtime container Dockerfile with zero configuration migration needed.

### G. Scoped Invalidation and Focus Coalescing
- Documented event-driven invalidation via TanStack Query cache keys qualified by profile, generation, project, and worktree. Index-sensitive `git-diff` invalidations trigger re-blame even when HEAD is unchanged.
- Window focus and visibility changes coalesce with valid in-flight work without polling.

### H. Qualified Scoped Verification vs Stale Blanket 100% Claims
- Replaced stale "100% test pass rate across 25 Rust tests / 170 UI tests" claims in `docs/CHANGELOG.md` with the verified, qualified scope:
  - **Native Rust:** 177 unit tests in `git::`, 18 integration tests in `git_blame_api` and `git_sha256_inspection`. Existing unused `atomic::Ordering` import warning in PTY tests retained.
  - **Frontend:** 182 Vitest tests across 13 scoped files passed prior to dead-branch cleanup; 21/21 focused gutter/MonacoHost tests post-cleanup; UI build passed.
  - **Browser Component Mode:** 3/3 real Monaco tests passed (verifying 20px → 31px transitions, unconditional row mounting, mouse/Enter reveal guards).
  - **Live HTTP Smoke:** 17 scenarios verified on trusted loopback with `--no-auth`.
  - **Containerized E2E:** 1/1 Playwright journey passed (`editor-git-blame.spec.ts`) under forced production image rebuild.
  - **Visual Review:** 5 fresh captures inspected and accepted by the actual session operator (recorded by parent, no invented timestamps).
  - **Explicit Non-claims:** No blanket whole-repository pass, Clippy gate, or universal engine computation bound is claimed.

---

## 3. Onboarding and Operations Requirements

- **Git CLI Dependency:** Server requires `git` on `PATH` for SHA-256 inspection. Provided out-of-the-box in the official production `Dockerfile` (`apt-get install -y git`).
- **Configuration Migration:** No configuration migration or environment-variable changes required. Existing `dam-hopper.toml` configuration remains unchanged.
- **Local Testing:** Test fixtures and smokes can run on trusted loopback using `--no-auth` with isolated `HOME` environments without modifying production authentication latches.

---

## 4. Modified Paths

1. `docs/api/git.md`
2. `docs/architecture/workbench-files-editor-and-git.md`
3. `docs/CHANGELOG.md`
4. `plans/reports/docs-manager-261006-1227-pr48-finalization.md` (this report)

---

## 5. Recommended Actions for Main Agent

1. Parent validation already passed UI build, scoped tests, real Monaco and production application qualification; no repeat required for documentation-only finalization.
2. Parent recorded ACCEPTED visual review and explicit scoped-commit approval in `packages/ui/e2e/editor-git-blame/review.md` and `plans/reports/approval-261006-1227-pr48-hardening.json`.
3. Create the authorized scoped commit; no push.

---

## 6. Unresolved Questions

- None. All implementation details, boundaries, and evidence reconcile cleanly across code, documentation, and review records.
