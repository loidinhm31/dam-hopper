# Phase 02 — Isolated production application services and deterministic data

## Context links
- [Plan](./plan.md), [runner separation](./phase-01-inventory-and-runner-separation.md), [fixture research](./research/application-fixture-feasibility.md), [acceptance](./acceptance-checks.md).
- Existing `Dockerfile`, `server/src/{main,state}.rs`, `server/src/api/agent_status.rs:71-88`, `server/src/auth/{model,store,policy}.rs`.

## Overview
- Date: 2026-10-04. Priority: P2. Implementation: pending. Review: pending.
- Run actual built web SPA + production backend in a fixture-owned application container and real Mongo in a separate owned container. Same-origin application, per-test isolated data and normal auth.

## Key Insights
- **Safety gate:** production `resolve_effective_home()` checks `/etc/dam-hopper/host.toml.service_user` before HOME; `AppState::new` passes that home to Advisor. Temporary HOME/XDG on a managed host can still reach personal policy/history. Use controlled container `/etc`, not a production test-only home/auth override.
- Existing root `Dockerfile` builds real server and web SPA, serves the actual compiled `apps/web` entry with `--web-dir /opt/dam-hopper/web`, and pins builder/runtime base images. Reuse this production surface; no fabricated shell or alternate test frontend.
- The existing `advisor_routing_browser_fixture` example uses mock AuthService and incomplete project/history/evaluation seeds. Retain as backend-backed component fixture, not sole app integration proof.
- Local container access succeeds through rootless Podman. Mongo daemon absent. Use compatible Docker/Podman command subset; no Docker-specific info templates.

## Requirements
- Fresh app/Mongo containers, private network, data roots, session/profile and browser context per test. Initial workers=1; concurrent independent disabled-capture runs cannot collide.
- Normal production server/AuthStore middleware, no `--no-auth`, mock auth, fulfilled app-API responses or injected React state.
- Preauthenticated real persisted admin/session setup only; interactive login/MFA remains an explicitly inventoried gap, not extra scope.
- Deterministic policy, files, valid evaluation docs and controlled fallback model catalog; no personal config, provider credentials or live harness calls.
- Readiness verifies owned services and resolved Advisor home before any policy/evaluation request or mutation. Bounded startup/teardown, including partial startup and cancellation.

## Architecture
- `e2e/fixtures/application-fixture.ts`: extended Playwright fixture with setup/use/finally; yields actual app URL, seed/readback handles and evidence collector. Publication happens only after passing assertions and successful disposal.
- `application-services.ts`: minimal owned-container/network/client-process lifecycle; register IDs on creation, reverse-order cleanup, bounded graceful stop then force/reap. No service framework or shared daemon reuse.
- `application-data.ts`: seeded config/project/home files and exact normal profile/session storage; no frontend stores/preferences/provider/AppState injection.
- Reuse root `Dockerfile` to build a current-source production application image once, and its `server-builder` target for existing canonical Rust libraries/build environment. Add small test-only `e2e/fixtures/application-runtime.Dockerfile`: compile `server/examples/application_e2e_seed.rs` using the builder image; copy only that seed executable into the production application image. Keep production entry/web assets/server unchanged.
- New `.dockerignore` (none exists currently): exclude secrets/dotenv, node_modules, target/build output, .git, images/test reports and plans from build context while preserving actual source/manifests/patches/example needed by the build. Isolated image builds must not ingest personal `.env` or credentials.
- Auth seeder reuses Rust AuthStore/AuthClaims/crypto DTOs to insert enabled admin + valid current session in the owned Mongo DB and sign v2 bearer with the fixture server-token bytes. Runtime-only bootstrap via parent pipe; no new admin HTTP API, fake AuthService or custom JWT implementation.
- Mongo container `docker.io/library/mongo:8.0`: private per-test network, no persistent volume, network alias `mongo`, no host-published Mongo port. App accesses `mongodb://mongo:27017` with unique database name.
- App container: production image + seed executable, no host HOME or `/etc` mounts, no inherited host config. Private `/e2e/home`, XDG config/data/cache/state, TMPDIR, workspace/registry/session SQLite/key/token/logs. Bind server `0.0.0.0:4800` **inside isolated container**, publish only `127.0.0.1:<engine-assigned port>:4800` on host. This is loopback-only exposure, not a globally exposed development server.
- Start app container with a fixture-controlled PID1 shell/sleep and existing `/bin/sh` entrypoint override; copy deterministic seed tree into its writable layer; run seeder, then `docker exec` the actual production server with explicit `--config /e2e/dam-hopper.toml --workspace /e2e/workspace --host 0.0.0.0 --port 4800 --web-dir /opt/dam-hopper/web`. Exec wrapper is owned; container removal handles server/PTYS with independent process groups. No host bind-mounted mutable files/permission/SELinux dependency; data dies with container.
- Explicit backend env: HOME/XDG/TMPDIR, MONGODB_URI/database, MFA-key path; no inherited DAM_HOPPER/RUST_ENV/API endpoint/provider auth env. Sandbox cwd; no dotenv input. Create real registered project/files and set explicit session DB path. Confirm `/etc/dam-hopper/host.toml` absent/controlled and Advisor's reported resolved root is `/e2e/home/.evcrate/advisor-history` before domain operations.
- Fresh browser `storageState` seeds only `damhopper_server_profiles`, `damhopper_active_profile_id`, `damhopper_profile_auth_v2_<UUID>`. Profile UUID v4, `authType: basic`, `autoConnect: true`, URL = published app origin; auth record `{version:2, serverUrl:<same origin>, authType:"basic", token:<valid JWT>}`. Normal production bootstrap restores profile, authenticates and connects WS. Seed no other local state.
- Models: installed production image contains no real omp/pi/codex/claude harness; sanitized PATH ensures HARNESS_NOT_FOUND → real built-in fallback API. Choose actual returned dropdown models and assert fallback source. Only add protocol-correct external CLI shims if a future harness-specific scenario needs them; not required now.
- Evaluations: real directory `/e2e/home/.evcrate/advisor-history` is required for capabilities (may be empty). Valid JSON evaluation docs go in `/e2e/home/.evcrate/advisor-evaluations`, **not advisor-history**. Copy canonical fixtures; use returned source revisions/list bindings, not fabricated descriptor digests. Policy goes in `/e2e/home/.evcrate/advisor-routing.json`; enablement starts false in registry.
- Readiness: Mongo ping; seed completion; server exec remains alive + real HTTP `/api/health`; unauthenticated protected request rejected, authenticated `/api/auth/status` admin/protocol and `/api/advisor/status` safe root. Fetch real SPA; browser shell/project/WS ready. The production “Listening” log precedes bind; not sufficient readiness. Internal fixed port + engine-published dynamic host port avoids production port-0 limitation.
- Independent policy file read via owned container exec (not rendered UI), plus separate authenticated API read. Seed/output identity tied to image build source fingerprint; current-source labels checked before reuse, not binary/image existence alone.

## Related code files
- Create `packages/ui/e2e/fixtures/{application-fixture,application-services,application-data}.ts`, `application-runtime.Dockerfile`, `server/examples/application_e2e_seed.rs`, `.dockerignore`.
- Reuse root `Dockerfile` and `__fixtures__/native-advisor/{advisor-routing.json,advisor-evaluations/}`. Extend fixture docs only if compatible pair/long-ID layout data absent.
- Modify UI E2E build/run scripts for current-source production/seed image prerequisites. Production source/entry/routes remain unchanged.
- Retain mock-auth example and Vitest specialized config in component scope.

## Implementation Steps
1. Build current-source production/server-builder/test runtime images once with clean context and source labels. Check runtime/browser/container prerequisites before test-owned services. Container build caches allowed; unrelated live service reuse forbidden.
2. Register unique network, Mongo and app container IDs immediately when created. Start/ping Mongo; create/copy complete `/e2e` seed tree, keys, registry, project/files and explicit session DB path.
3. Seed real Mongo admin/session via canonical Rust DTOs; normal auth claims match DB account/session versions and exact expiry/MFA freshness. No personal database defaults.
4. Exec actual server; validate HTTP ownership/auth/protocol and controlled effective Advisor home before opening domain data. Launch fresh page at same-origin actual SPA with documented profile/auth storage only.
5. Select fixture project/settings owner and enable Advisor via real controls. Data/preferences changes use normal application handlers/files, not direct Zustand mutations.
6. Expose narrow independent readback helpers; avoid credentials and absolute temp paths in reports/captures.
7. After `use`, close browser contexts/WS and explicitly stop owned PTYs if created; stop/reap exec, gracefully stop/remove exact app+Mongo containers and network; delete host staging temp root. Container namespace provides final descendant cleanup even for PTYs outside server's group. Teardown error fails run; no unrelated prune/pkill.
8. Handle signals through awaited teardown, not asynchronous Node exit callbacks. Parent/service early exit and startup timeout dispose resources already created. Remove signal handlers/ownership records after disposal.
9. Only after functional success + cleanup publish staged evidence. Execute L01–L06 and current-source/repeatability checks using temporary probes, then remove probes.

## Todo list
- [ ] Production app/seed images with clean context and controlled effective home.
- [ ] Per-test app+Mongo+network lifecycle and real authenticated bootstrap.
- [ ] Deterministic correct policy/evaluation/history/project seeds and model fallback.
- [ ] Readiness/partial-failure/cancellation/cleanup proof.

## Success Criteria
- A02/A03/A07, L01–L06 pass against normal production app/backend processes.
- Effective-home probe confirms fixture-owned root before policy/evaluation reads/writes; poison inherited config cannot reach host data.
- Actual built SPA, real API/WS/auth/session/database/filesystem used; protected unauthenticated request rejected; seed bootstrap not claimed as login/MFA testing.
- Repeat/order-independent tests start from deterministic original data. Authenticated API and container-file readback prove persistence.
- Normal exit, failures, startup timeout and SIGINT/SIGTERM remove exact owned containers/network/process wrappers/temp roots. Capture publication waits for cleanup.

## Risk Assessment
- Container build/engine prerequisite: reuse existing production Dockerfile/base pins and caches; clearly fail preflight, never fall back to mock auth.
- Effective HOME override: container `/etc` is controlled; assert safe resolved root, rather than relying only on env.
- Image/source skew: fingerprint at image build/start/finish; relevant drift invalidates run/evidence.
- Auth/schema drift: canonical Rust seed types plus exact endpoint-bound browser storage; no auth implementation fork.
- SIGKILL/host death cannot execute finally: targeted recovery from recorded owned IDs; no impossible crash-cleanup guarantee.

## Security Considerations
Only app port published to host loopback. No host-home/etc/database mounts or inherited credentials; Mongo network private. Runtime auth keys/storageState never committed/uploaded. Remove only owned resources; container client may use its normal engine configuration, but application data/config isolation remains strict.

## Next steps
Phase 03 navigates actual application journeys; Phase 04 captures/reviews evidence. Unresolved questions: none blocking design; container strategy resolves host-home and actual bound-port limitations without production testing bypasses.
