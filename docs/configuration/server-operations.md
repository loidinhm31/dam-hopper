# Server Operations and Troubleshooting

SSH key loading, smoke checklists, Windows direct-server operation, troubleshooting, workspace examples, and OMP integration moved from the [server configuration index](./server-configuration.md).
## SSH Key Management

SSH credentials are loaded on-demand via `/api/ssh/keys/load`. Use an
MFA-issued session JWT, not `server-token` (the server signing secret); see
[Authentication API](../api/authentication.md).

```bash
session_jwt="<session JWT returned by MFA confirmation or verification>"
curl -X POST \
  -H "Authorization: Bearer $session_jwt" \
  -H "Content-Type: application/json" \
  -d '{"privateKeyPath": "/home/user/.ssh/id_rsa"}' \
  http://localhost:4800/api/ssh/keys/load
```

Keys are stored in-memory per session (not persisted to disk).

## Manual Smoke Checklist

1. Create `~/.config/dam-hopper/dam-hopper.toml` with at least two projects whose `projects[].path` values point at separate roots. On Windows, use different drives if available.
   Expected: `GET /api/workspace/status` reports the registry `configPath` and the expected `projectCount`.

2. Start the same-origin server with `cargo run --manifest-path server/Cargo.toml -- --config ~/.config/dam-hopper/dam-hopper.toml --port 4800 --host 127.0.0.1`.
   Expected: startup succeeds without requiring a repo-local `dam-hopper.toml`.

3. Browse and read files in each project, then create or edit a file inside each root.
   Expected: list/read/write operations work inside the selected project and do not bleed across roots.

4. Create a terminal session for each project without passing `cwd`.
   Expected: each terminal starts in the selected project root.

5. Attempt a traversal or sibling-project read such as `/api/fs/read?project=alpha&path=../beta/owned.txt`.
   Expected: the server returns `403 FORBIDDEN`. Also verify rejection for a raw absolute path outside the configured root and for any symlink that resolves outside the selected project.

6. On Windows, change one project path to a mixed-separator absolute path and, if supported in your environment, a `\\?\` verbatim path.
   Expected: the registry still loads, the project remains accessible, and TOML writes preserve absolute paths instead of forcing them relative.

7. On Windows or in any environment with a reachable network share, add a temporary UNC-style project entry such as `path = "\\\\server\\share\\project"`.
   Expected: the registry either works for that project in your environment or fails in a clear, local way that you can document before rollout. Do not assume UNC behavior from Linux CI alone.

### Windows direct-server installation and configuration

The PowerShell bootstrap (`dam-hopper-install.ps1`) installs the Windows `x86_64-pc-windows-msvc` direct-server package without administrative elevation or service registration.

#### Directory layout
```text
%LOCALAPPDATA%\Programs\dam-hopper\
├── bin\
│   └── dam-hopper-server.exe     # Server executable
├── dam-hopper.example.toml       # Sample configuration template
├── dam-hopper.toml               # Active user configuration (preserved on upgrade)
├── LICENSE                       # License file
└── README.md                     # Release documentation
```

#### Installation and launch
```powershell
# Download and install latest release to %LOCALAPPDATA%\Programs\dam-hopper with User PATH update:
$installDir = Join-Path $env:LOCALAPPDATA "Programs\dam-hopper"
powershell -NoProfile -ExecutionPolicy Bypass -File .\dam-hopper-install.ps1 `
  -Latest -InstallDir $installDir -AddToPath

# On first install, copy sample configuration if dam-hopper.toml does not exist:
if (-not (Test-Path "$installDir\dam-hopper.toml")) {
  Copy-Item "$installDir\dam-hopper.example.toml" "$installDir\dam-hopper.toml"
}

# Launch the server (open a fresh shell if using PATH, or invoke directly):
& "$installDir\bin\dam-hopper-server.exe" --config "$installDir\dam-hopper.toml"
```

#### Upgrades, configuration preservation, and attestation
- **Configuration preservation:** Re-running the installer with `-Latest` or `-Version` safely stages and replaces `bin\dam-hopper-server.exe` while preserving your existing `dam-hopper.toml`.
- **User PATH:** `-AddToPath` appends `%LOCALAPPDATA%\Programs\dam-hopper\bin` to the current user's User PATH environment variable. Open a **fresh terminal** for PATH changes to take effect in your shell session.
- **Attestation verification:** Pass `-VerifyAttestation` during installation to verify the published Windows ZIP and installer assets with `gh`. For manual verification, attest the release subjects before extraction (the extracted `dam-hopper-server.exe` is not itself a published attestation subject):
  ```powershell
  $assetDir = Join-Path $env:TEMP "dam-hopper-release"
  gh attestation verify "$assetDir\dam-hopper-vX.Y.Z-windows-x86_64.zip" --repo "loidinhm31/dam-hopper"
  gh attestation verify "$assetDir\dam-hopper-install.ps1" --repo "loidinhm31/dam-hopper"
  ```
- **Dry-run mode:** Pass `-DryRun` to verify release metadata and archive integrity without modifying filesystem or environment state.
- **Environment and `.env` loading:** The server automatically loads `.env` files from: (1) the directory containing the active `dam-hopper.toml` configuration file (e.g. `%LOCALAPPDATA%\Programs\dam-hopper\.env`), (2) the canonical user configuration directory (`%USERPROFILE%\.config\dam-hopper\.env`), and (3) the current working directory. Variables set in the system/shell environment take precedence; this allows placing `MONGODB_URI` and `MONGODB_DATABASE` right next to `dam-hopper.toml`.
- **Platform boundaries:** Windows direct-server operation does not provide Linux systemd service management, manager migration, or terminal idle-suspend helper semantics. The server runs as a direct foreground process managed by the user or an external supervisor.
### Windows Server Loopback Smoke Checklist

To verify `dam-hopper-server` on Windows 11 without exposing network endpoints or touching production configuration:

1. **Create an isolated temporary configuration**:
   ```powershell
   # PowerShell
   $tempConfig = [System.IO.Path]::GetTempFileName() + ".toml"
   @'
   [workspace]
   name = "windows-smoke"

   [[projects]]
   name = "smoke-proj"
   path = "."
   type = "cargo"
   '@ | Set-Content -Path $tempConfig -Encoding utf8
   ```

   ```cmd
   :: cmd.exe
   set TEMP_CONFIG=%TEMP%\dam-hopper-smoke.toml
   (
     echo [workspace]
     echo name = "windows-smoke"
     echo.
     echo [[projects]]
     echo name = "smoke-proj"
     echo path = "."
     echo type = "cargo"
   ) > "%TEMP_CONFIG%"
   ```

2. **Start the server bound strictly to loopback (`127.0.0.1`) with `--no-auth`**:
   ```powershell
   # PowerShell; pre-build to avoid a first-run compile delay.
   cargo build --manifest-path server/Cargo.toml --bins
   $outLog = [System.IO.Path]::GetTempFileName()
   $errLog = [System.IO.Path]::GetTempFileName()
   $job = Start-Process -FilePath "cargo" -ArgumentList "run", "--manifest-path", "server/Cargo.toml", "--", "--config", $tempConfig, "--host", "127.0.0.1", "--port", "4801", "--no-auth" -WorkingDirectory (Get-Location).Path -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
   ```

3. **Probe `/api/health` and verify HTTP 200 JSON**:
   ```powershell
   $res = $null
   $deadline = (Get-Date).AddSeconds(30)
   while ((Get-Date) -lt $deadline -and $null -eq $res) {
     try {
       $candidate = Invoke-RestMethod -Uri "http://127.0.0.1:4801/api/health"
       if ($candidate.status -eq "ok" -and $candidate.schemaVersion -eq 1) { $res = $candidate }
     } catch {}
     if ($null -eq $res) { Start-Sleep -Milliseconds 500 }
   }
   if ($null -eq $res) { throw "Server did not become healthy within 30 seconds" }
   $res | ConvertTo-Json
   # Expected: status = "ok", schemaVersion = 1, role = "api"
   ```

4. **Clean up the recorded server process and temporary files**:
   ```powershell
   if (!$job.HasExited) { & taskkill.exe /PID $job.Id /T /F | Out-Null }
   Wait-Process -Id $job.Id -Timeout 5 -ErrorAction SilentlyContinue
   Remove-Item -Path $tempConfig, $outLog, $errLog -Force
   ```

## Troubleshooting Configuration

### Registry or project path not found

Error: `Workspace directory does not exist` or missing project path errors

Check:

1. Registry path exists: `ls ~/.config/dam-hopper/dam-hopper.toml`
2. Each `projects[].path` exists
3. Relative project paths are resolved from the registry file directory
4. User has read permissions

### Project not discovered

Error: `Project not found: {name}`

Verify in dam-hopper.toml:

1. Project name is correct
2. Project path exists relative to the registry file directory or is an absolute path
3. Project type matches actual structure

```bash
ls -la /configured/project/path
```

### Session token issues

When a session expires or stops validating, sign in with password and complete
MFA again. The `server-token` file is a signing secret, not a bearer token;
see [Authentication API](../api/authentication.md).

## Example: Multi-Project Workspace

```toml
[workspace]
name = "web-app-monorepo"

[[projects]]
name = "backend"
path = "./services/backend"
type = "cargo"
env_file = ".env.backend"
tags = ["api", "critical"]

[[projects]]
name = "frontend"
path = "./packages/frontend"
type = "pnpm"
tags = ["ui"]

[[projects]]
name = "mobile"
path = "./apps/mobile"
type = "custom"
build_command = "flutter build apk"
run_command = "flutter run"
tags = ["ios", "android"]

[[projects]]
name = "docs"
path = "./docs"
type = "custom"
build_command = "yarn build"
run_command = "yarn start"

[agent_store]
path = ".dam-hopper/agent-store"
```

Start server:

```bash
dam-hopper-server --config ~/.config/dam-hopper/dam-hopper.toml --port 4800
```

All four projects now accessible via `/api/projects` and `/api/fs/list?project=frontend&path=src`, etc.

## OMP Agent Status Integration

`dam-hopper-server` embeds a standalone OMP extension. Install it on the server
host as the OS user running OMP inside DamHopper PTYs. `--agent-dir` is required
and must name an existing absolute agent directory: `$HOME/.omp/agent` for the
default profile; pass the exact directory for a named or custom profile.

```bash
dam-hopper-server integration omp install --agent-dir "$HOME/.omp/agent"
dam-hopper-server integration omp status --agent-dir "$HOME/.omp/agent"
dam-hopper-server integration omp uninstall --agent-dir "$HOME/.omp/agent"
```

Add `--json` to any command for JSON output. These local commands do not start
the API server or require its workspace registry, database, or server token.

- `install` atomically installs or updates only
  `extensions/dam-hopper-agent-status.ts`; current content is a no-op. Modified
  or unmanaged contents are refused.
- `status` reports `absent`, `current`, `outdated`, or `modified`.
- `uninstall` removes only verified managed content. The CLI rejects symlink or
  nonregular extension files; unrelated extensions remain untouched.
- OMP must load extensions. Restart existing OMP sessions after install/update.
  The adapter reports only from managed interactive root sessions; see the
  [agent-status architecture](../architecture/agent-status.md) for protocol,
  state/outcome mapping, privacy, reconnect, and compatibility details.
