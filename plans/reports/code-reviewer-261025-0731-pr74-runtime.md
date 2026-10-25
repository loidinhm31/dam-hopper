## Code Review Summary — PR #74 Runtime

### Scope and validation
- Compared `45a51efe43ef6024dbd875d2498b456a7d4db110` → `b031e6a40123d8c5169012e0b736ac8c4f1f6091`; runtime/release slice only.
- Inspected `server/src/semantic/{session,supervisor,child,framing,launch,reaper,resources,tool_profile}.rs`, `resources/linux.rs`; changed `server/src/{main,state,lib}.rs` and Cargo dependency sections; semantic settings/WS/gateway admission callers; Linux release inventory changes; staging/provenance/manifest/archive/asset-check code; PR quality workflow and qualification runners.
- Supporting evidence: `.github/workflows/release-linux.yml`, `tests/deploy/linux-release-package-twice.sh`, Windows archive builder, selected supervisor/TSLS/auth-containment tests, requirements/deployment/protocol docs.
- Code-review skill read directly from installed `SKILL.md`. Approximately 7,000 relevant source/script lines inspected; no numerical coverage claim.
- Static review only. **No builds, tests, linters, formatters, installation, or runtime reproductions executed.** Only this report written; no source/test/CI/plan changes.
- Pinned dependency identity checked by `sha256sum`: local TSLS `cli.mjs`, TS `tsserver.js`, `_tsserver.js`, and `typescript.js` match PR constants. Read those matching implementations, not generic/master TSLS documentation.

### Overall assessment
One P1 release-delivery defect and three P2 lifecycle/admission defects. No P0 identified. Process-group cleanup and sanitized environments are lifecycle/resource controls, not filesystem sandboxes; the documented trusted-workspace limitation is not itself a finding.

### R1 — P1: Official Linux release path never includes the semantic engine
- **Changed location:** `deploy/release/build-release-archive.sh:223-226`.
- **Confidence:** Conclusive static integration defect; published archive not generated/inspected during review.
- **Trigger:** Normal stable release through the checked-in Linux publisher, on a fresh installation without a separately provisioned engine.
- **Evidence chain:** Builder defaults to empty `SEMANTIC_ENGINE_DIR` and `STAGE_SEMANTIC_ENGINE=0` (`:16-17`); the new copy/stage block runs only on explicit opt-in. `.github/workflows/release-linux.yml:170-210` downloads Rust/web artifacts and invokes `pnpm release:package-twice` without engine staging, semantic arguments, or semantic environment. `tests/deploy/linux-release-package-twice.sh:69-76` calls the builder with only version/binaries/web/output/epoch. No earlier engine artifact/staging step exists in that job. `check-release-assets.mjs:56-68,320-326` does not require engine entries, so omission passes the asset gate.
- **Consumer impact:** The advertised supported Linux release cannot enable semantic navigation. `tool_profile.rs:319-333` resolves release-local or `/opt/dam-hopper` engine paths; missing Node fails `verify_integrity` at `:378-382`, then `supervisor.rs:583` / settings `prepare_enable` rejects enablement. This contradicts `docs/deployment-guide.md:24` promising the bundled tuple for server/both installations.
- **Smallest correction:** Stage the pinned tuple in the publisher using verified build-time retrieval; pass its directory through the package-twice path to both builds (the existing exported environment input is also available). Require essential engine inventory entries for new server-capable releases. Merely enabling the stage flag is insufficient on fresh CI because its default inputs are developer-local paths.
- **Suggested safe reproduction — not run:** Execute the existing package-twice invocation with temporary output and matching already-built inputs, semantic environment unset; inspect tar/inventory for `lib/semantic-engine/node`. Install/run only in a disposable release root and attempt authenticated admin enable; expect missing-toolchain rejection. No production service changes needed.

### R2 — P2: Opening another file revives an exhausted session without replaying existing dirty overlays
- **Changed location:** `server/src/semantic/session.rs:1083-1084`.
- **Confidence:** Conclusive static state-transition defect; end-to-end navigation manifestation not executed.
- **Trigger:** Keep dirty document A open; exhaust two automatic restarts within 300 seconds; after the next child exit, open previously unopened document B on the same semantic socket.
- **Evidence chain:** `handle_child_exit` drops the child but preserves `self.overlays` (`:1687-1704`); after budget exhaustion it returns in `Crashed` without revoking the session (`:1728-1736`). Gateway remains `Ready`, accepts B, and forwards `did_open` (`gateway.rs:900-909,997-1011`). The highlighted `child_handle.is_none()` branch calls `do_initialize` regardless of crash budget/state. `do_initialize` sets `Ready` (`session.rs:1038-1051`), then `do_did_open` sends only B (`:1122-1139`). Existing-overlay replay exists only in the automatic-restart path (`:1766-1802`), not this path.
- **Consumer impact:** A new child runs without A's unsaved text while the actor/gateway still retain A's accepted overlay/version. Navigation from A can fail as unopened; dependency analysis involving A can use disk text rather than the authoritative dirty buffer. The restart budget/backoff is bypassed too. No daemon restart or malicious plugin is required.
- **Smallest correction:** Route all replacement-child initialization through one budgeted recovery path that completes full overlay replay before admitting document/navigation work, or reject this lazy restart once the original session is terminal and require a fresh session. Preserve legitimate initial lazy startup.
- **Suggested safe reproduction — not run:** In a disposable packaged-toolchain fixture, open dirty A differing from disk; kill only its recorded child process group, allowing two automatic recoveries, then kill the third child. Open B without editing A again. Assert either terminal rejection or that the replacement child receives A's full `didOpen` before B/navigation. Query A and an import from B to A to distinguish overlay results from disk results.
- **Evidence gap:** `server/tests/semantic_supervisor.rs:620-672` checks new PGID, `Ready`, and retained actor overlay counts after one restart; it does not prove replacement-child replay or exhausted-budget behavior.

### R3 — P2: Initialized sessions with no documents never start idle eviction
- **Changed location:** `server/src/semantic/session.rs:1049-1051`.
- **Confidence:** Conclusive static missing lifecycle transition.
- **Trigger:** Two distinct authenticated semantic connections attach/initialize, send `initialized`, never open a document, and retain their sockets with periodic Ping frames.
- **Evidence chain:** Actor spawn initializes a timer token but schedules no timer (`:564-599`). Successful initialization directly sets `Ready` at the highlighted lines. Its initialize response is consumed inside `do_initialize` (`:983-1036`), so it does not reach ordinary response handling. `check_schedule_idle_timer` is called only by `didClose` (`:1223`) and ordinary navigation-response handling (`:1530`). The timer itself implements the documented zero-document/zero-request condition (`:1811-1823`). Pings keep the independent WS inactivity deadline alive (`semantic_ws.rs:683,733-736`) but do not arm actor eviction.
- **Consumer impact:** Empty sessions retain both globally available tree slots indefinitely; another legitimate client receives `GLOBAL_TREE_LIMIT` despite both sessions satisfying the promised 60-second idle condition. Recovery requires disconnecting the slot holders or administratively disabling semantics.
- **Smallest correction:** Arm/re-evaluate idle eviction after successful initialization/replay when document and request counts are zero; retain cancellation on valid document/request activity.
- **Suggested safe reproduction — not run:** Against a disposable enabled server, initialize two sockets with distinct connection/session identities, keep each alive using Ping every 20 seconds, and wait over 60 seconds without `didOpen`. Verify slot cleanup and admit a third initialized socket. Current static path retains both slots. Assert registry/tree release, not only elapsed time.

### R4 — P2: WebSocket upgrade authentication lacks the two-second store deadline
- **Changed location:** `server/src/api/semantic_ws.rs:260`.
- **Confidence:** Conclusive static missing application deadline; backend-specific delay not measured.
- **Trigger:** A correctly signed bearer/cookie token reaches semantic upgrade while its authentication-store read is stalled or slow.
- **Evidence chain:** The highlighted call directly awaits `evaluate_claims`. `auth/mod.rs:141-169` directly awaits session and user store reads with no enclosing deadline. The new WS route belongs to the public router (`api/router.rs:86-95`); final router layering adds body limits/CORS, not a timeout (`:596-623`). The two-second settings-auth middleware applies only to `/api/semantic/settings` (`:587-595`), and the semantic live watcher starts only after upgrade. Presence admission is reserved only after the store evaluation (`semantic_ws.rs:321-335`).
- **Consumer impact:** Semantic connection establishment waits beyond the documented two-second fail-closed bound and retains pending handlers outside presence accounting while the backend is stalled. This is an availability/deadline defect, not authentication bypass; database-driver timeouts may eventually terminate the wait.
- **Smallest correction:** Wrap the complete `evaluate_claims` operation in `AUTH_STORE_LOOKUP_TIMEOUT`, returning HTTP 503 `AUTH_UNAVAILABLE` on expiry, consistent with the settings boundary. Do not claim this alone bounds outstanding backend work: already-started SQLite blocking tasks survive future cancellation.
- **Suggested safe reproduction — not run:** Reuse the disposable Mongo stall-proxy pattern in `server/tests/semantic_ws_auth_containment.rs:914-958`: establish valid credentials, stall only fixture DB replies, then initiate a new semantic upgrade using the required subprotocol. Bound the external client at three seconds; assert HTTP 503 around two seconds, release the stall, and clean up. Existing live-watcher tests do not cover this pre-upgrade await.

### Positive observations and remaining coverage
- Fresh enable/launch/restart integrity checks are off-thread and serialized by a permit retained inside hashing; diagnostics do not authorize from cached success (`supervisor.rs:149-179`).
- Child terminal status has a separate watch channel; teardown does not depend solely on a saturated stdout queue (`child.rs:118-130,315-319,476-481`).
- Matching TSLS 6.0.2 uses the explicit valid TS path before workspace discovery (`cli.mjs:25506-25527`); child fork is non-detached and patches descendant `NODE_PATH` (`:20152-20175`). Fixed init owns plugins/ATA options. Pinned TS validates plugin names and keeps local probe paths disabled without the flag; no source-backed plugin-loading bypass established.
- Windows semantic execution is explicitly deferred. Unix-specific dependencies/signals are guarded; no conclusive new Windows packaging regression identified by static inspection.
- CI stages the real tuple for Linux tests/E2E, but normal `cargo test` does not run ignored `live_semantic_navigation_qualification` (`semantic_resource_qualification.rs:1761-1763`). Historical qualification reports were not treated as current verification.
- Type coverage, test coverage, lint counts: not measured. Recommended verification belongs to Main after synthesis; all reproductions above remain unexecuted.

### Unresolved questions
- No blocker to these static findings. Actual release-archive absence, exact recovery responses, idle elapsed behavior, and backend stall timings remain unexercised under the read-only/no-tests assignment.
