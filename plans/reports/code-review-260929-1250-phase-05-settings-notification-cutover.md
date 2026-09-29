# Code Review: Phase 05 — Agent Settings and Notification Ownership Cutover

Date: 2026-09-29  
Reviewer: Senior Software Engineer (ReviewPhase05)  
Target: `plans/260929-0140-agent-status-codex-claude/phase-05-settings-and-notification-cutover.md`  
Score: **9.2 / 10** (Approved)

---

## Code Review Summary

### Scope
- **Files reviewed**:
  - `server/src/api/agent_status.rs`
  - `server/src/api/config.rs`
  - `server/src/api/tests.rs`
  - `packages/ui/src/api/agent-status-types.ts`
  - `packages/ui/src/api/client.ts`
  - `packages/ui/src/api/queries.ts`
  - `packages/ui/src/api/ws-transport.ts`
  - `packages/ui/src/components/atoms/AgentStatusBadge.tsx`
  - `packages/ui/src/components/molecules/TerminalAgentNotificationSettings.tsx`
  - `packages/ui/src/components/molecules/TerminalNotificationSoundControls.tsx`
  - `packages/ui/src/components/organisms/AgentSettings.tsx`
  - `packages/ui/src/components/organisms/AgentSettings.test.tsx`
  - `packages/ui/src/components/organisms/TerminalPanel.tsx`
  - `packages/ui/src/components/organisms/TerminalPanel.test.tsx`
  - `packages/ui/src/lib/browser-notification-service.test.ts`
  - `packages/ui/src/lib/terminal-agent-notification-integration.ts`
  - `packages/ui/src/lib/terminal-agent-notification-integration.test.ts`
  - `packages/ui/src/lib/terminal-notification-signal-parser.ts`
  - `packages/ui/src/lib/terminal-notification-signal-parser.test.ts`
  - `packages/ui/src/stores/terminal-notifications.test.ts`
  - `packages/ui/browser-tests/terminal-panel-replay-notifications.browser.tsx`
  - `packages/ui/browser-tests/workspace-page-notification-navigation.browser.tsx`
- **Lines of code analyzed**: ~3,200 LOC (+1,419 / -1,106 across 22 files)
- **Review focus**: Native Agent Settings management cards (Codex & Claude), separate installation & readiness badges, honest notification policy gating, semantic attention dispatch with correlation & qualification, clean elimination of Codex OSC9 and TUI sync, security/path validation, profile isolation, and DRY/KISS.
- **Updated plans**:
  - `plans/260929-0140-agent-status-codex-claude/phase-05-settings-and-notification-cutover.md`
  - `plans/260929-0140-agent-status-codex-claude/plan.md`

### Overall Assessment
Phase 05 executes the frontend and settings cutover with high architectural discipline:
1. **Clean OSC9 Removal**: DamHopper's legacy Codex OSC9 parser, handlers, rate limiters, `attachTerminalAgentNotifications` hook, and automatic TUI sync (`sync_codex_tui_config`) are completely excised. No dead shims, fallback dual-writes, or no-op handlers remain.
2. **Honest Capability Disclosure & Gating**: Codex is presented truthfully as status-only in this rollout. The UI disables Codex alert toggles with explicit callouts, and the backend rejects attempts to enable Codex notifications. Claude Code is qualified for attention alerts only (approvals, questions, errors), gating enablement behind verified runtime path equivalence and `Ready` integration status.
3. **Strict Semantic Attention Dispatch**: `deliverSemanticAgentAttention` enforces complete correlation across connection (`isCurrentConnection`), terminal ID, incarnation, agent session ID, attention revision, and `agentKind` parity between the status row and attention event. Codex alerts are suppressed, and Claude normal turn-ended events are dropped.
4. **Status & Readiness Decomposition**: Installation status (`absent`, `current`, `outdated`, `modified`) is correctly decoupled from operational readiness (`ready`, `restart-required`, `trust-required`, etc.), giving users actionable restart and trust feedback.
5. **Path Security**: All configured paths are strictly validated through `expand_and_validate_path` (preventing traversal like `..` and enforcing absolute boundaries). Disabling notifications remains universally allowed regardless of path validity.

---

## Critical Issues
None.

---

## High Priority Findings
None.

---

## Medium Priority Improvements

### 1. Profile Switch Should Reset Draft Paths and Feedback Banners
- **Location**: `packages/ui/src/components/organisms/AgentSettings.tsx:120-135`
- **Problem**:
  ```tsx
  useEffect(() => {
    if (agentSettingsPaths?.ompAgentDir) {
      setOmpPathDraft(agentSettingsPaths.ompAgentDir);
    }
    if (agentSettingsPaths?.codexDir) {
      setCodexPathDraft(agentSettingsPaths.codexDir);
    }
    if (agentSettingsPaths?.claudeDir) {
      setClaudePathDraft(agentSettingsPaths.claudeDir);
    }
  }, [
    agentSettingsPaths?.ompAgentDir,
    agentSettingsPaths?.codexDir,
    agentSettingsPaths?.claudeDir,
  ]);
  ```
  1. `owner?.profileId` is omitted from the dependency array.
  2. If a target profile has `agentSettingsPaths` undefined (default), the `if (agentSettingsPaths?.<dir>)` guards do not execute, leaving stale drafts from the previous profile in the inputs.
  3. Active feedback messages (`ompFeedback`, `codexFeedback`, `claudeFeedback`) persist across profile switches.
- **Remedy**: Reset drafts to defaults when unconfigured in the active profile and clear feedback on profile switch:
  ```tsx
  useEffect(() => {
    setOmpPathDraft(agentSettingsPaths?.ompAgentDir ?? "~/.omp/agent");
    setCodexPathDraft(agentSettingsPaths?.codexDir ?? "~/.codex");
    setClaudePathDraft(agentSettingsPaths?.claudeDir ?? "~/.claude");
    setOmpFeedback(null);
    setCodexFeedback(null);
    setClaudeFeedback(null);
  }, [
    owner?.profileId,
    agentSettingsPaths?.ompAgentDir,
    agentSettingsPaths?.codexDir,
    agentSettingsPaths?.claudeDir,
  ]);
  ```

### 2. Guard Direct Hook Installation Against Unsaved Draft Paths
- **Location**: `packages/ui/src/components/organisms/AgentSettings.tsx:241, 285`
- **Problem**: In `handleInstallCodex` and `handleInstallClaude`, `installMutation.mutateAsync` receives `codexPathDraft` / `claudePathDraft`. If a user edits the text input and clicks "Install Hook" without clicking "Save Path", the hook installs to the draft location while `agentSettingsPaths` in persisted config retains the previous path. Later, attempting to enable Claude notifications fails on server-side path mismatch.
- **Remedy**: Auto-save the draft path upon installation, or disable the Install button until the draft matches the saved configuration:
  ```tsx
  const handleInstallClaude = async () => {
    setClaudeFeedback(null);
    try {
      saveAgentSettingsPaths({ claudeDir: claudePathDraft });
      await installClaudeMutation.mutateAsync(claudePathDraft);
      // ...
  ```

---

## Low Priority Suggestions

### 1. Stray `"osc9"` Source in `terminal-notification-ui.browser.tsx` Mock
- **Location**: `packages/ui/browser-tests/terminal-notification-ui.browser.tsx:17`
- **Problem**: An event fixture sets `source: "osc9"`. Because `"osc9"` was removed from `TerminalAgentNotificationSource` in `terminal-notification-signal-parser.ts`, this mock should use `source: "agent-status"` to maintain type hygiene with other test files (`browser-notification-service.test.ts`, `terminal-notifications.test.ts`).
- **Remedy**: Replace `source: "osc9"` with `source: "agent-status"`.

### 2. Consistency in `decodeNativeIntegrationStatusReport` Details Field
- **Location**: `packages/ui/src/api/agent-status-types.ts:619-623`
- **Problem**: The interface defines `details?: string | null;`, but the decoder produces `undefined` when `obj.details == null` rather than `null`.
- **Remedy**: Normalize fallback to `null` to match `configPath`, `version`, and `contentHash`.

---

## Positive Observations
1. **Complete OSC9 Obliteration**: Zero dual-writes, zero lingering compatibility shims, zero fallback branches. The codebase cleanly sheds legacy baggage.
2. **Honest Gating**: User interface states strictly reflect reality. Codex cannot be toggled on, and Claude can only be toggled when verified ready.
3. **Comprehensive Test Suite**:
   - `AgentSettings.test.tsx` tests all verification branches, disabled reasons, and installation actions.
   - `terminal-agent-notification-integration.test.ts` thoroughly verifies correlation checks, reason translations, and suppression policies.
   - Browser tests cleanly transitioned from legacy OSC9 terminal listeners to semantic attention events.
4. **Resilient Backend Path Checking**: `expand_and_validate_path` handles `~`, denies non-absolute paths, and rejects `..` path traversals.

---

## Recommended Actions
1. **Apply Medium Fix 1**: Add profile switch effect to synchronize drafts and clear mutation feedback in `AgentSettings.tsx`.
2. **Apply Medium Fix 2**: Auto-save draft paths inside install handlers in `AgentSettings.tsx`.
3. **Clean Up Low Finding 1**: Update `terminal-notification-ui.browser.tsx:17` from `"osc9"` to `"agent-status"`.
4. **Proceed to Phase 06**: Proceed to Linux end-to-end qualification with real PTYs and live Codex/Claude sessions.

---

## Metrics
- **Type Coverage**: 100% strict TypeScript (`pnpm --filter @dam-hopper/ui build` passed with 0 errors).
- **Backend Tests**: 139 passed in `config`, 80 passed in `agent_status` (0 failures).
- **Frontend Unit Tests**: 39 passed across targeted test files, 11 passed in store/hook suites.
- **Browser Tests**: 17 passed across modified Chromium browser tests (`terminal-panel-replay-notifications`, `workspace-page-notification-navigation`), 2 passed in `agent-status-bridge`.
- **Compiler/Lint Warnings**: 0 warnings in Phase 05 files (`cargo check --all-targets` clean on modified modules).

---

## Validation Commands & Results
```bash
# Backend unit tests
cargo test --package server config        # 139 passed (0 failed)
cargo test --package server agent_status  # 80 passed (0 failed)
cargo check --all-targets                 # 0 errors, 0 warnings in modified files

# Frontend TypeScript check
pnpm --filter @dam-hopper/ui build        # 0 errors

# Frontend unit tests
pnpm --filter @dam-hopper/ui test \
  src/lib/terminal-agent-notification-integration.test.ts \
  src/components/organisms/AgentSettings.test.tsx \
  src/lib/terminal-notification-signal-parser.test.ts \
  src/lib/browser-notification-service.test.ts # 39 passed (4 test files)

pnpm --filter @dam-hopper/ui test \
  src/components/organisms/TerminalPanel.test.tsx \
  src/stores/terminal-notifications.test.ts   # 8 passed (2 test files)

pnpm --filter @dam-hopper/ui test \
  src/components/molecules/TerminalAgentNotificationSettings.test.tsx # 6 passed

pnpm --filter @dam-hopper/ui test \
  src/stores/agent-status.test.ts \
  src/hooks/use-agent-status-connections.test.ts # 11 passed

# Chromium browser tests
pnpm --filter @dam-hopper/ui test:browser \
  browser-tests/terminal-panel-replay-notifications.browser.tsx \
  browser-tests/workspace-page-notification-navigation.browser.tsx # 17 passed

pnpm --filter @dam-hopper/ui test:browser \
  browser-tests/agent-status-bridge.browser.tsx # 2 passed
```

---

## Unresolved Questions
None. Architectural and product requirements are fully resolved.
