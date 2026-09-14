# Phase 05 — Bundle model, bounded readers, redaction, source status and correlation engine

## Context links

- [Plan](plan.md) · [Design contract](design-contract.md) · [Phase 04](phase-04-helper-milestone-enrichment.md)
- [Collector research](research/researcher-02-collector-cli-contract.md) · [Producer research](research/researcher-01-event-audit-contract.md)
- `server/src/diagnostics/{store.rs,redaction.rs,types.rs}` · `server/src/idle_suspend/{event.rs,server_audit.rs,audit.rs}`

## Overview

- Date: 2026-09-12
- Description: build the pure bundle-v1 model, read-only bounded JSONL adapters, strict privacy projection, per-source completeness, deterministic correlation/gap analysis, and final-size reduction.
- Priority: P1
- **Implementation status:** DONE (2026-09-13; 100%; Cycle 2 verified)
- **Review status:** reviewed **9.5/10** in Cycle 2; approved with one minor unused `push_error` warning noted.
- Effort: 20h
- Ownership: diagnostics-domain owner creates `linux_release/diagnostics` pure modules. Phase 06 owns OS/API/command/output adapters after these interfaces freeze.
- Dependency: Phases 01–04 schemas and record fixtures approved.

## Completion record

- **Completed:** 2026-09-13.
- **Status:** DONE (100%; 6/6 todo items).
- **Progress:** 100% (6/6 todo items).
- **Review:** Reviewed **9.5/10** in Cycle 2.
- **Tests passed:** **202/202** (**16 diagnostics + 186 `idle_suspend`**).
- **Advisor lifecycle:** Canonical advisor lifecycle completed.
- **Evidence:** [Cycle 2 code review](../reports/code-review-260913-2327-phase-05-bundle-correlation-engine-cycle2.md).

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

## Todo list — 100% complete (6/6)

- [x] Add bundle/source/status/bounds models.
- [x] Add four fixed bounded read-only JSONL adapters.
- [x] Add explicit redaction/projectors.
- [x] Add exact correlation/gap/restart engine.
- [x] Add deterministic final-cap reduction.
- [x] Complete fixture-driven schema/privacy review.

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

1. Cycle 2 remediation completed and verified:
   - Replaced naive re-serialization in `reduce_to_cap` with batch/counting excess reduction and single final recomputation.
   - Wrapped reader in `.take(MAX_FILE_SCAN_BYTES)` and bounded line discard using zero-allocation buffer.
   - Fixed orphan classification in `correlation.rs` to treat all groups lacking `attemptStarted` as orphans.
   - Implemented duplicate sequence detection (`gap_size: 0`) and restart boundary `boot_id` lookup.
   - Removed `is_web` short-circuit in `evaluate_historical_completeness` so infrastructure sources are evaluated.
   - Added 16 unit & adversarial tests in `tests.rs` (16/16 passing).
2. Phase 06 supplies role, EUID, fixed command, local API, current probe, and atomic output adapters around this pure core.
## Unresolved questions

None. New source types or fields require Phase 01 contract review.
