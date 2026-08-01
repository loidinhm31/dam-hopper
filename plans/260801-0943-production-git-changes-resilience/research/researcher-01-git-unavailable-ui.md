# Research Report: Git-unavailable project UI/query resilience

Timestamp: 2026-08-01 (Asia/Ho_Chi_Minh)

## Scope and method

Inspected the Git diff query/transport, project-status API, changed-files UI,
VCS-root resolution, and existing Vitest/browser/Rust test locations. No source
files were changed. Goal: handle a configured project directory that is not an
initialized Git repository without masking valid repositories or submodules.

## Findings

1. `packages/ui/src/api/queries.ts` (`useGitDiff`, `useGitUntracked`) directly
   calls `api.git.diff/untracked`; failed HTTP responses become query errors via
   `ws-transport.ts` (`HTTP <status>`/server error). Queries are enabled whenever
   `project` is non-empty; no Git-capability gating exists.

2. `packages/ui/src/components/organisms/ChangedFilesList.tsx` consumes
   `useGitDiff` as `{ data, isLoading, isError, refetch }`, but `isError` is not
   rendered. On a non-Git project `data` is undefined, so the component falls
   through to “No local changes” and still renders staging/commit UI. This is the
   primary production UX bug. The component is the richer/current change
   management surface; `GitLocalChanges.tsx` is a simpler legacy surface and
   also ignores query errors, so audit/update it if still reachable.

3. `ChangedFilesList` requests aggregate root (`root=*`). Server
   `server/src/api/git_diff.rs::list_diff` dispatches to `aggregate_diff`; each
   discovered root is resolved and `git::get_diff_files` is called. A project
   with zero discovered roots therefore returns an error rather than an empty
   `DiffResponse`. Explicit untracked/diff routes similarly resolve a root.

4. `server/src/git/diff.rs::open_repo` maps git2 `NotFound` to
   `AppError::GitNotFound`; this is the correct signal to distinguish “not a Git
   repo” from real Git corruption/permission errors. Do not broadly swallow all
   Git errors in the client or server.

5. Project status is intentionally more tolerant:
   `server/src/api/config.rs::get_project_status` converts `get_status` errors
   into `GitStatus::error`; `GitStatus` (`server/src/git/types.rs`) has optional
   `pathExists` and `statusError`. This status can be used as capability/error
   context, but it does not prevent the diff query from running and does not
   currently expose a dedicated `isGitRepo` boolean.

6. Real submodule/nested-repo behavior must remain unchanged. Aggregate diff
   annotates entries with `rootId`/`rootPath`; `resolve_git_request_root` relies
   on `discover_vcs_roots` and rejects unknown/uninitialized explicit roots.
   Therefore only classify the specific “not initialized / GitNotFound” case;
   preserve retries and visible errors for other failures.

## Minimal design recommendation

- In the UI boundary (prefer `ChangedFilesList`, and the legacy
  `GitLocalChanges` if reachable), detect a Git-unavailable query error using a
  narrow predicate (HTTP/API error code/message containing the server’s
  `GitNotFound`/“not initialized” signal). Render a compact non-Git state:
  “Git is not initialized for this project” plus an optional path and a
  `git init` hint. Hide/disable stage, discard, commit, amend, and untracked
  pagination controls. Keep a retry button for transient errors.
- Better contract, if backend change is acceptable: make aggregate diff return
  an explicit typed response (`gitAvailable: false`, empty entries) only when
  *no* VCS roots exist, or add a machine-readable error code to `ApiError`.
  Avoid returning empty success for a single broken submodule/root: that would
  hide real repository failures. Existing valid aggregate and child-root
  responses remain untouched.
- Use `useProjectStatus`/`GitStatus.statusError` only as supplementary display;
  do not use a heuristic such as checking `.git` from the browser.

## Focused tests

- Add `packages/ui/src/components/organisms/ChangedFilesList.test.tsx` (new
  render-level test with mocked `useGitDiff`) asserting the non-Git message and
  absence/disabled state of commit and stage controls; add a separate test that
  ordinary query errors retain retry/error behavior.
- If extracting an error classifier, unit-test it beside the component or in
  `packages/ui/src/api/queries.test.ts`; cover GitNotFound variants and ensure
  permission/corruption errors are not classified as “not initialized”.
- Extend `packages/ui/src/api/ws-transport.test.ts` only if adding typed error
  decoding; verify server error code/message survives transport.
- Add Rust tests in `server/src/api/git_diff.rs`/`server/src/git/tests.rs`
  (or `server/tests/` endpoint integration) for a configured temp directory
  without `.git`: assert the chosen contract (typed non-Git response or stable
  GitNotFound error). Keep tests for initialized repo and nested/submodule roots
  to prove no regression.
- Existing `packages/ui/src/components/organisms/ChangedFilesList.test.ts`
  currently tests only pure root/group helpers; it is not sufficient for this
  behavior. Existing browser test infrastructure under
  `packages/ui/browser-tests/` can add one smoke case only if the app fixture
  can configure a non-Git project.

## Unresolved questions

- Is `GitLocalChanges` still mounted in production, or can it be removed from
  scope? Both surfaces currently lack error rendering.
- Should the product offer an in-app “Initialize Git” action, or only guidance?
- What exact serialized `ApiError` shape is guaranteed to the browser (code vs
  message)? Prefer a stable code before relying on message matching.
