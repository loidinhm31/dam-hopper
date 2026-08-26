---
title: "Programming Language Navigation in Explorer"
description: "Add manual full-project Rust, JavaScript/TypeScript, and Java navigation to Explorer."
status: completed
priority: P2
effort: 16h
branch: main
tags: [feature, backend, api, frontend, explorer]
created: 2026-08-08
---

# Programming Language Navigation in Explorer

## Overview

Add explicit full-project language scans and navigation for Rust, combined JavaScript/TypeScript, and Java. A sandboxed server endpoint returns bounded file metadata; the browser caches it in memory, persists only the selected filter, and builds a navigation-only hierarchy without recursively loading Explorer directories.

## Contract

- Options are `All`, `Rust`, `JS/TS`, and `Java`; persist one global `explorerLanguageFilter` setting, default `All`.
- `GET /api/fs/language-files?project=NAME` returns `{ files, truncated, limit }`; each file has normalized `path`, `size`, `mtime`, and family `rust | javascript-typescript | java`.
- Resolve the project root through the existing sandbox. Honor Git ignore sources, include hidden paths, exclude/fail closed on symlinks, cap visited regular files at `200_000`, and cap matches at `20_000`.
- Scan only `.rs`, `.js`, `.jsx`, `.ts`, `.tsx`, and `.java`, case-insensitively. Do not add parser/MIME detection or new aliases.
- Cache `{ result, generation, stale, scannedAt }` under `['explorer-language-scan', project]`; Scan/Rescan is explicit and filesystem events only increment generation/mark stale.
- A scan finishing after a filesystem event stores its response as stale; only a success with the start generation still current clears stale.
- Active-project switches retain separate project entries; workspace changes remove all scan entries; reload/query-client reset loses them.
- `All` uses the live lazy tree and full filesystem operations. Language modes build a complete hierarchy from scan paths and are navigation-only.
- Reveal while filtered persists `All`, waits for the unfiltered Arborist commit, reveals the path, then consumes the nonce. Filter/scan changes clear stale selections.

## Phases

| # | Phase | Status | Effort | Link |
|---|---|---|---:|---|
| 1 | Sandboxed server language scan | Completed 2026-08-09 (+07:00) | 5h | [phase-01](./phase-01-language-model-and-tree-filter.md) |
| 2 | Typed client cache and persisted filter | Completed 2026-08-09 13:42:02 (+07:00) | 4.5h | [phase-02](./phase-02-explorer-language-filter-ui.md) |
| 3 | Explorer navigation, reveal, and release validation | Completed 2026-08-10 00:36:17 (+07:00) | 6.5h | [phase-03](./phase-03-validation-and-documentation.md) |

## Dependencies

- Existing `api/fs.rs` sandbox resolution and `fs/ops.rs` ignore walker are the server implementation pattern.
- Existing `file-decoration.ts` defines the browser mapping contract; mirrored server extensions require parity tests.
- Existing `useFsSubscription`, global UI config, settings store, and `FileTree → WorkspacePage → editor` flow are integration points.
- Preserve unrelated dirty worktree changes, especially `docs/system-architecture.md`.
- Scout evidence: [scout report](../reports/scout-260808-1146-programming-language-explorer-navigation.md).

## Non-goals

No automatic/background scan, persisted index, recursive client listing, content/MIME detection, parser/LSP, symbols/references, streaming progress, user-defined limits, workspace-wide multi-project scan, or extra language families/extensions.

## Final validation

Run focused Rust/API and UI unit/browser tests first, then `pnpm --filter @dam-hopper/ui build`, `pnpm lint`, `pnpm test`, and `pnpm check`. Report unrelated dirty-worktree failures without widening scope.

## Phase 03 Completion (2026-08-10 00:36:17 +07:00)

Phase 03 implementation and review are complete. Navigation hierarchy, manual scan states, navigation-only capability boundaries, selection cleanup, commit-gated reveal, focused tests, and browser regression coverage were delivered.

Validation evidence recorded in the Phase 03 plan: focused UI/Rust/API tests and UI build passed; broad browser validation was attempted but has an unrelated existing terminal import failure; `pnpm check` reached the native package stage but was blocked by native package disk quota; temporary-file-producing checks require a `TMPDIR` workaround because `/tmp` quota is exhausted. These are environment/baseline caveats, not feature failures.

## Validation Summary

**Validated:** 2026-08-08
**Questions asked:** 8
**Outcome:** Revised in place on 2026-08-08; ready for implementation except higher-rank revalidation remains pending.

### Confirmed Decisions

- Language grouping: one combined `JS/TS` filter alongside `All`, `Rust`, and `Java`.
- Coverage: user-triggered full-project scan with an in-memory result cache, not loaded-tree-only projection.
- Scan engine: one sandboxed server endpoint, not recursive browser directory-list requests.
- Persistence: persist only the selected filter; do not persist scan results across reloads.
- Reveal Active File: reset to `All`, wait for the unfiltered render, then reveal the active file.

### Applied decisions

- [x] Replaced loaded-tree assumptions in architecture, contract, effort, and every phase.
- [x] Defined endpoint, sandbox/ignore/symlink policy, fixed cap, timeout/error behavior, and no streaming/cancel protocol in v1.
- [x] Defined project-keyed cache, manual replacement, workspace cleanup, stale generation, and in-flight event race handling.
- [x] Added backend, API/transport, settings/cache, reveal, selection, and Chromium coverage.
- [x] Re-estimated the cross-layer work at 16 hours.
- [ ] Higher-rank revalidation: `gpt-5.6-sol` was unsupported and the `gpt-5.5` fallback quota was unavailable until 2026-09-07. Per user direction, revision proceeded without claiming advisor approval.

## Resolved validation questions

Ignored paths stay excluded; hidden paths are scanned then presentation-filtered; generated/vendor paths follow ignore files; symlinks are excluded and never followed. Filesystem events mark stale only. The server returns at most 20,000 matches with `truncated`, the UI shows indeterminate pending/stale states, and the existing transport timeout aborts the client request while the bounded blocking walk may finish server-side.
