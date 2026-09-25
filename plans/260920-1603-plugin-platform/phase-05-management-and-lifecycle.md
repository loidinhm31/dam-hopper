# Phase D05 — Management API and transactional plugin lifecycle

## Context Links

- [Plan](plan.md)
- [D01 package registry](phase-01-package-registry.md)
- [D02 owner runner](phase-02-owner-runner.md)
- [D04 isolated UI host](phase-04-isolated-ui-host.md)
- [Shared activation contract](../../../evcrate/plans/260920-1603-dam-hopper-advisor-plugin/cross-repo-contract.md#package-ui-isolation-and-activation)
- [Repository evidence](reports/repository-analysis.md)
- Existing UI seam: [`SettingsPage.tsx`](../../packages/ui/src/components/pages/SettingsPage.tsx)

## Overview

- **Date:** 2026-09-20
- **Priority:** P1
- **Plan status:** DONE (2026-09-22; 100%).
- **Implementation status:** DONE (2026-09-22; 100%).
- **Review status:** Approved (2026-09-22; Cycle 3; review score 9.8/10; no critical issues). See the [final review](../reports/code-review-260922-2050-phase-d05-cycle3-management-lifecycle.md).
- **Completion timestamp:** 2026-09-22
- **Progress:** 100% (6/6 D05-owned todo items; E04 joint G3 artifact gate deferred).
- **Validation:** 23 Rust tests across four suites passed; 8 UI tests passed; TypeScript compilation reported 0 errors. See the [D05 test/review evidence](../reports/code-review-260922-2050-phase-d05-cycle3-management-lifecycle.md).
- **Dependencies:** G1 and D01–D03 implementations; frozen D04 lifecycle/revocation interface. E04 supplies the reviewed final package for G3. D05 may implement in parallel with D04 after G1; integrated G3 requires completed D04/E03, while G2 does not wait for management polish.
- **Gate contribution:** D05 + E04 prove stage/review/approve/install/update/rollback/disable/remove, crash recovery and final matched package activation at G3.
- **Effort:** Unestimated.

Add root-seeded administration, bearer-only management endpoints and runner-owned transactional lifecycle. Each installation serializes changes; activation publishes package, worker, UI and navigation as one generation. Rollback restores a matched package pair and compatible non-security settings while current security intent always wins.

## Key Insights

- The API is an authorized façade, not a second package/grant registry. Durable lifecycle decisions and transaction journal belong to the owner runner.
- Ordinary authenticated users and MongoDB registration are not administrators. The admin allowlist is configured out of band, defaults empty and is checked for every management operation.
- Cookie-authenticated mutation requires CSRF protection. A smaller safer management surface is bearer-only and explicitly rejects cookie-only requests.
- Package rollback cannot be security rollback. Revoked grants, current disabled intent, actor enablement and new auth/security revisions must survive any package failure.
- UI/navigation must never advertise a candidate whose worker failed health or pair old bytes with a new generation.

## Requirements

### Management authority and transport

1. Seed an exact plugin-admin subject allowlist from root-owned host configuration; empty means deny all. Login, registration, project ownership or package publisher does not imply administration.
2. Mount management endpoints under authenticated API routes but require an Authorization bearer credential; reject cookie-only management requests. If cookie support is later requested, add an explicit origin-bound CSRF design before enabling it.
3. Revalidate enabled actor, admin allowlist and current runner admin/security revision for every stage/approve/grant/binding/lifecycle commit. A stale stage/review token cannot authorize later mutation.
4. Stream `application/gzip` package bodies to D01 bounded chunks with backpressure and independently entered expected SHA-256. Never accept a server filesystem path, URL, latest version or auto-fetch source.
5. Return bounded review data—identity/version/publisher string, digest, contract ranges, capabilities, entries/sizes and requested bindings—without rendering or executing bytes.
6. Audit actor, operation, installation, package digest, old/new generation, security revision and outcome. Redact tokens, package content, source paths and policy/evaluation data.

### Transactional lifecycle

7. Serialize lifecycle per installation and use optimistic security-revision checks. Independent installations may proceed concurrently within global package/process limits.
8. Implement `stage → inspect → approve → drain → revoke → stop → activate worker → health → publish pair/navigation → commit`. Publish only after backend handshake/health and exact UI digest validation.
9. On update, reject new contexts, cancel/drain bounded in-flight work, revoke D03 contexts and D04 frame ports, stop the old worker, then activate the candidate under a new generation.
10. Journal every irreversible phase with transaction/package/generation identities and fsync boundaries. Recovery resumes only unambiguous work; otherwise installation remains unavailable for explicit admin repair.
11. Store the prior matched backend/UI package pair and compatible non-security settings. Rollback may restore only that pair and those compatible settings.
12. Never restore revoked actor/source grants, replaced bindings, disabled intent, admin membership or old auth/security revisions. Persisted current security intent wins even when activation failure races a grant revoke or disable.
13. Before rollback activation and again before publish, reread current security intent. If now disabled, keep both workers stopped and navigation non-executable. If grant/binding changed, activate only under the current valid subset or fail closed.
14. Do not mix old UI with new backend or vice versa. Asset endpoint, worker, navigation and API list expose one activation generation/digest pair atomically.
15. `disable` immediately denies new work, revokes contexts/ports, stops worker and persists across runner/host restart. `enable` revalidates current approved pair, grants/bindings and compatibility before activation.
16. `remove` first persists disabled/revoked state, drains/stops worker, removes installation/package refs only when unreferenced and preserves audit. It never traverses, chmods, chowns or deletes advisor source/data roots.
17. Keep bounded immutable previous package refs for rollback under explicit retention. Never garbage-collect an active, previous, staged-by-live-transaction or recovery-ambiguous digest.

### Operator experience

18. Proposed management routes:
    - `GET /api/plugins/admin` and `GET /api/plugins/admin/installations/:id`
    - `POST /api/plugins/admin/stages` and `POST /api/plugins/admin/stages/:stageId/approve`
    - `POST /api/plugins/admin/installations/:id/{enable|disable|rollback}` and `DELETE .../:id`
    - `PUT /api/plugins/admin/installations/:id/{grants|bindings}` with expected security revision
19. Settings UI shows stage progress, immutable review, expected-digest confirmation, compatibility, generation, grants/bindings, worker health, failure/recovery state and destructive-action confirmation.
20. Ordinary users receive only D03 visible installation states. They cannot infer admin subjects, hidden installations, grants for other actors or package staging detail.

## Architecture

```text
bearer admin request ── API auth + root allowlist ── streamed admin RPC
                                                        │
                                            runner lifecycle mutex
                                                        │
 journal + current security intent ── drain/revoke/activate/health/publish
                                                        │
                                matched backend + UI + navigation generation
```

`LifecycleCoordinator` executes a durable per-installation state machine. `SecurityIntent` (admin revision, enabled intent, grants, bindings) is read separately from `PackagePair` and never copied into rollback snapshots. The API subscribes to revisioned runner events and replaces its in-memory view; it cannot acknowledge a lifecycle commit until the runner's durable commit completes.

## Related Code Files

### Create

- `/home/loidinh/WS/dam-hopper/server/src/plugins/lifecycle.rs` — serialized update/rollback/enable/disable/remove state machine.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/lifecycle_journal.rs` — strict durable phase and recovery records.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/admin.rs` — root-seeded admin subject checks and admin RPC DTOs.
- `/home/loidinh/WS/dam-hopper/server/src/api/plugin_admin.rs` — bearer-only streaming management handlers.
- `/home/loidinh/WS/dam-hopper/server/tests/plugin_lifecycle.rs` — transaction, recovery, rollback/security-race and retention scenarios.
- `/home/loidinh/WS/dam-hopper/server/tests/plugin_admin_api.rs` — bearer/admin/revision/streaming/audit behavior.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/components/pages/settings-page/PluginManagementSection.tsx` — admin stage/review/lifecycle controls.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/components/pages/settings-page/PluginManagementSection.test.tsx` — behavioral admin UI states.

### Modify

- `/home/loidinh/WS/dam-hopper/server/src/api/router.rs` — mount management routes under auth with explicit bearer guard.
- `/home/loidinh/WS/dam-hopper/server/src/api/auth.rs` — expose credential mechanism so management can reject cookie-only requests.
- `/home/loidinh/WS/dam-hopper/server/src/api/plugins.rs` — replace cache on lifecycle revisions and revoke affected contexts.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/registry.rs` — atomic package-pair, enabled-intent, grant/binding and retention commits.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/registry_journal.rs` — hand off initial installation records to full lifecycle journal without a second authority.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/runner_server.rs` — frozen admin-only dispatch and revision events.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/worker_supervisor.rs` — drain/stop/activate/health operations owned by lifecycle coordinator.
- `/home/loidinh/WS/dam-hopper/server/src/state.rs` — compose admin config and ephemeral API façade.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/api/client.ts` — bearer-only admin DTOs and streaming upload progress.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/api/ws-transport.ts` — lifecycle revision/status events.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/components/pages/SettingsPage.tsx` — include management section only for authorized admin state.

### Delete

- None.

## Implementation Steps

1. Add root-owned admin configuration parsing with exact subject matching and default deny. Thread credential mechanism and actor to a reusable bearer-only management guard.
2. Implement streaming stage handler: validate media type/declared length/expected SHA, forward bounded chunks with backpressure, and abort runner stage on client disconnect/deadline.
3. Expose immutable inspection DTO and require explicit approval bound to stage digest, actor and current admin/security revision.
4. Extend the D01 journal into one per-installation lifecycle transaction. Separate `SecurityIntent` from package/non-security rollback data in schema and code.
5. Implement update ordering: reserve transaction, drain/revoke, stop old generation, start/health candidate, validate UI pair, then durable atomic publish and event.
6. Implement failure rollback from the previous matched pair. Reread current security state before spawn and publish; add barriers that force concurrent grant revoke and disable at each failure point.
7. Implement enable/disable/remove and reference-safe retention. All cleanup uses registry-owned roots and descriptor-safe deletion only.
8. Connect runner events to D03 context and D04 frame/nav revocation. API cache replacement is revision-tagged and reconstructible from `plugin.list`.
9. Build Settings management around review-before-approval, typed progress/failure/recovery states and explicit destructive confirmations. Never expose raw owner paths.
10. Import E04's final package through this exact flow and prove matched backend/UI activation, update, failure rollback, disable persistence and recovery for G3.

## Todo List

- [x] Root-seeded empty-deny admin allowlist and bearer-only guard implemented.
- [x] Streaming stage/review/approval preserves independent digest trust flow.
- [x] Per-installation durable transaction publishes one matched generation atomically.
- [x] Rollback preserves current security intent under revoke/disable races.
- [x] Enable/disable/remove/recovery/retention never touch advisor sources.
- [x] Admin Settings surface presents review and lifecycle states safely.
- [-] E04 final artifact passes joint G3 lifecycle scenarios (external joint gate; deferred to G3 qualification).

## Success Criteria

- `cd server && cargo test --test plugin_admin_api --test plugin_lifecycle --test plugin_api_integration --test plugin_runner_supervision` passed 23/23 tests across four suites with 0 failures.
- `pnpm --filter @dam-hopper/ui test PluginManagementSection` passed 8/8; TypeScript compilation reported 0 errors. Cycle 3 review approved D05 at 9.8/10 with no critical issues.
- A candidate health failure concurrent with grant revocation cannot restore the revoked grant; concurrent disable leaves the installation disabled with no worker/frame/nav execution.
- At every observation point, API list, worker, asset bytes and navigation agree on one activation generation or explicit unavailable state.
- Disable survives runner and host restart. Remove deletes only registry-owned unreferenced package/state and leaves source content/owner/mode/size/mtime unchanged.
- G3 uses E04's reviewed final artifact, not the backend-only G1 candidate or a fixture package.

## Risk Assessment

- Lifecycle crashes have many interleavings. Journal identities and idempotent steps must be tested with a failure barrier after every durable transition.
- Bearer credentials can be exposed by UI/storage. Reuse existing authenticated client handling; never place tokens in plugin frame, logs, query strings or package metadata.
- Package and security state can accidentally share rollback serialization. Use separate types/storage fields and prohibit applying a package snapshot to `SecurityIntent`.
- Retention cleanup can race rollback/recovery. Compute references under the registry transaction and delete only immutable digest roots proven unreachable.

## Security Considerations

- A SHA-256 match is integrity only, not publisher identity or code safety. Operator review and explicit approval remain mandatory.
- Same-owner worker code is trusted; lifecycle hardening is not a malicious-code sandbox.
- Management endpoints reject no-auth and cookie-only requests. No CORS or iframe bridge capability reaches them.
- Source roots are never lifecycle-owned. No error/audit record leaks their paths or domain content.

## Next Steps

1. D06 packages the runner/config/runtime, validates service recovery and repeats lifecycle under release upgrade/rollback.
2. G3 freezes the E04 artifact digest, package pair and lifecycle evidence before qualification.
3. Standalone evcrate retirement remains blocked until joint G4; D05 introduces no dual-mode compatibility layer.

## Unresolved Questions

- Actual admin subjects, artifact handoff and independent expected-digest channel are deployment inputs.
- Package retention count/disk budget and audit sink/retention must be chosen before G3; safety rules above do not depend on those values.
- Runner startup must qualify invoking `run_crash_recovery` before accepting management RPC; the coordinator is constructed, but startup invocation remains a D06 recovery check.
- The optional `plugin:lifecycle_revision` UI listener needs a server-emission decision or an explicit-refresh-only contract.
- D06/operator deployment must define ownership and rotation for `/etc/dam-hopper/plugin-admins.json`.
