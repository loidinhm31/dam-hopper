# Phase 02 — transport and owner-scoped query contract

## Context links

- [Plan](./plan.md); [design §§1–2](./design-contract.md); [history research](./research/history-search-research.md).
- [Ownership standards](../../docs/code-standards.md#profile-qualified-files-editor-search-and-git-phase-03).
- Dependency: Phase 01 wire contract frozen; frontend slice may proceed in parallel, integration requires real server support.

## Overview

- Date: 2026-10-01. Priority: P2. Status: DONE (2026-10-01 21:55:00 +07:00). Review: passed.
- Extend one optional field through current browser/native REST transport and share exact log query construction.

## Key Insights

- `client.ts` has API implementation and separately declared `ApiClient.git.log` signature; both must update.
- `ws-transport.ts` dispatches `git:log` to REST despite its name; server does not need a new WebSocket history handler.
- `queries.ts` uses owner/generation prefixes via `gitQueryKey`; Workspace refresh currently builds independent legacy keys and calls ambient API. Cut that path over in Phase 05.
- Native/shared hosts consume the shared client. Do not add a redundant Tauri command unless actual mapping evidence requires it.

## Requirements

- New optional final argument `messageQuery?: string` in `api.git.log`, typed `ApiClient.git.log`, and `useGitLog`; existing nonsearch callers remain correct without deprecated aliases.
- Transport payload and REST query use camelCase `messageQuery`; empty query omitted; `profileId` never goes on server wire.
- Query identity includes normalized term and all existing owner/root/worktree/ref/paging distinctions.
- Refresh and initial load can use the same typed options builder; no owner fallback or cross-profile invalidation.

## Architecture

`getBoundApiClient(owner).git.log → existing transport.invoke('git:log', wire target + messageQuery) → existing REST route mapping → GetLogQuery`.

Export `gitLogQueryOptions(target, limit?, offset?, ref?, root?, messageQuery?)`; construct once using current `gitQueryKey` and bound API. `useGitLog` delegates; Phase 04 imports options for guarded refresh. Keep prefix compatibility for existing mutation invalidation.

## Related code files

Modify:

- `packages/ui/src/api/client.ts`: implementation near `git.log`, `ApiClient` contract; preserve `GitLogEntry` DTO.
- `packages/ui/src/api/ws-transport.ts`: `case 'git:log'` typed payload and URLSearchParams mapping.
- `packages/ui/src/api/queries.ts`: shared builder, term key suffix, `useGitLog`; existing invalidation helper only if its prefix is incorrect for variants.
- `packages/ui/src/api/queries.test.ts` / `phase-03-files-editor-search-git.test.ts`: extend existing cache/ownership behavioral coverage where appropriate, not separate wiring assertions.
- `packages/ui/src/api/ws-transport.test.ts`: update affected tests only; any existing new-term forwarding-only check should be throwaway smoke, not permanent mocked echo.
- `apps/native/src/main.tsx` and `packages/ui/src/api/connections.ts`: verified native host uses shared `connectProfile`/`WsTransport`; intentionally unchanged. Browser bridge contains browser-debug bridge/picker, not a separate Git log transport.

## Implementation Steps

1. Read exact client implementation/type, Git log REST dispatch, owner/key helpers, and mutation invalidation prefixes. Use LSP references if available before exported `useGitLog`/client signature changes; otherwise focused search includes tests and mocks.
2. Append optional `messageQuery` argument consistently. Normalize outer whitespace using one shared frontend helper or builder; avoid a second regex/case-folding search algorithm. Send explicit wire target through existing `toWireTarget` projection.
3. Extend REST route payload type and add URLSearchParams entry for nonempty term; keep existing ref/root/worktree path and authentication mapping. Never concatenate raw `&`, `+`, `#`, `?`, non-ASCII or percent-bearing query text into URL.
4. Export `gitLogQueryOptions` from `queries.ts`, then let `useGitLog` use it. Term key component matches transmitted trimmed term (empty/null canonical). Do not collapse other term case variants unless request semantics and key policy explicitly agree.
5. Freeze scope-gating mechanism: controller always calls `useGitLog`, but while unavailable/unhydrated/unresolved passes qualified `{ ...target, project: '' }` so existing enabled guard disables reads. Preserve profile owner even in disabled target; no unqualified empty-string fallback. Once ready use the actual target. No extra enabled-options API or initial HEAD request while pin unresolved.
6. Ensure `gitQueryKey` key prefix for each owner/target/root is unchanged; existing Git mutation invalidation must hit both filtered and ordinary variants. Expose narrow history query-prefix helper if controller needs refresh of branches/status/details; reuse current owner/key logic rather than copying it into components.
7. Migrate impacted tests/mocks to preserve signatures; delete assertions that pin old incidental key-array wording. Keep behavior tests for cache isolation, target routing, and filtered invalidation.
8. Add one consumer-visible cache isolation scenario: same-name project on two profiles with distinct terms/ref/root cannot render other owner's commits; owner generation switch cannot publish old log results. Different query values must not reuse the previous visible result. No bare query-key-array equality as sole regression.
9. Verify the server route and transport encoding separately: the server API regression covers message-query search and pagination, and `ws-transport.test.ts` covers reserved-character encoding. Full live browser-to-server search smoke remains a Phase 07 qualification gate.
10. Report changed symbols, shared builder/enable contract and relevant callsites; no worker checks mid-flight.

## Todo list

- [x] Extend both client signatures and REST mapping.
- [x] Centralize owned log options and optional scope gating.
- [x] Preserve mutation prefix invalidation across search variants.
- [x] Update affected behavior tests/mocks and report exported contracts.

## Success Criteria

- Server API and client transport tests verify message-query search/pagination and safe query encoding; full live browser-to-server verification is a Phase 07 qualification gate.
- Query/cache results isolated by profile generation, target, root, ref, page and term.
- Existing logs without final argument behave unchanged.
- Shared options sufficient for controller refresh; no unowned key or ambient call introduced.
- Native adds no duplicate endpoint if shared transport already covers it.

## Risk Assessment

- Broad positional-to-options refactor touches unrelated consumers: avoid it; add optional final parameter.
- Empty-state query accidentally resolves ambient owner: keep current qualified owner failure semantics and controller availability gating.
- Shared exported helpers create dual key conventions: centralize in current `queries.ts`, not a new cache abstraction.

## Security Considerations

Capture owner generation; use `getBoundApiClient`; server payload projection removes profile ID. Preserve authentication and REST encoding; never dispatch stale qualified requests through a global active profile.

## Next steps

- Phase 02 DONE (2026-10-01 21:55:00 +07:00): implementation and verification complete (71 UI tests + 2 server tests passed; UI and web TypeScript checks clean). The `git_log_api_supports_message_query_search_and_pagination` API regression and `ws-transport.test.ts` reserved-character encoding coverage pass. Live browser-to-server qualification remains Phase 07. Stable query options `gitLogQueryOptions`, `gitHistoryQueryPrefixes`, and `normalizeGitMessageQuery` are ready for Phase 04 (`use-git-history-view.ts`). Next: wait for Phase 03 selection persistence store to land, then proceed with Wave B (Phase 04 shared history controller). Unresolved questions: none.
