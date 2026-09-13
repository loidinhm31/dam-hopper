# Phase 05 — Bundle model, bounded readers, redaction, source status and correlation engine

## Context links

- [Plan](plan.md) · [Design contract](design-contract.md) · [Phase 04](phase-04-helper-milestone-enrichment.md)
- [Collector research](research/researcher-02-collector-cli-contract.md) · [Producer research](research/researcher-01-event-audit-contract.md)
- `server/src/diagnostics/{store.rs,redaction.rs,types.rs}` · `server/src/idle_suspend/{event.rs,server_audit.rs,audit.rs}`

## Overview

- Date: 2026-09-12
- Description: build the pure bundle-v1 model, read-only bounded JSONL adapters, strict privacy projection, per-source completeness, deterministic correlation/gap analysis, and final-size reduction.
- Priority: P1
- Implementation status: pending
- Review status: schema/privacy/correlation review required
- Effort: 20h
- Ownership: diagnostics-domain owner creates `linux_release/diagnostics` pure modules. Phase 06 owns OS/API/command/output adapters after these interfaces freeze.
- Dependency: Phases 01–04 schemas and record fixtures approved.

## Key Insights

- Existing `DiagnosticStore::recent_events` compacts its file; collector must not call it because diagnosis is read-only.
- Missing file and readable empty file differ. Malformed lines may coexist with valid records but always make source incomplete.
- Exact UUID joins are authoritative. Time proximity, epoch, revision, PID, and `epoch-N` are never correlation.
- Final 8-MiB bound requires whole-record deterministic reduction and correlation recomputation, not byte truncation.

## Requirements

- Create bundle schema v1 with every top-level section named in the design contract and deny unknown fields on fixture deserialization.
- Every source carries collection status, historicity, applicability/requiredness, counts/bytes, coverage, truncation/retention/rotation/drop indicators, and typed errors.
- Read fixed file handles only: regular/no-follow, read-only, 16-MiB/source, 16-KiB/line, 10,000 accepted records, 60-minute window. Never compact/repair/truncate/rotate/lock producer files.
- Preserve valid records around malformed lines while marking malformed count/status; partial tail, unknown schema/enum, invalid UUID, duplicate sequence, and unsupported legacy shape remain evidence gaps.
- Prove window coverage from producer start/sequence plus unit invocation evidence when available. Inability to distinguish rotation/retention is explicit `coverageUnknown`, never complete.
- Apply field allowlist/redaction before size calculation. Exclude terminal sources/tails and all forbidden categories.
- Correlate exact UUID into chains; report orphans, sequence gaps, restart boundaries, open chains, legacy ambiguity, duplicate IDs, and source offsets without diagnosis text.
- Deterministically sort and reduce whole records to <=8,388,608 bytes; mark impacted sources truncated and recompute correlations.
- Pure collector core accepts typed source results and clock/request; no filesystem globals, command execution, network, generic plugin registry, or output write.
- Tests use fixtures/temp files/fake clock. Keep tests for plausible failures: corruption, bounds, redaction, correlation, coverage, cap.
- Rollback: remove new pure modules; producer formats remain untouched. Bundles already written remain versioned evidence.

## Architecture

- `model.rs`: `DiagnosticBundleV1`, section DTOs, `SourceEnvelope<T>`, `CollectionStatus`, `Historicity`, `HistoricalCompleteness`, `BoundsV1`, `TypedCollectionError`, constants.
- `file_sources.rs`: separate `read_server_events`, `read_server_audit`, `read_helper_audit`, `read_backend_diagnostics`; shared private bounded-line primitive, not public source plugin.
- `redaction.rs`: source-specific projectors. Existing backend redactor is defense-in-depth, followed by allowlisted keys/source exclusion and byte caps.
- `correlation.rs`: normalize server/helper semantic records to `CorrelatableEvent`, exact join, independent producer continuity, restart/open/orphan classification, deterministic ordering.
- `collector.rs`: pure assembly, required-source completeness calculation, error aggregation, final-size loop and correlation recomputation.
- Requiredness follows Phase 01. Supporting/latest sources can be incomplete only with explicit per-source state; they never appear complete by omission.

## Related code files with modify/create/delete and dependency

| Action | Path/symbol | Planned change | Dependency |
| --- | --- | --- | --- |
| Create | `server/src/linux_release/diagnostics/mod.rs` | Focused exports only | All new modules |
| Create | `server/src/linux_release/diagnostics/model.rs` | Bundle/source/status/bounds/error DTOs and constants | Phase 01 schema |
| Create | `server/src/linux_release/diagnostics/file_sources.rs` | Four fixed no-follow bounded compatibility readers | Producer fixtures |
| Create | `server/src/linux_release/diagnostics/redaction.rs` | Explicit source-to-bundle projection | Privacy matrix |
| Create | `server/src/linux_release/diagnostics/correlation.rs` | UUID join, gaps/orphans/restarts/open-chain analysis | Event/helper schemas |
| Create | `server/src/linux_release/diagnostics/collector.rs` | Pure assembly/completeness/cap algorithm | Model/readers/projectors |
| Modify | `server/src/linux_release/mod.rs` | Declare module; avoid broad exports until Phase 06 | Modules compile |
| Modify | `server/src/idle_suspend/tests.rs` or new module-local tests | Stable producer fixtures consumed by compatibility readers | Phases 03–04 |
| Inspect only | `server/src/diagnostics/store.rs::{load_recent_from_file,recent_events}` | Do not call mutating compaction path | None |
| Delete | None | Existing diagnostics API/export remains | — |

## Implementation Steps

1. Implement exact bundle/source DTOs and fixed caps; serialize an empty role-aware fixture to establish stable field presence and camelCase names.
2. Build bounded read primitive using metadata/no-follow file handle, capped reverse/tail scanning without loading full file, line offsets, and explicit empty/missing/permission/oversize/tail states.
3. Add strict decoders for server events, legacy timing/manual audit, helper implicit-v1/v2, and backend diagnostics. Never use skip-malformed convenience readers for completeness.
4. Project each decoded type through explicit allowlists. Map free-form helper/outcome/inhibitor fields to codes; omit actor; exclude terminal diagnostics; bound remaining redacted text.
5. Derive coverage using requested window, first/last accepted timestamp, sequence/producer start, file metadata, and later unit invocation evidence. Unknown coverage is incomplete.
6. Normalize safe semantic records and join exact UUID. Classify `epoch-N` legacy automatic IDs unjoinable; never infer joins.
7. Detect sequence duplicate/gap per `(bootId, producerInstanceId)`, restart boundaries, orphan helper/server records, dispatch-without-outcome, intent-without-completion, and open attempt.
8. Sort deterministically by contract tuple. Assemble source metadata/errors and compute historical completeness from role/applicability/requiredness.
9. Serialize with counting; if over cap, evict oldest whole records in frozen priority, mark truncation, recalculate chains/errors, repeat. Metadata and privacy manifest are never removed.
10. Add fixtures for empty vs missing, malformed middle/tail, unknown versions/enums, permission error injection, >10,000 records, 60-minute edge, 16-KiB line, rotated/coverage-unknown, drops, gaps, restarts, orphan intent, legacy IDs, secrets, and 8-MiB boundary.
11. Run focused module tests: `cargo test -p dam-hopper-server linux_release::diagnostics`; review emitted fixture manually for schema/privacy and deterministic ordering.

## Todo list

- [ ] Add bundle/source/status/bounds models.
- [ ] Add four fixed bounded read-only JSONL adapters.
- [ ] Add explicit redaction/projectors.
- [ ] Add exact correlation/gap/restart engine.
- [ ] Add deterministic final-cap reduction.
- [ ] Complete fixture-driven schema/privacy review.

## Success Criteria

- Readable empty is `available` with zero records; missing/denied/malformed/unknown/partial-tail/coverage-unknown sources are distinct and cannot produce false completeness.
- Exact UUID chains reconstruct successful/rejected manual/automatic cases; restarts, sequence gaps, orphan intent, dropped events, rotation suspicion, and legacy `epoch-N` remain explicit discontinuities.
- Secret corpus proves no token, credential, argv/env, terminal bytes, address, inhibitor identity, raw frame, helper detail, journal message, or raw stderr survives projection.
- Every serialized fixture is valid JSON <=8 MiB; cap removal is deterministic, source truncation explicit, correlations match retained records.
- Source file content/metadata are unchanged after reads.
- `cargo test -p dam-hopper-server linux_release::diagnostics` passes using only fixtures/temp paths/fake clock.
- Schema/privacy/correlation review approves interfaces before Phase 06 host integration.

## Risk Assessment

- Reverse JSONL scan mishandles UTF-8/tail: operate on bounded bytes and validate complete lines; partial data is malformed evidence.
- Cap loop expensive: use counting serialization and bounded collections; 8 MiB/10,000 caps bound work.
- Legacy records falsely joined: only validated UUID exact match; legacy automatic IDs always ambiguous.
- Existing backend redaction misses a key: source allowlist and forbidden-corpus tests provide independent defense.

## Security Considerations

- Untrusted source text is parsed under line/depth/string caps before projection; raw malformed bytes never enter bundle/errors.
- Fixed readers reject symlink/non-regular files and never mutate source state.
- Bundle DTO contains no generic JSON passthrough for producer/helper/journal records.
- Correlation IDs and system identifiers are syntax/length validated before retention.

## Next steps

Phase 06 supplies role, EUID, fixed command, local API, current probe, and atomic output adapters around this pure core; it cannot weaken source statuses or redaction.

## Unresolved questions

None. New source types or fields require Phase 01 contract review.
