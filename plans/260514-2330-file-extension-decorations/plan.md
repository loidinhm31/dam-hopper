---
title: "File Extension Decorations"
description: "Add shared IDE-style file decorations and language metadata across file-oriented web UI surfaces."
status: completed
priority: P2
effort: 5h
branch: main
tags: [frontend, ide, file-explorer, monaco]
created: 2026-05-14
---

# File Extension Decorations

## Summary

Add a frontend-only file decoration system for Dam Hopper's IDE UI. Use one shared registry to decorate files by extension or exact filename, and reuse it for Explorer icons, editor tabs, search results, git file rows, status bar labels, and Monaco language fallback.

## Key Decisions

- Use built-in Lucide icons plus color classes and short text badges; do not add branded icon dependencies.
- Keep folders on existing folder icons; only files use the new decorator.
- Keep the backend unchanged because file name, path, MIME, and binary metadata already reach the web app.
- Make MIME-aware helpers compatible with current `mime-to-language.ts` call sites while allowing extension fallback.

## Phases

| Phase | Status | Effort | Description |
| --- | --- | ---: | --- |
| [Phase 01](./phase-01-shared-file-decoration-registry.md) | Completed 2026-05-15 | 2h | Create shared registry, helpers, and unit coverage. |
| [Phase 02](./phase-02-integrate-file-decorations.md) | Completed 2026-05-15 | 3h | Replace duplicated UI mappings across file surfaces and verify build/tests. |

## Validation

- `pnpm --filter @dam-hopper/web test`
- `pnpm --filter @dam-hopper/web build`
- Manual UI check in Explorer, editor tabs, search results, git changes, and editor status bar.

## References

- Codebase analysis: [reports/codebase-analysis.md](./reports/codebase-analysis.md)
- Frontend components docs: ../../docs/frontend-components.md
- System architecture docs: ../../docs/system-architecture.md
