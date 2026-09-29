# Repository findings

Date: 2026-09-29. Planning only; no application build, tests, install, model prompt, or config mutation.

## Baseline
- Both referenced plans are marked completed. The settings plan explicitly records residual implementation gaps; completed status is not proof that every original requirement shipped.
- `server/src/agent_status/types.rs:77-82` and `packages/ui/src/api/agent-status-types.ts:10,99-101` accept only `omp`.
- Existing Rust reducer/registry, collector, runtime and PTY capability injection are reusable. One root authority per terminal incarnation; snapshot/reconnect silent; 5-second heartbeat / 15-second lease; no success inference.
- `server/src/main.rs` exposes only `integration omp`; `integration.rs` embeds one standalone OMP TypeScript asset. A short-lived hook cannot keep this WebSocket authority alive simply by opening one connection per event.
- `packages/ui/src/components/atoms/AgentStatusBadge.tsx:68-69` already derives its agent label from the row; do not rewrite all tab/Fleet components just to add labels.
- `terminal-agent-notification-integration.ts:41-53` hardcodes semantic policy, agent and titles to OMP. Codex has a separate OSC9 handler; simply broadening the status enum is insufficient.
- `AgentSettings.tsx` uses `owner` for queries but ignores the supplied `profileId`, edits a global preference-source store, and operates on unsaved draft paths. Must preserve explicit owner/generation across save and mutation.

## Settings/path gaps relevant to rollout
- `server/src/api/agent_status.rs` derives homes from host.toml or API process and reads server-level agent env, not actual per-PTY overrides. String/path equality is not proof of runtime installation identity.
- Codex inspection uses `config.toml.is_file()`, not full readable/parseable/safe-parent validation.
- Source `server/src/api/config.rs:343-376` DOES now compare Codex configured/runtime directories when not using the test override. Existing architecture text says it does not: source wins; do not plan a duplicate fix.
- `sync_codex_tui_config` writes `tui.notifications`, `notification_method=osc9`, `notification_condition=always` only on master-toggle transitions. Its default path ignores CODEX_HOME unless an explicit configured path is forwarded; changing paths while enabled is not a clean migration.
- `integration.rs` checks target agent directory and managed file, and checks extensions directory during mutation; ancestor safety and TOCTOU handling need a consistent managed-write boundary.
- Semantic dispatch and OSC9 delivery check saved `enabled`, not a fresh owner-bound eligibility record. Stale installs/path changes can still alert.
- Path decoder coerces booleans using `Boolean(...)`; malformed string values can become true. New eligibility must decode strictly and fail closed.
- Policies currently use version 1, explicit `codex` and `omp` fields, `deny_unknown_fields` in Rust. Adding Claude requires a deliberate persisted schema/matched-release decision, not silently claiming older binaries can read it.

## Prior art: reuse idea, not authority model
- [Herdr integrations](https://herdr.dev/docs/integrations/) and [agents](https://herdr.dev/docs/agents/) explicitly classify Codex and Claude integrations as session identity, with state from screen manifests. Docs cite missing approval resolution and Escape interrupts as lifecycle-hook gaps.
- Herdr Codex writes `hooks.json`, a managed script, and `[features] hooks=true`; Claude writes a managed script and settings hook entries. Both respect their native config-home environment variables.
- Screen manifests and session-restore ingestion are not inherited requirements for DamHopper. Ask before widening the existing semantic-only contract.

## Executed discovery
- `codex --version` → `codex-cli 0.158.0`.
- `claude --version` → `2.1.250 (Claude Code)`.
- `codex features list` → `hooks stable true` (among other flags). Feature availability is not lifecycle qualification.
- Active-plan helper: exited 0 with `EVCRATE_SESSION_ID not set - session state will not persist`; use the explicit plan path.
- docs-seeker initially could not classify free-form queries. Corrected invocation `documentation for openai/codex` succeeded; primary provider docs remain the evidence source.
- Local migrated Claude skill reference contains OMP-renamed paths and an older event list. Not an authoritative Claude configuration reference; use current Anthropic docs.

## Verification plan inputs
- Root scripts: `pnpm build`, `pnpm lint`, `pnpm check`; backend tests must use `server/Cargo.toml` or cwd `server/`.
- UI scripts: `pnpm --filter @dam-hopper/ui test`, `test:browser`, `build` (TypeScript).
- Existing coverage: `server/tests/agent_status_runtime.rs`, `agent_status_integration.rs`, OMP adapter tests; UI decoder/store/connection/notification integration tests and `AgentSettings.test.tsx`.
- Future smoke must launch real agents inside managed PTYs and verify actual browser badges/notifications. Replayed fixture tests cannot establish native hook ordering or runtime liveness.

## Unresolved questions
- Which fidelity tradeoff is acceptable if native hooks cannot expose final settle/cancellation? Resolve with user after provider research; no silent screen parser or reduced-scope rollout.
