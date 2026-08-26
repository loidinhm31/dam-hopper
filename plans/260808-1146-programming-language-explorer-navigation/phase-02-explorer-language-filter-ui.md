# Phase 02: Typed Client Cache and Persisted Filter

## Context links

- Parent: [plan.md](./plan.md)
- Server contract: [phase-01](./phase-01-language-model-and-tree-filter.md)
- Client facade: [`client.ts`](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/client.ts:1332)
- Transport mapping: [`ws-transport.ts`](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/ws-transport.ts:454)
- FS events: [`use-fs-subscription.ts`](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/hooks/use-fs-subscription.ts:94)
- Settings: [`settings.ts`](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/settings.ts:44)

## Overview

- Date: 2026-08-08
- Priority: P2
- Description: Add typed scan transport, race-safe project cache, and persisted global filter state.
- Implementation status: Done 2026-08-09 13:42:02 (+07:00)
- Review status: Passed 2026-08-09 13:42:02 (+07:00); focused validation passed, coverage metrics unavailable because `@vitest/coverage-v8` is not installed.

## Key Insights

- TanStack Query already owns project-scoped in-memory data and workspace cache invalidation; avoid a second Zustand/module cache.
- A disabled query alone is unsafe because `invalidateQueries` can refetch active observers; store result/stale metadata explicitly and fetch only through a mutation.
- Filesystem events can arrive during a scan. Generation comparison must prevent an older response from falsely clearing newer staleness.
- The existing global UI config is the persistence path used by `explorerShowHidden`; the language choice should follow it rather than local storage.

## Requirements

- Define `ExplorerLanguageFilter = "all" | "rust" | "javascript-typescript" | "java"` and typed scan DTOs in the filesystem API domain.
- Add `fs:languageFiles` transport mapping and `api.fs.languageFiles(project)`; keep native/web hosts behind the shared transport.
- Define query key `['explorer-language-scan', project]` and cache `{ result, generation, stale, scannedAt }`.
- Scan/Rescan captures start generation; success replaces the result and clears stale only if generation is unchanged. Failure preserves the previous result/stale flag and exposes an error.
- Any project filesystem event increments generation and marks an existing or placeholder cache entry stale without fetching.
- Switching active projects keeps independent entries; `workspace:changed` removes all language-scan queries before broad invalidation; reload/query-client reset clears them naturally.
- Add `explorerLanguageFilter` to Rust `UiConfig`, defaults, serde aliases, global UI merge/roundtrip tests, TS `UiConfig`, `DEFAULT_UI_CONFIG`, settings hydration/pick/save, and tests.
- Missing persisted values default to `all`; invalid API updates are rejected, while the frontend normalizes an unknown legacy/server value to `all`. TOML uses `explorer_language_filter`, JSON uses `explorerLanguageFilter`.
- No scan result, stale state, scan timestamps, or expansion state is serialized.

## Architecture

```text
explicit Scan mutation
  -> GET language-files
  -> generation-checked QueryClient setQueryData(project)

fs:event(project) -> generation++ / stale=true / no request
workspace:changed -> remove all language-scan cache entries

global UiConfig <-> settings store <-> persisted filter choice
```

## Related code files

Modify:

- `/mnt/data/ws/sharing/dam-hopper/server/src/config/schema.rs`
- `/mnt/data/ws/sharing/dam-hopper/server/src/config/tests.rs`
- `/mnt/data/ws/sharing/dam-hopper/server/src/api/tests.rs`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/fs-types.ts`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/client.ts`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/ws-transport.ts`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/queries.ts`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/hooks/use-fs-subscription.ts`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/hooks/use-sse.ts`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/ui-config.ts`
- `/mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/settings.ts`

Tests: corresponding transport/query, FS subscription/SSE, UI-config, and settings test files.

Delete: none.

## Implementation Steps

1. Add shared enum/DTO/cache types and the REST transport mapping.
2. Implement cache key, read, Scan/Rescan, and mark-stale helpers with generation race protection.
3. Integrate mark-stale into every project FS event and remove scan caches on workspace change.
4. Extend Rust/TypeScript UI config and settings defaults/hydration/persistence with enum validation.
5. Add tests for exact URL/JSON parsing, no automatic request, project isolation, stale events, event-during-scan, failed rescan preservation, workspace cleanup, and persisted/default/invalid values.

## Todo list

- [x] Add typed transport and cache contract.
- [x] Implement explicit race-safe Scan/Rescan.
- [x] Mark stale from FS events without refetch.
- [x] Clear scan caches on workspace changes.
- [x] Persist and validate the global filter enum.
- [x] Add cache, transport, config, and settings tests.

## Success Criteria

- Scan results exist only in QueryClient memory and are isolated by project/current workspace.
- No filesystem event or filter hydration triggers a scan request.
- Events during a scan leave its completed result marked stale.
- Failed rescans never erase the last usable result.
- Filter preference round-trips through global config, invalid updates are rejected, and unknown hydrated values become `all`.

## Risk Assessment

- `invalidateQueries` can refetch observed queries; use explicit cache metadata instead.
- Broad workspace invalidation does not remove data by itself; explicitly remove scan keys to prevent same-name project collisions.
- Config enum changes touch Rust and TS contracts; default/alias tests are mandatory.

## Security Considerations

- Cache keys contain configured project names only; response paths stay project-relative.
- Persisted input is a closed enum; the server rejects invalid writes and the client normalizes unknown reads to `all`.
- Stale handling must not cause hidden background filesystem requests.

## Next steps

Hand the stable cache/settings hooks to Phase 03; do not place scan lifecycle state directly in `FileTree`.

## Completion validation

- Focused UI tests: 6 files, 49 passed, 0 failed, 0 skipped.
- Rust config tests: 68 passed, 0 failed.
- Rust API tests: 94 passed, 0 failed.
- UI build: passed with 0 TypeScript errors.
- Coverage report: not generated; `@vitest/coverage-v8` is unavailable.
