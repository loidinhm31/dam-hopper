# dam-hopper

A web-based app for managing multi-project development environments. Manage git operations, builds, and running services across all your projects from a single React UI backed by a Rust server with interactive PTY terminals.

## Features

- **Global project registry** — Define projects once in `~/.config/dam-hopper/dam-hopper.toml` or another registry file, then operate on all of them
- **Bulk git operations** — Fetch, pull, push across all projects with concurrent progress
- **Build management** — Build/run projects using per-type presets (Maven, Gradle, npm, pnpm, Cargo) or custom commands
- **Interactive terminals** — Full PTY terminals (xterm.js + portable-pty) per command — color, interactivity, scrollback
- **Git worktrees** — Create, list, and remove worktrees interactively
- **Workspace switching** — Switch between multiple workspace configs without restarting
- **Multi-server profiles** — Profile-scoped URLs, credentials, and local metadata with native/web transport boundaries
- **Browser Debug** — Web iframe fallback and optional native child WebView (Windows v1; Linux runtime-unverified)
- **Agent store** — Distribute Claude/Gemini agent configs (skills, commands, hooks) across projects via symlinks
- **Terminal idle suspend** — Opt-in host suspend with RTC wakealarm scheduling: default `empty-fleet` policy or configured `agent-activity` policy observing PTY raw output and attributable TCP byte activity. See [Configuration Guide](./docs/configuration-guide.md#terminal-idle-suspend-opt-in-linux-suspend) and [Security Guide](./docs/terminal-idle-suspend-security.md).

## Requirements

- Rust 1.97.1+ (server and native build toolchain; verify the pinned toolchain used by deployment)
- Node.js 20+ + pnpm 9+
- Android Studio + Android SDK/NDK + `JAVA_HOME` / `ANDROID_HOME` / `NDK_HOME` (for Android builds only)

## Installation

### Quickstart: Linux Release Installer (x86_64 systemd)

DamHopper releases are published as immutable, attested GitHub release bundles for Linux x86_64 systemd hosts (Ubuntu, Debian, Fedora, Arch, CentOS/RHEL, etc.). Target hosts do not require a compiler, Node.js, or Rust toolchain.

**Prerequisites:**

- Linux x86_64 with systemd (Ubuntu 24.04+, Fedora, Arch, etc.; glibc >= 2.39, systemd >= 245)
- `curl`, `tar`, `sha256sum`, `sudo`
- Optional: `gh` CLI (for GitHub artifact attestation verification)

1. **Download the bootstrap installer:**

   ```bash
   curl -fsSLO https://github.com/loidinhm31/dam-hopper/releases/latest/download/dam-hopper-install.sh
   chmod +x dam-hopper-install.sh
   ```

2. **Stage a candidate release (unprivileged fetch + staged candidate):**

   ```bash
   # API server role (0.0.0.0:4801)
   ./dam-hopper-install.sh --latest --role server

   # Dedicated static web host role (0.0.0.0:4802)
   ./dam-hopper-install.sh --latest --role web

   # Both roles in lockstep
   ./dam-hopper-install.sh --latest --role both --allow-web-origin http://localhost:4802

   # Single-user developer workstation (API runs as your user account with native workspace access):
   ./dam-hopper-install.sh --latest --role both --service-user $(id -un)

   _Note:_ The bootstrap installer stages candidate files, installs the CLI to `/usr/local/bin/dam-hopper`, and stops at `PENDING`. It never starts or activates services automatically.

   ```

3. **Inspect status:**

   ```bash
   dam-hopper status
   # Or JSON format:
   dam-hopper status --json
   ```

4. **Configure production environment & MFA key (`server` or `both` roles):**

   In production authenticated mode (`RUST_ENV=production` with MongoDB configured), a dedicated 32-byte encryption key is mandatory for encrypting TOTP secrets at rest (`DAM_HOPPER_MFA_KEY_FILE`). Startup fails closed if the key is missing or has insecure permissions (must be mode `0600`, regular file only).

   ```bash
   # Generate dedicated 32-byte MFA encryption key (64 hex characters) with strict 0600 permissions
   sudo mkdir -p /etc/dam-hopper
   openssl rand -hex 32 | sudo tee /etc/dam-hopper/mfa-encryption.key > /dev/null
   sudo chown <API_USER>:<API_GROUP> /etc/dam-hopper/mfa-encryption.key
   sudo chmod 600 /etc/dam-hopper/mfa-encryption.key

   # Add configuration to /etc/dam-hopper/server.env (see deploy/server.env.example)
   sudo tee -a /etc/dam-hopper/server.env <<EOF
   MONGODB_URI=mongodb://127.0.0.1:27017
   MONGODB_DATABASE=damHopper
   DAM_HOPPER_MFA_KEY_FILE=/etc/dam-hopper/mfa-encryption.key
   EOF
   sudo chmod 600 /etc/dam-hopper/server.env
   ```

5. **Explicitly activate the release:**

   ```bash
   sudo dam-hopper start
   ```

   `start` installs concrete systemd units, reloads the daemon, starts configured units, and enforces a strict health gate (20s startup deadline + 20 consecutive 500ms probes / 10s stability window).

6. **Rollback & Recovery:**

   ```bash
   # Roll back to the recorded previous release
   sudo dam-hopper rollback

   # Reconcile crash or interrupted transaction
   sudo dam-hopper recover
   ```

For complete operator instructions, systemd unit definitions, security boundaries, and format-2 migration, see [Linux systemd guide](./docs/linux-systemd.md).

### Plugin Runner & Workspace Permissions (Linux)

When deploying DamHopper with the plugin platform on Linux, the release manager enforces strict security boundaries between the API server (`dam-hopper-api.service`) and the plugin runner (`dam-hopper-plugin-runner.service`).

> **Security Invariant:** The API service user and plugin runner user **cannot be the same user or share a UID**. The installer will reject identical identities (`plugin owner user cannot be the API service user`).

Choose one of the two supported deployment architectures:

#### Mode 1: Developer Workstation (Recommended for Most Workflows)

The API server runs directly under your own user login (`--service-user $(id -un)`), while the plugin runner executes as the isolated system daemon `dam-hopper-plugin-runner` (UID 979):

```bash
# Install: omit --plugin-owner-user so the runner defaults to dam-hopper-plugin-runner
./dam-hopper-install.sh --latest --role both --service-user $(id -un)
```

- **Filesystem access:** The API server runs as you, giving it native, frictionless read/write access to all your project repositories (`~/WS`), build outputs (`dist/`), and configs without permission errors.
- **Granting the runner access to tool history (`~/.evcrate`):** Allow the isolated runner service to traverse your home directory and read/write tool history:

  ```bash
  # 1. Allow runner traversal through your home directory
  setfacl -m u:dam-hopper-plugin-runner:x "$HOME"

  # 2. Grant full recursive access and default inheritance on tool history
  setfacl -R -m u:dam-hopper-plugin-runner:rwx,m::rwx "$HOME/.evcrate"
  setfacl -R -d -m u:dam-hopper-plugin-runner:rwx,m::rwx "$HOME/.evcrate"
  chmod -R a+rX "$HOME/.evcrate"
  ```

#### Mode 2: Dedicated Daemon Account (Strict Process Isolation)

The API server runs as dedicated system user `dam-hopper`, and the plugin runner runs as your login:

```bash
# Requires creating system account 'dam-hopper' first
sudo useradd -r -U -M -s /sbin/nologin -d /var/lib/dam-hopper dam-hopper
./dam-hopper-install.sh --latest --role both --service-user dam-hopper --plugin-owner-user $(id -un)
```

- **Caveat:** Because the API server runs under daemon user `dam-hopper` (UID 978), any project files or build outputs with owner-only permissions (`0700` directories or `0600` files) will return `{"error":"FS error: permission denied"}` when browsed through the UI unless read permissions (`chmod -R a+rX`) or POSIX ACLs are explicitly granted.

---

### Configuring Global Owner History Source (Settings UI)

When enabling plugins that read global tool history (such as `evcrate.advisor`), administrators configure the **Global Owner History Source** in **Settings → Plugin Management**:

1. **Enable History Root:** Toggle the checkbox on.
2. **Absolute Host History Path:** Enter the full absolute path on the host to the history root directory (e.g. `/home/<your-user>/.evcrate/advisor-history`).
   - _Must be an absolute path._ Do not use relative paths, `~` tilde shorthand, or trailing slashes.
3. **Root Identity (SHA-256):** Enter the 64-character lowercase SHA-256 hex digest of the normalized absolute path string. DamHopper uses this cryptographic digest to pin the directory binding and prevent symlink or path-traversal attacks.

**How to calculate the Root Identity (SHA-256):**
Run this command in your terminal, replacing the path with your exact history directory:

```bash
printf '%s' "/home/$(id -un)/.evcrate/advisor-history" | sha256sum | awk '{print $1}'
```

_Example:_ For path `/home/developer/.evcrate/advisor-history`, the Root Identity is:

```text
8f0502d523c23fed2199adad18f14bfc6b4434bc695f5566151512ed18fe054d
```

4. **Allow all authenticated users to read history root:** Check this option if non-admin DamHopper users should be able to view analysis history.

### Quickstart: Windows Release Installer (x86_64 Direct Server)

DamHopper releases provide a verified PowerShell bootstrap installer and deterministic zip archive for Windows `x86_64-pc-windows-msvc`. No compiler, Node.js, or administrative elevation is required.

**Prerequisites:**

- 64-bit Windows 10 / 11 / Server 2022+ (x86_64)
- PowerShell 5.1+ or PowerShell 7+
- Internet access for downloading GitHub release assets
- Optional: GitHub CLI (`gh`) for artifact attestation verification

1. **Download and run the installer (one-liner):**

   ```powershell
   Invoke-WebRequest -Uri "https://github.com/loidinhm31/dam-hopper/releases/latest/download/dam-hopper-install.ps1" -OutFile "$env:TEMP\dam-hopper-install.ps1"; & "$env:TEMP\dam-hopper-install.ps1" -Latest -AddToPath; Remove-Item "$env:TEMP\dam-hopper-install.ps1"
   ```

2. **Or run with explicit parameters:**

   ```powershell
   # Install specific version with User PATH registration
   .\dam-hopper-install.ps1 -Version v0.4.2 -AddToPath

   # Install to custom directory
   .\dam-hopper-install.ps1 -Latest -InstallDir "D:\Tools\dam-hopper" -AddToPath

   # Verify GitHub artifact attestation (requires gh CLI)
   .\dam-hopper-install.ps1 -Latest -AddToPath -VerifyAttestation

   # Dry-run mode (verifies release metadata and archive without extracting or altering system state)
   .\dam-hopper-install.ps1 -Latest -DryRun
   ```

   _Note:_
   - Default install directory is `%LOCALAPPDATA%\Programs\dam-hopper` (`bin\dam-hopper-server.exe`).
   - The installer is non-admin: it never requests elevation, never starts background processes, and preserves existing configuration files (`dam-hopper.toml`).
   - When `-AddToPath` is used, the install `bin` directory is added to your **User PATH**. Open a fresh PowerShell or Command Prompt terminal for PATH changes to take effect in your shell session.

3. **Launch the server:**
   After opening a fresh terminal (or using the full binary path):

   ```powershell
   # Using PATH with default global config
   dam-hopper-server.exe --config "$env:LOCALAPPDATA\Programs\dam-hopper\dam-hopper.toml"

   # Loopback smoke test (development only)
   dam-hopper-server.exe --config "$env:LOCALAPPDATA\Programs\dam-hopper\dam-hopper.toml" --host 127.0.0.1 --port 4801
   ```

   _Development note:_ For local unauthenticated development without MongoDB, `--no-auth` can be used on a trusted loopback interface (`127.0.0.1:4801`). `--no-auth` is strictly forbidden in production environments.

4. **Upgrading:**
   Re-running the installer with `-Latest` or a newer `-Version` safely stages and replaces the server binary while preserving your existing `dam-hopper.toml` configuration:
   ```powershell
   .\dam-hopper-install.ps1 -Latest
   ```
   For the complete Windows asset contract, profile-specific release gates,
   attestation behavior, and configuration/smoke runbook, see
   [Windows Release Asset Packaging](./docs/windows-release-packaging.md) and the
   [Configuration Guide](./docs/configuration-guide.md#windows-direct-server-installation-and-configuration).

### Build from source (Contributors)

```bash
git clone https://github.com/loidinhm31/dam-hopper.git
cd dam-hopper

# Install dependencies and build web assets
pnpm install
pnpm build

# Build Rust release server
pnpm build:server

# Run the backend directly (default 0.0.0.0:4800)
./server/target/release/dam-hopper-server --config ~/.config/dam-hopper/dam-hopper.toml
```

## Configuration

Create `~/.config/dam-hopper/dam-hopper.toml`:

```toml
[workspace]
name = "my-workspace"

[[projects]]
name = "api-server"
path = "./api-server"
type = "maven"
build_command = "mvn clean package -DskipTests"
run_command = "java -jar target/app.jar"
env_file = ".env"

[[projects]]
name = "web-app"
path = "./web-app"
type = "pnpm"
```

Supported project types: `maven`, `gradle`, `npm`, `pnpm`, `cargo`, `custom`.

Each type has built-in default build/run commands. Override with `build_command` / `run_command`.

Project paths may be absolute or relative. Relative paths resolve against the registry file directory, so repo-local registries still work when you pass `--config /path/to/repo/dam-hopper.toml`.

For manual end-to-end validation of multi-root registries and escape rejection, see [docs/configuration-guide.md](docs/configuration-guide.md#manual-smoke-checklist).

## Development

```bash
# Install web dependencies
pnpm install

# Web dev mode (Vite HMR on http://localhost:5173)
pnpm dev

# Desktop Tauri shell (Vite on http://localhost:1420)
pnpm dev:native

# One-time Android scaffold refresh for the native app
pnpm android:init

# Android emulator / device dev
pnpm android:dev

# Android release artifacts (APK + AAB)
pnpm android:build

# Rust server for the Vite dev proxy (isolated loopback port 4801)
pnpm dev:server
# Or directly:
cd server && cargo run -- --config /path/to/dam-hopper.toml --host 127.0.0.1 --port 4801

# Build everything
pnpm build        # web app
pnpm build:native # desktop native host assets
pnpm build:server # Rust release binary

# Run Rust tests
pnpm test
# or: cd server && cargo test
# On Windows (page file / rlib limit): run serially with -j 1
# PowerShell / cmd: cd server && cargo test -j 1
# Lint web
pnpm lint

# Format
pnpm format
```

The generated Android Studio project lives in `apps/native/src-tauri/gen/android`. Tauri now runs the native package's local `npm run dev` / `npm run build` hooks, so Android Studio and Gradle do not depend on a globally installed `pnpm`.

### Windows Development & Qualification

`dam-hopper-server` is qualified on Windows 11 MSVC (`x86_64-pc-windows-msvc`). Commands can be run directly from PowerShell or `cmd.exe`:

```powershell
# Build debug binaries
cargo build --manifest-path server/Cargo.toml --bins

# Run server via default-run (resolves dam-hopper-server)
cargo run --manifest-path server/Cargo.toml -- --help

# Run release build
cargo build --manifest-path server/Cargo.toml --release --bin dam-hopper-server

# Run full serial test suite (avoids MSVC rlib/page-file exhaustion)
cargo test --manifest-path server/Cargo.toml -j 1

# Run isolated loopback smoke test (--no-auth)
cargo run --manifest-path server/Cargo.toml -- --config "C:\path\to\dam-hopper.toml" --host 127.0.0.1 --port 4801 --no-auth
```

**Platform Boundaries:**

- Linux-only utilities (`dam-hopper` release manager and `dam-hopper-idle-suspend-helper`) intentionally exit 1 with an explanatory message on Windows.
- Windows does not bind Unix helper sockets, probe sysfs/procfs, or attempt RTC/systemd suspend (`UnavailableExecutor` fail-closed behavior).
- Linux deployment qualification and systemd live tests require a Linux host.
  For the full path/TOML and health-cleanup procedure, see the [Windows server loopback smoke checklist](./docs/configuration-guide.md#windows-server-loopback-smoke-checklist). Terminal shell behavior is documented in the [API Reference](./docs/api-reference.md#terminals).

```text
server/        # Rust binary (Axum + Tokio) — all backend logic
apps/
  web/          # Thin Vite browser host
  native/       # Tauri desktop/Android host
packages/
  ui/           # Shared React UI and host adapter contract
  browser-bridge/ # v1 iframe/native DOM bridge
```
