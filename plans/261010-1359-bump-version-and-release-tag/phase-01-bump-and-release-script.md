# Phase 1: Release Bump and Tag Automation Script

Parent plan: [plan.md](plan.md) · [Command Overview](cmd-plan.md) · [Progress Overview](progress.md)

## Context Links
- Reference Documentation: `docs/code-standards.md`, `memory://root/MEMORY.md` (13 Synchronized Release Locations).
- Baseline Reference Commit: `ec891293` (`chore(release): bump version to 0.11.0`).
- Alignment Checker: `deploy/release/check-version-alignment.mjs`.

## Overview
- Date: 2026-10-10
- Description: Create an automated, reusable script to bump all 13 synchronized release locations, refresh Cargo lockfiles, verify alignment, stage, commit, tag, and optionally push releases.
- Priority: P2
- Implementation Status: In Progress
- Review Status: Pending

## Key Insights
1. DamHopper requires 13 synchronized version locations; updating only a subset causes CI/CD failures and breaks installer/smoke test guarantees.
2. Direct text replacement in lockfiles risks altering unrelated crates (such as `sha2 0.11.0` or `aes-gcm 0.11.0`); lockfiles should be regenerated via Cargo CLI (`cargo check --manifest-path`).
3. Safe defaults are critical: git push should be opt-in via `--push` to prevent unintended remote pushes.
4. Dry-run mode (`--dry-run`) enables safe preview of planned changes and exact git commands.

## Requirements
1. Command Line Interface:
   - Usage: `node scripts/bump-version.mjs [patch|minor|major|vX.Y.Z|X.Y.Z] [options]` or `./scripts/bump-version.sh ...` or `pnpm release:bump ...`.
   - Options:
     - `--dry-run`: display planned updates and commands without altering disk or git.
     - `--push`: push release commit and tag to origin.
     - `--no-commit`: update version files and lockfiles only; skip git staging, commit, and tag.
     - `--no-tag`: commit changes but do not create git tag.
     - `--allow-dirty`: allow running with existing unstaged/staged git changes.
     - `--help`, `-h`: show usage guidance.
2. Synchronized Locations:
   - `apps/browser-extension/package.json`
   - `apps/native/package.json`
   - `apps/native/src-tauri/Cargo.toml`
   - `apps/native/src-tauri/tauri.conf.json`
   - `apps/web/package.json`
   - `packages/browser-bridge/package.json`
   - `packages/shared/package.json`
   - `packages/ui/package.json`
   - `server/Cargo.toml`
   - `scripts/run-uat.sh`
   - `tests/deploy/linux-release-rootless-smoke.sh`
   - Optional: `apps/native/src-tauri/gen/android/app/tauri.properties`
   - Lockfile refresh: `server/Cargo.lock` and `apps/native/src-tauri/Cargo.lock`.
3. Validation and Alignment:
   - Check alignment using `deploy/release/check-version-alignment.mjs`.
4. Git Integration:
   - Stage exact modified release files.
   - Commit: `chore(release): bump version to <canonical-version>`.
   - Annotated tag: `git tag -a <canonical-tag> -m "Release <canonical-tag>"`.
   - Push: `git push origin <branch> && git push origin <canonical-tag>` when `--push` is supplied.

## Related Code Files
- `scripts/bump-version.mjs` (New)
- `scripts/bump-version.sh` (New)
- `package.json` (Modified: add `"release:bump"` script)
- `tests/deploy/bump-version.test.mjs` (New)

## Implementation Steps
1. Author `scripts/bump-version.mjs` with modular functions for parsing SemVer, reading current version, updating each file type (JSON, TOML, shell scripts), executing Cargo lock refresh, verifying alignment, and running git commands.
2. Author `scripts/bump-version.sh` as an executable wrapper with POSIX error handling (`set -euo pipefail`).
3. Add `"release:bump": "node scripts/bump-version.mjs"` to `package.json`.
4. Author comprehensive test suite in `tests/deploy/bump-version.test.mjs`.
5. Verify dry-run behavior, flag parsing, error states, and alignment checks.

## Success Criteria
- [x] All 13 synchronized files and optional Android config covered.
- [x] Clean worktree check and `--dry-run` safety mode functional.
- [x] Cargo locks correctly updated via `cargo check`.
- [x] `pnpm release:check-version` validates successfully against new canonical tag.
- [x] Automated test suite passes.
