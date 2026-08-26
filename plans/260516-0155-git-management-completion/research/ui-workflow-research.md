# Research: Git UI Workflow

Date: 2026-05-16

## Existing UX Pattern

DamHopper UI is compact and work-focused. The right implementation should add controls inside existing panels, not introduce a large new Git dashboard.

## Branch Control

Add a reusable compact control:

- Current branch indicator with `GitBranch` icon.
- Branch dropdown grouped as local and remote branches.
- Create branch button.
- Error/status banner inline or via compact dialog state.

Use it in:

- `WorkspaceGitPanel` header.
- `FileTree` Explorer header beside the project label.

Remote branch behavior:

- Selecting `origin/foo` creates/checks out local `foo` with tracking from `origin/foo`.
- If local `foo` exists, checkout local `foo`.

## History Context Menu

Right-click on commit row should show:

- `Cherry-pick: <short-hash>`
- `Reset current branch to here`

Reset should open a dialog with four explicit modes. Hard reset must be visually dangerous and require confirmation.

## Mutation Feedback

After success:

- Branch picker should reflect new current branch.
- Git log should refresh.
- Local changes should refresh.
- Explorer tree should refresh after checkout/reset.

After conflict:

- Show a compact error/status message.
- Invalidate `git-conflicts`, `git-diff`, and project status so the existing conflict workflow appears.

## Unresolved Questions

None.
