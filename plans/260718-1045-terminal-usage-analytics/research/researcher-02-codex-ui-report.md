# Codex Telemetry and Usage UI Research

Date: 2026-07-18  
Scope: implementation-plan evidence; reconciled with brainstorm privacy decisions

## Recommendation

Use two server-owned inputs: validated shell lifecycle facts and optional Codex OTLP logs on a separate loopback-only listener. Normalize only allowlisted numeric/enum metadata into a separate `telemetry.db`. Expose authenticated aggregates only. No MCP, model call, terminal scraping, Codex transcript reading, raw OTLP retention, or browser persistence.

OTel export is out-of-band telemetry after the normal Codex response. It does not create an extra prompt, tool call, or model request; added model-token consumption is zero.

## Current Codex OTel contract

Codex telemetry is disabled by default. Official advanced configuration documents:

```toml
[otel]
environment = "local"
log_user_prompt = false
exporter = { otlp-http = {
  endpoint = "http://127.0.0.1:4811/v1/logs",
  protocol = "binary",
  headers = { "authorization" = "Bearer <generated-secret>" }
} }
```

Codex emits structured events including `codex.conversation_starts`, `codex.api_request`, `codex.sse_event`, `codex.tool_decision`, and `codex.tool_result`. `codex.sse_event` includes token counts on `response.completed`. User prompt content stays redacted unless separately enabled.

Sources: [Codex observability and telemetry](https://developers.openai.com/codex/config-advanced/#metrics), [OTLP specification](https://opentelemetry.io/docs/specs/otlp/), [OpenTelemetry logs data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/).

### Compatibility rules

- Pin supported Codex CLI fixtures and record CLI/source version when present.
- Treat unknown event names/attributes as ignored, not fatal.
- Persist only allowlisted conversation ID, model, event time, status, duration, and token components.
- Reject/drop event body, prompt, response, tool arguments/results, cwd, and unknown string attributes before persistence/logging.
- Keep `receiver_schema_version` independent from Codex version.
- Never sum cumulative totals as deltas. Persist component counters with an explicit counter semantic and derive displayed total once.
- Quarantine means health counter only; do not retain malformed raw payload.

## Transport decision spike

Official example uses OTLP/HTTP binary/protobuf. Do not assume Codex supports JSON until verified against the pinned CLI and official config reference.

Spike options:

1. Minimal OTLP protobuf types for `ExportLogsServiceRequest`; smallest accepted field surface, more maintenance.
2. OpenTelemetry proto crate generated types; stronger interoperability, larger dependency/build surface.
3. OTLP JSON only if Codex explicitly supports it; easiest inspection, currently unproven.

Gate: capture a real `response.completed` fixture from each supported Codex CLI version and prove token mapping before implementation selection.

## Dedupe and correlation

OTLP exporters may retry after ambiguous failures. Compute a keyed ingest fingerprint from allowlisted stable fields: source version, conversation/response ID, event name, event timestamp, and canonical token components. Unique insert makes replay a successful no-op. Never dedupe only on conversation ID because one conversation emits many events.

Correlation order:

1. Explicit conversation/provider run mapped during a DamHopper-launched process.
2. Unambiguous terminal/project process window, marked approximate.
3. Unattributed provider event.

Do not silently convert time-window inference into exact attribution. Dashboard exposes exact/approximate/unattributed coverage.

## Safe receiver

- Dedicated listener explicitly bound to `127.0.0.1`; never normal LAN-facing router.
- Generated bearer secret; constant-time comparison; no CORS.
- Only `POST /v1/logs`; strict content type; small body/record/attribute limits and short timeout.
- Decode into bounded request structures, immediately normalize allowlisted fields, discard request bytes.
- Return success only after bounded worker accepts/commits according to chosen retry contract.
- Receiver/DB failure cannot stop Codex or PTYs; increment local health counters.
- Disabled by default. Configuration validation rejects non-loopback bind.

## Separate SQLite and API

Use `telemetry.db`, mode `0600`, WAL, busy timeout, bounded single writer, separate read connection. Do not add tables to `sessions.db`, which stores restore metadata, env JSON, and scrollback.

Suggested modules:

- `server/src/telemetry/{mod.rs,types.rs,privacy.rs,worker.rs,store.rs,queries.rs,retention.rs}`.
- `server/src/telemetry/codex_otlp/{mod.rs,receiver.rs,decoder.rs,fixtures/}`.
- `server/src/api/usage.rs`; register protected `/api/usage/*` routes.
- `server/src/config/schema.rs`, `server/src/state.rs`, `server/src/main.rs` wiring.

API shape:

- `GET /api/usage/summary?from&to&bucket&project&shell&agent&model`.
- `GET /api/usage/timeseries?...` only if one summary response becomes too large.
- `GET /api/usage/health?...` for capture/ingestion coverage.
- `DELETE /api/usage` for explicit purge with existing auth plus confirmation contract.

Return UTC buckets and aggregates only. Cap date span, buckets, filters, and response size. No event-row endpoint.

## Usage page

Register `/usage` in `packages/ui/src/embed/dam-hopper-app.tsx`; add compact nav entry in `packages/ui/src/lib/navigation.ts`. Add typed DTOs/queries in `packages/ui/src/api/client.ts`, `queries.ts`, and `ws-transport.ts` following existing mirror pattern.

Page order:

- 24h/7d/30d/project/shell/agent/model filters.
- Coverage card first: rich/partial/unavailable and Codex available/unattributed.
- Terminal run/command/outcome/duration cards.
- Category/project heatmap and trends.
- Separate Codex token trend/composition/cache ratio cards.
- Health footer: drops, rejected records, last event/purge/checkpoint.

Use accessible SVG/CSS charts first; no chart dependency until interaction/density proves need. Provide table summaries, color-independent labels, keyboard focus, loading/empty/partial/error states. Compact global nav using smaller label/icon gaps and responsive `More` overflow while retaining accessible names and touch targets.

Avoid productivity labels, user rankings, cost estimates, commands/hour quality claims, or causal token-success claims.

## Tests and acceptance

- Rust fixtures: real binary OTLP payload, unknown fields, missing usage, malformed/oversized input, auth, dedupe, cumulative-vs-delta, prompt/content rejection.
- Receiver integration: loopback address assertion, main router lacks `/v1/logs`, disable leaves Codex/terminal healthy.
- SQLite/API: locked/full/read-only DB, queue saturation, retention, UTC buckets, auth, limits, no secret/content leakage, 100k-row aggregate target under 200 ms.
- UI: DTO parsing, filter URL state, aggregate rendering, coverage labels, accessible charts, compact nav, empty/partial/error states, browser route/filter smoke.
- Manual: real supported Codex CLI emits nonzero token components; disabling collector adds no behavior change.

## Unresolved questions

1. Minimal protobuf decoder versus OpenTelemetry proto dependency after compatibility spike?
2. May DamHopper offer opt-in Codex config synchronization, or instructions only?
3. Exact aggregate retention after 90-day detail purge?
4. Display timezone: browser local with UTC API is recommended; confirm during UI planning.
