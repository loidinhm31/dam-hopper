---
title: "SQLite authentication lite mode application E2E journey"
description: "Add containerized Playwright E2E user journey and visual capture evidence for SQLite authentication lite mode without MongoDB."
status: pending
priority: P2
effort: 2h
branch: feat/sqlite-auth
tags: [e2e, playwright, auth, sqlite, testing]
created: 2026-10-07
---

# SQLite Authentication Lite Mode — Application E2E Journey

## Overview
Add a full containerized Playwright application E2E user journey (`packages/ui/e2e/sqlite-auth-lite-mode/`) that exercises `dam-hopper-server` in SQLite authentication lite mode (`DAM_HOPPER_LITE_MODE=true`, `DAM_HOPPER_AUTH_SQLITE_PATH`) with **zero MongoDB container** running, and generates visual capture evidence (`screenshot.png`, `evidence.json`, `review.md`).

Phase status after implementation is tracked in the derived overview [progress.md](./progress.md); completion authority is the phase's immutable receipt under `reports/`.

## Phases
| # | Phase | Status | Progress | Effort | Link |
| --- | --- | --- | --- | --- | --- |
| 01 | SQLite auth lite mode E2E fixture, journey, and capture | Pending | 0% | 2h | [Phase 01](./phase-01-sqlite-auth-e2e-journey.md) |

## Completion Gate
- `server/examples/application_e2e_seed.rs` supports `--sqlite-path` via `AuthStore::open_sqlite` while preserving default MongoDB seeding.
- `packages/ui/e2e/fixtures/application-services.ts` supports `authBackend: "sqlite"` (no MongoDB container launched, seeds `/e2e/home/.config/dam-hopper/auth.db`, starts `dam-hopper-server` with `DAM_HOPPER_LITE_MODE=true`).
- `packages/ui/e2e/sqlite-auth-lite-mode/sqlite-auth-lite-mode.spec.ts` passes against containerized runtime, verifying 401 unauthenticated guard, 200 authenticated status, active SQLite DB file, and full workbench UI rendering.
- Visual capture artifacts (`screenshot.png`, `evidence.json`, `review.md`) are published cleanly under `packages/ui/e2e/sqlite-auth-lite-mode/`.
