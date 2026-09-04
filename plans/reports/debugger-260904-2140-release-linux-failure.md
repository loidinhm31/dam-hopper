# Debugger Investigation Report: release-linux.yml Failure

## 1. Executive Summary
- **Issue**: GitHub Actions workflow `.github/workflows/release-linux.yml` fails at step `Package archive twice and validate exact release subjects` (`package-release` job).
- **Failure output**:
  - `Unknown argument: --` (exit code 2)
  - `WARN Local package.json exists, but node_modules missing, did you mean to install?`
- **Primary Root Cause**: `.github/workflows/release-linux.yml` line 170 invokes `pnpm release:package-twice -- \`. In pnpm, `--` is not stripped; it forwards literally as `$1="--"` to `bash tests/deploy/linux-release-package-twice.sh`. Script argument parser lacks `--` case and terminates with exit code 2.
- **Secondary Cause**: `package-release` job executes `actions/checkout`, `setup-node`, and `action-setup` (pnpm v9), but never runs `pnpm install`. When pnpm runs any script in a dir with `package.json` lacking `node_modules`, it prints the advisory warning.

---

## 2. Technical Analysis & Reproduction

### 2.1 Trace of Execution Failure
1. Workflow job `package-release` runs command:
   ```yaml
   pnpm release:package-twice -- \
     --version "${{ needs.validate-metadata.outputs.release_tag }}" \
     --target-dir "artifacts/bin" \
     --web-dist "apps/web/dist" \
     --output-dir "artifacts/final"
   ```
2. `package.json` script definition:
   ```json
   "release:package-twice": "bash tests/deploy/linux-release-package-twice.sh"
   ```
3. pnpm expands command and executes:
   ```bash
   bash tests/deploy/linux-release-package-twice.sh -- --version v0.2.0 --target-dir artifacts/bin --web-dist apps/web/dist --output-dir artifacts/final
   ```
4. `tests/deploy/linux-release-package-twice.sh` parses args via `while [[ $# -gt 0 ]]; case "$1" in ...`:
   ```bash
   while [[ $# -gt 0 ]]; do
       case "$1" in
           --version) VERSION="${2:?missing value for --version}"; shift 2 ;;
           --target-dir) TARGET_DIR="${2:?missing value for --target-dir}"; shift 2 ;;
           --web-dist) WEB_DIST="${2:?missing value for --web-dist}"; shift 2 ;;
           --output-dir) OUTPUT_DIR="${2:?missing value for --output-dir}"; shift 2 ;;
           --source-date-epoch) SOURCE_DATE_EPOCH="${2:?missing value for --source-date-epoch}"; shift 2 ;;
           -h|--help) usage ;;
           *) printf 'Unknown argument: %s\n' "$1" >&2; usage ;;
       esac
   done
   ```
5. First arg `$1` evaluates to `--`. Matches `*)`. Prints `Unknown argument: --`, outputs usage, exits 2.

### 2.2 Reproduction Evidence
- **With `--`**:
  ```bash
  $ pnpm release:package-twice -- -h
  > bash tests/deploy/linux-release-package-twice.sh -- -h
  Unknown argument: --
  Usage: linux-release-package-twice.sh --version <vX.Y.Z> [options]
  ELIFECYCLE Command failed with exit code 2.
  ```
- **Without `--`**:
  ```bash
  $ pnpm release:package-twice -h
  > bash tests/deploy/linux-release-package-twice.sh -h
  Usage: linux-release-package-twice.sh --version <vX.Y.Z> [options]
  ```
- Contrast with `npm`: `npm run <cmd> -- <args>` strips `--` before forwarding. `pnpm run <cmd> <args>` natively passes arguments without `--`. Passing `--` causes pnpm to forward `--` as an explicit argument.

### 2.3 Investigation of `WARN Local package.json exists, but node_modules missing`
- `package-release` job runs `pnpm/action-setup@v4` but omits `pnpm install --frozen-lockfile`.
- pnpm detects `package.json` at root without `./node_modules` and prints `WARN`.
- **Dependency audit**:
  - `tests/deploy/linux-release-package-twice.sh`: bash + system utilities (`sha256sum`, `cmp`, `git`, `cp`, `mkdir`, `chmod`).
  - `deploy/release/build-release-archive.sh`: bash + system utilities (`tar`, `gzip`, `chmod`, `cp`).
  - `deploy/release/generate-release-manifest.mjs`: Node.js built-ins only (`node:fs`, `node:path`, `node:url`, `node:crypto`, `node:child_process`, `node:os`). Zero npm dependencies.
  - `deploy/release/check-release-assets.mjs`: Node.js built-ins only (`node:fs`, `node:path`, `node:crypto`, `node:child_process`). Zero npm dependencies.
- Neither the bash script nor the invoked `.mjs` scripts require `node_modules`. Warning is purely advisory from pnpm's presence check.

---

## 3. Downstream Pipeline Readiness & Preflight Checks
Audited all steps executed after argument resolution:
1. **Binary targets**: `artifacts/bin/dam-hopper`, `dam-hopper-server`, `dam-hopper-web` exist and made executable in preceding step `Make binaries executable`.
2. **Web distribution**: `apps/web/dist/index.html` downloaded from `build-web` artifact.
3. **Commit SHA**: `RELEASE_COMMIT: ${{ github.sha }}` fulfills 40-hex lowercase regex constraint.
4. **Deploy templates**: `deploy/systemd/dam-hopper-api.service.in`, `web.service.in`, `recovery.service.in`, and `deploy/sysusers.d/dam-hopper-web.conf` present in tree.
5. **Exact 4-asset invariant in `check-release-assets.mjs`**:
   - `dam-hopper-install.sh`
   - `dam-hopper-${TAG}-fedora44-x86_64-systemd.tar.gz`
   - `release-manifest.json`
   - `dam-hopper-${TAG}-fedora44-x86_64-systemd.spdx.json`
   All 4 assets are properly produced and placed into `artifacts/final`.
6. Subsequent jobs: `attest-release` (provenance attestation) and `publish-release` (GitHub CLI release draft & assets) consume exact 4 subjects matching filenames.

---

## 4. Recommended Solutions (For User Decision - Not Implemented)

### Solution Option 1: Workflow Call Update (Simplest, standard pnpm)
In `.github/workflows/release-linux.yml` line 170:
Remove `-- \`:
```yaml
      - name: Package archive twice and validate exact release subjects
        env:
          SOURCE_DATE_EPOCH: 1700000000
          RELEASE_COMMIT: ${{ github.sha }}
        run: |
          pnpm release:package-twice \
            --version "${{ needs.validate-metadata.outputs.release_tag }}" \
            --target-dir "artifacts/bin" \
            --web-dist "apps/web/dist" \
            --output-dir "artifacts/final"
```

### Solution Option 2: Direct Script Execution (Cleanest, eliminates pnpm overhead & warning)
In `.github/workflows/release-linux.yml` line 170:
Invoke `bash tests/deploy/linux-release-package-twice.sh` directly:
```yaml
      - name: Package archive twice and validate exact release subjects
        env:
          SOURCE_DATE_EPOCH: 1700000000
          RELEASE_COMMIT: ${{ github.sha }}
        run: |
          bash tests/deploy/linux-release-package-twice.sh \
            --version "${{ needs.validate-metadata.outputs.release_tag }}" \
            --target-dir "artifacts/bin" \
            --web-dist "apps/web/dist" \
            --output-dir "artifacts/final"
```
Benefits:
- Eliminates pnpm `--` forwarding confusion.
- Eliminates `WARN Local package.json exists, but node_modules missing`.
- Eliminates need for `pnpm/action-setup@v4` step in `package-release` job.

### Solution Option 3: Script-Level Defense-in-Depth (Resilient CLI parsing)
In `tests/deploy/linux-release-package-twice.sh` line 28:
Add handling for `--` option terminator:
```bash
while [[ $# -gt 0 ]]; do
    case "$1" in
        --) shift ;;
        --version) VERSION="${2:?missing value for --version}"; shift 2 ;;
```
Benefit:
- Prevents breakage regardless of whether callers use `pnpm`, `npm run`, or direct bash with `--`.

### Recommended Combined Fix:
Apply Option 1 (or Option 2) + Option 3. Option 3 ensures defensive parsing for any caller; Option 1 or 2 fixes workflow invocation.

---

## 5. Unresolved Questions
- None. Root cause fully isolated, reproduced, and validated.
