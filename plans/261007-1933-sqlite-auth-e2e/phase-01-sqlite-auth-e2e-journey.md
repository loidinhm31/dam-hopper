# Phase 01 — SQLite Auth Lite Mode E2E Fixture, Journey, and Capture

## Context links
- [Parent Plan](./plan.md)
- [Progress Overview](./progress.md)
- [Testing Guide](../../docs/testing.md)
- [Authentication Architecture](../../docs/architecture/authentication-state-and-cryptography.md)

## Overview
- **Date:** 2026-10-07
- **Priority:** P2
- **Effort:** 2h
- **Implementation:** complete
- **Review:** complete (9.5/10 — `plans/reports/code-review-261007-2018-phase-01-sqlite-auth-e2e-journey.md`)
- **Description:** Extend the application E2E seed runner and service fixture to support SQLite authentication lite mode without starting a MongoDB container, and add a Playwright application E2E user journey with visual capture evidence.

## Key Insights
- `application_e2e_seed.rs` already uses `AuthStore`; adding `--sqlite-path` allows seeding an enabled admin account and active session directly into a file-backed SQLite database via `AuthStore::open_sqlite`, `create_user`, and `create_session`.
- `startApplicationServices()` in `packages/ui/e2e/fixtures/application-services.ts` accepts `ApplicationServicesConfig` from `test.use({ servicesConfig: ... })`. Adding `authBackend?: "mongo" | "sqlite"` lets SQLite E2E tests skip the `mongo:8.2` container entirely.
- `captureApplicationCheckpoint` requires the working tree source fingerprint to match the built container image (`dam-hopper:production-test`) when publishing `evidence.json` and `review.md`.

## Requirements
- Preserve 100% backward compatibility for existing MongoDB-backed E2E journeys.
- When `authBackend: "sqlite"` is selected:
  - Do not start a MongoDB container (`mongoContainerId` is `""`).
  - Seed `/e2e/home/.config/dam-hopper/auth.db` via `application_e2e_seed --sqlite-path`.
  - Launch `dam-hopper-server` with `DAM_HOPPER_LITE_MODE=true`, `DAM_HOPPER_AUTH_SQLITE_PATH=/e2e/home/.config/dam-hopper/auth.db`, and `DAM_HOPPER_MFA_KEY_FILE=/e2e/home/mfa.key` (no `MONGODB_URI`).
- Journey spec `packages/ui/e2e/sqlite-auth-lite-mode/sqlite-auth-lite-mode.spec.ts` must verify:
  - No MongoDB container was started (`appServices.mongoContainerId === ""`).
  - SQLite `auth.db` exists on disk inside the container (`statContainerFile`).
  - Unauthenticated `GET /api/projects` is rejected with `401`.
  - Authenticated `GET /api/auth/status` returns `200` with `authenticated: true`, `user: "admin"`, `role: "admin"`.
  - Connected workbench UI renders project workspace and Settings/Native Advisor admin status, and captures `screenshot.png`, `evidence.json`, and `review.md`.

## Architecture
```
Playwright Test (sqlite-auth-lite-mode.spec.ts)
  └── test.use({ servicesConfig: { authBackend: "sqlite" } })
        └── startApplicationServices({ authBackend: "sqlite" })
              ├── Skips mongo:8.2 container
              ├── Starts dam-hopper:production-test container
              ├── Runs /usr/local/bin/application_e2e_seed --sqlite-path /e2e/home/.config/dam-hopper/auth.db
              └── Starts dam-hopper-server with DAM_HOPPER_LITE_MODE=true
```

## Related code files
- `server/examples/application_e2e_seed.rs`
- `packages/ui/e2e/fixtures/application-services.ts`
- `packages/ui/e2e/sqlite-auth-lite-mode/sqlite-auth-lite-mode.spec.ts`
- `packages/ui/e2e/sqlite-auth-lite-mode/screenshot.png`
- `packages/ui/e2e/sqlite-auth-lite-mode/evidence.json`
- `packages/ui/e2e/sqlite-auth-lite-mode/review.md`

## Implementation Steps
1. Update `server/examples/application_e2e_seed.rs` to accept optional `--sqlite-path` (and `sqlite_path` in `StdinConfig`), branching between `AuthStore::open_sqlite` and `AuthStore::from_mongo`.
2. Update `packages/ui/e2e/fixtures/application-services.ts` to add `authBackend?: "mongo" | "sqlite"` in `ApplicationServicesConfig` and implement the SQLite container startup and seeding branch.
3. Create `packages/ui/e2e/sqlite-auth-lite-mode/sqlite-auth-lite-mode.spec.ts` testing API guards, SQLite file presence, workbench navigation, and visual checkpoint capture.
4. Run `E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e -- e2e/sqlite-auth-lite-mode/sqlite-auth-lite-mode.spec.ts` and verify published evidence artifacts.

## Todo list
- [x] Extend `application_e2e_seed.rs` with `--sqlite-path` support.
- [x] Extend `application-services.ts` with `authBackend: "sqlite"` support.
- [x] Create `sqlite-auth-lite-mode.spec.ts` E2E journey.
- [x] Run E2E journey with capture enabled and verify `screenshot.png`, `evidence.json`, and `review.md`.

## Success Criteria
- `cargo check --example application_e2e_seed` passes with 0 errors.
- `pnpm --filter @dam-hopper/ui test:e2e:typecheck` passes with 0 errors.
- `E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e -- e2e/sqlite-auth-lite-mode/sqlite-auth-lite-mode.spec.ts` passes (1/1) and publishes valid `screenshot.png` (1440x900), `evidence.json`, and `review.md`.

## Risk Assessment
- Container image rebuild takes time if `server-builder` is rebuilt from scratch; `ensureApplicationImagesBuilt` reuses cached Docker/Podman layers for dependencies and only recompiles the changed workspace crate/example.
- Evidence publication checks that the source fingerprint did not change during the test run; all code edits must be settled before running the capture pass.

## Security Considerations
- Seeded credentials and tokens exist only in ephemeral container storage (`/e2e`) and are disposed on test teardown.
- `auth.db` and `mfa.key` inside the container use strict `0600`/`0700` permissions.

## Next steps
- Phase 01 implementation, E2E capture, and code review complete. Ready for human visual review of `packages/ui/e2e/sqlite-auth-lite-mode/review.md` and final commit.
