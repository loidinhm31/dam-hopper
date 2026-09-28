# Phase 04 Implementation and Review Report: Profile-Safe Badges and Notifications

- **Date:** 2026-09-28
- **Phase:** Phase 04 — Profile-safe badges and notifications
- **Status:** Approved and complete
- **Review Score:** 7/10 (Cycle 1 & Cycle 2), followed by approved advisor consultation and completed bounded remediation

---

## 1. Summary of Changes

Phase 04 establishes owner-isolated agent status presentation and explicit attention notifications:
- **Connection-Bound Transport & Bridge:** Mounted `AgentStatusBridge` at the application root (`embed/dam-hopper-app.tsx`), maintaining lifecycle subscriptions across route transitions and inactive terminals without mounting unnecessary xterm instances.
- **Owner-Safe Semantic Store:** Added `stores/agent-status.ts` enforcing epoch/revision fencing, subscription-before-snapshot race buffering, and isolated multi-profile state.
- **Badge Surfaces:** Implemented `AgentStatusBadge` and mounted on terminal tabs (`TerminalTabBar.tsx`), split pane tabs (`TabBar.tsx`), and Fleet terminal rows (`TerminalRuntimeNavigatorItem.tsx`).
- **Notification Deduplication & Navigation:** Pre-filtered live attention by stable semantic ID before channel side effects (`terminal-notifications.ts`, `terminal-agent-notification-integration.ts`); ensured selection navigation rejects stale incarnations.
- **Preference Migration & Version Safety:**
  - Migrated legacy `terminalCodex*` scalar keys into unified `terminalAgentNotifications` v1 with OMP defaulting to off.
  - Isolated Codex TUI syncing to occur only when `codex.enabled` actually transitions (`server/src/api/config.rs`).
  - Preserved explicit unsupported versions (e.g. `version: 2`) across UI normalization and offline snapshots without coercion to v1 defaults (`packages/ui/src/lib/ui-config.ts`, `stores/settings.ts`).
  - Propagated unsupported version errors during server startup (`server/src/main.rs:319`), preventing overwrite of user configuration files.
  - Rendered explicit unsupported notice in UI (`TerminalAgentNotificationSettings.tsx`) while disabling editing controls.

---

## 2. Review Findings & Remediation

| Issue | Severity | Resolution |
|---|---|---|
| OMP-only saves touched malformed Codex config | High | Guarded `sync_codex_tui_config` in `server/src/api/config.rs` to run only when `next_codex_notifications_enabled != previous_codex_notifications_enabled`. |
| Unsupported notification version silently downgraded in UI normalization | High | Updated `normalizeTerminalAgentNotifications` in `packages/ui/src/lib/ui-config.ts` to preserve raw `version` and policies; prevented `saveAgentNotificationPolicy` and `saveDebounced` from overwriting when `version !== 1`. |
| Server startup swallowed unsupported config version | High | Removed `.ok().flatten().unwrap_or_default()` in `server/src/main.rs:319`, replacing with `read_global_config_at(&gc_path)?.unwrap_or_default()`. |
| Singleton zero-rate-limit map retained keys | Medium | Updated `BrowserNotificationService` in `packages/ui/src/lib/browser-notification-service.ts` to bypass map storage when `rateLimitMs <= 0`. |
| Browser tests globally mocked connection registry | Medium | Replaced broad `vi.mock("@/api/connections.js")` with `__setConnectionSnapshotForTests` in `packages/ui/src/api/connections.ts`, eliminating cross-test interference in Chromium. |

---

## 3. Advisor Consultation Record

- **Controller Version:** 2 (Protocol `evcrate-advisor-result` v2)
- **Correlation ID:** `a9511943-096f-4573-a6f4-220b42402ada`
- **Route:** `codex` / `gpt-6-astra` (effort: high) — elapsed 25.7s
- **Status:** `ADVICE_READY`
- **Task Lifecycle:** Initialized, checkpoint reserved, disposition recorded (`action: "accept"`), validation outcome verified (`result: "resolved"`), and completed (`gate_status: "completed"`).

---

## 4. Verification

- **Backend Rust Tests:** 1,168 unit tests passed (`cargo test --manifest-path server/Cargo.toml --lib`).
- **UI Unit Tests:** 1,930 unit tests passed across 276 test suites (`pnpm --filter @dam-hopper/ui test`).
- **Chromium Browser Tests:** 220 tests passed across 44 suites, 4 skipped (`pnpm --filter @dam-hopper/ui test:browser`).
- **ESLint:** 0 errors (`pnpm lint`).
- **Prettier:** Verified formatting across all touched source and test modules.
