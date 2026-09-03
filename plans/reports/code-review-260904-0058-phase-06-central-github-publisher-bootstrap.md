# Code Review: Phase 06 — Central GitHub Publisher and Bootstrap

**Date:** 2026-09-04  
**Branch:** autoresearch/session-20260903  
**Scope:** Phase 06 — Central GitHub Publisher and Bootstrap  
**Status:** BLOCKED (Critical issues must be resolved before publication)  

---

## Code Review Summary

### Scope
- **Files reviewed:**
  - `.github/workflows/release-linux.yml`
  - `.github/workflows/release.yml`
  - `.github/workflows/ci.yml`
  - `package.json`
  - `deploy/release/check-version-alignment.mjs`
  - `deploy/release/build-release-archive.sh`
  - `deploy/release/generate-release-manifest.mjs`
  - `deploy/release/check-release-assets.mjs`
  - `deploy/release/dam-hopper-install.sh`
  - `server/src/linux_release/cli.rs`
  - `server/src/linux_release/manifest.rs`
  - `server/src/linux_release/privilege.rs`
  - `server/src/linux_release/archive.rs`
  - `server/src/linux_release/archive_extract.rs`
  - `server/src/linux_release/mod.rs`
  - `server/src/bin/dam-hopper.rs`
  - `server/tests/linux_release_publisher_contract.rs`
- **Lines of code analyzed:** ~1,450 lines
- **Review focus:** Security, workflow correctness, build determinism, packaging contracts, privilege separation, YAGNI/KISS/DRY.

### Overall Assessment
The architecture and design for Phase 06 are sound and closely follow the PDR and parent plans: unprivileged bootstrap downloads, local SHA-256 verification against authoritative manifest, unprivileged manager extraction, and root staging via manager CLI with least-privileged GitHub Actions workflows.

However, **four critical execution defects** were uncovered during deep dry-run validation:
1. `build-release-archive.sh` crashes immediately due to incompatible flags (`--format=gnu` combined with `--pax-option`, which GNU tar strictly restricts to POSIX archives).
2. GNU tar recurses into directories by default when given `-T filelist`, causing all staged files to be packaged twice (the second time as self-referential hard links).
3. `build-release-archive.sh` packages bare intermediate directories (`bin`, `systemd`, `sysusers.d`), which have no assigned roles in `generate-release-manifest.mjs` and crash manifest generation with an uncaught exception.
4. `.github/workflows/release-linux.yml` uses regex syntax (`v[0-9]+.[0-9]+.[0-9]+`) in GitHub Actions `push.tags` glob filter, which treats `+` as a literal character and will never trigger on SemVer tag pushes.

---

## Score: 6.5 / 10

---

## Critical Issues (MUST FIX)

### 1. `tar: --pax-option can be used only on POSIX archives` in `build-release-archive.sh`
- **Location:** `deploy/release/build-release-archive.sh:204-211`
- **Impact:** Script fails immediately upon archive creation; no release archive can ever be built.
- **Root Cause:** GNU `tar` rejects `--pax-option` when combined with `--format=gnu`.
- **Fix:** Change `--format=gnu` to `--format=posix`:
```bash
tar --sort=name \
    --format=posix \
    --no-recursion \
    --owner=0 --group=0 --numeric-owner \
    --mtime="@${EPOCH}" \
    --pax-option=exthdr.name=%d/PaxHeaders/%f,delete=atime,delete=ctime \
    -cf "${TMP_TAR}" \
    -C "${TMP_STAGE}" \
    -T "${FILE_LIST}"
```

### 2. Tar Directory Recursion Causes Duplicate File Entries and Hard Links
- **Location:** `deploy/release/build-release-archive.sh:204-211`
- **Impact:** GNU tar recurses into directories by default when reading `-T "${FILE_LIST}"`. When `web` is processed, all files in `web` are packed; when `web/index.html` is encountered later in the list, tar packs it again as a hard link to itself. This breaks `inspect_and_validate_archive` with `DuplicateInventoryPath`.
- **Fix:** Add `--no-recursion` flag to `tar`.

### 3. Intermediate Directories (`bin`, `systemd`, `sysusers.d`) Crash Manifest Generation
- **Location:** `deploy/release/build-release-archive.sh:201` & `deploy/release/generate-release-manifest.mjs:101-112`
- **Impact:** `find . -mindepth 1` includes top-level directory entries `bin`, `systemd`, `sysusers.d`. `assignRoles()` in `generate-release-manifest.mjs` throws: `Error: Unrecognized release entry has no assigned role: 'bin'`. Manifest generation terminates with exit code 1.
- **Fix:** Filter out bare intermediate directories from `FILE_LIST` in `build-release-archive.sh`:
```bash
(cd "${TMP_STAGE}" && find . -mindepth 1 ! -name "_filelist.txt" ! -path "./bin" ! -path "./systemd" ! -path "./sysusers.d" | sed 's|^\./||' | LC_ALL=C sort) > "${FILE_LIST}"
```

### 4. GitHub Actions Tag Push Filter Uses Invalid Glob Pattern
- **Location:** `.github/workflows/release-linux.yml:4-6`
- **Impact:** Pushing `v0.1.0` or any valid SemVer tag will NEVER trigger the workflow.
- **Root Cause:** GitHub Actions `on.push.tags` uses fnmatch glob syntax, where `+` is literal `+`, not regex `one-or-more`.
- **Fix:** Use valid glob syntax:
```yaml
on:
  push:
    tags:
      - "v*"
```
*(The workflow's `resolve` step in `validate-metadata` already validates exact `^v[0-9]+\.[0-9]+\.[0-9]+$`)*.

---

## Warnings (SHOULD FIX)

### 1. Third-Party Actions Not Pinned to Full Commit SHAs
- **Location:** `.github/workflows/release-linux.yml` & `.github/workflows/release.yml`
- **Impact:** Supply-chain vulnerability; violates Non-functional Requirement 45.
- **Fix:** Pin actions (e.g. `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2`).

### 2. Missing Fedora 44 Build Container and GLIBC Boundary Verification
- **Location:** `.github/workflows/release-linux.yml:59-95`
- **Impact:** Binaries are built on Ubuntu 24.04 (`ubuntu-latest`) rather than the target Fedora 44 profile with pinned container digest. No ELF symbol scan verifies the glibc floor.
- **Fix:** Add Fedora 44 container with pinned digest or record ELF/GLIBC boundary checks.

### 3. Attestation Check Skips Manifest Verification in `dam-hopper-install.sh`
- **Location:** `deploy/release/dam-hopper-install.sh:163-175`
- **Impact:** `gh attestation verify` only checks `${ARCHIVE_FILE}`, leaving `${MANIFEST_FILE}` unverified in the shell layer prior to extracting the expected checksum.
- **Fix:** Verify both `${MANIFEST_FILE}` and `${ARCHIVE_FILE}`:
```bash
gh attestation verify "${MANIFEST_FILE}" --repo "${REPO_OWNER}/${REPO_NAME}"
gh attestation verify "${ARCHIVE_FILE}" --repo "${REPO_OWNER}/${REPO_NAME}"
```

### 4. Non-Deterministic Timestamp in SPDX SBOM
- **Location:** `deploy/release/generate-release-manifest.mjs:276`
- **Impact:** `new Date().toISOString()` produces different bytes on every run, breaking bit-for-bit rebuild reproducibility of the SBOM.
- **Fix:** Derive date from `SOURCE_DATE_EPOCH`:
```javascript
created: process.env.SOURCE_DATE_EPOCH
  ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
  : new Date().toISOString(),
```

---

## Suggestions (NICE TO HAVE)

1. **Avoid Hardcoded Repository Owner/Name:** Parameterize `REPO_OWNER` and `REPO_NAME` in `dam-hopper-install.sh` and `generate-release-manifest.mjs` using `GITHUB_REPOSITORY` fallback.
2. **Force `LC_ALL: 'C'` during `tar -ztvf` Parsing:** In `generate-release-manifest.mjs`, pass `env: { ...process.env, LC_ALL: 'C' }` to prevent localized date column misalignment.
3. **Add Duplicate Path Detection in Manifest Generator:** Use a `Set` to check `seenPaths` during manifest generation to catch duplicate archive entries early.

---

## Positive Observations
- **Least-Privilege GitHub Actions Scoping:** `release-linux.yml` enforces read-only permissions for build jobs, `id-token: write`/`attestations: write` for attestation, and restricts `contents: write` to publication under environment approval.
- **Desktop Tag Isolation:** `.github/workflows/release.yml` is successfully isolated to `desktop-v*` tags with no ability to overwrite stable `v*` releases.
- **Robust Version Alignment Checker:** `check-version-alignment.mjs` strictly verifies `server/Cargo.toml`, `apps/web/package.json`, release tags, and `--bin` version outputs.
- **Clean Manager Validation Command:** `dam-hopper validate` in `server/src/bin/dam-hopper.rs` and `server/src/linux_release/manifest.rs` cleanly validates manifests and archives using unified core routines, callable without root privileges.

---

## Validation Commands and Results
- `cargo check --manifest-path server/Cargo.toml --all-targets --features vendored`: **PASS** (0 warnings, 0 errors).
- `pnpm release:verify`: **PASS**.
- `cargo test --test linux_release_publisher_contract`: **PASS** (6/6 tests passed).
- `cargo test --test linux_release_manifest --test linux_release_archive --test linux_release_staging --test linux_release_cli`: **PASS** (17/17 tests passed).
- End-to-end pipeline dry-run (archive creation -> manifest generation -> manager validation): **FAILED with unpatched code** (`tar --pax-option`, tar recursion, missing directory role); **PASSED with proposed fixes**.

---

## Unresolved Questions
1. Should Fedora 44 container builds be introduced immediately in `release-linux.yml`, or is Ubuntu compilation acceptable until Phase 08 runtime verification?
2. Should `dam-hopper-install.sh` enforce `gh attestation verify` as mandatory on systems where `gh` is detected, rather than requiring an explicit `--verify-attestation` flag?
