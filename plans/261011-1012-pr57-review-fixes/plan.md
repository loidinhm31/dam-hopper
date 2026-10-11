---
title: "PR #57 agent-aware host auto-sleep review fixes"
description: "Close ten admission, semantic evidence, WebSocket, UI, and E2E correctness gaps without weakening fail-closed sleep policy."
status: complete
priority: P1
effort: 30h
branch: feat/host-resources-auto-sleep
tags: [bugfix, backend, frontend, security, testing]
created: 2026-10-11
---

# PR #57 review remediation

## Scope and authority
- Fix exactly issues 1–10 supplied by the PR review; implementation has not started under this plan.
- Source line ranges reference the researched branch snapshot; locate symbols again before editing.
- Ordinary pending plan; no controller runs, receipts, or completion claims initialized.
- Preserve the original [feature contracts](../261010-1746-host-resources-auto-sleep/contracts.md) and [acceptance matrix](../261010-1746-host-resources-auto-sleep/acceptance-matrix.md); prior qualification is historical, not evidence these defects are fixed.
- Read [code standards](../../docs/code-standards.md), [architecture](../../docs/system-architecture.md#semantic-agent-free-automatic-sleep), and [security boundaries](../../docs/terminal-idle-suspend-security.md).

## Phases
| # | Phase | Issues | Implementation / review / validation | Effort |
|---|---|---|---|---|
| 01 | [Coordinator admission and cooldown](phase-01-coordinator-admission-and-cooldown.md) | 1, 2, 3 | Complete / complete / passed | 10h |
| 02 | [Process retention and semantic freshness](phase-02-process-retention-and-semantic-freshness.md) | 4, 5, 6 | Complete / complete / passed | 10h |
| 03 | [WebSocket presence and backpressure](phase-03-websocket-presence-and-backpressure.md) | 7, 8 | Complete / complete / passed | 6h |
| 04 | [UI dialog and E2E fixtures](phase-04-ui-dialog-and-e2e-fixtures.md) | 9, 10 | Complete / complete / passed | 4h |

## Architecture invariants
- Only qualified DamHopper-managed lineage counts; live retained workers never become an empty/free inventory by omission.
- Semantic leases, free continuity, refusal cooldown, and socket liveness use monotonic time. Epoch timestamps display only.
- A free epoch is bound to its original non-free generation; fresh final tickets cannot launder intervening Working → Idle activity.
- Original approving socket/session must remain valid at dispatch commitment. Reconnects and surviving sibling sockets cannot inherit approval.
- Follow existing lock order: presence → PTY manager → semantic registry. No synchronous lock across await, procfs, database, or network I/O.
- Deny/timeout/disconnect require one new >10,800s continuously qualified-free interval, not a cooldown followed by a second interval.
- First valid decision wins arbitration; terminal cancelled/expired lifecycle overrides historical approved decision in UI.
- Data queues are count- and byte-bounded; overload closes/revokes the socket, never drops protocol data or blocks control reading indefinitely.

## Dependencies and execution
1. Freeze Phase 01 final-commit/presence-fence interfaces and Phase 02 evidence/time signatures before code edits.
2. Phase 02 evidence and Phase 03 registry/reader work are otherwise independent; Phase 01 integrates both before qualification.
3. Shared `client_presence.rs`: Phase 03 owns publication refactor; Phase 01 adds approved-connection commit fence on that contract. One integration owner merges shared edits.
4. Shared `reducer.rs`/`runtime.rs`: one Phase 02 owner implements all three evidence fixes; Phase 01 consumes its locked evaluation interface.
5. Phase 04 can prepare independently; real application checks run only after backend integration.
6. Main agent runs verification once after all changes land; no competing build/test/formatter runs during implementation.

## Delivery gate
- All ten issue-specific regression scenarios in phase files pass; qualifying scenarios must assert zero or exactly one helper dispatch, not status text alone.
- Run Rust targeted suites then full server suite; UI unit/build, E2E typecheck, isolated fixture probe and host-auto-sleep journey; record actual commands/results.
- Preserve legacy empty-fleet/agent-activity, manual sleep, authenticated transport, chunk ordering, and 100MiB file-operation behavior.
- Update existing architecture/API/security/testing docs and `docs/CHANGELOG.md` with measured behavior. Do not repeat unsupported end-to-end certification claims.
- No hardware suspend in developer/CI containers. Production fixture checks prove configured agent-free status/presence; deterministic Rust tests prove >3h decisions and dispatch races.

## Unresolved questions
- None blocking planning. Physical suspend/resume and sustained native-provider authority remain separate deployment qualifications; this plan does not manufacture them.
