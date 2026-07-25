# Phase 01: Contracts, Config, OTLP Spike

## Context links

- [Parent plan](./plan.md)
- [Brainstorm](../reports/brainstorm-260718-1045-terminal-usage-analytics.md)
- [Codex/UI research](./research/researcher-02-codex-ui-report.md)
- [Architecture gate](./reports/architecture-gate-report.md)
- [System architecture](../../docs/system-architecture.md)
- [Codex telemetry docs](https://developers.openai.com/codex/config-advanced/#metrics)

## Overview

- Date: 2026-07-18
- Description: Freeze internal contracts, config semantics, privacy boundary, and OTLP decoder choice before feature code expands.
- Priority: P1 gate
- Implementation status: Complete (2026-07-26)
- Review status: Approved pending user gate
- Effort: 24h

## Key Insights

- Official Codex example uses OTLP/HTTP binary; JSON support is unproven.
- Existing `sessions.db` has restore data, env JSON, and scrollback. Telemetry needs separate lifecycle.
- Existing shell parser already has richer internal states than current WS mapping.
- Config must make existing installs opt in; Codex collector needs separate opt in.

## Requirements

- Define versioned event/query DTOs with nullable fields for missing data.
- Define `rich | partial | unavailable` capture quality and `exact | approximate | unattributed` correlation.
- Define no-content allowlist before decoder/storage code.
- Define terminal detail retention 90 days; daily aggregate retention separately configurable.
- Choose protobuf decoder only after pinned fixture and dependency review.
- Define HMAC key creation, storage, rotation, and purge semantics.

## Architecture

```text
ShellLifecycle -> TelemetryEvent sink -> bounded worker -> telemetry.db
Codex OTLP -> loopback decoder -> allowlist normalizer -> same worker
telemetry.db -> query service -> protected aggregate API
```

Core contracts:

- `TerminalRunId`: UUID per PTY incarnation; session ID may survive restart, run ID may not.
- `CommandEventId`: `(run_id, sequence)`; monotonic sequence internal to run.
- `AgentUsageEventId`: keyed canonical fingerprint of allowlisted provider fields.
- All times persisted UTC milliseconds; durations derived from monotonic clock.
- Raw input only exists in bounded stack/owned values until normalization returns.

## Related code files

- Modify `/mnt/data/ws/sharing/dam-hopper/server/Cargo.toml` — add decoder dependency only after spike approval.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/config/schema.rs` — add nested telemetry config with defaults/validation.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/lib.rs` — export focused telemetry module.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/mod.rs` — module boundary and public contracts.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/types.rs` — normalized events/enums/query DTOs.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/privacy.rs` — allowlist and forbidden-field policy.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/decoder.rs` — spike decoder behind tests.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/fixtures/` — sanitized pinned binary fixtures and provenance note.

## Implementation Steps

1. Add `TelemetryConfig` under `[server.telemetry]`: `enabled=false`, DB path, `detail_retention_days=90`, aggregate retention, excluded projects, collector enabled/host/port; reject non-loopback host.
2. Add serde roundtrip and invalid-bound tests. Preserve snake_case disk aliases and camelCase API behavior.
3. Define normalized event enums/structs. Use numeric/enum fields only; model/conversation/executable values bounded and validated.
4. Define forbidden content test helper scanning serialized events for fixture secrets.
5. Obtain sanitized binary OTLP fixture from a supported Codex CLI without generating an automatic model request; document CLI version and capture method.
6. Spike minimal generated proto types versus OpenTelemetry proto crate. Measure added build size/time and maintenance surface.
7. Decode `codex.sse_event` `response.completed`; prove token component mapping and unknown-field tolerance.
8. Record decision in phase file/report. Delete rejected spike code/dependency before phase completion.
9. Define HMAC key file path `~/.config/dam-hopper/telemetry-hmac-key`, 32 random bytes, mode `0600`; MVP rotation only through explicit delete-all/reset.

## Todo list

- [x] Config defaults and validation tested.
- [x] Normalized contracts reviewed against privacy allowlist.
- [x] Binary fixture checked in without user/model content.
- [x] Decoder dependency decision benchmarked and recorded.
- [x] HMAC lifecycle specified.
- [x] No product listener enabled yet.

## Success Criteria

- Pinned fixture decodes exact documented token components.
- Unknown OTLP fields do not fail the request or enter normalized storage.
- Serialization test proves forbidden strings/content absent.
- Existing config files load unchanged with feature disabled.
- Chosen dependency has explicit rationale and supported-version fixture.

## Risk Assessment

- Codex schema drift: version fixtures, tolerant decoder, collector stays opt-in.
- Dependency bloat: compare alternatives before commit.
- Config ambiguity: nested struct and bounded validation.
- Fixture privacy: generate/sanitize offline; scan before commit.

## Security Considerations

- Never log decoder input or decoded attribute maps.
- Reject strings not on allowlist before any persistence command exists.
- HMAC key separate from DB; never expose via API.
- Collector binding validation belongs in config, not only startup.

## Next steps

- Phase 02 consumes normalized terminal event contract.
- Phase 03 implements separate durable store/worker.

## Unresolved questions

- Decoder dependency is intentionally unresolved until spike evidence.
