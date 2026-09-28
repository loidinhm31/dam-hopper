---
title: "Agent status and notifications — OMP first"
description: "Add server-owned agent activity with a bundled OMP lifecycle adapter and profile-safe badges and notifications."
status: in-progress
priority: P2
effort: not-estimated
branch: main
tags: [feature, backend, frontend, api, security]
created: 2026-09-28
---

# Agent status — OMP first

## Goal

Deliver `unknown | idle | working | blocked` agent status and explicit turn-ended/needs-attention notifications. OMP is the first complete adapter; Codex/others can use the same contract later. Turn ended is not task success.

## Approved scope

- Rust service and private loopback listener inside existing `dam-hopper-server`; no Herdr dependency or separate daemon.
- OMP adapter source embedded in server binary; explicit install/update/uninstall once per chosen OMP profile.
- Per-browser-client history/toast/sound/browser notifications. No closed-browser delivery or cross-device exactly-once promise.
- Badge placement: terminal tabs, split tabs and Fleet terminal rows; preserve raw-output and process status.
- Linux runtime qualification first; preserve Windows compilation. Portable design is not Windows runtime qualification.
- No VT parser, Codex adapter, global plugin framework, workflow completion, suspend-policy change or telemetry redesign.

## Design contract

[Proposed architecture](../../docs/architecture/agent-status.md) is normative; Phases 01–03 implemented, Phases 04–05 pending.

- Scope credentials to terminal incarnation; inject only into private spawn environment, never persisted templates or public APIs.
- Persistent local reporter connection + 5-second state heartbeat / 15-second lease; close/expiry => unknown.
- Backend rejects stale reporter epochs/sequences; snapshots never imply completion.
- One app-root watcher per connected profile, owner/generation fences, silent reconnect baseline and bounded notification dedupe.
- OMP qualification target: observed version 18.3.5; no unverified historical or future-version promise.

## Phases

| # | Phase | Status | Progress | Dependency |
|---|---|---|---|---|
| 1 | [Semantic contract and reducer](./phase-01-semantic-contract-and-reducer.md) | Complete (2026-09-28) | 100% | None |
| 2 | [Reporter transport and PTY lifecycle](./phase-02-reporter-transport-and-pty-lifecycle.md) | DONE (2026-09-28) | 100% | 1 |
| 3 | [Bundled OMP adapter and installer](./phase-03-omp-adapter-and-installer.md) | DONE (2026-09-28) | 100% | 1–2 |
| 4 | [Profile-safe badges and notifications](./phase-04-profile-safe-ui-and-notifications.md) | DONE (2026-09-28) | 100% | 1–3 |
| 5 | [End-to-end and release qualification](./phase-05-end-to-end-qualification.md) | Pending | 0% | 1–4 |

## Completion gates

All [acceptance scenarios](./acceptance-scenarios.md) pass for qualified Linux delivery. Real OMP and browser evidence required, not only synthetic event tests. Existing Codex OSC9, shell suggestions, output/process status, workflow and suspend semantics remain intact. Server build/package embeds adapter without requiring OMP/Bun at Rust compile time. Phases 01, 02, and 03 are complete as of 2026-09-28; phases 04–05 remain pending.

## Evidence and review

- [Brainstorm](../reports/brainstorm-260928-0300-herdr-agent-status-adoption.md)
- [Report review and source corrections](./reports/report-review.md)
- [Validation record](./reports/plan-validation.md)
- [Phase 03 implementation review](../reports/code-review-260928-1233-phase-03-bundled-omp-adapter-and-installer.md): score 9.2/10; no critical issues, with two high-priority findings tracked in the phase risk notes.
- Planning skill and hard-command template loaded and followed inline; no slash-dispatch API exposed.
- Active-plan helper ran, but `EVCRATE_SESSION_ID` is absent; automatic session activation was not persisted. Use this path explicitly.

## Rollout / rollback

Deploy matched server/UI; install adapter as OMP's OS user; restart existing OMP sessions to load it. Enable OMP notification preference explicitly (default off); badges independent. Disable notifications/uninstall adapter to stop reports; no DB migration or workflow rollback. Old server API absence displays unsupported, not idle. Restore prior managed extension/server/UI on a release rollback.

## Validation Summary

**Validated:** 2026-09-28. **Questions asked:** 4.

### Confirmed Decisions
- Reporting loss => Unknown immediately on disconnect; 15-second silent-connection lease.
- OMP notifications opt-in; badges independent. Enabled notifications fire regardless of focus.
- Unified agent preferences; preserve Codex values by one-way migration.

### Action Items
- Phase 01–04 completed and reviewed (2026-09-28); proceed to Phase 05. Overall plan remains in progress pending Phase 05.

## Unresolved questions

No unresolved product decision. Phase 03 review found no critical issues but recorded two high-priority findings: inactive late `agent_end` can emit duplicate `turn-ended` reports, and CRLF line endings can misclassify managed extensions during update; both remain tracked in the phase risk notes. Real OMP event/reload behavior and packaged installer execution remain end-to-end qualification gates. Phases 01–03 completed 2026-09-28; phases 04–05 remain pending and full delivery remains in progress.
