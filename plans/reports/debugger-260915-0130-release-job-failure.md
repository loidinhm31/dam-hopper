# Incident Diagnostic Report: GitHub Actions Release Job Failure

- **Date / Time**: 2026-09-15 01:30:10 (Asia/Saigon)
- **Target Repository**: `loidinhm31/dam-hopper`
- **Run ID**: [34878828178](https://github.com/loidinhm31/dam-hopper/actions/runs/34878828178)
- **Job ID**: [104092676036](https://github.com/loidinhm31/dam-hopper/actions/runs/34878828178/job/104092676036)
- **Workflow**: `Release Linux (x86_64)` (`.github/workflows/release-linux.yml`)
- **Status**: Failed (Exit code 1)

---

## 1. Executive Summary

- **Failure Point**: Workflow `Release Linux (x86_64)` failed in job `Validate release version and metadata` during step `Verify version alignment across Cargo and web packages`.
- **Command Executed**: `node deploy/release/check-version-alignment.mjs "v0.3.1"`
- **Immediate Failure Reason**: Strict version alignment gate rejected release tag `v0.3.1` because canonical repository manifests (`server/Cargo.toml` and `apps/web/package.json`) specify version `0.3.0`.
- **Impact**: Entire release pipeline blocked. Downstream binary compilation, web asset bundling, deterministic packaging, artifact attestation, and GitHub release publishing were skipped.

---

## 2. Technical Analysis & Log Evidence

### 2.1 Job Execution Details
- **Trigger**: `push` event for Git tag `v0.3.1` pointing to commit `b658ee0288eeb9e968e06c970e05250dcc9c1fee` (`Merge pull request #33 from loidinhm31/develop`).
- **Job Name**: `Validate release version and metadata` (Job ID: `104092676036`)
- **Failing Step**: `Verify version alignment across Cargo and web packages` (Step index 5)

### 2.2 Raw Log Excerpt
```text
Validate release version and metadata	Verify version alignment across Cargo and web packages	2026-09-14T18:07:04.5824626Z ##[group]Run node deploy/release/check-version-alignment.mjs "v0.3.1"
Validate release version and metadata	Verify version alignment across Cargo and web packages	2026-09-14T18:07:04.5825251Z node deploy/release/check-version-alignment.mjs "v0.3.1"
Validate release version and metadata	Verify version alignment across Cargo and web packages	2026-09-14T18:07:04.5858865Z shell: /usr/bin/bash -e {0}
Validate release version and metadata	Verify version alignment across Cargo and web packages	2026-09-14T18:07:04.5859199Z env:
Validate release version and metadata	Verify version alignment across Cargo and web packages	2026-09-14T18:07:04.5859457Z   CARGO_TERM_COLOR: always
Validate release version and metadata	Verify version alignment across Cargo and web packages	2026-09-14T18:07:04.5859749Z   RUST_BACKTRACE: 1
Validate release version and metadata	Verify version alignment across Cargo and web packages	2026-09-14T18:07:04.5860008Z ##[endgroup]
Validate release version and metadata	Verify version alignment across Cargo and web packages	2026-09-14T18:07:04.6212039Z Provided release tag 'v0.3.1' does not match repository version '0.3.0'
Validate release version and metadata	Verify version alignment across Cargo and web packages	2026-09-14T18:07:04.6213052Z   Expected tag: v0.3.0
Validate release version and metadata	Verify version alignment across Cargo and web packages	2026-09-14T18:07:04.6213437Z   Got:          v0.3.1
Validate release version and metadata	Verify version alignment across Cargo and web packages	2026-09-14T18:07:04.6246255Z ##[error]Process completed with exit code 1.
```

---

## 3. Root Cause Identification

### 3.1 Workflow Configuration
File: `.github/workflows/release-linux.yml`
- Lines 4–6: Workflow triggers on tags matching `v*`:
  ```yaml
  on:
    push:
      tags:
        - "v*"
  ```
- Lines 41–53: Step `Resolve release tag and version` extracts tag `v0.3.1` and passes output `tag=v0.3.1`.
- Lines 55–58: Step `Verify version alignment across Cargo and web packages` invokes:
  ```yaml
  - name: Verify version alignment across Cargo and web packages
    run: |
      node deploy/release/check-version-alignment.mjs "${{ steps.resolve.outputs.tag }}"
  ```

### 3.2 Enforcement Script
File: `deploy/release/check-version-alignment.mjs`
- Lines 105–106: Reads canonical versions:
  - `server/Cargo.toml` -> `0.3.0` (line 70–79)
  - `apps/web/package.json` -> `0.3.0` (line 81–88)
- Lines 144–149: Compares normalized tag version (`0.3.1`) against canonical version (`0.3.0`):
  ```javascript
  if (normalizedExpectedVersion !== canonicalVersion) {
    console.error(`Provided release tag '${expectedTag}' does not match repository version '${canonicalVersion}'
    Expected tag: ${canonicalTag}
    Got:          ${expectedTag}`);
    process.exit(1);
  }
  ```
- Because `"0.3.1" !== "0.3.0"`, the process exits with code 1.

### 3.3 Historical & Repository Context
- Commit `ef9dcd76` (`chore(release): bump version to 0.3.0 and support local bundle in installer`) bumped repository manifests across 12 files from `0.2.0` to `0.3.0`.
- All verification reports (e.g. `plans/reports/qa-260914-0139-idle-suspend-release-verification.md`) and pre-release gates were executed and approved for version `v0.3.0`.
- Latest published release on GitHub is `v0.2.0`. No `v0.3.0` release exists.
- Tag `v0.3.1` was pushed directly to GitHub on merge commit `b658ee02` without bumping package manifests or running `pnpm release:check-version`.

---

## 4. Actionable Recommendations

### Option A: Release as `v0.3.0` (Recommended)
If the intention was to publish version `0.3.0` (matching all codebase manifests and release evidence):
1. Delete the incorrect remote and local `v0.3.1` tag:
   ```bash
   git tag -d v0.3.1
   git push origin --delete v0.3.1
   ```
2. Create and push tag `v0.3.0` on commit `b658ee02` (or current `main` HEAD):
   ```bash
   git tag v0.3.0 b658ee02
   git push origin v0.3.0
   ```
3. GitHub Actions `Release Linux (x86_64)` will trigger automatically and succeed through all release gates.

---

### Option B: Release as `v0.3.1`
If version `0.3.1` is deliberately required instead of `0.3.0`:
1. Bump version from `0.3.0` to `0.3.1` in all workspace manifests:
   - `server/Cargo.toml` (`version = "0.3.1"`)
   - `server/Cargo.lock`
   - `apps/web/package.json` (`"version": "0.3.1"`)
   - `apps/browser-extension/package.json` (`"version": "0.3.1"`)
   - `apps/native/package.json` (`"version": "0.3.1"`)
   - `apps/native/src-tauri/Cargo.toml` (`version = "0.3.1"`)
   - `apps/native/src-tauri/tauri.conf.json` (`"version": "0.3.1"`)
   - `packages/browser-bridge/package.json` (`"version": "0.3.1"`)
   - `packages/shared/package.json` (`"version": "0.3.1"`)
   - `packages/ui/package.json` (`"version": "0.3.1"`)
   - `tests/deploy/linux-release-rootless-smoke.sh` (`TARGET_VERSION="v0.3.1"`)
   - `scripts/run-uat.sh` (`"releaseVersion": "0.3.1"`)
2. Verify locally:
   ```bash
   node deploy/release/check-version-alignment.mjs "v0.3.1"
   ```
3. Commit, push to `main`, re-tag `v0.3.1` to the new commit, and push tag `v0.3.1`:
   ```bash
   git push origin --delete v0.3.1
   git tag -f v0.3.1 HEAD
   git push origin v0.3.1
   ```

---

## 5. Unresolved Questions

1. Was tag `v0.3.1` created as an inadvertent typo instead of `v0.3.0`, or was `v0.3.0` intentionally skipped?
