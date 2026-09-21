<#
.SYNOPSIS
    DamHopper Windows Non-Admin Bootstrap Installer.

.DESCRIPTION
    Resolves, authenticates, and installs the DamHopper server on Windows x86_64
    into the current user's LocalAppData without requiring administrative rights.
    Verifies SHA-256 asset integrity against authoritative release metadata,
    optionally verifies GitHub artifact attestations, extracts validated archive
    members, and preserves existing user configuration. Does NOT start the server.

.PARAMETER Version
    Exact release version tag to install (e.g. v0.1.0). Must match vMAJOR.MINOR.PATCH.

.PARAMETER Latest
    Resolve and install the latest stable release.

.PARAMETER InstallDir
    Target installation directory. Must be an absolute path.
    Default: %LOCALAPPDATA%\Programs\dam-hopper

.PARAMETER AddToPath
    Add <InstallDir>\bin to the current User's PATH environment variable.
    Does not modify Machine PATH or require elevation.

.PARAMETER VerifyAttestation
    Verify GitHub artifact attestations using the 'gh' CLI before extraction.

.PARAMETER DryRun
    Download and verify release metadata and archive without writing to the
    destination directory or modifying PATH.

.PARAMETER Help
    Show usage and help information.

.EXAMPLE
    .\dam-hopper-install.ps1 -Latest
    Installs the latest stable release to %LOCALAPPDATA%\Programs\dam-hopper.

.EXAMPLE
    .\dam-hopper-install.ps1 -Version v0.1.0 -AddToPath
    Installs v0.1.0 and adds the bin directory to User PATH.

.EXAMPLE
    .\dam-hopper-install.ps1 -Version v0.1.0 -InstallDir "C:\Tools\dam-hopper" -DryRun
    Verifies release v0.1.0 without modifying the target directory.
#>

[CmdletBinding(DefaultParameterSetName = "Default")]
param(
    [Parameter(ParameterSetName = "VersionSet")]
    [string]$Version,

    [Parameter(ParameterSetName = "LatestSet")]
    [switch]$Latest,

    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\dam-hopper"),

    [switch]$AddToPath,

    [switch]$VerifyAttestation,

    [switch]$DryRun,

    [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Show-Usage {
    Write-Host @"
DamHopper Windows Bootstrap Installer

Usage:
  dam-hopper-install.ps1 (-Version <vX.Y.Z> | -Latest) [options]

Options:
  -Version <tag>         Exact release version tag to install (e.g. v0.1.0)
  -Latest                Resolve and install the latest stable release
  -InstallDir <path>     Installation directory (default: %LOCALAPPDATA%\Programs\dam-hopper)
  -AddToPath             Add <InstallDir>\bin to current User PATH (does not touch Machine PATH)
  -VerifyAttestation     Verify GitHub artifact attestation using the 'gh' CLI
  -DryRun                Resolve release and verify archive without writing to destination or PATH
  -Help, -?              Show this help message
"@
}

if ($Help) {
    Show-Usage
    exit 0
}

if ([string]::IsNullOrWhiteSpace($Version) -and (-not $Latest)) {
    Write-Error "Error: Either -Version <vX.Y.Z> or -Latest is required"
    Show-Usage
    exit 1
}

if (-not [string]::IsNullOrWhiteSpace($Version) -and $Latest) {
    Write-Error "Error: Cannot specify both -Version and -Latest"
    Show-Usage
    exit 1
}

# 1. Validate version tag
$TagPattern = '^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$'
if (-not $Latest) {
    if ($Version -notmatch $TagPattern) {
        Write-Error "Error: Invalid version '$Version'. Must match vMAJOR.MINOR.PATCH (e.g. v0.1.0)"
        exit 1
    }
}

# 2. Validate InstallDir
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    Write-Error "Error: -InstallDir cannot be empty"
    exit 1
}
if (-not [System.IO.Path]::IsPathRooted($InstallDir)) {
    Write-Error "Error: -InstallDir must be an absolute path: '$InstallDir'"
    exit 1
}
$canonicalInstallDir = [System.IO.Path]::GetFullPath($InstallDir)
if (Test-Path -LiteralPath $canonicalInstallDir) {
    $existingItem = Get-Item -LiteralPath $canonicalInstallDir -Force
    if (-not $existingItem.PSIsContainer) {
        Write-Error "Error: InstallDir '$canonicalInstallDir' exists and is not a directory"
        exit 1
    }
    if ($existingItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        Write-Error "Error: InstallDir '$canonicalInstallDir' is a reparse point or symbolic link"
        exit 1
    }
}

# 3. Validate repository
$RepoPath = $env:GITHUB_REPOSITORY
if ([string]::IsNullOrWhiteSpace($RepoPath)) {
    $RepoPath = "loidinhm31/dam-hopper"
}
$RepoPattern = '^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$'
if ($RepoPath -notmatch $RepoPattern) {
    Write-Error "Error: Invalid repository '$RepoPath'. Must match OWNER/REPO"
    exit 1
}
$repoParts = $RepoPath -split '/'
$RepoOwner = $repoParts[0]
$RepoName = $repoParts[1]

# 4. Resolve API Base & enforce HTTPS / loopback policy
$ApiBase = $env:DAM_HOPPER_TEST_API_BASE
$IsTestEndpoint = $false
if (-not [string]::IsNullOrWhiteSpace($ApiBase)) {
    $IsTestEndpoint = $true
    try {
        $testUri = New-Object System.Uri($ApiBase)
    } catch {
        Write-Error "Error: Invalid test API base URI: '$ApiBase'"
        exit 1
    }
    if ($testUri.Scheme -ne "https" -and $testUri.Scheme -ne "http") {
        Write-Error "Error: Test API base URI must use http or https: '$ApiBase'"
        exit 1
    }
    if ($testUri.Scheme -eq "http" -and -not $testUri.IsLoopback) {
        Write-Error "Error: Cleartext HTTP test API base is only allowed on loopback addresses (127.0.0.1/localhost): '$ApiBase'"
        exit 1
    }
} else {
    $ApiBase = "https://api.github.com/repos/$RepoOwner/$RepoName"
}

if (-not $IsTestEndpoint) {
    if (-not $ApiBase.StartsWith("https://", [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-Error "Error: GitHub API URL must use HTTPS: '$ApiBase'"
        exit 1
    }
}

# Ensure TLS 1.2+
try {
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12
} catch {
    # Ignore if not available in current runtime
}

# Prepare separate headers: API headers (authenticated) vs Download headers (clean)
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

# Query release metadata
if ($Latest) {
    $releaseUrl = "$ApiBase/releases/latest"
} else {
    $releaseUrl = "$ApiBase/releases/tags/$Version"
}

Write-Host "Resolving release from $releaseUrl..."
try {
    $releaseJson = Invoke-RestMethod -Uri $releaseUrl -Headers $apiHeaders -Method Get -TimeoutSec 30
} catch {
    Write-Error "Error: Failed to fetch release metadata from '$releaseUrl': $_"
    exit 1
}

if ($null -eq $releaseJson -or $null -eq $releaseJson.PSObject.Properties['tag_name'] -or $null -eq $releaseJson.tag_name) {
    Write-Error "Error: Invalid release metadata received from '$releaseUrl'"
    exit 1
}

$ResolvedTag = [string]$releaseJson.tag_name
if ($ResolvedTag -notmatch $TagPattern) {
    Write-Error "Error: Release tag '$ResolvedTag' does not match vMAJOR.MINOR.PATCH"
    exit 1
}

if (-not $Latest -and $ResolvedTag -ne $Version) {
    Write-Error "Error: Resolved tag '$ResolvedTag' does not match requested tag '$Version'"
    exit 1
}

$ExpectedAssetName = "dam-hopper-$ResolvedTag-windows-x86_64.zip"
Write-Host "Resolved release $ResolvedTag. Looking for asset $ExpectedAssetName..."

if ($null -eq $releaseJson.PSObject.Properties['assets'] -or $null -eq $releaseJson.assets -or $releaseJson.assets.Count -eq 0) {
    Write-Error "Error: No assets found in release $ResolvedTag"
    exit 1
}

$matchingAssets = @($releaseJson.assets | Where-Object { $_.name -eq $ExpectedAssetName })
if ($matchingAssets.Count -ne 1) {
    Write-Error "Error: Expected asset '$ExpectedAssetName' not found in release $ResolvedTag"
    exit 1
}
$asset = $matchingAssets[0]

if ($asset.state -ne "uploaded") {
    Write-Error "Error: Asset '$ExpectedAssetName' state is '$($asset.state)', expected 'uploaded'"
    exit 1
}

$assetSize = [int64]$asset.size
if ($assetSize -le 0) {
    Write-Error "Error: Asset '$ExpectedAssetName' has non-positive size: $assetSize"
    exit 1
}
if ($assetSize -gt 524288000) { # 500 MB
    Write-Error "Error: Asset '$ExpectedAssetName' size exceeds 500 MB limit: $assetSize"
    exit 1
}

# 5. Resolve SHA-256 digest authority (safe dynamic property check under StrictMode Latest)
$assetDigest = $null
$hasAssetDigest = ($asset.PSObject.Properties['digest'] -ne $null)
if ($hasAssetDigest -and $null -ne $asset.digest -and -not [string]::IsNullOrWhiteSpace([string]$asset.digest)) {
    $rawDigest = [string]$asset.digest.Trim()
    if ($rawDigest -match '^sha256:([0-9a-fA-F]{64})$') {
        $assetDigest = $matches[1].ToLowerInvariant()
    } elseif ($rawDigest -match '^([0-9a-fA-F]{64})$') {
        $assetDigest = $matches[1].ToLowerInvariant()
    } else {
        Write-Error "Error: Invalid asset digest format: '$rawDigest'"
        exit 1
    }
}

# Check for release manifest if available
$manifestAsset = @($releaseJson.assets | Where-Object { $_.name -eq "release-manifest.json" })
$manifestDigest = $null
if ($manifestAsset.Count -eq 1 -and -not [string]::IsNullOrWhiteSpace([string]$manifestAsset[0].browser_download_url)) {
    try {
        $manifestUrl = [string]$manifestAsset[0].browser_download_url
        $manifestJson = Invoke-RestMethod -Uri $manifestUrl -Headers $apiHeaders -Method Get -TimeoutSec 30
        if ($null -ne $manifestJson -and $null -ne $manifestJson.PSObject.Properties['assets'] -and $null -ne $manifestJson.assets) {
            foreach ($mAsset in $manifestJson.assets) {
                $hasMAssetSha = ($mAsset.PSObject.Properties['sha256'] -ne $null)
                if ($mAsset.name -eq $ExpectedAssetName -and $hasMAssetSha -and -not [string]::IsNullOrWhiteSpace([string]$mAsset.sha256)) {
                    $manifestDigest = [string]$mAsset.sha256.Trim().ToLowerInvariant()
                    break
                }
            }
        }
    } catch {
        # Release manifest fetch optional; asset metadata may be primary
    }
}

$ExpectedDigest = $null
if ($null -ne $assetDigest -and $null -ne $manifestDigest) {
    if ($assetDigest -ne $manifestDigest) {
        Write-Error "Error: Digest conflict between release asset metadata ($assetDigest) and release manifest ($manifestDigest)"
        exit 1
    }
    $ExpectedDigest = $assetDigest
} elseif ($null -ne $assetDigest) {
    $ExpectedDigest = $assetDigest
} elseif ($null -ne $manifestDigest) {
    $ExpectedDigest = $manifestDigest
} else {
    Write-Error "Error: No authoritative SHA-256 digest found for '$ExpectedAssetName' in release metadata or manifest"
    exit 1
}

if ($ExpectedDigest -notmatch '^[0-9a-f]{64}$') {
    Write-Error "Error: Malformed SHA-256 digest '$ExpectedDigest'"
    exit 1
}

# 6. Validate download URL and download asset to private temporary directory
$DownloadUrl = [string]$asset.browser_download_url
if ($IsTestEndpoint) {
    try {
        $dlUri = New-Object System.Uri($DownloadUrl)
    } catch {
        Write-Error "Error: Invalid download URL: '$DownloadUrl'"
        exit 1
    }
    if ($dlUri.Scheme -ne "https" -and ($dlUri.Scheme -ne "http" -or -not $dlUri.IsLoopback)) {
        Write-Error "Error: Cleartext HTTP download URL is only allowed on loopback addresses: '$DownloadUrl'"
        exit 1
    }
} else {
    if (-not $DownloadUrl.StartsWith("https://", [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-Error "Error: Asset download URL must use HTTPS: '$DownloadUrl'"
        exit 1
    }
}

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("dam-hopper-install-" + [System.Guid]::NewGuid().ToString())
[void][System.IO.Directory]::CreateDirectory($TempDir)

try {
    $ZipPath = Join-Path $TempDir $ExpectedAssetName
    Write-Host "Downloading $ExpectedAssetName..."
    # Use clean download headers without Authorization or GitHub JSON Accept header
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipPath -Headers $downloadHeaders -TimeoutSec 120

    $downloadedItem = Get-Item -LiteralPath $ZipPath -Force
    if ($downloadedItem.Length -ne $assetSize) {
        Write-Error "Error: Downloaded file size ($($downloadedItem.Length)) does not match metadata size ($assetSize)"
        exit 1
    }

    $actualHashObj = Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256
    $actualDigest = $actualHashObj.Hash.ToLowerInvariant()
    if ($actualDigest -ne $ExpectedDigest) {
        Write-Error "Error: SHA-256 digest verification failed for $ExpectedAssetName`nExpected: $ExpectedDigest`nActual:   $actualDigest"
        exit 1
    }
    Write-Host "SHA-256 digest verified: $actualDigest"

    # 7. Optional GitHub attestation verification
    if ($VerifyAttestation) {
        $ghCmd = Get-Command gh -ErrorAction SilentlyContinue
        if ($null -eq $ghCmd) {
            Write-Error "Error: -VerifyAttestation requires the GitHub CLI ('gh') in PATH"
            exit 1
        }
        Write-Host "Verifying GitHub attestation for $ExpectedAssetName..."
        & gh attestation verify $ZipPath --repo "$RepoOwner/$RepoName"
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Error: Attestation verification failed for $ExpectedAssetName"
            exit 1
        }

        # If installer script is also published as an asset, verify its attestation
        $installerAsset = @($releaseJson.assets | Where-Object { $_.name -eq "dam-hopper-install.ps1" })
        if ($installerAsset.Count -eq 1 -and -not [string]::IsNullOrWhiteSpace([string]$installerAsset[0].browser_download_url)) {
            $installerPath = Join-Path $TempDir "dam-hopper-install.ps1"
            Invoke-WebRequest -Uri $installerAsset[0].browser_download_url -OutFile $installerPath -Headers $downloadHeaders -TimeoutSec 30
            & gh attestation verify $installerPath --repo "$RepoOwner/$RepoName"
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Error: Attestation verification failed for dam-hopper-install.ps1"
                exit 1
            }
        }
    }

    # 8. Safe ZIP Central-Directory Inspection & Extraction
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $RequiredMembers = @(
        "dam-hopper-server.exe",
        "dam-hopper.example.toml",
        "LICENSE",
        "README.md"
    )

    $StageDir = Join-Path $TempDir "stage"
    [void][System.IO.Directory]::CreateDirectory($StageDir)

    $zipArchive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        if ($zipArchive.Entries.Count -ne $RequiredMembers.Count) {
            Write-Error "Error: Release archive must contain exactly $($RequiredMembers.Count) members, found $($zipArchive.Entries.Count)"
            exit 1
        }

        $seenNames = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::Ordinal)
        $totalUncompressed = 0

        foreach ($entry in $zipArchive.Entries) {
            $name = $entry.FullName
            if ($name.Contains("/") -or $name.Contains("\")) {
                Write-Error "Error: Archive entry '$name' contains path separators; all members must be root files"
                exit 1
            }
            if ($name.Contains("..")) {
                Write-Error "Error: Archive entry '$name' contains traversal characters"
                exit 1
            }
            if (-not $RequiredMembers.Contains($name)) {
                Write-Error "Error: Unexpected archive entry '$name'"
                exit 1
            }
            if (-not $seenNames.Add($name)) {
                Write-Error "Error: Duplicate archive entry '$name'"
                exit 1
            }
            if ($entry.Length -le 0) {
                Write-Error "Error: Archive entry '$name' is empty"
                exit 1
            }
            $totalUncompressed += $entry.Length
            if ($totalUncompressed -gt 524288000) { # 500 MB limit
                Write-Error "Error: Archive uncompressed content exceeds 500 MB limit"
                exit 1
            }
        }

        foreach ($req in $RequiredMembers) {
            if (-not $seenNames.Contains($req)) {
                Write-Error "Error: Missing required archive member '$req'"
                exit 1
            }
        }

        # Extract verified members to private stage
        foreach ($entry in $zipArchive.Entries) {
            $targetFile = Join-Path $StageDir $entry.FullName
            $entryStream = $entry.Open()
            try {
                $fileStream = [System.IO.File]::Create($targetFile)
                try {
                    $entryStream.CopyTo($fileStream)
                } finally {
                    $fileStream.Dispose()
                }
            } finally {
                $entryStream.Dispose()
            }
        }
    } finally {
        $zipArchive.Dispose()
    }

    # 9. DryRun check
    $BinDir = Join-Path $canonicalInstallDir "bin"
    $DestExe = Join-Path $BinDir "dam-hopper-server.exe"
    $DestConfig = Join-Path $canonicalInstallDir "dam-hopper.toml"

    if ($DryRun) {
        Write-Host ""
        Write-Host "=== DamHopper Windows Installer (Dry Run) ==="
        Write-Host "Version:         $ResolvedTag"
        Write-Host "Repository:      $RepoOwner/$RepoName"
        Write-Host "InstallDir:      $canonicalInstallDir"
        Write-Host "BinaryPath:      $DestExe"
        Write-Host "ConfigPath:      $DestConfig"
        Write-Host "ArchiveDigest:   $ExpectedDigest"
        Write-Host "AddToPath:       $AddToPath"
        Write-Host "[DryRun] Verification succeeded. No files written, no PATH modifications made."
        return
    }

    # 10. Atomic installation with ReparsePoint checks & transactional binary replacement
    [void][System.IO.Directory]::CreateDirectory($canonicalInstallDir)

    if (Test-Path -LiteralPath $BinDir) {
        $binItem = Get-Item -LiteralPath $BinDir -Force
        if (-not $binItem.PSIsContainer) {
            Write-Error "Error: Destination bin path '$BinDir' exists and is not a directory"
            exit 1
        }
        if ($binItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            Write-Error "Error: Destination bin directory '$BinDir' is a reparse point or symbolic link"
            exit 1
        }
    } else {
        [void][System.IO.Directory]::CreateDirectory($BinDir)
    }

    if (Test-Path -LiteralPath $DestExe) {
        $destExeItem = Get-Item -LiteralPath $DestExe -Force
        if ($destExeItem.PSIsContainer) {
            Write-Error "Error: Destination executable '$DestExe' exists as a directory"
            exit 1
        }
        if ($destExeItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            Write-Error "Error: Destination executable '$DestExe' is a reparse point or symbolic link"
            exit 1
        }
    }

    $stagedExe = Join-Path $StageDir "dam-hopper-server.exe"
    $tmpDestExe = Join-Path $BinDir ("dam-hopper-server.exe.tmp-" + [System.Guid]::NewGuid().ToString())
    try {
        [System.IO.File]::Copy($stagedExe, $tmpDestExe, $true)

        $stagedHash = (Get-FileHash -LiteralPath $stagedExe -Algorithm SHA256).Hash
        $tmpHash = (Get-FileHash -LiteralPath $tmpDestExe -Algorithm SHA256).Hash
        if ($stagedHash -ne $tmpHash) {
            Write-Error "Error: Binary staging verification failed"
            exit 1
        }

        try {
            [System.IO.File]::Copy($tmpDestExe, $DestExe, $true)
        } catch [System.IO.IOException] {
            Write-Error "Error: Failed to replace '$DestExe'. Please ensure dam-hopper-server is not running before upgrading. Details: $_"
            exit 1
        } catch {
            Write-Error "Error: Failed to copy executable to '$DestExe': $_"
            exit 1
        }
    } finally {
        if (Test-Path -LiteralPath $tmpDestExe) {
            Remove-Item -LiteralPath $tmpDestExe -Force -ErrorAction SilentlyContinue
        }
    }

    # Copy notices & example configuration
    Copy-Item -LiteralPath (Join-Path $StageDir "LICENSE") -Destination (Join-Path $canonicalInstallDir "LICENSE") -Force
    Copy-Item -LiteralPath (Join-Path $StageDir "README.md") -Destination (Join-Path $canonicalInstallDir "README.md") -Force
    Copy-Item -LiteralPath (Join-Path $StageDir "dam-hopper.example.toml") -Destination (Join-Path $canonicalInstallDir "dam-hopper.example.toml") -Force

    # Preserve existing configuration or create from example
    if (-not (Test-Path -LiteralPath $DestConfig)) {
        Copy-Item -LiteralPath (Join-Path $StageDir "dam-hopper.example.toml") -Destination $DestConfig
        Write-Host "Created initial configuration: $DestConfig"
    } else {
        Write-Host "Preserved existing configuration: $DestConfig"
    }

    # 11. User PATH update
    if ($AddToPath) {
        $currentUserPath = [Environment]::GetEnvironmentVariable("Path", [System.EnvironmentVariableTarget]::User)
        if ($null -eq $currentUserPath) { $currentUserPath = "" }
        $rawEntries = $currentUserPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        $normalizedBinDir = [System.IO.Path]::GetFullPath($BinDir).TrimEnd('\', '/')
        $alreadyInPath = $false
        foreach ($entry in $rawEntries) {
            try {
                $norm = [System.IO.Path]::GetFullPath($entry).TrimEnd('\', '/')
                if ([string]::Equals($norm, $normalizedBinDir, [System.StringComparison]::OrdinalIgnoreCase)) {
                    $alreadyInPath = $true
                    break
                }
            } catch {
                # Ignore invalid entries in existing PATH
            }
        }
        if (-not $alreadyInPath) {
            $newEntries = @($rawEntries) + $normalizedBinDir
            $newUserPath = $newEntries -join ';'
            if ($newUserPath.Length -gt 2048) {
                Write-Warning "User PATH exceeds 2048 characters. Skipping automatic PATH addition to prevent truncation."
            } else {
                [Environment]::SetEnvironmentVariable("Path", $newUserPath, [System.EnvironmentVariableTarget]::User)
                $env:Path = "$env:Path;$normalizedBinDir"
                Write-Host "Added '$normalizedBinDir' to User PATH."
                Write-Host "Note: Open a new terminal session for the PATH update to take effect."
            }
        } else {
            Write-Host "'$normalizedBinDir' is already in User PATH."
        }
    }

    Write-Host ""
    Write-Host "DamHopper $ResolvedTag installed successfully."
    Write-Host "Location:       $canonicalInstallDir"
    Write-Host "Server binary:  $DestExe"
    Write-Host "Configuration:  $DestConfig"
    Write-Host ""
    Write-Host "To start the server, run:"
    Write-Host "  & `"$DestExe`" --config `"$DestConfig`""

} finally {
    if (Test-Path -LiteralPath $TempDir) {
        Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
