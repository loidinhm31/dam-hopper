---
title: "Live Usage Insights Settings"
description: "Replace manual telemetry and Codex OTel setup with a safe Settings workflow that applies DamHopper changes live."
status: in-progress
priority: P1
effort: 20h
branch: main
tags: [feature, frontend, backend, api, security]
created: 2026-07-26
---

# Live Usage Insights Settings Plan

## Overview

Provide a guided Settings flow for terminal usage analytics and optional Codex token telemetry. DamHopper activates/deactivates its store and loopback collector live; no DamHopper restart. Codex exporter setup is atomically managed only when no competing OTel exporter exists. A restarted/new Codex process remains required because Codex reads OTel configuration at startup.

## Preflight Contract

- Output: Settings > Usage insights section, live runtime lifecycle, managed Codex OTel setup/status, protected API contracts, tests/docs.
- Acceptance: one action enables terminal telemetry and optional Codex setup without token copy or DamHopper restart; data appears after a new managed terminal/Codex process; disable stops capture live; conflicts never overwrite user OTel configuration.
- Scope: local settings, runtime telemetry/collector lifecycle, `~/.codex/config.toml` management, aggregate health/status. Out: remote export, host-wide capture, token display, changing Codex hot-reload behavior.
- Risks: auth, config ownership, bearer secrecy, worker/collector stop ordering, PTY capture boundary, config compatibility.
- Tests: Rust lifecycle/API/filesystem tests; UI unit + browser settings flow; focused live smoke.
- Open questions: none. Codex restart requirement is explicit product behavior, not a server restart.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---:|---|
| 1 | Runtime lifecycle and API | completed (2026-07-26 15:21 +07) | 8h | [phase 01](./phase-01-live-runtime-and-api.md) |
| 2 | Managed Codex exporter | completed (2026-07-26 15:50 +07) | 5h | [phase 02](./phase-02-managed-codex-exporter.md) |
| 3 | Settings UX and client contracts | pending | 4h | [phase 03](./phase-03-settings-ux.md) |
| 4 | Verification and documentation | pending | 3h | [phase 04](./phase-04-verification-and-docs.md) |

## Side-Effect Review

- Auth: setup/status mutations remain protected by existing API auth; no-auth remains local-only.
- Data: existing telemetry is retained; disabling stops future capture only.
- Security: API never returns collector secret or raw Codex config; reject conflicting exporters; atomic 0600 writes.
- Concurrency: serialize reconfigure/delete/retention/collector transitions; never hold locks over awaits; drain worker before replacement.
- Compatibility: preserve manual TOML configuration; only modify managed `otel.exporter` value when exact ownership is provable.
- UX: disabled, active, conflict, failure, and Codex-restart-needed states are visible and keyboard accessible.
- Docs: architecture, API, configuration, and onboarding must state live-server versus Codex-process restart semantics.

## Decision Record

- Recommended: a shared `TelemetryRuntime` proxy used by PTY creation and APIs. It permits live state changes and keeps PTY writes non-blocking.
- Rejected: server restart after config write. It defeats the Settings workflow.
- Rejected: overwriting an existing Codex OTel exporter or exposing/copying its bearer secret through the UI.
- Rejected: mid-session terminal capture activation. Users open a new DamHopper terminal after enabling; this preserves complete run boundaries.
