# Phase 04 — Helper audit/capability/preflight/RTC/suspend milestone enrichment

## Context links

- [Plan](plan.md) · [Design contract](design-contract.md) · [Phase 03](phase-03-server-coordinator-instrumentation.md)
- [Producer/audit research](research/researcher-01-event-audit-contract.md)
- `server/src/idle_suspend/audit.rs` · `helper_server.rs` · `protocol.rs` · `helper_client.rs` · `backend.rs`
- `server/src/bin/dam-hopper-idle-suspend-helper.rs` · `deploy/systemd/dam-hopper-idle-suspend-helper.service.in`

## Overview

- Date: 2026-09-12
- Description: evolve the existing root helper audit in place with versioned producer identity/sequence and typed request, capability, preflight, intent, RTC, invocation, and outcome milestones while preserving protocol v1 and existing audit compatibility.
- Priority: P1
- Implementation status: pending
- Review status: privileged-helper security and mixed-version review required
- Effort: 18h
- Ownership: helper owner exclusively edits `audit.rs`, `helper_server.rs`, helper binary wiring, and helper-focused tests. Protocol owner confirms no wire change.
- Dependency: Phase 02 identity rules and Phase 03 exact UUID request propagation.

## Key Insights

- `HelperServer::handle_connection` already owns auth → frame → validation → dedupe → preflight → durable intent → RTC → suspend → completion ordering.
- `HelperAudit::record` already uses mode `0600`, `O_NOFOLLOW`, and `sync_all`; intent failure already prevents backend mutation.
- Current capability probes and intermediate milestones are missing. Existing free-form details/inhibitor identities are restricted and unsafe for bundle transfer.
- A second helper event file would duplicate authoritative actions. Add optional v2 metadata and milestone record types to the same file instead.

## Requirements

- Set `HELPER_AUDIT_SCHEMA_VERSION = 2` independently of server event/bundle/protocol versions.
- Extend newly written `HelperAuditRecord` lines with boot ID, producer instance UUID, checked producer sequence, typed reason/outcome codes, and correlation UUID when safely available.
- Retain established `recordType` values/fields for `acceptedIntent`, `executionCompleted`, and `executionRejected`; deserialize legacy implicit-v1 lines. Old readers may skip additive milestone lines but continue consuming established action lines.
- Add `requestRejected`, `capabilityResult`, `preflightResult`, `rtcProgrammingResult`, and `suspendInvoked` record types in the same audit file.
- Capability probe has null correlation under unchanged protocol v1. Auth/frame failures never fabricate a request ID; retain only numeric peer evidence and closed reason.
- Existing accepted intent remains the sole helper pre-action required record and `sync_all` gate. Preflight/milestone write failures consume sequence but do not block unless they are the accepted intent. Post-action failure never changes actual backend outcome/response.
- Map all `PreflightError`, RTC, dedupe, auth, protocol, and `SuspendOutcome` variants to closed codes. Keep legacy restricted `detail` only at source; collector never copies it.
- Keep `HELPER_PROTOCOL_VERSION = 1`, 4-KiB frame, request/response DTOs, validation, dedupe, socket and peer policy unchanged.
- Tests use temp audit/RTC files, fake preflight/backend/credentials, fake clock/identity; no real RTC/suspend/systemd.
- Non-goals: new helper command, event socket, log file/unit/service, raw stderr/journal detail, protocol correlation field for probes.
- Rollback: older helper binary can read established v2 action lines because fields are additive and may skip unknown milestone variants; preserve audit file. New server remains protocol-v1-compatible with old helper, while collector marks missing v2 milestones partial.

## Architecture

- `HelperAudit` owns producer identity and next sequence; `record` enriches a cloned logical record at append time so sequence allocation and write share one mutex.
- New logical constructors: `new_request_rejected`, `new_capability_result`, `new_preflight_result`, existing `new_intent`, `new_rtc_result`, `new_suspend_invoked`, existing `new_completed`/`new_rejected`. Each accepts only typed codes and bounded primitives.
- Newly emitted established action lines preserve `recordType`, `requestId`, `protocolVersion`, wake/peer/outcome compatibility fields; additive v2 fields are camelCase.
- Helper startup reads boot ID and creates instance UUID once. Initialization failure must not weaken accepted-intent audit: helper startup fails before serving if required audit identity cannot initialize; no synthetic identity.
- `handle_connection` treats non-intent milestone append errors as diagnostic gaps, continues authoritative flow, and never substitutes an audit error for a backend result after intent.
- `read_all_records` stays legacy-compatible. Phase 05 owns evidence-rich malformed/unknown-version reading and must not use the skip-on-error helper reader for completeness.

## Related code files with modify/create/delete and dependency

| Action | Path/symbol | Planned change | Dependency |
| --- | --- | --- | --- |
| Modify | `server/src/idle_suspend/audit.rs::{HelperAuditRecordType,HelperAuditRecord,HelperAudit}` | Add v2 optional metadata, identity/sequence, typed constructors/mappings, preserve legacy deserialize/action shape | Phase 01 schema |
| Modify | `server/src/idle_suspend/helper_server.rs::HelperServer::handle_connection` | Emit typed milestones at existing authoritative boundaries; preserve side-effect ordering | V2 writer |
| Modify | `server/src/bin/dam-hopper-idle-suspend-helper.rs::main` | Initialize one boot/producer identity and inject audit; keep existing fixed audit path/10,000 capacity | V2 writer |
| Modify | `server/src/idle_suspend/tests.rs` | Mixed v1/v2 records, auth/frame/dedupe/preflight/intent/RTC/suspend/outcome sequences and failure semantics | Helper changes |
| Inspect/no wire change | `server/src/idle_suspend/protocol.rs::{HelperRequestFrame,HelperRequestPayload,SuspendWithRtcWakeRequest,HELPER_PROTOCOL_VERSION}` | Prove unchanged serialized fixtures and UUID-valid request ID | Phase 03 UUID |
| Inspect/no behavior change | `server/src/idle_suspend/helper_client.rs`, `executor.rs`, `backend.rs` | Existing request/outcome path; map restricted strings only inside helper audit/collector | None |
| Inspect/no path change | `deploy/systemd/dam-hopper-idle-suspend-helper.service.in`, `server/src/linux_release/unit_policy.rs` | Preserve one helper process/file/path | None |
| Create | None | In-place audit evolution | — |
| Delete | None | Preserve existing audit and protocol | — |

## Implementation Steps

1. Add audit-v2 version, helper producer identity, checked sequence, closed reason/outcome enums, optional v2 fields with serde defaults for legacy records.
2. Make `HelperAudit::new` production-compatible and add deterministic identity/clock constructor. Startup validates fixed parent/file ownership and boot ID before binding/serving.
3. Refactor `record` minimally: reserve sequence, populate v2 metadata on new logical record, enforce line/record bounds, append mode `0600` no-follow, newline, `sync_all`, prune within existing 10,000 behavior without obscuring retention.
4. Preserve byte-level names/values required by legacy established action records. Add mixed fixture proving old implicit-v1 and new action lines parse; unknown milestone is skipped only by simulated old reader, not destructive.
5. Emit typed rejection after auth/frame/validation/dedupe when safe. Invalid/untrusted frames have null correlation and no raw bytes/detail in new fields.
6. Emit capability and preflight results. Map inhibitor identity to `inhibitorPresent` only; map unsupported/RTC busy/probe failure exhaustively.
7. Keep accepted intent after successful preflight and before RTC as required `sync_all`. On failure, send execution failure and call neither `program_rtc_wake` nor `trigger_suspend`.
8. Emit RTC result, then best-effort `suspendInvoked`, then execute backend, capture real result, best-effort completion. Never overwrite result when completion append fails.
9. Test all branches plus failure injection at each write point, producer sequence gap/restart, prune boundary, v1/v2 compatibility, unchanged protocol frame bytes/version/size.
10. Run focused commands: `cargo test -p dam-hopper-server idle_suspend::tests::helper_`, protocol-focused tests, and helper binary unit target if present. Complete privileged-helper/security review.

## Todo list

- [ ] Add helper audit v2 metadata and typed milestone variants.
- [ ] Initialize helper producer identity once.
- [ ] Instrument auth/capability/preflight/intent/RTC/invocation/outcome boundaries.
- [ ] Preserve intent fail-closed and post-action outcome truth.
- [ ] Add mixed-version/fault tests and unchanged protocol fixtures.
- [ ] Complete privileged/mixed-version review.

## Success Criteria

- Successful request yields ordered v2 records sharing exact Phase 03 UUID: preflight, accepted intent, RTC result, suspend invoked, execution completed; established action fields remain readable.
- Capability probe produces typed result without invented correlation. Auth/frame/dedupe/preflight failures expose safe closed reasons and invoke no forbidden backend step.
- Accepted-intent append/sync failure invokes neither RTC nor suspend. RTC failure invokes no suspend. Completion append failure still returns the actual backend outcome.
- Helper restart changes producer instance and restarts sequence at 1; pruning/sequence loss remains detectable.
- Protocol-v1 serialization, 4-KiB cap, request validation, dedupe, socket path, audit path, and single helper service are unchanged.
- Focused fake-backed tests pass; no automated case manipulates host RTC/suspend/service/audit.
- Security review approves ordering, redaction boundary, and rollback matrix before Phase 05.

## Risk Assessment

- Additive enum lines break strict old readers: keep established action lines present and prove old-reader behavior; rollout helper before relying on milestones, collector marks legacy partial.
- Audit pruning may hide sequence history: include retention metadata and let collector classify boundary gaps separately.
- Best-effort milestone failure invisible at process end: missing terminal milestone/open chain remains partial; do not add another log.
- Boot identity startup failure reduces availability: fail before serving rather than execute privileged action with fabricated audit identity.

## Security Considerations

- Preserve peer authentication, one-frame cap, deny-unknown validation, dedupe, preflight, fixed backend, and intent-before-mutation order.
- Never place inhibitor `who/why/description`, raw frame, error string, command stderr, credentials, socket addresses, argv/env, or terminal data in v2 typed fields.
- Root audit remains `0600`, no-follow, synchronized, bounded; collector receives only projected safe values.
- Protocol request ID is correlation, not authorization; SO_PEERCRED/enrollment remains authority.

## Next steps

After helper fixtures and mixed-version review freeze, Phase 05 implements read-only compatibility readers, bundle projection, and deterministic correlation/gap analysis.

## Unresolved questions

None. Any need to change protocol v1 or create a second helper log returns to Phase 01 and blocks release.
