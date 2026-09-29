# Phase 06 — Linux end-to-end qualification

## Context links
[Plan](./plan.md) · [Acceptance scenarios](./acceptance-scenarios.md) · [Contract](./design-contract.md) · Phases 01–05

## Overview
Date: 2026-09-29. Priority P1 release gate. Estimate 8h. Implementation Pending / 0%; review Pending.
Prove the installed native agents, packaged binary and actual browser behavior. No qualification executed during planning.

## Key Insights
Passing mock events does not prove native hook ordering, trust, event availability, cached-uninstall behavior or service-user access. Installed version probes are only inventory. Unsupported native edges must visibly degrade to Unknown, not be marked skipped/passing full parity.

## Requirements
Every acceptance row has reproducible evidence; existing OMP behavior retained; no user config pollution or content leakage. Release only Linux version combinations exercised. Preserve non-Linux compilation without claiming runtime support.

## Architecture
Isolated existing agent homes with content-free hook captures, throwaway native workspace, managed DamHopper PTYs and matched browser/server. Use the actual shipped binary for management and report-hook. Real credentials/account remain outside repository; never run destructive tool prompts.

## Related code files
Verify/update existing behavioral coverage:
- `server/tests/{agent_status_runtime.rs,agent_status_integration.rs,agent_status_hooks.rs}`, `server/src/agent_status/tests.rs`, `server/src/api/tests.rs`, `server/src/config/tests.rs`.
- `packages/ui/src/api/agent-status-types.test.ts`, `packages/ui/src/stores/agent-status.test.ts`, `packages/ui/src/hooks/use-agent-status-connections.test.ts`, `packages/ui/src/lib/terminal-agent-notification-integration.test.ts`, `packages/ui/src/components/organisms/AgentSettings.test.tsx` and existing related settings/config tests.
Docs after successful smoke:
- `docs/architecture/agent-status.md`, `docs/configuration-guide.md`, `docs/api-reference.md`, `docs/linux-systemd.md`, `docs/CHANGELOG.md`, relevant `docs/codebase-summary.md` / `system-architecture.md` summaries.
Create: qualification report and safe screenshot evidence under this plan's reports directory. Remove throwaway scripts/temporary homes; retain only regressions for plausible user-visible bugs.

## Implementation Steps
1. Run focused tests once coherent integration is complete: `cargo test --manifest-path server/Cargo.toml --test agent_status_runtime`, corresponding integration/hooks targets, and relevant API/config filters. UI focused Vitest files through `pnpm --filter @dam-hopper/ui test <files>`.
2. Run full `cargo test --manifest-path server/Cargo.toml`, `pnpm --filter @dam-hopper/ui test`, `pnpm --filter @dam-hopper/ui build`, `pnpm build`, `pnpm lint`. Broad release gate `pnpm check` includes native build; document exact environmental blockers rather than claiming it passed. Use repository formatting tools on changed code, not whole-repo incidental reformatting.
3. Start isolated server, open real browser, install from Agent Settings, complete Codex native trust, launch each actual CLI inside managed PTYs. Record binaries/hash/OS/service euid and config identities without credentials.
4. Exercise prompt/tools, visible approval, allow/deny, long silent waits, Escape, user continuation hook, errors, subagents, clear/resume, same-PTY agent replacement and profile collisions. Observe state/source/age, 15s Unknown expiry and no false completion.
5. Confirm zero added model requests/context from status hooks using hook configuration and captured empty output; compare behavior under collector failure. Do not claim exact billing equality from timestamps/token counts alone.
6. Prove OMP scenarios unchanged; live/replayed Codex OSC9 produces zero DamHopper alerts after removal; no native Stop completion. Codex hook status still works and toggling/migrating preferences does not write native TUI keys. Claude explicit attention only. Disconnect/reconnect use silent baselines.
7. Run packaged CLI/API lifecycle and service-user permission scenarios, including modified files, native config edits, restart-required removal and final no-invocation uninstall. Verify unrelated hooks still execute normally.
8. Qualify v1→v2 migration and explicit rollback restoring compatible DamHopper preference snapshot without whole native-config restoration. Test upgrade launcher binary-path stability.
9. After smoke, update documentation from proposed to implemented only where evidence exists; record capability gaps prominently. Delete scaffolds/throwaway scripts and close review findings.

## Todo list
- [ ] Focused/full coherent verification commands.
- [ ] Real Codex/Claude/OMP and browser acceptance evidence.
- [ ] Packaged install/uninstall, profile isolation and rollback evidence.
- [ ] Documentation/release qualification record after smoke.

## Success Criteria
All acceptance scenarios pass their stated limited-hook contract. Report exact commands/results, versions, screenshots and observed Unknown gaps. No normal-completion claim from Stop, no orphan active hooks after finalized removal, no cross-profile alerts or config mutations.

## Risk Assessment
Account/network availability may block live model turns; record missing prerequisite, do not replace native qualification with fake hooks. Future agent upgrades may change contracts; report unsupported/unqualified until validated.

## Security Considerations
No external production config edits, developer credentials in artifacts, real destructive commands, raw transcripts, full stdin or terminal screenshots containing secrets. Browser screenshots must be sanitized and from isolated workspaces.

## Next steps
Release only after evidence/review closure. Operators install and trust hooks explicitly, restart native sessions, then enable verified channels. No remaining implementation work is labelled complete merely because the plan ends.
