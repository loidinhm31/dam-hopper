# Phase 00 — Merge origin/main and reconcile conflicts

## Context links

- [Plan](plan.md)
- [Scout report](agent://ScoutConfigUsage)
- [Research report](../reports/researcher-260914-0854-daemon-state-config.md)
- Remote reference: `origin/main` (`1cba2f104ce5d33edd78f29f8218d759cfa138e4`)

## Overview

- Priority: P1 (Prerequisite)
- Status: DONE 2026-09-14 (ready to commit)
- Effort: 6h
- Goal: merge `origin/main` into `feat/terminal-idle-suspend`, resolve code conflicts while preventing regression of `api_runtime.rs`, and use `docs-manager` to analyze and synthesize all 10 conflicting documentation files.
- Dependency: none (must precede Phase 01).

## Key Insights

- `origin/main` contains PR #29 (`a642931a`), PR #30, and PR #31 (`8c368f43` - HTML preview interactions, workflow notes, clipboard fixes).
- Code collision in `activate.rs`: `main` added `ensure_user_config_ownership` (insecure string-path recursive `chown`). This must be discarded in favor of `HEAD`'s `api_runtime.rs` descriptor provisioner.
- Code collision in `dam-hopper-api.service.in`: `main` pointed to `@API_HOME@/.config/...` while `HEAD` pointed to `/etc/...`. Both yield to Phase 01's Option B target (`/var/lib/dam-hopper/dam-hopper.toml`).
- Documentation collision (10 files): rather than doing a mechanical 2-way git conflict resolve, `docs-manager` must read both sides, understand the merged feature set (HTML preview + workflow + idle-suspend diagnostics), and produce accurate unified documentation.
- Compile and test suites must pass immediately after the merge commit before starting Phase 01.

## Requirements

### Git Merge Mechanics
- Execute `git merge origin/main --no-commit`.
- Resolve code conflicts:
  1. `server/src/linux_release/activate.rs`: take `HEAD` version completely. Ensure `ensure_user_config_ownership` and `chown_recursive` are NOT reintroduced.
  2. `deploy/systemd/dam-hopper-api.service.in`: preserve `ExecStartPre=+@RELEASE_ROOT@/bin/dam-hopper-manager provision-api-runtime` from `HEAD` and stage `--config /var/lib/dam-hopper/dam-hopper.toml`.
  3. `server/src/linux_release/unit_policy.rs` & `server/tests/linux_release_unit_policy.rs`: reconcile assertions to match the new canonical state path.
  4. `packages/ui/src/hooks/use-clipboard.ts`: accept `origin/main`'s updated clipboard implementation.
  5. `WATCHDOG.yml`: accept `origin/main`'s addition.

### Documentation Synthesis via `docs-manager`
- Delegate each conflicting doc file to `docs-manager` to analyze `HEAD` vs `origin/main` and produce a unified version:
  - `docs/system-architecture.md`: retain idle-suspend diagnostics & refusal provisioning architecture, integrate HTML preview host architecture and workflow notes.
  - `docs/codebase-summary.md`: retain idle-suspend modules, integrate HTML preview components and workflow tracking notes.
  - `docs/code-standards.md`: merge standards from both branches.
  - `docs/project-overview-pdr.md` & `docs/project-roadmap.md`: update active milestones reflecting both terminal idle-suspend and HTML preview.
  - `docs/frontend-components.md`: incorporate `HtmlPreview` organism and view mode specifications.
  - `docs/workflow-api.md` & `docs/workflow-client-state.md`: incorporate plan item notes REST and client-state updates.
  - `docs/CHANGELOG.md` & `docs/README.md`: append all PR changelog entries from both branches in chronological order.

## Architecture

```
[origin/main @ 1cba2f10] ────────────┐
 (PR #29, #30, #31: HTML Preview)    │  git merge origin/main --no-commit
                                     ▼
[HEAD: feat/terminal-idle-suspend] ──┴─> 1. Code Conflicts:
                                            • Discard activate.rs chown from main
                                            • Keep HEAD api_runtime.rs
                                            • Adopt main UI features (HtmlPreview)
                                         2. Documentation Conflicts:
                                            • docs-manager AI agent reads both sides
                                            • Synthesizes unified, accurate docs
                                         3. Verify:
                                            • pnpm check / cargo check passes
```

## Related code files

| Action | Path | Description |
| :--- | :--- | :--- |
| Resolve | `server/src/linux_release/activate.rs` | Discard `ensure_user_config_ownership`; keep `api_runtime.rs` |
| Resolve | `deploy/systemd/dam-hopper-api.service.in` | Align `ExecStartPre` and `ExecStart` |
| Resolve | `server/src/linux_release/unit_policy.rs` | Align policy validation |
| Resolve | `packages/ui/src/hooks/use-clipboard.ts` | Accept `origin/main` changes |
| Synthesize | `docs/system-architecture.md` | Merge idle-suspend and HTML preview architectures |
| Synthesize | `docs/codebase-summary.md` | Merge component summaries |
| Synthesize | `docs/frontend-components.md` | Include HTML preview documentation |
| Synthesize | `docs/CHANGELOG.md` | Combine changelog entries |
| Synthesize | `docs/README.md`, `docs/code-standards.md`, `docs/project-overview-pdr.md`, `docs/project-roadmap.md`, `docs/workflow-api.md`, `docs/workflow-client-state.md` | Reconcile roadmap and API docs |

## Implementation Steps

1. Initiate merge: `git merge origin/main --no-commit`.
2. Resolve code conflicts:
   - Check out `activate.rs` from `HEAD` to discard `ensure_user_config_ownership`.
   - Update `dam-hopper-api.service.in` and `unit_policy.rs` to `/var/lib/dam-hopper/dam-hopper.toml`.
   - Check out `packages/ui/src/hooks/use-clipboard.ts` and `WATCHDOG.yml` from `origin/main`.
3. Invoke `docs-manager` subagent to analyze git diffs for all 10 documentation files and write clean, synthesized replacements.
4. Stage all resolved files: `git add .`.
5. Run build and typecheck verification (`pnpm check`, `cargo check`).
6. Commit merge: `git commit -m "chore: merge origin/main and reconcile documentation and runtime contracts"`.

## Todo list

- [x] Execute `git merge origin/main --no-commit`.
- [x] Resolve code conflicts in `activate.rs`, `dam-hopper-api.service.in`, and `unit_policy.rs`.
- [x] Accept `origin/main` updates in `use-clipboard.ts` and `WATCHDOG.yml`.
- [x] Delegate documentation conflict synthesis to `docs-manager` across all 10 conflicting docs.
- [x] Verify clean compilation of web and server workspaces.
- [ ] Commit merge cleanly before initiating Phase 01.

## Success Criteria

- Merge of `origin/main` completes with 0 unresolved conflict markers.
- `server/src/linux_release/activate.rs` contains no recursive `chown` or `ensure_user_config_ownership`.
- All 10 documentation files reflect both idle-suspend diagnostics and HTML preview features accurately.
- `cargo check` and `pnpm check` pass with zero errors.

## Risk Assessment

- Risk of reintroducing `activate.rs` security vulnerability: mitigated by explicitly discarding `main`'s `activate.rs` additions and keeping `HEAD`.
- Risk of losing doc context: mitigated by using `docs-manager` subagent to analyze both versions rather than choosing one side.

## Security Considerations

- Re-enforce rejection of string-path recursive `chown` in `activate.rs`.
- Ensure new HTML preview features from `origin/main` respect existing security headers and iframe sandboxing.

## Next steps

Proceed immediately to Phase 01 (`phase-01-layout-and-descriptor-relative-runtime-provisioning.md`) upon successful merge commit.

**Unresolved questions:** None.
