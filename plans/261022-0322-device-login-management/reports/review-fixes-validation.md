# Validation Report: Joined Review Fixes for Device Login Management

- **Phase**: Validation (`phase-03-validation` review fixes join)
- **Plan**: `plans/261022-0322-device-login-management`
- **File**: `plans/261022-0322-device-login-management/reports/review-fixes-validation.md`
- **Date**: 2026-10-22
- **Branch**: `feat/device-login-management`
- **Status**: **CONDITIONAL PASS — E2E & Backend Qualified; 1 UI Unit Test Failing; Human Visual Review Pending**

---

## 1. Executive Summary & Test Results Overview

Validation executed across backend, frontend unit/integration, browser runner, container image rebuild, capture gate, full application E2E suite, and an actual-browser cookie boundary regression.

| Suite / Check | Command | Status | Pass | Fail | Skip / Ignore | Time |
|---|---|---|---|---|---|---|
| **Backend: Device Sessions** | `cargo test --manifest-path server/Cargo.toml --test auth_device_sessions` | **PASS** | 5 | 0 | 0 | 1.78s (31.10s wall) |
| **Backend: Session Failures** | `cargo test --manifest-path server/Cargo.toml --test auth_device_session_failures` | **PASS** | 1 | 0 | 0 | 0.87s (3.08s wall) |
| **Backend: No-Auth Mode (Entire)** | `cargo test --manifest-path server/Cargo.toml --test auth_no_auth` | **PASS** | 14 | 0 | 0 | 2.83s (4.77s wall) |
| **Backend: Media Exact Cleanup** | `cargo test --manifest-path server/Cargo.toml --lib auth_context_binding_clamping_and_revocation` | **PASS** | 1 | 0 | 1465 | 0.00s (30.75s wall) |
| **Backend: Store Regressions** | `cargo test --manifest-path server/Cargo.toml --test auth_device_session_store` | **PASS** | 2 | 0 | 0 | 0.02s |
| **Backend: Session Metadata** | `cargo test --manifest-path server/Cargo.toml --test auth_session_metadata` | **PASS** | 1 | 0 | 0 | 4.54s |
| **Backend: SQLite Store Migration** | `cargo test --manifest-path server/Cargo.toml --test auth_sqlite_store` | **PASS** | 20 | 0 | 0 | 0.05s |
| **UI Unit & Integration Suite** | `pnpm --filter @dam-hopper/ui test` | **FAIL (1 file)** | 338 files (~3170 tests) | 1 file (1 test) | 0 | 26.25s (26.98s wall) |
| *— Connections Integration* | `pnpm --filter @dam-hopper/ui exec vitest run src/components/organisms/login-devices-connections.test.tsx` | **PASS** | 15 | 0 | 0 | 1.52s (2.03s wall) |
| *— Server Settings Dialog* | `pnpm --filter @dam-hopper/ui exec vitest run src/components/organisms/ServerSettingsDialog.test.tsx` | **PASS** | 9 | 0 | 0 | 1.16s (1.65s wall) |
| *— Auth Client DTO & API* | `pnpm --filter @dam-hopper/ui exec vitest run src/api/auth-client.test.ts` | **PASS** | 32 | 0 | 0 | 0.17s |
| **UI Focused Browser Test** | `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts login-devices.browser.tsx` | **PASS** | 2 | 0 | 0 | 2.30s (2.91s wall) |
| **UI TypeScript Build** | `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`) | **PASS** | 0 errors | 0 | 0 | 8.52s |
| **Full Web Application Build** | `pnpm build` | **PASS** | 0 errors | 0 | 0 | 33.21s |
| **Linter** | `pnpm lint` | **PASS** | 0 errors, 170 warnings (pre-existing) | 0 | 0 | 23.38s |
| **E2E Typecheck** | `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | **PASS** | 0 errors | 0 | 0 | 1.51s |
| **Production-Test Image Rebuild** | `CONTAINER_ENGINE=docker node --experimental-strip-types packages/ui/e2e/fixtures/image-builder.ts` | **PASS** | Image built | 0 | 0 | 401.19s |
| **Targeted Device E2E (Capture)** | `CONTAINER_ENGINE=docker E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e device-login-management/device-login-management.spec.ts` | **PASS** | 1 | 0 | 0 | 8.0s (8.54s wall) |
| **Full Application E2E Suite** | `CONTAINER_ENGINE=docker CI=true E2E_CAPTURE=0 pnpm --filter @dam-hopper/ui test:e2e` | **PASS** | 11 | 0 | 0 | 114.84s (1.9m) |
| **Throwaway Browser Cookie Boundary** | `CONTAINER_ENGINE=docker E2E_SKIP_BUILD=1 pnpm --filter @dam-hopper/ui exec playwright test e2e/cookie-boundary-regression.spec.ts` | **PASS** | 1 | 0 | 0 | 5.9s (6.45s wall) |

---

## 2. Failed Tests: Detailed Analysis

### 2.1 UI Unit Test Failure: `LoginDevicesSection.test.tsx`
- **File**: `packages/ui/src/components/organisms/LoginDevicesSection.test.tsx:120:69`
- **Test**: `saved-profile login devices > warns and clears only the captured current login, never ambient username or another same-server profile`
- **Error Output**:
  ```text
  AssertionError: expected null to be 'token-b' // Object.is equality
  - Expected: "token-b"
  + Received: null
    at src/components/organisms/LoginDevicesSection.test.tsx:120:69
  ```
- **Root Cause Analysis**:
  * In `beforeEach` (`line 40`), profile `b` was initialized with URL `https://ambient.test`, and `setAuthToken("token-b", "b")` bound the token to `https://ambient.test`.
  * In the test at `line 113`, `saveProfiles([a, { ...b, url: a.url }])` mutated profile `b`'s saved URL in `localStorage` to match `a.url` (`https://selected.test`) without updating `b`'s token binding.
  * In `packages/ui/src/api/server-config.ts:294-302`, `getAuthToken("b")` enforces endpoint-binding integrity:
    ```typescript
    if (currentProfile && parsed.serverUrl && (normalizeServerUrl(currentProfile.url) !== normalizeServerUrl(parsed.serverUrl) || currentProfile.authType !== parsed.authType)) {
      return null;
    }
    ```
  * Because `currentProfile.url` (`https://selected.test`) did not match `parsed.serverUrl` (`https://ambient.test`), `getAuthToken("b")` intentionally returned `null`.
  * **Status & Disposition**: Per instruction ("If fail report immediately, finish independent checks; don't retry unchanged"), reported immediately to Main. Main acknowledged: *"Acknowledged test fixture endpoint binding root cause; do not rerun unchanged... End terminal report when done so parent can fix trivial test fixture and rerun affected suite"*. No production code modified.

---

## 3. Targeted Review Fix Validations

### 3.1 Backend Review Fixes (F1 / F2 / Contracts)
- **Bearer-Only DELETE Enforcement**:
  * `server/src/api/auth_sessions.rs:116-119`: Handler extracts `Extension(mechanism): Extension<CredentialMechanism>`. If `mechanism != CredentialMechanism::Bearer`, returns `403 BearerRequired` before storage mutation.
  * Explicit invalid bearer (`Authorization: Bearer invalid-token`) rejected with `401 Unauthorized` without falling back to cookie.
  * Malformed headers (`Authorization: Bearer`, `Basic ...`) falling back to cookie are denied with `403 BearerRequired`.
- **Elimination of `Set-Cookie` on DELETE**:
  * No `Set-Cookie` header is emitted on successful `204 No Content` self-revocation or rejection paths.
  * Foreign/unrelated cookies in the browser jar remain untouched.
- **Cache-Control & No-Auth Guard**:
  * `router.rs:73-78`: Outer `no_store` middleware layer wraps `/api/auth/sessions` and `/api/auth/sessions/{id}`.
  * `--no-auth` mode consistently returns `409 DEVICE_SESSIONS_UNAVAILABLE`.
- **Media Capability Cleanup**:
  * `server/src/fs/media_ticket.rs:auth_context_binding_clamping_and_revocation`: Verified that `store.revoke_by_actor_or_session("actor", Some("sess-1"))` terminates tickets bound to `sess-1` while preserving sibling tickets bound to `sess-sibling`.

### 3.2 Frontend Review Fixes (F1 / F2 / F7)
- **Dialog Draft & Stale Save Protection**:
  * `ServerSettingsDialog.tsx`: Added `credentialDraftScopeRef` tracking `profileId`, `serverUrl`, and `revokedToken`.
  * On self-revocation ACK, clears the draft token and initial token only for the matching scope.
  * Save precondition re-checks `getAuthToken(saveProfileId)`: if the token is null or equals `revokedToken`, Save will not overwrite a replacement token or re-store the dead credential.
- **Real-Connections Coupling (`login-devices-connections.test.tsx`)**:
  * 15 comprehensive tests exercising real `connections.ts` subscriber ordering, 4401-before-DELETE, replacement before/after ACK, profile switching, storage-failure fallback, and retirement race conditions using fake HTTP/WS seams.
- **Responsive Layout & Accessibility (`login-devices.browser.tsx`)**:
  * Validated at 320x667 and 320x420 with 12 items.
  * Client hint wrapping verified without horizontal overflow (`scrollWidth <= clientWidth`).
  * Vertical scroll container bounded (`<= 256px`).
  * Action buttons accessible and fully within viewport.

---

## 4. Image Provenance & Capture Freshness

### 4.1 Image Rebuild
- **Command**: `CONTAINER_ENGINE=docker node --experimental-strip-types packages/ui/e2e/fixtures/image-builder.ts`
- **Output Image**: `dam-hopper:production-test`
- **Target Image ID**: `f740ab592c09913d618fbd2dcb36ce40e9b6dd5951ecdf921b5e2c993ae68b9b`
- **Embedded Label**: `dam-hopper.source-fingerprint=28c9880d8b5d1633fe303789a918279089a0670bf44b34150db614ca301f75dc`
- **Computed Git/Working Tree Fingerprint**: `28c9880d8b5d1633fe303789a918279089a0670bf44b34150db614ca301f75dc`
- *Note on Provenance Limitations*: `computeSourceFingerprint()` hashes Git HEAD plus porcelain status line text, not file contents. The optional host `apps/web/dist` overlay means the image label identifies the container baseline while web assets reflect the latest `pnpm build`. Additionally, subsequent throwaway test execution temporarily dirty-tagged a transient rebuild (`55796c9015cd`), which was subsequently cleaned.

### 4.2 Capture Gate Execution
- **Gate Open**: Parent notified via `agent://Main`; source and report edits frozen.
- **Targeted E2E Run**:
  * Command: `CONTAINER_ENGINE=docker E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e device-login-management/device-login-management.spec.ts`
  * Status: **1 passed** (8.0s Playwright / 8.54s wall)
  * Run ID: `e2e-run-1792621601955-c069185b`
  * Capture timestamps: `2026-10-21T22:26:41.955Z` to `2026-10-21T22:26:47.312Z`
- **Gate Close**: Parent notified via `agent://Main`.

### 4.3 Screenshot Inspection
All 3 captured PNG artifacts inspected via direct image decode:
1. `desktop-login-devices.png` (1440x900, SHA-256 `4b9f4506b5aa684877b3b06f310f1b4a8c4f269a832a4c4d3ed0a331996feba4`):
   - Server Connection dialog open with "Login devices" section.
   - Long untrusted client hint `Unverified client <script>not markup</script> LongClientHint...` renders as harmless text; no unescaped DOM markup.
   - Timestamps and "Revoke access" button properly formatted.
2. `narrow-login-devices.png` (320x667, SHA-256 `5fb8ec7364c497ca7a2f3b0bb60183fad8b626e451bc5e891b68d4374232238c`):
   - Dialog fits within 320px viewport without horizontal document spilling.
   - Long client hint wraps vertically.
   - *Limitation*: The long client hint occupies the visible viewport area; session metadata and lower controls are scrolled below the fold. Playwright functional assertions verified reachability via `scrollIntoViewIfNeeded()`, but discoverability remains subject to human visual acceptance.
3. `narrow-self-revoke-confirmation.png` (320x667, SHA-256 `a6331d3c74132b69dff7d7ad463c8b25736e867edc949da954c8f0e7a878b1ab`):
   - "End this login?" modal centered, readable, warning text visible.
   - "Revoke access" (danger) and "Cancel" buttons fully visible and accessible within 320x667 bounds.
- **Review Status**: `review.md` left as `PENDING_HUMAN_REVIEW` (no human approval fabricated).

---

## 5. Full Application E2E Suite Verification

- **Command**: `CONTAINER_ENGINE=docker CI=true E2E_CAPTURE=0 pnpm --filter @dam-hopper/ui test:e2e`
- **Result**: **11 passed** (114.84s wall / 1.9m Playwright)
- **Executed Specs**:
  1. `device-login-management/device-login-management.spec.ts`: PASSED
  2. `editor-git-blame/editor-git-blame.spec.ts`: PASSED
  3. `git-conflict-resolver/git-conflict-resolver.spec.ts`: PASSED
  4. `host-auto-sleep/host-auto-sleep.spec.ts`: PASSED
  5. `privacy-blur/privacy-blur.spec.ts`: PASSED
  6. `project-plans-dashboard/project-plans-dashboard.spec.ts`: PASSED
  7. `sqlite-auth-cutover/sqlite-auth-cutover.spec.ts`: PASSED
  8. `traditional-terminal-agents/traditional-terminal-agents.spec.ts` (case 1): PASSED
  9. `traditional-terminal-agents/traditional-terminal-agents.spec.ts` (case 2): PASSED
  10. `worktree-switcher/worktree-switcher.spec.ts`: PASSED
  11. `contrast-and-font-size/contrast-and-font-size.spec.ts`: PASSED

---

## 6. Real-Browser Cookie Boundary Regression

A temporary end-to-end regression test was authored and executed against an isolated real containerized backend running SQLite Lite Mode to validate the new cookie boundary and held-response behavior:

### 6.1 Test Methodology & Exercise
1. **Real MFA Session B Creation**:
   - Seeded initial Session A (`admin`).
   - Logged in via `POST /api/auth/login` -> received `enrollmentRequired` -> `POST /api/auth/mfa/setup` -> `POST /api/auth/mfa/confirm` using calculated TOTP.
   - Backend issued valid Session B with `tokenB`.
2. **Denial of Cookie-Only Mutations**:
   - Configured browser context with `damhopper-auth=tokenB` (`httpOnly`, `SameSite=Strict`, `path=/`).
   - Cookie-only `DELETE /api/auth/sessions/{sessionBId}` with `credentials: "include"`: returned **403 Forbidden** (`BearerRequired`), no `Set-Cookie`.
   - Malformed `Authorization` header tests:
     * `Basic ...` and `Bearer` (falling back to cookie): returned **403 Forbidden** (`BearerRequired`), no `Set-Cookie`.
     * `Bearer ` and `Bearer invalid-token`: returned **401 Unauthorized** (invalid bearer token without fallback), no `Set-Cookie`.
   - Cookie-only `GET /api/auth/sessions`: confirmed **200 OK** and both sessions remained active (zero storage mutation).
3. **Held Genuine Response & Cookie B Preservation**:
   - Registered Playwright route handler on `**/api/auth/sessions/{sessionAId}`.
   - When `DELETE` intercepted, executed `route.fetch()`: forwarded real request to real backend; received genuine **204 No Content** response.
   - Verified genuine response headers had **no `set-cookie`**.
   - Held response delivery; installed valid replacement Cookie B (`tokenB`) into the browser context.
   - Released held response; browser received genuine 204.
4. **Post-Release Verification**:
   - Inspected browser cookie jar via `context.cookies()`: verified Cookie B remained intact with `tokenB`.
   - Issued cookie-only `GET /api/auth/status`: returned **200 OK** (`authenticated: true`).
   - Issued cookie-only `GET /api/auth/sessions`: returned **200 OK**, exactly 1 session (Session B), marked `current: true`.
   - Verified Session A bearer token returned **401 Unauthorized** (`SESSION_REVOKED`).
5. **Cleanup**:
   - Throwaway spec deleted immediately after execution. Container and temporary network cleanly removed.

---

## 7. Remaining Limits & Actionable Next Steps

1. **Fix Trivial Test Fixture in `LoginDevicesSection.test.tsx`**:
   - Line 113: Update test to re-issue `setAuthToken("token-b", "b")` after changing `b.url`, or keep `b.url` consistent at creation so the token's bound `serverUrl` matches `currentProfile.url`.
2. **Human Visual Acceptance**:
   - Review narrow viewport discoverability (`narrow-login-devices.png`) and finalize `review.md`.
3. **Retain Cookie Boundary Test as Permanent Suite**:
   - Consider promoting the throwaway cookie boundary test into `packages/ui/e2e/device-login-management/` for permanent CI regression coverage.

---

## 8. Unresolved Questions

1. Should the `LoginDevicesSection.test.tsx` test fixture URL mutation be fixed by Main or delegated to frontend? (Main indicated intention to fix directly).
2. Is the vertical scrolling in 320px narrow mode considered acceptable for UX sign-off, or should the device hint display be truncated with an expander? (Subject to pending human review).
