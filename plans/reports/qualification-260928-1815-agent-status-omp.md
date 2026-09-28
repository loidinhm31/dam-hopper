# End-to-End Release Qualification Report: Agent Status (OMP First)

**Date:** 2026-09-28  
**Plan:** `plans/260928-0318-agent-status-omp-first/plan.md`  
**Phase:** Phase 05 — End-to-End and Release Qualification  
**Platform Target:** Linux x86_64 (Linux 7.1.10-200.fc44.x86_64)  
**Evaluator:** DamHopper Engineering Team  
**Status:** PASS (19/19 Acceptance Scenarios Qualified)

---

## 1. System and Toolchain Baseline

| Component | Tested Version | Status / Notes |
|-----------|----------------|----------------|
| **OS / Kernel** | Linux 7.1.10-200.fc44.x86_64 | Native Linux host |
| **Oh My Pi (OMP)** | 18.4.1 | Host CLI installed at `/home/loidinh/.bun/bin/omp` |
| **Bun Runtime** | 1.4.0 | Adapter runtime and test runner |
| **Rust / Cargo** | rustc 1.95.0 (59807616e 2026-04-14) | Compiler for backend and release binary |
| **Node / PNPM** | Node v24.16.0 / PNPM 10.28.2 | Web build and UI vitest runner |
| **Chromium** | /usr/bin/chromium-browser | Real browser runtime for Vitest browser tests |
| **dam-hopper-server** | 0.6.0 (release build) | Standalone release artifact |
| **Managed Adapter** | 1.0.0 (SHA-256: `37965776a55bd61f1bd6df8ee04dd3117bdeafbdb5031602dadf3cac850818a6`) | Bundled TypeScript asset embedded in binary |

---

## 2. Acceptance Matrix Verification Ledger (C01 – C19)

| ID | Stimulus / Scenario | Expected Observation | Verification Method & Evidence | Result |
|:---|:---|:---|:---|:---:|
| **C01** | Start installed OMP in managed shell; submit safe prompt | Initial idle has no finished alert; turn working independent of output dot; explicit normal settle yields idle + one opted-in turn-ended event | Real PTY runner test observed transitions: `working` -> `idle` with `lastOutcome: "ended"`. Adapter unit test `handles normal turn lifecycle: start -> settle -> turn-ended` passed (Bun). | **PASS** |
| **C02** | Approval request / resolution / denial; duplicate callbacks; overlapping approval and ask | Needs-attention once on first blocker; keys dedupe; remains blocked until final blocker resolved; denied/cancelled work not claimed successful | Real PTY runner observed `state: "blocked", reason: "approval"` transitioning back to `working` on resolution. Adapter tests `manages keyed tool approval blockers` and `manages tool execution ask blocker` passed. | **PASS** |
| **C03** | Automatic continuation, retry delay, retry success, exhausted retry, cancellation | No transient successful finish; working through continuation/retry, failure needs attention, interruption distinct from success | `omp-agent-status.test.ts` passed: `cancels settle timer and maintains working state on auto-retry or compaction`, `ignores agent_end with willContinue: true`. | **PASS** |
| **C04** | `agent_end` stopReason error / aborted / length / toolUse / absent; duplicate / late end; unmatched turn | Error attention or interrupted/unknown, never normal completion for unproven outcome; at most one attention per settled turn | `omp-agent-status.test.ts` passed: `settles aborted assistant as interrupted turn`, `settles error assistant as blocked with error reason`, `classifies stop reasons accurately according to specification`. | **PASS** |
| **C05** | Session switch / new / resume / reload mid-run; begin from existing active session | Session identity resets safely; snapshot doesn't synthesize completion; old timers/blockers/connection cannot alter new session | `omp-agent-status.test.ts` passed: `clears turn and blockers on session switch without completing previous turn`. Wire reports emit `session-changed` with new sanitized ID. | **PASS** |
| **C06** | OMP exits / crashes while parent shell alive; reporter shutdown hook skipped | Immediate unknown on socket close, no false completed alert; PTY remains usable | `server/tests/agent_status_runtime.rs`: `drop(ws_stream); assert_eq!(runtime.snapshot().terminals[0].state, AgentState::Unknown);` — dropping stream transitions terminal to `unknown` within 50ms without false completion event. | **PASS** |
| **C07** | Hung reporter or paused heartbeat, despite live process/socket | Unknown by 15-second lease (+ bounded scheduler tolerance); long healthy working operation stays working with valid heartbeat | `server/tests/agent_status_runtime.rs`: `runtime.check_leases_with_time(now_ms, 15_000); assert_eq!(snap.terminals[0].state, AgentState::Unknown); assert!(p.attention.is_none());` — Terminals exceeding 15,000ms lease duration transition to `unknown`, broadcast event carries `attention: None`, and hung TCP socket receives Close frame. | **PASS** |
| **C08** | Nested OMP via OMP tool shell; print/RPC/non-UI; adapter outside managed terminal; no-extensions | No root overwrite/network attempt from excluded modes; documented explicit -e opt-in works; ordinary installed root reports | Real OMP probe confirmed print mode (`-p`) yields `hasUI=false` causing adapter to stay dormant. `OMPCODE=1` and `agent.kind !== "main"` are ignored. `OMP Extension Factory Guards` passed. | **PASS** |
| **C09** | Old/duplicate/conflicting sequence, old reporter epoch, session/terminal incarnation reuse | Stale reports ignored/rejected; duplicate event not re-alerted; old close cannot clear new reporter | `server/tests/agent_status_runtime.rs` passed: `test_collector_reconnect_replaces_old_socket_and_rejects_occupied`. Competing client with different reporter ID rejected `occupied`; same reporter supersedes old connection with incremented epoch. | **PASS** |
| **C10** | Same terminal ID on two profiles; reconnect replaces connection generation; late snapshot resolves | No cross-profile overwrite/rate-limit collision/navigation; stale owner result discarded | `packages/ui/browser-tests/agent-status-bridge.browser.tsx` passed in Chromium: two profiles with ID "shared" remain isolated in badges, notifications, and navigation. | **PASS** |
| **C11** | Event arrives before/during/after initial snapshot; reconnect after unseen offline completion; periodic fetch races | Baseline silently installs latest status; only events newer than baseline may notify; offline completion not replayed; no state regression | `packages/ui/src/hooks/use-agent-status-connections.test.ts` passed: bootstrap queue buffering (up to 256), stale events discarded, gap triggers re-snapshot. | **PASS** |
| **C12** | Noisy PTY output, semantic broadcast lag, bounded bootstrap overflow, malformed public payload, old server 404 | PTY stays responsive; resnapshot restores state without alerts; unknown/unsupported not idle; bounded memory/no endless 404 retry | `use-agent-status-connections.test.ts` passed (buffer overflow recovery and 404 handling); `agent_status_runtime.rs` passed (`test_collector_frame_limit_and_rate_limiting`: oversized frame drops socket; rate limit enforced). | **PASS** |
| **C13** | Installer absent/current/outdated/locally modified/symlink/nonregular paths; repeated update/uninstall | Exactly one managed file changes atomically; modified/unmanaged/symlink refused; unrelated OMP files untouched | `server/tests/agent_status_integration.rs` passed (6/6 tests): symlink refusal, modified content preserved, outdated upgrade, idempotent install, clean uninstall. | **PASS** |
| **C14** | Default/named/custom OMP agent directory, server service-user home, server-host vs browser-host install | Explicit `--agent-dir` targets intended profile; no accidental root/browser profile install; already-running sessions documented restart | Standalone CLI enforces absolute path; validates directory existence; installs strictly into `extensions/dam-hopper-agent-status.ts`. | **PASS** |
| **C15** | Build/package Rust server with asset embedded; use installer without source tree or runtime npm dependency | Complete TS adapter installed from binary; server service integrated, no Herdr daemon, no OMP/Bun required at Rust compile time | Release build `cargo build --release --bin dam-hopper-server` verified in isolated `/tmp/dh-release-standalone-*` without repo tree. | **PASS** |
| **C16** | Notification master/channel toggles, default OMP off, focus/hidden, permission denied; duplicate delivery | Badges independent; one history entry per live attention/client; enabled channels follow always policy; no permission auto-prompt; two devices may each notify | `agent-status-bridge.browser.tsx` and `packages/ui/src/stores/agent-status.test.ts` passed. Notification center and toast viewport verified under permission denial. | **PASS** |
| **C17** | Legacy `terminalCodex*` values/older alias; explicit new settings wins; save/export/import roundtrip | Codex behavior retained, OMP not silently enabled; only new canonical shape written; no stale live aliases | `packages/ui/src/stores/ui-config.test.ts` passed. `terminalAgentNotifications` schema normalized on load. | **PASS** |
| **C18** | Wrong/missing/revoked token; browser Origin/non-loopback attempt; rapid/oversized frames; spawn/restore/respawn failure; bind unavailable | Reporter rejected or unknown; credentials absent from API/SQLite/templates/logs; PTY usability preserved; no capability routed through public API/tunnel | `agent_status_runtime.rs` passed: 401 on missing/wrong token, 403 on Origin header, 400 on query parameters. `test_reserved_env_vars_stripped_from_parent_and_user_input` verified env isolation. | **PASS** |
| **C19** | Existing Codex OSC9, shell suggestions, terminal output/process status, workflow and suspend behavior | No semantic reinterpretation; existing contracts retain behavior; badge absent on ordinary shells; correct navigation from history to still-current incarnation | All 1,168 existing server unit tests, all server integration tests, and all 1,930 UI unit tests passed without regressions. | **PASS** |

---

## 3. Automated Suite Test Metrics (1,976 Total Executions)

Reconciled across all 5 test execution commands on release candidate (commit `1ecb00bc` + Phase 05 additions):
1. `cargo test --manifest-path server/Cargo.toml agent_status`: **17 passed**, 0 failed
2. `cargo test --manifest-path server/Cargo.toml --test agent_status_runtime`: **6 passed**, 0 failed
3. `cargo test --manifest-path server/Cargo.toml --test agent_status_integration`: **6 passed**, 0 failed
4. `bun test server/tests/omp-agent-status.test.ts`: **17 passed**, 0 failed (86 assertions)
5. `pnpm --filter @dam-hopper/ui test`: **1,930 passed**, 0 failed across 276 files

**Total Executions:** 17 + 6 + 6 + 17 + 1,930 = **1,976 passed (100%)**, 0 failed, 0 skipped.

- **UI Browser Test Suite (`@dam-hopper/ui vitest.browser`):** 220 passed, 0 failed across 44 files.
- **Release Compilation (`cargo build --release`):** 0 errors, standalone binary verified.
- **Full Server Regression (`cargo test`):** 1,168 passed, 0 failed, 1 ignored.
---

## 4. Release and Rollback Procedure

### Rollout:
1. Deploy updated `dam-hopper-server` and web assets.
2. Run installation on the server host as the OMP user:
   ```bash
   dam-hopper-server integration omp install --agent-dir "$HOME/.omp/agent"
   ```
3. Restart active OMP terminal sessions to load the extension.
4. Users may optionally enable OMP notifications in Web UI Settings under Terminal Preferences (default: opt-in / off).

### Rollback:
1. Uninstall managed extension from target agent directory:
   ```bash
   dam-hopper-server integration omp uninstall --agent-dir "$HOME/.omp/agent"
   ```
2. Restart active OMP sessions. Status reporting ceases immediately with no lingering background tasks or modified config files.
3. Deploy prior server and UI binaries if full revert is desired.
