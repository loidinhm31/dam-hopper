# Phase 01 — Freeze architecture, schemas, source/privacy/durability matrix

## Context links

- [Plan](plan.md) · [Design contract](design-contract.md)
- [Approved brainstorm](../reports/brainstorm-260911-2355-production-idle-suspend-diagnostics.md)
- [Event/audit research](research/researcher-01-event-audit-contract.md) · [Collector research](research/researcher-02-collector-cli-contract.md)
- [Live architecture](../../docs/system-architecture.md) · [Code standards](../../docs/code-standards.md)
- [Prerequisite plan](../260910-1604-agent-activity-idle-suspend/plan.md)

## Overview

- Date: 2026-09-12
- Description: approve the future architecture in the live architecture document, verify installed path/role ownership, and freeze every downstream schema/security decision before code changes.
- Priority: P1
- Implementation status: approved/completed — 2026-09-12 (documentation/architecture only).
- Review status: Approved — the three-cycle architecture contract workflow passed; the third reviewer scored 10/10 with no findings.
- Effort: 12h
- Ownership: architecture owner edits `docs/system-architecture.md`; release owner validates layout/unit facts. No production Rust/test/deployment mutation in this phase.
- Dependency: none. Phase 02 canonical event foundation is complete
  (2026-09-13); Phases 03–07 remain future runtime instrumentation,
  collection, verification, and rollout work.

## Key Insights

- `ServerAuditRecord` is untagged timing/manual data; adding semantic variants makes legacy parsing ambiguous.
- Current automatic coordinator history is absent. Status/WebSocket are latest/revision hints only.
- Helper audit already owns durable intent and sync-before-RTC. A parallel helper log would duplicate authority.
- Deployed API `HOME`/`XDG_CONFIG_HOME`, fixed `/etc` config, helper `LogsDirectory`, and host role provide enough fixed source resolution; custom layouts must report unsupported, never be guessed.
- Research conflict around `notHistorical` is removed by two axes: collection status plus historicity.

## Requirements

- Copy the approved [design contract](design-contract.md) into a clearly marked planned/approved idle-suspend diagnostics section of live architecture before Rust mutation.
- Freeze event schema v1, helper audit schema v2, bundle schema v1, and unchanged helper protocol v1 independently.
- Freeze exact installed paths, role applicability, historical requiredness, redaction projection, durability classes, event/reason taxonomy, correlation lifecycle, mixed-version behavior, output paths, exit meanings, and rollback.
- Freeze internal bounds: 60 minutes; 10,000 accepted records/source; 8,388,608-byte final JSON; 16-KiB JSONL line; 16-MiB file scan/source; 2-MiB journal stdout/unit; 256-KiB API body; 512-byte retained redacted text; 256 source errors; 5-second fixed command/API deadlines.
- Required historical sources for `Server`/`Both`: server events, server audit, backend diagnostics, helper audit, both fixed unit journals, both unit lifecycle records. Latest API/current probes remain best effort. `Web` makes all idle sources `notApplicable`.
- Define `complete` only when role is known and all applicable historical sources have no missing/permission/malformed/unknown-version/truncation/retention/rotation/drop/unexplained-gap evidence.
- Non-goals: code, tests, deployment edits, UI, daemon, telemetry, upload, cap flags, arbitrary paths/commands, protocol bump, policy change.
- Rollback: revert only the planned architecture section if approval is withdrawn; no runtime state exists.

## Architecture

- Server writes a new tagged semantic stream at `/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl`; existing `/etc/dam-hopper/idle-suspend-audit.jsonl` stays timing/manual-only.
- Helper evolves `/var/log/dam-hopper/idle-suspend-helper.jsonl` in place. Existing action record names/fields survive; additive milestones use helper audit v2.
- `correlationId` is one UUID v4 allocated at attempt start and sent unchanged as protocol-v1 `requestId`; internal sampler IDs/revisions/epochs never identify an action.
- Only existing manual acceptance audit and helper accepted intent are required pre-action persistence gates. Semantic/post-action failure creates a gap and cannot change real suspend outcome.
- Collector uses fixed typed adapters, source-local statuses, pure projection/correlation, deterministic whole-record cap reduction, and atomic local output; no plugin registry or source mutation.
- Source schema and privacy tables in [design-contract.md](design-contract.md) are normative, not illustrative.

## Related code files with modify/create/delete and dependency

| Action | Path/symbol | Planned change | Dependency |
| --- | --- | --- | --- |
| Modify | `docs/system-architecture.md` — Server-Authoritative Terminal Idle Suspend Architecture/Key Invariants | Add approved planned producer→collector dataflow, version/path/source matrix, durability/privacy/rollback invariants; correct false implication that automatic server history already exists | Design contract review |
| Inspect only | `server/src/state.rs::AppState::new` | Confirm config-parent server audit and deployed diagnostics path derivation | None |
| Inspect only | `server/src/linux_release/{layout.rs,host_config.rs,inventory.rs,unit_policy.rs}` | Confirm fixed paths, role semantics, service ownership | None |
| Inspect only | `deploy/systemd/{dam-hopper-api.service.in,dam-hopper-idle-suspend-helper.service.in}` | Confirm `HOME`, `XDG_CONFIG_HOME`, fixed config/audit and state/log directories | None |
| Create | None | Architecture-first phase creates no new file beyond the live architecture edit | — |
| Delete | None | Preserve all compatibility docs/assets | — |

## Implementation Steps

1. Compare design path table against `Layout`, rendered unit policy, `AppState::new`, `DiagnosticStore::default`, and helper CLI defaults. Record mismatch as a blocking architecture amendment.
2. Add one planned/approved architecture subsection and dataflow: coordinator/server writer → protocol-v1 helper/in-place audit → one-shot typed collector → atomic local bundle.
3. Add four independent version constants and exact envelope/helper/bundle/status enums; state unknown versions are malformed evidence.
4. Add source applicability/requiredness table and two-axis status/historicity model. Explicitly show web-only `notApplicable`, unknown-role partial, root/non-root behavior.
5. Add privacy mapping and durability-point table. Name manual acceptance and helper intent as the only compatibility/safety gates; prohibit outcome rewriting after action.
6. Add fixed bounds and deterministic eviction order. Require correlations recomputed after eviction.
7. Add mixed-version rollback matrix: new/old server/helper/collector combinations, legacy `epoch-N` ambiguity, additive helper records, untouched evidence files.
8. Conduct architecture/security/release review. Any taxonomy/path/redaction/durability change updates design contract and live architecture together before approval.

## Todo list

- [x] Verify every installed path and owner from source/unit render output.
- [x] Freeze schemas, enums, limits, requiredness, redaction, durability, output and exits.
- [x] Add planned architecture section before production code.
- [x] Review mixed-version forward/rollback behavior.
- [x] Record architecture/security/release approval.
- [x] (2026-09-13 Amendment) Freeze normative 14-event to payload matrix, exact 26-reason subsets, bounds, and writer safety contract in design-contract.md and docs/system-architecture.md.

## Success Criteria

- Live architecture and plan-local contract agree field-for-field; review finds no second authority, hidden source, raw-data path, or unresolved requiredness.
- Path review proves API can create server events, helper retains root audit, root collector can read applicable sources, and non-root has a safe owned output directory.
- Existing observable unit contracts remain green when implementation executes `cargo test -p dam-hopper-server linux_release::unit_policy` and `cargo test -p dam-hopper-server --test linux_release_staging`; this phase does not run them during planning.
- Review gate explicitly blocks Phase 02 on any path ownership, mapping, version, role, or rollback ambiguity.

## Risk Assessment

- Path ownership differs from assumptions: amend deployment contract now; never add fallback scanning.
- Overlarge taxonomy: reject events not needed to reconstruct current coordinator/helper branches.
- Architecture claims code exists: identify the implemented Phase 02 producer
  foundation separately; keep coordinator instrumentation and collector
  sections planned until their phases verify implementation.
- Legacy reader break: require mixed-version fixtures in Phases 04–07 before rollout.

## Security Considerations

- Threat model covers symlink/path confusion, root/non-root boundaries, credential handling, shell injection, source poisoning, malformed JSON, prompt-like text, and bundle disclosure.
- Exact allowlists and redaction happen before serialization/size calculation.
- Architecture forbids terminal tails, argv/env, socket addresses, raw frames, inhibitor identity, journal messages, helper detail, and external egress.

## Next steps

Following the completed three-cycle approval, Phase 02 implemented the isolated
server event model/writer without changing paths, enums, limits, or durability.
Phase 03 may now integrate one writer into coordinator lifecycle boundaries;
later phases remain responsible for helper evolution, collection, verification,
and rollout.

## Unresolved questions

None after the review gate. A discovered mismatch reopens this phase and blocks downstream work.
