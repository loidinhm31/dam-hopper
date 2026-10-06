## Code Review Summary

### Scope
- Files reviewed: PR docs (indices 1-84), `.omp/evcrate/scripts/validate-docs.cjs`, `.omp/evcrate/scripts/worktree.cjs`, `packages/ui/e2e/editor-git-blame/*` (spec, fixture, evidence, review, PNGs), `packages/ui/browser-tests/editor-git-blame.browser.tsx`, `packages/ui/e2e/fixtures/application-runtime.Dockerfile`, server & UI feature tests (`server/tests/git_blame_api.rs`, `server/src/git/blame.rs`, `server/src/git/commit_details.rs`, `CommitDetailsPanel.test.tsx`, `EditorGitBlameGutter.test.tsx`, `use-editor-git-blame.test.tsx`).
- Lines of code analyzed: ~4,200 LOC across docs, fixtures, scripts, specs, and test suites.
- Review focus: Qualification evidence provenance, E2E assertion determinism, 64-hex OID and authorEmail contract alignment, documentation restructuring / archive consolidation, test coverage boundaries.
- Updated plans: None (read-only review; parent owns final verdict and plan tracking).

### Overall Assessment
PR #48 implements native `libgit2` buffer blame, Monaco gutter rendering with responsive column compaction, and read-only Workspace Git reveal. Core functionality is verified by parent checks (9 API, 57 UI, 1 E2E passing). Key findings to address: (1) E2E dirty buffer assertion matches pre-existing trailing-LF line 5 rather than proving newly typed dirty line attribution; (2) 64-hex SHA-256 commit inspection is documented and lexically accepted but rejected by `git2::Oid::from_str` with HTTP 400; (3) `docs/CHANGELOG.md` and PR body promise `authorEmail` in tooltips and commit details, but DTOs and UI components omit email; (4) `review.md` contains an inconsistent future-dated UTC timestamp (`10:25:00Z` vs PR creation `03:49Z`), and human visual sign-off remains unverified against captured screenshots; (5) `.omp/evcrate/scripts/worktree.cjs` commits a machine-specific absolute symlink.

### Critical Issues
None.

### High Priority Findings
1. **Tautological E2E Dirty Buffer Attribution (`packages/ui/e2e/editor-git-blame/editor-git-blame.spec.ts:85-87`)**:
   - *Trigger:* Clean fixture `modifiedCode` ends with `\n` (`git-fixture.ts:128`). `server/src/git/blame.rs:347-371` appends a terminal uncommitted row on line 5 *before* dirty edits.
   - *Observable harm:* In clean state, row 5 already has `data-uncommitted="true"`. Step 4 types content on line 6, but `page.locator(".editor-blame-row[data-uncommitted='true']").first()` matches pre-existing line 5. Assertion passes without verifying attribution of the newly typed line.
   - *Minimal fix:* Target the exact edited line (`.editor-blame-row[data-line='6'][data-uncommitted='true']`), verify uncommitted row count increases, or edit existing committed line 3 and verify attribution transitions from Bob to Uncommitted.
2. **64-Hex SHA-256 OID Contract Mismatch (`server/src/git/commit_details.rs:16,27-28`, `docs/api/git.md:247-272`)**:
   - *Trigger:* `GET /api/git/{project}/commit/{hash}/details` called with a 64-hex SHA-256 hash.
   - *Observable harm:* Lexical check allows 64 hex characters, but `git2::Oid::from_str(trimmed_hash)` fails with `"failed to parse commit hash: too long"`, returning HTTP 400 `GIT_BLAME_INVALID_INPUT`. SHA-256 inspection fails at runtime.
   - *Minimal fix:* Restrict lexical validation, docs, and route descriptions to 40-character hexadecimal SHA-1 OIDs until libgit2 SHA-256 backend support is integrated.
3. **Unfulfilled `authorEmail` Contract in Blame / Commit Metadata (`docs/CHANGELOG.md:6`, PR #48 Body)**:
   - *Trigger:* Consumer relies on CHANGELOG or PR body promise of author email in tooltips and commit details.
   - *Observable harm:* `GitBlameCommit` and `GitCommitDetails` structs omit `author_email`; `EditorGitBlameRow.tsx` and `CommitDetailsPanel.tsx` do not display email.
   - *Minimal fix:* Align `docs/CHANGELOG.md` and PR description with actual DTO fields (author name, timestamp, timezone offset, hash, subject).
4. **Inconsistent Future-Dated Visual Review Provenance (`packages/ui/e2e/editor-git-blame/review.md:5-7`)**:
   - *Trigger:* `review.md` records reviewed timestamp `2026-10-06T10:25:00Z`, which is future-dated relative to PR creation (`03:49Z`) and current UTC run time (likely local time formatted with `Z`).
   - *Observable harm:* Audit provenance is inconsistent; human visual sign-off against the 5 captured PNG checkpoints remains unverified.
   - *Minimal fix:* Normalize review timestamp to actual UTC execution time and retain status as pending until operator visually reviews checkpoints.

### Medium Priority Improvements
1. **Absolute Worktree Symlink Portability (`.omp/evcrate/scripts/worktree.cjs:1`)**:
   - Committed symlink targets `/home/loidinh/.omp/agent/evcrate/scripts/worktree.cjs`. Non-portable; breaks when cloned in CI or other workstations.
   - *Fix:* Replace with a relative symlink or an inline script wrapper.

### Positive Observations
- Container runtime cleanly updated with `git` CLI (`application-runtime.Dockerfile`) using `--no-install-recommends` and package list cleanup.
- Component layout and geometry: Monaco line geometry aligns within 1 CSS px in Vitest browser mode, responsive width compaction (<640px) behaves as designed, and Enter key on row triggers commit reveal.
- Profile-qualified target isolation (`profileId` gating, single-flight aborting, epoch fencing) cleanly maintained in `useEditorGitBlame`.
- Documentation consolidation: `docs/CHANGELOG.md` successfully consolidated historical entries under 709 LOC, comfortably within the 800 LOC guideline.
- `.omp/evcrate/scripts/validate-docs.cjs` provides a non-blocking diagnostic tool for internal file paths.

### Recommended Actions
1. Update E2E spec line 85 to assert `data-line="6"` or edit committed line 3 to prove true dirty state transition.
2. Correct `server/src/git/commit_details.rs` to validate only 40-hex SHA-1 OIDs and align `docs/api/git.md` / PR body.
3. Remove `authorEmail` claims from `docs/CHANGELOG.md` and PR body.
4. Replace machine-specific absolute symlink `.omp/evcrate/scripts/worktree.cjs` with a portable relative reference.

### Metrics
- Reviewer Verification: Read-only static review; no test commands executed by this reviewer agent.
- Parent Verification: 9/9 server API, 57/57 targeted UI, 1/1 Playwright E2E passed cleanly.
- PR Self-Reported Metrics: 25 native blame/API tests, 170 UI unit/hook tests, 3 browser mode tests reported passing.

### Unresolved Questions
- Is 40-hex SHA-1 sufficient for the milestone, or is full Git SHA-256 repository support required?
- Has the human operator visually confirmed the 5 captured PNG checkpoints in `packages/ui/e2e/editor-git-blame/`?
