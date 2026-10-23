# Phase 05 — Authenticated Semantic WebSocket Gateway

## Context links

- Parent: [current policy and ledger](./plan.md#validation-summary).
- Direct dependency: [Phase 04 session supervisor](./phase-04-semantic-session-supervisor.md); transitively [Phase 01 wire/feasibility gates](./phase-01-protocol-dependency-real-process-spike.md#architecture) and [Phase 03 enforced initial bounds](./phase-03-pinned-tool-provisioning-and-resource-controls.md).
- Current sources: [router](../../server/src/api/router.rs), [WS upgrade/Origin/live auth](../../server/src/api/ws.rs), [auth actor/claims](../../server/src/api/auth.rs), [auth evaluation](../../server/src/auth/mod.rs), [filesystem resolution](../../server/src/api/fs.rs), [sandbox](../../server/src/fs/sandbox.rs), [rooted secure paths](../../server/src/fs/secure_path.rs).
- Planning ADR: [filtered profile](../reports/brainstorm-260901-1000-lsp-server-integration.md#websocket-and-json-rpc-profile), subject to current parent policy and Phase 01 GO evidence.

## Overview

- Date: 2026-10-23
- Description: Expose the isolated filtered semantic protocol with exact current auth/Origin policy, live fail-closed invalidation, bounded independent cleanup and bidirectional URI containment.
- Priority: P1
- Implementation status: Pending (0%)
- Review status: Pending
- Effort: 28h
- Direct dependencies: 04.
- Estimate rationale: historical 20h omitted complete live-auth parity, slow-consumer-independent cleanup, precise version-extension/one-kind sync and hardened URI/result mediation.

## Key Insights

- Canonical route `/ws/semantic/v1`, exact subprotocol `dam-hopper.semantic.lsp.v1`; no aliases, current `/ws` kind-envelope multiplexing or shared PTY/FS queues.
- Current WS policy is richer than JWT validity at upgrade: server-store session/account/credential checks, MFA/deadline/expiry, revocation and backend failure matter throughout the socket lifetime.
- Current watcher polls every5s and bounds store lookup at2s, but currently awaits close-message enqueue before cancellation. Reuse its authorization decisions, not its potentially blocking cancellation order. No unconditional five-second teardown promise.
- Ordinary authenticated User accounts may use enabled semantics. Current-admin authority is required for global mutations in Phase 06, not for every navigation request.
- Server child filesystem authority is unchanged; canonical URI/result containment protects the API/navigation boundary, not an OS sandbox.

## Requirements

- Reuse current query-token-over-cookie precedence, V2 claim decode/evaluation and exact Origin predicate. With Origin present require exact allowlist; without Origin current `/ws` permits query-token or explicit development no-auth, not cookie-only. Never broaden this for a semantic/native topology.
- Match initial MFA-required, full-login-required/revoked/expired/disabled, unavailable-backend and presence-admission decisions; keep credentials out of logs/URLs beyond the existing redacted auth transport policy.
- Live watcher mirrors `server/src/api/ws.rs:518–619` policy: every5s with2s bounded store query; account enabled, session/user presence, revoked status, captured/session/user auth-version, credential-version, effective deadline, fresh MFA deadline and expiry. Missing required store, store error/timeout or failed check is fail-closed.
- On auth invalidation, revoke semantic admission and signal session/tree cleanup before any socket/channel send. Close/status delivery is best effort with bounded queue/send deadline; a slow consumer cannot retain pending work, overlays or descendants.
- Total cutoff evidence separates polling delay, bounded lookup, scheduling and cleanup budget. Record actual times at next watcher observation; do not claim teardown within5s from arbitrary revocation.
- Enforce Phase 03 finite frame/header/message/rate/in-flight/queue-byte limits before allocation/admission. Bound upgrade/session reservations, body parsing, output and socket writes independently of existing `/ws`.
- Attach exactly one `{project, worktreePath?, descriptor:"typescript"}` using `AppState::resolve_project_target`; immutable target identity/generation. Unsupported engines create zero children. No client root/engine/config authority.
- Only allow attach, initialize/initialized, didOpen/didChange/didClose, definition/implementation, cancel, shutdown and exit in valid lifecycle order; no transparent proxy, commands, workspace edits, dynamic registration, arbitrary config/filesystem request or plugin bridge.
- Enforce the exact Phase 01 single-kind adaptive sync and explicit required navigation version extension; never advertise two `TextDocumentSyncKind` enum values or a standard LSP document-version acknowledgement.

## Architecture

`api/semantic_ws.rs` owns upgrade/auth/Origin/subprotocol, dedicated reader/writer tasks, live watcher, cancellation token and bounded output. `semantic/gateway.rs` validates the filtered profile, attach lifecycle, extension/capability policy and supervisor calls. `semantic/uri.rs` mediates virtual→child and child→virtual identities/ranges without releasing host paths.

Extract small shared private auth/Origin/live-check decision functions from current WS code only where it prevents policy drift; any new helper is implementation work, not an existing helper assumed available. Preserve existing `/ws` observable behavior. The semantic watcher uses cancellation-first ordering and independent owner cleanup rather than awaiting a close queue; broader `/ws` lifecycle changes are out of this phase's scope.

### Live authorization and cancellation

Capture validated actor/session/auth-version/credential-version/deadline and semantic admission generation on upgrade. Before expensive first-child admission and after asynchronous startup, recheck validity/target/runtime epoch; watcher invalidation immediately revokes that epoch. A pending attach cannot publish ready after revoked auth. Child owner cancellation proceeds even if writer task is blocked; terminate/abort bounded socket tasks separately, without awaiting network delivery to own process cleanup.

Use the current5s recheck cadence and2s query bound. Detection may occur after up to a poll interval plus store/scheduling delay; known effective deadlines can be checked independently. Once invalidation is detected, session teardown uses the enforced Phase 03 cleanup budget. Test/report these stages separately, not a fictitious total five-second guarantee. Development `--no-auth` follows existing isolated WS policy and never grants admin mutation authority.

### URI and method mediation

- Accept only canonical `dam-hopper://semantic/<this-session-target-id>/<encoded-relative-path>` document identities. Reject wrong scheme/authority/session identity, query/fragment, invalid encoding/NUL, absolute/drive/UNC forms, dot traversal, encoded separators and alternative encodings that bypass canonical grammar. Decode once; never repeatedly decode into a path.
- Resolve only a registered live project/worktree. Pin canonical root/identity; use existing rooted secure-path patterns for in-root file validation and recheck target/identity after asynchronous resolution. Reject sibling/removed/stale targets and linked escapes; string prefix comparisons are insufficient.
- Build child `file://` URI internally from authorized canonical paths; never forward client root/workspaceFolders/init options as authority. Rewrite initialize to fixed server-owned root/config/capabilities and the one negotiated sync kind proven by G4.
- Require `params.damHopperDocumentVersion` for Definition/Implementation, validate/capture it with session/document incarnations, then remove that extension before dispatch. Gate requests behind actual child writer FIFO and apply G5 freshness checks; do not invent LSP acknowledgement messages.
- Validate every Location/LocationLink target/origin range and URI; authorize canonical target file before returning a virtual URI. Validate finite zero-based UTF-16 coordinates, exclusive range ends, ordering, result count/bytes and source/destination freshness. For open and unopened destinations, require the G5-proven association of coordinates to exact content/version or validated invalidation-and-requery; current readability or a fresh editor read alone is insufficient. Unproven destination freshness is STOP, not a range-clamping workaround. Preserve authorized multiple results and distinguish null/empty from non-disclosing `outsideTarget`; strip unknown/path-bearing metadata.
- External TS library, package-store, sibling or linked-outside results are omitted with `outsideTarget`, never echoed as file URI, host path or detailed child error. Range reveal remains client-owner/fresh-model fenced.
- Handle only G3-observed required child requests locally, with fixed bounded server-owned configuration replies; reject all unknown request behavior. Suppress unadvertised diagnostics/progress/logs and sanitize safe errors instead of forwarding raw child messages.

Rollback boundary: one route can be removed without changing `/ws`. During implementation the route remains unexposed to child creation until Phases 05–06 authenticated admission and admin controls are complete; default OFF is not the security boundary.

## Related code files

- Modify: `server/src/api/mod.rs`, `server/src/api/router.rs` — one semantic upgrade route, same auth-inside upgrade topology, no alias.
- Modify: `server/src/api/ws.rs` — narrowly extract/reuse current auth/Origin decision logic without semantic traffic in existing channels; preserve `/ws` tests/behavior.
- Inspect/reuse: `server/src/api/auth.rs`, `server/src/auth/mod.rs`, `server/src/auth/policy.rs`, `server/src/fs/secure_path.rs` — actual claim/store/target decisions, not invented authorization helpers.
- Create: `server/src/api/semantic_ws.rs`, `server/src/semantic/gateway.rs`, `server/src/semantic/uri.rs` — dedicated task ownership, filtered contract, strict URI/result mediation.
- Create: `server/tests/semantic_websocket.rs`; modify `server/tests/common/mod.rs` only for real authenticated test setup.
- Delete: none. No native guard bypass, query auth redesign, generic LSP pass-through or command/profile API.

## Implementation Steps

1. Read passed G3–G5/G7 and Phase 03 policy. Map current upgrade and live auth branches, including absent Origin/cookie-only, no-auth dev, presence admission, MFA/revocation/expiry/backend failure.
2. Extract minimal reusable policy decisions with unchanged `/ws` semantics; add dedicated route/subprotocol and bounded upgrade reservations. No capability exposure before auth/target/enablement admission.
3. Apply finite raw frame/message and output bounds before JSON allocation; reject binary/batch/non-object/invalid JSON-RPC and cap request IDs, nesting and retained metadata within the bounded profile.
4. Implement attach-first immutable target and descriptor, passive integrity checks and lazy child creation through the supervisor; revalidate auth/target/runtime epoch around async startup.
5. Enforce exact client message allowlist/lifecycle and fixed child initialization/configuration. Implement single-kind adaptive contract and navigation extension validation/removal exactly as G4/G5 proved.
6. Implement canonical virtual URI grammar, one decode, rooted containment/identity checks and child-only file URI translation. Do not accept arbitrary root/cwd/env/process/init-option fields.
7. Filter every result/range/child error/notification/server request; preserve in-target multi-results, empty result semantics and non-disclosing external denial. Apply destination freshness before reveal.
8. Implement independent watcher and cancellation-first fail-closed auth invalidation. Bound close/status enqueue/send, abort stalled socket tasks and reap child tree without waiting for network writes.
9. Test future real authenticated sockets/bundled processes for all live auth branches, store timeout/error/missing records, full queues/nonreading client, revocation during startup, disconnect, malformed/oversize/rate pressure, traversal/symlink races, stale target/version and external result.
10. Record observed detection versus cleanup stages under load and verify existing `/ws` behavior/queues remain independent. Do not claim runtime evidence in this revision.

## Todo list

- [ ] Reuse exact current upgrade and Origin decisions.
- [ ] Match live account/session/version/MFA/deadline/backend policy.
- [ ] Cancel admission/tree independently before bounded socket close delivery.
- [ ] Enforce finite dedicated framing/rate/queue/in-flight bounds.
- [ ] Implement immutable attach + one-kind sync + stripped version extension.
- [ ] Implement input/result URI/range containment and child request allowlist.
- [ ] Prove real-socket slow-consumer, revocation and zero-tree cleanup cases.

## Success Criteria

- Upgrade decisions match current `/ws`: valid ordinary User can use enabled semantics; invalid/legacy/revoked/expired/disabled/MFA-due credentials and unavailable backend fail correctly. Exact allowed Origin and origin-less query-token/dev rules remain unchanged; cookie-only origin-less handshake rejected.
- After live invalidation is observed, admission stops and every semantic descendant/overlay is cleaned within the enforced lifecycle policy even when close/output queues are full or network writer stalls. Published evidence separates5s polling,2s store lookup and cleanup/scheduling; no unconditional five-second guarantee.
- Revocation/account disable/auth-version/credential-version change, session deletion, deadline/expiry, MFA due, backend failure/timeout, and disconnect during startup cannot publish usable late child/session readiness.
- Valid TS/JS flow yields only current in-target virtual URIs/ranges. Absolute/traversal/double-encoding/encoded-separator, symlink-outside, sibling, unregistered/stale target and external result vectors disclose/open no host path.
- Unknown methods/commands/edits/registration, arbitrary configuration, binary/batches and malformed/oversized/over-rate traffic fail boundedly. Required fixed child replies work; no raw child error leaks.
- Source version/open incarnation and destination freshness prevent stale navigation; ordinary document close leaves unrelated models intact. Semantic pressure never consumes current `/ws`/PTY/FS queues or blocks their cleanup.

## Risk Assessment

- Auth policy drift: share decision functions and preserve existing WS contract tests; do not copy the current send-before-cancel ordering.
- Canonicalization/TOCTOU: use established rooted secure paths plus target identity revalidation, not lexical prefix checks or repeated URI decoding.
- Child requests beyond G3: fail closed and reopen the feasibility gate rather than transparently expanding features.
- Slow consumers: independent cancellation, bounded send deadline and task abort; close notification delivery is not cleanup evidence.

## Security Considerations

- Authentication and registered-target validation are separate. Neither ordinary semantics nor admin role creates a filesystem sandbox; trusted workspaces/server-account authority remain explicit.
- No token URL, source, symbols, raw protocol/stderr, child paths/URI, commands or environment in logs/errors/telemetry.
- Client cannot select engine/executable/root/cwd/env/init options or relax bounds. Native same-origin policy is unchanged and native qualification deferred.

## Next steps

- Phase 06 completes current-admin global ON/OFF authorization across every write path before external release exposure; it does not gate ordinary enabled navigation on Admin.
- Phase 07 consumes the exact filtered protocol; Phase 08 binds repository/owner invalidation. Phase 09 qualifies observed auth cutoff/resource behavior and tunes numbers, not prerequisite safety.
- Validation status: documentation revision only; no build, lint, test, formatter, socket/process execution or auth timing qualification run.
- Unresolved gates: required TSLS replies, exact adaptive/version/destination contract and portable descendant cleanup remain explicit Phase 01 STOP/GO prerequisites.
