# Phase 01 — Target contract and secure resolution

## Context links

- [Plan](./plan.md)
- [Backend research](./research/researcher-01-backend-target-security.md)
- [Frontend research](./research/researcher-02-frontend-target-state.md)
- [Architecture](../../docs/system-architecture.md#project-worktree-targets-planned)
- [Brainstorm](../reports/brainstorm-260817-0113-project-worktree-target-switching.md)

## Overview

- Date: 2026-08-17
- Description: Establish the cross-layer target contract, robust worktree discovery, and the server-authoritative resolver.
- Priority: P2
- Implementation status: completed
- Review status: approved

## Key Insights

- A project is the stable authorization identity; a worktree is an optional operation target.
- The configured root is identified by canonical path equality, not by porcelain output order.
- Client paths are untrusted even when they exist; only Git-registered worktrees of the configured repository are eligible.

## Requirements

- Define compatible Rust and TypeScript target/worktree representations.
- Preserve absent `worktreePath` as the configured-root default for backward compatibility.
- Parse detached, locked, bare, and prunable porcelain records.
- Resolve and validate targets without holding shared locks across Git or filesystem awaits.
- Return stable errors for unknown project, unregistered target, unavailable target, and invalid path.

## Architecture

Add a focused resolver service used by downstream APIs. It reads the canonical configured root, lists registered worktrees through the existing Git adapter, canonicalizes existing targets, and returns a validated target descriptor containing project, canonical root, stable target key input, and availability metadata. A bounded short-lived discovery cache is allowed but must expose deterministic invalidation.

## Related code files

- Create: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/workspace_target.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/lib.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/state.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/git/types.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/git/cli_fallback.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/git/worktree.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/src/api/git.rs`
- Modify: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/packages/ui/src/api/client.ts`
- Create: `/home/loidinh/WS/dam-hopper-ws/feat-project-worktree-switching/server/tests/workspace_targets.rs`

## Implementation Steps

1. Define `ProjectTargetRef` and resolved-target/domain errors in Rust; define matching camelCase request types in TypeScript.
2. Extend porcelain parsing to retain locked/prunable/detached state and determine configured-root identity by canonical equality.
3. Implement target resolution and membership validation for root, valid worktree, missing/prunable path, foreign repository, and arbitrary sibling path.
4. Add cache invalidation hooks after worktree add/remove/prune and explicit list refresh; keep correctness independent of cache hits.
5. Extend worktree API responses with availability metadata required by selection UI without making unavailable entries selectable.
6. Add unit and real-repository integration tests, including paths containing spaces and symlink/canonicalization cases.

## Todo list

- [x] Add shared target contracts and stable errors.
- [x] Harden porcelain parsing and main-root detection.
- [x] Implement authoritative resolver and bounded cache.
- [x] Wire invalidation into worktree mutations.
- [x] Add parser and resolver tests with real temporary repositories.

## Success Criteria

- Root requests need no new client field and resolve exactly as before.
- Valid registered worktrees anywhere on disk resolve; unregistered or foreign paths fail closed.
- Reordered, locked, detached, and prunable porcelain fixtures behave deterministically.
- Add/remove/prune is visible after invalidation without server restart.

## Risk Assessment

- Canonicalization differs for missing paths; represent unavailable porcelain entries without accepting them for operations.
- Git CLI latency could affect high-frequency calls; downstream phases must reuse resolved targets or the bounded cache.
- Repository layouts with a bare main worktree need explicit fixtures.

## Security Considerations

- Never accept a target based only on path containment under a user-supplied parent.
- Do not expose filesystem paths belonging to other configured projects or repositories.
- Sanitize Git/path details in public errors while retaining diagnostic context server-side.

## Handoff

Phase 01 is complete; its validation and final review passed. The remaining
phases are recorded as completed in the root plan.

## Validation summary

- `cargo fmt --manifest-path server/Cargo.toml --check`: passed; root `cargo fmt --check` is invalid because no root manifest exists.
- `cargo check --manifest-path server/Cargo.toml`: passed.
- `cargo test --manifest-path server/Cargo.toml --test workspace_targets`: 10 passed.
- Worktree API route tests: 5 passed; resolver/cache/parser unit tests: 5 passed.
- Full Rust library suite: 708 passed, 1 ignored.
- `pnpm build`, `pnpm lint`, and `git diff --check`: passed.
- Final review: approved; no blocking issues.

Accepted non-blocking warnings: cosmetic Clippy warning; intentional null/absent-field semantics for backward compatibility; repository-local catalog and development-rule files are absent (workspace-level equivalents used).
