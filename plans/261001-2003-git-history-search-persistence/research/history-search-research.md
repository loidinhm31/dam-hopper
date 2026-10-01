# Git commit-message search research

> Research, not final contract. Parent chose `messageQuery` (not proposed `search`), trims outer whitespace, rejects CR/LF/NUL, and recorded user-confirmed behavior in [design-contract.md](../design-contract.md). Follow that contract over alternatives below.

## Findings

- **Traversal and response:** `server/src/git/repository.rs:1468-1552` implements `get_log(project_path, limit, offset, git_ref)`. It opens the target repo, validates an optional ref (`1476-1480`), invokes the `git log` CLI (`1482-1502`), parses bounded output (`1504-1549`), and returns `GitLogEntry[]`. Existing args use `--skip=<offset>` and `-n <limit>` before any ref; format is `%H%x00%P%x00%aN%x00%aE%x00%at%x00%s%x00%D` (`1487-1489`).
- **Message semantics:** `GitLogEntry.message` is not the full message: `%s` populates it (`repository.rs:1522`), so it contains the subject only. The Rust DTO is camelCase (`server/src/git/types.rs:320-330`); its UI mirror is `packages/ui/src/api/client.ts:1917-1926`. Search can cover full commit messages while retaining this existing response contract; matching a body-only term can return an entry whose displayed `message` is still just its subject.
- **Order/ref/paging:** Git CLI output is newest-first in current behavior; `server/src/git/tests.rs:3170-3195` pins pages `[commit 3, commit 2]`, then `[commit 1, init]`. Ref omitted means current checked-out branch history; `3143-3167` verifies branch-only history. An explicit un-checked-out branch works (`3197-3221`). Search must be part of Git's commit selection before `--skip`/`-n`, not filter a fetched page or fetch-and-filter all commits in Rust.
- **Errors/empty repo:** Spawn failure becomes `AppError::Git` (`repository.rs:1495-1498`); a nonzero `git log` exit reports stderr as `AppError::Git` (`1499-1502`). Malformed output records are skipped (`1507-1515`). There is no explicit empty-repo branch: the code still runs `git log`; an unborn `HEAD` is expected to take the CLI-error path, but that behavior is not covered in the inspected tests and should be captured as a compatibility test before promising `[]`.
- **REST/RPC mapping:** `server/src/api/router.rs:204` routes `/api/git/{project}/log` to `get_log_route`. `server/src/api/git.rs:628-650` deserializes `limit`, `offset`, `ref`, `worktreePath`, `root`, defaults limit to 100 and offset to 0, resolves the target and Git root, then calls `get_log`. UI `client.ts:2184-2197` invokes `git:log`; `packages/ui/src/api/ws-transport.ts:517-537` maps that RPC to an HTTP `GET /api/git/{project}/log?...`. This is not a pushed WS event; add the request field in both RPC data and HTTP query serialization. No separate native-specific `git:log` handler was established from the inspected transport slice.
- **Query/cache:** `packages/ui/src/api/queries.ts:786-807` exposes `useGitLog(target, limit, offset, ref, root)`. Its key includes normalized project target, root key, page size, offset, and ref. Add search to both query function and key; retain project/profile identity, root, ref, and paging components. `queries.ts:326-402` has Git-history invalidation helpers; keep invalidation prefix broad enough to invalidate every searched page/term after history mutations. On changed search, callers should start at offset zero. Keep the current `GitLogEntry[]` envelope, so existing next-page logic remains length-based; filtered pages continue to use the same limit/offset contract.

## Minimal contract proposal

- Add optional `search` string to the log request, serialized as `?search=<URL-encoded literal>`; `None` or `search=` means no filter. Preserve non-empty input exactly (including whitespace) to honor literal matching; reject NUL explicitly because process argv cannot contain it. Keep the response as a bare `GitLogEntry[]`.
- Thread it through `GetLogQuery` (`server/src/api/git.rs:628-635`), `get_log` (`repository.rs:1468-1473`), `GitLogEntry[]` API method (`client.ts:2184-2197`), WS/RPC-to-REST map (`ws-transport.ts:517-537`), and `useGitLog` arguments/query key (`queries.ts:786-807`). The two product surfaces from the brief—Workspace Git panel and standalone Git page—must pass the input and reset offset; locate/update every `useGitLog` callsite during implementation.
- In the existing `Command::new("git")` implementation, for non-empty search append `--fixed-strings`, `--regexp-ignore-case`, and one `--grep=<search>` argument before pagination/ref arguments. A single `--grep` makes literal case-insensitive substring-style matching over the full commit message without regex interpretation; do not add `--all` or switch traversal libraries. Git performs commit filtering during its walk, and `--skip`/`-n` count matching commits; application memory and response remain bounded to a page. Git still has to traverse history to find sparse matches, so debounce UI requests and avoid claiming constant-time search.
- Keep `validate_revision` before invoking Git (`repository.rs:1477-1479`) and continue passing args separately, never through a shell. Do not casually insert `--` before a ref: in `git log` it separates revisions from pathspecs. Confirm the validator's treatment of option-like refs before changing positional-ref handling. `--grep=<term>` keeps a leading dash in the term attached to its option.
- Scope must remain the resolved project/worktree and selected Git root (`git.rs:643-649`), and the owner/profile-qualified target already present in UI normalization/query keys. Do not broaden to `--all`, another worktree/root, or another profile.

## Files/contracts to update

1. `server/src/git/repository.rs` — optional filter and CLI args; preserve paging, ref validation, output parser, subject-only response.
2. `server/src/api/git.rs` — optional query field and forwarding; retain existing defaults/root resolution.
3. `packages/ui/src/api/client.ts` — log method parameter and request data; no DTO change required.
4. `packages/ui/src/api/ws-transport.ts` — include `search` in GET query parameters.
5. `packages/ui/src/api/queries.ts` — hook parameter, query call, cache key, compatible history invalidation.
6. Workspace Git panel and Git page `useGitLog` callsites — controlled search value, offset reset on term/ref changes, preserve existing pagination and loading/error/empty states. Exact JSX file paths were not recovered in this bounded source slice; the brief identifies these two consumers.
7. `server/src/git/tests.rs` — behavioral coverage described below; transport/API contract tests only if the existing suite has matching route coverage.

## Pseudocode

```text
get_log(path, limit, offset, ref, search):
    repo = open_repo(path)
    if ref: validate_revision(repo, ref)
    upstream = upstream_oid(repo)
    args = ["-c", "safe.directory=*", "log"]
    if search is non-empty:
        args += ["--fixed-strings", "--regexp-ignore-case", "--grep=" + search]
    args += ["--skip=" + offset, "-n", limit, FORMAT]
    if ref: args += [ref]
    output = run git with args in path
    map spawn/nonzero errors as today
    parse only returned page and build unchanged GitLogEntry values
```

## Behavioral tests / edge cases

- Search finds a term in a commit body (not only subject); returned `message` remains `%s` subject.
- Case-insensitive ASCII match; fixed-string punctuation such as `[` or `.*` is treated literally, not as regex.
- Search results beyond the first unfiltered 200 commits are reachable; offset/limit page over matches, not over the unfiltered history (include nonmatches between matches).
- Search is confined to selected branch/ref and current resolved root; existing current-branch and explicit-unchecked-out-branch tests remain valid.
- `None`/empty search preserves current newest-first results and page boundaries; whitespace input follows the declared literal contract; NUL returns a controlled input error rather than an opaque process-spawn failure.
- Empty/unborn repository behavior is explicitly tested and preserved; Git spawn/nonzero errors remain errors. Include multiline/UTF-8 messages and a leading-dash search term.
- Cache keys distinguish search text; changing text/ref resets offset; a mutation invalidates cached results for all search terms and pages. Profile/project/worktree/root changes must never reuse another target's search result.

## Unresolved questions

- Exact UI component file paths for the Workspace Git panel and Git page `useGitLog` callers were not established from the inspected slice; locate them before editing.
- A native-specific transport implementation was not established; confirm whether another app shell dispatches `git:log` outside the inspected `WsTransport` before claiming it needs a separate mapping change.
- `validate_revision` implementation was not inspected; verify leading-dash/option-like ref rejection before altering revision argument handling.
- Confirm current empty-repository behavior in the existing supported Git version; code has no explicit empty-repo case, and no inspected test pins it.
