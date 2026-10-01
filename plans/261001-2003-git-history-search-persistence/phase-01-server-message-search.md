# Phase 01 — server-side commit-message search

## Context links

- [Parent plan](./plan.md); [frozen contract §§1–2](./design-contract.md); [backend research](./research/history-search-research.md).
- [API reference](../../docs/api-reference.md); [Git architecture](../../docs/system-architecture.md#git).
- Dependencies: frozen optional `messageQuery` contract. Can run beside Phase 03 and Phase 02 on disjoint files.

## Overview

- Date: 2026-10-01. Priority: P2. Implementation: DONE (2026-10-01 21:12:48 +07:00). Review: complete (2026-10-01).
- Add message filtering to existing bounded Git log, not a new endpoint or history engine.

## Key Insights

- `server/src/git/repository.rs:get_log` already executes `git log` via `Command` and formats `%s`; `GitLogEntry.message` is subject-only.
- Filtering only returned 200 rows would miss older commits; Git's grep selects messages before skip/count.
- `server/src/api/git.rs:get_log_route` resolves project/worktree/VCS root before reading history. Preserve that boundary.
- Direct Rust tests call `get_log`; all signatures must migrate together.

## Requirements

- Optional query supports literal case-insensitive full-message subject/body matches, including commits beyond first page.
- Empty/trimmed-empty query leaves existing ordering, ref scope, parents/refs and pushed flags unchanged.
- Keep bounded array response, current auth/errors, root resolution, ref validation, and no write-side effects.
- Reject CR/LF/NUL search values with ordinary bad-request error; never let them become multiple grep patterns or an OS argument error.

## Architecture

`REST query → validated GetLogQuery → resolved root → get_log(..., message_query) → existing git log command → existing GitLogEntry parser`.

For nonempty normalized term, append three arguments before optional validated revision: `--fixed-strings`, `--regexp-ignore-case`, `--grep=<term>`. Query contents are one argument, never shell-interpolated. Preserve `%s`; Git matches full bodies without changing formatting.

## Related code files

Modify under repository root:

- `server/src/git/repository.rs`: append `message_query: Option<&str>` to `get_log`; conditional CLI filter only.
- `server/src/api/git.rs`: `GetLogQuery` camelCase `messageQuery`, normalization/request validation, forwarding in `get_log_route`.
- `server/src/git/tests.rs`: migrate all `get_log` calls and add real-repository regressions.
- `server/src/api/tests.rs`: extend existing Git API root/worktree/filter contract coverage, if helper fit confirmed.
- Create `server/tests/git_history_search_api.rs` only if existing API tests cannot cleanly host real HTTP/search fixtures; choose one test location, not duplicate suites.
- `server/src/git/types.rs`: intentionally unchanged DTO.

## Implementation Steps

1. Read exact existing `get_log`, `GetLogQuery`, route handler and Git-test fixture helpers. Check references via configured LSP, else focused repository search; include tests and struct literals.
2. Add optional `messageQuery` to the query DTO using existing camelCase convention. Trim once and map empty to None. Validate single-line/non-NUL term; use existing `ApiError` bad-request mapping.
3. Extend `get_log` with optional term; normalize defensively if direct callers bypass REST. Add conditional fixed-string/case-insensitive grep arguments; keep ref/path validation and existing formatter unchanged. Do not add shell execution or fetch history into Rust for filtering.
4. Migrate direct callers to the new optional argument; normal-history callers pass None. Update any `GetLogQuery` struct literal deliberately, not guessed default filling.
5. Extend real temp-repo tests: subject case variation; body-only match; literal `.*`, brackets and leading `--`; Unicode literal text; whitespace query; matching pagination; branch exclusion; child VCS root/worktree isolation; no-match empty result. Use deterministic timestamps and compare known commit IDs/order, not merely lengths.
6. Fixture with >200 newer nonmatches and one old match proves search crosses default page boundary. Separate fixture with at least three distinct matching commits proves skip counts matches.
7. API test must assert `messageQuery` body-only match and pagination through actual handler/HTTP surface; verify invalid multiline/NUL is a controlled 400, invalid ref existing error, unauthorized request existing rejection. Do not assert query-string forwarding mocks as permanent tests.
8. Preserve current empty/unborn-repository behavior unless existing tests require otherwise; don't add unrelated fallback-to-empty. Verify non-Git remains `GIT_NOT_INITIALIZED`.
9. Report exact changed symbols/callers, tests added, any mismatch from frozen contract. No mid-flight build/test/formatter commands.

## Todo list

- [x] Extend query and Git command without response change.
- [x] Migrate direct Rust callers and query literals.
- [x] Add real-repository message/pagination/scope regressions.
- [x] Add controlled invalid-term API error cases.
- [x] Hand coordinator complete backend slice and test commands.

## Success Criteria

- A matching old commit beyond the first 200 is returned by filtered API query.
- Body-only and case-varied subject matches succeed; regex characters literal; offset counts matches.
- Target/ref/root boundaries and existing normal-history behavior preserved.
- Git operation does not alter HEAD/index/worktree, fetch or publish; fixture compares HEAD before/after.
- Coordinator smoke invokes actual `/api/git/{project}/log?messageQuery=...`; unit tests alone insufficient.

## Risk Assessment

- Git full-message search scans history for sparse/no matches: bounded response, debounced client requests; no exact-count pass/index. Measure latency in Phase 07.
- Case-folding depends on Git/locale: contract guarantees ASCII case behavior; non-ASCII literal test must not falsely claim Unicode normalization.
- Existing CLI/parser limitations unrelated to search remain unchanged; do not rewrite history parsing opportunistically.
- Review note: whitespace-only CR/LF queries trim to empty before control-character validation and therefore become unfiltered searches. Code review classed this low-priority and non-blocking; keep visible for coordinator disposition against the frozen rejection contract.

## Security Considerations

- Keep request authentication, approved project/worktree/root resolution and revision validation.
- Search text is data via one `--grep=` argument; leading option-looking terms cannot inject Git flags.
- No extra logging of commit messages or search terms; no network transport spawned by `git log`.

## Next steps

- Phase 01 DONE (2026-10-01 21:12:48 +07:00). Phase 02 may proceed against the frozen `messageQuery` contract. Coordinator owns cross-phase integration and final qualification in Phase 07; resolve the whitespace-only CR/LF validation note against requirement 26 before closing qualification.
