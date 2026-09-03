# Phase 03 — Dedicated Web Host, Runtime Origin, and Health

## Context Links

- [Parent plan](./plan.md)
- [Phase 01 contract](./phase-01-contract-version-manifest.md)
- [Accepted brainstorm](../reports/brainstorm-260903-0919-linux-release-installer-architecture.md)
- [API router](../../server/src/api/router.rs)
- [Web Vite configuration](../../apps/web/vite.config.ts)
- [Web bootstrap](../../apps/web/src/main.tsx)
- [Server profile logic](../../packages/ui/src/api/server-config.ts)

## Overview

- **Date:** 2026-09-03
- **Description:** Build a non-writing Rust static host on `4802`, expose exact web health/runtime metadata, and bootstrap the SPA against an explicit API URL.
- **Priority:** P1
- **Implementation status:** Pending
- **Review status:** Pending
- **Effort:** 14h

## Key Insights

- Current production Vite output forces same-origin while new web and API ports differ. A build-time backend URL would create per-host web artifacts and violate one immutable release.
- Existing user-created server profiles are valuable and must remain higher priority than deployment defaults.
- `/api/health` cannot prove the web binary/assets. Web health needs a reserved route that cannot fall through to `index.html`.
- Docker intentionally remains a separate deployment. Replace the API's implicit `/opt/dam-hopper/web` default with an explicit optional web-dir mode so Docker can retain its current combined topology without becoming part of the systemd release.

## Requirements

### Functional

- Add `dam-hopper-web --root PATH --host 0.0.0.0 --port 4802 --runtime-config PATH --release-version X.Y.Z`.
- Serve only `GET` and `HEAD`; return `405` for other methods, no directory listing, writes, uploads, proxy, admin surface, or runtime JS execution.
- Reserve:
  - `/__dam-hopper/health` → `{schemaVersion:1,status:"ok",version:"X.Y.Z",role:"web"}`.
  - `/__dam-hopper/runtime-config.json` → `{schemaVersion:1,releaseVersion,profileId,apiUrl}`.
- Health/runtime metadata return `application/json`, `Cache-Control: no-store`, and cannot be overridden by dist files.
- Serve real files with MIME detection. SPA fallback only for GET/HEAD browser navigation accepting HTML and whose final path segment has no file extension. Missing asset-like and reserved paths return `404`.
- Production web bootstrap priority: existing active user profile → valid deployed runtime config → idle/profile prompt. Never derive API URL from request `Host` or silently use web origin.
- On first deployed load, create/update one managed profile using stable `profileId`; if API URL changes, clear that profile's token before update. User-selected non-managed profiles remain untouched.
- API health adds stable schema/role fields while preserving `status` and `version`. API and WS CORS continue exact-origin validation.

### Non-functional

- Static root/runtime config opened without following symlinks; root must be the selected immutable release view.
- Runtime config ≤4 KiB, strict keys/types, exact HTTP(S) URL with no credentials/query/fragment, stable UUID v4 profile ID.
- Hashed assets: `public,max-age=31536000,immutable`; `index.html`: `no-cache`; health/runtime: `no-store`; other assets: bounded one-hour cache.
- Graceful SIGTERM stops accepting connections and completes in-flight responses within unit timeout.

## Architecture

`dam-hopper-web` is a second binary in the existing Cargo package, preserving one Cargo version. `web_host` owns route classification, safe file resolution, response headers, and runtime config. It has no dependency on API `AppState` and receives no API environment files.

`apps/web/src/main.tsx` performs an async transport bootstrap before React mount. `packages/ui/src/api/runtime-config.ts` fetches and validates the reserved config with `cache: "no-store"`. `server-config.ts` owns managed-profile reconciliation so token clearing/profile events use existing code paths. A 404 config response remains normal for Pages/dev and falls through to the existing profile guard.

The API router receives `Option<PathBuf>` for explicit combined-mode static serving. Server default and systemd unit pass `None`; Docker explicitly opts in. This removes the implicit `/opt/dam-hopper/web` fallback from API production without redesigning Docker.

## Related Code Files

### Create

- `server/src/bin/dam-hopper-web.rs` — thin web-host process entry point.
- `server/src/web_host/mod.rs` — host assembly and shutdown.
- `server/src/web_host/router.rs` — method/reserved/static/SPA route classification.
- `server/src/web_host/cache_policy.rs` — deterministic cache headers.
- `server/src/web_host/runtime_config.rs` — strict public config and health payload.
- `packages/ui/src/api/runtime-config.ts` — bounded runtime config fetch/validation.
- `packages/ui/src/api/runtime-config.test.ts` — absent/malformed/cross-origin/bootstrap cases.
- `server/tests/linux_release_web_host.rs` — real temp-dist HTTP behavior.

### Modify

- `server/Cargo.toml` — declare `dam-hopper-web` binary.
- `server/src/lib.rs` — export web-host module.
- `server/src/main.rs` — default API-only; accept explicit optional combined-mode web dir.
- `server/src/api/router.rs` — remove implicit static root; preserve explicit combined-mode factory and API 404s.
- `server/src/api/settings.rs` — stable API health schema/role/version.
- `server/src/api/tests.rs` — API-only default and explicit combined-mode regressions.
- `apps/web/src/main.tsx` — await profile/runtime resolution before transport construction.
- `apps/web/vite.config.ts` — define immutable release-version metadata only; keep host-specific API URL out of build.
- `packages/ui/src/api/server-config.ts` — managed runtime profile reconciliation and token invalidation.
- `packages/ui/src/api/server-config.test.ts` — profile precedence/update cases.
- `Dockerfile` — explicitly pass its existing static web directory to API combined mode; no release/systemd coupling.

### Delete

- None.

## Implementation Steps

1. Define strict web health/runtime JSON types and validate release version plus config profile/API URL at process startup.
2. Build an Axum router with reserved routes registered before static handling; allow only GET/HEAD and ensure HEAD bodies are empty with GET-equivalent headers.
3. Resolve files beneath the immutable root, reject symlink components, encoded separators/traversal, directories without index, and any reserved-prefix fallback.
4. Apply cache policy by response kind and content-hash filename, not request-controlled headers.
5. Handle SIGTERM/CTRL-C using Axum graceful shutdown and return nonzero on bind/config/root failures.
6. Change API router default to API-only. Keep static serving only when the server receives the explicit combined-mode path used by Docker.
7. Add runtime config fetch/validation. Reconcile a managed profile only when no user profile is active; use existing token/profile change paths.
8. Add real HTTP tests for GET/HEAD, MIME, byte identity, SPA fallback, asset 404, traversal, reserved collision, cache, method rejection, and graceful shutdown.
9. Add frontend tests for active-profile precedence, config absence/malformed values, stable managed profile, URL-change token clearing, and no same-origin guess.
10. Plan compile proofs: `cargo check --manifest-path server/Cargo.toml --all-targets --features vendored`; `pnpm --filter @dam-hopper/ui build`; `pnpm --filter @dam-hopper/web build`.
11. Submit to `evcrate-code-reviewer`; fix blocking findings and rerun all three compile proofs before terminal approval.

## Todo List

- [ ] Add dedicated web binary and focused host modules.
- [ ] Add exact health/runtime routes and cache policy.
- [ ] Make API default API-only while preserving explicit Docker combined mode.
- [ ] Add managed runtime profile bootstrap without overriding user selection.
- [ ] Add HTTP and frontend contract coverage.
- [ ] Run compile checks and pass scoped reviewer gate.

## Success Criteria

- Web health returns exact release version/role for GET and HEAD and never returns SPA HTML.
- Every content-hashed asset receives one-year immutable caching; index is revalidated; health/runtime are never stored.
- Valid browser routes return index; missing `.js`, `.css`, reserved, traversal, encoded-separator, directory, and non-GET/HEAD requests do not.
- A deployed build with no saved profile connects to configured `apiUrl`; saved user profile wins; absent config stays idle rather than guessing `:4802` as API.
- API default returns API 404 for browser paths and has no static filesystem access. Docker retains current combined behavior only through explicit configuration.
- Web host test process exits gracefully on SIGTERM and has no write/proxy routes.
- All compile commands exit `0`; reviewer has no unresolved P1/P2 findings.

## Risk Assessment

- **Async bootstrap blank/error state:** Keep bootstrap bounded; mount the existing profile guard with a diagnostic when config is unavailable.
- **SPA fallback masks failures:** Reserve prefix and extension/Accept rules; test JSON-vs-HTML content types.
- **Stale API URL:** Stable managed profile updates URL and clears only its scoped token.
- **Docker regression:** Add explicit-path regression while excluding Docker from the new release lifecycle.
- **Large asset memory:** Stream files through `ServeFile`; never buffer `dist` bodies.

## Security Considerations

- Runtime config is public and contains no token, credentials, internal path, or environment.
- Never trust `Host`, forwarded headers, or query parameters to construct API origin.
- Web unit receives read-only release/config paths and no API home/env access; Phase 04 enforces OS isolation.
- Exact API CORS and WebSocket origin allowlists remain required; `*` is never generated.

## Next Steps

Phase 04 packages this binary/assets behind the web identity and concrete unit. Phase 05 uses the exact health payload for activation. Unresolved questions: none.
