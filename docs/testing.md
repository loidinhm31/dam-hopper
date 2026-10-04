# Testing Architecture and Guidelines

## 1. Overview & Architectural Boundaries

Dam-Hopper maintains strict quality gates across backend, shared libraries, and frontend applications. The test suite is organized into distinct, non-overlapping runners with clear execution boundaries:

1. **Rust Backend Tests (`cargo test`):**
   - Unit tests embedded in `server/src/**` and integration tests under `server/tests/**`.
   - Uses real temporary filesystems (`tempfile`) and Git repositories; avoids synthetic mocks for filesystem, Git CAS, and SQLite persistence.
   - Run from repository root via `pnpm test` or in `server/` via `cargo test`.
2. **Frontend Unit & Logic Tests (Vitest):**
   - Headless jsdom tests under `packages/ui/src/**/*.test.ts(x)` covering reducers, stores, hooks, and data utilities.
   - Strictly disjoint discovery: `packages/ui/vite.config.ts` explicitly excludes `e2e/**` and `browser-tests/**`.
   - Run via `pnpm --filter @dam-hopper/ui test`.
3. **Frontend Browser Component Regressions (Vitest Browser Mode):**
   - Headless Playwright Chromium tests under `packages/ui/browser-tests/**/*.browser.{ts,tsx}`.
   - Two specialized runners: general component suites on port 15173 (`vitest.browser.config.ts`) and loopback Axum-backed advisor routing on port 15174 (`vitest.advisor-routing.browser.config.ts`).
   - Validates focused component rendering, xterm.js buffer replay, keyboard shortcuts, context menus, and media ticket fixtures.
   - Run via `pnpm --filter @dam-hopper/ui test:browser`.
4. **Application E2E User Journeys (Playwright Test):**
   - Real end-to-end browser journeys under `packages/ui/e2e/**/*.spec.ts` using `@playwright/test` 1.61.1.
   - Interacts with built SPA web application (`apps/web`) and production server (`dam-hopper-server`) inside isolated Docker/Podman containers with real MongoDB instances.
   - Run via `pnpm --filter @dam-hopper/ui test:e2e`.

---

## 2. Runner Classification and Discovery Matrix

| Layer | Runner | Scope & Discovery Pattern | Target / Environment | Command | Workflow Purpose |
|---|---|---|---|---|---|
| **Backend Unit + Integration** | `cargo test` | Unit: `server/src/**`<br>Integration: `server/tests/**` | Native binary, temp filesystems, real Git repos | `pnpm test` | Production server logic, CAS, PTY, Git operations, API routes |
| **Frontend Unit** | Vitest (jsdom) | `packages/ui/src/**/*.test.{ts,tsx}` | Node.js / jsdom | `pnpm --filter @dam-hopper/ui test` | State reducers, hooks, pure helpers, data models |
| **Browser Component Regressions** | Vitest Browser Mode | `packages/ui/browser-tests/**/*.browser.{ts,tsx}` (excl. advisor routing) | Headless Chromium, port 15173 | `pnpm --filter @dam-hopper/ui test:browser` | Focused component lifecycle, xterm geometry, media tickets |
| **Specialized Component** | Vitest Browser Mode | `packages/ui/browser-tests/advisor-routing.browser.tsx` | Headless Chromium, port 15174, loopback Axum | `pnpm --filter @dam-hopper/ui test:browser` | Backend-backed component regression (not application E2E) |
| **Application E2E Journeys** | `@playwright/test` | `packages/ui/e2e/**/*.spec.ts` | Headless Chromium, containerized web SPA + production server + MongoDB | `pnpm --filter @dam-hopper/ui test:e2e` | Full application user journeys, layout bounds, auth seed |
| **E2E Service Probes** | `@playwright/test` | `packages/ui/e2e/fixtures/application-services.spec.ts` | Docker / Podman container runtime | `pnpm --filter @dam-hopper/ui test:e2e:probes` | Container lifecycle, health checks, isolation, cleanup |

### Discovery Invariants
- **`.spec.ts` Convention:** All application E2E tests MUST use the `.spec.ts` extension under `packages/ui/e2e/`.
- **`.browser.tsx` Convention:** All Vitest browser component tests MUST use the `.browser.tsx` or `.browser.ts` extension under `packages/ui/browser-tests/`.
- **Exclusion of legacy `.e2e.tsx`:** Old `.e2e.tsx` pseudo-harnesses are completely retired and excluded from all runners.
- **Typecheck Isolation:** `packages/ui/tsconfig.e2e.json` typechecks E2E specs and fixtures without altering production compiler options (`pnpm --filter @dam-hopper/ui test:e2e:typecheck`).

---

## 3. Running Tests

```bash
# Run all backend unit and integration tests
pnpm test

# Run UI package unit tests (Vitest jsdom)
pnpm --filter @dam-hopper/ui test

# Run UI browser component tests sequentially (ports 15173 and 15174)
pnpm --filter @dam-hopper/ui test:browser

# Run all application E2E user journeys (Playwright)
pnpm --filter @dam-hopper/ui test:e2e

# Run application E2E with explicit visual evidence capture enabled
E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e

# Run application E2E with captures explicitly disabled (CI parity)
CI=true E2E_CAPTURE=0 pnpm --filter @dam-hopper/ui test:e2e

# Run containerized service lifecycle probes (requires Docker or Podman)
pnpm --filter @dam-hopper/ui test:e2e:probes

# Typecheck Playwright configuration, fixtures, and E2E test specs
pnpm --filter @dam-hopper/ui test:e2e:typecheck

# Run aggregate local test suite (runs all enabled unit, browser, and E2E suites)
./scripts/run-all-tests.sh
```

---

## 4. Isolated Application Services (Phase 02 Architecture)

Application E2E tests interact with authentic production binaries rather than synthetic mock servers or `--no-auth` dev modes:

### Containerized Runtime & Lifecycle
- **Test Runtime Image (`dam-hopper:production-test`):**
  - Multi-stage image layered on the production `dam-hopper:production` base image via `packages/ui/e2e/fixtures/application-runtime.Dockerfile`.
  - Layers the canonical preauthenticated seed executable (`application_e2e_seed`) compiled in the `server-builder` stage.
  - Image freshness is managed automatically by `packages/ui/e2e/fixtures/image-builder.ts` using source fingerprinting (`dam-hopper.source-fingerprint` label).
- **Service Isolation:**
  - Each test suite instance receives a private container network (`bridge`), a dedicated MongoDB container (`mongo:8.2`), and an application container running `dam-hopper-server`.
  - Loopback port allocation is dynamic; no host database ports are shared or bound.
  - Test files, configurations, and effective home directories are mounted inside a transient `/e2e` container tree.
- **Effective HOME & Environment Protection:**
  - The application container enforces `HOME=/e2e/home` and controlled container `/etc`, ensuring server-side Advisor history resolves to `/e2e/home/.evcrate/advisor-history`.
  - Runner workstation `$HOME` and user personal settings are never mounted, protecting against host configuration leakage or poisoning.

### Deterministic Auth Seeding
- The `application_e2e_seed` binary initializes MongoDB auth collections, creates an enabled `admin` user, creates an active session, and signs V2 token claims using the fixture server token.
- Playwright browser contexts are pre-seeded via `storageState` with production `localStorage` keys:
  - `damhopper_server_profiles`: Array containing the fixture profile.
  - `damhopper_active_profile_id`: ID of the fixture profile.
  - `damhopper_profile_auth_v2_<id>`: Valid signed V2 token and user claim.
- **Scope Limitation:** Preauthenticated session bootstrap is a test prerequisite; it does not substitute for dedicated login/MFA feature qualification.

### Cleanup Guarantees (L01–L06 Acceptance)
- Containers, private networks, and temporary directories are registered with ownership tracking upon creation.
- Disposal occurs in `finally` blocks upon test completion, assertion failure, test timeout, or partial startup failure.
- Container teardown confirms zero orphaned test containers or networks remain after test execution.

---

## 5. Application E2E Journeys (Phase 03 Implementation)

Three comprehensive application journeys validate end-to-end user workflows:

1. **Privacy Mode Heavy Blur (`packages/ui/e2e/privacy-heavy-blur/privacy-heavy-blur.spec.ts` — A04):**
   - Navigates through actual `apps/web` entry, switches to `/settings`, configures Heavy Blur.
   - Returns to `/workspace`, activates Cognito mode via `Control+Alt+KeyB`.
   - Validates complete viewport coverage, backdrop blur styles (`blur(20px) saturate(140%)`), and accessibility attributes (`aria-hidden="true"`, `inert`).
   - Verifies input isolation: clicks, typing chords, and terminal inputs do not leak into live editors or terminals.
   - Tests dismissal and reload retention.
2. **Advisor Model Dropdown & Theme (`packages/ui/e2e/advisor-model-dropdown-theme/advisor-model-dropdown-theme.spec.ts` — A05):**
   - Enables Advisor in `/settings`, opens ActivityBar Advisor routing editor in dark theme.
   - Modifies routing rules, validates duplicate route rejection, and saves changes.
   - Verifies persistence directly against backend REST API and on-disk policy file (`readPolicyFile()`).
   - Verifies reload persistence without optimistic UI mocks.
3. **Counsel Evaluations Responsive Narrow Dock (`packages/ui/e2e/counsel-evaluations-responsive/counsel-evaluations-responsive.spec.ts` — A06):**
   - Seeds on-disk native evaluation documents (`eval-group-a`, `eval-group-b`).
   - Discovers evaluations in Advisor Evaluations view, tests inspection and side-by-side comparison.
   - Drags the native dock divider to narrow legal width (320px).
   - Validates horizontal bounding box containment, lack of horizontal clipping, and vertical scrollability.

---

## 6. Visual Evidence Authenticity & Governance (Phase 04 Standard)

### Full Application Viewport Capture
- Screenshots must capture the **complete viewport** (1440x900 default, 320px narrow dock checkpoint).
- Regional snippets, element-only crops, and synthetic HTML captures are forbidden because they conceal layout clipping, z-index bugs, and viewport overflow.

### Colocated Artifacts & Plans Separation
- All evidence artifacts are colocated beside the test in `packages/ui/e2e/<case-name>/`:
  - `screenshot.png` (and secondary checkpoints like `unmasked-before.png`).
  - `evidence.json`: Machine-readable metadata (Git HEAD, working tree fingerprint, seed digest, viewport dimensions, image SHA-256 digests).
  - `review.md`: Human review governance record.
- **Plans Folder Separation:** Binary image files (`.png`, `.webp`, `.jpg`) must **never** be placed inside `plans/` or `plans/reports/`. The `plans/` directory is strictly reserved for Markdown documents.

### Unified Node-Side Capture Policy (`capture-policy.ts`)
- Capture behavior is governed by `shouldCaptureE2E(env)` across Playwright and Vitest browser runners:
  - `E2E_CAPTURE=1` or `true`: Explicitly enabled.
  - `E2E_CAPTURE=0` or `false`: Explicitly disabled.
  - Unset: Enabled by default locally; disabled by default in CI (`CI=true`).
  - Invalid non-empty values throw actionable errors.
- Vitest browser configs set `screenshotFailures: shouldCaptureE2E()`, eliminating uncontrolled failure image dumps during headless CI runs.

### Staging, Validation & Atomic Publication
- **Staging Directory:** Screenshots are initially staged in `.gitignore`-backed `packages/ui/.e2e-staging/<runId>/`.
- **Buffer & IHDR Validation:** Before staging, `packages/ui/e2e/fixtures/capture-png-validator.ts` verifies:
  - 8-byte PNG magic header (`89 50 4E 47 0D 0A 1A 0A`).
  - Big-endian IHDR chunk width and height matching declared viewport dimensions.
- **Target Path Containment:** Case directories and checkpoint names are strictly confined to `packages/ui/e2e/<case>/`; path traversal (`..` or path separators) throws immediate errors.
- **Provenance & Source Freshness:** Computes working tree source fingerprint (Git HEAD + working tree status) at run initiation. Before publication, the fingerprint is recomputed; any mid-run source modification wipes staging and throws a freshness violation error to prevent stale evidence publication.
- **Atomic Publication:** Evidence files (`screenshot.png`, `evidence.json`, `review.md`) are published atomically only after all functional assertions and container teardowns pass. On assertion failure, timeouts, or capture-disabled runs, staging directories are cleaned up immediately.

### Human Visual Review Governance & Limitations
- **Pending Review Reset:** Automated test runs initialize or reset `review.md` to `PENDING_HUMAN_REVIEW` status.
- **Mandatory Operator Inspection:** Visual acceptance requires an actual human operator to inspect the captured images and record:
  - Reviewer identity and timestamp.
  - Matching Git source fingerprint, run ID, and image SHA-256 digests.
  - Explicit `ACCEPTED` or `REJECTED` decision with notes on visual qualities (frosting, alignment, contrast).
- **Inviolable Governance:** Green CI runs and test automation cannot synthesize or bypass human visual review.
- **Pending Review Limitations:** Automated CI passes certify functional DOM/CSSOM assertions only; they do not certify visual acceptance. Features with pending or rejected reviews must not be shipped as visually qualified.
---

## 7. CI Quality Gate Integration (Phase 05 Architecture)

### GitHub Actions Workflow (`.github/workflows/pr-quality-gate.yml`)
- The `application_e2e` job executes as a required check in the PR quality gate:
  - Runs on `ubuntu-22.04` with pre-installed Docker and Node 24.
  - Installs dependencies with `pnpm install --frozen-lockfile`.
  - Installs Playwright Chromium with system dependencies.
  - Prefetches `docker.io/library/mongo:8.2`.
  - Runs `pnpm --filter @dam-hopper/ui test:e2e:typecheck`.
  - Prebuilds runtime images via `pnpm --filter @dam-hopper/ui test:e2e:build-images`.
  - Executes E2E tests with `CI=true E2E_CAPTURE=0 pnpm --filter @dam-hopper/ui test:e2e`.
  - On failure, uploads sanitized reports (`playwright-report`, `test-results`) with 7-day retention.
- Wired into `quality_gate.needs` and aggregate result validation; failure or cancellation fails the PR gate.

### Aggregate Shell Script (`scripts/run-all-tests.sh`)
- Repository test runner sets `CI=1` and manages detached process groups with signal escalation (`SIGTERM` -> `SIGKILL`).
- Sequences all suites:
  1. Rust server tests (`pnpm test`)
  2. Shared package tests (`pnpm --filter @dam-hopper/shared test`)
  3. Browser bridge tests (`pnpm --filter @dam-hopper/browser-bridge test`)
  4. UI unit tests (`pnpm --filter @dam-hopper/ui test`)
  5. Native host tests (`pnpm --filter @dam-hopper/native test`)
  6. UI browser tests (`pnpm --filter @dam-hopper/ui test:browser`)
  7. **Application E2E tests (`pnpm --filter @dam-hopper/ui test:e2e`)**
- Under `CI=1`, captures remain disabled by default, executing pure functional assertions without disk or image bloat.

### Capture-Disabled Parity Guarantee (C01–C05 Acceptance)
- In capture-disabled mode (`CI=true` or `E2E_CAPTURE=0`), all test interactions and DOM/CSSOM assertions execute identically.
- Zero image files, video files, or trace files are created.
- Existing case evidence files (`screenshot.png`, `evidence.json`, `review.md`) remain byte-and-mtime untouched.

---

## 8. Workflow Coverage Matrix & Ranked Gaps

### Current Coverage Classification

| Category | Suite Count | Declared Tests | Test Type | Status |
|---|---|---|---|---|
| UI Unit Tests | ~302 files | 2,305 tests | Vitest jsdom | Active / Required |
| Browser Component Regressions | 52 suites | 254 tests | Vitest Browser Mode (Chromium, 15173) | Active / Required |
| Specialized Backend Component | 1 suite | 5 tests | Vitest Browser Mode (Chromium, 15174) | Active / Required |
| Application E2E Journeys | 3 suites | 3 tests | Playwright Test (Isolated App + DB) | Active / Required |
| E2E Fixture Lifecycle Probes | 1 suite | 7 tests | Playwright Test (Container Lifecycle) | Active / Required |

### Ranked Integrated Workflow Gaps

The three application journeys establish the foundational runner, container lifecycle, and evidence pipeline. The complete source inventory of all 53 browser component suites and historical harnesses is cataloged in [`plans/261004-1639-frontend-test-restructure/research/browser-coverage-inventory.md`](../plans/261004-1639-frontend-test-restructure/research/browser-coverage-inventory.md).

The following workflows represent documented gaps in full-application E2E coverage. While component, utility, or manual qualifications exist, they are not application-level Playwright tests:

| Priority | Workflow Area | Existing Targeted Coverage | Missing Application E2E Acceptance |
|---|---|---|---|
| **P1** | **Docked, Split & Mobile Layouts** | Component tests for traditional splits, floating tools, mobile accessory bar, zoom | Multi-pane drag resizing, combined editor + terminal + Advisor bounding boxes, orientation shifts. |
| **P1** | **Multi-Profile & Project Switching** | Store unit tests, target selector component tests, backend qualification scripts | Switching active server profiles and worktrees while terminal sessions and editors are active without state crossover. |
| **P1** | **Persistent Settings & Full Policy** | Settings usage insights component, loopback advisor routing test | End-to-end user configuration of all Settings tabs; full policy editing; login/MFA UI flow qualification. Distinguishes authentic backend REST/disk policy persistence from component-isolated `localStorage` mocks. |
| **P1** | **Terminal & Workflow Continuity** | xterm fit adapter, replay notifications, workflow context tests | Live PTY reconnection, PTY output stream continuity across route transitions, bell notification click navigation. |
| **P2** | **File Editing & Git Mutations** | Monaco editor wrappers, Git dialog component tests, backend Git tests | In-app file creation, dirty tab preservation, Git commit/squash/push with real conflict dialog resolution. |
| **P2** | **Media Sessions & Token Revocation** | Explorer image/video ticket fixtures, native ticket issuance | Media ticket expiration, cookie-based token rotation, client-initiated logout and revocation. |
| **P2** | **Native Desktop Host & WebView2** | Tauri Rust tests, SSH-forward E2E, native smoke scripts | Visual qualification of Tauri window decorations, native menu interactions, and platform-specific dialogs. |

*Note: Historical manual qualifications and targeted component mounts must not be conflated with automated full-application Playwright journeys.*
