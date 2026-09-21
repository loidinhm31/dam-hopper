# Investigation Report: GitHub Actions Release Tag Alignment Failure

- **Target Run**: GitHub Actions run `35520912396`
- **Target Job**: `106104716958` (`validate-metadata` / "Validate release version and metadata")
- **Failed Step**: Step 5 ("Verify version alignment across Cargo and web packages")
- **Workflow**: `Release Linux (x86_64)` (`.github/workflows/release-linux.yml`)
- **Repository**: `loidinhm31/dam-hopper`
- **Failing Ref / Tag**: `refs/tags/v0.4.2`
- **Failing Commit**: `df8f7b32602518b060794ffd47e7b9ec981a589a` ("fix(ui): bind FileTree fs events to profile transport and contain failures")
- **Investigation Date**: 2026-09-20

---

## 1. Executive Summary

### Issue Description & Business Impact
GitHub Actions Linux release pipeline failed immediately at Step 5 of the `validate-metadata` job when executing `node deploy/release/check-version-alignment.mjs "v0.4.2"`. 

The release process halted before building Rust release binaries, compiling web assets, creating packages, or publishing the GitHub release. Release `v0.4.2` cannot be distributed until metadata validation succeeds.

### Root Cause Identification
Git tag `v0.4.2` points to the wrong commit (`df8f7b32602518b060794ffd47e7b9ec981a589a`), which was the head of feature branch `origin/bugfix/filetree-bind-fs-event`. At that commit:
- `server/Cargo.toml` specifies `version = "0.4.1"`
- `apps/web/package.json` specifies `"version": "0.4.1"`

The actual version bump to `0.4.2` (`chore(release): bump version to 0.4.2`) was committed later on `main` at `b79b87b8c4ebc71f5740f7542ef70aa4722d2569`. Because CI checked out `refs/tags/v0.4.2` (`df8f7b32`), the validator script detected a mismatch between expected release tag `v0.4.2` and repository manifest version `0.4.1`.

### Recommended Solutions & Priority
| Priority | Solution | Effort | Impact |
| :--- | :--- | :--- | :--- |
| **P0 (Immediate)** | Move tag `v0.4.2` to commit `b79b87b8` (HEAD of `main`) and push with `--force` | 1 min | Resolves CI release failure, triggers valid build/release |
| **P1 (Process)** | Automate tag creation from release script or verify HEAD commit contains target version before tagging | 15 mins | Prevents tagging wrong commits in future releases |

---

## 2. Technical Analysis

### 2.1 Timeline of Events
- **2026-09-20 18:35:39 +0700**: Commit `df8f7b32` made on branch `bugfix/filetree-bind-fs-event` (version `0.4.1`).
- **2026-09-20 22:49:44 +0700 (15:49:44 UTC)**: Release bump commit `b79b87b8` created on `main` bumping all workspace manifests (`Cargo.toml`, `package.json`, `tauri.conf.json`) to `0.4.2`.
- **2026-09-20 15:52:04 UTC**: Tag `v0.4.2` pushed pointing to `df8f7b32` instead of `b79b87b8`.
- **2026-09-20 15:52:04 UTC**: Release workflow `release-linux.yml` triggered (run `35520912396`).
- **2026-09-20 15:52:10 UTC**: Runner checked out `refs/tags/v0.4.2` (`df8f7b32`).
- **2026-09-20 15:52:11 UTC**: Step 5 executed `check-version-alignment.mjs "v0.4.2"`, threw mismatch error against repository version `0.4.1`, exited with code 1.

### 2.2 Evidence from GitHub Actions Log
From `gh run view 35520912396 --job 106104716958 --log`:
```text
Validate release version and metadata  Run actions/checkout@v4  2026-09-20T15:52:10.5396870Z [command]/usr/bin/git checkout --progress --force refs/tags/v0.4.2
Validate release version and metadata  Run actions/checkout@v4  2026-09-20T15:52:10.7107241Z HEAD is now at df8f7b3 fix(ui): bind FileTree fs events to profile transport and contain failures
Validate release version and metadata  Run actions/checkout@v4  2026-09-20T15:52:10.7176608Z df8f7b32602518b060794ffd47e7b9ec981a589a
...
Validate release version and metadata  Resolve release tag and version  2026-09-20T15:52:11.4875208Z TAG="v0.4.2"
Validate release version and metadata  Resolve release tag and version  2026-09-20T15:52:11.4877636Z echo "tag=${TAG}" >> "$GITHUB_OUTPUT"
...
Validate release version and metadata  Verify version alignment across Cargo and web packages  2026-09-20T15:52:11.5365880Z node deploy/release/check-version-alignment.mjs "v0.4.2"
Validate release version and metadata  Verify version alignment across Cargo and web packages  2026-09-20T15:52:11.5753321Z Provided release tag 'v0.4.2' does not match repository version '0.4.1'
Validate release version and metadata  Verify version alignment across Cargo and web packages  2026-09-20T15:52:11.5754054Z   Expected tag: v0.4.1
Validate release version and metadata  Verify version alignment across Cargo and web packages  2026-09-20T15:52:11.5754430Z   Got:          v0.4.2
Validate release version and metadata  Verify version alignment across Cargo and web packages  2026-09-20T15:52:11.5790091Z ##[error]Process completed with exit code 1.
```

### 2.3 Git Topology Analysis
```text
* b79b87b8 (HEAD -> main, origin/main) chore(release): bump version to 0.4.2  <-- HAS 0.4.2 MANIFESTS
*   6a0134d4 Merge remote-tracking branch 'origin/bugfix/filetree-bind-fs-event'
|\  
| * df8f7b32 (tag: v0.4.2, origin/bugfix/filetree-bind-fs-event)             <-- TAGGED WRONGLY (HAS 0.4.1 MANIFESTS)
* | 66fec720 feat(windows): configure default server binary
* | 798184b6 test(windows): make test harness platform-safe
* | c3de8c26 feat(config): normalize Windows paths
|/  
* 351a4499 (tag: v0.4.1) chore(release): bump version to 0.4.1
```

### 2.4 Version Verification
1. Manifest state at commit `df8f7b32` (tagged):
   - `server/Cargo.toml`: `version = "0.4.1"`
   - `apps/web/package.json`: `"version": "0.4.1"`
   - Result: `check-version-alignment.mjs "v0.4.2"` fails.

2. Manifest state at commit `b79b87b8` (`main`):
   - `server/Cargo.toml`: `version = "0.4.2"`
   - `apps/web/package.json`: `"version": "0.4.2"`
   - `apps/native/src-tauri/Cargo.toml`: `version = "0.4.2"`
   - `apps/native/src-tauri/tauri.conf.json`: `"version": "0.4.2"`
   - `apps/native/package.json`: `"version": "0.4.2"`
   - `apps/browser-extension/package.json`: `"version": "0.4.2"`
   - `packages/ui/package.json`: `"version": "0.4.2"`
   - `packages/shared/package.json`: `"version": "0.4.2"`
   - `packages/browser-bridge/package.json`: `"version": "0.4.2"`
   - Local validation run:
     ```bash
     $ node deploy/release/check-version-alignment.mjs "v0.4.2"
     ✓ Release version alignment verified: v0.4.2 (0.4.2)
     ```

---

## 3. Actionable Recommendations

### 3.1 Immediate Fix (P0)
Retag commit `b79b87b8` as `v0.4.2` and update origin tag:

```bash
# 1. Update local tag v0.4.2 to point to commit b79b87b8 (current main)
git tag -f v0.4.2 b79b87b8

# 2. Force push updated tag to remote
git push origin v0.4.2 --force
```

If the remote repository enforces tag protection preventing `--force`, delete and recreate:
```bash
git push origin :refs/tags/v0.4.2
git tag -f v0.4.2 b79b87b8
git push origin v0.4.2
```

This will trigger `Release Linux (x86_64)` on the correct commit where `check-version-alignment.mjs` will pass.

### 3.2 Preventive Measures (P1)
- Add tag pre-push verification script or git pre-push hook checking that `node deploy/release/check-version-alignment.mjs "${TAG}"` passes locally before pushing release tags.
- Enforce release tag creation through release script (e.g. `pnpm run release:tag`) rather than manual git tagging on feature branches.

---

## 4. Supporting Evidence
- Run URL: https://github.com/loidinhm31/dam-hopper/actions/runs/35520912396
- Job URL: https://github.com/loidinhm31/dam-hopper/actions/runs/35520912396/job/106104716958
- Git tag ref inspection:
  ```json
  {
    "ref": "refs/tags/v0.4.2",
    "object": {
      "sha": "df8f7b32602518b060794ffd47e7b9ec981a589a",
      "type": "commit"
    }
  }
  ```
- Commit `b79b87b8` diff summary:
  `14 files changed, 16 insertions(+), 14 deletions(-)` bumping all component versions from `0.4.1` to `0.4.2`.

---

## 5. Unresolved Questions
None. Root cause and immediate fix are fully verified.
