# Phase D03 — Authorized plugin API and connection-bound contexts

## Context Links

- [Plan](plan.md)
- [D00 contracts](phase-00-contracts-and-feasibility.md)
- [D02 owner runner](phase-02-owner-runner.md)
- [Shared authorization and identity contract](../../../evcrate/plans/260920-1603-dam-hopper-advisor-plugin/cross-repo-contract.md#authentication-grants-and-identities)
- [Repository evidence](reports/repository-analysis.md)
- Existing authority paths: [`auth.rs`](../../server/src/api/auth.rs), [`ws.rs`](../../server/src/api/ws.rs), [`workspace_target.rs`](../../server/src/workspace_target.rs), [`ownership.ts`](../../packages/ui/src/api/ownership.ts)

## Overview

- **Date:** 2026-09-20
- **Priority:** P1
- **Implementation status:** Pending
- **Review status:** Pending
- **Dependencies:** G0, D01, D02, E01 and E02's early real candidate.
- **Gate contribution:** Completes the authenticated API-to-owner-worker path for G1, including denial, cancellation, crash and source-immutability evidence.
- **Effort:** Unestimated.

Expose a narrow REST/WebSocket façade over the runner. The API authenticates the current DamHopper actor, resolves an existing registered project target, and asks the runner to reauthorize current grants/bindings/activation on every invoke. Browser-local ownership identity never becomes server authority.

## Key Insights

- Current WebSocket authentication validates a token but does not retain the actor subject. Plugin sessions require actor plus auth expiry and a revocable connection epoch.
- `WorkspaceTargetResolver::resolve` already defines fresh registered-worktree resolution for the existing `{ project, worktreePath? }` wire target. A plugin route must reuse it rather than inventing IDs, path parsing or fallback behavior.
- Browser `profileId` and connection generation select local transport ownership. The server needs only authenticated actor, project/worktree target and installation ID.
- API state may cache runner snapshots for availability, but only revision-tagged in memory. The runner registry remains the durable authorization/source authority.
- Context creation is not an authorization lease: every invoke must recheck actor/session, grant, binding, activation and generation revisions.

## Requirements

### Authentication and target authority

1. Change WebSocket authorization to retain `AuthenticatedActor.subject`, JWT/session expiry and a random API connection epoch. Bind that epoch to one live socket and revoke it on disconnect, expiry, logout or actor disable.
2. Deny all production plugin endpoints when `--no-auth` is active. Only an explicitly compiled/injected synthetic fixture path may exercise no-auth in scoped tests; it cannot load real packages or owner data.
3. Accept the existing `ServerProjectTarget` wire shape `{ project, worktreePath? }` and resolve it with `WorkspaceTargetResolver::resolve` on context open and before work. Missing, pruned, replaced or unregistered worktrees fail explicitly; do not fall back to main worktree or arbitrary paths.
4. Never accept `profileId`, browser generation, filesystem root, history-context hash or grant claims from the client. Browser retains profile/generation/project ownership locally.
5. Pass the configured target identity plus exact resolved root to the runner. The evcrate worker performs the G0 exact identity checks: absolute normalize, dot-segment rejection, native realpath equality, symlink rejection and exact `historyContext()` hash. Never rehash an alias or silently realpath it.

### Authorization and context lifecycle

6. Model an explicit grant tuple: actor subject, installation ID, configured project target, allowed operations and `allowCurrentAccountPolicy`.
7. `context.open` requires a live matching connection epoch and current enabled actor, installation activation, package generation, binding and grant/security revisions. Return an opaque context ID scoped to actor, API epoch, installation and target.
8. Before every `plugin.invoke`, revalidate enabled actor/session, epoch, grant, binding, enabled intent, activation generation and security revisions against the runner. A cached allow decision is never sufficient.
9. On logout, auth expiry, actor disable, grant/binding change, installation disable/update, project removal, runner reconnect or WebSocket loss, revoke affected contexts and notify the owning client without leaking other actors/installations.
10. Cap 16 contexts per worker with 15 min idle TTL. `context.close` is idempotent. API shutdown/disconnect closes its owned contexts; the runner expires orphaned contexts independently.
11. Apply generic four in-flight invokes per context, 16 per worker, 32 queued and byte ceilings; preserve D02 backpressure and cancellation semantics. Host Rust treats payloads as bounded opaque domain data and never parses evaluation bodies.
12. E02 owns snapshots, one-parse evaluation, history scan/item limits, page semantics and stricter domain budgets (two snapshots/context, 128 MiB aggregate, 5 min TTL, page 100/500 and <=1 MiB, evaluation <=8 MiB). The host enforces only frozen generic frame/context/request/response byte ceilings and forwards typed worker results.
13. `request.cancel` targets only the same actor/epoch/context/request and returns the frozen acknowledgement state. Never replay non-idempotent invokes after API-runner reconnect.
14. Return typed, bounded errors for unauthorized, stale epoch/context, disabled/incompatible/failed installation, target changed, limit exceeded, cancelled, deadline and worker unavailable. Sanitize paths and worker diagnostics.

### Client ownership

15. Add owner-bound plugin methods to the existing `ApiClient`/`WsTransport`; every request captures local connection generation and discards late results after generation change.
16. Route plugin revocation/status events only through the corresponding profile connection. Switching profile/project/worktree closes the old plugin context rather than moving it.
17. List only navigation/installations visible under the current actor and target. Visibility never substitutes for invoke authorization.

## Architecture

```text
UI ConnectionRef(profileId, generation) ── bearer/cookie + live WS epoch ── API
                                                                     │
 existing registered target resolver + enabled actor                 │
                                                                     ▼
                                    runner reauthorization every invoke
                                 grant + binding + activation revisions
                                                                     │
                                                      owner worker context
```

`PluginApiService` coordinates authentication, target resolution and a `RunnerClient`. `PluginContextTable` stores only opaque associations and expiry; it is not an authorization database. Runner list/authorization snapshots carry monotonic registry/security/activation revisions and may be cached only until an event or reconnect invalidates them.

## Related Code Files

### Create

- `/home/loidinh/WS/dam-hopper/server/src/plugins/api_service.rs` — authorized list/open/invoke/cancel/close orchestration.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/authorization.rs` — grant tuple and revision revalidation against runner authority.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/contexts.rs` — epoch-scoped opaque context/request ceilings and revocation; no domain snapshot parser/store.
- `/home/loidinh/WS/dam-hopper/server/src/api/plugins.rs` — typed REST/WS-facing handlers and safe error mapping.
- `/home/loidinh/WS/dam-hopper/server/tests/plugin_authorization.rs` — actors, targets, revisions, no-auth and epoch races.
- `/home/loidinh/WS/dam-hopper/server/tests/plugin_api_integration.rs` — real API/runner/worker G1 slice.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/api/plugin-types.ts` — generated/frozen client DTO surface.

### Modify

- `/home/loidinh/WS/dam-hopper/server/src/api/auth.rs` — expose actor/expiry for HTTP and WebSocket without granting admin implicitly.
- `/home/loidinh/WS/dam-hopper/server/src/api/ws.rs` — retain actor, issue/revoke connection epoch and send plugin status events.
- `/home/loidinh/WS/dam-hopper/server/src/api/ws_protocol.rs` — add bounded plugin lifecycle event variants.
- `/home/loidinh/WS/dam-hopper/server/src/api/router.rs` — mount authenticated plugin routes and explicit no-auth denial.
- `/home/loidinh/WS/dam-hopper/server/src/api/mod.rs` — export handlers.
- `/home/loidinh/WS/dam-hopper/server/src/state.rs` — compose runner client and ephemeral plugin API state.
- `/home/loidinh/WS/dam-hopper/server/src/main.rs` — start/stop runner client and context expiry task.
- `/home/loidinh/WS/dam-hopper/server/src/plugins/mod.rs` — export API authorization/context modules.
- `/home/loidinh/WS/dam-hopper/server/src/workspace_target.rs` — expose existing canonical target result only if needed; do not alter resolution semantics.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/api/client.ts` — add authenticated plugin methods bound to one client owner.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/api/ws-transport.ts` — carry plugin epoch/events and revoke on transport generation change.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/api/query-client.ts` — scope plugin cache keys by connection/project/installation generation.
- `/home/loidinh/WS/dam-hopper/packages/ui/src/api/connections.ts` — destroy plugin contexts with owner connection teardown.

### Delete

- None.

## Implementation Steps

1. Refactor auth extraction so HTTP and WebSocket receive the same enabled `AuthenticatedActor` and expiry. Preserve ordinary no-auth behavior elsewhere, but hard-deny production plugin routes under no-auth.
2. Issue a cryptographically random epoch only after WebSocket auth. Register actor/expiry/socket ownership and revoke it on every terminal transport/auth transition.
3. Implement runner list/authorization queries with monotonic revision tags. Treat reconnect, revision regression or malformed state as total cache invalidation and plugin unavailable.
4. Define REST handlers for visible installations/navigation, context open/close, invoke and cancellation. Apply existing request/body guards before parsing large payloads.
5. Resolve the project target with the existing resolver, then pass exact configured target identity/root. Add no alternate filesystem input path.
6. On open, validate live epoch and current authority, then create an opaque context with generic idle/request/byte ceilings. On invoke, repeat all security checks before admitting opaque domain work.
7. Propagate disable/grant/binding/activation/auth/runner events to selective revocation. Close worker context first when possible; local denial must take effect immediately even if runner is unavailable.
8. Add owner-bound UI client methods and cache keys. Capture `ConnectionRef.generation` and API epoch; discard late responses/events and close on profile/project/worktree changes.
9. Exercise G1 with D01's approved E02 package: real snapshot summary, denied second actor/target, cancellation and forced worker crash through the public API.
10. Record source content/owner/mode/size/mtime before/after the G1 scenario. Any source mutation blocks G1.

## Todo List

- [ ] WebSocket retains actor/expiry and revocable random API epoch.
- [ ] Production plugin endpoints deny no-auth and unregistered targets.
- [ ] Grant/binding/activation/session revisions are rechecked on every invoke.
- [ ] Generic context/request/response ceilings are enforced; domain snapshot/evaluation budgets remain E02-owned.
- [ ] UI transport/cache ownership follows profile/project/generation exactly.
- [ ] Real G1 allow/deny/cancel/crash slice is specified and executable.

## Success Criteria

- Future, proposed: `cargo test --manifest-path server/Cargo.toml --test plugin_authorization` proves cross-actor, cross-target, stale-epoch, expiry, no-auth, grant-revoke, disable and target-replacement denial.
- Future, proposed: `cargo test --manifest-path server/Cargo.toml --test plugin_api_integration` runs a real API, Unix runner and E02 worker; summary succeeds and cancellation/crash settle once.
- An invoke accepted before a grant/security revision change cannot start afterward; an in-flight call is cancelled/revoked under the frozen policy.
- Browser `profileId` and filesystem roots are absent from server DTOs; server-side target resolution remains authoritative.
- Connection loss, logout and profile/project/worktree switch revoke old contexts and late responses cannot populate the new owner's cache.
- G1 evidence distinguishes current existing commands from the proposed tests above and claims no unrun runtime result.

## Risk Assessment

- Auth refactoring can regress ordinary WebSocket clients. Preserve existing channel behavior and isolate epoch additions behind new typed events.
- API and runner revision races can create time-of-check/time-of-use gaps. Runner performs the final current-revision authorization atomically with invoke admission.
- Worker snapshot memory can combine with host frame queues. Enforce independent generic host counters and consume typed worker budget/failure signals without duplicating E02 state.
- Target deletion/recreation may retain identifiers. Re-resolve and compare the configured identity/revision; never trust a context's old root.

## Security Considerations

- Login/registration does not confer plugin-admin status. This phase grants only explicit per-actor installation/target operations.
- Cookies/bearer tokens and API connection epochs never cross into the iframe or worker.
- Errors, metrics and logs omit source paths, tokens, policy/evaluation text and cross-actor installation data.
- `origin` and browser profile labels are not authorization inputs; server actor plus runner authority are.

## Next Steps

1. D04 turns visible installation metadata and owner-bound calls into the isolated UI bridge.
2. D05 supplies bearer-only management and lifecycle events that revoke D03 contexts.
3. Joint G1 must pass before G2 UI integration or G3 lifecycle claims.

## Unresolved Questions

- Production JWT/session lifetime and logout propagation mechanism must be confirmed during G0 so epoch expiry cannot outlive auth.
- Concrete project target/grant records and test actors are deployment inputs; synthetic identities are limited to scoped tests.
