---
title: "Codex and Claude native-hook status rollout"
description: "Extend OMP-first status to removable Codex and Claude command hooks, with bounded evidence, explicit Unknown, and profile-safe settings."
status: in-progress
priority: P2
effort: 48h
branch: main
tags: [feature, backend, frontend, api, security]
created: 2026-09-29
---

# Codex and Claude native-hook status

## Approved outcome
Add normal interactive **Codex CLI and Claude Code** to Agent Settings, status badges, and applicable existing notification channels. User approved **native hooks with explicit Unknown for lifecycle gaps** after discussing screen detection, token cost, installation, and removal. Phase 01's approved contract-only scope was completed on 2026-09-29 (Asia/Saigon): status/source/freshness DTOs, v1→v2 preference migration, Claude config path, strict UI decoding, and static exact-version evidence. Native ingress, runtime expiry, installation, live qualification, and rollout remain incomplete. Effort is a planning estimate, not measured delivery time.

## Decisions
- Silent command hooks only: no model requests, context injection, approval/continuation decisions, transcript reading, or terminal-screen detection. Hooks have local process/IPC overhead, not intended model-token cost.
- Reuse current Rust status reducer/runtime and profile-qualified browser pipeline. Preserve OMP's persistent connection and semantics.
- One-shot native events use a separate bounded private collector route. A **15-second evidence lease**, not fabricated heartbeat, expires observations to Unknown. Long reasoning/waits can show Unknown; present source and freshness explicitly.
- Native Stop is not final settlement. No hook-derived normal turn-ended alerts from Stop, silence, or debounce. **Remove DamHopper's Codex OSC9 integration entirely**, as requested during validation; no fallback handler or automatic Codex TUI-config writes. Codex initially provides status only; Claude explicit attention/error events require qualification. OMP alerts unchanged.
- Managed launchers live under selected server-side `$CODEX_HOME/hooks/` and `$CLAUDE_CONFIG_DIR/hooks/`; merge Codex `hooks.json` or existing inline hook representation and Claude `settings.json`. Preserve user hooks, `notify`, and unrelated settings.
- Complete managed uninstall after reload/restart: no registrations, launcher, or active reporter; preserve unrelated content, report local-edit conflicts and partial failures honestly.
- Scope includes existing path/profile/delivery-gate gaps needed for safe rollout, not a general settings refactor. Version 2 notification preferences migrate v1 values; matched server/UI rollout, explicit rollback snapshot.
- Linux first. Observed qualification targets: Codex 0.158.0; Claude Code 2.1.250. These versions are **not yet qualified**; no minimum-version promise.

## Phases
| # | Phase | Status / progress | Estimate | Dependency |
|---|---|---|---|---|
| 1 | [Capabilities and observation contract](./phase-01-capabilities-and-observation-contract.md) | DONE — approved contract-only scope / 100% (2026-09-29 Asia/Saigon) | 6h | None |
| 2 | [Private one-shot ingress and lifetime](./phase-02-private-hook-ingress.md) | DONE — private UDS ingress, generation fencing, 15s expiry / 100% (2026-09-29 Asia/Saigon) | 10h | 1 |
| 3 | [Managed installer and full removal](./phase-03-managed-hook-installation.md) | Pending / 0% | 8h | 1–2 CLI/DTO contract |
| 4 | [Codex and Claude event adapters](./phase-04-native-event-adapters.md) | Pending / 0% | 8h | 1–2 |
| 5 | [Agent Settings and notification ownership](./phase-05-settings-and-notification-cutover.md) | Pending / 0% | 8h | 2–4 |
| 6 | [Linux end-to-end qualification](./phase-06-linux-qualification.md) | Pending / 0% | 8h | 1–5 |

**Roadmap checkpoint (2026-09-29 Asia/Saigon):** Phases 01 and 02 are DONE. Native 15-second runtime expiry, private UDS ingress, and cross-transport generation fencing are complete and verified. Phases 03–06 remain pending. Live provider qualification targets (Codex 0.158.0; Claude Code 2.1.250) remain unverified subsequent gates.

Phases 3 and 4 can run independently after their shared contracts land. One owner integrates shared Rust exports/CLI/DTOs; no mid-flight builds over inconsistent edits.

## Contracts and evidence
- [Proposed architecture](../../docs/architecture/agent-status.md#proposed-codex-and-claude-native-hook-rollout--not-implemented); existing OMP sections remain normative for implemented behavior.
- [Detailed contract and capability matrix](./design-contract.md).
- [Acceptance scenarios](./acceptance-scenarios.md): all applicable cases required; native gaps must have verified Unknown behavior, not skipped tests labelled parity.
- [User decisions](./reports/decisions.md), [repository findings](./reports/repository-findings.md), [planning request](./reports/planning-request.md).
- [Codex research](./research/codex-report.md), [Claude research](./research/claude-report.md).
- Baselines: [OMP-first plan](../260928-0318-agent-status-omp-first/plan.md), [Agent Settings plan and residual gaps](../260928-2225-agent-store-settings-install-path/plan.md).

## Release and rollback
Deploy matched server/UI before installing new hooks. Back up the previous global UI config outside version control; apply explicit v1→v2 preference migration, preserve Codex channel choices, Claude master off. Install hooks as the actual server-side agent user; respect Codex `/hooks` trust and Claude managed policy. Restart native sessions, verify live reporting, then enable eligible channels. Installation current does not mean runtime ready.

Rollback: disable new delivery, unregister new hooks, restart affected agents, remove verified owned assets, restore the pre-migration preference snapshot before downgrading to a v1-only binary. Never restore an entire native config over concurrent user edits. OMP integration remains usable; no workflow/DB/usage migration.

## Phase 01 implementation and verification
Phase 01 contract-only scope completed on 2026-09-29 (Asia/Saigon), approved after review (8/10; advisor reported no must-fix). Evidence: [capability report](./reports/phase-01-capability-evidence.md). Recorded validation after implementation: Rust 1,586 passed/5 ignored; UI unit 1,942 passed; browser 220 passed/4 skipped; UI TypeScript build passed. The four skipped browser cases require a server. No native PTY/model turn or browser-native-hook check ran; no hooks were installed and live native configuration was not changed. These checks do not establish native runtime expiry or qualification. The initial planning validation report's all-pending snapshot is historical; the phase table above is current.

## Validation Summary
**Validated:** 2026-09-29. **Questions asked:** 3, following architecture/install/token-cost discussion.
- Confirmed 15-second native-evidence expiry, accepting Unknown during quiet work.
- User requested **remove OSC9 too** instead of preserving legacy Codex alerts.
- Confirmed restart-aware uninstall: deregister, restart/verify absence, then finalize owned asset cleanup.
- Action items incorporated: clean OSC9 handler/parser/caller/test removal and automatic TUI-sync removal in Phase 05; live/replayed OSC9 must produce zero DamHopper alerts in Phase 06. Preserve unrelated user Codex configuration and existing policy values without presenting unsupported alert controls as usable.

## Unresolved questions
No unresolved product architecture choice. Implementation gates: exact-binary event availability/ordering, trustworthy root/session/turn attribution, native trust/effective-policy readiness, and safe handling of events without correlation. Unsupported evidence remains Unknown. No release claim until real Linux PTY/browser qualification passes.
