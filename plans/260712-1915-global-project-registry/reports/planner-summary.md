# Planner Summary

Date: 2026-07-12
Plan: Global Project Registry + Absolute Project Paths
Status: pending

## Decision

Use Approach B from the brainstorm: one canonical global project registry plus per-project-root filesystem sandboxing.

## Phase Split

1. Global registry path and config loading priority.
2. Parser support for absolute project paths.
3. Per-project-root sandbox.
4. API and state semantics updates.
5. Config write roundtrip preservation.
6. Integration tests, Windows paths, docs.

## Security Invariant

Runtime file access is limited to configured project roots. Absolute paths in TOML identify trusted project roots; absolute paths from client requests are not accepted as ambient filesystem authority.

## Validation

- Focused Rust tests per config/fs/API module during implementation.
- Final backend gate: `cd server && cargo test -j 1`.
- Frontend tests after API type/display changes.
- Manual Windows smoke with two absolute project paths.

## Unresolved Questions

See `plan.md` for fallback discovery, `workspace_dir`, `[workspace].root`, agent store location, watcher limits, and `workspace:switch` semantics.
