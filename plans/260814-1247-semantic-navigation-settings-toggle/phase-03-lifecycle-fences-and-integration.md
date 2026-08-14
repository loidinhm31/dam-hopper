# Phase 03 — Lifecycle fences and integration behavior

## Context links
- [Semantic WS handler](../../server/src/api/semantic_ws.rs) — handshake, project/prewarm admission, event loop, authenticated upgrade.
- [Navigation dispatch](../../server/src/api/semantic_navigation.rs) — availability checks, request/result fencing, session admission.
- [Supervisor](../../server/src/semantic/supervisor.rs) — lifecycle generation/workspace epoch/session cleanup.
- [Semantic transport](../../packages/ui/src/api/semantic-transport.ts) — `invalidateSelection`, reconnect, buffered document/prewarm/request handling.
- [Semantic context](../../packages/ui/src/contexts/SemanticNavigationContext.tsx) — pending/result/prewarm cleanup on lifecycle event.
- [Prewarm controller](../../packages/ui/src/lib/semantic-prewarm.ts) and [document controller](../../packages/ui/src/lib/semantic-document-controller.ts).
- [WS integration tests](../../server/tests/ws_semantic_navigation.rs), [transport tests](../../packages/ui/src/api/semantic-transport.test.ts), [prewarm tests](../../packages/ui/src/lib/semantic-prewarm.test.ts).

## Overview/date/priority/status
- Date: 2026-08-14; priority: P1; status: completed (2026-08-14 15:28 +07:00).
- Make off/on transitions deterministic for open semantic clients, in-flight navigation, pending prewarm, and editor results.

## Key Insights
- Existing supervisor cleanup advances generation/epoch and session fences late server responses, but the `WorkspaceChanged` event-loop arm currently does not always invalidate/send to an attached connection when epochs match.
- `SemanticTransport.invalidateSelection()` closes the socket, clears buffered messages, and schedules reconnect; after reconnect, the current project must be reselected and documents replayed only after a fresh handshake/project event.
- Trust policy revisions and descriptor fingerprints are independent safety fences; toggle must not weaken or reset trust records.
- A global toggle must affect all projects/clients on the active server, not just the Settings tab or active editor.

## Requirements
- Disable: atomically stop new semantic admissions, cancel pending prewarm reservations, shut down all semantic sessions, fence in-flight navigation/results, and broadcast a lifecycle event to every semantic client.
- Enable: only after capability validation/config persistence, fence any old client state, broadcast a lifecycle event, reconnect/re-handshake, and admit new work only after current generation/epoch/project/trust checks.
- A late response from before the transition must be dropped server-side and resolved/cleared client-side; no stale target may appear after the switch.
- Existing trust state, revocation behavior, signed-bundle verification, descriptor fingerprints, caps, cancellation forwarding, and authenticated WS behavior remain intact.
- Config reload and workspace switch apply their new semantic bool live and preserve the same fence semantics; no server restart or port contact.

## Architecture
- Use `SemanticSupervisorEvent::WorkspaceChanged { generation, workspace_epoch }` as the existing lifecycle signal. In the event loop, for a current event acquire the lifecycle read guard, call `connection.invalidate_workspace(generation, workspace_epoch)`, send `semantic:workspace_changed`, and let the client reconnect. Keep the lagged-event fail-closed branch and avoid sending events for stale generations.
- A toggle transition changes both lifecycle generation and workspace epoch so old connection contexts fail the existing `fail_closed_for_stale_workspace` checks. This intentionally treats a runtime semantic boundary like workspace replacement while leaving filesystem/config project roots untouched.
- Keep `workspace_context_guard` ordering: API/reload obtains write; WS project/document/navigation paths obtain read. The supervisor lifecycle gate serializes cleanup against session admission. Never enable before the capability check and config write are accepted.
- `handle_project`/handshake report masked `UnsupportedCapability` while off; `handle_prewarm` and navigation continue to use supervisor admission/availability checks. No client-only availability shortcut is authoritative.
- After `semantic:workspace_changed`, the context cancels all pending promises/result store entries, resets prewarm/doc buffers, invalidates transport selection, and reconnects/reselects the current project. Fresh handshake/project availability drives the enabled state; replay only current snapshots.

## Related code files
- Modify: `server/src/api/semantic_ws.rs`, `server/src/semantic/supervisor.rs`, and, only if needed for direct reconnect behavior, `packages/ui/src/api/semantic-transport.ts` / `packages/ui/src/contexts/SemanticNavigationContext.tsx`.
- Test: `server/tests/ws_semantic_navigation.rs`, supervisor lifecycle tests, `packages/ui/src/api/semantic-transport.test.ts`, `packages/ui/src/lib/semantic-prewarm.test.ts`, context/editor browser coverage.
- No changes to bundle producers, trust-store schema, project configuration, or Java support.

## Implementation Steps
1. Add/verify supervisor transition cleanup and lifecycle signal payloads; confirm all admission paths read the mutable gate.
2. Fix the semantic event-loop `WorkspaceChanged` arm to invalidate attached connections and send the existing protocol event exactly once per valid transition.
3. Exercise off with an active session and in-flight navigation: verify session shutdown, pending cancellation, generation/epoch advancement, and no late response.
4. Exercise on: verify the client reconnects, handshakes with ready availability, reselects the current project, replays current documents, and can prewarm/navigate.
5. Exercise no-bundle state: handshake remains unsupported, Settings remains disabled, and direct WS messages cannot create a session.
6. Exercise trust/revocation around toggles; trust records remain and revoked projects still fail after re-enable.
7. Exercise workspace switch/reload races with a simultaneous toggle; assert serialized final TOML/runtime state and no stale result.

## Todo list
- [x] Immediate WS lifecycle invalidation/broadcast.
- [x] Server late-result and prewarm fencing tests.
- [x] Client reconnect/reselect/replay test.
- [x] Active session off/on integration test.
- [x] Toggle + trust/revocation/config-switch race coverage.

## Success Criteria
- Off transition leaves zero semantic sessions/pending prewarm and no visible stale target/result.
- On transition admits new semantic work only after a fresh generation/epoch handshake.
- Existing auth, trust, bundle signature, project sandbox, and resource limits pass unchanged tests.
- Workspace switches and config reloads cannot re-enable an old setting through stale state.

## Risk Assessment
- Closing a socket can trigger reconnect while a toggle is still being persisted; hold the workspace write guard through persistence and reconfigure, then emit one event.
- A broadcast receiver can lag; preserve fail-closed invalidation and test it rather than attempting replay from stale state.
- Reusing workspace epoch for runtime toggles may cause extra editor reconnects; this is intentional for safety and bounded to semantic clients.

## Security Considerations
- Treat every transition as policy/lifecycle change; retain generation, epoch, trust revision, descriptor fingerprint, and current-selection checks.
- Do not trust UI disabled state; every WS admission/result path must enforce the server gate.
- Ensure unauthenticated semantic upgrades remain rejected and no event reveals workspace paths or bundle commands.

## Completion record
- **Completed:** 2026-08-14 15:28 +07:00.
- **Evidence:** mutable gate transitions fence generation/epoch, clean sessions/prewarm state, invalidate attached semantic WS clients, and preserve trust/bundle/auth checks; full Rust suite passed (813, 1 ignored).
- **Residual:** live browser and signed-bundle reconnect/editor validation remains incomplete; production port `4800` was not contacted.

## Next steps
- Phase 04 adds complete API/config/UI/browser regression coverage and runs validation/review gates.
