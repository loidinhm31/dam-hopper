# Research Report: Windows PTY terminal creation

**Date:** 2026-08-30 13:45 (ICT)  
**Scope:** portable-pty 0.8, Rust standard library, Windows `cmd.exe`/process launch. Read-only source/documentation research.

## Executive summary

The fix should resolve a real, existing directory before calling `CommandBuilder::cwd` on Windows, and should use the native command interpreter without Unix/Bash integration arguments. `portable-pty` exposes `cwd`, passes its effective directory to Windows `CreateProcessW`, and (in its Windows implementation) prefers a valid configured cwd, then a valid `USERPROFILE`, then a null current-directory pointer. Relying on an omitted/invalid cwd is therefore environment-dependent; explicitly selecting a valid directory is safer and testable.

For an interactive terminal, launch `cmd.exe` with no `/C`: it remains a command processor attached to the PTY. `/C` is appropriate only for a one-shot, non-interactive command because Microsoft specifies that it executes the string and exits. `/K` executes a string and keeps the processor running. Do not pass Bash-only flags to `cmd.exe`; they are not `cmd` options and can become an unintended command/string.

## Authoritative findings

### portable-pty 0.8

* `CommandBuilder::new(program)` sets argv[0]; `arg/args` append arguments. `cwd` stores the requested directory; `clear_cwd`, `get_cwd`, `env`, `env_clear`, and `get_env` are public APIs. The interface is intentionally similar to `std::process::Command`. [API docs](https://docs.rs/portable-pty/0.8.1/portable_pty/cmdbuilder/struct.CommandBuilder.html)
* Windows source computes an effective current directory by choosing a configured `cwd` only when `Path::is_dir()` succeeds, otherwise a `USERPROFILE` value only when it is a directory; if neither is valid, it passes null to `CreateProcessW`. Relative directory values are made relative to the server process current directory. [0.8 source](https://docs.rs/portable-pty/0.8.1/src/portable_pty/cmdbuilder.rs.html)
* The Windows spawn path supplies the effective directory as `CreateProcessW`'s `lpCurrentDirectory`, builds a Unicode environment block, and uses `CREATE_UNICODE_ENVIRONMENT`. This is implementation fact, not an API guarantee to recreate manually; use `CommandBuilder` rather than bypassing it. [source](https://github.com/wez/wezterm/blob/main/pty/src/win/psuedocon.rs)
* `CommandBuilder` starts from the process environment. On Windows portable-pty additionally merges user/system environment values (including PATH) from the registry in its implementation. Avoid `env_clear` unless deliberately reconstructing all launch requirements. [source](https://github.com/wez/wezterm/blob/main/pty/src/cmdbuilder.rs)
* Executable resolution is distinct from shell command resolution. Prefer an absolute path for a deliberately selected executable. For `cmd.exe`, `System32` is the native location; PATH resolution is acceptable only if that is an explicit product decision.

### `cmd.exe`

* Microsoft syntax is `cmd [/c|/k] ...`; `/C` runs the supplied command then exits, `/K` runs it and keeps the command processor running, `/D` disables registry AutoRun commands, and `/S` changes quote stripping rules. [Microsoft cmd reference](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd)
* An interactive PTY shell should use `cmd.exe` without `/C` (or `/K` only when a startup command is intentionally supplied). A one-shot server command may use `cmd.exe /D /C <command>`; `/D` is a defensible determinism/security choice because otherwise machine/user AutoRun entries execute first. This `/D` recommendation is inference from the documented AutoRun behavior.
* Quote command strings carefully: `cmd` treats `&`, `|`, parentheses, redirection, and spaces specially. Do not concatenate untrusted user text into a `/C` command string without a command/argument policy. [cmd reference](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/cmd)

### Rust and Windows process semantics

* `std::process::Command::current_dir` sets the child cwd and does not change the parent. Rust warns that relative executable resolution combined with `current_dir` can be ambiguous; absolute executable paths are preferred. [Command docs](https://doc.rust-lang.org/stable/std/process/struct.Command.html)
* `std::env::current_dir()` reads the server's current directory and may fail. `std::env::home_dir()` returns the user's home directory; current Rust Windows documentation says it uses nonempty `USERPROFILE` first and otherwise Windows profile-directory APIs, and no longer uses `HOME` on Windows since Rust 1.85. [current_dir](https://doc.rust-lang.org/std/env/fn.current_dir.html) · [home_dir](https://doc.rust-lang.org/std/env/fn.home_dir.html)
* Child environments inherit the parent by default; explicit values override. Windows variable names are case-insensitive. If a custom environment is supplied at the Win32 layer, it replaces inheritance and must be a correctly terminated block; Unicode blocks require `CREATE_UNICODE_ENVIRONMENT`. [Rust Command](https://doc.rust-lang.org/stable/std/process/struct.Command.html) · [CreateProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessa)
* Required practical launch inputs are therefore: a valid existing directory, executable (`cmd.exe`), inherited/complete `PATH` and `PATHEXT` when resolving commands, and normal user variables such as `USERPROFILE`, `TEMP`, and `SystemRoot`. `portable-pty` normally supplies the environment; do not hand-build a reduced map.

## Actionable recommendation

1. Keep the existing Unix path unchanged: retain its Unix shell selection and Unix-only arguments/flags under `#[cfg(unix)]`.
2. Under `#[cfg(windows)]`, select cwd in this order: requested path if it is an existing directory; `std::env::home_dir()` if it is an existing directory; `std::env::current_dir()` if it is an existing directory. If all fail, return a clear error rather than handing portable-pty an invalid path. This ordering is a design recommendation; Rust documents the APIs, while the existence checks and error policy are application logic.
3. Build a native Windows `CommandBuilder` with `cmd.exe` (prefer an absolute `System32` path only if the implementation already has a safe Windows path API). Set the resolved cwd. For interactive PTY creation, add no Bash flags and no `/C`; for an explicitly non-interactive command, use `/D`, `/C`, followed by a correctly quoted command string.
4. Do not add Git Bash/WSL discovery as part of this fix. They are separate shells with separate resolution and quoting contracts.
5. Preserve environment inheritance. If the server intentionally overrides variables, retain `PATH`, `PATHEXT`, `SystemRoot`, `USERPROFILE`, and required terminal variables; avoid clearing the environment.

## Testability and cfg guidance

* Add Windows-targeted unit coverage for command construction: omitted cwd resolves to an existing fallback; invalid requested cwd does not reach `cwd`; interactive argv is exactly `cmd.exe` (no Unix flags); one-shot argv includes `/D`, `/C` only in the non-interactive branch.
* Prefer testing a pure “resolve cwd / construct argv” helper, then one Windows smoke test that spawns `cmd.exe` through the existing PTY path and observes `cd`/`%CD%`. Do not assert Windows path syntax in Unix tests.
* Use `#[cfg(windows)]` and `#[cfg(unix)]` around platform-specific imports, shell names, arguments, and expectations. Linux tests must continue exercising the existing Unix shell and must not receive `/C`, `/D`, or Windows cwd fallback logic.

## Linux-preservation implications

The portable-pty API is cross-platform, but cwd fallback and process creation are platform-specific. A Windows-only branch is the lowest-risk change: it prevents Unix shell flags from crossing into `cmd.exe` while leaving Unix shell selection, argument ordering, environment behavior, and cwd semantics untouched. Any shared helper must preserve Unix's existing error behavior and must not unconditionally substitute `USERPROFILE` or `cmd.exe`.

## Unresolved questions

* Does the application require a startup command in interactive mode, or only a prompt? This determines whether no arguments or `/K <command>` is appropriate.
* Does the existing code already expose a trusted Windows `System32`/`cmd.exe` path helper? If not, use the established executable-resolution convention rather than introducing ad-hoc Win32 calls.
* What is the desired behavior when neither the requested cwd nor home/current directory exists: return an HTTP error, or use a product-specific known directory? The research supports returning an explicit error; product policy remains unresolved.
