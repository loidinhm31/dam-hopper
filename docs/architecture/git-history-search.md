# Git History Search: Transport and Query Ownership

**Status:** Phase 01 delivers server-side message filtering. Phase 02 delivers the shared client transport and owner-scoped query contract. Search controls, persisted selections, and integrated qualification remain in later plan phases. This guide documents the server/API and client-query boundaries, not a completed search UI.

## REST API contract

`GET /api/git/{project}/log` uses the existing authenticated Git route. Optional query parameters are:

| Parameter | Default | Meaning |
| --- | --- | --- |
| `limit` | `100` | Page size. |
| `offset` | `0` | Number of history entries to skip; with `messageQuery`, skips matching entries. |
| `ref` | `HEAD` | History starting revision. |
| `worktreePath` | — | Registered worktree target. |
| `root` | — | VCS root ID. |
| `messageQuery` | — | Commit-message filter. |

Missing or whitespace-only `messageQuery` leaves history unfiltered. Otherwise,
the server passes the term as one fixed-string Git argument, not interpolated
into a shell command, and matches literal, ASCII-case-insensitive text against
the full commit message (subject and body) before pagination. Unicode
normalization is not implied. Embedded CR/LF and NUL in the trimmed nonempty
term return HTTP `400`; the current trim-before-validation order strips
leading/trailing CR/LF first, so a CR/LF-only value becomes an unfiltered
request. This known edge is tracked in the Phase 01 risk record.

The response remains `GitLogEntry[]` with `hash`, `parents`, `authorName`, `authorEmail`, `timestamp`, `message`, `refs`, and `isPushed`. `message` is subject-only, even when a body-only match selects the commit.

## Shared client transport

`ApiClient.git.log` and its implementation accept an optional final `messageQuery?: string | null` argument after `root`. The owner-bound client projects a qualified project target to the server target (`project` and optional `worktreePath`); browser-only `profileId` is not sent to the route.

The existing `git:log` transport channel maps to this REST endpoint in `WsTransport`; it is not a new WebSocket history event. The mapper builds query parameters with URLSearchParams, including `messageQuery` only when it is a nonempty trimmed string. Project path encoding, worktree, root, revision, and pagination continue through this same mapping. Shared browser/native clients use this API and transport path; Phase 02 adds no separate native command.

## Owner-scoped query contract

`normalizeGitMessageQuery()` trims surrounding whitespace and maps `null`, `undefined`, or an empty result to `undefined`; it does not case-fold the term. `gitLogQueryOptions(target, limit?, offset?, ref?, root?, messageQuery?)` is the single builder used by `useGitLog` and available to refresh consumers. It passes the normalized term to the bound client and includes the same value in the query key.

For a profile-qualified target, the log query key contains the resolved owner (`profileId` and connection `generation`), project/worktree target, VCS root, limit, offset, revision, and normalized term. Different terms, including case variants, remain distinct cache entries. The default root key is `.`. Use a qualified target for owner-scoped history reads; legacy unqualified callers retain their existing ambient path and must not be used as an owner fallback.

The query's existing `enabled` guard is based on the normalized project name. A caller that has not resolved its target can keep the `profileId` on a qualified empty-project target so the query stays disabled without switching owners. Once the target is ready, it passes the real target. Do not replace this with an unqualified empty-project fallback.

`gitHistoryQueryPrefixes(target, root?)` provides owner/target/root-qualified branch, status, log, and commit-detail prefixes. Its log prefix intentionally omits page, revision, and term so refresh and mutation invalidation can cover all log variants under that root without copying key construction into callers. `invalidateGitHistoryDetails()` uses the same detail prefixes.

## Source map

- `packages/ui/src/api/client.ts` — optional client argument, bound transport invocation, and wire-target projection.
- `packages/ui/src/api/ws-transport.ts` — `git:log` to REST/URLSearchParams mapping.
- `packages/ui/src/api/queries.ts` — normalization, shared query options, owner/root prefixes, and `useGitLog` delegation.
- Focused contract coverage: `packages/ui/src/api/ws-transport.test.ts`, `packages/ui/src/api/queries.test.ts`, and `packages/ui/src/api/ownership.test.ts`.
- Server route and filter: `server/src/api/git.rs` and the Git repository log implementation.

See the [API Reference: Commit history](../api-reference.md#commit-history), [Git history search standards](../code-standards.md#git-history-search-queries), and the Phase 02 plan at `plans/261001-2003-git-history-search-persistence/phase-02-transport-query-contract.md`.
