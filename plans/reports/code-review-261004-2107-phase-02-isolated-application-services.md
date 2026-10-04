# Code Review Report: Phase 02 — Isolated Application Services

**Review Date:** 2026-10-04  
**Plan Reference:** `plans/261004-1639-frontend-test-restructure/phase-02-isolated-application-services.md`  
**Reviewer:** Senior Software Engineer (CodeReviewerPhase02)  
**Overall Score:** 8.5 / 10  

---

## 1. Scope & Analyzed Files

Files analyzed for Phase 02: Isolated production application services and deterministic data:

| File | Type | Lines | Role |
|---|---|---|---|
| `.dockerignore` | Config | 62 | Context pruning (secrets, nodes, target, artifacts) |
| `Dockerfile` | Build | 68 | Production multi-stage image (cache fix for stub binaries) |
| `server/examples/application_e2e_seed.rs` | Rust | 168 | MongoDB admin & active session preauth seeder |
| `packages/ui/e2e/fixtures/application-runtime.Dockerfile` | Build | 16 | Test runtime image derived from production & builder targets |
| `packages/ui/e2e/fixtures/application-data.ts` | TS | 141 | Seed tree generation, fingerprinting, storage re-exports |
| `packages/ui/e2e/fixtures/application-storage-state.ts` | TS | 74 | Playwright browser storage state generator |
| `packages/ui/e2e/fixtures/application-readiness.ts` | TS | 51 | Health polling & safety invariant verification |
| `packages/ui/e2e/fixtures/container-client.ts` | TS | 130 | Podman/Docker command execution & port mapping abstraction |
| `packages/ui/e2e/fixtures/application-services.ts` | TS | 234 | Container network, Mongo, app lifecycle coordinator |
| `packages/ui/e2e/fixtures/application-fixture.ts` | TS | 66 | Playwright extended test fixture definition |
| `packages/ui/e2e/fixtures/image-builder.ts` | TS | 97 | Multi-stage image build orchestration & fingerprint caching |
| `packages/ui/e2e/fixtures/index.ts` | TS | 7 | Public fixture barrel export |
| `packages/ui/e2e/fixtures/application-services.spec.ts` | Test | 120 | Acceptance test probes (L01, L03, L05, L06) |
| `packages/ui/package.json` | Config | 76 | Added `test:e2e:build-images` and `test:e2e:probes` |
| `packages/ui/tsconfig.e2e.json` | Config | 19 | Updated lib to `ES2024` for modern promise primitives |

---

## 2. Overall Assessment

The Phase 02 implementation demonstrates strong architectural alignment with production requirements:
1. **Container Isolation & Host Defense:** Application runs completely isolated from host HOME, `/etc/dam-hopper`, and user dotfiles. Published ports bind strictly to host loopback (`127.0.0.1:<dynamic>:4800`).
2. **Production Authenticity:** Avoids mock auth, `--no-auth`, or mock backend shims. Full Axum middleware is active with real MongoDB authentication and genuine SPA assets served by `dam-hopper-server`.
3. **Clean Composition:** Minimal multi-stage layering reuses `dam-hopper:server-builder` and `dam-hopper:production` without polluting the release image.

Key areas requiring attention before Phase 03/04:
- Signal handlers in `application-services.ts` do not await teardown or trigger exit.
- Test probes omit L02 (assertion failure cleanup) and L04 (cancellation/interruption).
- Repository fingerprinting triggers rebuilds on documentation and plan updates.
- Server token is passed via CLI flag rather than stdin or environment variables.

---

## 3. Findings by Severity

### Critical Issues (0)
*No breaking bugs or fatal security vulnerabilities identified.*

---

### High Priority Findings (2)

#### H1: Signal handler in `application-services.ts` does not await teardown or exit process
- **File:** `packages/ui/e2e/fixtures/application-services.ts:86-91`
- **Problem:**
  ```typescript
  const signalHandler = () => {
    cleanup().catch(() => {});
  };
  process.on("SIGINT", signalHandler);
  process.on("SIGTERM", signalHandler);
  ```
  Attaching `process.on("SIGINT", ...)` overrides Node's default exit behavior. Because `cleanup()` is not awaited and `process.exit()` is never called, an external interrupt (SIGINT/SIGTERM) leaves the process hanging or terminates abruptly before async cleanup finishes, leaving containers and networks running.
- **Requirement Violation:** `phase-02-isolated-application-services.md` Step 8: *"Handle signals through awaited teardown, not asynchronous Node exit callbacks."*
- **Recommendation:**
  ```typescript
  const signalHandler = async (signal: NodeJS.Signals) => {
    try {
      await cleanup();
    } finally {
      process.exit(signal === "SIGINT" ? 130 : 143);
    }
  };
  ```

#### H2: Missing L02 and L04 Acceptance Test Cases in `application-services.spec.ts`
- **File:** `packages/ui/e2e/fixtures/application-services.spec.ts`
- **Problem:** The suite is titled `"Phase 02: Isolated Application Services (L01-L06)"`, but only defines L01, L03, L05, and L06.
  - Missing **L02** (Intentional assertion failure / timeout ensuring full cleanup occurs).
  - Missing **L04** (Runner interruption / SIGINT/SIGTERM cancellation proof).
- **Requirement Violation:** `acceptance-checks.md:53-55` and `phase-02-isolated-application-services.md:65`.
- **Recommendation:** Add L02 test proving fixture disposal executes on assertion failure and L04 test proving graceful termination.

---

### Medium Priority Findings (3)

#### M1: Overly Broad Source Tree Fingerprinting Rebuilds Images on Doc/Plan Changes
- **Files:** `packages/ui/e2e/fixtures/application-data.ts:52-69`, `image-builder.ts:38-43`
- **Problem:** `computeSourceFingerprint()` computes SHA-256 over `git status --porcelain=v2 -z` across the entire repo. When `.md` files in `plans/` or `docs/` are modified, `git status` changes, invalidating `isImageUpToDate()` and triggering redundant multi-stage Docker builds.
- **Recommendation:** Scope git status inspection to directories and files actually influencing the build context (`apps/`, `packages/`, `server/`, `Cargo.*`, `package.json`, `pnpm-lock.yaml`, `Dockerfile`).

#### M2: Server Secret Passed via Command-Line Flags
- **File:** `packages/ui/e2e/fixtures/application-services.ts:141-151`
- **Problem:** `--server-token ${seedTree.serverToken}` is passed as a command-line argument to `/usr/local/bin/application_e2e_seed`. Command-line arguments are visible in `ps aux` within the container.
- **Recommendation:** `application_e2e_seed.rs` already supports `SERVER_TOKEN` environment variable and `--stdin` JSON config. Use `env` parameter in `execInContainer` (`-e SERVER_TOKEN=...`) or stdin pipe.

#### M3: Hardcoded 1.5s Sleep Instead of Active MongoDB Readiness Check
- **File:** `packages/ui/e2e/fixtures/application-services.ts:110-112`
- **Problem:** Uses a static `setTimeout(..., 1500)` after launching MongoDB container. This introduces artificial latency on fast workstations and potential race conditions on busy CI workers.
- **Requirement Violation:** Requirement 38: *"Readiness: Mongo ping; seed completion; server exec remains alive + real HTTP /api/health"*.
- **Recommendation:** Replace the sleep with a fast ping probe or rely on the seed runner's internal connection retry logic.

---

### Low Priority Suggestions (3)

#### L1: Unguarded `page.close()` in `authenticatedPage` Fixture
- **File:** `packages/ui/e2e/fixtures/application-fixture.ts:57-62`
- **Problem:** `await page.close()` sits outside a `try ... finally` block. If `use(page)` throws, `page.close()` is bypassed. (Mitigated because `authenticatedContext` closes the context).
- **Recommendation:** Enclose `use(page)` in `try { await use(page); } finally { await page.close(); }`.

#### L2: Overcomplicated Delay Logic (KISS Principle)
- **Files:** `packages/ui/e2e/fixtures/application-readiness.ts:15-17`, `application-services.ts:110-112`
- **Observation:** `Promise.withResolvers<void>()` is used for simple delay timeouts.
- **Recommendation:** Prefer `import { setTimeout } from "node:timers/promises"; await setTimeout(300);`.

#### L3: Minor Version Inconsistency in Mongo Image
- **Files:** `application-services.ts:60` defaults to `docker.io/library/mongo:8.2`, whereas `phase-02-isolated-application-services.md:31` specifies `8.0`.
- **Recommendation:** Align default image tag with plan documentation.

---

## 4. Positive Observations

- **Rigorous Environment Sandboxing:** Effective Advisor home inspection (`verifyServiceSafety`) proves `/etc/dam-hopper/host.toml` and host home cannot be reached.
- **Strict Storage State Boundary:** Only `damhopper_server_profiles`, `damhopper_active_profile_id`, and `damhopper_profile_auth_v2_<id>` are seeded, maintaining 100% production fidelity.
- **Build Layer Caching Fix:** Dockerfile pre-build layer cache now correctly stubs all four server binary entrypoints (`main.rs`, `dam-hopper.rs`, `dam-hopper-web.rs`, `dam-hopper-idle-suspend-helper.rs`), fixing Docker layer caching.
- **Process & Network Cleanup:** Serial and concurrent instances properly isolate networks and random host ports, cleanly verifying resource removal in teardown.

---

## 5. Verification Commands and Results

| Command | Status | Output / Findings |
|---|---|---|
| `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | PASS | 0 errors; TypeScript cleanly passes on `tsconfig.e2e.json` |
| `cargo check --example application_e2e_seed` | PASS | Finished dev profile in 0.64s |
| `cargo clippy --example application_e2e_seed` | PASS | 0 warnings in `application_e2e_seed.rs` |
| `pnpm --filter @dam-hopper/ui test` | PASS | 300 test files, 2287 unit tests passed |
| `playwright test fixtures/application-services.spec.ts --list` | PASS | 4 tests discovered (L01, L03, L05, L06) |
| Podman port mapping probe (`127.0.0.1::4800`) | PASS | Dynamically assigns loopback port (e.g., `127.0.0.1:39949`) |
| Podman label inspection (`--format '{{index .Config.Labels ...}}'`) | PASS | Accurately reads custom labels |

---

## 6. Unresolved Questions

1. Should L02 and L04 tests be executed as separate isolated Playwright spec files or integrated directly into `fixtures/application-services.spec.ts` before beginning Phase 03?
2. Should `computeSourceFingerprint()` ignore all markdown/doc paths or specifically consult `.dockerignore` patterns via a glob helper?
