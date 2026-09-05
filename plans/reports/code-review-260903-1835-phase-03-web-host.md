# Code Review: Phase 03 — Dedicated Web Host, Runtime Origin, and Health

## Code Review Summary

### Scope
- **Files reviewed (18 files):**
  - `server/src/bin/dam-hopper-web.rs`
  - `server/src/web_host/mod.rs`
  - `server/src/web_host/router.rs`
  - `server/src/web_host/cache_policy.rs`
  - `server/src/web_host/runtime_config.rs`
  - `server/src/web_host/safe_path.rs`
  - `server/src/api/router.rs`
  - `server/src/api/settings.rs`
  - `server/src/api/tests.rs`
  - `server/src/main.rs`
  - `server/src/lib.rs`
  - `server/Cargo.toml`
  - `server/tests/linux_release_web_host.rs`
  - `packages/ui/src/api/runtime-config.ts`
  - `packages/ui/src/api/runtime-config.test.ts`
  - `packages/ui/src/api/server-config.ts`
  - `packages/ui/src/api/server-config.test.ts`
  - `apps/web/src/main.tsx`
  - `apps/web/vite.config.ts`
  - `Dockerfile`
- **Lines of code analyzed:** ~1,100 lines (Rust + TS)
- **Review focus:** Security (traversal, origin validation, CORS), performance (memory buffering vs streaming), architecture (decoupling web host from AppState), YAGNI/KISS/DRY compliance, plan criteria fulfillment.
- **Updated plans:** `plans/260903-0919-linux-release-installer-architecture/phase-03-web-host-runtime-origin-health.md`

### Overall Assessment
- **Score:** 8.5/10
- **Status:** Approved with actionable recommendations (1 High, 2 Medium, 1 Low).
- The implementation cleanly separates the dedicated web host binary (`dam-hopper-web`) from the API backend, enforces strict public runtime config schemas (≤4 KiB), removes static asset serving from the API default while preserving Docker compatibility via explicit `--web-dir`, establishes deterministic caching headers, and implements robust server profile reconciliation with active user profile precedence and token invalidation on URL shift.

---

### Critical Issues
*None.* (No remote code execution, secret leakage, or crash vectors detected.)

---

### High Priority Findings

#### 1. Encoded Traversal and Directory Requests Bypass to SPA Fallback (`200 OK` with HTML)
- **Location:** `server/src/web_host/safe_path.rs:11-44`, `server/src/web_host/safe_path.rs:70-91`
- **Specification:**
  - Plan step 3: *"Resolve files beneath the immutable root, reject symlink components, encoded separators/traversal, directories without index, and any reserved-prefix fallback."*
  - Plan criterion: *"Valid browser routes return index; missing `.js`, `.css`, reserved, traversal, encoded-separator, directory, and non-GET/HEAD requests do not."*
- **Problem:**
  - `resolve_static_file` only checks for literal `\0` and `\\`. It does not detect percent-encoded separators (`%2f`, `%2F`, `%5c`, `%5C`) or percent-encoded traversal sequences (`%2e%2e`, `%2E%2E`, `%2e`, `%2E`).
  - When a client issues `GET /%2e%2e/foo` or `GET /foo%2fbar`, `resolve_static_file` looks for the literal file on disk, fails, and returns `Ok(None)`.
  - In `should_spa_fallback`, the final segment is `"foo"` or `"bar"`, which contains no dot (`.`), and `accept` matches HTML.
  - As a result, the server serves `index.html` with `200 OK` rather than `404 Not Found`.
  - Similarly, when an existing directory without an index file is requested (e.g. `GET /assets/` or `GET /assets`), `check_regular_file` sees `meta.is_file()` is false and returns `Ok(None)`. `should_spa_fallback` treats the segment as an SPA path and serves `index.html` with `200 OK`, masking directory presence and violating the directory rejection requirement.
- **Fix:**
  - In `safe_path.rs`, reject paths containing `%2f`, `%2F`, `%5c`, `%5C`, `%2e%2e`, `%2E%2E`, `%00`.
  - If a resolved path matches an existing directory on disk without an `index.html`, return an explicit error or `Ok(None)` marked as non-fallbackable to return `404 Not Found`.

---

### Medium Priority Findings

#### 2. Large Asset Buffering in Heap Memory via `tokio::fs::read`
- **Location:** `server/src/web_host/router.rs:120-140`
- **Specification:**
  - Plan Risk Assessment: *"Large asset memory: Stream files through `ServeFile`; never buffer `dist` bodies."*
- **Problem:**
  - `serve_file` loads the full asset byte array into memory via `tokio::fs::read(path).await`.
  - Bundled Monaco and worker chunks are large (e.g., `ts.worker-*.js` is 7.0 MB, `monaco-*.js` is 4.3 MB, `css.worker-*.js` is 1.0 MB).
  - Under concurrent requests, buffering 5-10 MB per connection causes unnecessary heap spikes and allocator churn.
- **Fix:**
  - Use `tokio::fs::File::open(path).await` to query `metadata().len()` for `Content-Length`.
  - Stream response body via `Body::from_stream(tokio_util::io::ReaderStream::new(file))` for GET requests, and return `Body::empty()` for HEAD requests.

#### 3. In-Process Test Lifecycle Uses `handle.abort()` Rather than Exercising Graceful Shutdown
- **Location:** `server/tests/linux_release_web_host.rs:332-366`
- **Specification:**
  - Plan Step 8 & Criterion: *"Web host test process exits gracefully on SIGTERM and has no write/proxy routes."*
- **Problem:**
  - `test_run_web_host_lifecycle` invokes `handle.abort()`, which only tests task cancellation, leaving the signal handler and Axum graceful shutdown logic unverified in integration tests.
- **Fix:**
  - Allow `run_web_host` to accept a custom cancellation signal or run a child process integration test sending `SIGTERM` and asserting zero exit code.

---

### Low Priority Suggestions

#### 4. Top-Level Async Bootstrap Unhandled Rejection
- **Location:** `apps/web/src/main.tsx:66`
- **Problem:** `void bootstrap();` drops unhandled rejections if an unexpected DOM or transport instantiation error occurs.
- **Fix:** Append `.catch((err) => { console.error("Bootstrap error:", err); })` with fallback DOM diagnostics.

---

### Positive Observations
1. **Architecture & Clean Separation:** `dam-hopper-web` depends on zero API `AppState` state, does not touch API database or environment files, and adheres to strict non-writing static serving.
2. **Deterministic Cache Policy:** Precise separation of immutable hashed assets (`public,max-age=31536000,immutable`), HTML entrypoints (`no-cache`), and reserved health/config (`no-store`).
3. **Frontend Origin & Profile Precedence:**
   - Active user-created profiles are preserved on load without being overwritten by deployed runtime configs.
   - Profile token is invalidated only when the managed profile's `apiUrl` changes.
   - Frontend and backend origin validation rules match with strict protocol, port, and path stripping.
4. **Backward Compatibility:** Docker combined container retains functionality through explicit `--web-dir /opt/dam-hopper/web` while the standard API server defaults to API-only.

---

### Recommended Actions
1. Update `server/src/web_host/safe_path.rs` to detect and reject percent-encoded separators/traversal and existing directory paths before SPA fallback.
2. Replace `tokio::fs::read` with streaming file responses (`tokio::fs::File` + `ReaderStream` / `ServeFile`) in `server/src/web_host/router.rs`.
3. Add `.catch()` handler to `apps/web/src/main.tsx:66`.
4. Extend tests in `server/tests/linux_release_web_host.rs` to assert `404` on encoded traversal (`/%2e%2e/foo`) and directory requests (`/assets/`).

---

### Metrics & Validation Results
- **Cargo Tests:**
  - `cargo test --manifest-path server/Cargo.toml --test linux_release_web_host` → **8 passed, 0 failed**
  - `cargo test --manifest-path server/Cargo.toml api_router_defaults_to_api_only_and_returns_404_for_web_routes` → **1 passed**
  - `cargo test --manifest-path server/Cargo.toml api_health_payload_contains_schema_and_role` → **1 passed**
- **Vitest Tests:**
  - `pnpm --filter @dam-hopper/ui test run src/api/runtime-config.test.ts src/api/server-config.test.ts` → **72 passed, 0 failed**
- **Compile Proofs:**
  - `cargo check --manifest-path server/Cargo.toml --all-targets --features vendored` → **Exit 0**
  - `pnpm --filter @dam-hopper/ui build` → **Exit 0**
  - `pnpm --filter @dam-hopper/web build` → **Exit 0** (built production bundle in 30.14s)

---

### Unresolved Questions
*None.* Architecture and implementation contracts are unambiguous and align with parent plan specifications.
