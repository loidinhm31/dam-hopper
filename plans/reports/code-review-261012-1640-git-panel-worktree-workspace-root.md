## Code Review Summary: Git panel worktree workspace root retention

### Scope
- packages/ui: WorkspacePage.tsx, WorkspaceGitPanel.tsx, ProjectInfoPanel.tsx, git-commit-reveal.ts, WorkspacePageBlameReveal.test.tsx, project-worktree-target.browser.tsx (~93 add/21 del)
- Plan: plans/261012-1614-git-worktree-workspace-root (not edited; check-list already ticked)

### Verification run
- `tsc --noEmit` ui: clean
- vitest (BlameReveal, GitPanelBlame, ProjectInfoPanel, WorkspaceGitPanel, WorkspacePage): 5 files / 57 tests pass
- browser project-worktree-target: 1/1 pass

### Overall
Correct core: 3 Git panel mounts share one root target/key/availability; reveal from worktree tab reaches root panel; owner (profile+generation) checks intact. No security regression found: profile/generation isolation still enforced in helper + panel.

### Critical
None.

### High
None.

### Medium
1. `isRootGitAvailable` semantics change vs old `projectTarget.available` (old: root => always true, no connection check). New adds `workspaceConnection.status==="connected"` gate only when `activeProfileId && workspaceConnection`; fail-open (`true`) when activeProfileId set but workspaceConnection null (no selectedProject + fallback not connected → null). Inconsistent: selectedProject+disconnected => false, no selectedProject+disconnected => true. Fix: `if (!projectName) return false; if (!activeProfileId) return true; return workspaceConnection?.status === "connected";`. Then add test for disconnected.
2. ProjectInfoPanel scope creep: Git Operations (fetch/pull/push/leased force-push) now always root, while header branch/dirty badge + Commands + Worktrees still follow selected worktree => UI inconsistency (badge shows worktree branch, push acts on root branch). Not in plan/phase files; no test (ProjectInfoPanel.test untouched). Confirm intent or add test + note; else revert.
3. Test gaps: (a) no unit test of `isGitCommitRevealRequestMatchingTarget` (no test file exists) for new root-accepts-worktree rule, nor negative cases (other project, owner mismatch, worktree-scoped current rejects other worktree); (b) no WorkspaceGitPanel test for root-scoped panel accepting worktree request (WorkspaceGitPanelBlame uses fixture target; new `else` branch uncovered); (c) new WorkspacePageBlameReveal test asserts only bottom-tool activation, not that `capturedGitPanelProps` got root target (`worktreePath` undefined), key, or revealRequest forwarded.
4. Docs: helper JSDoc ("Mismatched ... worktree rejects") now stale; docs/CHANGELOG.md + docs/architecture/workbench-files-editor-and-git.md / frontend-components/terminal-and-ide.md not updated for root-retained Git panel.

### Low
1. DRY: panel target-match logic (WorkspaceGitPanel.tsx:147-152) reimplements helper rules; helper ignores target.profileId, panel checks it. Worktree branch (`worktreePath != null`) is dead for WorkspacePage (always root) but kept for other callers/tests — ok, but extract shared predicate.
2. Helper: `requestWorktree` only used when current has worktree; WorkspacePage always passes root target, so that branch is dead in prod. Acceptable for generic util; simplify if no other callers (only 1 caller).
3. Stuck request: worktree-only rootId (nested repo/submodule absent in root panel's rootOptions) => panel never consumes, `gitCommitRevealRequest` never cleared, Git tab opened with nothing revealed. Pre-existing pattern but more reachable now. Consider clearing/notice.
4. Format: double blank line WorkspacePage.tsx:808-809; ProjectInfoPanel.tsx:105 >80 cols; `rootTargetRef` has explicit `profileId: undefined` and is non-memoized (harmless; target normalized per render anyway); new test line >80 cols.
5. IDE bottom-tool memo (WorkspacePage ~2190) still lists `projectTarget` — verify still used there (ProjectInfoPanel uses it, so fine).

### Positives
Single source of root target; keys include profile (`ambient` fallback) so profile switch remounts; browser test asserts both inclusion of root and exclusion of worktree for gitRoots/branches/gitLog while other features still bind to worktree; regression test would fail on old helper.

### Recommended actions
1. Fix `isRootGitAvailable` fail-open.
2. Decide ProjectInfoPanel behavior; add test.
3. Add helper unit test + root-scoped panel test; strengthen page test.
4. Update JSDoc, CHANGELOG/docs; tidy formatting.

### Metrics
tsc errors 0; tests 57/57 + browser 1/1. Lint not run.

### Unresolved questions
- Is ProjectInfoPanel Git Operations intentionally root-only when a worktree is selected?
- Should Git panel be unavailable when profile disconnected and no selectedProject?
