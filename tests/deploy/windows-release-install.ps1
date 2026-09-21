<#
.SYNOPSIS
    Integration test harness for DamHopper Windows bootstrap installer.

.DESCRIPTION
    Launches a local loopback fixture server and exercises positive, upgrade,
    dry-run, negative tamper, security, argument validation, and User PATH
    scenarios against deploy/release/dam-hopper-install.ps1. Restores environment
    state and cleans temporary files upon completion.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "../..")).Path
$InstallerScript = Join-Path $RepoRoot "deploy/release/dam-hopper-install.ps1"
$FixtureScript = Join-Path $ScriptDir "windows-release-install-fixture.mjs"

if (-not (Test-Path -LiteralPath $InstallerScript)) {
    Write-Error "Installer script not found at: $InstallerScript"
    exit 1
}

# Snapshot original User PATH for guaranteed teardown restoration
$OriginalUserPath = [Environment]::GetEnvironmentVariable("Path", [System.EnvironmentVariableTarget]::User)
if ($null -eq $OriginalUserPath) { $OriginalUserPath = "" }

$TestWorkspace = Join-Path ([System.IO.Path]::GetTempPath()) ("dam-hopper-install-test-" + [System.Guid]::NewGuid().ToString())
[void][System.IO.Directory]::CreateDirectory($TestWorkspace)
$ArtifactsDir = Join-Path $TestWorkspace "artifacts"
[void][System.IO.Directory]::CreateDirectory($ArtifactsDir)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Create-ZipArchive {
    param(
        [string]$ZipPath,
        [hashtable]$Entries
    )
    if (Test-Path -LiteralPath $ZipPath) {
        Remove-Item -LiteralPath $ZipPath -Force
    }
    $fileStream = [System.IO.File]::Create($ZipPath)
    try {
        $archive = New-Object System.IO.Compression.ZipArchive($fileStream, [System.IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($name in $Entries.Keys) {
                $content = $Entries[$name]
                $entry = $archive.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
                $entryStream = $entry.Open()
                try {
                    if ($content -is [byte[]]) {
                        $entryStream.Write($content, 0, $content.Length)
                    } else {
                        $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$content)
                        $entryStream.Write($bytes, 0, $bytes.Length)
                    }
                } finally {
                    $entryStream.Dispose()
                }
            }
        } finally {
            $archive.Dispose()
        }
    } finally {
        $fileStream.Dispose()
    }
}

function Invoke-Installer {
    param(
        [string[]]$ArgumentList,
        [string]$ApiBaseOverride = ""
    )
    $allArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$InstallerScript`"") + $ArgumentList
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "powershell"
    $psi.Arguments = $allArgs -join ' '
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    if (-not [string]::IsNullOrWhiteSpace($ApiBaseOverride)) {
        $psi.EnvironmentVariables["DAM_HOPPER_TEST_API_BASE"] = $ApiBaseOverride
    } elseif ($null -ne $env:DAM_HOPPER_TEST_API_BASE) {
        $psi.EnvironmentVariables["DAM_HOPPER_TEST_API_BASE"] = $env:DAM_HOPPER_TEST_API_BASE
    }

    if ($null -ne $env:GITHUB_REPOSITORY) {
        $psi.EnvironmentVariables["GITHUB_REPOSITORY"] = $env:GITHUB_REPOSITORY
    }

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    return [PSCustomObject]@{
        ExitCode = $proc.ExitCode
        StdOut   = $stdout
        StdErr   = $stderr
    }
}

$FixtureProcess = $null

try {
    Write-Host "=== Setting up test release artifacts ==="

    # 1. Valid release v1.0.0
    $v100Zip = Join-Path $ArtifactsDir "dam-hopper-v1.0.0-windows-x86_64.zip"
    Create-ZipArchive -ZipPath $v100Zip -Entries @{
        "dam-hopper-server.exe"   = [System.Text.Encoding]::ASCII.GetBytes("MZ-MOCK-BINARY-V1.0.0")
        "dam-hopper.example.toml" = "[server]`nhost = '127.0.0.1'`nport = 4801`n"
        "LICENSE"                 = "Apache-2.0 OR MIT"
        "README.md"               = "# DamHopper Server v1.0.0"
    }

    # 2. Valid release v1.0.1 (upgrade)
    $v101Zip = Join-Path $ArtifactsDir "dam-hopper-v1.0.1-windows-x86_64.zip"
    Create-ZipArchive -ZipPath $v101Zip -Entries @{
        "dam-hopper-server.exe"   = [System.Text.Encoding]::ASCII.GetBytes("MZ-MOCK-BINARY-V1.0.1-UPGRADED")
        "dam-hopper.example.toml" = "[server]`nhost = '127.0.0.1'`nport = 4801`n"
        "LICENSE"                 = "Apache-2.0 OR MIT"
        "README.md"               = "# DamHopper Server v1.0.1"
    }

    # 3. Valid release v1.2.0 (latest)
    $v120Zip = Join-Path $ArtifactsDir "dam-hopper-v1.2.0-windows-x86_64.zip"
    Create-ZipArchive -ZipPath $v120Zip -Entries @{
        "dam-hopper-server.exe"   = [System.Text.Encoding]::ASCII.GetBytes("MZ-MOCK-BINARY-V1.2.0-LATEST")
        "dam-hopper.example.toml" = "[server]`nhost = '127.0.0.1'`nport = 4801`n"
        "LICENSE"                 = "Apache-2.0 OR MIT"
        "README.md"               = "# DamHopper Server v1.2.0"
    }

    # 4. Unsafe Traversal archive
    $traversalZip = Join-Path $ArtifactsDir "unsafe-traversal.zip"
    Create-ZipArchive -ZipPath $traversalZip -Entries @{
        "dam-hopper-server.exe"   = "MZ-MOCK"
        "dam-hopper.example.toml" = "host = '127.0.0.1'"
        "LICENSE"                 = "MIT"
        "../evil.txt"             = "traversal payload"
    }

    # 5. Unsafe non-root directory archive
    $dirZip = Join-Path $ArtifactsDir "unsafe-directory.zip"
    Create-ZipArchive -ZipPath $dirZip -Entries @{
        "bin/dam-hopper-server.exe" = "MZ-MOCK"
        "dam-hopper.example.toml"   = "host = '127.0.0.1'"
        "LICENSE"                   = "MIT"
        "README.md"                 = "README"
    }

    # 6. Extra member archive (5 members)
    $extraZip = Join-Path $ArtifactsDir "extra-member.zip"
    Create-ZipArchive -ZipPath $extraZip -Entries @{
        "dam-hopper-server.exe"   = "MZ-MOCK"
        "dam-hopper.example.toml" = "host = '127.0.0.1'"
        "LICENSE"                 = "MIT"
        "README.md"               = "README"
        "unauthorized.exe"        = "extra payload"
    }

    # 7. Missing member archive (3 members)
    $missingZip = Join-Path $ArtifactsDir "missing-member.zip"
    Create-ZipArchive -ZipPath $missingZip -Entries @{
        "dam-hopper-server.exe" = "MZ-MOCK"
        "LICENSE"               = "MIT"
        "README.md"             = "README"
    }

    Write-Host "=== Starting local fixture server ==="
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "node"
    $psi.Arguments = "`"$FixtureScript`" --dir `"$ArtifactsDir`""
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $FixtureProcess = [System.Diagnostics.Process]::Start($psi)

    $portLine = $FixtureProcess.StandardOutput.ReadLine()
    if ($null -eq $portLine -or -not $portLine.StartsWith("SERVER_PORT=")) {
        $err = $FixtureProcess.StandardError.ReadToEnd()
        Write-Error "Failed to start fixture server: $err"
        exit 1
    }
    $FixturePort = $portLine.Substring("SERVER_PORT=".Length).Trim()
    $FixtureBase = "http://127.0.0.1:$FixturePort"
    Write-Host "Fixture server listening on $FixtureBase"

    $env:DAM_HOPPER_TEST_API_BASE = $FixtureBase
    $env:GITHUB_REPOSITORY = "loidinhm31/dam-hopper"

    # =========================================================================
    # Test 1: Clean Install -Version v1.0.0
    # =========================================================================
    Write-Host "[Test 1] Clean Install (-Version v1.0.0)..."
    $InstallDir1 = Join-Path $TestWorkspace "install-1"
    $res = Invoke-Installer -ArgumentList @("-Version", "v1.0.0", "-InstallDir", "`"$InstallDir1`"")
    if ($res.ExitCode -ne 0) {
        Write-Error "Test 1 failed with exit code $($res.ExitCode): $($res.StdErr)"
        exit 1
    }

    $binExe = Join-Path $InstallDir1 "bin\dam-hopper-server.exe"
    $configToml = Join-Path $InstallDir1 "dam-hopper.toml"
    $exampleToml = Join-Path $InstallDir1 "dam-hopper.example.toml"
    $license = Join-Path $InstallDir1 "LICENSE"
    $readme = Join-Path $InstallDir1 "README.md"

    if (-not (Test-Path -LiteralPath $binExe)) { Write-Error "Test 1: bin\dam-hopper-server.exe missing"; exit 1 }
    if (-not (Test-Path -LiteralPath $configToml)) { Write-Error "Test 1: dam-hopper.toml missing"; exit 1 }
    if (-not (Test-Path -LiteralPath $exampleToml)) { Write-Error "Test 1: dam-hopper.example.toml missing"; exit 1 }
    if (-not (Test-Path -LiteralPath $license)) { Write-Error "Test 1: LICENSE missing"; exit 1 }
    if (-not (Test-Path -LiteralPath $readme)) { Write-Error "Test 1: README.md missing"; exit 1 }

    $exeContent = [System.IO.File]::ReadAllText($binExe)
    if ($exeContent -ne "MZ-MOCK-BINARY-V1.0.0") {
        Write-Error "Test 1: Binary content mismatch: '$exeContent'"
        exit 1
    }
    Write-Host "  -> Test 1 PASSED"

    # =========================================================================
    # Test 2: Upgrade with Config Preservation
    # =========================================================================
    Write-Host "[Test 2] Upgrade with Config Preservation (-Version v1.0.1)..."
    $customConfigText = "[server]`nhost = '127.0.0.1'`nport = 4801`n`n# CUSTOM USER MODIFICATION`ncustom_key = 'custom_val'`n"
    [System.IO.File]::WriteAllText($configToml, $customConfigText)

    $res = Invoke-Installer -ArgumentList @("-Version", "v1.0.1", "-InstallDir", "`"$InstallDir1`"")
    if ($res.ExitCode -ne 0) {
        Write-Error "Test 2 failed with exit code $($res.ExitCode): $($res.StdErr)"
        exit 1
    }

    $upgradedExeContent = [System.IO.File]::ReadAllText($binExe)
    if ($upgradedExeContent -ne "MZ-MOCK-BINARY-V1.0.1-UPGRADED") {
        Write-Error "Test 2: Upgraded binary content mismatch: '$upgradedExeContent'"
        exit 1
    }

    $preservedConfigText = [System.IO.File]::ReadAllText($configToml)
    if ($preservedConfigText -ne $customConfigText) {
        Write-Error "Test 2: User config was overwritten or corrupted on upgrade!"
        exit 1
    }
    Write-Host "  -> Test 2 PASSED"

    # =========================================================================
    # Test 3: -Latest resolution
    # =========================================================================
    Write-Host "[Test 3] -Latest Resolution..."
    $InstallDir3 = Join-Path $TestWorkspace "install-3"
    $res = Invoke-Installer -ArgumentList @("-Latest", "-InstallDir", "`"$InstallDir3`"")
    if ($res.ExitCode -ne 0) {
        Write-Error "Test 3 failed with exit code $($res.ExitCode): $($res.StdErr)"
        exit 1
    }

    $latestExe = Join-Path $InstallDir3 "bin\dam-hopper-server.exe"
    if (-not (Test-Path -LiteralPath $latestExe)) { Write-Error "Test 3: latest binary missing"; exit 1 }
    $latestExeContent = [System.IO.File]::ReadAllText($latestExe)
    if ($latestExeContent -ne "MZ-MOCK-BINARY-V1.2.0-LATEST") {
        Write-Error "Test 3: Latest binary content mismatch: '$latestExeContent'"
        exit 1
    }
    Write-Host "  -> Test 3 PASSED"

    # =========================================================================
    # Test 4: -DryRun mode (zero mutations)
    # =========================================================================
    Write-Host "[Test 4] -DryRun Mode..."
    $DryRunDir = Join-Path $TestWorkspace "dry-run-target"
    $res = Invoke-Installer -ArgumentList @("-Version", "v1.0.0", "-InstallDir", "`"$DryRunDir`"", "-DryRun")
    if ($res.ExitCode -ne 0) {
        Write-Error "Test 4 failed with exit code $($res.ExitCode): $($res.StdErr)"
        exit 1
    }
    if (Test-Path -LiteralPath $DryRunDir) {
        Write-Error "Test 4: DryRun created target directory '$DryRunDir'!"
        exit 1
    }
    Write-Host "  -> Test 4 PASSED"

    # =========================================================================
    # Test 5: Negative - Bad digest in release metadata fails closed
    # =========================================================================
    Write-Host "[Test 5] Tampered Digest Fails Closed..."
    $BadDigestDir = Join-Path $TestWorkspace "bad-digest-target"
    $res = Invoke-Installer -ArgumentList @("-Version", "v1.0.0", "-InstallDir", "`"$BadDigestDir`"") -ApiBaseOverride "$FixtureBase/negative/bad-digest"
    if ($res.ExitCode -eq 0) {
        Write-Error "Test 5: Installer succeeded unexpectedly with tampered digest!"
        exit 1
    }
    if (Test-Path -LiteralPath $BadDigestDir) {
        Write-Error "Test 5: Bad digest left partial directory in '$BadDigestDir'!"
        exit 1
    }
    Write-Host "  -> Test 5 PASSED"

    # =========================================================================
    # Test 6: Negative - Mismatched size fails closed
    # =========================================================================
    Write-Host "[Test 6] Mismatched Size Fails Closed..."
    $BadSizeDir = Join-Path $TestWorkspace "bad-size-target"
    $res = Invoke-Installer -ArgumentList @("-Version", "v1.0.0", "-InstallDir", "`"$BadSizeDir`"") -ApiBaseOverride "$FixtureBase/negative/bad-size"
    if ($res.ExitCode -eq 0) {
        Write-Error "Test 6: Installer succeeded unexpectedly with mismatched size!"
        exit 1
    }
    if (Test-Path -LiteralPath $BadSizeDir) {
        Write-Error "Test 6: Bad size left partial directory in '$BadSizeDir'!"
        exit 1
    }
    Write-Host "  -> Test 6 PASSED"

    # =========================================================================
    # Test 7: Negative - Unsafe path traversal in archive fails closed
    # =========================================================================
    Write-Host "[Test 7] Unsafe Traversal in Archive Rejected..."
    $TraversalTargetDir = Join-Path $TestWorkspace "traversal-target"
    $res = Invoke-Installer -ArgumentList @("-Version", "v1.0.0", "-InstallDir", "`"$TraversalTargetDir`"") -ApiBaseOverride "$FixtureBase/negative/unsafe-traversal"
    if ($res.ExitCode -eq 0) {
        Write-Error "Test 7: Installer succeeded unexpectedly with traversal archive!"
        exit 1
    }
    if (Test-Path -LiteralPath $TraversalTargetDir) {
        Write-Error "Test 7: Traversal attack left files in '$TraversalTargetDir'!"
        exit 1
    }
    Write-Host "  -> Test 7 PASSED"

    # =========================================================================
    # Test 8: Negative - Non-root directory entries in archive rejected
    # =========================================================================
    Write-Host "[Test 8] Non-root Directory Entry in Archive Rejected..."
    $DirTargetDir = Join-Path $TestWorkspace "dir-target"
    $res = Invoke-Installer -ArgumentList @("-Version", "v1.0.0", "-InstallDir", "`"$DirTargetDir`"") -ApiBaseOverride "$FixtureBase/negative/unsafe-directory"
    if ($res.ExitCode -eq 0) {
        Write-Error "Test 8: Installer succeeded unexpectedly with non-root directory entry!"
        exit 1
    }
    if (Test-Path -LiteralPath $DirTargetDir) {
        Write-Error "Test 8: Directory attack left files in '$DirTargetDir'!"
        exit 1
    }
    Write-Host "  -> Test 8 PASSED"

    # =========================================================================
    # Test 9: Negative - Extra member in archive rejected
    # =========================================================================
    Write-Host "[Test 9] Extra Archive Member Rejected..."
    $ExtraTargetDir = Join-Path $TestWorkspace "extra-target"
    $res = Invoke-Installer -ArgumentList @("-Version", "v1.0.0", "-InstallDir", "`"$ExtraTargetDir`"") -ApiBaseOverride "$FixtureBase/negative/extra-member"
    if ($res.ExitCode -eq 0) {
        Write-Error "Test 9: Installer succeeded unexpectedly with extra archive member!"
        exit 1
    }
    if (Test-Path -LiteralPath $ExtraTargetDir) {
        Write-Error "Test 9: Extra member attack left files in '$ExtraTargetDir'!"
        exit 1
    }
    Write-Host "  -> Test 9 PASSED"

    # =========================================================================
    # Test 10: Negative - Missing member in archive rejected
    # =========================================================================
    Write-Host "[Test 10] Missing Archive Member Rejected..."
    $MissingTargetDir = Join-Path $TestWorkspace "missing-target"
    $res = Invoke-Installer -ArgumentList @("-Version", "v1.0.0", "-InstallDir", "`"$MissingTargetDir`"") -ApiBaseOverride "$FixtureBase/negative/missing-member"
    if ($res.ExitCode -eq 0) {
        Write-Error "Test 10: Installer succeeded unexpectedly with missing archive member!"
        exit 1
    }
    if (Test-Path -LiteralPath $MissingTargetDir) {
        Write-Error "Test 10: Incomplete archive left files in '$MissingTargetDir'!"
        exit 1
    }
    Write-Host "  -> Test 10 PASSED"

    # =========================================================================
    # Test 11: Negative - Invalid parameter combinations
    # =========================================================================
    Write-Host "[Test 11] Invalid Parameter Handling..."

    # Relative path
    $res = Invoke-Installer -ArgumentList @("-Version", "v1.0.0", "-InstallDir", "`"./relative/path`"")
    if ($res.ExitCode -eq 0) { Write-Error "Test 11a: Relative path accepted unexpectedly"; exit 1 }

    # Invalid tag format (missing 'v')
    $res = Invoke-Installer -ArgumentList @("-Version", "1.0.0", "-InstallDir", "`"$InstallDir1`"")
    if ($res.ExitCode -eq 0) { Write-Error "Test 11b: Invalid tag format accepted unexpectedly"; exit 1 }

    Write-Host "  -> Test 11 PASSED"

    # =========================================================================
    # Test 12: -AddToPath functionality & idempotence
    # =========================================================================
    Write-Host "[Test 12] -AddToPath Functionality and Idempotence..."
    $PathTestDir = Join-Path $TestWorkspace "path-test"
    $PathBinDir = Join-Path $PathTestDir "bin"

    $res = Invoke-Installer -ArgumentList @("-Version", "v1.0.0", "-InstallDir", "`"$PathTestDir`"", "-AddToPath")
    if ($res.ExitCode -ne 0) {
        Write-Error "Test 12: Installer with -AddToPath failed with exit code $($res.ExitCode): $($res.StdErr)"
        exit 1
    }

    $updatedUserPath = [Environment]::GetEnvironmentVariable("Path", [System.EnvironmentVariableTarget]::User)
    $pathEntries = $updatedUserPath -split ';'
    $matchCount = 0
    foreach ($entry in $pathEntries) {
        try {
            if ([string]::Equals([System.IO.Path]::GetFullPath($entry).TrimEnd('\', '/'), [System.IO.Path]::GetFullPath($PathBinDir).TrimEnd('\', '/'), [System.StringComparison]::OrdinalIgnoreCase)) {
                $matchCount++
            }
        } catch {}
    }
    if ($matchCount -ne 1) {
        Write-Error "Test 12: Expected exactly 1 match for $PathBinDir in User PATH, found $matchCount"
        exit 1
    }

    # Second run: assert idempotence (no duplication)
    $res = Invoke-Installer -ArgumentList @("-Version", "v1.0.0", "-InstallDir", "`"$PathTestDir`"", "-AddToPath")
    if ($res.ExitCode -ne 0) {
        Write-Error "Test 12: Second installer run failed with exit code $($res.ExitCode): $($res.StdErr)"
        exit 1
    }

    $updatedUserPath2 = [Environment]::GetEnvironmentVariable("Path", [System.EnvironmentVariableTarget]::User)
    $pathEntries2 = $updatedUserPath2 -split ';'
    $matchCount2 = 0
    foreach ($entry in $pathEntries2) {
        try {
            if ([string]::Equals([System.IO.Path]::GetFullPath($entry).TrimEnd('\', '/'), [System.IO.Path]::GetFullPath($PathBinDir).TrimEnd('\', '/'), [System.StringComparison]::OrdinalIgnoreCase)) {
                $matchCount2++
            }
        } catch {}
    }
    if ($matchCount2 -ne 1) {
        Write-Error "Test 12: Entry duplicated in User PATH! Found $matchCount2 instances"
        exit 1
    }
    Write-Host "  -> Test 12 PASSED"

    # =========================================================================
    # Test 13: Non-loopback cleartext HTTP rejected
    # =========================================================================
    Write-Host "[Test 13] Non-loopback Cleartext HTTP Rejected..."
    $res = Invoke-Installer -ArgumentList @("-Version", "v1.0.0", "-InstallDir", "`"$TestWorkspace\http-reject`"") -ApiBaseOverride "http://insecure-external.example.com/api"
    if ($res.ExitCode -eq 0) {
        Write-Error "Test 13: Insecure external HTTP accepted unexpectedly!"
        exit 1
    }
    if ($res.StdErr -notmatch "Cleartext HTTP test API base is only allowed") {
        Write-Error "Test 13: Expected loopback error message, got: $($res.StdErr)"
        exit 1
    }
    Write-Host "  -> Test 13 PASSED"

    # =========================================================================
    # Test 14: Locked binary upgrade fails with actionable error and no orphans
    # =========================================================================
    Write-Host "[Test 14] Locked Binary Upgrade Handling..."
    $lockTargetDir = Join-Path $TestWorkspace "lock-test"
    $lockRes1 = Invoke-Installer -ArgumentList @("-Version", "v1.0.0", "-InstallDir", "`"$lockTargetDir`"")
    if ($lockRes1.ExitCode -ne 0) {
        Write-Error "Test 14: Initial install failed with exit code $($lockRes1.ExitCode)"
        exit 1
    }

    $lockedExePath = Join-Path $lockTargetDir "bin\dam-hopper-server.exe"
    $lockBinDir = Join-Path $lockTargetDir "bin"
    $fileLock = [System.IO.File]::Open($lockedExePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    try {
        $lockRes2 = Invoke-Installer -ArgumentList @("-Version", "v1.0.1", "-InstallDir", "`"$lockTargetDir`"")
        if ($lockRes2.ExitCode -eq 0) {
            Write-Error "Test 14: Upgrade succeeded unexpectedly while binary was locked!"
            exit 1
        }
        if ($lockRes2.StdErr -notmatch "(?s)Please ensure.*dam-hopper-server") {
            Write-Error "Test 14: Expected actionable in-use error message, got: $($lockRes2.StdErr)"
            exit 1
        }
        # Assert no orphaned .tmp files remain in bin directory
        $tmpFiles = @(Get-ChildItem -LiteralPath $lockBinDir -Filter "dam-hopper-server.exe.tmp*" -File)
        if ($tmpFiles.Count -gt 0) {
            Write-Error "Test 14: Found orphaned temporary binary files in '$lockBinDir': $($tmpFiles.Name -join ', ')"
            exit 1
        }
    } finally {
        $fileLock.Dispose()
    }
    Write-Host "  -> Test 14 PASSED"

    Write-Host ""
    Write-Host "======================================================="
    Write-Host " ALL 14 INTEGRATION TESTS PASSED SUCCESSFULLY! "
    Write-Host "======================================================="

} finally {
    # Teardown 1: Always restore original User PATH
    Write-Host "Teardown: Restoring User PATH..."
    try {
        [Environment]::SetEnvironmentVariable("Path", $OriginalUserPath, [System.EnvironmentVariableTarget]::User)
    } catch {
        Write-Warning "Failed to restore User PATH: $_"
    }

    # Teardown 2: Terminate fixture server
    if ($null -ne $FixtureProcess -and -not $FixtureProcess.HasExited) {
        Write-Host "Teardown: Stopping fixture server..."
        try {
            $FixtureProcess.Kill()
            $FixtureProcess.WaitForExit(5000)
        } catch {
            # Ignore process cleanup error
        }
    }

    # Teardown 3: Remove temporary test workspace
    if (Test-Path -LiteralPath $TestWorkspace) {
        Write-Host "Teardown: Cleaning test workspace..."
        Remove-Item -LiteralPath $TestWorkspace -Recurse -Force -ErrorAction SilentlyContinue
    }
}
