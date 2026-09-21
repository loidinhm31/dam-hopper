# Code Review: Phase 01 — Asset Specification & Packaging Script

**Date:** 2026-09-21  
**Reviewer:** Phase01Reviewer-2  
**Plan:** `plans/260920-2327-windows-release-asset-and-installer/phase-01-asset-schema-and-packaging.md`  
**Score:** 9.5/10  

---

## Code Review Summary

### Scope
- **Files reviewed:**
  - `deploy/release/check-release-assets.mjs` (profile CLI, Windows ZIP parser & inspection, PowerShell syntax check, Linux extraction, all-profile union)
  - `deploy/release/build-windows-release-archive.mjs` (deterministic ZIP packager, normalized timestamps, metadata bounds, verification round-trip)
  - `package.json` (`release:windows-archive`, `release:windows-check-assets`, `release:windows-package-twice`, `release:verify-windows`, updated `release:verify`)
  - `tests/deploy/windows-release-package-twice.ps1` (deterministic package-twice test harness)
  - `tests/deploy/windows-release-asset-gate.test.mjs` (comprehensive 23-assertion test suite)
- **Lines of code analyzed:** ~2,800 LOC
- **Review focus:** Security, performance, determinism, architecture/contracts, and edge cases for Phase 01.
- **Updated plans:**
  - `plans/260920-2327-windows-release-asset-and-installer/phase-01-asset-schema-and-packaging.md` (marked complete, checklist updated)
  - `plans/260920-2327-windows-release-asset-and-installer/plan.md` (Phase 01 task marked complete)

### Overall Assessment
Implementation adheres strictly to the PDR and architecture contract:
1. **Linux Default & Invariants:** Default `--profile linux` preserves the exact 4-asset contract and Manifest v2 validation without regression.
2. **Windows Profile Contract:** Exactly two release assets (`dam-hopper-install.ps1`, `dam-hopper-vX.Y.Z-windows-x86_64.zip`). Migration evidence is disallowed for Windows.
3. **ZIP Member Whitelist & Security:** The ZIP verifier enforces exactly the 4 required root regular files (`dam-hopper-server.exe`, `dam-hopper.example.toml`, `LICENSE`, `README.md`) and strictly rejects path traversal (`..`, `.`), directory separators (`/`, `\`), drive letters (`C:`), NUL bytes, symlinks, directories, encryption, and unsupported compression methods. Decompression bomb limits are bounded via `maxOutputLength: 100MB`.
4. **Determinism:** `build-windows-release-archive.mjs` uses normalized DOS timestamps clamped to UTC `SOURCE_DATE_EPOCH`, fixed Deflate level 9, zeroed comments, and stable headers. Two independent runs produce byte-for-byte identical archives and digests.

---

## Critical Issues (MUST FIX)
None. All security boundaries, bounds checking, and fail-closed checks are implemented correctly.

---

## High Priority Findings (FIXED)

1. **PowerShell Script Path Word-Splitting with Spaces (Fixed)**
   - **Location:** `deploy/release/check-release-assets.mjs:692-706`
   - **Problem:** When calling `powershell` with `-Command "& { param([string]$Path) ... }" ps1Path`, PowerShell concatenates all command arguments and re-parses them. If `ps1Path` contained spaces (e.g. `C:\Users\John Doe\...` or `workspace with spaces`), PowerShell split the path into multiple arguments, causing `Parser::ParseFile` to receive a truncated path and fail.
   - **Fix Applied:** Passed the file path safely via `env: { ...process.env, TARGET_PS1_PATH: ps1Path }` and invoked `[System.Management.Automation.Language.Parser]::ParseFile($env:TARGET_PS1_PATH, ...)`. This is completely immune to word splitting and path injection.
   - **Verification:** Added Test 15 to `tests/deploy/windows-release-asset-gate.test.mjs` testing directories and files with spaces; verified passing.

2. **Locale-Dependent Sorting in ZIP Packager (Fixed)**
   - **Location:** `deploy/release/build-windows-release-archive.mjs:206`
   - **Problem:** Member sorting used `a.name.localeCompare(b.name)`. In default mode without an explicit locale, `localeCompare` depends on host system locale settings, which could cause different entry orderings across developer/CI machines.
   - **Fix Applied:** Changed to canonical ASCII ordinal sorting `(a.name < b.name ? -1 : a.name > b.name ? 1 : 0)`.
   - **Verification:** Verified byte-for-byte determinism across package runs.

3. **Hermetic Test Suite Dependency on Pre-built Binary (Fixed)**
   - **Location:** `tests/deploy/windows-release-asset-gate.test.mjs:421`
   - **Problem:** Test 13 directly required `server/target/release/dam-hopper-server.exe`. In clean clones or environments before Rust compilation, the test failed immediately.
   - **Fix Applied:** Added fallback to create a mock PE binary in `TEST_TMP_ROOT` if neither MSVC nor release build output exists.
   - **Verification:** Verified all 23 assertions pass both with and without the compiled server binary.

---

## Medium Priority Improvements (NICE TO HAVE)

1. **Modularization of `check-release-assets.mjs`**
   - File size has reached ~1806 LOC. In future phases, consider splitting ZIP inspection into a separate module (e.g., `deploy/release/inspect-zip-archive.mjs`) to maintain smaller, single-responsibility files.
2. **`SOURCE_DATE_EPOCH` Strict Validation**
   - In `build-windows-release-archive.mjs`, `parseInt(process.env.SOURCE_DATE_EPOCH, 10)` accepts inputs like `"1700000000abc"`. Checking `/^\d+$/.test(val)` would enforce cleaner configuration.

---

## Positive Observations
- Zero external dependencies: pure Node.js standard libraries (`node:fs`, `node:crypto`, `node:zlib`).
- Atomic archive emission via temporary file and `renameSync`.
- Negative test coverage for traversal, duplicate members, missing members, trailing garbage, corrupt CRC-32, malformed PowerShell syntax, and altered epochs.
- Cross-platform PowerShell detection (`POWERSHELL_BIN` -> `pwsh` -> `powershell`).
- Clean separation of Linux, Windows, and All publication gates.

---

## Validation Commands & Results

1. `node tests/deploy/windows-release-asset-gate.test.mjs`
   - **Result:** `ALL TESTS PASSED: 23/23 assertions verified.` (includes space-path test)
2. `pnpm release:windows-package-twice`
   - **Result:** `Verified deterministic Windows package twice: dam-hopper-v0.1.0-windows-x86_64.zip (sha256 f7c3f43fbd5de5de177544af5326b66095e3c9d70e1f0c45e1d51da47989ab20)`
3. `pnpm release:verify-windows`
   - **Result:** `node -c` syntax check passed for both `.mjs` scripts.

---

## Metrics
- **Type Coverage:** N/A (Standard JS with Node runtime checks)
- **Test Coverage:** 23 positive/negative assertions in `windows-release-asset-gate.test.mjs` + full package-twice cycle in `windows-release-package-twice.ps1`
- **Critical Issues:** 0
- **Warnings (Resolved):** 3
- **Suggestions:** 2

---

## Unresolved Questions
None blocking.
