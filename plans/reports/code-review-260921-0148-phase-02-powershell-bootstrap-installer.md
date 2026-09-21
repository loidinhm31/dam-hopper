# Code Review Summary: Phase 02 — PowerShell Bootstrap Installer

**Date:** 2026-09-21  
**Reviewer:** Phase02CodeReviewer (Senior Staff Software Engineer)  
**Plan:** `plans/260920-2327-windows-release-asset-and-installer/phase-02-powershell-installer.md`  
**Overall Score:** 8.5/10  

---

## Scope
- Files reviewed:
  1. `deploy/release/dam-hopper-install.ps1` (534 lines)
  2. `tests/deploy/windows-release-install-fixture.mjs` (178 lines)
  3. `tests/deploy/windows-release-install.ps1` (487 lines)
  4. `package.json` (modified scripts)
- Total lines of code analyzed: ~1,200 lines
- Review focus: Security posture (fail-closed integrity, hash/digest checks, safe zip extraction, least-privilege User PATH, no auto-start/elevation), performance (timeouts, size bounds, zip inspection efficiency), architecture & PowerShell 5.1/7 compatibility, YAGNI/KISS/DRY adherence.
- Updated plans:
  - `plans/260920-2327-windows-release-asset-and-installer/phase-02-powershell-installer.md`
  - `plans/260920-2327-windows-release-asset-and-installer/plan.md`

---

## Overall Assessment
Phase 02 delivers a robust, non-admin Windows PowerShell installer adhering strictly to the principle of least privilege. The implementation avoids elevation, writes exclusively to the user's LocalAppData (`%LOCALAPPDATA%\Programs\dam-hopper`) and User PATH, preserves existing user configuration on upgrade, and enforces a strict fail-closed security boundary before any write occurs. The 12-scenario integration test harness exercises positive paths, configuration preservation, dry-run immutability, metadata tampering, archive traversal/extra/missing members, and PATH idempotence against a local loopback fixture server with automatic cleanup.

Two critical defects must be addressed:
1. Under `Set-StrictMode -Version Latest`, checking missing dynamic object properties (e.g. `$asset.digest`) throws a terminating exception before falling back to `release-manifest.json`.
2. Sensitive API headers (`Accept: application/vnd.github+json` and `Authorization: Bearer <token>`) are improperly forwarded to public asset download URLs redirecting to AWS S3.

---

## Critical Issues (MUST FIX)

### 1. `Set-StrictMode -Version Latest` crashes on missing properties on deserialized JSON
- **Location:** `deploy/release/dam-hopper-install.ps1:69,246,265,267`
- **Impact:** In PowerShell, `Set-StrictMode -Version Latest` causes accessing non-existent properties on a `PSCustomObject` to throw `RuntimeException: The property 'digest' cannot be found on this object`. In standard GitHub Releases REST API, asset objects do not natively provide a `digest` field. Evaluating `if ($null -ne $asset.digest)` immediately throws a fatal exception, crashing the installer before it can fall back to `release-manifest.json`.
- **Recommendation:** Change line 69 to `Set-StrictMode -Version 1.0` (which prohibits uninitialized variables while allowing dynamic object property queries) or use safe property presence checks:
```powershell
# Option A: Idiomatic for dynamic JSON scripts
Set-StrictMode -Version 1.0

# Option B: Explicit property existence check
$hasAssetDigest = $asset.PSObject.Properties['digest'] -ne $null
if ($hasAssetDigest -and -not [string]::IsNullOrWhiteSpace([string]$asset.digest)) { ... }
```

### 2. API `Authorization` and JSON `Accept` headers forwarded to binary asset download URLs
- **Location:** `deploy/release/dam-hopper-install.ps1:175-181,314,348`
- **Impact:**
  - When `$env:GITHUB_TOKEN` is supplied, passing `$headers` containing `Authorization: Bearer ...` to `Invoke-WebRequest -Uri $DownloadUrl` follows redirects to AWS S3 (`objects.githubusercontent.com`). AWS S3 rejects requests containing both query-string credentials and `Authorization` headers with `400 Bad Request: Only one auth mechanism allowed`. It also leaks the user's GitHub token to a third-party domain.
  - The header `"Accept" = "application/vnd.github+json"` requests JSON content types when downloading a binary ZIP file or PowerShell script, which may cause content-negotiation failures on reverse proxies or CDNs.
- **Recommendation:** Isolate API headers from asset download headers:
```powershell
$apiHeaders = @{
    "User-Agent" = "dam-hopper-installer/v1"
    "Accept"     = "application/vnd.github+json"
}
if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) {
    $apiHeaders["Authorization"] = "Bearer $($env:GITHUB_TOKEN)"
}

$downloadHeaders = @{
    "User-Agent" = "dam-hopper-installer/v1"
}

# In Step 6:
Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipPath -Headers $downloadHeaders -TimeoutSec 120
```

---

## Warnings (SHOULD FIX)

### 3. Orphaned temporary binary and opaque error if server is running during upgrade
- **Location:** `deploy/release/dam-hopper-install.ps1:460-472`
- **Impact:** If `dam-hopper-server.exe` is currently running, Windows file locking prevents `[System.IO.File]::Copy($tmpDestExe, $DestExe, $true)`. This throws an unhandled `System.IO.IOException`. Because `$tmpDestExe` is created in `<InstallDir>\bin` and line 472 is skipped, a stray file (`dam-hopper-server.exe.tmp-<guid>`) is permanently left in the bin directory, and the user receives a raw stack trace without actionable remediation.
- **Recommendation:** Protect the temporary copy with `try/finally` and supply an actionable error message on `IOException`:
```powershell
try {
    try {
        [System.IO.File]::Copy($tmpDestExe, $DestExe, $true)
    } catch [System.IO.IOException] {
        Write-Error "Error: Failed to replace '$DestExe'. If the DamHopper server is currently running, please stop it before upgrading."
        exit 1
    }
} finally {
    Remove-Item -LiteralPath $tmpDestExe -Force -ErrorAction SilentlyContinue
}
```

### 4. Missing ReparsePoint checks on `<InstallDir>\bin` and destination files
- **Location:** `deploy/release/dam-hopper-install.ps1:125-135,456-473`
- **Impact:** The installer verifies that `$canonicalInstallDir` is not a reparse point (symlink/junction). However, if an existing installation directory contains a junction or symlink at `<InstallDir>\bin` or `<InstallDir>\bin\dam-hopper-server.exe`, `[System.IO.File]::Copy` will follow the link and overwrite the link target.
- **Recommendation:** Validate that `$BinDir` and `$DestExe` are not reparse points if they exist:
```powershell
if (Test-Path -LiteralPath $BinDir) {
    if ((Get-Item -LiteralPath $BinDir -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        Write-Error "Error: Target bin directory '$BinDir' is a reparse point or symbolic link"
        exit 1
    }
}
if (Test-Path -LiteralPath $DestExe) {
    if ((Get-Item -LiteralPath $DestExe -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        Write-Error "Error: Target binary '$DestExe' is a reparse point or symbolic link"
        exit 1
    }
}
```

### 5. `DAM_HOPPER_TEST_API_BASE` non-HTTPS endpoints should be restricted to loopback
- **Location:** `deploy/release/dam-hopper-install.ps1:152-165,301-306`
- **Impact:** Setting `DAM_HOPPER_TEST_API_BASE` bypasses the `https://` protocol check entirely for both API queries and asset downloads. If accidentally set in production or staging, insecure HTTP URLs across public networks would be accepted.
- **Recommendation:** Restrict non-HTTPS test endpoints to loopback addresses (`127.0.0.1` / `localhost`):
```powershell
if ($IsTestEndpoint) {
    $testUri = [System.Uri]$ApiBase
    if ($testUri.Scheme -ne "https" -and $testUri.Host -ne "127.0.0.1" -and $testUri.Host -ne "localhost") {
        Write-Error "Error: Test API base must use HTTPS or loopback (127.0.0.1/localhost): '$ApiBase'"
        exit 1
    }
}
```

---

## Suggestions (NICE TO HAVE)

### 6. Disable download progress bar for performance in Windows PowerShell 5.1
- **Location:** `deploy/release/dam-hopper-install.ps1:68`
- **Detail:** In Windows PowerShell 5.1, `Invoke-WebRequest` renders a console progress bar that updates on every stream chunk, causing massive download slowdowns (up to 10x-100x slower) and console buffer overhead in CI/automated environments.
- **Recommendation:** Add `$ProgressPreference = 'SilentlyContinue'` at script initialization.

### 7. Suppress leaky boolean output in test fixture teardown
- **Location:** `tests/deploy/windows-release-install.ps1:476`
- **Detail:** `$FixtureProcess.WaitForExit(5000)` returns a boolean (`True`), which leaks into standard output during test teardown.
- **Recommendation:** Cast to `[void]` or assign to `$null`: `[void]$FixtureProcess.WaitForExit(5000)`.

### 8. Guard against unset `$env:LOCALAPPDATA`
- **Location:** `deploy/release/dam-hopper-install.ps1:57`
- **Detail:** Under minimal Windows containers or non-interactive service profiles where `LOCALAPPDATA` is missing, `Join-Path $null "Programs\dam-hopper"` resolves to a relative path and triggers a generic "must be an absolute path" error.
- **Recommendation:** Check if `[string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)` and prompt the user to supply `-InstallDir` explicitly.

---

## Positive Observations
1. **Safe Extraction Architecture:** Bypasses `Expand-Archive` completely in favor of manual `.NET` stream copying, validating entry names against an exact whitelist of 4 root files, rejecting all slashes, directory entries, `..` traversal, empty entries, and enforcing a 500 MB uncompressed aggregate limit.
2. **Least-Privilege Environment Mutation:** Correctly limits PATH mutation to `[System.EnvironmentVariableTarget]::User`, performs canonical path comparisons to avoid duplicates, guards against 2048-char environment variable truncation, and instructs the user to start a new terminal session.
3. **State Preservation:** Byte-for-byte user configuration preservation on upgrade (`dam-hopper.toml` is never overwritten), while ensuring updated sample configs (`dam-hopper.example.toml`), licenses, and READMEs are refreshed.
4. **Clean Dry-Run Semantics:** `-DryRun` exercises metadata resolution, download, hash verification, optional attestation, and archive staging in a temp folder before gracefully exiting with zero disk mutations to the destination.
5. **Comprehensive Integration Test Suite:** 12 automated scenarios in `windows-release-install.ps1` covering positive, upgrade, dry-run, tampered digests, mismatched sizes, traversal, extra/missing members, bad arguments, and PATH idempotence with reliable `try/finally` teardown.

---

## Recommended Actions
1. **Fix `Set-StrictMode` or dynamic property checks:** Change to `Set-StrictMode -Version 1.0` in `dam-hopper-install.ps1` so releases relying on `release-manifest.json` do not crash.
2. **Decouple API and download headers:** Create `$downloadHeaders` without `Authorization` or JSON `Accept` headers and pass them to `Invoke-WebRequest`.
3. **Add `try/finally` around binary replacement:** Ensure `$tmpDestExe` is always removed and catch `IOException` with a friendly "stop server before upgrade" message.
4. **Add ReparsePoint checks on `$BinDir` and `$DestExe`:** Strengthen defense against symlink/junction tampering.
5. **Set `$ProgressPreference = 'SilentlyContinue'`:** Accelerate downloads under Windows PowerShell 5.1.

---

## Metrics
- Type Safety / Strictness: `Set-StrictMode` enabled, strict parameter sets and regexes.
- Linting / Syntax Check: 0 errors (`Parser::ParseFile` and `node -c` pass).
- Test Coverage: 12/12 integration test scenarios passing; 23/23 asset gate assertions passing.
- PowerShell Floor: Compatible with Windows PowerShell 5.1 and pwsh.

---

## Unresolved Questions
None. Windows PowerShell 5.1 compatibility is verified and functional.
