# Architecture Gate Report

Date: 2026-07-18  
Status: passed for planning

## Reviewed documents

- `docs/system-architecture.md`
- `docs/codebase-summary.md`
- `docs/code-standards.md`
- `docs/project-overview-pdr.md`
- `plans/reports/brainstorm-260718-1045-terminal-usage-analytics.md`

## Architecture update

Updated `docs/system-architecture.md` before plan creation with:

- Planned `/api/usage/*` aggregate route family.
- Planned separate `TelemetryStore/Worker` service.
- Shell lifecycle + Codex loopback OTel + SQLite + UI dataflow.
- Logical schema contracts.
- Privacy, retention, correlation, and failure invariants.
- Compact `/usage` route and navigation boundary.

## Invariant review

- Preserves server-validated, nonce-authenticated shell lifecycle as only command boundary.
- Preserves browser-local exact command history; no server reuse of localStorage history.
- Adds no PTY input/output parser.
- Adds no WebSocket per-command stream.
- Keeps SQLite work on bounded blocking worker, outside PTY locks/hot path.
- Uses separate `telemetry.db`; does not mix restore/session buffer semantics.
- Adds protected aggregate-only reads; no raw-event API.
- Keeps `packages/ui` shared between browser and native hosts.
- Adds no native sidecar/plugin permission.
- Adds no MCP server or model-visible tool.

## Required plan gates

1. Prove cross-shell completion/exit-status marker behavior before schema/API work.
2. Prove telemetry queue/DB failure cannot delay PTY I/O.
3. Prove persisted DB/API/logs contain no command, argv, cwd, env, prompt, response, or tool content.
4. Prove Codex OTLP contract against pinned supported CLI fixtures before enabling token cards.
5. Prove aggregate query target on representative fixture before adding rollup tables.
6. Prove compact navigation in browser and native shared UI widths.

## Unresolved questions

- Exact OTLP transport/decoder dependency remains a spike decision.
- Long-term aggregate retention default remains configurable and can be selected during implementation planning.
