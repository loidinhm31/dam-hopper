# Investigation & Hard-Fix Report: PTY User Environment & Terminal Copy

- **Date:** 2026-09-05
- **Task:** Diagnose why running under GitHub release assets caused `bash-5.3$` prompt, prevented user tools (`codex`, `omp`) from running, and broke terminal copy, whereas development mode worked smoothly.

---

## 1. Why Development Mode Worked vs Release Assets (Systemd)

| Aspect | Development Mode (`pnpm dev:server` / `cargo run`) | GitHub Release Assets (Systemd Service) |
|---|---|---|
| **Execution Context** | Run directly inside the interactive user shell (`loidinh@DESKTOP-L94MTTS`). | Spawned by Systemd (`systemd[1]`) as a system service (`dam-hopper-api.service`). |
| **`HOME` Variable** | Inherited from the developer session (`/home/loidinh`). | Explicitly configured to daemon state dir (`/var/lib/dam-hopper`). |
| **`USER` / `LOGNAME`** | Present in shell environment (`loidinh`). | Stripped by systemd (systemd does not populate `$USER` or `$LOGNAME` unless PAM is configured). |
| **`PATH` Environment** | Full developer login `PATH` (`~/.local/bin:~/.cargo/bin:~/.omp/bin:~/.nvm/...`). | Minimal systemd `PATH` (`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`). |
| **Bash RC Loading** | PTY spawned in user session found `/home/loidinh/.bashrc`, which configured `PS1` and user paths. | PTY inherited `HOME=/var/lib/dam-hopper`. Sourced `"$HOME/.bashrc"` (which does not exist). Bypassed `/etc/bash.bashrc` due to `--rcfile`. Defaulted to raw `bash-5.3$`. |
| **User Tools (`codex`, `omp`)** | Found immediately in `~/.local/bin` or `~/.cargo/bin` or `~/.omp/bin`. | "command not found" because `PATH` lacked user directories and no `~/.bashrc` / `~/.profile` was executed. |
| **Terminal Clipboard Copy** | Often accessed via `http://localhost:...`, which browsers treat as a **Secure Context** (`isSecureContext === true`). | When accessed via hostname (`http://DESKTOP-L94MTTS:4802`) or IP, browser disables `navigator.clipboard`. Without an `execCommand("copy")` fallback, writes silently fail. |

---

## 2. Root Cause & Solution

### A. Terminal Prompt (`bash-5.3$`) & Missing Commands (`codex`, `omp`)

1. **PTY Child Environment Resolution (`server/src/pty/manager.rs`):**
   - Added `resolve_current_user_account()` using `libc::getpwuid(libc::geteuid())`.
   - When spawning terminal PTYs, if `HOME` points to `/var/lib/dam-hopper` or is unset, `build_child_env_from_parent_snapshot` replaces `HOME` with the user's real home directory (e.g. `/home/loidinh` or `/home/ubuntu`).
   - Automatically populates `USER`, `LOGNAME`, and `SHELL` with the user's account details if missing.

2. **Shell Integration Wrapper (`server/src/pty/shell_integration.rs`):**
   - The bash integration wrapper now sources:
     - `/etc/profile`
     - `/etc/bash.bashrc` (Ubuntu/Debian system configuration)
     - `/etc/bashrc` (Fedora/RHEL)
     - `$HOME/.profile`
     - `$HOME/.bash_profile`
     - `$HOME/.bashrc`
   - Dynamically adds user tool directories (`$HOME/.local/bin`, `$HOME/.cargo/bin`, `$HOME/bin`, `$HOME/.omp/bin`, `$HOME/.evcrate/bin`) to `PATH` if present.
   - If `PS1` remains default or unset, defaults to `\[\e]0;\u@\h: \w\a\]\u@\h:\w\$ `, producing `loidinh@localhost:~$ `.

### B. Terminal Clipboard Copy Support

1. **Clipboard Fallback (`packages/ui/src/hooks/use-clipboard.ts`):**
   - Exported `copyToClipboard(text: string)`.
   - Uses `navigator.clipboard.writeText(text)` when available (secure contexts).
   - Gracefully falls back to `document.createElement("textarea")` + `document.execCommand("copy")` in insecure HTTP contexts (e.g. `http://DESKTOP-L94MTTS:4802` or `http://192.168.x.x:4802`).

2. **Terminal Shortcuts & Context Menu (`packages/ui/src/components/organisms/TerminalPanel.tsx`):**
   - When text is selected in xterm (`term.hasSelection()`):
     - Pressing `Ctrl+C` or `Cmd+C` now copies the selection to clipboard instead of sending `SIGINT` (`\x03`).
     - Right-clicking on the terminal surface copies the active selection to clipboard.
     - `Ctrl+Shift+C` / `Cmd+Shift+C` continues to copy selection.

---

## 3. Verification Evidence

- **PTY Unit Tests:** `cargo test pty` — 161/161 passed (0.00s).
- **Linux Release Integration Tests:** `cargo test --bin dam-hopper --test 'linux_release_*'` — 122/122 passed across 17 suites (0.16s).
- **UI & Web Application:**
  - `pnpm --filter @dam-hopper/ui test terminal-keyboard-shortcuts` — 21/21 passed.
  - `pnpm --filter @dam-hopper/web build` — compiled cleanly.
  - `pnpm release:verify && pnpm test:deploy` — all deployment journeys passed.
- **Shipped:**
  - Committed to `main`: `e8e33752`.
  - Recreated release tag `v0.2.0` at `e8e33752` and force-pushed to `origin`.
  - Release workflow run `33945025504` triggered on GitHub Actions.
