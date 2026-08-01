---
title: "Production Git Changes Resilience"
description: "Make non-Git projects explicit and recover once from stale Vite chunks."
status: in-progress
priority: P1
effort: 5h
branch: main
tags: [bugfix, frontend, backend, api]
created: 2026-08-01
---

# Production Git Changes Resilience

## Overview

Fix two independent production failures: a registered non-Git directory presenting as an empty Changes view, and a stale GitHub Pages code-split chunk crashing the page.

## Execution

```text
Phase 01 (Git API + UI state) ──┐
                               ├─> Phase 03 (validation)
Phase 02 (stale chunk recovery)┘
```

Phases 01 and 02 may run in parallel. Phase 03 waits for both.

| Phase | Status | Group | Effort | Plan |
|---|---|---:|---:|---|
| Git-unavailable state | **DONE — 2026-08-01 13:11 +07:00** | A | 2h | [01](./phase-01-git-unavailable-state.md) |
| Stale-chunk recovery | **DONE — 2026-08-01 14:42 +07:00** | A | 1h | [02](./phase-02-stale-chunk-recovery.md) |
| Tests and release validation | pending | B | 2h | [03](./phase-03-validation.md) |

## Ownership matrix

| Files | Owner |
|---|---|
| `server/src/error.rs`, `server/src/api/error.rs`, `server/src/api/git.rs`, Git API tests, `ChangedFilesList*`, transport/query types | 01 |
| `packages/ui/src/components/ui/ErrorBoundary*` | 02 |
| No source ownership; runs existing focused suites and production smoke checks | 03 |

## Decisions

- Never initialize a configured directory implicitly. Its Git history/provenance must be an operator choice.
- Preserve generic transport errors; expose a typed unavailable result only for a missing Git repository.
- Reload at most once per session for a recognizable stale module-load error. All other render errors remain visible and retryable.
- Do not alter GitHub Pages deployment mechanics for this fix.

## References

- [Git UI research](./research/researcher-01-git-unavailable-ui.md)
- [Lazy-import research](./research/researcher-02-lazy-import-recovery.md)
- [Existing Changes plan](../260718-1923-terminal-explorer-git-changes/plan.md)

## Unresolved questions

- None. Production must point `github-repo-rag` at a real clone separately from this code change.
