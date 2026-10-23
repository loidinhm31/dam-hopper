# Phase 02 — LSP Framing and Child Owner

## Context links

- Parent: [current validation policy](./plan.md#validation-summary).
- Direct dependency: [Phase 01 gates G0–G8](./phase-01-protocol-dependency-real-process-spike.md#architecture), all GO before implementation.
- Current sources: [server crate](../../server/Cargo.toml), [server lifecycle](../../server/src/main.rs), [tunnel owner precedent](../../server/src/tunnel/session.rs), [code standards](../../docs/code-standards.md).
- Protocol: [LSP 3.17 base protocol](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/).

## Overview

- Date: 2026-10-23
- Description: Implement byte-correct bounded LSP framing and exclusive ownership, shutdown, and reaping of the complete semantic process tree.
- Priority: P1
- Implementation status: DONE (2026-10-23)
- Review status: Approved by user under noted exceptions (Cycle 3 score: 7/10, 0 critical issues; non-blocking warnings W1–W11 tracked for Phase 04 / Phase 09)
- Effort: 16h
- Direct dependencies: 01.
- Estimate rationale: retain 16h; Phase 01 must first resolve Linux descendant ownership feasibility, while Phase 03 owns packaging/hard resource integration.

## Key Insights

- WebSocket message boundaries do not frame child stdio; `Content-Length` counts UTF-8 bytes.
- One owner is authoritative for tree lifecycle and exactly one terminal transition. Reader/drain tasks may run independently but cannot publish competing process-exit decisions.
- `kill_on_drop` is an emergency direct-child guard, not descendant cleanup/reap evidence. Killing a PID or waiting for TSLS alone is insufficient because tsserver/helpers may survive.
- Bundled-only fixture launch and Linux x64 lifecycle proof are required. This phase adds neither a plugin framework nor cross-platform qualification.

## Requirements

- Parse fragmented headers/bodies, coalesced frames, case-insensitive known headers, valid extra headers, missing/duplicate/malformed/overflowing lengths, invalid UTF-8/JSON, oversize, EOF and truncated bodies without allocating beyond Phase 01 limits.
- Serialize exact `Content-Length: N\r\n\r\n<body>` from validated UTF-8 JSON bytes; reject unsupported protocol structures at their owning layer.
- Apply finite header/body/channel-byte/count/stdin-write/startup/shutdown limits from the passed Phase 01 execution policy; never await Phase 09 to bound work.
- Launch only an immutable internal bundled launch specification: absolute executable/entrypoint, fixed args, server-derived cwd, sanitized environment, ownership/control handle. No arbitrary command public API or fixture-only runtime override.
- Continuously drain stderr with bounded sanitized summaries; backpressured stdout/events cannot indefinitely prevent exit detection, cancellation, termination, or reap.
- Teardown: close admission → invalidate/cancel pending work → bounded graceful shutdown/response/exit → terminate full owned tree → force-kill after grace → wait/reap owned processes and prove zero live descendants/zombies.
- Process-tree mechanism must be exactly the Linux portable mechanism established by Phase 01 G7, with optional hard-control handle supplied later by Phase 03. Do not defer descendant cleanup to Phase 03 or rely only on process groups if escape/reparenting remains unowned.

## Architecture

`semantic/framing.rs` is a focused bounded codec over async byte streams. `semantic/child.rs` exposes internal typed bounded command/event channels to a private owner. State: `Starting | Running | ShuttingDown | Exited | Crashed`; terminal publication occurs once after cleanup outcome is known.

The owner retains TSLS/tree identities and the proved cleanup/reaping strategy before execution; separate stdio readers, stderr drain, and cancellation signals cannot take ownership away. Linux group/tree handling and the chosen orphan/reparent strategy must be implemented as proven in G7, including PID-reuse-safe identity checks. Cgroups, if available later, strengthen tree control but are not a required startup dependency. An external escape beyond the proved trusted-engine model is not dismissed as a direct-child success; it fails lifecycle qualification.

On channel closure, malformed protocol, timed-out writes, failed initialization, startup cancellation, supervisor disposal, or server shutdown, cleanup is scheduled independently of output delivery. An owner-task panic/drop guard must transfer cleanup to a supervised owner/reaper rather than merely drop a Tokio Child. Abrupt daemon death behavior and service restart ownership follow the G7 evidence; do not promise synchronous wait by a dead process.

Rollback boundary: no public route or child-creation exposure. Framing/tree failures block Phase 03. Existing PTY/tunnel process ownership remains unchanged.

## Related code files

- Modify: `server/src/lib.rs`, `server/Cargo.toml` — internal module and only proven dependencies.
- Create: `server/src/semantic/mod.rs`, `server/src/semantic/framing.rs`, `server/src/semantic/child.rs` — codec and private tree owner.
- Create: `server/tests/fixtures/lsp-test-server.mjs` — deterministic fixture entrypoint run only with the selected bundled Node; modes for fragmentation, crash, delay, stderr, stuck shutdown and descendants.
- Create: `server/tests/semantic_child_process.rs` — real-process byte framing and full-tree lifecycle cases.
- Inspect: `server/src/main.rs`, `server/src/tunnel/session.rs` — current shutdown/single-authority conventions, not assumed descendant guarantees.
- Delete: none. Do not add PATH/system-Node/custom-executable fallback or a public launch-spec constructor.

## Implementation Steps

1. Read all Phase 01 gate artifacts. Stop if exact launch tree, initial bounds, adaptive profile, or portable descendant ownership lacks GO; reconcile provisional paths with findings.
2. Define safe typed codec failures and pre-allocation header/body checks. Preserve surplus bytes for coalesced frames; fail closed rather than heuristically resynchronize corrupted streams.
3. Implement exact UTF-8 byte serializer and bounded incremental parser. Cover astral Unicode, empty body, malformed lengths and every byte split.
4. Define private launch/ownership input restricted to the bundled descriptor. Establish tree ownership before it can spawn helpers; apply finite initial settings and cleanup handles before accepting commands.
5. Spawn directly, without shell/PATH, and start independent bounded stdout/stderr processing. Use `kill_on_drop` only in addition to explicit tree lifecycle ownership.
6. Implement owner select loop, correlation, bounded child-stdin writes, one exit observer, cancellation-priority handling, and exactly one terminal state. Exhausted event/output queues trigger bounded failure/cleanup, not a blocked owner.
7. Implement shutdown/exit deadlines plus complete-tree graceful/forced termination and waits. Retain ownership until all tracked descendants are gone/reaped or cleanup fails visibly; failed cleanup blocks readiness/replacement admission.
8. Cover caller/channel drop, malformed stdout, reader failure, startup disconnect, timeout, owner panic recovery, daemon graceful shutdown, and qualified daemon-death/service cleanup behavior.
9. Run future real fixtures with selected bundled Node, including real descendants and G7 reparent/escape vectors. Record cleanup timing and descendant/zombie observations, not just TSLS PID exit.

## Todo list

- [x] Consume all passed Phase 01 contracts and finite bounds.
- [x] Implement bounded byte-correct codec (`server/src/semantic/framing.rs`).
- [x] Implement private bundled-only tree owner and one terminal transition (`server/src/semantic/child.rs`; crate visibility/seal W6 tracked for Phase 03/09).
- [x] Drain stderr and bound all channels/writes independently (`server/src/semantic/child.rs`).
- [x] Implement cancellation-priority full-tree shutdown/kill/reap (`server/src/semantic/reaper.rs`; in-group SIGKILL escalation verified for tested process groups; setsid/escape tracking deferred to Phase 04/09).
- [x] Cover panic/drop/startup failure and descendant cleanup with real fixtures (Approved exception: basic drop/startup failure and stubborn descendant SIGKILL covered by 24/24 tests in `server/tests/semantic_child_process.rs`; owner-panic/runtime-drop descendant cleanup transfer deferred to Phase 04 supervisor per Cycle 3 review W1).

## Success Criteria

- Every split/coalesced valid frame parses once in order; Unicode serialized lengths are exact. Malformed/oversized streams fail only the semantic owner with bounded safe errors.
- Full command/event/stderr queues and a stuck child stdin cannot postpone cancellation or process cleanup beyond the recorded policy deadlines.
- Graceful exit, crash, timeout, disconnect during startup, owner/channel drop and forced kill leave zero live semantic descendants and zero retained zombies, verified against the actual tree rather than a direct-child wait alone.
- At most one terminal event is published. A cleanup failure is observable and blocks reuse; no false success from `kill_on_drop` or a disappeared parent PID.
- Fixtures cannot select a runtime command and never invoke system Node/npm/npx/shell. Existing `/ws`, PTY and filesystem channels/locks are unaffected.

## Risk Assessment

- Descendants can outlive TSLS or escape groups: apply the Phase 01 proved ownership/reaping mechanism; STOP integration if it is insufficient.
- Panic/drop can lose a child handle: explicit supervised cleanup transfer plus emergency guard; exercise real failure paths.
- Full stdio/event queues can deadlock: bounded independent drain and cancellation-priority cleanup, never teardown through an outbound socket queue.
- Numeric changes remain evidence-dependent; initial policy is finite and documented rather than temporary untracked constants.

## Security Considerations

- Never log source, raw protocol/stderr, URI/path, argv, environment or credentials.
- Direct immutable bundled execution and environment sanitation apply equally to fixtures and production. Test harness selects fixture modes internally, not a remotely usable runtime override.
- Child retains server-account filesystem authority. Framing limits and process-tree ownership are not a filesystem sandbox.

## Next steps

- Phase 03 supplies the packaged immutable launch artifact and enforced initial policy, plus optional child-only hard controls; complete tree lifecycle already exists here.
- Phase 04 adds semantic session admission/version/overlay ownership. No public exposure until authenticated admission and admin control prerequisites are complete.
- Validation status: Administratively complete under approved exceptions (2026-10-23). Targeted suites report 24/24 tests passing (13 unit framing tests + 11 real-process integration tests in `server/tests/semantic_child_process.rs`). Clippy clean in `semantic/`. Cycle 3 code review scored 7/10 with 0 critical issues, approved by user. Reports: `plans/reports/tester-261023-1027-lsp-phase-02-framing-and-child-owner-cycle3.md` and `plans/reports/code-reviewer-261023-1031-lsp-phase-02-framing-and-child-owner-cycle3.md`.
- Next phase: Phase 03 — Pinned tool provisioning and resource controls.
