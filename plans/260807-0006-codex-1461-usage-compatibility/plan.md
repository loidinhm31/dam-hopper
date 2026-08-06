---
title: "Codex 0.146.1 Usage compatibility"
description: "Prove and restore safe Codex 0.146.1 OTLP ingestion without weakening privacy or dedupe invariants."
status: in-progress
priority: P1
effort: 8h
branch: main
tags: [bugfix, backend, telemetry, compatibility, privacy]
created: 2026-08-07
---

# Codex 0.146.1 Usage compatibility

## Preflight contract

- **Output:** focused backend fixture, diagnostics, compatibility change, tests, provenance, rollout.
- **Accept:** sanitized 0.146.1 OTLP decodes and enters persistence as `unverified`; replay dedupes;
  no content/secrets; old fixture passes; live health identifies any remaining drop reason.
- **In:** `server/src/telemetry/codex_otlp`, Usage health tests, minimal architecture/API provenance.
- **Out:** UI, auth, DB migration/reset, PTY telemetry, app-server gate, verified-version promotion.
- **Contracts:** preserve loopback bearer auth, bounded decode/queue, HMAC identity, nullable tokens.
- **Test:** focused Rust, Usage API privacy, server check/full test, production smoke after restart.
- **Evidence gate:** closed by Phase 01 review (9/10, no critical issues). Real Codex 0.146.1
  capture has no trace/span or per-event identity; unsafe identity fallback is blocked.

## Recommendation and tradeoffs

| Option | Use when | Decision |
|---|---|---|
| A. Fixture/regression only | 0.146.1 has valid nonzero trace/span identity | Preferred; smallest compatibility change |
| B. Provider event-ID fallback | Trace/span absent and a stable unique provider event ID is proven | Conditional only; never receipt time/conversation ID |
| C. Reason-specific health | Current aggregate `dropped` cannot locate loss | Required additive diagnostics; no DB schema |

Implement C plus fixture first. Phase 1 evidence selects the explicit missing-identity blocker:
Codex 0.146.1 has no valid trace/span or per-event identity. Do not select B without new provider
evidence; do not use receipt time, conversation ID, or random IDs.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---:|---|
| 1 | Capture and sanitize 0.146.1 evidence | Completed | 2h | [phase 01](./phase-01-capture-and-sanitize-otlp-evidence.md) |
| 2 | Add bounded drop-reason health | Completed | 2h | [phase 02](./phase-02-add-drop-reason-health.md) |
| 3 | Implement evidence-selected compatibility | Blocked | 2h | [phase 03](./phase-03-implement-evidence-selected-compatibility.md) |
| 4 | Validate, deploy, smoke, rollback | Pending | 2h | [phase 04](./phase-04-validate-deploy-and-smoke.md) |

## Side-effect review

- [ ] Auth/permissions unchanged; receiver remains loopback-only and constant-time bearer checked.
- [ ] API change limited to additive bounded health counters required for diagnosis.
- [ ] No SQLite schema/migration/reset; existing telemetry data and HMAC key preserved.
- [ ] Token/session meaning unchanged; 0.146.1 remains `unverified`.
- [ ] No prompt, response, tool content, raw IDs, bearer, or config secret persisted/logged.
- [ ] Queue capacity, backpressure, 202/503 behavior, and worker concurrency unchanged.
- [ ] Provenance and API/architecture text updated; no onboarding/UI work.
- [ ] Restart uses existing release flow; rollback requires binary restart only.

## Dependencies

Phases 1 and 2 are complete. Phase 1 gates Phase 3, which remains blocked until Codex provides a
safe stable per-event identity. Phase 4 requires the remaining validation/deployment work and must
not reset `telemetry.db`. Existing unrelated worktree changes remain untouched.

## Unresolved questions

- A future Codex version may provide a safe per-event identity; current 0.146.1 does not.
- Which new reason counter increases in the production smoke: normalization, paused, queue full, or
  worker unavailable?
