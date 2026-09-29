# Phase 05 — Agent Settings and notification ownership

## Context links
[Plan](./plan.md) · [Contract §5](./design-contract.md) · [Repository gaps](./reports/repository-findings.md) · Phases [02](./phase-02-private-hook-ingress.md), [03](./phase-03-managed-hook-installation.md), [04](./phase-04-native-event-adapters.md)

## Overview
Date: 2026-09-29. Priority P1. Estimate 8h. **Phase 05 status: DONE / 100%** (2026-09-29 Asia/Saigon; Review 9.2/10, [review report](../reports/code-review-260929-1250-phase-05-settings-notification-cutover.md)).

**Validation:** 2,383 tests passed (139 config, 80 agent_status, 1,944 UI unit, 220 browser); advisor completion recorded. Live Linux/provider qualification remains Phase 06.

Expose three concrete integrations and close path/profile/delivery gaps required by this rollout.

## Key Insights
Current AgentSettings queries use owner, but saves use the preference-source store and actions target drafts. Semantic dispatch hardcodes OMP. Badge already derives agent name. Codex path equality exists in current save code despite stale architecture prose; do not duplicate that fix.

## Requirements
Owner/generation-fenced path saves and actions, separate installed/ready states, explicit Unknown/limited coverage, strict verified delivery, complete config migration, and clean removal of Codex OSC9. Badges independent of master toggles; no usable alert toggle where no native alert capability exists.

## Architecture
Extend existing Agent Settings, transport/query/state patterns, not a new dashboard. Native path fields use real server-side runtime identity. Expiring per-profile/per-agent eligibility controls notifications; actual native claims additionally bind terminal/runtime path. Preferences v2 add Claude disabled while preserving existing policies.

## Related code files
Modify backend:
- `server/src/api/{agent_status.rs,config.rs,tests.rs}`: verified paths/readiness and save-time eligibility; remove `sync_codex_tui_config`, master-toggle TUI writes, obsolete Codex-home test overrides and sync-only tests.
- `server/src/config/{schema.rs,global.rs,tests.rs}`: Claude path/policy, v1/legacy→v2 migration and future-version refusal.
Modify frontend:
- `packages/ui/src/api/{agent-status-types.ts,client.ts,queries.ts,ws-transport.ts}`: concrete integration APIs, strict DTOs, owner keys/invalidation.
- `packages/ui/src/stores/{settings.ts,agent-status.ts}`, `packages/ui/src/lib/ui-config.ts`: persisted migration, owner-directed mutation and freshness/eligibility lifecycle.
- `packages/ui/src/components/organisms/AgentSettings.tsx`: native cards, paths, management/trust/restart/conflict controls, capability disclosure.
- `packages/ui/src/components/atoms/AgentStatusBadge.tsx`: human-readable agent label plus hook source/freshness tooltip; avoid rewriting tab/Fleet containers.
- `packages/ui/src/lib/terminal-agent-notification-integration.ts`, `terminal-agent-notification-settings.ts`, `terminal-notification-signal-parser.ts`: policy by matching agent identity, eligibility and Codex source arbitration.
- `packages/ui/src/hooks/use-agent-status-connections.ts`: owner/generation/current-incarnation eligibility lifecycle where appropriate.
- `packages/ui/src/components/organisms/TerminalPanel.tsx` and its tests: remove `attachTerminalAgentNotifications` import/setup/disposal and obsolete notification no-op callbacks; preserve buffer replay/shell suggestions/process/output handling.
- `packages/ui/src/lib/terminal-notification-signal-parser.test.ts` and integration tests: remove OSC9-only behavior/tests; preserve shared semantic notification DTOs and helpers still referenced. LSP determines whether unused OSC777/99/BEL helpers become dead code; remove only code made obsolete by this cutover.
Update associated existing behavioral tests; migrate any actual callers of `TerminalAgentNotificationSettings.tsx` found by LSP. Delete obsolete policy aliases only after migration; no shim dual-write.

## Implementation Steps
1. Run LSP references for exported settings/DTO APIs. Enumerate all Rust/TS version checks, normalization/import/export and notification consumers before changing version 1 to 2.
2. Migrate codex/omp values exactly, add claude defaults disabled, preserve version rejection; add claudeDir API/TOML normalization. Back up config for rollback qualification.
3. Share actual PTY/home/config-dir resolution and safe path checks; selected browser/server home is not runtime proof. Native live claims verify actual process config identity; delete legacy OSC9-only config presence gates.
4. Revalidate supported enabled-policy saves and changed paths server-side. Allow disabling even after config/install disappears. Delete automatic Codex TUI config synchronization entirely; leave existing user notify/TUI values untouched because prior original values were not recorded. Native hook installation/removal only mutates owned hooks/assets.
5. Replace draft-target mutations with saved normalized path + captured owner/revision. Handle save completion before install. Profile switch resets drafts/feedback and prevents late writes; use explicit owner-directed persistence rather than changing global preference source behind the user.
6. Display installation, native hook trust/policy/restart readiness and observed runtime separately. Label Codex status-only and Claude attention-only limitations. Preserve migrated Codex channel values without presenting unsupported activation controls as usable; readiness cannot turn nonexistent notification capability on. Unknown is visible, not styled as Idle.
7. Dispatch selects policy from row.agentKind; reject mismatch with attention.agentKind, stale generation/incarnation, expired eligibility or changed saved path. Invalidate cached eligibility on own changes immediately; external changes bounded by 15s verification freshness.
8. Delete OSC9 handler/parser, rate limiter, attach API and all obsolete callers rather than keeping no-op compatibility wrappers. Live and replayed OSC9 bytes must produce zero DamHopper history/toast/sound/browser alerts. OMP semantic events unchanged; Claude only qualified attention/error. Preserve general terminal replay independently; channel disable leaves badges intact.
9. Run live browser smoke across two profiles, unsaved/saved custom paths, trust-required, restart-required uninstall, Unknown expiry and notification selection. Exercise actual backend responses, not mocked copies.

## Todo list
- [x] v2 policy migration and server/PTY path eligibility.
- [x] Owner-bound Agent Settings native management and readiness.
- [x] Agent-specific dispatch, complete OSC9/TUI-sync cutover, real browser proof.

## Success Criteria
Selected profile alone receives mutations and notifications. Stale or malformed verification cannot enable/deliver. Invalid/absent native hooks do not hide OMP badges. Codex channels survive migration; Claude starts off. Profile/path/disconnect changes silence stale events.

## Risk Assessment
Global preference source is not the selected Agent Store profile. Optimistic saves and cached eligibility can cross owners or outlive path edits. Older binaries reject Claude/v2 config; rollback must restore compatible preference snapshot before downgrade.

## Security Considerations
No secrets/native config contents in UI DTOs or diagnostics. No client-authoritative canEnable field. Filesystem checks and actual runtime identity independent of requested path; no broad privilege changes.

## Next steps
Phase 06 performs combined backend/browser/real-agent qualification and docs close-out after smoke. No completion claim based on unit tests alone.
