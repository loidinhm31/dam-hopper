# Investigation Report: GitHub Actions CI & Pages Deployment Failure

- **Target Run**: GitHub Actions run `35519903159`
- **Target Job**: `106102527885` (`deploy`, step 5 line 17)
- **Workflow**: `Deploy Web to GitHub Pages` (`.github/workflows/deploy-pages.yml`)
- **Repository**: `loidinhm31/dam-hopper`
- **Commit**: `1bd0a970fad5714c7c4fa1185485a3b0dab221a4` ("chore(release): bump version to 0.4.2")
- **Investigation Date**: 2026-09-20
- **Scope**: Diagnostic analysis and remediation plan.

---

## 1. Executive Summary

### Issue Description & Business Impact
GitHub Pages deployment workflow failed during step 5 (`Install dependencies` / `pnpm install`) with `ERR_PNPM_FETCH_404` attempting to fetch `https://registry.npmjs.org/json-schema-traverse/-/json-schema-traverse-0.4.2.tgz`. 

Concurrently, the primary CI workflow (`CI`, run `35519903156`) failed on the same commit in:
1. `Rust tests` (`cargo test --features vendored` in `server`): `error: failed to select a version for the requirement headers = "^0.4.0" (locked to 0.4.2)`
2. `Native Windows build gate` (`pnpm install --frozen-lockfile`): `ERR_PNPM_FETCH_404` for `json-schema-traverse-0.4.2.tgz`

This blocks deployment of the web app to GitHub Pages, halts CI on `main`, and breaks local builds for any clean environment.

### Root Cause Identification
An unconstrained global string search-and-replace (`0.4.1` -> `0.4.2`) was executed across the repo during release bumping in commit `1bd0a970`. Instead of updating only project manifest versions (`package.json`, `Cargo.toml`, `tauri.conf.json`), the replacement modified lockfiles:
1. `pnpm-lock.yaml`: replaced external package versions `0.4.1` with non-existent `0.4.2` for:
   - `json-schema-traverse` (npm versions jump 0.4.1 -> 0.5.0 / 1.0.0; 0.4.2 does not exist)
   - `@eslint/plugin-kit` (0.4.2 does not exist on npm)
   - `levn` (0.4.2 does not exist on npm)
2. `server/Cargo.lock`: replaced third-party crate versions with non-existent `0.4.2`:
   - `headers` (locked to 0.4.2; does not exist on crates.io, requirement was `^0.4.0`)
   - `dirs-sys` (locked to 0.4.2)
   - `rustc_version` (locked to 0.4.2)
   - `windows-result` (locked to 0.4.2)
3. `apps/native/src-tauri/Cargo.lock`: replaced third-party crate versions:
   - `heck` (0.4.1 -> 0.4.2)
   - `jni-sys` (0.4.1 -> 0.4.2)
   - `jni-sys-macros` (0.4.1 -> 0.4.2)
   - `rustc_version` (0.4.1 -> 0.4.2)
   - `windows-result` (0.4.1 -> 0.4.2)

### Recommended Solutions & Priority
| Priority | Solution | Effort | Impact |
| :--- | :--- | :--- | :--- |
| **P0 (Immediate)** | Revert unintended 0.4.1 -> 0.4.2 changes in `pnpm-lock.yaml`, `server/Cargo.lock`, and `apps/native/src-tauri/Cargo.lock` | 5 mins | Restores CI and Pages deployment immediately |
| **P1 (Preventive)** | Scope version bumping script or add release checklist to avoid regex replacement over lockfiles | 30 mins | Prevents lockfile corruption on future releases |

---

## 2. Technical Analysis

### 2.1 Timeline of Events
- **2026-09-20 15:25 UTC**: Commit `35519535733` attempted bump to `0.4.12` and failed CI.
- **2026-09-20 15:32 UTC**: Commit `1bd0a970fad5714c7c4fa1185485a3b0dab221a4` pushed to `main` titled `chore(release): bump version to 0.4.2`.
- **2026-09-20 15:32:32 UTC**: CI run `35519903156` triggered. `Rust tests` failed in 20s; `Native Windows build gate` failed in 1m14s.
- **2026-09-20 15:35:46 UTC**: Deploy Pages run `35519903159` triggered. Failed in 20s at `Install dependencies`.

### 2.2 Evidence from Logs
#### GitHub Actions Run `35519903159`, Job `106102527885` (`deploy`):
```text
deploy  Install dependencies  2026-09-20T15:36:02.5316458Z pnpm install
deploy  Install dependencies  2026-09-20T15:36:02.8111679Z Scope: all 7 workspace projects
deploy  Install dependencies  2026-09-20T15:36:02.8491147Z Lockfile is up to date, resolution step is skipped
deploy  Install dependencies  2026-09-20T15:36:03.0404584Z Packages: +629
deploy  Install dependencies  2026-09-20T15:36:03.8102578Z  ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/json-schema-traverse/-/json-schema-traverse-0.4.2.tgz: Not Found - 404
deploy  Install dependencies  2026-09-20T15:36:04.0601051Z ##[error]Process completed with exit code 1.
```

#### GitHub Actions Run `35519903156`, Job `Rust tests`:
```text
Rust tests  Run tests  2026-09-20T15:32:52.0767097Z     Updating crates.io index
Rust tests  Run tests  2026-09-20T15:32:52.2694321Z error: failed to select a version for the requirement `headers = "^0.4.0"` (locked to 0.4.2)
Rust tests  Run tests  2026-09-20T15:32:52.2695284Z candidate versions found which didn't match: 0.4.1, 0.4.0, 0.3.9, ...
Rust tests  Run tests  2026-09-20T15:32:52.2696134Z location searched: crates.io index
Rust tests  Run tests  2026-09-20T15:32:52.2696662Z required by package `axum-extra v0.10.3`
Rust tests  Run tests  2026-09-20T15:32:52.2697883Z     ... which satisfies dependency `axum-extra = "^0.10"` (locked to 0.10.3) of package `dam-hopper-server v0.4.2 (/home/runner/work/dam-hopper/dam-hopper/server)`
Rust tests  Run tests  2026-09-20T15:32:52.2752025Z ##[error]Process completed with exit code 101.
```

### 2.3 Verification of Package Availability
- `npm view json-schema-traverse versions`:
  Available: `['0.0.1', '0.1.0', '0.2.0', '0.3.0', '0.3.1', '0.4.0', '0.4.1', '0.5.0', '1.0.0']`. Version `0.4.2` does not exist.
  Integrity in lockfile `sha512-xbbCH5dCYU5T8LcEhhuh7HJ88HXuW3qsI3Y0zOZFKfZEHcpWiHU/Jxzk629Brsab/mMiHQti9wMP+845RPe3Vg==` belongs to `0.4.1`.
- `npm view @eslint/plugin-kit versions`:
  Versions: `... '0.4.0', '0.4.1', '0.5.0' ...`. Version `0.4.2` does not exist.
- `npm view levn versions`:
  Versions: `... '0.4.0', '0.4.1'`. Version `0.4.2` does not exist.
- `crates.io headers`:
  Candidate versions matching `^0.4.0`: `0.4.1`, `0.4.0`. Version `0.4.2` does not exist.

---

## 3. Actionable Recommendations

### 3.1 Immediate Fix (P0)

Revert the third-party dependency lines in lockfiles back to `0.4.1` while preserving genuine workspace bumps (`dam-hopper-server`, `dam-hopper-native`, workspace `package.json` files):

1. **`pnpm-lock.yaml`**:
   - Revert lines touching `@eslint/plugin-kit@0.4.2` -> `@eslint/plugin-kit@0.4.1`
   - Revert `json-schema-traverse@0.4.2` -> `json-schema-traverse@0.4.1`
   - Revert `levn@0.4.2` -> `levn@0.4.1`
   *(Since no workspace package resolution changed in `pnpm-lock.yaml`, reverting `pnpm-lock.yaml` directly to `1bd0a970~1` restores full integrity)*

2. **`server/Cargo.lock`**:
   - Keep `dam-hopper-server` version `0.4.2`
   - Revert `dirs-sys`, `headers`, `rustc_version`, `windows-result` version entries and dependency references back to `0.4.1`

3. **`apps/native/src-tauri/Cargo.lock`**:
   - Keep `dam-hopper-native` version `0.4.2`
   - Revert `heck`, `jni-sys`, `jni-sys-macros`, `rustc_version`, `windows-result` version entries and dependency references back to `0.4.1`

### 3.2 Verification Command
```bash
# Verify Rust server lockfile resolution
cargo check --manifest-path server/Cargo.toml

# Verify Native lockfile resolution
cargo check --manifest-path apps/native/src-tauri/Cargo.toml

# Verify pnpm lockfile resolution
pnpm install --frozen-lockfile
```

### 3.3 Preventive Measures (P1)
- Never use global textual search/replace for semver version bumps across repository.
- Use explicit tools (e.g. `pnpm version`, `cargo set-version`, or target-specific scripts) that modify only specified `package.json` and `Cargo.toml` targets, followed by running `pnpm install --lockfile-only` and `cargo check --workspace` to let the package managers update lockfiles legitimately.
- Add lockfile validation or pre-commit checks ensuring lockfiles are not modified with text editor find-and-replace.

---

## 4. Supporting Evidence

### Commit `1bd0a970` Diff Breakdown
```
14 files changed, 36 insertions(+), 36 deletions(-)

Legitimate Project Version Bumps (0.4.1 -> 0.4.2):
- apps/browser-extension/package.json
- apps/native/package.json
- apps/native/src-tauri/Cargo.toml
- apps/native/src-tauri/tauri.conf.json
- apps/web/package.json
- packages/browser-bridge/package.json
- packages/shared/package.json
- packages/ui/package.json
- server/Cargo.toml
- scripts/run-uat.sh
- tests/deploy/linux-release-rootless-smoke.sh
- apps/native/src-tauri/Cargo.lock (dam-hopper-native only)
- server/Cargo.lock (dam-hopper-server only)

Inadvertent Lockfile Corruptions:
- pnpm-lock.yaml:
    @eslint/plugin-kit@0.4.1 -> 0.4.2
    json-schema-traverse@0.4.1 -> 0.4.2 (caused run 35519903159 failure)
    levn@0.4.1 -> 0.4.2
- server/Cargo.lock:
    dirs-sys, headers, rustc_version, windows-result (caused run 35519903156 failure)
- apps/native/src-tauri/Cargo.lock:
    heck, jni-sys, jni-sys-macros, rustc_version, windows-result
```

---

## 5. Unresolved Questions
None. Root cause, exact error mechanisms, and remediation steps are fully identified and verified against external registries (npm and crates.io).
