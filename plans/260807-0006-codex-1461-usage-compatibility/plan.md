---
title: "Codex 0.146.1 Usage compatibility"
description: "Restore Codex 0.146.1 OTLP ingestion with an explicitly bounded compatibility fallback."
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
  capture has no trace/span or per-event identity. The user selected the bounded fallback below,
  accepting its documented same-payload collision limitation.

## Recommendation and tradeoffs

| Option | Use when | Decision |
|---|---|---|
| A. Fixture/regression only | 0.146.1 has valid nonzero trace/span identity | Preferred; smallest compatibility change |
| B. Provider event-ID fallback | Trace/span absent and a stable unique provider event ID is proven | Conditional only; never receipt time/conversation ID |
| C. Reason-specific health | Current aggregate `dropped` cannot locate loss | Required additive diagnostics; no DB schema |
| B2. Bounded decoded-event fallback | Trace/span absent and the operator explicitly accepts weaker dedupe | Selected; HMAC only bounded decoded fields, never raw content |

Implement C plus fixture first. Phase 1 evidence identifies the missing-identity blocker. The user
selected B2: use a domain-separated HMAC over bounded decoded event fields as a compatibility
identity when trace/span are absent. Preserve real trace/span precedence, strict timestamp checks,
and `unverified` source quality. This intentionally permits identical same-millisecond events with
identical decoded fields to dedupe as one event; do not use receipt time, conversation ID alone, or
random IDs.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---:|---|
| 1 | Capture and sanitize 0.146.1 evidence | Completed | 2h | [phase 01](./phase-01-capture-and-sanitize-otlp-evidence.md) |
| 2 | Add bounded drop-reason health | Completed | 2h | [phase 02](./phase-02-add-drop-reason-health.md) |
| 3 | Implement evidence-selected compatibility | Completed | 2h | [phase 03](./phase-03-implement-evidence-selected-compatibility.md) |
| 4 | Validate, deploy, smoke, rollback | Pending | 2h | [phase 04](./phase-04-validate-deploy-and-smoke.md) |

## Side-effect review

- [ ] Auth/permissions unchanged; receiver remains loopback-only and constant-time bearer checked.
- [ ] API change limited to additive bounded health counters required for diagnosis.
- [ ] No SQLite schema/migration/reset; existing telemetry data and HMAC key preserved.
- [ ] Token/session meaning unchanged; 0.146.1 remains `unverified`.
- [ ] No prompt, response, tool content, raw IDs, bearer, or config secret persisted/logged.
- [ ] Missing trace/span uses only a bounded, domain-separated HMAC fallback; collision limitation
      is documented and accepted for this compatibility path.
- [ ] Queue capacity, backpressure, 202/503 behavior, and worker concurrency unchanged.
- [ ] Provenance and API/architecture text updated; no onboarding/UI work.
- [ ] Restart uses existing release flow; rollback requires binary restart only.

## Dependencies

Phases 1–3 are complete. Focused Codex OTLP validation passed (37 tests), Usage health regression
passed, `cargo check` passed, the release binary was built, and live ports 4800/4811 accepted
unverified Codex 0.146.1 events with nonzero Usage response/token totals. Phase 4 remains pending
until the broad backend suite and a stable helper-driven restart are fully verified; it must not
reset `telemetry.db`. Existing unrelated worktree changes remain untouched.

## Unresolved questions

- A future Codex version may provide a safe per-event identity; current 0.146.1 does not, so its
  events use the bounded fallback until a provider identity is available.
- Identical decoded payloads received in the same millisecond can collide under the fallback; this
  is the explicit tradeoff for restoring Usage visibility.
- Which new reason counter increases in the production smoke: normalization, paused, queue full, or
  worker unavailable?
