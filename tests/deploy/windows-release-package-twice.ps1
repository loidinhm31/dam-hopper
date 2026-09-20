[CmdletBinding()]
param(
    [string]$Version = "v0.1.0",
    [string]$BinaryPath = "",
    [string]$OutputDir = "",
    [int]$Epoch = 1700000000
)

# Strict error handling
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "../..")).Path

if ($Version -notmatch '^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') {
    Write-Error "Invalid version '$Version'. Must match vMAJOR.MINOR.PATCH"
    exit 1
}

$CreatedDummyBinary = $false
$DummyBinaryPath = ""

if (-not $BinaryPath) {
    $candidate1 = Join-Path $RepoRoot "server/target/x86_64-pc-windows-msvc/release/dam-hopper-server.exe"
    $candidate2 = Join-Path $RepoRoot "server/target/release/dam-hopper-server.exe"

    if (Test-Path $candidate1) {
        $BinaryPath = $candidate1
    } elseif (Test-Path $candidate2) {
        $BinaryPath = $candidate2
    } else {
        # Create a deterministic mock PE binary for packaging verification
        $DummyDir = Join-Path ([System.IO.Path]::GetTempPath()) ("dam-hopper-dummy-bin-" + [System.Guid]::NewGuid().ToString())
        [void][System.IO.Directory]::CreateDirectory($DummyDir)
        $DummyBinaryPath = Join-Path $DummyDir "dam-hopper-server.exe"
        $mockPeBytes = [System.Text.Encoding]::ASCII.GetBytes("MZ-MOCK-DAM-HOPPER-SERVER-WINDOWS-X86_64-DETERMINISTIC-BINARY")
        [System.IO.File]::WriteAllBytes($DummyBinaryPath, $mockPeBytes)
        $BinaryPath = $DummyBinaryPath
        $CreatedDummyBinary = $true
    }
}

$TestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("dam-hopper-win-pkg-twice-" + [System.Guid]::NewGuid().ToString())
[void][System.IO.Directory]::CreateDirectory($TestRoot)

try {
    $Run1Dir = Join-Path $TestRoot "run1"
    $Run2Dir = Join-Path $TestRoot "run2"
    $Run3Dir = Join-Path $TestRoot "run3"
    $FinalDir = Join-Path $TestRoot "final"

    [void][System.IO.Directory]::CreateDirectory($Run1Dir)
    [void][System.IO.Directory]::CreateDirectory($Run2Dir)
    [void][System.IO.Directory]::CreateDirectory($Run3Dir)
    [void][System.IO.Directory]::CreateDirectory($FinalDir)

    $packagerScript = Join-Path $RepoRoot "deploy/release/build-windows-release-archive.mjs"
    $checkerScript = Join-Path $RepoRoot "deploy/release/check-release-assets.mjs"

    # Run 1
    Write-Host "Building Windows release archive (Run 1)..."
    & node $packagerScript --tag $Version --binary $BinaryPath --output-dir $Run1Dir --epoch $Epoch
    if ($LASTEXITCODE -ne 0) {
        throw "Packager Run 1 failed with exit code $LASTEXITCODE"
    }

    # Run 2
    Write-Host "Building Windows release archive (Run 2)..."
    & node $packagerScript --tag $Version --binary $BinaryPath --output-dir $Run2Dir --epoch $Epoch
    if ($LASTEXITCODE -ne 0) {
        throw "Packager Run 2 failed with exit code $LASTEXITCODE"
    }

    $ArchiveName = "dam-hopper-$Version-windows-x86_64.zip"
    $Archive1 = Join-Path $Run1Dir $ArchiveName
    $Archive2 = Join-Path $Run2Dir $ArchiveName

    if (-not (Test-Path $Archive1) -or -not (Test-Path $Archive2)) {
        throw "Built archive '$ArchiveName' not found in both run directories"
    }

    $Hash1 = (Get-FileHash -Path $Archive1 -Algorithm SHA256).Hash.ToLower()
    $Hash2 = (Get-FileHash -Path $Archive2 -Algorithm SHA256).Hash.ToLower()

    Write-Host "Run 1 SHA-256: $Hash1"
    Write-Host "Run 2 SHA-256: $Hash2"

    if ($Hash1 -ne $Hash2) {
        throw "Non-deterministic build: Archive hashes do not match ($Hash1 vs $Hash2)"
    }

    $Bytes1 = [System.IO.File]::ReadAllBytes($Archive1)
    $Bytes2 = [System.IO.File]::ReadAllBytes($Archive2)

    if ($Bytes1.Length -ne $Bytes2.Length) {
        throw "Non-deterministic build: Archive lengths differ ($($Bytes1.Length) vs $($Bytes2.Length))"
    }

    if (-not [System.Linq.Enumerable]::SequenceEqual([byte[]]$Bytes1, [byte[]]$Bytes2)) {
        throw "Non-deterministic build: Byte mismatch between independent builds"
    }
    Write-Host "[PASS] Byte-for-byte reproducibility verified across independent runs."
    # Negative check: different epoch produces different hash
    Write-Host "Testing negative verification with altered epoch..."
    & node $packagerScript --tag $Version --binary $BinaryPath --output-dir $Run3Dir --epoch ($Epoch + 100)
    if ($LASTEXITCODE -ne 0) {
        throw "Packager Run 3 failed with exit code $LASTEXITCODE"
    }
    $Archive3 = Join-Path $Run3Dir $ArchiveName
    $Hash3 = (Get-FileHash -Path $Archive3 -Algorithm SHA256).Hash.ToLower()
    if ($Hash3 -eq $Hash1) {
        throw "Determinism failure: Different epoch produced identical archive hash"
    }
    Write-Host "[PASS] Altered inputs produced different archive digest ($Hash3 != $Hash1)."
    # Stage final directory for Windows profile asset check
    Copy-Item -Path $Archive1 -Destination (Join-Path $FinalDir $ArchiveName)

    $realInstallScript = Join-Path $RepoRoot "deploy/release/dam-hopper-install.ps1"
    $targetInstallScript = Join-Path $FinalDir "dam-hopper-install.ps1"

    if (Test-Path $realInstallScript) {
        Copy-Item -Path $realInstallScript -Destination $targetInstallScript
    } else {
        # Valid installer stub for testing Windows asset gate prior to Phase 02
        $stubContent = @"
<#
.SYNOPSIS
    DamHopper Windows Bootstrap Installer stub for Phase 01 verification.
#>
param(
    [string]`$Version = "$Version",
    [string]`$InstallDir,
    [switch]`$AddToPath,
    [switch]`$DryRun
)
Write-Output "DamHopper Windows installer stub ($Version)"
"@
        [System.IO.File]::WriteAllText($targetInstallScript, $stubContent, [System.Text.Encoding]::UTF8)
    }

    # Verify final directory with check-release-assets.mjs --profile windows
    Write-Host "Running release asset gate for Windows profile..."
    & node $checkerScript --profile windows --tag $Version --dir $FinalDir
    if ($LASTEXITCODE -ne 0) {
        throw "Windows release asset gate failed with exit code $LASTEXITCODE"
    }

    if ($OutputDir) {
        [void][System.IO.Directory]::CreateDirectory($OutputDir)
        Copy-Item -Path (Join-Path $FinalDir "*") -Destination $OutputDir -Force
        Write-Host "Copied verified release assets to $OutputDir"
    }

    Write-Host "Verified deterministic Windows package twice: $ArchiveName (sha256 $Hash1)"
} finally {
    if (Test-Path $TestRoot) {
        Remove-Item -Path $TestRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($CreatedDummyBinary -and (Test-Path $DummyBinaryPath)) {
        Remove-Item -Path (Split-Path -Parent $DummyBinaryPath) -Recurse -Force -ErrorAction SilentlyContinue
    }
}

