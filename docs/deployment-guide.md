# DamHopper Installation and Deployment Guide

DamHopper provides multiple installation paths suited for production deployments, non-admin Windows desktop usage, and local developer workstations.

## Deployment Topologies

| Topology | Target Host | Installer / Runner | Activation Model |
| --- | --- | --- | --- |
| **Linux Release** | Linux x86_64 systemd | `dam-hopper-install.sh` | Staged release candidate activated via `dam-hopper start` |
| **Windows Direct** | Windows x86_64 | `dam-hopper-install.ps1` | Standalone console executable in `%LOCALAPPDATA%\Programs\dam-hopper` |
| **Android Native** | Android 10+ (API 29+) | Signed Release APK | Assembled via `.github/workflows/release-android.yml` or `pnpm android:build` |
| **Source Build** | Any supported OS | `pnpm` + `cargo` | Compiled release binaries from Git clone |
| **Local Dev Loopback** | Workstation | `cargo run` (`--no-auth`) | Transient unauthenticated loopback server |
---

## 1. Linux Release Installer (x86_64 systemd)

DamHopper publishes immutable, SHA-256 attested release bundles for Linux x86_64 systemd environments meeting runtime requirements (glibc &ge; 2.39, systemd &ge; 245; tested distributions include Fedora, Ubuntu, Debian). Target hosts do not require a Rust compiler or Node.js runtime.

### Prerequisites

- Linux x86_64 with systemd (glibc &ge; 2.39, systemd &ge; 245)
- Standard utilities: `curl`, `tar`, `sha256sum`, `sudo`
- Optional: GitHub CLI (`gh`) for artifact attestation verification

### Step 1: Download Bootstrap Installer

```bash
curl -fsSLO https://github.com/loidinhm31/dam-hopper/releases/latest/download/dam-hopper-install.sh
chmod +x dam-hopper-install.sh
```

### Step 2: Stage a Release Candidate

The installer stages candidate files under `/var/lib/dam-hopper/releases/candidate`, installs the CLI manager to `/usr/local/bin/dam-hopper`, and leaves the release in `PENDING` state. **It never starts or activates services automatically.**

```bash
# API server role only (binds 0.0.0.0:4801)
./dam-hopper-install.sh --latest --role server

# Static web host role only (binds 0.0.0.0:4802)
./dam-hopper-install.sh --latest --role web

# Both roles on the same machine
./dam-hopper-install.sh --latest --role both --allow-web-origin http://localhost:4802

# Single-user workstation (runs as your desktop user account with native workspace access)
./dam-hopper-install.sh --latest --role both --service-user $(id -un)

# Install a specific release version tag
./dam-hopper-install.sh --version v0.10.2 --role both

# Verify GitHub artifact attestation using 'gh' CLI
./dam-hopper-install.sh --latest --role both --verify-attestation
```

### Step 3: Inspect Status

Inspect staged candidate metadata and current active release status:

```bash
dam-hopper status

# Or machine-readable JSON format:
dam-hopper status --json
```

### Step 4: Configure Production Environment & MFA Key

In production authenticated mode (`RUST_ENV=production` or `ENVIRONMENT=production` with either MongoDB or SQLite lite mode configured), a dedicated 32-byte encryption key is **mandatory** for encrypting TOTP MFA secrets at rest via AES-256-GCM (`DAM_HOPPER_MFA_KEY_FILE`). Server startup fails closed if this key is missing or contains group/world permission bits (`mode & 0o077 != 0` on Unix; `chmod 600` recommended).

```bash
# 1. Create config directory
sudo mkdir -p /etc/dam-hopper

# 2. Generate dedicated 32-byte MFA encryption key (64 hex characters) with mode 0600
openssl rand -hex 32 | sudo tee /etc/dam-hopper/mfa-encryption.key > /dev/null
sudo chown <API_USER>:<API_GROUP> /etc/dam-hopper/mfa-encryption.key
sudo chmod 600 /etc/dam-hopper/mfa-encryption.key
```

#### Option A: Default MongoDB Mode
Configure `/etc/dam-hopper/server.env` with MongoDB connection parameters:
```bash
sudo tee /etc/dam-hopper/server.env <<EOF
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DATABASE=damHopper
DAM_HOPPER_MFA_KEY_FILE=/etc/dam-hopper/mfa-encryption.key
DAM_HOPPER_CORS_ORIGINS=http://localhost:4802
EOF
sudo chmod 600 /etc/dam-hopper/server.env
```

#### Option B: SQLite Lite Mode (No MongoDB Required)
Configure `/etc/dam-hopper/server.env` with SQLite lite mode:
```bash
# Create private persistent state directory for auth.db
sudo mkdir -p /var/lib/dam-hopper
sudo chown <API_USER>:<API_GROUP> /var/lib/dam-hopper
sudo chmod 700 /var/lib/dam-hopper

sudo tee /etc/dam-hopper/server.env <<EOF
DAM_HOPPER_LITE_MODE=true
DAM_HOPPER_AUTH_SQLITE_PATH=/var/lib/dam-hopper/auth.db
DAM_HOPPER_MFA_KEY_FILE=/etc/dam-hopper/mfa-encryption.key
DAM_HOPPER_CORS_ORIGINS=http://localhost:4802
EOF
sudo chmod 600 /etc/dam-hopper/server.env
```

*Deployment & Auth Invariants*:
- `DAM_HOPPER_LITE_MODE=true` (or `1`, trim/case-insensitive) selects authenticated SQLite mode with no automatic fallback to MongoDB; SQLite initialization failure is fatal. It is **never** a synonym for the loopback-only `--no-auth` development bypass.
- Exactly **one server process per local auth file**. Do not share `auth.db` across multiple server processes or network/shared filesystems.

### Step 5: Activate the Release and Provision the First Account

Explicitly activate the staged candidate:

```bash
sudo dam-hopper start
```

The `start` command installs concrete systemd units, reloads `systemd`, starts configured services, and enforces a strict health gate: a 20-second startup deadline followed by 20 consecutive 500 ms health probes over a 10-second stability window. If health checks fail, the manager aborts activation and keeps prior units running.

**First-Account Provisioning (Post-Activation):** DamHopper never creates a default administrator or auto-promotes the first registrant. `POST /api/auth/register` creates a disabled `user` account (`auth_version = 0`) that returns `401 ACCOUNT_DISABLED` on login until an operator approves it. After `sudo dam-hopper start` succeeds, follow the **Deployment profile** in the canonical [Operator Account Approval and Role Promotion Runbook](./configuration/server-environment-auth.md#operator-account-approval-and-role-promotion-runbook) to register from the API host against `http://127.0.0.1:4801`, approve and promote the account via `sqlite3` (or `mongosh`), and complete TOTP MFA enrollment ([Authentication API](./api/authentication.md)). Never use the server's `server-token` signing secret as a client credential.
### Rollback and Recovery

```bash
# Roll back to the previous active release
sudo dam-hopper rollback

# Reconcile an interrupted transaction or crash
sudo dam-hopper recover
```

For complete unit definitions, runtime sandboxing (`ProtectSystem=strict`, `PrivateTmp=true`), and cgroup controls, see the [Linux systemd guide](./linux-systemd.md).

---

## 2. Windows Release Installer (x86_64 Direct Server)

DamHopper provides a verified PowerShell bootstrap installer and deterministic zip archive for Windows `x86_64-pc-windows-msvc`. No compiler, Node.js runtime, or administrative elevation is required.

### Prerequisites

- 64-bit Windows 10, 11, or Windows Server 2022+ (x86_64)
- PowerShell 5.1+ or PowerShell 7+
- Optional: GitHub CLI (`gh`) for artifact attestation verification

### One-Liner Installation

```powershell
Invoke-WebRequest -Uri "https://github.com/loidinhm31/dam-hopper/releases/latest/download/dam-hopper-install.ps1" -OutFile "$env:TEMP\dam-hopper-install.ps1"; & "$env:TEMP\dam-hopper-install.ps1" -Latest -AddToPath; Remove-Item "$env:TEMP\dam-hopper-install.ps1"
```

### Parameter Reference

`dam-hopper-install.ps1` supports explicit parameters:

```powershell
# Install a specific version and register bin in User PATH
.\dam-hopper-install.ps1 -Version v0.10.2 -AddToPath

# Install to custom directory (default: %LOCALAPPDATA%\Programs\dam-hopper)
.\dam-hopper-install.ps1 -Latest -InstallDir "D:\Tools\dam-hopper" -AddToPath

# Verify GitHub artifact attestation before extracting
.\dam-hopper-install.ps1 -Latest -AddToPath -VerifyAttestation

# Dry-run mode: verify release metadata and archive without writing files or changing PATH
.\dam-hopper-install.ps1 -Latest -DryRun
```

### Non-Admin Invariants

- **No elevation required:** Installs to `%LOCALAPPDATA%\Programs\dam-hopper` and registers `<InstallDir>\bin` in the current **User PATH** only (never modifies Machine PATH).
- **No background daemons:** The installer does not start background processes or install Windows Services.
- **Config preservation:** Pre-existing `dam-hopper.toml` configuration files are never overwritten.

### Launching the Server

Open a fresh PowerShell or Command Prompt terminal for User PATH updates to take effect:

```powershell
# Launch with default configuration
dam-hopper-server.exe --config "$env:LOCALAPPDATA\Programs\dam-hopper\dam-hopper.toml"

# Run on isolated loopback interface for local development
dam-hopper-server.exe --config "$env:LOCALAPPDATA\Programs\dam-hopper\dam-hopper.toml" --host 127.0.0.1 --port 4801
```

For authenticated SQLite lite mode on Windows (`$env:DAM_HOPPER_LITE_MODE="true"`, defaulting to `%APPDATA%\dam-hopper\auth.db` when `DAM_HOPPER_AUTH_SQLITE_PATH` is unset; one server process per local auth file), register and approve your first account using the canonical [Operator Account Approval and Role Promotion Runbook](./configuration/server-environment-auth.md#operator-account-approval-and-role-promotion-runbook).

### Upgrading on Windows

Re-running the installer with `-Latest` or a newer `-Version` safely stages and replaces the server executable while preserving your existing `dam-hopper.toml`:

```powershell
.\dam-hopper-install.ps1 -Latest
```

For asset manifests, attestation verification, and Windows MSVC details, see [Windows Release Asset Packaging](./windows-release-packaging.md).

---

## 3. Build from Source

Contributors and source packagers can build the backend and web frontend directly from Git:

### Prerequisites

- Git
- Node.js 20+ and pnpm 10+
- Current stable Rust toolchain (container builder pinned to 1.97.1; locked dependency MSRV 1.95)
- For native desktop host builds (`apps/native`):
  - **Browser Bridge Bundle:** Must run `pnpm --filter @dam-hopper/browser-bridge build` prior to building `apps/native` (required by `apps/native/src-tauri/build.rs`).
  - **Linux Platform Headers:** `webkit2gtk-4.1` development headers (`libwebkit2gtk-4.1-dev` on Debian/Ubuntu, `webkit2gtk4.1-devel` on Fedora).

### Build Steps

```bash
git clone https://github.com/loidinhm31/dam-hopper.git
cd dam-hopper

# 1. Install workspace dependencies
pnpm install

# 2. Build web client assets
pnpm build

# 3. Build optimized Rust release server
pnpm build:server

# 4. Run the release binary directly (default host 0.0.0.0:4800)
./server/target/release/dam-hopper-server --config ~/.config/dam-hopper/dam-hopper.toml
```
---

## 4. Local Development & Loopback Mode (`--no-auth`)

For local feature development and UI testing without configuring MongoDB or MFA keys, `dam-hopper-server` provides an explicit `--no-auth` bypass flag:

```bash
cargo run --manifest-path server/Cargo.toml --bin dam-hopper-server -- \
  --host 127.0.0.1 --port 4803 --no-auth \
  --cors-origins http://127.0.0.1:5173,http://localhost:5173
```

In another terminal, start the Vite development server:

```bash
pnpm --filter @dam-hopper/web stage:browser-extension
pnpm --filter @dam-hopper/web exec vite --host 127.0.0.1
```

### Strict Security Constraints for `--no-auth`

`--no-auth` is a local loopback development bypass—**never** SQLite lite mode (`DAM_HOPPER_LITE_MODE=true`). For authenticated local SQLite development and first-account approval, follow the **Development profile** in [Server Environment and Authentication](./configuration/server-environment-auth.md#operator-account-approval-and-role-promotion-runbook).

1. **Loopback Only (`127.0.0.1`):** The server binary defaults to binding `0.0.0.0`. When running with `--no-auth`, **always pass `--host 127.0.0.1`**. Never bind `--no-auth` to a public IP, LAN, or untrusted network.
2. **Forbidden in Production:** Server startup aborts if `RUST_ENV=production` or `ENVIRONMENT=production` is detected while `--no-auth` is active.
3. **Database Guard:** If an authentication store is initialized (`auth_store.is_some()`), `--no-auth` mode is rejected.
   - **Host Actions:** Host lifecycle actions return `403 FORBIDDEN` (`actionsDisabledNoAuth`).
   - **Idle Suspend:** Timing configuration and manual force-sleep endpoints return `403 FORBIDDEN` (`idleSuspendTimingDisabledNoAuth`).

---

## 5. Android Native Client Release & GitHub Actions Signing Setup

DamHopper provides an automated GitHub Actions release workflow for the Kotlin Multiplatform Android client (`native/android-app`).
Release builds enforce **fail-closed signing custody**: building or packaging a release APK without valid release signing credentials immediately fails the build to prevent distributing unsigned or debug-signed artifacts.

### 5.1 Keystore Generation (Operator Custody)

The production release signing key must be generated and held securely in operator custody outside the git repository. Local keystore files (`*.jks`, `*.keystore`) and base64 exports are ignored by `.gitignore`.

To generate a new release keypair with RSA 3072-bit encryption:

```bash
keytool -genkeypair \
  -keystore damhopper-release.jks \
  -alias damhopper-release \
  -keyalg RSA \
  -keysize 3072 \
  -validity 10000 \
  -storetype JKS
```

When prompted, record the keystore store password, key alias, and key password in your secure password manager.

### 5.2 Encoding the Keystore for GitHub Actions

GitHub Actions secrets cannot store binary files directly. Encode the keystore into a single-line base64 string:

**Linux / macOS (Bash):**

```bash
base64 -w 0 damhopper-release.jks > keystore_base64.txt
```

**Windows (PowerShell):**

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("damhopper-release.jks")) | Out-File -Encoding ascii keystore_base64.txt
```

*(Note: `keystore_base64.txt` is explicitly ignored by `.gitignore` to prevent accidental commits).*

### 5.3 Configuring GitHub Repository Secrets

Navigate to your repository settings:
**GitHub Repository → Settings → Secrets and variables → Actions → New repository secret**

Add the following four mandatory repository secrets:

| Secret Name | Description | Example / Format |
| :--- | :--- | :--- |
| `DAMHOPPER_KEYSTORE_BASE64` | Base64-encoded release JKS file | Full content of `keystore_base64.txt` (single-line string) |
| `DAMHOPPER_KEY_ALIAS` | Key alias name inside the keystore | `damhopper-release` |
| `DAMHOPPER_STORE_PASSWORD` | Password used to open the keystore file | `<store_password>` |
| `DAMHOPPER_KEY_PASSWORD` | Password protecting the private key alias | `<key_password>` |

### 5.4 Triggering the Release Workflow

The workflow `.github/workflows/release-android.yml` can be triggered via two methods:

1. **Tag Push (Automatic Production Release)**:
   Pushing any tag matching `v*` (e.g. `v0.13.2`) or `android-v*` (e.g. `android-v0.1.0`):
   ```bash
   git tag android-v0.1.0
   git push origin android-v0.1.0
   ```
   The workflow automatically:
   - Validates semantic versioning against committed `native/android-app/gradle.properties`.
   - Cross-compiles the Rust `crypto-bridge` cdylib (`libdamhopper_crypto_bridge.so`) for target ABIs (`arm64-v8a`, `x86_64`) via `cargo-ndk`.
   - Decodes the release keystore into a secure runner directory with `chmod 600`.
   - Assembles the signed production APK (`:androidApp:assembleRelease`).
   - Audits signature and manifest security via `native/android-app/scripts/release-security-check.mjs`.
   - Securely wipes the temporary keystore using `shred -u`.
   - Stages and uploads `damhopper-android-<version>.apk` as a release artifact.

2. **Manual Trigger (GitHub Actions UI)**:
   - Navigate to **Actions → "Release Android Native App" → Run workflow**.
   - Optional tag override (e.g., `android-v0.1.0`).
   - Optional diagnostic toggle: `build_debug_only` (set `true` to build and test an unsigned debug APK without requiring release secrets).

### 5.5 Local Manual Signed Release Build

To assemble and verify a signed release APK locally on an operator workstation:

```bash
export DAMHOPPER_KEYSTORE="/path/to/damhopper-release.jks"
export DAMHOPPER_KEY_ALIAS="damhopper-release"
export DAMHOPPER_STORE_PASSWORD="<store_password>"
export DAMHOPPER_KEY_PASSWORD="<key_password>"

# Build signed release APK
pnpm android:build
# or: node scripts/run-gradle.mjs :androidApp:assembleRelease

# Audit APK signature and manifest invariants
node native/android-app/scripts/release-security-check.mjs \
  --apk native/android-app/androidApp/build/outputs/apk/release/androidApp-release.apk
```

---

## 6. Related Documentation

- [Android Native Client Guide](../native/android-app/README.md) — Kotlin Multiplatform architecture, Compose UI, and testing.
- [Linux Systemd & Operations Guide](./linux-systemd.md) — Production units, cgroups, tmpfiles, and security sandbox.
- [Windows Release Packaging](./windows-release-packaging.md) — Windows asset structure, deterministic ZIP layout, and attestation.
- [Configuration Guide Index](./configuration/index.md) — TOML registry schema, server options, and profiles.
- [Server Environment and Authentication](./configuration/server-environment-auth.md) — `DAM_HOPPER_LITE_MODE`, `DAM_HOPPER_AUTH_SQLITE_PATH`, `DAM_HOPPER_MFA_KEY_FILE`, and the canonical first-account operator runbook.
- [Authentication API](./api/authentication.md) — Session tokens, TOTP MFA, and credentials specification.
