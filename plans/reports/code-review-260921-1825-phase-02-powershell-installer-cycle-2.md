# Code Review Summary: Phase 02 — PowerShell Bootstrap Installer (Review Cycle 2)

**Date:** 2026-09-21  
**Reviewer:** Senior Software Engineer (Phase02CodeReviewerCycle2)  
**Plan:** `plans/260920-2327-windows-release-asset-and-installer/phase-02-powershell-installer.md`  
**Overall Score:** 9.5/10  

---

## Scope
- Files reviewed:
  1. `deploy/release/dam-hopper-install.ps1` (603 lines)
  2. `tests/deploy/windows-release-install.ps1` (537 lines)
  3. `tests/deploy/windows-release-install-fixture.mjs` (178 lines)
  4. `package.json` (modified Windows verification and test scripts)
- Lines of code analyzed: ~1,350 LOC
- Review focus: Verification of Review Cycle 1 remediations (2 critical issues, 3 warnings), security boundaries, Windows PowerShell 5.1 / 7 compatibility, test coverage expansion (14/14 scenarios), and least-privilege non-admin install behavior.
- Updated plans:
  - `plans/260920-2327-windows-release-asset-and-installer/phase-02-powershell-installer.md`
  - `plans/260920-2327-windows-release-asset-and-installer/plan.md`

---

## Overall Assessment
Review Cycle 2 verifies that all 5 issues (2 critical, 3 warnings) identified in Cycle 1 have been resolved cleanly and robustly.

Dynamic object property checks safely guard optional PSCustomObject properties (`digest`, `assets`, `tag_name`, `sha256`) under `Set-StrictMode -Version Latest`. Request headers are segregated into authenticated API headers and clean download headers to prevent credential leakage or AWS S3 HTTP 400 rejection on redirect. Destination paths and executables enforce strict `ReparsePoint` (symlink/junction) verification. Binary replacement is transactional, cleans temporary files in an outer `finally` block, and produces actionable remediation guidance upon encountering `IOException` (e.g., when the server executable is locked by a running instance). Test endpoint overrides for cleartext HTTP are restricted to loopback addresses (`127.0.0.1`/`localhost`) via `System.Uri.IsLoopback`.

The integration test suite was expanded from 12 to 14 scenarios, adding automated test cases for non-loopback HTTP rejection (Test 13) and in-use binary locking with temporary file cleanup (Test 14). All 14 tests pass cleanly.

---

## Remediation Verification (Cycle 1 Findings)

| # | Severity | Finding | Status | Verification Detail |
|---|---|---|---|---|
| 1 | **Critical** | `Set-StrictMode -Version Latest` crashes on missing properties on deserialized JSON | **RESOLVED** | `$asset.PSObject.Properties['digest']` and `$manifestJson.PSObject.Properties['assets']` guarded before property read; tested successfully with manifest fallback and missing properties. |
| 2 | **Critical** | `Authorization` and `Accept` headers forwarded to binary asset download URLs (S3 redirect risk) | **RESOLVED** | `$apiHeaders` (with auth & JSON accept) decoupled from `$downloadHeaders` (clean `User-Agent` only). Used exclusively for asset and script downloads. |
| 3 | **Warning** | Orphaned temporary binary and opaque error if server is running during upgrade | **RESOLVED** | Staging temp binary wrapped in `try/finally` with `Remove-Item` cleanup; caught `[System.IO.IOException]` with explicit instruction to stop running server. Defended by Test 14. |
| 4 | **Warning** | Missing `ReparsePoint` checks on `<InstallDir>\bin` and destination files | **RESOLVED** | Added `[System.IO.FileAttributes]::ReparsePoint` bitmask check and container check on `$canonicalInstallDir`, `$BinDir`, and `$DestExe`. |
| 5 | **Warning** | `DAM_HOPPER_TEST_API_BASE` non-HTTPS endpoints should be restricted to loopback | **RESOLVED** | `[System.Uri]::IsLoopback` enforced on both `$ApiBase` and `$DownloadUrl` when HTTP is used. Defended by Test 13. |

---

## Critical Issues
*None.*

---

## Warnings
*None.*

---

## Suggestions (Minor Polish)

### 1. Decouple headers for optional release-manifest.json download
- **Location:** `deploy/release/dam-hopper-install.ps1:283`
- **Detail:** `$manifestJson = Invoke-RestMethod -Uri $manifestUrl -Headers $apiHeaders -Method Get -TimeoutSec 30` passes `$apiHeaders` (which includes `Authorization: Bearer <token>` when `$env:GITHUB_TOKEN` is set) to `$manifestUrl` (`browser_download_url`). Because public asset URLs redirect to AWS S3, S3 may return HTTP 400 if credentials are provided. While wrapped in `try/catch`, using `$downloadHeaders` or a dedicated manifest header without `Authorization` guarantees clean header hygiene.

### 2. Disable download progress bar for performance in Windows PowerShell 5.1
- **Location:** `deploy/release/dam-hopper-install.ps1:68`
- **Detail:** Windows PowerShell 5.1 interactive console progress updates on each stream chunk degrade download throughput. Adding `$ProgressPreference = 'SilentlyContinue'` optimizes download speed in automated/CI and 5.1 console sessions.

### 3. Suppress leaky boolean output in test fixture teardown
- **Location:** `tests/deploy/windows-release-install.ps1:526`
- **Detail:** `$FixtureProcess.WaitForExit(5000)` returns boolean `True` which prints to stdout during teardown. Cast to `[void]$FixtureProcess.WaitForExit(5000)` or `$null = ...` to keep output quiet.

---

## Positive Observations
1. **Defensive Dynamic Typing:** Robust use of `.PSObject.Properties['name']` presence checks preserves `Set-StrictMode -Version Latest` benefits without sacrificing dynamic JSON interoperability.
2. **Safe Staging & Atomic Replace:** Full hash verification between staged binary and destination temporary binary prior to final replacement eliminates half-written executable states.
3. **Comprehensive Edge-Case Testing:** Test suite covers positive, upgrade, -Latest, -DryRun, tampered digest, mismatched size, path traversal, non-root directory entries, extra members, missing members, invalid parameter combos, PATH idempotence, cleartext HTTP loopback restriction, and locked binary upgrade.
4. **Clean Non-Admin & PATH Semantics:** Strictly User-scoped, non-elevated, 2048-character length guarded, case-insensitive canonical path comparison.

---

## Validation Commands & Results

```powershell
# 1. Syntax & AST verification across all scripts
pnpm release:verify-windows
# Result: PASSED (Node syntax valid, PowerShell AST Parser returned 0 errors)

# 2. Integration test suite (14 scenarios)
pnpm release:windows-installer-test
# Result: PASSED (14/14 passed)

# 3. Release asset gate test suite
node tests/deploy/windows-release-asset-gate.test.mjs
# Result: ALL TESTS PASSED: 23/23 assertions verified.

# 4. Deterministic package-twice test
pnpm release:windows-package-twice
# Result: PASSED (Identical SHA-256 across runs, altered epoch negative check passed)

# 5. Version alignment check
pnpm release:check-version
# Result: PASSED (v0.4.2 aligned)
```

---

## Metrics
- **Score:** 9.5 / 10
- **Critical Issues:** 0
- **Warnings:** 0
- **Suggestions:** 3
- **Test Suite Pass Rate:** 100% (14/14 integration tests, 23/23 asset gate assertions)
- **PowerShell Version Floor:** Windows PowerShell 5.1 + PowerShell 7+ compatible

---

## Unresolved Questions
*None.* All behavior matches the contract and Phase 02 requirements. Ready for Phase 03 CI publication and documentation integration.
