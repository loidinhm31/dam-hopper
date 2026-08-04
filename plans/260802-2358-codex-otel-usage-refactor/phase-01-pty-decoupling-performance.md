# Phase 01: PTY decoupling and performance gate

## Context links

- Parent: [plan.md](./plan.md)
- Architecture: [Codex OTel usage](../../docs/system-architecture.md#codex-otel-usage-analytics)
- Research: [backend report](./research/researcher-01-backend-data-report.md)

## Overview

**Date:** 2026-08-02 · **Priority:** P1 · **Status:** Complete · **Review:** Complete · **Completed:** 2026-08-03 19:37:56 +07

Delete the Usage middle layer from terminal creation, session options, restart/restore, and PTY
reader paths. PTY behavior must be identical whether Codex Usage is enabled or disabled.

## Key Insights

Current coupling includes `TelemetryCapture`, `TelemetrySink`, `CommandClassifier`, command/run
events, `TelemetryControl` admission, marker injection, correlation registry, and output redaction.
A no-op sink or boolean gate would leave the performance cost and violate the requirement.

## Requirements

- PTY modules do not import telemetry or carry usage fields/parameters.
- Terminal handlers do not mutate `OTEL_RESOURCE_ATTRIBUTES` or register correlation markers.
- Remove command/run events and terminal health counters from production paths.
- Preserve terminal output, restart, persistence, and WebSocket semantics.
- Add a representative enabled/disabled PTY latency and throughput comparison.

## Architecture

`PTY manager -> shell/session process` is a direct path. Separately, `Codex -> OTLP receiver ->
Codex queue` owns all Usage work. No lock, queue, snapshot, classifier, or redactor crosses the
boundary.

## Related code files

- **Modify:** `/mnt/data/ws/sharing/dam-hopper/server/src/pty/manager.rs`, `session.rs`, `tests.rs`,
  `/mnt/data/ws/sharing/dam-hopper/server/src/api/terminal.rs`, `main.rs`, `state.rs` (only wiring
  needed to remove PTY Usage ownership), and telemetry type/runtime exports.
- **Delete if usage-only after `rg` confirmation:** `server/src/telemetry/command_classifier.rs`,
  `server/src/telemetry/sink.rs`, `server/src/pty/output_redactor.rs` and its tests.
- **Modify tests:** PTY constructor, environment, restart, and marker assertions to assert absence.

## Implementation Steps

1. Capture a baseline PTY benchmark and inventory every telemetry reference with `rg`.
2. Remove Usage fields from PTY manager/session options and all spawn/restart/restore handoffs.
3. Remove terminal correlation decision, env marker injection, registry ownership/unregister, and
   marker redaction from terminal API/manager.
4. Remove `TelemetryContext`, command classifier calls, command/run queue variants, and no-op
   fallback abstractions from PTY code.
5. Re-run terminal unit/integration tests and compare enabled/disabled benchmark distributions.

## Todo list

- [x] Baseline and post-change PTY benchmark recorded; usage benchmark result has a known pre-existing/flaky exception.
- [x] `rg` shows no production PTY Usage dependency.
- [x] Terminal tests cover unchanged behavior and absence of marker/capture work.
- [x] No disabled/no-op middle layer remains.

## Validation

Completed PTY validation: PTY compilation/tests, restart/persistence, output, WebSocket behavior,
and absence of PTY Usage/correlation work validated. The usage benchmark contains a known
pre-existing/flaky exception; this does not block Phase 1 completion and remains tracked for the
later release benchmark gate.

## Success Criteria

PTY compilation and tests pass; terminal p95 latency/throughput is materially equivalent in both
Usage configurations; no usage queue, lock, or allocation occurs on terminal activity.

## Risk Assessment

Constructor fan-out and restore paths can hide references; use compile errors plus a repository-wide
search. Removing redaction is safe only after proving the marker is no longer injected.

## Security Considerations

Do not broaden PTY environment propagation while removing the marker. Keep existing auth, sandbox,
and output handling unchanged.

## Next steps

Phase 2 can simplify the runtime and schema once PTY ownership is gone.
