---
title: "Windows Terminal Shell Compatibility Fix"
description: "Fix Windows PTY creation for bash-selector requests while preserving Unix terminal behavior exactly."
status: completed-with-release-gates
priority: P1
effort: 6h
branch: feat/windows-terminal-shell
tags: [bugfix, backend, api, windows, pty]
created: 2026-08-30
---

# Windows Terminal Shell Compatibility Fix

## Overview

Server-only fix for `POST /api/terminal` returning 500 on Windows when the request uses `command: "bash"` and omits `cwd`. Keep request/response schema, auth, target sandboxing, environment policy, persistence, and all Unix semantics unchanged.

## Locked Decision

- Windows free-terminal omitted cwd: first existing `dirs::home_dir()`, then existing process current directory; clear server error if neither exists. Never `/tmp`.
- Windows `command == ""` or `"bash"`: interactive `cmd.exe`, no arguments.
- Other Windows command strings: `cmd.exe /C <original command>`.
- One `build_command` path serves initial creation and automatic respawn.
- Windows shell integration: `None`; lifecycle stays unverified. No Git Bash, WSL, PowerShell, `/D`, `/K`, frontend, auth, env-policy, or schema work.

Architecture gate completed in [`docs/system-architecture.md`](../../docs/system-architecture.md): Windows cwd/command behavior, shared create/respawn construction, and Unix-only shell integration are now explicit. No diagram change required.

## Phases

| # | Phase | Owner | Status | Effort | Link |
|---|---|---|---|---:|---|
| 1 | Implement platform boundaries and unit contracts | Server/PTy owner | Complete | 3.5h | [phase-01](./phase-01-implement-windows-pty-contract.md) |
| 2 | Add API regression and prove behavior | Server test owner | Complete — release gates open | 2h | [phase-02](./phase-02-verify-windows-terminal-regression.md) |
| 3 | Finalize public docs and side-effect review | Docs/release owner | Complete — release gates open | 0.5h | [phase-03](./phase-03-document-and-review-platform-contract.md) |

## Conditional Finalization

- Windows terminal implementation is complete: platform cwd fallback, native `cmd.exe` argv selection, shared create/respawn command construction, and Windows shell-integration boundary are locked and implemented.
- Focused Windows evidence is complete: five filtered Windows tests passed (one test each), `cargo fmt --check` and `cargo check --jobs 1` passed, and live Windows dev-mode smoke covered interactive `bash`, one-shot echo, HTTP 200, buffer output, and cleanup 204.
- Release gates remain open. Linux/Unix CI evidence is unavailable; authenticated MongoDB smoke was unavailable because `MONGODB_URI` and `MONGODB_DATABASE` were unset (raw signing secret correctly returned 401); and the Windows full-suite baseline recorded 641/667 passing with 26 unrelated path/CRLF/POSIX fixture failures.
- Conditional approval only: do not represent this plan as green, do not claim Linux, authenticated MongoDB, or full-suite completion, and do not expand the locked scope to remediate unrelated failures.

## Release Gates

| Gate | Status | Required evidence |
|---|---|---|
| Linux focused and full server/CI validation | Open | Unix runner/CI results for focused preservation tests and full suite |
| Authenticated MongoDB smoke | Open | `MONGODB_URI` and `MONGODB_DATABASE` configured, then authenticated smoke result |
| Windows full-suite baseline failures | Open | Diagnose/resolve or formally accept the 26 unrelated path/CRLF/POSIX fixture failures; current baseline is 641/667 passed |

Finalization is conditional until all three release gates are closed. No source or documentation scope changes are authorized by this bookkeeping update.

## Evidence Record

- Focused Windows tests: five correctly filtered tests, each 1 passed — child `PATH` casing, native cmd argv, omitted-cwd bash API create, cmd `/C` API command, Windows shell integration disabled.
- Windows checks: `cargo fmt --check` and `cargo check --jobs 1` passed; four existing warnings remain.
- Windows live smoke: interactive `bash` and one-shot echo passed in dev mode with HTTP 200, expected buffer output, and cleanup 204.
- Unavailable/failed gates remain explicit above; no Linux evidence is inferred from Windows results.

## Context

- [Scout](../reports/scout-260830-1345-windows-terminal-shell.md)
- [Preflight contract](../reports/preflight-260830-1345-windows-terminal-shell.md)
- [External research](../reports/researcher-260830-1345-windows-terminal-shell.md)
- [System architecture](../../docs/system-architecture.md)
- [Code standards](../../docs/code-standards.md)

## Hard Acceptance

1. Authenticated Windows POST with `command: "bash"` and omitted `cwd` returns a live session.
2. Windows `cmd.exe` receives no Bash adapter flags; one-shot commands use `/C`.
3. Initial create and respawn cannot diverge.
4. Unix cwd, executable/argv, shell integration, auth, validation, env, persistence, and errors remain unchanged.
5. Focused unit/API tests, Windows server checks, and actual route smoke are evidenced; Unix/CI regression remains an open release gate.

## Rejected Alternatives

Runtime Bash/Git Bash/WSL discovery, PowerShell policy, `/K`, opportunistic `/D`, env allowlist expansion, frontend fallback, schema changes, and PTY redesign: broader contracts, nondeterministic availability, or unrelated risk.

## Unresolved Questions

- Non-blocking evidence gap: original browser trace does not reveal whether `cwd` was omitted or whether `HOME` was absent. The locked regression reproduces omitted cwd regardless.
- Linux/Unix CI runner availability and results remain required before release closure.
- Authenticated MongoDB smoke remains unrun until required environment variables are supplied.
- The 26 Windows full-suite failures remain an external baseline gate, not part of this locked fix.
- Linux full-suite proof needs a Unix runner/CI; the implementation must not treat Windows-only results as Linux evidence.
