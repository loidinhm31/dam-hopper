# Phase 01 — Codex 0.146.0 App-Server Compatibility Gate

## Context links

- [Brainstorm](../reports/brainstorm-260801-1455-session-model-delegation-audit.md)
- [Protocol research](./research/researcher-01-codex-app-server-protocol.md)
- [Architecture gate](./reports/architecture-gate-report.md)
- [System architecture](/mnt/data/ws/sharing/dam-hopper/docs/system-architecture.md)

## Overview

- Date: 2026-08-01
- Description: Prove whether a separate, read-only Codex 0.146.0 app-server can passively observe standalone-TUI lineage and join it exactly to OTel.
- Priority: P1 hard stop
- Implementation status: Completed (FAIL gate)
- Review status: Approved 9/10 — completed (FAIL gate), 2026-08-01 (Asia/Saigon)

## Key Insights

- Generated schemas expose `thread/list`, `thread/read`, parent/ancestor filters, status, role/model, subscriptions, and token notifications; they do not guarantee passive visibility across processes.
- Exact lineage is useful only if provider identity joins every observed root/child to OTel without time/order/model inference.
- Spike artifacts must be version-pinned, synthetic, sanitized, and content-free.

## Requirements

- Run a controlled standalone Codex TUI root with parallel and nested children; keep normal TUI workflow unchanged.
- From a separate app-server, prove metadata-only list/read visibility, explicit parent IDs, roles/models/status, and prompt-free requests (`includeTurns=false`; never call turns/items endpoints).
- Compare transient raw `conversation.id` and app-server `threadId` for root and each child; HMAC only after comparison.
- Determine OTel child coverage and delta/cumulative/replay semantics; cached input remains separate.
- Exercise root resume, child resume if supported, fork, compaction, adapter disconnect/reconnect, process restart, pagination, duplicate notification, and late close.
- Record a binary gate result. Required failure activates flat OTel-only fallback and cancels exact-tree Phase 03.

## Architecture

Probe flow: standalone TUI + app-server metadata stream + loopback OTel fixture capture -> in-memory identity assertions -> strict sanitizer -> pinned fixtures/report. No probe content becomes a production dependency. Pass requires explicit edges and deterministic mapping; absence, ambiguity, or drift is failure.

## Related code files with absolute paths/actions

- Create `/mnt/data/ws/sharing/dam-hopper/server/tests/codex_app_server_compatibility.rs`: opt-in/ignored compatibility harness, version check, scenario assertions.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_app_server/fixtures/`: sanitized 0.146.0 schemas/events and provenance manifest.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/fixtures/codex-cli-0.146.0-delegation.bin`: sanitized matching OTel fixture.
- Create `/mnt/data/ws/sharing/dam-hopper/plans/260801-1455-session-model-delegation-audit/reports/phase-01-compatibility-gate.md`: evidence matrix, supported contract, decision, fixture hashes.
- Read only `$CODEX_BIN` (default `codex`): assert exact `codex-cli 0.146.0`; never production-link a workstation path.

## Implementation Steps

1. Generate 0.146.0 JSON schema to a temporary directory; inventory only required request/notification fields and hash the source artifacts.
2. Build a probe client with bounded frames/timeouts and request allowlist: initialize, paginated `thread/list`, `thread/read(includeTurns=false)`, subscribe/unsubscribe only if needed. Reject/title-preview-turn-item content at the boundary.
3. Launch a standalone TUI under a test PTY using a synthetic root -> two parallel children -> one nested child scenario. Capture OTel and metadata simultaneously without parsing transcript/output.
4. Assert direct parent edges, stable role/model/status, raw OTel/app-server identity equality or an explicit protocol mapping for every node. Never accept timestamp proximity as evidence.
5. Compare at least two token updates per node and replay after reconnect. Document whether OTel rows are deltas and app-server snapshots are cumulative; OTel stays authoritative.
6. Resume the root, fork it, compact it, interrupt the adapter, reconnect, and restart app-server. Assert identity/edge/terminal association behavior and whether notifications replay or require list reconciliation.
7. Run an allowlist sanitizer that fails if fixtures contain preview/title/turn/item/prompt/response/task/tool/command/cwd/path/env/reasoning content or raw marker/provider IDs. Replace IDs with stable fixture labels only after identity assertions.
8. Write the gate report. PASS lists exact supported methods/fields/version and fixture checksums. FAIL lists the failed invariant and mandates OTel-only flat fallback.

## Todo list

- [x] Verify exact CLI version and generated schema
- [x] Observe standalone-TUI passive visibility (manual bounded probe)
- [x] Stop root/parallel/nested edge probe after mandatory privacy failure
- [x] Stop OTel conversation-to-thread mapping after mandatory privacy failure
- [x] Stop child token and reconnect/replay probe after mandatory privacy failure
- [x] Stop resume/fork/compaction probe after mandatory privacy failure
- [x] Sanitize and pin the retained contract evidence
- [x] Publish FAIL gate report

## Success Criteria

- PASS only when all required behaviors are deterministic and content-free; report includes reproducible commands and fixture hashes.
- FAIL causes Phase 03 to be skipped and all later contracts to use `lineage_unavailable` flat rows.
- No fixture or log contains forbidden content, raw provider ID, or raw terminal marker.

## Risk Assessment

- Experimental protocol drift: pin 0.146.0 and fail closed to OTel-only.
- Non-deterministic child creation: bounded retries only for environment startup; never reinterpret missing edges as pass.
- Probe cost/time: synthetic minimal scenario, explicit timeout, manual opt-in.

## Security Considerations

- Use disposable config/state and synthetic prompts; delete temporary raw captures after sanitized fixture generation.
- Bind any socket to loopback or use stdio; apply frame, pagination, node, and timeout caps.
- Do not log JSON bodies on parse/rejection failure.

## Next steps

- PASS: Phase 02, then exact lineage adapter in Phase 03.
- FAIL: Phase 02 plus flat OTel parts of Phases 04-07; mark Phase 03 not applicable.

## Unresolved questions

- A separate app-server manually enumerated a simultaneously active standalone TUI, but the response cannot cross the required content-free boundary.
- Does every child emit its own OTel `response.completed`, including resumed/forked/compacted children?
- What terminal association wins when one root is observed under multiple inherited markers?
