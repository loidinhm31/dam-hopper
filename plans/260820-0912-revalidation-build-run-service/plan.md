---
title: "Revalidated Linux production runner"
description: "Replace the manual Linux handoff with guarded reset, build, systemd install/start, and quick MongoDB dotenv verification workflows."
status: completed
priority: P2
effort: 8h
branch: feat/systemd-system-service
tags: [infra, backend, database, security]
created: 2026-08-20
---

# Revalidated Linux production runner

## Overview

This plan supersedes `plans/260820-0252-linux-build-run-service/`. Phases 01
and 02 are implemented and have current repository-side evidence. Phase 03
core acceptance is complete: the host was installed, started, exercised,
restarted, authenticated against a protected route, tested with an active PTY,
and rolled back in an authenticated operator session. The report records the
optional external-database check as NOT RUN.

## Decisions

- Systemd is the only supported production owner; retire nohup package aliases.
- Service remains `User=loidinh`, production-auth, same-origin, loopback `4801`.
- Quick purge targets only canonical `~/.config/dam-hopper`; repositories,
  workspace/project `.dam-hopper`, external MongoDB, and unrelated containers
  are excluded.
- Purge requires typed confirmation and authenticated interactive sudo. Failure
  to elevate stops the workflow and asks the operator to authenticate.
- Copy the selected dotenv wholesale after purge/recreate. Load a generated
  safety environment file second to override production/auth/path invariants.
- Full fresh quality/build evidence is required before install. Install and
  start are separate; start validates installed evidence without rebuilding.

## Current host evidence

Historical read-only host evidence found an enabled but inactive unit,
`MainPID=0`, no listener on 4800/4801, no DamHopper process, stale nohup PID/log,
installed root-owned assets, and an unreadable root-owned marker. The 2026-08-21
operator run then authenticated sudo, prepared runtime files, installed and
started the focused systemd build, exercised HTTP/restart behavior, and completed
marker-backed rollback; the bounded results are in the acceptance report.

## Phases

| # | Phase | Status | Effort | Progress |
|---|---|---|---:|---:|
| 01 | [Guarded reset and runtime recreation](./phase-01-guarded-reset-and-runtime-recreation.md) | Completed | 2.5h | 100% |
| 02 | [Build, stage, install, and start runner](./phase-02-build-stage-install-and-start-runner.md) | Completed | 3.5h | 100% |
| 03 | [Live acceptance, rollback, and handoff](./phase-03-live-acceptance-rollback-and-handoff.md) | Completed | 2h | 100% |

## Current repository evidence

- PASS — Bash syntax, JSON parsing, whitespace checks, unit verification, and
  the Phase 01/02 fixture harness.
- PASS — focused lint, UI tests (173 files and 1,109 tests), UI type checking,
  backend tests, release server build, and same-origin production web build.
- PASS — the real unprivileged production runner build retained a restrictive
  staging directory and completed its artifact, manifest, and isolated unit
  verification gates.
- CAVEAT — native desktop packaging is outside the systemd service build gate;
  the production runner now executes only the focused server/web/systemd gates.
- PASS — the live operator run installed without starting, started as `loidinh`
  on loopback `127.0.0.1:4801`, passed public/protected HTTP boundary and SPA
  checks, passed restart with a new PID, and completed marker-backed rollback.
- PASS — authenticated `GET /api/projects` returned `200` while the
  unauthenticated request returned `401`; an active disposable PTY was created,
  then SIGTERM left no listener, server process, or PTY child; bounded journald
  checks found both shutdown messages and no credential-bearing content.
- PASS — the runner now records a verified staging path privately after build;
  fixture coverage proves `install` can consume it without manual path copying
  and fails closed for missing or ambiguous records.
- NOT RUN — optional external MongoDB smoke.

## Dependencies

- Node 20+, pnpm 9+, Rust/Cargo, systemd tooling, Bash, authenticated sudo.
- Operator-selected dotenv source outside the purge tree.
- External MongoDB only if the optional live Mongo smoke is requested.
- Root marker/manifest must validate before installed assets are changed.

## Research

- [Repository and plan audit](./research/researcher-01-repository-and-plan-audit.md)
- [Reset/environment security review](./research/researcher-02-reset-env-security-review.md)
- [Planner synthesis](./planner-draft.md)

## Unresolved questions

- Whether MongoDB is mandatory for this quick check; no external probe was run.
- Rollback clears the private automatic-stage record; retained stage directories
  remain temporary artifacts usable only through an explicit path until normal
  temporary-directory cleanup.
