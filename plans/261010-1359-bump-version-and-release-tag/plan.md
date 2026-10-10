---
title: "Repository Version Bump, Release Tag, and Push Script"
description: "Implement a reusable automation script to bump all 13 synchronized release locations, refresh Cargo lockfiles, verify alignment, and create annotated release tags with push capability."
status: completed
priority: P2
effort: 3h
branch: main
tags: [devops, release, automation, git, tooling]
created: 2026-10-10
---

# Repository Version Bump, Release Tag, and Push Script

[Command overview](cmd-plan.md) · [Implementation Progress](progress.md) · [Phase 1 Specification](phase-01-bump-and-release-script.md)

## Scope and Acceptance
- Implement a reusable release automation script (`scripts/bump-version.mjs` and wrapper `scripts/bump-version.sh`) and add `"release:bump"` npm script in root `package.json`.
- Support semver increments (`patch`, `minor`, `major`) and explicit versions (`X.Y.Z` or `vX.Y.Z`).
- Safely synchronize all 13 documented release locations in DamHopper:
  1. `apps/browser-extension/package.json`
  2. `apps/native/package.json`
  3. `apps/native/src-tauri/Cargo.toml`
  4. `apps/native/src-tauri/tauri.conf.json`
  5. `apps/web/package.json`
  6. `packages/browser-bridge/package.json`
  7. `packages/shared/package.json`
  8. `packages/ui/package.json`
  9. `server/Cargo.toml`
  10. `scripts/run-uat.sh`
  11. `tests/deploy/linux-release-rootless-smoke.sh`
  12. `server/Cargo.lock` (refreshed via `cargo check --manifest-path server/Cargo.toml`)
  13. `apps/native/src-tauri/Cargo.lock` (refreshed via `cargo check --manifest-path apps/native/src-tauri/Cargo.toml`)
  Plus optional Android `apps/native/src-tauri/gen/android/app/tauri.properties` if present.
- Provide safety controls:
  - `--dry-run`: previews all version changes and git commands without modifying any files.
  - `--push`: pushes branch and tag to remote (`git push origin <branch> && git push origin <tag>`). Defaults to safe local tag creation and prints remote push instructions.
  - `--no-tag`: updates files and commits without creating a git tag.
  - `--no-commit`: updates files only without staging or committing.
  - `--allow-dirty`: permits running on an uncommitted worktree if explicitly desired.
- Provide automated regression test in `tests/deploy/bump-version.test.mjs` verifying SemVer calculations, dry-run simulation, and file update accuracy.

## Phases
| Phase | Status / progress | Effort | Detail |
|---|---|---|---|
| 1 Release bump & tag automation | completed / 100% | 3h | [Phase 1](phase-01-bump-and-release-script.md) |

## Exclusive file ownership
| Owner | Action | Exact path |
|---|---|---|
| 1 | C | `scripts/bump-version.mjs` |
| 1 | C | `scripts/bump-version.sh` |
| 1 | M | `package.json` |
| 1 | C | `tests/deploy/bump-version.test.mjs` |
