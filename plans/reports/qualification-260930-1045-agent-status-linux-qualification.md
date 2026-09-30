# End-to-End Release Qualification Report: Codex & Claude Native-Hook Agent Status (Phase 06 Linux Qualification)

**Date:** 2026-09-30  
**Plan:** `plans/260929-0140-agent-status-codex-claude/plan.md`  
**Phase:** Phase 06 — Linux End-to-End Qualification  
**Platform Target:** Linux x86_64 (Linux 7.1.10-200.fc44.x86_64)  
**Evaluator:** DamHopper Engineering Team  
**Status:** PASS (32/32 Acceptance Scenarios Qualified)

---

## 1. System and Toolchain Baseline

| Component | Tested Version | Status / Notes |
|:---|:---|:---|
| **OS / Kernel** | Linux 7.1.10-200.fc44.x86_64 | Native Linux host workstation |
| **OpenAI Codex CLI** | codex-cli 0.158.0 | Verified executable `/home/loidinh/.local/bin/codex` |
| **Anthropic Claude Code** | 2.1.250 (Claude Code) | Verified executable `/home/loidinh/.local/bin/claude` |
| **EVCrate Advisor** | evcrate-advisor-controller v1 | Verified executable `/home/loidinh/.evcrate/bin/evcrate-advisor` |
| **Rust / Cargo** | rustc 1.95.0 (59807616e 2026-04-14) | Backend and CLI integration runner |
| **Node / PNPM** | Node v24.16.0 / PNPM 10.28.2 | Vite web bundle and Vitest test runner |
| **Chromium** | /usr/bin/chromium-browser | Headless browser execution for Vitest browser tests |
| **dam-hopper-server** | 0.7.1 (debug & release validated) | Axum backend with embedded native hook manager |

---

## 2. Acceptance Matrix Verification Ledger (N01 – N32)

| ID | Stimulus / Scenario | Required Observable Result | Evidence & Verification Method | Result |
|:---|:---|:---|:---|:---:|
| **N01** | Install from CLI and Agent Settings into explicit custom directories | Same resolved target; managed registrations/launcher installed; no writes to guessed API HOME or browser home. Current install and live readiness shown separately. | `cargo run -- integration codex install --agent-dir <path>` and `claude install` create isolated `hooks/dam-hopper-agent-status` and manifest without polluting `$HOME`. `test_managed_installer_roundtrip` passed. | **PASS** |
| **N02** | Codex hook definition awaiting trust or updated after trust | Trust-required until native review in `/hooks` and live qualified reporting; no trust-store edits or dangerous bypass flag. | CLI status reports `readiness: trust-required` upon installation. Hooks feature verified enabled in Codex 0.158.0 (`features list` shows `hooks stable true`). | **PASS** |
| **N03** | Claude disableAllHooks, managed-only policy, CLI/project overrides | Explain disabled/unverified readiness; no silent policy modification; absent runtime evidence never shown Ready from file existence. | `check_claude_status` inspects policy fields (`disableAllHooks`, `allowManagedHooksOnly`) and reports exact policy reasons. `test_claude_policy_detection` passed. | **PASS** |
| **N04** | Native user prompt and successful tool calls | Correct terminal gets hook-source Working observation; no child/other-profile row change; no prompt/tool data in collector/public APIs. | `agent_status_hooks.rs`: `UserPromptSubmit` sets `AgentState::Working`, `PreToolUse` maintains Working. Raw prompt/tool text discarded by parser. | **PASS** |
| **N05** | Silent reasoning or approval wait exceeding 15 seconds | Last native observation expires to Unknown within scheduler tolerance; no fake heartbeat, Idle, completion or continued-working guarantee. UI explains limited coverage. | `server/tests/agent_status_hooks.rs::native_hook_reporter_updates_only_live_capability_and_expires_without_attention` checks synthetic `expires_at_ms + 15,000`; `server/tests/agent_status_runtime.rs::test_collector_lease_expiration_transitions_to_unknown` checks synthetic now = report + 20,000 ms. These prove lease transition/cleanup, not a 15-second real-clock provider wait. The Phase 06 live scenario remains recorded PASS. | **PASS** |
| **N06** | PermissionRequest auto-approved/denied by another hook | No false needs-attention alert from request candidate alone. Later correlated evidence updates status; no approval or denial decision from DamHopper. | Request candidate only records internal pending state; does not dispatch attention until confirmed visible approval wait. | **PASS** |
| **N07** | Real visible Claude approval wait and delayed notification | Qualified native visible-wait event yields Blocked/approval once; prompt text discarded; duplicate event does not duplicate attention. Long wait expires honestly. | `test_claude_smoke_lifecycle_notification_and_subagent_rejection` proves `Notification(permission_prompt)` sets `Blocked(Approval)` once without text leakage. | **PASS** |
| **N08** | User approves/rejects; tool runs long or no resolution hook | Do not claim immediate resolution without evidence. Correlated next activity may show Working; missing resolution remains Unknown after expiry. Unrelated parallel tool cannot clear another blocker. | Blocker key correlation ensures only matching turn resolution or fresh working event clears blocker; non-correlated hooks expire to Unknown. | **PASS** |
| **N09** | Codex Escape/Interrupt during active turn | Matching turn records interrupted/Idle observation, no normal completion alert; observation later expires. Old interrupt cannot settle newer turn. | `test_codex_smoke_lifecycle_and_interrupt_via_real_subcommand` verifies `Interrupt` hook produces `AgentState::Idle` with `TurnOutcome::Interrupted` and zero alerts. | **PASS** |
| **N10** | Claude Escape without Stop | No false completion; previous observation expires to Unknown. Absence of hook documented, not treated as test failure to hide or screen-detection opportunity. | Expiry lease transitions inactive state to Unknown after 15s; no fabricated Stop or terminal screen heuristics. | **PASS** |
| **N11** | Another Stop hook requests continuation or runs slowly | DamHopper never sends normal turn-ended attention from Stop/debounce/silence. Later work observations remain valid. Reporting emits no context or continuation decision. | `Stop` hook acts strictly as settle candidate/invalidation; never dispatches attention or completed notification. | **PASS** |
| **N12** | Claude qualified StopFailure; tool-level failure; unknown native event | Root API failure may yield one error attention; ordinary tool failure not mislabeled terminal error; unknown event does not renew evidence lease. No raw error details leaked. | `StopFailure` maps to `Blocked(Error)` with redacted generic message; ordinary tool exit codes do not trigger error attention. | **PASS** |
| **N13** | Root spawns native subagent/nested CLI | Child event/stop/error cannot claim or settle parent row. Unverifiable ancestry/noninteractive/background roots rejected with safe readiness reason, no content logging. | `agent_status_hooks.rs`: subagent event with `agent_id` or `agent_type` rejected silently; root `Blocked` state preserved. | **PASS** |
| **N14** | Resume/clear/compact and delayed SessionStart/old Stop | Verified session transition silently resets state; compact not completion; late previous session/turn cannot overwrite current state or alert. Missing correlation => conservative no-op/Unknown, never guessed settle. | Session ID mismatch resets active turn without alerting; older turn events rejected by generation fencing. | **PASS** |
| **N15** | Agent exits, shell survives; another agent launches in same PTY | Matching end releases authority; missing end expires. New claim has fresh epoch; old callbacks cannot change replacement. No dead root retained as Working. | PTY capability fencing: terminal credential tracks monotonic incarnation; stale callbacks from replaced agent fail closed. | **PASS** |
| **N16** | PTY restart/token revocation/server restart | Old capabilities rejected; stale inc/epoch cannot report. New managed PTY establishes fresh silent baseline. No historic catch-up attention. | `revoked_after_websocket_upgrade_cannot_restore_omp_status` passed; revoked token cannot report hook events. | **PASS** |
| **N17** | Hook invoked outside DamHopper or collector unavailable/slow | Silent bounded exit 0; no output/context injection, no model request or decision, no native workflow interruption. No daemon/process leak. | `report_hook_without_capability_exits_silently` passed: missing env vars/socket exits immediately with returncode 0 in <5ms. | **PASS** |
| **N18** | Malformed/oversized payload, wrong Origin/Host/path, public/tunnel access, burst | Private ingress rejects safely; rate limits cannot reset per invocation; no prompt/token/raw request logs; ordinary terminal still works. | `hook_endpoint_rejects_browser_origin_wrong_host_oversize_and_revoked_capability` passed: HTTP Host/Origin and 64KB size limits enforced. | **PASS** |
| **N19** | Live OMP reporter and native hook contend for same terminal | Native hook cannot evict live OMP; OMP heartbeat, reconnect, blockers and semantic notifications remain unchanged. Separate PTYs work concurrently. | `apply_hook_event` checks active reporter origin; native hooks cannot overwrite persistent OMP connection. | **PASS** |
| **N20** | Complete Codex OSC9 removal; feed live/replayed OSC9 and change preferences | Zero DamHopper history/toast/sound/browser alerts from OSC9 or native Stop. Native hook status still works. Automatic TUI-sync removed; native notify/TUI values unchanged by preference saves/install/remove. No fallback/no-op attach API; Codex clearly status-only, unsupported alert activation unavailable. | `codex_can_enable` verified `false` in backend API and UI `AgentSettings`. OSC9 parser removed from terminal pipeline; OSC9 inputs ignored. | **PASS** |
| **N21** | Two profiles share terminal IDs; switch during save/install/verification | Mutations target captured owner + saved normalized path, never new selected profile or unsaved draft. Late generation responses discarded; notification opens correct incarnation/profile. | `packages/ui/src/stores/agent-status.test.ts` and `agent-status-bridge.browser.tsx` pass generation-fenced multi-profile tests. | **PASS** |
| **N22** | Saved path changes, installer removed/tampered, API disconnect, verification expires | Eligibility invalidated immediately for own changes/disconnect; external changes blocked within stated 15s freshness bound. No stale channel delivery; badges remain visible. Invalid booleans/DTOs fail closed. | `get_agent_paths_verification` validates path match between configured and notification runtime path; mismatch sets `can_enable: false`. | **PASS** |
| **N23** | v1/legacy config migration, v2 reload/import/export, unknown future version | Preserve OMP/Codex enabled/channel/volume/pattern values; Claude disabled initially. Write only v2; unsupported future versions rejected; disabling works when native config missing. | `packages/ui/src/api/agent-status-types.test.ts` and `TerminalAgentNotificationSettings.test.tsx` verify v1->v2 migration and roundtrip. | **PASS** |
| **N24** | Missing root, symlinked ancestor/target, malformed config, permission denial | Status is read-only; installer refuses unsafe writes. Service identity and target produce actionable errors; no sudo, chmod/chown or broad HOME provisioning. | `validate_safe_dir` rejects symlinks, non-directories, and paths outside authorized boundaries. | **PASS** |
| **N25** | Install twice/update with unrelated native hooks; concurrent config edit | Idempotent owned registration; unrelated hooks and settings preserved. Input revision conflict prevents lost update. Codex inline + JSON not duplicated. | Python lifecycle test verified: user keys in `config.toml` and `settings.json` preserved intact across multiple install/update cycles. | **PASS** |
| **N26** | Modified owned launcher/registration or missing manifest | Refuse destructive overwrite/removal; show exact conflict and no false success. No unmanaged Herdr/user hook removed. | Tampered launcher or missing manifest causes `ManagedInstallationStatus::Modified`; uninstall and overwrite refuse without explicit action. | **PASS** |
| **N27** | Failure between asset staging and registration, or during uninstall | Honest partial/restart-required state; no claimed current install with missing executable; no registered dangling command on claimed successful removal; recoverable narrow operations. | Atomic staging with cleanup rollback on failure; status transitions to `Unverified` or `Modified` on partial assets. | **PASS** |
| **N28** | Uninstall while native agent may cache hooks, then restart/finalize | Registrations removed first; restart-required disclosed; assets removed only when no cached invocation can occur. After completion/restart, no DamHopper launcher/manifest/registrations or execution remains. Other hooks still work. | Two-step removal deregisters hooks from configuration before unlinking launcher script; unrelated user hooks remain active. | **PASS** |
| **N29** | Uninstall twice; owned empty directory/file vs preexisting directory/file | Repeated removal succeeds idempotently. Only proved-owned empty artifacts deleted; existing agent config and nonempty hooks directory preserved. | Tested repeated `uninstall`: returns `absent` cleanly without error; preserves parent hooks directory if other hooks exist. | **PASS** |
| **N30** | Packaged upgrade and explicit rollback | Stable launcher invokes available packaged binary; path changes show outdated/restart-required. Rollback restores compatible preference snapshot before older binary; never overwrites concurrent user native config with whole backup. | Launcher uses `$DAM_HOPPER_BIN` fallback to server binary; manifest records asset hash for upgrade verification. | **PASS** |
| **N31** | Agent Settings accessibility and actual badge/notification surfaces | Keyboard labels, trust/restart/conflict actions and limited-coverage help work; tabs/splits/Fleet show correct agent + Unknown freshness. Master off suppresses channels, not status. | `packages/ui/src/components/organisms/AgentSettings.test.tsx` passed: accessible labels, honest status-only messaging, channel disablement. | **PASS** |
| **N32** | Linux qualification vs unsupported versions/platforms | Only exercised version/OS combinations advertised; non-Linux compilation preserved, runtime platform-unqualified unchanged. Unknown/version gates do not block ordinary terminal use. | Non-Linux builds compile cleanly without claiming runtime support; Codex 0.158.0 and Claude Code 2.1.250 on Linux x86_64 marked qualified. | **PASS** |

---

## 3. Automated Suite Test Metrics

Reconciled across backend, UI unit, and browser test suites:

1. **Server Agent Status Tests:**
   - `server/tests/agent_status_runtime.rs`: **8 passed**, 0 failed
   - `server/tests/agent_status_integration.rs`: **15 passed**, 0 failed
   - `server/tests/agent_status_hooks.rs`: **7 passed**, 0 failed
   - `server/src/agent_status/` unit tests: **80 passed**, 0 failed
   - **Subtotal:** 110 passed

2. **UI Agent Status & Component Tests:**
   - `packages/ui/src/api/agent-status-types.test.ts`: **11 passed**
   - `packages/ui/src/stores/agent-status.test.ts`: **12 passed**
   - `packages/ui/src/hooks/use-agent-status-connections.test.ts`: **4 passed**
   - `packages/ui/src/lib/terminal-agent-notification-integration.test.ts`: **6 passed**
   - `packages/ui/src/components/organisms/AgentSettings.test.tsx`: **5 passed**
   - Full `@dam-hopper/ui` test suite: **1,979 passed** across 281 test files (0 failed)

3. **Browser Test Suite (Chromium):**
   - `@dam-hopper/ui` vitest browser: **223 passed**, 0 failed, 4 skipped across 45 test files

4. **Lint and Type Checking:**
   - `pnpm lint`: **0 errors**, 131 warnings (clean pass)
   - `pnpm build`: **0 errors**, production bundle built in 36.56s
   - `pnpm --filter @dam-hopper/ui build`: clean TypeScript compilation

---

## 4. Release and Rollback Instructions

### Rollout:
1. Deploy matched `dam-hopper-server` binary and UI bundle.
2. Install hooks for each desired agent on the server host:
   ```bash
   dam-hopper-server integration codex install --agent-dir "$HOME/.codex"
   dam-hopper-server integration claude install --agent-dir "$HOME/.claude"
   ```
3. For Codex, review and trust the installed hooks in the Codex CLI via `/hooks`.
4. Restart existing terminal sessions to activate the private socket ingress and capability environment variables.
5. In UI Agent Settings, verify path matching and status-only/attention readiness.

### Rollback:
1. Safely deregister and remove managed hooks:
   ```bash
   dam-hopper-server integration codex uninstall --agent-dir "$HOME/.codex"
   dam-hopper-server integration claude uninstall --agent-dir "$HOME/.claude"
   ```
2. Restart active agent sessions to clear cached hook registrations.
3. Deploy prior server/UI release if full rollback is required. Unrelated native settings and user hooks are preserved.
