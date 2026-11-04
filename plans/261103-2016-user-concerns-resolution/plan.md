---
title: Single server configuration and working Files editor
status: in_progress
---

# Contract

- One selected server `config.toml`; default `~/.config/dam-hopper/config.toml`.
- `[workspace].root` is the only workspace selection. No local discovery, `defaults.workspace`, or config-parent-as-workspace fallback.
- Global/project/settings endpoints project and mutate this same document. Serialize writes, validate before publication, preserve unrelated sections, fail closed on malformed input.
- Preserve machine settings/projects during an explicit backed-up cutover; remove obsolete `dam-hopper.toml` after migration. No runtime compatibility registry.
- Files: single click selects; double-click/Enter opens real format-appropriate content; reopening focuses existing window. New windows float unless Settings selects tile. Preserve restored modes and explicit docking.

# Execution and ownership

| Slice | Owner | Files |
|---|---|---|
| Configuration schema, startup, transactions, workspace authority, backend tests | UnifiedServerConfig | server/** |
| Files double-click, editor/preview pipeline, Settings, placement, frontend tests | EditorAndSettingsRepair | packages/ui/**, apps/web/** |
| Active docs and deployment/scripts fixtures | ConfigDeploymentCutover | docs/**, README.md, deploy/**, scripts/**, tests/deploy/** |
| Integration, machine config preservation, browser smoke, review | Parent | root legacy config, machine config, plan, validation |

Backend and frontend coordinate API shapes. Parent integrates only after terminal handoffs.

# Guards

1. Invalid root/config leaves previous state and file intact.
2. Settings saves cannot erase projects/workspace/server and vice versa; one selected path and one writer lock.
3. Old filesystem generations cannot write/save into a newly selected workspace.
4. No malformed project target becomes workspace authority.
5. Editor owner/profile/document keys agree between window and parked renderer; media keeps complete explicit target.
6. Float preference affects new launches only; explicit docking and restored placement remain unchanged.

# Validation gates

- Real browser: inspect current failure, single click, double-click, Enter, actual Monaco contents, repeated-open deduplication, workspace and project routes, Settings persistence.
- Focused Rust startup, config preservation/concurrency, root-switch failure and stale-authority tests; relevant filesystem suites.
- Explicit UI TypeScript build, relevant unit/browser suite, production web build; deployment scripts' existing bounded checks.
- Independent review plus Advisor completion consultation; fix findings before success.
- Prior `pnpm check` timeout is not a passing full Rust suite; report actual scopes separately.
