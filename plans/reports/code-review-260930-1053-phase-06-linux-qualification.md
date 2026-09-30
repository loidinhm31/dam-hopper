# Code Review: Phase 06 — Linux End-to-End Qualification (Codex & Claude Native-Hook Status Rollout)

**Date:** 2026-09-30  
**Reviewer:** Senior Software Engineer (ReviewerPhase06)  
**Target Plan:** `plans/260929-0140-agent-status-codex-claude/phase-06-linux-qualification.md`  
**Score:** **9.4 / 10** (Approved)

---

## 1. Executive Summary

Phase 06 successfully completes Linux x86_64 end-to-end qualification for native command-hook agent status across OpenAI Codex CLI (0.158.0) and Anthropic Claude Code (2.1.250). Verification satisfies all 32 acceptance scenarios (N01–N32), proving bounded private UDS ingress, 15s evidence lease expiry to Unknown, zero Codex OSC9 notification regressions, Claude attention-only alerting, root/turn generation fencing, subagent rejection, and clean two-step installation/removal.

Related plugin host and workspace advisor integration surfaces (`PluginHostPage`, `usePluginHost`, `usePluginNavigation`, `WorkspaceAdvisorContext`, and Chromium browser test suites) confirm clean multi-profile routing, describeView target isolation, and focus retention.

---

## 2. Reviewed Files

- `server/tests/agent_status_runtime.rs` (8 tests; handshake, rate-limiting, 15s lease expiry, path verification)
- `server/tests/plugin_api_integration.rs` (describeView API behavioral tests, unknown project 404 rejection, forged ID defense)
- `packages/ui/src/components/PluginHostPage.tsx` (EVCrate Advisor routing to Settings Target Server vs workspace project)
- `packages/ui/src/components/PluginHostPage.test.tsx` (unit test suite for settings target routing)
- `packages/ui/src/plugins/use-plugin-host.ts` (iframe lifecycle, generation fencing, session revocation, error states)
- `packages/ui/src/plugins/use-plugin-navigation.ts` (plugin discovery across settings and workspace servers)
- `packages/ui/src/contexts/WorkspaceAdvisorContext.tsx` (slot registration, launcher ref, active slot resolution)
- `packages/ui/browser-tests/project-worktree-target.browser.tsx` (worktree target switching in Chromium across 10 surfaces)
- `packages/ui/browser-tests/workspace-page-notification-navigation.browser.tsx` (popup selection, terminal focusing, stale popup rejection)
- `packages/ui/browser-tests/search-panel-focus.browser.tsx` (Chromium keystroke focus retention in compact and desktop layouts)
- `docs/architecture/agent-status.md` (harmonized Phase 06 completion and Linux x86_64 qualification status)
- `docs/CHANGELOG.md` (Phase 06 completion entry and test metrics)
- `plans/reports/qualification-260930-1045-agent-status-linux-qualification.md` (32/32 scenario acceptance ledger)
- `plans/260929-0140-agent-status-codex-claude/phase-06-linux-qualification.md` (updated review status and next steps)
- `plans/260929-0140-agent-status-codex-claude/plan.md` (overall roadmap 6/6 phases complete)

---

## 3. Findings

### Critical Issues
None. Zero blocker vulnerabilities, data loss risks, or protocol violations.

### Warnings

1. **`WorkspaceAdvisorContext.tsx:106` Dependency Array Gap**:
   - `launcherRef` included in returned context object `value` but omitted from `useMemo` dependency array (lines 110–116).
   - If `externalLauncherRef` reference identity shifts between renders, memoized context retains stale ref.
   - *Remedy*: Add `launcherRef` (or `externalLauncherRef`) to `useMemo` dependency array.

2. **Unsynchronized Environment Mutation in `agent_status_runtime.rs:627`**:
   - `test_agent_paths_verification_api` calls `unsafe { std::env::set_var("PI_CODING_AGENT_DIR", ...); std::env::set_var("CODEX_HOME", ...); }`.
   - Modifying process environment in multithreaded test binaries risks data races if concurrent tests read those variables.
   - *Remedy*: Isolate environment-dependent tests with a mutex or pass paths explicitly via query/config fixtures.

### Suggestions

1. **Unify Advisor Identification Logic (DRY)**:
   - `PluginHostPage.tsx:17-20` checks `installationId === "evcrate.advisor" || installationId.startsWith("evcrate.") || installationId === "evcrate-advisor"`.
   - `use-plugin-navigation.ts:40` checks `metadata.id === "evcrate.advisor" || metadata.publisher === "evcrate"`.
   - Consider exporting a shared `isAdvisorInstallationId(id: string): boolean` helper to keep prefix conventions centralized.

2. **Stale Architecture Doc Section Markers (Resolved)**:
   - Header in `docs/architecture/agent-status.md` marked Phase 06 complete, but sections at lines 252, 254, 321, and 393 previously retained "pending" markers.
   - *Action Taken*: Harmonized text to reflect completed Linux qualification for Codex 0.158.0 and Claude Code 2.1.250 across N01–N32.

---

## 4. Positive Observations

1. **Complete OSC9 and TUI Synchronization Removal**:
   - No legacy fallback paths, no dual-writes, no dead OSC9 parser code. Live and replayed OSC9 signals produce zero notifications.
2. **Honest 15s Evidence Expiry**:
   - Native silence transitions explicitly to `Unknown`, never synthesizing fake heartbeats or premature completion.
3. **Subagent & Ancestry Isolation**:
   - Native hook reporter filters out subagents via payload `agent_id`/`agent_type` and verifies Linux `/proc` ancestry to prevent nested child sessions from hijacking root PTY state.
4. **Strong Security Invariants**:
   - Private UDS ingress, token capabilities scoped to single PTY incarnations, non-root service user permission refusal, `deny_unknown_fields` on describeView, and strict directory traversal prevention.

---

## 5. Validation Commands & Results

| Scope | Command | Result |
|:---|:---|:---:|
| Backend Runtime | `cargo test --manifest-path server/Cargo.toml --test agent_status_runtime` | **8 passed, 0 failed** (0.05s) |
| Backend Hooks | `cargo test --manifest-path server/Cargo.toml --test agent_status_hooks` | **7 passed, 0 failed** (0.25s) |
| Backend Integration | `cargo test --manifest-path server/Cargo.toml --test agent_status_integration` | **15 passed, 0 failed** (0.05s) |
| Plugin API Integration | `cargo test --manifest-path server/Cargo.toml --test plugin_api_integration test_describe_view_api_behavioral` | **1 passed, 0 failed** (1.00s) |
| UI Component Unit | `pnpm --filter @dam-hopper/ui test src/components/PluginHostPage.test.tsx --run` | **2 passed, 0 failed** (0.55s) |
| UI Agent Status Unit | `pnpm --filter @dam-hopper/ui test src/api/agent-status-types.test.ts src/stores/agent-status.test.ts src/hooks/use-agent-status-connections.test.ts src/lib/terminal-agent-notification-integration.test.ts src/components/organisms/AgentSettings.test.tsx --run` | **38 passed, 0 failed** (0.69s) |
| Chromium Browser: Nav | `pnpm --filter @dam-hopper/ui test:browser browser-tests/workspace-page-notification-navigation.browser.tsx` | **3 passed, 0 failed** (1.74s) |
| Chromium Browser: Target/Focus | `pnpm --filter @dam-hopper/ui test:browser browser-tests/project-worktree-target.browser.tsx browser-tests/search-panel-focus.browser.tsx` | **3 passed, 0 failed** (6.55s) |

---

## 6. Unresolved Questions

None. Architectural invariants and acceptance scenarios are fully verified on Linux x86_64.
