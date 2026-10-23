# Phase 08 — Lifecycle Invalidation and Recovery

## Context links

- Parent authority: [latest validation and ledger](./plan.md#validation-summary).
- Direct dependencies: [Phase 04](./phase-04-semantic-session-supervisor.md), [Phase 05](./phase-05-authenticated-semantic-websocket-gateway.md), [Phase 06](./phase-06-global-hot-toggle-and-unsafe-override-gate.md), [Phase 07](./phase-07-shared-monaco-semantic-client-and-navigation.md).
- Prerequisite contracts: [Phase 01 stop/go](./phase-01-protocol-dependency-real-process-spike.md), [Phase 03 initial enforced bounds](./phase-03-pinned-tool-provisioning-and-resource-controls.md); no dependency on completed Phase 09 measurements.
- Repository: [workspace mutation](../../server/src/api/workspace.rs), [config reload](../../server/src/api/config.rs), [settings import/cache reload](../../server/src/api/settings.rs), [worktree lifecycle](../../server/src/api/git.rs), [target resolver](../../server/src/workspace_target.rs), [live WS auth](../../server/src/api/ws.rs), [owner runtime](../../packages/ui/src/api/connections.ts), [editor store](../../packages/ui/src/stores/editor.ts).

## Overview

- Date: 2026-10-23
- Description: Retire exact semantic owner/target/document bindings at every lifecycle boundary; recover only through fresh authorization without losing or leaking dirty local models.
- Priority: P1
- Implementation status: Pending (0%)
- Review status: Plan reconciliation completed; implementation and runtime qualification not run.
- Effort: 20h, provisional; increase covers live auth/backpressure, document-versus-session scope, and replacement-owner/dirty-replay races.

## Key Insights

- Stable path/profile ID alone is not authority. Endpoint/root `ResourceBinding`, actor/session validity, target generation, connection generation, semantic session, and model incarnation must still match.
- Retiring a wire session drops its server overlays, not local editor tabs/models. Reconnect replaces server-issued session-target URI without rekeying a retained dirty model.
- `didClose` retires one document; socket/session closure retires all its overlays/requests and its child tree. Closing a view or changing the active tab is not automatically closing that document.
- Current `/ws` auth watcher rechecks on a 5s interval with a 2s store timeout. This is not an unconditional 5s teardown guarantee; semantic cancellation/admission cutoff must happen independently of socket close-message delivery.
- Phase 06 owns admin mutation authorization across dedicated/raw/import/shared writes. Lifecycle integration must consume that same policy, not create a bypass or silently elevate `--no-auth`.

## Requirements

- Retire affected semantics on socket loss, logout/credential replacement, disabled/deleted account, revoked/deleted session, auth-version/credential-version mismatch, MFA/deadline/expiry, auth-store error/timeout, global OFF, workspace init/switch, config reload/import/cache reload affecting target/policy identity, target/worktree removal or identity change, profile endpoint rebind, and server shutdown.
- Re-evaluate current role for privileged global writes through Phase 06. Role demotion denies subsequent mutations; a still-valid ordinary User may keep enabled navigation. Do not revoke all navigation merely because Admin became User unless auth/session policy independently invalidates that session.
- Invalidation stops affected admission and fences results before root/config replacement becomes visible. Child cancel/drain/reap uses Phase 03 finite bounds without waiting for Phase 09.
- Auth/backend failures cancel semantic work and clear overlays fail-closed even with a non-reading socket peer; bounded writer notification is best effort, not a prerequisite for termination.
- Recovery requires ready captured owner, same authorized endpoint/root/target and actor, global enabled, supported language, and fresh attach/init/full replay. Reconnect is never inherited authority.
- Preserve local dirty text/model object, undo/view state, and tab identity on matching reconnect. Replay only currently open models of that exact owner/endpoint/root/target; never replay retained dirty text to an edited endpoint or different identity.
- Every callback/timer/promise/dispose/reveal captures exact owner and resource handles. Retired cleanup cannot clear a new session's status, close a replacement socket/model, overwrite new content, or navigate a new target.

## Architecture

Use one supervisor scoped invalidation API for `all`, owner/session, target generation, and document incarnation. Synchronously close admission/increment the relevant generation first; cancel independent tasks and drain/reap outside inner config/filesystem locks. `workspace_context_guard` serializes identity-changing workspace/config mutations; preserve lock ordering and do not await socket sends while holding mutation authority.

Document retirement sends `didClose` only for that matching wire URI/incarnation, cancels that document's work, and releases its overlay. Session remains alive for other open documents; when no work remains the existing finite idle policy may retire its tree. Whole-session retirement cancels all documents and reaps the affected TSLS/tsserver descendants. Global OFF and shutdown use the same drain path.

Client uses Phase 07 stable local registry plus replaceable wire bindings. Server/profile/auth changes revoke the wire binding and pending reveal work immediately. A newly authorized matching session snapshots current open models, full-replays them with new wire bindings, serializes intervening edits, and becomes ready only through the proven Phase 01 version fence. Closed/foreign/retired models are excluded. Endpoint/root/actor mismatch retains local drafts as unavailable and follows the existing explicit rebind flow, never an automatic upload.

Failure boundary: semantic teardown failure cannot keep old authority alive or block terminal/filesystem/save/workspace operations indefinitely. Force-kill/reap within declared grace/force deadlines; retain explicit invalidated/unavailable state if recovery fails.

## Related code files

- Modify: planned `server/src/semantic/supervisor.rs`, `session.rs`, child-owner modules from Phases 02–04 — scoped revocation, exact generations/incarnations, shared drain/reap path.
- Modify: `server/src/api/workspace.rs`, `config.rs`, `settings.rs`, `git.rs` — revoke before identity-changing workspace/config/import/cache/worktree publication; route global semantic mutations through Phase 06 policy.
- Modify: planned semantic gateway from Phase 05 and `server/src/api/auth.rs` only where needed to share bounded auth evaluation; do not copy blocking-send-before-cancel behavior from `ws.rs`.
- Modify: `server/src/main.rs` — semantic admission stop and tree teardown in existing shutdown order.
- Modify: planned `packages/ui/src/api/semantic-client.ts`, `lib/semantic-monaco.ts`, `stores/semantic-navigation.ts` — exact-handle invalidation and full matching replay.
- Modify: `packages/ui/src/api/connections.ts`, `server-config.ts`, `transport.ts`, `packages/ui/src/components/organisms/EditorTabs.tsx`, `MonacoHost.tsx`, `packages/ui/src/stores/editor.ts` where lifecycle signals/model retention need integration.
- Modify: `server/tests/project_worktree_lifecycle.rs`, `workspace_targets.rs`, `settings_import_export.rs`, planned semantic process/supervisor/WebSocket suites, and relevant auth suites — real changed-boundary behavior.
- Modify: `packages/ui/src/api/semantic-client.test.ts`, existing `EditorTabs.test.tsx`, `MonacoHost.test.tsx`, `packages/ui/src/stores/editor.test.ts`, planned browser navigation suite — replacement-owner, close/reopen, and dirty recovery behavior.
- Delete: no local editor data or unrelated code; retire only superseded semantic bindings/state.

## Implementation Steps

1. Enumerate scope/reason contracts and monotonic owner/target/session/document incarnations. Implement admission stop/result fencing synchronously; capture exact resources for asynchronous drain and remove only if registry entry still matches.
2. Wire workspace init/switch and identity-changing config reload/import/cache reload under the existing guard before resolver/root publication. Preserve/reject protected global fields according to Phase 06; unrelated config changes must not erase or mutate runtime policy through omission.
3. Wire target/worktree remove/move/registration refresh. Refresh invalidates only if identity/generation actually changed; no stale canonical path or root fallback survives a removal.
4. Route OFF and daemon shutdown into the same tree cleanup. ON does only integrity/config checks and remains zero-child until authorized lazy use; release engine updates normally restart the daemon, not a hot custom profile rebind.
5. Implement per-document `didClose` separately from whole session cleanup. Close/reopen gets a new document incarnation; stale didClose/cancel cannot remove the replacement document. Keep unaffected documents and sessions alive under normal bounded idle policy.
6. Integrate live auth/session checks matching Phase 05/current policy: account enabled, session existence/revocation, auth/credential versions, MFA/deadline/expiry, backend error/2s timeout. Signal admission cutoff/cancellation before any possibly blocked send, then bound close delivery and drain independently.
7. Refresh authority for global writes through Phase 06 current-role checks, including delayed writes after demotion and no-auth denial. Do not require Admin for ordinary enabled semantic use; reflect role/capability changes without resurrecting invalid sessions.
8. On profile/endpoint/transport/auth change, revoke only the old wire handle and clear its requests/reveal intents. Preserve matching local model text/undo/view state; endpoint/root/actor mismatches remain unavailable and cannot replay automatically.
9. On authorized same-binding recovery, attach/init with fresh session-target URI and versions; full-replay only still-open matching models, including their latest unsaved text. Queue edits during replay in order and require the Phase 01-proven source/destination freshness fence before readiness/reveal.
10. Exercise delayed real-child responses/timers/cleanup through every boundary, including replacement owner A→B, same profile changed endpoint, target removal, close/reopen of same path, and one-document close while another remains open.
11. Exercise non-reading socket consumer, failing/slow auth backend, ignored graceful shutdown, and descendant process failure. Observe admission cutoff, finite tree reap/overlay release, no old navigation, no interference with replacement owner or core operations.

## Todo list

- [ ] Implement scoped admission stop/invalidation/drain with exact-resource cleanup.
- [ ] Wire workspace/config/import/cache/worktree/OFF/shutdown boundaries.
- [ ] Separate document didClose from session/tree teardown.
- [ ] Integrate fail-closed live auth and current-role mutation policy without send-dependent cancellation.
- [ ] Preserve stable dirty models and replay only newly authorized matching owners/targets.
- [ ] Prove old results/callbacks/timers/cleanup cannot affect replacement owners/incarnations.

## Success Criteria

- Each identity/auth/runtime invalidation rejects affected old work before replacement publication and releases its tree/overlays within declared initial bounds; report actual timing, not unconditional 5s teardown.
- Blocked socket output cannot delay admission cutoff or child cancellation. Missing/deleted/revoked/version-invalid/MFA-expired sessions and backend failure fail closed.
- One document close releases only that overlay and its requests; a second document remains navigable. Whole-session close retires all its documents and descendants. Stale close of an old incarnation cannot close a reopened model.
- Same-binding reauthorization/reconnect preserves dirty local model and full-replays current unsaved text into new wire URI before readiness. No closed/other-profile/other-endpoint/other-root model is replayed.
- Old-owner responses, view-ready callbacks, retry timers, cleanup, and reveal intents cannot navigate or dispose replacement owner resources, even when profile/project/path strings match.
- Admin demotion prevents new global writes on every path, while a valid ordinary user can use already-enabled semantics. Import/raw config/cache reload never bypass global control or restore rejected override fields.
- Removed/unregistered target never reconnects; unsupported Rust never spawns. Terminal/filesystem/save/workspace behavior remains independent of semantic failure.

## Risk Assessment

- Guard/drain deadlock: synchronous revocation first, explicit lock order, no socket send or child wait under inner locks.
- Over-invalidation or data loss: scope exact target/document; wire retirement never closes local dirty tabs/models.
- Replayed secrets to edited endpoint: enforce endpoint/root/actor match, not profile ID alone.
- Cleanup races: compare captured registry handle/generation/incarnation before removal; test late cleanup after replacement.
- Role drift: Phase 06 evaluates current role before privileged commit; do not claim database demotion and configuration commit are cross-store atomic.

## Security Considerations

- Fresh auth and target authorization on every new session; trusted workspace child retains server-account filesystem authority. URI/result containment is not an OS filesystem sandbox.
- No custom engine command or host-origin exception at any recovery/config boundary; `apps/native/src/native-server-url.ts` remains unchanged and native remains unqualified.
- Retain unsaved text only in existing local editor memory; semantic layer adds no source persistence or sensitive invalidation diagnostics.

## Next steps

- Phase 09 measures teardown/auth/backpressure/core responsiveness with real deterministic processes and packaged TSLS; Phase 10 drives actual authenticated Linux server + built web only.
- Unresolved spike gates: Phase 01 must prove source-version/destination freshness and stable local/wire identity recovery. Phase 09 supplies final measured timing/resource values; no runtime result is asserted in this revision.
