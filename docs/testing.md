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
```
