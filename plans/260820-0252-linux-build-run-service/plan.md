---
title: "Linux production build/run script and clean reset"
description: "Add a guarded Linux build/install/start workflow with optional MongoDB dotenv input and a reversible reset of the current deployment."
status: superseded
priority: P2
effort: 6-8h
branch: feat/systemd-system-service
tags: [infra, systemd, linux, mongodb, security]
created: 2026-08-20
updated: 2026-08-20
---

# Linux production build/run script and clean reset

This plan is a historical predecessor superseded by
`plans/260820-0912-revalidation-build-run-service/`, which records the delivered
runner, live acceptance, and rollback evidence.

## Objective

Give the operator a repeatable Linux path that builds the web and Rust release
artifacts, installs the existing non-root systemd service, copies a selected
dotenv file for MongoDB, and starts a same-origin service on `127.0.0.1:4801`.
The first operation is a guarded cleanup of the currently installed
systemd/nohup deployment. This quick-verification run explicitly purges local
DamHopper state after sudo and confirmation; project repositories and external
MongoDB data remain outside the purge.

## Decision

Use two explicit scripts: `deploy/reset-linux-production.sh` for ownership-checked
stop/disable/quarantine, and `deploy/run-linux-production.sh` for build, staged
install, environment preparation, and systemd start. Keep systemd as the one
production owner; retain nohup only as a documented legacy fallback. Do not add
Docker/MongoDB provisioning or a root-running server.

## Acceptance criteria

- Reset refuses ambiguous PIDs, listeners, symlinks, changed manifests, and shared
  SQLite ownership; local state is deleted only by an explicit confirmed purge.
- Build/run produces an executable server and complete same-origin web assets,
  uses `User=loidinh`, `RUST_ENV=production`, loopback `4801`, journald, graceful
  SIGTERM, and existing restart/security invariants.
- A selected dotenv file is copied only to a mode-0600 user runtime file outside
  `/opt`; its contents never appear in unit text, artifacts, logs, reports, or
  command output. This broad import is for quick verification, not release.
- Build, test, lint, shell syntax/negative-path checks, unit verification, and
  redacted administrator acceptance evidence are documented.

## Phases

1. [Clean reset and ownership gate](./phase-01-clean-reset-and-ownership-gate.md)
2. [Build, stage, and systemd run workflow](./phase-02-build-stage-and-systemd-run-workflow.md)
3. [MongoDB dotenv contract and secret validation](./phase-03-mongodb-dotenv-contract-and-secret-validation.md)
4. [End-to-end validation and operator documentation](./phase-04-end-to-end-validation-and-operator-documentation.md)

## Dependencies and non-goals

Requires Node/pnpm, Rust/Cargo, systemd tooling, and authenticated sudo for
installation. MongoDB remains an optional external dependency; Docker is not
managed by this workflow. The confirmed local purge removes DamHopper config,
credentials, databases, and agent-store state, but never project repositories or
external MongoDB collections. Do not change the existing 4801 production-auth
contract for the quick verification workflow.

## Research

- [Runtime and MongoDB research](../reports/researcher-260820-0252-runtime-env-mongodb.md)
- [Deployment and reset research](../reports/researcher-260820-0252-linux-deployment-reset.md)
- [Planner synthesis](./planner-draft.md)
