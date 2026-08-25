---
title: "Terminal Usage Analytics"
description: "Add privacy-preserving terminal lifecycle analytics and optional Codex token telemetry with a server-only SQLite dashboard."
status: completed
priority: P2
effort: 232h
branch: main
tags: [feature, backend, frontend, database, api, security]
created: 2026-07-18
---

# Terminal Usage Analytics Plan

## Overview

Track validated activity only in DamHopper-managed interactive PTYs. Persist no raw commands or AI content. Use separate `telemetry.db`, authenticated aggregate APIs, a compact `/usage` page, and optional loopback Codex OTel ingestion that adds no MCP/model calls.

## Fixed decisions

- Scope: integrated top-level Bash/Zsh/Fish PTYs; no host-wide, nested-shell, or SSH auditing.
- Raw command, argv, cwd, env, PTY output, prompt, response, tool content, and raw OTLP: never persisted.
- Detail retention: configurable, default 90 days; longer daily aggregates.
- Missing/partial/approximate data remains visible; never converted to zero or exact attribution.
- Codex compatibility is field-based: newer/unverified versions with known `response.completed` core fields remain usable; version alone never hard-rejects an event.
- No productivity ranking or cost claims.
- Terminal analytics opt-in on upgrade; Codex collector separately opt-in.

## Phases

| # | Phase | Status | Effort | Dependency |
|---|---|---|---:|---|
| 1 | [Contracts, config, OTLP spike](./phase-01-contracts-config-otlp-spike.md) | Complete (2026-07-26) | 24h | None |
| 2 | [Validated shell lifecycle capture](./phase-02-validated-shell-lifecycle-capture.md) | Complete (2026-07-26) | 32h | 1 |
| 3 | [SQLite store, retention, privacy](./phase-03-sqlite-store-retention-privacy.md) | Complete (2026-07-26) | 40h | 1-2 |
| 4 | [Aggregate API and controls](./phase-04-aggregate-api-and-controls.md) | Complete (2026-07-26; approved with warnings) | 32h | 3 |
| 5 | [Codex loopback OTel adapter](./phase-05-codex-loopback-otel-adapter.md) | Complete (2026-07-26; approved) | 32h | 1, 3-4 |
| 6 | [Usage UI and compact navigation](./phase-06-usage-ui-and-compact-navigation.md) | Complete (2026-07-26; approved) | 40h | 4-5 |
| 7 | [Security, fault, performance, docs](./phase-07-security-fault-performance-docs.md) | Complete (2026-07-26) | 32h | 1-6 |

## Delivery gates

1. Do not select OTLP dependency until a baseline binary fixture decodes correctly; that fixture locks transport/core behavior, not accepted Codex versions.
2. Do not enable persistence until PTY backpressure/failure tests prove non-blocking behavior.
3. Do not expose API/UI until DB/API secret scans pass.
4. Do not enable Codex cards until baseline token semantics and replay dedupe pass fixtures. Future-version fixtures improve confidence; they do not gate ingestion when known core fields still decode.
5. Do not add rollup complexity beyond required post-90-day daily counts/tokens.

## References

- [Brainstorm report](../reports/brainstorm-260718-1045-terminal-usage-analytics.md)
- [Architecture gate](./reports/architecture-gate-report.md)
- [Repository scout](./scout/scout-01-repository-touchpoints.md)
- [Shell/SQLite research](./research/researcher-01-shell-sqlite-report.md)
- [Codex/UI research](./research/researcher-02-codex-ui-report.md)

## Unresolved questions

- Validation interview may adjust opt-in defaults, aggregate retention, and timezone display before implementation.

## Validation Summary

**Validated:** 2026-07-18  
**Questions asked:** 4

### Confirmed Decisions

- Terminal analytics: opt-in everywhere, including new installs and upgrades.
- Codex setup: DamHopper may manage the exporter only after an explicit user confirmation; never silently overwrite `~/.codex/config.toml`.
- Daily aggregates: unlimited by default because they contain no command/AI content; users must be able to delete a selected date range as well as delete all.
- Codex attribution: approximate and unattributed events are acceptable when confidence/availability is visible.

### Action Items

- [x] Phase 04: add authenticated range-delete semantics with UTC bounds, confirmation, and rollup handling (completed 2026-07-26; approved with warnings).
- [x] Phase 05: add explicit-confirmation, ownership/conflict checks, atomic rollback for managed Codex config sync; keep snippet-only fallback (not needed: Phase 05 provides setup status/instructions and does not modify Codex configuration).
- [x] Phase 05: implement field-level forward compatibility, safe drift health signals, and partial/unavailable coverage without raw attribute retention or synthetic zero (completed 2026-07-26; approved).
- [x] Phase 07: document unlimited aggregate retention and range deletion in the runbook/UI copy (completed 2026-07-26).

### Release follow-ups

- Live HMAC rotation/reset and settings/retention/delete coordination are implemented and covered.
- External Zsh/Fish PTY, IME, screen-reader, and renderer/browser checks remain environment-dependent.
