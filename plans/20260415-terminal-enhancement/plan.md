---
title: "Terminal Enhancement: F-01 Process Lifecycle + Crash Fixes"
description: "Auto-restart engine, exit tracking, status dots; plus fixes for dead-session reconnect bug, FS/PTY channel coupling, silent exit, and reconnect UX."
status: pending
priority: P1
effort: 4-5d
branch: main
tags: [pty, lifecycle, terminal, websocket, backend, frontend]
created: 2026-04-16
---

# Terminal Enhancement — Implementation Plan

Combines **F-01 (Process Lifecycle Management)** with **4 crash fixes** from debug analysis into one ordered rollout.

## Source Docs

- [F-01 Feasibility & 5-Phase Plan](./f01-feasibility-plan.md)
- [Terminal Crash Root-Cause Analysis](./terminal-crash-debug.md)
- [Feature Backlog F-01 Spec](../report/2026-04-15-feature-backlog.md#L47-L73)

## Goals

1. Auto-restart on crash with exponential backoff, per-project policy in TOML.
2. Visible exit/restart state in UI (status dots, inline banners, restart count).
3. Fix dead-session reconnect bug blocking terminal recreation.
4. Decouple FS event pump overflow from PTY connection drops.
5. Make terminal create idempotent — auto-clean dead tombstones.

## Non-Goals (deferred)

- PID/CPU/memory reporting (portable-pty public API limitation → v2 via `sysinfo`).
- Health check polling (belongs in F-06 Dashboard).
- Keystroke buffering during WS reconnect gap (larger design effort).
- Dead-session TTL tuning (separate decision).

## Phases

| # | Phase | File | Status | Effort |
|---|---|---|---|---|
| 1 | Bug Fix A — Filter dead in reconnect check | [phase-01-fix-dead-session-reconnect.md](./phase-01-fix-dead-session-reconnect.md) | pending | 2h |
| 2 | F-01 Config Extension — RestartPolicy enum | [phase-02-config-restart-policy.md](./phase-02-config-restart-policy.md) | DONE | 4h |
| 3 | F-01 Session Metadata — restart_count, last_exit_at | [phase-03-session-meta-extension.md](./phase-03-session-meta-extension.md) | DONE | 4h |
| 4 | F-01 Restart Engine — reader_thread respawn + backoff | [phase-04-restart-engine.md](./phase-04-restart-engine.md) | pending | 8h |
| 5 | WS Events + Bug Fix B — enhanced exit event, FS/PTY channel split | [phase-05-ws-events-channel-split.md](./phase-05-ws-events-channel-split.md) | pending | 8h |
| 6 | Frontend — status dots, restart badge, Fix C banner, Fix D reconnect UX | [phase-06-frontend-lifecycle-ui.md](./phase-06-frontend-lifecycle-ui.md) | pending | 8h |
| 7 | Tombstone Idempotency — auto-clean on terminal:create | [phase-07-create-idempotency.md](./phase-07-create-idempotency.md) | pending | 3h |

**Total:** ~37h (4–5 days).

## Phase Dependency Graph

```
Phase 1 (Fix A, standalone)
  │
Phase 2 (config) → Phase 3 (session meta) → Phase 4 (restart engine) → Phase 5 (WS events)
                                                                            │
                                                     Phase 7 (idempotency) ─┤
                                                                            │
                                                                      Phase 6 (frontend)
```

Phase 6 consumes WS event shape from Phase 5 — Fix C banner text branches on `willRestart` field. Phase 7 simplifies Phase 1 logic (client no longer needs `alive` check once server auto-cleans).

## Test Matrix (Phase 4 Integration)

| Policy | Exit Code | Was Killed | Retries Left | Expected |
|---|---|---|---|---|
| never | 0 | no | - | dead, no restart |
| never | 1 | no | - | dead, no restart |
| on-failure | 0 | no | - | dead, no restart |
| on-failure | 1 | no | yes | restart w/ backoff |
| on-failure | 1 | no | no | dead + warn log |
| always | 0 | no | yes | restart |
| always | 1 | no | yes | restart |
| * | * | yes | * | dead, no restart |

## Top Risks

See individual phase docs. Major: FS/PTY channel separation (Phase 5), reader thread race on respawn (Phase 4).

## Unresolved Questions

1. ~~Default restart policy — `"never"` (explicit, recommended) vs `"on-failure"`.~~ **Resolved:** `"never"`.
2. ~~Reset restart_count on clean exit after restart? Recommended: yes.~~ **Resolved:** Yes, reset on clean exit (matches systemd/Docker semantics).
3. ~~Should Phase 7 idempotency replace Phase 1 fix entirely, or complement it (defense in depth)? Recommended: keep both.~~ **Resolved:** Skip Phase 1, do Phase 7 only (server-side fix is sufficient).
4. ~~FS event pump overflow — raise `CONN_CHAN_CAP` to 2048 OR separate channels? See Phase 5 decision.~~ **Resolved:** Separate channels (pty_tx + fs_tx, overflow drops FS subscription only).
5. ~~Should restart events also fire `terminal:changed` to refresh the session list? Likely yes.~~ **Resolved:** Yes, fire `terminal:changed` on restart.

## Validated Architecture Decisions

- **Restart engine pattern:** Supervisor task + mpsc channel (reader thread sends `RespawnCmd`, dedicated tokio task handles async sleep + respawn).
- **Session ID on respawn:** Reuse same session ID (frontend tab stays connected, receives banner + fresh output).

## Validation Summary

**Validated:** 2026-04-16
**Questions asked:** 7

### Confirmed Decisions
- Default restart policy: `"never"` — explicit opt-in, safest for dev-tool running arbitrary commands
- Restart counter reset: yes on clean exit (code=0) — matches systemd/Docker behavior, gives fresh retries
- Phase 1 vs Phase 7: **skip Phase 1**, only do Phase 7 (server-side tombstone cleanup is the permanent fix)
- FS/PTY channel split: separate channels with FS overflow dropping subscription only
- Supervisor task pattern (mpsc channel from reader thread to async supervisor)
- Reuse same session ID on respawn (no frontend tab navigation changes needed)
- Fire `terminal:changed` alongside `process:restarted` for dashboard/sidebar auto-refresh

### Action Items
- [ ] Remove Phase 1 from the phase table and dependency graph (saves ~2h)
- [ ] Update Phase 7 to note it is now the sole fix for Failure Mode 4 (no Phase 1 belt-and-suspenders)
- [ ] Update dependency graph: Phase 7 no longer references Phase 1 as a prerequisite complement
