# Testing Architecture and Guidelines

## Overview

Dam-Hopper maintains strict quality gates across both backend and frontend layers:
- **Rust Unit / Integration Tests:** `cargo test` runs unit tests embedded in `server/src/**` and integration tests under `server/tests/**`; integration coverage uses real temporary filesystems and Git repositories rather than synthetic mocks.
- **Frontend Unit / Logic Tests:** Vitest jsdom tests under `packages/ui/src/**/*.test.ts(x)` covering reducers, stores, hooks, and data providers (excluding `e2e/**`).
- **Frontend Browser Regressions:** Vitest Browser Mode tests in Chromium under `packages/ui/browser-tests/**/*.browser.{ts,tsx}` (general suite on port 15173, specialized advisor routing on port 15174).
- **Application E2E Journeys:** Playwright Test suites under `packages/ui/e2e/**/*.spec.ts` executing against real web and backend application instances.
---

## Runner and Workflow Classification

| Layer | Runner | Scope & Discovery | Target / Environment | Command | Workflow Purpose |
|---|---|---|---|---|---|
| **Backend Unit + Integration** | `cargo test` | Unit tests in `server/src/**`; integration tests in `server/tests/**` | Integration coverage: real temp filesystem and Git repos | `pnpm test` (repository root) | Production backend logic, CAS, filesystem, API routes |
| **Frontend Unit** | Vitest | `src/**/*.test.{ts,tsx}`; `vite.config.ts` excludes `e2e/**` and `browser-tests/**` | Node / jsdom | `pnpm --filter @dam-hopper/ui test` | State reducers, hooks, pure helpers, data models |
| **Frontend Browser Component** | Vitest Browser Mode (`vitest.browser.config.ts`) | `browser-tests/**/*.browser.{ts,tsx}` (advisor routing excluded) | Headless Playwright Chromium; port 15173 | `pnpm --filter @dam-hopper/ui test:browser` | Focused component lifecycle, xterm geometry, media tickets |
| **Specialized Component** | Vitest Browser Mode (`vitest.advisor-routing.browser.config.ts`) | `browser-tests/advisor-routing.browser.tsx` | Loopback-backed component mount; headless Chromium, port 15174 | `pnpm --filter @dam-hopper/ui test:browser` | Backend-backed component regression (not app E2E) |
| **Application E2E** | `@playwright/test` | `e2e/**/*.spec.ts` | Chromium, isolated app + backend | `pnpm --filter @dam-hopper/ui test:e2e` | Full application user journeys, layout bounds, auth seed |

**Discovery boundary:** The three existing files matching `e2e/**/*.e2e.tsx` are not selected by the documented UI runners or E2E typecheck: Vitest excludes `e2e/**`, Playwright selects `e2e/**/*.spec.ts`, and `tsconfig.e2e.json` excludes `e2e/**/*.e2e.tsx`.

### Distinguishing Component Regressions from Application E2E
- **Browser Component Regressions:** Fast, headless tests mounting React organisms or testing browser utility adapters (e.g. Monaco/xterm/media tickets). Mocked or loopback-backed component mounts remain component tests and must not be relabeled as application E2E evidence.
- **Application E2E Journeys:** Real browser navigation through the built SPA web application interacting with the real server backend under isolated authentication and storage.

---

## E2E Evidence Standard
### 1. Full Application Viewport Capture
- Screenshots must capture the **full application screen** (the complete viewport containing navigation headers, sidebars, active content, and dialogs/overlays).
- Element-only crops or regional snippets are forbidden as primary E2E evidence because they mask viewport clipping, layout collisions, and z-index defects.

### 2. Plans Folder Separation
- The `plans/` directory is strictly reserved for markdown implementation plans and progress reports.
- Binary screenshot assets (`.png`, `.webp`, `.jpg`) must **never** be placed inside `plans/` or `plans/reports/`. All visual evidence belongs colocated with the test case in `packages/ui/e2e/<case-name>/`.

### 3. CI Quality Gate Workload Optimization
- In CI runners (e.g. GitHub Actions where `CI=true`), optional full-screen screenshot generation is bypassed by default to minimize disk I/O, runner memory, CPU overhead, and build duration.
- All functional interactions, DOM queries, CSSOM validations (`getComputedStyle`), and assertions execute in full during CI runs.
- To force screenshot captures in CI (for visual debugging or artifact inspection), set `E2E_CAPTURE=1`.
- Locally, `shouldCaptureE2E()` enables capture by default so developers and reviewers have fresh visual verification evidence.

---

## Running Tests

```bash
# Run Rust unit and integration tests from the repository root
pnpm test

# Run all UI unit tests
pnpm --filter @dam-hopper/ui test

# Run both Vitest Browser Mode suites sequentially (general, then advisor routing)
pnpm --filter @dam-hopper/ui test:browser

# Run application E2E tests (Playwright)
pnpm --filter @dam-hopper/ui test:e2e

# Typecheck Playwright configuration and included E2E TypeScript files
pnpm --filter @dam-hopper/ui test:e2e:typecheck

# Run the Phase 02 isolated application-service probes (requires Docker or Podman)
pnpm --filter @dam-hopper/ui test:e2e:probes
```

---

## Phase 01 Qualification Summary
- **Vitest Unit Tests:** Disjoint discovery excluding `e2e/**` and `browser-tests/**` (300 files, 2287 tests).
- **Browser Component Suites:** 52 general suites (`vitest.browser.config.ts`) and 1 backend-backed suite (`vitest.advisor-routing.browser.config.ts`), running sequentially via `test:browser`.
- **Playwright E2E:** Dedicated runner (`packages/ui/playwright.config.ts`) targeting `e2e/**/*.spec.ts` under Chromium with strict isolation.
- **Typecheck:** Isolated `tsconfig.e2e.json` typechecking E2E configuration and specs without modifying production compiler options.

## Phase 02: Isolated Application Services

### Containerized runtime and lifecycle
- Application E2E runs the built server and SPA in the test runtime image `dam-hopper:production-test`. The image layers the `application_e2e_seed` executable over the production image; the Playwright fixture builds or refreshes it against the current source fingerprint before startup.
- By default, each service instance receives its own container network, MongoDB container, application container, and unique database name. The default MongoDB image is `docker.io/library/mongo:8.2`; an explicit `databaseName` may override the default. The application port is dynamically mapped to loopback (`127.0.0.1`), and no host MongoDB data directory is mounted.
- A temporary fixture tree supplies the server configuration, workspace, home, and test files under `/e2e` in the application container. Awaited disposal and startup-failure paths clean up owned containers, the network, and the host temporary tree. The fixture registers SIGINT/SIGTERM cleanup handlers, but the probes exercise explicit disposal rather than signal delivery.

### Seed data and safety invariants
- The fixture stages repeatable workspace data (`e2e-workspace`, `fixture-project`, and sample files) while generating per-run secrets. `application_e2e_seed` initializes the isolated database's auth indexes, seeds an enabled `admin` account and valid active session, signs a V2 bearer token, and prints the token and seed metadata as JSON. Session IDs default to UUIDs and session times are generated at runtime; tests depend on the seeded state, not fixed credentials or timestamps.
- Before exposing the services to a test, the fixture waits for `/api/health`, rejects an unauthenticated `GET /api/projects` unless it returns `401`, and requires authenticated auth/advisor status checks to succeed.
- The effective advisor history path must resolve inside the isolated home at `/e2e/home/.evcrate/advisor-history`. The Phase 02 probe poisons the runner's `HOME` and confirms the application still uses its container home, not runner personal state.

`pnpm --filter @dam-hopper/ui test:e2e:probes` runs the focused Playwright service-probe file (`e2e/fixtures/application-services.spec.ts`), covering service lifecycle, failure/disposal cleanup, concurrent-instance isolation, effective-home safety, and orphan-resource checks. It requires an available Docker or Podman engine. These probes do not run the full application journey suite; run `pnpm --filter @dam-hopper/ui test:e2e` for that suite.

