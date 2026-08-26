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
- Implementation status: Complete (2026-07-26)
- Review status: Approved (2026-07-26)
- Effort: 32h

## Key Insights

- Codex OTel is disabled by default and emits token counts on completion-related events.
- Official configuration currently documents OTLP/HTTP binary; phase 1 decides decoder.
- Codex version is compatibility evidence, not an acceptance boundary. Decode recognized core fields across newer versions.
- Existing normal interactive Codex PTYs may not expose a stable DamHopper run ID. Attribution must show confidence.
- Receiver must be separate from LAN-facing `/api` router and fail independently of PTY operation.

## Requirements

- Dedicated Axum listener bound only to `127.0.0.1`.
- Generated bearer secret; constant-time validation; no CORS; strict limits.
- `POST /v1/logs` only, accepted transport selected by phase 1 fixture gate.
- Decode bounded records and immediately allowlist provider/conversation/model/status/time/token fields.
- Drop prompt, response, tool content, cwd, unknown strings, raw bytes, and malformed payloads.
- Do not reject an otherwise valid `response.completed` record only because its Codex version is newer or unverified.
- Preserve recognized token components when schema drift is partial. Missing/changed core fields produce partial/unavailable coverage, never synthetic zero.
- Dedupe retries; distinguish cumulative counters from deltas; never double-count.
- Exact/approximate/unattributed correlation displayed in API/UI.
- Disabled collector does not alter terminal or Codex behavior.

## Compatibility-policy amendment (2026-07-26)

### Decision

Apply field-level forward compatibility. Phase 1 fixtures prove baseline transport and decoder behavior; they do not create a Codex version allowlist. A future version with the known `response.completed` core shape remains usable before a matching fixture is added.

### Requirements

- Allowlist event identity and known core provider/conversation/model/status/time/token fields; ignore all other attributes.
- Process recognized core fields regardless of newer, missing, or unverified source version.
- Increment a bounded, non-content health/status signal for unverified versions or core-field drift. Avoid raw version/attribute cardinality in metrics or logs.
- Mark coverage partial when some recognized token components remain usable; mark unavailable when no trustworthy token component remains.
- Never coerce absent, renamed, invalid-type, or overflowed token fields to zero.
- Never persist or expose raw OTLP attributes, prompt/response/tool content, unknown strings, or rejected payloads.
- Treat new-version fixtures as confidence/regression additions, not runtime availability gates.

### Implementation steps

1. Separate transport/schema validation from version observation; remove version-based reject branches.
2. Extract only the known `response.completed` core fields into bounded typed values before normalization.
3. Normalize recognized components independently. Emit no usage row when all token components are unavailable; otherwise persist nullable components with partial/full coverage.
4. Record aggregate `unverified_version` and `core_schema_drift` health counters/status without raw attributes or unbounded labels.
5. Keep baseline fixture tests mandatory for decoder changes. Add newer-version fixtures when available without requiring a release to restore ingestion.

### Tests

- Baseline fixture remains unchanged and dedupes correctly.
- Unknown/newer version with unchanged core fields produces the same usage result plus safe unverified-version health signal.
- Unknown/newer version with one missing or invalid core field preserves valid components and reports partial coverage.
- Record with no trustworthy token component reports unavailable and creates no zero-valued usage row.
- Unknown attributes and content canaries remain absent from DB, aggregate API, health output, and logs.
- Adding or omitting a future-version fixture changes confidence/test coverage only, not runtime version acceptance.

### Risks

- Silent upstream drift: mitigate with drift counters, partial/unavailable coverage, and fixture follow-up.
- False totals from invalid coercion: fail each component closed; never default to zero.
- Health data cardinality/privacy leak: use aggregate counters and bounded compatibility states, not raw labels or payload excerpts.

### Success criteria

- Newer/unverified Codex event with known core shape remains usable without code/config change.
- Partial drift preserves trustworthy fields and visibly degrades coverage.
- Complete core-field loss yields unavailable, not zero.
- Privacy scans find no raw attributes or content in persistence, API, health, or logs.

### Unresolved questions

- Which bounded source-version indicator is authoritative when Codex resource and event attributes disagree? Default: mark unverified; continue field-level processing.

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

1. Lock transport/decoder and baseline core-field behavior from phase 1. Do not turn the fixture version into a runtime allowlist.
2. Generate/read bearer secret with mode `0600`; keep value server-side. Validate collector bind before listener creation.
3. Build body/record/attribute limits and strict content-type/method/path checks.
4. Decode only bounded OTLP fields. Return protocol errors without echoing input; do not log payload.
5. Map recognized `response.completed` token fields into nullable canonical components. Retain only bounded allowlisted version/counter metadata; surface unverified version or field drift through safe health state.
6. Create stable allowlisted dedupe fingerprint. Insert through telemetry worker; duplicate is successful no-op.
7. Add correlation adapter and confidence enum. Keep missing linkage unattributed rather than guessing.
8. Add optional setup status/instructions. If syncing Codex config, use atomic `toml_edit`-style ownership checks and refuse to overwrite unrelated existing OTel config; otherwise provide a copyable snippet. Restart required for existing Codex processes.
9. Add local health counters for malformed, rejected, duplicate, queued, dropped, and last accepted event.
10. Verify disabling collector leaves normal Codex/terminal operation unaffected.

## Todo list

- [x] Loopback bind/auth/content limits pass.
- [x] Binary fixture maps nonzero token fields.
- [x] Newer/unverified version with stable core fields remains usable.
- [x] Missing/changed core fields yield partial/unavailable coverage, never zero.
- [x] Unknown fields ignored without raw retention.
- [x] Retry/dedupe/cumulative semantics pass.
- [x] Exact/approximate/unattributed coverage visible.
- [x] Existing OTel config is never overwritten silently.
- [x] Failure is isolated from PTY and main API.

## Success Criteria

- Supported fixture yields one correct usage row after replay/retry.
- Newer/unverified version with the supported core shape yields the same usage row plus safe compatibility health state.
- Missing or invalid core fields yield partial/unavailable coverage without a zero-valued usage row.
- Prompt/output/tool-content fixtures never enter DB/API/logs.
- Non-loopback bind/config rejected before serving.
- Listener disabled or failed without terminal latency/availability regression.
- Missing token events appear unavailable, not zero.

## Risk Assessment

- OTel schema drift: tolerant core-field extraction, safe health state, partial/unavailable coverage, and follow-up fixtures.
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
