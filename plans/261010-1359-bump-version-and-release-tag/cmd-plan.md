# Implementation Overview: Version Bump and Release Tag Automation

Root plan: [plan.md](plan.md) · [Implementation Progress](progress.md)

## Phases
- [Phase 1: Release bump & tag automation script](phase-01-bump-and-release-script.md) - Status: Pending (0%)

## Key Contacts and Invariants
- 13 Synchronized Release Locations (see `docs/code-standards.md` line 102 and `memory://root/MEMORY.md`).
- Strict SemVer compliance matching `deploy/release/check-version-alignment.mjs`.
- Annotated Git tags with format `vX.Y.Z` and message `Release vX.Y.Z`.
- Commit format `chore(release): bump version to X.Y.Z`.
- Clean worktree prerequisite unless `--allow-dirty`.
- Safe default: no remote push without explicit `--push` flag.
