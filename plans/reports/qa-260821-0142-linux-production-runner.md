---
title: "Linux production runner acceptance"
date: 2026-08-21
status: bounded-pass
scope: systemd-service
review: APPROVE 9.5/10
---

# Linux production runner acceptance

## Outcome

Core repository and administrator acceptance passed. The focused systemd
runner built and staged the server/web/unit artifacts, installed them without
starting, started the service as `loidinh` on loopback `127.0.0.1:4801`, passed
protected-route, active-PTY/SIGTERM, HTTP, restart, and journald checks, and
completed marker-backed rollback. The final host state is intentionally rolled
back; no DamHopper systemd unit or installed assets remain.

No dotenv values, tokens, database URIs, response bodies, or journal bodies
were exported.

## Repository gates

- PASS — `bash -n` for the reset, runner, and fixture scripts.
- PASS — `git diff --check`.
- PASS — Phase 01/02 fixture harness, including runtime-only preservation,
  listener-inspection fail-closed behavior, staged install/no-start behavior,
  legacy marker-backed rollback, and bounded listener readiness.
- PASS — focused lint, UI tests (173 files, 1,109 tests), UI type checking,
  backend tests, release server build, same-origin production web build, and
  isolated systemd unit verification.
- PASS — successful unprivileged production build/stage with restrictive
  staging and manifest/hash/file-inventory verification.
- PASS — staged-tree credential scanning is byte-safe and rejects credential
  patterns in binary artifacts as well as text files.
- PASS — build records the verified staging path in a private mode-600 runtime
  record; fixture coverage proves automatic install and fail-closed missing or
  ambiguous/empty/symlinked/over-permissioned record handling. Explicit
  `--staging PATH` remains supported.
- PASS — rollback clears the private automatic-stage record; retained temporary
  stage directories are not eligible for automatic reinstall.
- PASS — `scripts/phase-03-journal-check.sh` is executable, reads bounded
  journal data privately, prints only flags, and exits nonzero on any failed or
  unavailable required check.
- CAVEAT — `shellcheck` was not installed; Bash syntax validation passed.
- CAVEAT — native desktop packaging is outside the systemd service gate. The
  successful production runner build did not invoke a native/Tauri build or
  signing step; native/Tauri build is explicitly not run.

## Runtime preparation

- PASS — the selected dotenv source was copied to a private user-owned mode-600
  path without displaying its contents.
- PASS — runtime-only reset dry run made no changes.
- PASS — runtime-only preparation preserved existing runtime/config files and
  created the ordered environment files with user ownership and mode `600`.
- PASS — the server environment copy matched the private source without
  printing either file.

## Installed-service acceptance

| Check | Result |
|---|---|
| Installed marker/assets | PASS; `installed=valid` |
| Enablement/load | PASS; enabled and loaded |
| Start state | PASS; active/running |
| Process identity | PASS; `User=loidinh`, UID/GID `1000`, exact installed executable |
| Binding | PASS; only `127.0.0.1:4801`, no 4800 listener |
| Installed ownership/modes | PASS; root-owned deployment assets and private user runtime metadata matched |
| Public health | PASS; `GET /api/health` returned `200` JSON |
| Authentication boundary | PASS; unauthenticated `GET /api/usage/health` returned `401` |
| Authenticated protected route | PASS; signed `GET /api/projects` returned `200` without displaying the JWT |
| Same-origin SPA | PASS; `/` returned `200` HTML |
| Restart | PASS; new PID `1468734`, active state, and loopback listener restored |
| Active PTY/SIGTERM | PASS; disposable PTY created, then no listener, server process, or `sleep 300` child remained |
| Journald lifecycle/redaction | PASS; both shutdown messages found and private secret scan passed |

The unit exposed the expected direct executable, mandatory ordered environment
file paths, `StandardInput=null`, journald output, production environment, and
non-root service identity. Environment values were not inspected or recorded.

## Rollback acceptance

- PASS — `rollback --dry-run` left marker-backed assets and runtime unchanged.
- PASS — confirmed rollback stopped/disabled the unit and removed only the
  marker-backed deployment assets.
- PASS — `/opt/dam-hopper` and the unit file were absent afterward.
- PASS — systemd reported the service inactive and the unit not found.
- PASS — ports 4800 and 4801 were free afterward.
- PASS — runtime directory remained `loidinh:loidinh:700`; TOML and both
  environment files remained `loidinh:loidinh:600`.
- PASS — the private source and runtime server environment still compared
  equal without displaying their contents.

## Explicitly not run

- NOT RUN — optional external MongoDB smoke; no external collection was
  queried or changed.
- NOT RUN — native/Tauri build; outside the systemd-service acceptance gate.

## Handoff

The implementation and requested acceptance evidence are complete for the
guarded systemd workflow. Only the optional external MongoDB smoke remains
outside this run. Final Phase 03 code review status: **APPROVE 9.5/10**. The
host is left rolled back with user runtime state preserved.

## Unresolved questions

- Is the optional external MongoDB smoke required for the release gate?
