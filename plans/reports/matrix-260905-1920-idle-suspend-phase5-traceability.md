# Requirements-to-Test Traceability Matrix — Terminal Idle Suspend (Phase 05)

**Document ID:** `plans/reports/matrix-260905-1920-idle-suspend-phase5-traceability.md`  
**Date:** 2026-09-05  
**Branch:** `feat/terminal-idle-suspend`  
**Scope:** Phase 05 Integration, Release, Resume, and Rollback Evidence  

---

## 1. Overview

This traceability matrix maps functional, non-functional, security, and lifecycle requirements for Server-Authoritative Terminal Idle Suspend across the testing surface:
1. Pure coordinator & fleet deterministic race tests (`server/src/idle_suspend/tests.rs`)
2. Cross-module integration harness (`server/tests/idle_suspend.rs`)
3. Privileged helper, preflight, audit, and peer security tests (`server/src/idle_suspend/tests.rs`)
4. REST API, auth matrix, and error contract tests (`server/src/api/tests.rs`)
5. UI browser and unit regression tests (`packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx`, `packages/ui/src/components/organisms/*.test.tsx`)
6. Non-privileged boundary & manifest verifier (`scripts/verify-idle-suspend-boundary.sh`, `deploy/reset-linux-production.sh`)

---

## 2. Requirements-to-Test Mapping Matrix

| Req ID | Requirement Description | Verification Target | Test Suite / Script | Verification Method |
|---|---|---|---|---|
| **REQ-FLT-01** | Empty fleet triggers quiet timer | Fleet count 0 -> watching/armed | `server/tests/idle_suspend.rs`, `server/src/idle_suspend/tests.rs` | Fake-clock advancement to arm deadline |
| **REQ-FLT-02** | Live PTY cancels armed quiet timer | Fleet count > 0 -> cancels arm | `server/tests/idle_suspend.rs` | Spawn PTY while armed -> status returns to disabled/watching |
| **REQ-FLT-03** | Creating / Restart-pending PTY counts as active fleet | `creating_count` > 0 or `restart_pending` > 0 | `server/src/idle_suspend/tests.rs`, `server/src/pty/manager.rs` | Incarnation counter & fleet snapshot inspection |
| **REQ-FLT-04** | Natural PTY exit triggers empty fleet re-evaluation | Exit event -> fleet 0 -> quiet timer | `server/tests/idle_suspend.rs` | Child process exit notification -> coordinator evaluation |
| **REQ-FLT-05** | Explicit PTY kill/removal triggers fleet re-evaluation | PTY remove -> fleet 0 -> quiet timer | `server/tests/idle_suspend.rs` | SessionManager remove session -> coordinator evaluation |
| **REQ-FLT-06** | Stale incarnation callbacks ignored | Stale UUID/incarnation callback | `server/src/idle_suspend/tests.rs` | Stale generation event filtered out |
| **REQ-FLT-07** | Target unavailable does not false-count as live | Tombstones & disconnected UI do not count | `server/src/idle_suspend/tests.rs` | Mark target unavailable -> fleet count remains 0 |
| **REQ-ADM-01** | Pre-handoff timing update cancels arm and commits | PATCH /timing while armed | `server/tests/idle_suspend.rs`, `server/src/api/tests.rs` | Old arm canceled, atomic TOML written, re-arms with new duration |
| **REQ-ADM-02** | Post-handoff timing update rejected with 409 | PATCH /timing during handoff | `server/tests/idle_suspend.rs`, `server/src/api/tests.rs` | Returns `409 idleSuspendHandoffInProgress`, zero TOML mutation |
| **REQ-ADM-03** | Single-flight idle epoch enforcement | Only 1 suspend execution per epoch | `server/tests/idle_suspend.rs` | Executor invoked exactly once; subsequent checks suppress |
| **REQ-ADM-04** | Atomic pair persistence failure handling | Fault injection on registry write | `server/src/api/tests.rs`, `server/src/idle_suspend/tests.rs` | Atomic replacement failure reverts in-memory timing |
| **REQ-ADM-05** | Audit recording admission gate | Timing audit failure fails mutation | `server/src/idle_suspend/tests.rs` | Audit append error prevents in-memory state transition |
| **REQ-PRF-01** | Preflight inhibitor blocks suspend execution | Active inhibitor in systemd/logind | `server/src/idle_suspend/tests.rs` | Preflight returns `BlockedByInhibitor`, no suspend triggered |
| **REQ-PRF-02** | Preflight unsupported RTC/sysfs fails closed | Missing `/sys/class/rtc/rtc0/wakealarm` | `server/src/idle_suspend/tests.rs` | Status unavailable, zero suspend action executed |
| **REQ-PRF-03** | Peer authentication requires enrolled credentials | SO_PEERCRED / pid / uid validation | `server/src/idle_suspend/tests.rs` | Unauthorized peer rejected, recorded in helper audit |
| **REQ-PRF-04** | Frame deduplication prevents replay attacks | Duplicate `request_id` within window | `server/src/idle_suspend/tests.rs` | Replay rejected with `duplicateRequestId` |
| **REQ-SEC-01** | Zero sudo / shell execution in code | No invocation of `sudo` or `/bin/sh -c` | `scripts/verify-idle-suspend-boundary.sh` | Static pattern scan across server codebase |
| **REQ-SEC-02** | Audit boundaries strictly separated | Root audit (helper) vs Server audit | `scripts/verify-idle-suspend-boundary.sh`, `server/src/idle_suspend/tests.rs` | Distinct files, 0600 permissions, no leaking tokens |
| **REQ-SEC-03** | `--no-auth` development mode blocks timing mutation | `--no-auth` active -> 403/disabled | `server/src/api/tests.rs` | Rejection with `idleSuspendTimingDisabledNoAuth` |
| **REQ-SEC-04** | Alternate config routes cannot mutate idle suspend | `PUT /api/config` or import payload | `server/src/api/tests.rs` | Rejects payload altering `server.idle_suspend` |
| **REQ-API-01** | Status endpoint returns authoritative snapshot | `GET /api/system/idle-suspend/v1/status` | `server/src/api/tests.rs` | Valid schema, cache-control: no-store, revision match |
| **REQ-API-02** | WS push event invalidates status on change | `host:idleSuspendChanged` broadcast | `server/src/api/tests.rs`, `packages/ui/src/hooks/use-sse.test.ts` | Broadcast on revision change, UI cache invalidation |
| **REQ-UI-01** | Settings UI validates bounded timing pair | Inputs within [300..86400] and [60..86400] | `packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx` | Form validation, disables save on invalid input |
| **REQ-UI-02** | Settings UI handles 409 without auto-retry | Backend returns 409 conflict | `packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx` | Displays handoff message, mutation count = 1 |
| **REQ-UI-03** | Popover displays read-only status and outcome | Host resource popover idle section | `packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx` | Badges, next arm countdown, no input fields |
| **REQ-RES-01** | Post-resume capability & fleet reconciliation | Return from suspend -> re-probe | `server/tests/idle_suspend.rs` | Status refreshed, revision incremented, fleet re-read |
| **REQ-RES-02** | Resume does not auto-retry while fleet empty | Finished epoch retains one-shot latch | `server/tests/idle_suspend.rs` | No duplicate suspend while fleet remains empty |
| **REQ-ROL-01** | Rollback disables startup policy cleanly | Config `enabled = false` | `deploy/reset-linux-production.sh` | Verified server startup without idle suspend |
| **REQ-ROL-02** | Rollback does not clear external RTC alarms | Preserves unrelated RTC alarms | `deploy/reset-linux-production.sh` | Only owned request tracking inspected |

---

## 3. Risk & Mitigation Traceability

- **Flaky timing tests:** Mitigated by mock executors, deterministic fake monotonic clock, and explicit barriers.
- **Accidental host suspend in test:** Mitigated by `verify-idle-suspend-boundary.sh` and CI policy prohibiting privileged access. Real host canary requires explicit user confirmation.
- **Ambiguous write during rollback:** Mitigated by atomic tempfile replace and verified TOML syntax parser.
