# Phase 05: Codex Loopback OTel Adapter

## Context links

- [Parent plan](./plan.md)
- [Contracts and OTLP spike](./phase-01-contracts-config-otlp-spike.md)
- [SQLite store](./phase-03-sqlite-store-retention-privacy.md)
- [Aggregate API](./phase-04-aggregate-api-and-controls.md)
- [Codex OTel docs](https://developers.openai.com/codex/config-advanced/#metrics)
- [Codex app-server future reference](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)

## Overview

- Date: 2026-07-18
- Description: Ingest optional Codex token events through a private, authenticated local listener without MCP or extra model calls.
- Priority: P2
- Implementation status: Pending
- Review status: Pending
- Effort: 32h

## Key Insights

- Codex OTel is disabled by default and emits token counts on completion-related events.
- Official configuration currently documents OTLP/HTTP binary; phase 1 decides decoder.
- Existing normal interactive Codex PTYs may not expose a stable DamHopper run ID. Attribution must show confidence.
- Receiver must be separate from LAN-facing `/api` router and fail independently of PTY operation.

## Requirements

- Dedicated Axum listener bound only to `127.0.0.1`.
- Generated bearer secret; constant-time validation; no CORS; strict limits.
- `POST /v1/logs` only, accepted transport selected by phase 1 fixture gate.
- Decode bounded records and immediately allowlist provider/conversation/model/status/time/token fields.
- Drop prompt, response, tool content, cwd, unknown strings, raw bytes, and malformed payloads.
- Dedupe retries; distinguish cumulative counters from deltas; never double-count.
- Exact/approximate/unattributed correlation displayed in API/UI.
- Disabled collector does not alter terminal or Codex behavior.

## Architecture

```text
Codex -> loopback OTLP listener -> bounded decoder -> allowlist normalizer
                                      |                    |
                                      +-- health counter  v
                                                   TelemetryWorker
```

Listener lifecycle is independent from the main application router. Startup conflict or decoder failure disables only collector and exposes health status. A bounded queue protects receiver memory; request success semantics are documented (commit before 2xx or explicit accepted/drop contract).

Correlation order: provider conversation/run ID mapped by an explicit DamHopper-launched process; otherwise safe process-window/project match marked approximate; otherwise unattributed. Optional `OTEL_RESOURCE_ATTRIBUTES` run ID injection is a spike-only enhancement and cannot broaden shell env leakage.

## Related code files

- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/mod.rs` — adapter registration/lifecycle.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/receiver.rs` — loopback Axum listener.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/decoder.rs` — selected binary decoder.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/normalizer.rs` — allowlisted token/event mapping.
- Create `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/codex_otlp/tests.rs` — fixtures/auth/replay/content tests.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/main.rs` — start/stop isolated listener, no panic on failure.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/state.rs` — collector health/config handle.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/config/schema.rs` — collector opt-in/config fields.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/usage.rs` — Codex coverage/settings DTOs if required.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/telemetry/worker.rs` — normalized agent event commands.
- Modify `/mnt/data/ws/sharing/dam-hopper/server/src/api/config.rs` only if explicit, conflict-safe Codex config synchronization is accepted.

## Implementation Steps

1. Lock decoder and supported Codex version fixture from phase 1. Reject unpinned transport assumptions.
2. Generate/read bearer secret with mode `0600`; keep value server-side. Validate collector bind before listener creation.
3. Build body/record/attribute limits and strict content-type/method/path checks.
4. Decode only bounded OTLP fields. Return protocol errors without echoing input; do not log payload.
5. Map `response.completed` token fields into nullable canonical components. Store source version and counter semantic.
6. Create stable allowlisted dedupe fingerprint. Insert through telemetry worker; duplicate is successful no-op.
7. Add correlation adapter and confidence enum. Keep missing linkage unattributed rather than guessing.
8. Add optional setup status/instructions. If syncing Codex config, use atomic `toml_edit`-style ownership checks and refuse to overwrite unrelated existing OTel config; otherwise provide a copyable snippet. Restart required for existing Codex processes.
9. Add local health counters for malformed, rejected, duplicate, queued, dropped, and last accepted event.
10. Verify disabling collector leaves normal Codex/terminal operation unaffected.

## Todo list

- [ ] Loopback bind/auth/content limits pass.
- [ ] Binary fixture maps nonzero token fields.
- [ ] Unknown fields ignored without raw retention.
- [ ] Retry/dedupe/cumulative semantics pass.
- [ ] Exact/approximate/unattributed coverage visible.
- [ ] Existing OTel config is never overwritten silently.
- [ ] Failure is isolated from PTY and main API.

## Success Criteria

- Supported fixture yields one correct usage row after replay/retry.
- Prompt/output/tool-content fixtures never enter DB/API/logs.
- Non-loopback bind/config rejected before serving.
- Listener disabled or failed without terminal latency/availability regression.
- Missing token events appear unavailable, not zero.

## Risk Assessment

- OTel schema drift: pinned fixtures, tolerant unknown fields, source version.
- Same-user spoofing: loopback + bearer limits accidental/remote access; document same-user trust boundary.
- Existing config conflict: explicit status/instructions, no destructive merge.
- Correlation ambiguity: confidence and unattributed bucket.

## Security Considerations

- Never return bearer secret, raw body, or decoded string map to browser.
- Constant-time secret comparison and bounded request work.
- No public CORS or main-router route.
- Do not add MCP, tool, prompt, or response path.

## Next steps

- Phase 06 renders collector status/token cards only when API says available.
- Phase 07 runs real optional smoke and fault matrix.

## Unresolved questions

- Config synchronization versus setup instructions only remains a product-safety choice.
