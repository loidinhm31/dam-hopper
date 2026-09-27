# Incident Diagnostic Report: Web Assets Build Failure in GitHub Actions

- **Date / Time**: 2026-09-19 21:00:04 (Asia/Saigon)
- **Target Repository**: `loidinhm31/dam-hopper`
- **Run ID**: [35446032666](https://github.com/loidinhm31/dam-hopper/actions/runs/35446032666)
- **Job ID**: [105905011716](https://github.com/loidinhm31/dam-hopper/actions/runs/35446032666/job/105905011716) ("Build web assets")
- **Workflow**: `Release Linux (x86_64)` (`.github/workflows/release-linux.yml`)
- **Trigger**: Push of Git tag `v0.4.0` (commit `86fb07747fd5dcb8250459c8a121858292930163`)
- **Status**: Failed (Exit code 1)

---

## 1. Executive Summary

- **Failure Point**: Workflow `Release Linux (x86_64)` failed in job `Build web assets` during step `Install dependencies`.
- **Failing Command**: `pnpm install --frozen-lockfile`
- **Error Code / Message**:
  ```text
  ERR_PNPM_LOCKFILE_CONFIG_MISMATCH Cannot proceed with the frozen installation. The current "patchedDependencies" configuration doesn't match the value found in the lockfile
  Update your lockfile using "pnpm install --no-frozen-lockfile"
  ```
- **Root Cause**: Tooling version divergence between local development and CI:
  1. Commit `d6757fa0` introduced `patchedDependencies` in `pnpm-workspace.yaml` and regenerated `pnpm-lock.yaml` using local `pnpm v10.28.2` (generating 64-character SHA-256 patch hashes).
  2. CI workflows (`.github/workflows/release-linux.yml`, `ci.yml`, `deploy-pages.yml`, `release.yml`) explicitly pin `pnpm/action-setup@v4` with `version: 9` (`pnpm v9.15.9`).
  3. `pnpm v9` does not read `patchedDependencies` from `pnpm-workspace.yaml` (in v9, this field is read only from root `package.json` under `pnpm.patchedDependencies`).
  4. `pnpm v9` finds zero patched dependencies configured (`{}`), whereas `pnpm-lock.yaml` contains two entries (`@radix-ui/react-compose-refs@1.1.2` and `@radix-ui/react-slot@1.2.3`).
  5. `pnpm install --frozen-lockfile` aborts with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.
- **Impact**: Release Linux workflow blocked. Downstream packaging, SBOM generation, artifact attestation, and release publishing did not execute. Multiple other CI runs (`CI` on `main`, `Deploy Web to GitHub Pages`) are experiencing identical failure.

---

## 2. Technical Analysis & Log Evidence

### 2.1 Job Details
- **Run ID**: `35446032666`
- **Job ID**: `105905011716`
- **Runner Environment**: Ubuntu 24.04.5 LTS (`ubuntu-24.04`), Runner image `20260907.300.1`
- **Tooling Installed in CI**:
  - `actions/checkout@v4` (detached HEAD at `refs/tags/v0.4.0`)
  - `pnpm/action-setup@v4` with `version: 9` -> resolved to `pnpm v9.15.9`
  - `actions/setup-node@v4` with `node-version: 24` -> resolved to Node `v24.20.0`
- **Failing Step**: Step index 5 (`Install dependencies`)

### 2.2 Complete Error Log Excerpt
```text
Build web assets	Install dependencies	2026-09-19T13:32:06.8317428Z ##[group]Run pnpm install --frozen-lockfile
Build web assets	Install dependencies	2026-09-19T13:32:06.8317843Z pnpm install --frozen-lockfile
Build web assets	Install dependencies	2026-09-19T13:32:06.8418837Z shell: /usr/bin/bash -e {0}
Build web assets	Install dependencies	2026-09-19T13:32:06.8419111Z env:
Build web assets	Install dependencies	2026-09-19T13:32:06.8419310Z   CARGO_TERM_COLOR: always
Build web assets	Install dependencies	2026-09-19T13:32:06.8419557Z   RUST_BACKTRACE: 1
Build web assets	Install dependencies	2026-09-19T13:32:06.8419829Z   PNPM_HOME: /home/runner/setup-pnpm/node_modules/.bin
Build web assets	Install dependencies	2026-09-19T13:32:06.8420147Z ##[endgroup]
Build web assets	Install dependencies	2026-09-19T13:32:07.2607087Z Scope: all 7 workspace projects
Build web assets	Install dependencies	2026-09-19T13:32:07.3090030Z  ERR_PNPM_LOCKFILE_CONFIG_MISMATCH  Cannot proceed with the frozen installation. The current "patchedDependencies" configuration doesn't match the value found in the lockfile
Build web assets	Install dependencies	2026-09-19T13:32:07.3091006Z 
Build web assets	Install dependencies	2026-09-19T13:32:07.3091297Z Update your lockfile using "pnpm install --no-frozen-lockfile"
Build web assets	Install dependencies	2026-09-19T13:32:07.3679568Z ##[error]Process completed with exit code 1.
```

---

## 3. Root Cause Investigation & Verification

### 3.1 Codebase Timeline
1. **Commit `d6757fa0` ("fix(deps): patch radix-ui composed refs and slot to prevent React 19 infinite update loop")**:
   - Added patch files:
     - `patches/@radix-ui__react-compose-refs@1.1.2.patch`
     - `patches/@radix-ui__react-slot@1.2.3.patch`
   - Added patch mapping to `pnpm-workspace.yaml`:
     ```yaml
     patchedDependencies:
       '@radix-ui/react-compose-refs@1.1.2': patches/@radix-ui__react-compose-refs@1.1.2.patch
       '@radix-ui/react-slot@1.2.3': patches/@radix-ui__react-slot@1.2.3.patch
     ```
   - Generated `pnpm-lock.yaml` with local `pnpm v10`:
     ```yaml
     patchedDependencies:
       '@radix-ui/react-compose-refs@1.1.2':
         hash: 96395d4aeaa163ac1a13c6dc74fda8d41f18aa6592c8e4db630931951e08ae48
         path: patches/@radix-ui__react-compose-refs@1.1.2.patch
       '@radix-ui/react-slot@1.2.3':
         hash: bdde3f913b11e210026897f387a423ae92bf9c1720d8f3babff25ca28ffbe811
         path: patches/@radix-ui__react-slot@1.2.3.patch
     ```

2. **Workflow Configuration**:
   - `.github/workflows/release-linux.yml` (lines 105–107, 147–149):
     ```yaml
     - uses: pnpm/action-setup@v4
       with:
         version: 9
     ```
   - Same `version: 9` pin exists in `.github/workflows/ci.yml`, `.github/workflows/deploy-pages.yml`, and `.github/workflows/release.yml`.

3. **Manifest Constraints in `package.json`**:
   ```json
   "engines": {
     "node": ">=20",
     "pnpm": ">=9"
   }
   ```
   No `"packageManager": "pnpm@..."` field is present.

### 3.2 Reproduction Experiments

#### Experiment 1: Running pnpm v9 locally
```bash
$ npx pnpm@9 install --frozen-lockfile
Scope: all 7 workspace projects
ERR_PNPM_LOCKFILE_CONFIG_MISMATCH Cannot proceed with the frozen installation. The current "patchedDependencies" configuration doesn't match the value found in the lockfile
Update your lockfile using "pnpm install --no-frozen-lockfile"
```
**Result**: 100% reproducible identical failure.

#### Experiment 2: Running pnpm v10 locally
```bash
$ npx pnpm@10 install --frozen-lockfile
Scope: all 7 workspace projects
Lockfile is up to date, resolution step is skipped
Done in 793ms using pnpm v10.34.5
```
**Result**: Clean zero-error installation. Lockfile is completely valid under pnpm v10.

#### Experiment 3: Attempting pnpm v9 compatibility by moving `patchedDependencies` to `package.json`
- In `pnpm v10`, patch hashes are 64-character SHA-256 strings:
  `hash: 96395d4aeaa163ac1a13c6dc74fda8d41f18aa6592c8e4db630931951e08ae48`
- In `pnpm v9`, patch hashes are short base32-encoded strings:
  `hash: dywoig7a3opq2ghbenhhazfrzu`
- Even if `patchedDependencies` was placed in root `package.json`, pnpm v9 calculates a completely different hash from pnpm v10, causing lockfile churn and conflicts.

### 3.3 Additional Observation in `Dockerfile`
- `Dockerfile` lines 31-40:
  ```dockerfile
  RUN corepack enable && corepack prepare pnpm@9 --activate
  COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
  ...
  RUN pnpm install --frozen-lockfile
  ```
  - Pinned to `pnpm@9`.
  - Does not copy `patches/` before running `pnpm install`, which will cause container build failure when evaluating patched dependencies.

---

## 4. Actionable Recommendations

### Recommendation A: Standardize on pnpm v10 across Workflows and Repo (Preferred)

1. **Update GitHub Actions Workflows**:
   Change `version: 9` to `version: 10` (or `version: 10.28.2`) across all workflow definitions:
   - `.github/workflows/release-linux.yml` (lines 107, 149)
   - `.github/workflows/ci.yml` (lines 38, 116, 145, 201)
   - `.github/workflows/deploy-pages.yml` (line 32)
   - `.github/workflows/release.yml` (lines 24, 91)

2. **Update Root `package.json`**:
   Pin package manager and update engine constraint:
   ```json
   "packageManager": "pnpm@10.28.2",
   "engines": {
     "node": ">=20",
     "pnpm": ">=10"
   }
   ```
   Setting `"packageManager"` allows `pnpm/action-setup@v4` to infer the exact pnpm version automatically when `version` is omitted.

3. **Update `Dockerfile`**:
   - Update `pnpm@9` to `pnpm@10`:
     ```dockerfile
     RUN corepack enable && corepack prepare pnpm@10 --activate
     ```
   - Ensure `COPY patches ./patches` precedes `RUN pnpm install --frozen-lockfile`.

4. **Verify Locally**:
   ```bash
   pnpm install --frozen-lockfile
   pnpm --filter @dam-hopper/web build
   ```

5. **Release Retrigger**:
   After committing and pushing the workflow/package fix to `main`:
   - Delete failed release tag `v0.4.0` (or force-update tag to new commit):
     ```bash
     git tag -f v0.4.0 <new-commit-hash>
     git push origin -f v0.4.0
     ```
   - Release workflow will run with pnpm v10, frozen-lockfile will pass, web assets will build and publish.

---

## 5. Unresolved Questions

1. Should CI workflow pin a specific patch version of pnpm (e.g. `10.28.2` matching developer's local environment) or use major version `10`?
2. Should `Dockerfile` be updated as part of this release cycle to prevent Docker web build failures due to missing `patches/` and outdated `pnpm@9`?
