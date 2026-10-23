# Phase 04 — Semantic Session Supervisor

## Context links

- Parent: [current policy and revision ledger](./plan.md#validation-summary).
- Direct dependency: [Phase 03 immutable tools and enforced policy](./phase-03-pinned-tool-provisioning-and-resource-controls.md); transitively [Phase 02 tree owner](./phase-02-lsp-framing-and-child-owner.md), [Phase 01 sync/version and feasibility gates](./phase-01-protocol-dependency-real-process-spike.md#architecture).
- Current sources: [`AppState`](../../server/src/state.rs), [target resolver](../../server/src/workspace_target.rs), [server lifecycle](../../server/src/main.rs), [code standards](../../docs/code-standards.md).
- Planning ADR: [document lifecycle](../reports/brainstorm-260901-1000-lsp-server-integration.md#document-and-navigation-lifecycle), subordinate to the latest parent policy and passed Phase 01 evidence.

## Overview

- Date: 2026-10-23
- Description: Own independent per-connection/target bundled TSLS sessions, bounded unsaved overlays, exact adaptive sync, request freshness and complete-tree disposal.
- Priority: P1
- Implementation status: Pending (0%)
- Review status: Pending
- Effort: 28h
- Direct dependencies: 03.
- Estimate rationale: historical 26h plus explicit document-open/child incarnation and destination-freshness fencing, single-model-close isolation and enforced early bounds.

## Key Insights

- Exactly one semantic tree per semantic connection + immutable target + included `typescript` descriptor. Two connections may open the same file with different unsaved contents and must never share a child or overlay map.
- A numeric document version is insufficient after close/reopen; request identity also includes document-open incarnation, child incarnation, session/target/connection generations and request ID.
- Global ON, Settings load, Explorer scans, file events and unsupported models start zero children. Only an admitted authorized lazy TS/JS session starts one owned tree.
- didClose is document-scoped. Closing one clean model cannot tear down a child or clear unsaved overlays belonging to other models on that session.
- Core server wins: finite admission rejection is preferable to unbounded semantic locks, queues or restarts.

## Requirements

- Supervisor is `AppState`-owned, clone-cheap and disabled by default; no module-global process singleton.
- Explicit states: `disabled`, `idle`, `starting`, `ready`, `unsupported`, `missing-tool`, `incompatible`, `overloaded`, `timeout`, `crashed`, `invalidated`, `shutting-down`, plus precise actual resource capability/qualification facts.
- Preserve attach → initialize → initialized → versioned documents → definition/implementation/cancel → shutdown/exit. Gateway consumes attach; no client-selected launch/config/root authority.
- Consume Phase 03 enforced initial policy, including Phase 01 candidate adaptive threshold. Do not require completed Phase 09 or invent unbounded temporary defaults.
- Use only the exact single-kind adaptive contract proven by Phase 01 G4. Candidate is one Incremental kind with range-less full changes below64KiB and ranged UTF-16 changes at/above based on post-edit full-text UTF-8 bytes. didOpen/replay/resync always full. If G4 fails, STOP and reconcile before implementation.
- Enforce strictly increasing didChange versions per document-open incarnation, full authoritative overlay state, valid UTF-16 ranges, byte/transient reservations and atomic update before dispatch. No partial application on invalid content/range/threshold.
- Use Phase 01 G5 required filtered-profile `params.damHopperDocumentVersion` for navigation, validate/capture it and strip before standard child request. Standard LSP has no such version field or didChange acknowledgement.
- Cancellation, teardown, full output queues and slow socket clients cannot retain children/overlays indefinitely; all lifecycle cleanup is independent of status/close delivery.

## Architecture

`SemanticSupervisor` owns global admission, finite policy, runtime transition coordination, sessions, aggregate status and shutdown. `SemanticSession` owns one immutable server-derived target binding, one child/tree owner, bounded documents and pending maps. `semantic/protocol.rs` contains only the narrow filtered profile and its explicit version extension, not generic LSP pass-through.

Session lifecycle and runtime transition operations serialize through explicit async ownership, without holding core config/PTY/filesystem locks over process I/O. Admission reserves capacity before spawn, rechecks enabled/target/auth epoch after asynchronous startup, and releases exact reservations on every failure. Tests may drive the owner internally, but routes remain unexposed until Phases 05–06 establish authentication, live invalidation and privileged global control; default OFF alone is not authorization.

### Overlay and navigation contract

- Key documents by virtual URI + document-open incarnation inside the immutable session target. Retain full unsaved text in bounded memory only; separate connections never read each other's overlays.
- Compute candidate edit against prior text with validated UTF-16 boundaries, checked UTF-8 sizing, ordered multiple changes, bounded temporary storage and reserved aggregate capacity. Commit overlay/version atomically or reject without mutation.
- Derive full/ranged representation from post-edit UTF-8 size using the passed Phase 01 contract; mode changes never reset version. Server validates representation; invalid range/version/mode invalidates only the affected session generation and requires full replay, not heuristic repair.
- Navigation admission requires version extension equal to the current source overlay, captures every ownership/incarnation fence, and follows all earlier writes through the actual child stdin FIFO. Forwarded child request contains only standard allowed fields; ordering is not an invented TSLS acknowledgement.
- Response publication rechecks source version/open incarnation, child/session/target/connection generations and request ID. Changes to known open destination overlays while navigation is pending invalidate relevant results. For every destination, including unopened files, G5 must prove coordinates associate with the exact destination content/version through demonstrated content association or validated invalidation-and-requery. A fresh authorized editor read alone proves neither coordinate freshness nor TSLS snapshot identity; uncertainty rejects navigation and failure to prove a strategy is STOP. No claim of an atomic snapshot across every project file.
- Child restart/reconnect creates new child/session/wire identity; current matching local models replay full didOpen content before navigation readiness. Old callbacks and pending results are rejected, even when document numeric versions repeat.

### Close and cleanup contract

`didClose` retires only its document incarnation, bytes and pending requests, and sends that close in session order. Other open documents and their dirty overlays remain usable on the same child. Only the last model closing with no pending work enters the bounded idle-eviction timer; the initial policy is60s. New authorized work cancels that exact timer. Idle eviction reaps the full tree and retains no server source text; later use opens a fresh generation/full replay.

Disconnect, global OFF, auth/target invalidation or daemon shutdown immediately stop admission/cancel pending work, drop source overlays and begin bounded full-tree teardown independent of outbound socket delivery. Child crash invalidates all pending work; restart uses the finite per-session budget/backoff, never an infinite retry. Resource/cleanup failure is visible and cannot be erased by optimistic readiness.

## Related code files

- Modify: `server/src/state.rs` — `SemanticSupervisor` ownership/construction and shared transition/admission hooks.
- Modify: `server/src/main.rs` — passive integrity load, default-OFF init, semantic shutdown/reap before core teardown completes; no on-enable/startup protocol probe child.
- Modify: `server/src/semantic/mod.rs` — focused internal exports.
- Create: `server/src/semantic/protocol.rs`, `server/src/semantic/session.rs`, `server/src/semantic/supervisor.rs` — typed profile, isolated overlays/FIFO/incarnations, bounded admission/lifecycle.
- Create: `server/tests/semantic_supervisor.rs` — real bundled-child isolation, document-close, limits and lifecycle coverage.
- Modify: `server/src/api/tests.rs` and discovered `AppState::new` construction callsites — real disabled supervisor, no feature-enabled default or fake production fallback.
- Delete: none; do not create another process manager or plugin registry.

## Implementation Steps

1. Require Phase 01 G4/G5/G7 evidence and Phase 03 enforced policy. Reconcile provisional protocol/module choices to proven contracts before implementation.
2. Add disabled supervisor construction and safe passive artifact readiness. Load enabled intent without spawn; ordinary API operation remains independent.
3. Define stable typed states, exact message types, extension stripping contract, identity/incarnation tuple and terminal cleanup transitions.
4. Implement bounded admission reservation keyed to semantic connection + immutable target + included descriptor. Reject unsupported Rust/other languages before launch; no ambient target/profile fallback.
5. Start the verified tree only after authorized session admission and ownership/resource setup. Validate actual TSLS capabilities within finite startup budget; recheck target/runtime/auth epoch after awaits.
6. Implement authoritative bounded documents, atomic full/ranged updates, byte accounting including transients, post-edit threshold validation, and strict versions per open incarnation.
7. Sequence navigation after actual writer FIFO edits; validate/capture extension version and identity tuple; advisory child cancellation plus mandatory stale/late-result discard and destination freshness.
8. Implement full replay before readiness after fresh restart/reconnect. Reject any replay whose target/owner binding changed; never replay dirty content into an arbitrary replacement root.
9. Implement document-scoped close and last-document bounded idle eviction. A close of model A cannot clear model B, cancel B requests or dispose their common child while B remains open.
10. Apply all process/document/queue/in-flight/deadline/restart/idle bounds; teardown cannot be blocked by outbound status/close sends. Disable/disconnect/invalidation/shutdown reap every descendant and release all retained source/accounting state.
11. Expose only aggregate safe counters/status, resource mode and policy identity; test real two-connection conflicting unsaved buffers, close/reopen, destination edits, crashes, saturation, startup cancellation and shutdown.

## Todo list

- [ ] Add disabled `AppState` ownership and bounded shutdown.
- [ ] Enforce initial immutable policy and lazy authorized admission.
- [ ] Implement independent overlay maps and atomic adaptive updates.
- [ ] Implement explicit version extension, FIFO and all incarnation fences.
- [ ] Prove destination freshness and full matching-owner replay.
- [ ] Preserve other models on ordinary single-document close.
- [ ] Implement finite idle/restart and independent zero-tree terminal cleanup.

## Success Criteria

- Enabled-idle/Settings/Explorer/unsupported Rust each starts zero semantic children. First authorized eligible session starts one tree; two connections for the same target can navigate correctly from conflicting unsaved contents without leakage.
- Below/at/above threshold and crossing both directions follow one proven sync kind; Unicode/non-BMP/multiline/empty text produces equivalent overlays/navigation. Invalid range/version/capacity failure leaves prior overlay intact or explicitly invalidates generation without partial mutation.
- Navigation version extension is required/stripped correctly. Source edit, close/reopen with reused number, child restart, owner/target change, cancellation or relevant destination edit prevents stale reveal; no fictitious LSP ack used.
- Closing clean A while dirty B remains keeps B's text/version/requests and shared child intact; subsequent B Definition/Implementation works. Last-close idle eviction is finite and new work cannot be killed by a stale idle timer.
- Every cap fails boundedly with explicit overload. Disable/disconnect/auth or target invalidation/shutdown reaches zero live semantic descendants and zero server overlay bytes within the enforced cleanup policy, even with saturated outbound delivery.
- Existing PTY/filesystem/core paths share no semantic queues or hot locks; failed cleanup blocks replacement admission and is not reported as success.

## Risk Assessment

- FIFO guarantees order, not arbitrary child internals: use G5 real evidence; stop on inability to preserve latest unsaved semantics.
- Numeric version reuse after reopen and old idle/restart timers can target replacement owners: bind exact open/child/session incarnations and reject stale callbacks.
- Text/range operations can allocate beyond stored text bytes: reserve/check transient growth before copying and bound edits before parsing/application.
- Restart storms and source retention: finite budgets, explicit invalidation, exact accounting release on every terminal path.

## Security Considerations

- Derive root/target only from `AppState::resolve_project_target`; do not trust client root, cwd, environment, initialization options or process claims.
- Source remains bounded, memory-only and connection-scoped. No overlay cross-user reuse, persistence, content logs or generic commands.
- Gateway containment and result filtering do not sandbox filesystem access by the bundled child; trusted-workspace/server-account authority remains explicit.

## Next steps

- Phase 05 exposes this owner through authenticated method/URI mediation and independent live-auth cancellation; Phase 06 supplies admin-only serialized global mutations.
- Phase 08 completes repository/profile invalidation; Phase 09 tunes measured threshold/bounds, not initial admission safety.
- Validation status: documentation revision only; no build, lint, test, formatter, real-child or runtime qualification executed.
- Unresolved gates: exact single-kind adaptive sync, source-version/destination freshness and portable tree ownership remain Phase 01 STOP/GO proofs; implementation must not assume success.
