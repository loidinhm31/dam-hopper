# Frozen contracts — editor Git blame

Design specification, not implemented behavior. Parent [plan](./plan.md). Product authority: [accepted brainstorm](../reports/brainstorm-261005-2106-editor-git-blame-annotations.md). Source paths below repo-relative; proposed symbols/files explicitly marked new.

## 1. Scope and defaults

- Line-number gutter right-click toggles annotation for that tab; no Explorer-tree entry point. Native `git2` only.
- Separate author/date column; preserve line numbers, fold controls, existing change markers, and marker left-click file-diff action. Right-click never opens a diff.
- Current Monaco buffer, not saved file or HEAD text. Unchanged lines retain native attribution; zero-OID lines become `uncommitted` with no author/hash/date/link fabricated.
- Normal/degraded editors and Markdown/HTML source panes. Preview-only, diff, merge, binary/image/video/large-file surfaces excluded. Source panes in Edit/Split share toggle; Preview performs no blame work.
- Annotation toggle survives tab/source-pane remounts within session; false after reload/close/reopen. No persistence version bump or settings schema.
- Workspace Git reveal only; preserve tab, dirty bytes, cursor/scroll, and unrelated history preferences. No history mutation, autosave, staging, checkout, fetch, or publication.

## 2. REST-backed operations

### New `git:blame` / `ApiClient.git.blame`

`POST /api/git/{project}/blame`, ordinary protected Git authentication. Target worktree uses camelCase in JSON. Client profile/generation never becomes server authority.

```ts
interface GitBlameInput {
  path: string;                 // always project-relative, never ambiguous root-relative
  content: string;              // current Monaco snapshot; JSON body only
  snapshotId: string;           // opaque request identity, max 64 UTF-8 bytes
  modelVersion: number;        // positive safe integer; echo only, not server trust
}
// Server body additionally carries worktreePath?: string | null.
interface GitBlameCommit {
  hash: string;                 // full OID, never abbreviation for lookup
  authorName: string;
  authorTimestamp: number;      // epoch seconds
  authorTimezoneOffsetMinutes: number;
  subject: string;
}
interface GitBlameRange {
  startLine: number;            // one-based buffer line
  lineCount: number;            // positive; no inclusive-end ambiguity
  commitIndex: number | null;  // null = uncommitted, never a zero-OID commit record
}
interface GitBlameResponse {
  snapshotId: string;
  modelVersion: number;
  rootId: string;               // server-discovered owner, including clean-file cases
  rootRelativePath: string;    // for commit navigation, not resubmission as project-relative
  baseCommitOid: string | null; // null only for a valid unborn repository
  bufferLineCount: number;
  status: "ready" | "uncommitted" | "empty";
  ranges: GitBlameRange[];
  commits: GitBlameCommit[];    // deduplicate by full OID, stable first-seen order
}
```

- Client method: `blame(target: ProjectTargetInput, input: GitBlameInput, options?: TransportInvokeOptions): Promise<GitBlameResponse>`; project through existing owner-bound target projection. Request cancellation uses existing options, not a new transport capability.
- Server resolves root from project-relative `path` using `resolve_git_path_root` after path normalization/validation. Do not accept a client root choice for this operation; it could route a clean file into the wrong nested repository.
- Ascertain real Git repository/file identity. Reuse workspace sandbox and validated worktree selection. Reject absolute/parent/NUL paths and escaping symlink targets; never expose native absolute paths.
- Git internally may need a repository-relative path distinct from root/project-relative path for a project nested below its repository root. Resolve that internally without granting access outside the configured project/worktree.
- Status `uncommitted`: file has no committed baseline and all real buffer lines are uncommitted, including valid unborn HEAD. No fabricated commit. `empty`: no blameable text lines; handle Monaco's empty/trailing-newline display rows explicitly.
- Native ranges must form an ordered, non-overlapping partition of actual text lines; client validates range bounds/indices before rendering. No code content in response.
- `bufferLineCount` follows Monaco display-line semantics: empty string = 1, final newline adds a final empty display line. Native APIs may omit that terminal row; add an explicit uncommitted/no-attribution display row, never copy the previous commit to it. Phase 01 verifies CRLF normalization equivalence before locking conversion implementation.
- Known shallow/boundary commits keep their actual OID/author; do not pretend full older history exists.

### New `git:commitDetails` / `ApiClient.git.commitDetails`

`GET /api/git/{project}/commit/{hash}/details?root=...&worktreePath=...`.

```ts
interface GitCommitDetails {
  hash: string;
  authorName: string;
  authorTimestamp: number;
  authorTimezoneOffsetMinutes: number;
  subject: string;
  fullMessage: string;
}
```

- Accept full exact OID, validate as a commit in the selected repository, read directly from ODB; no walking paginated history and no branch reachability/edit constraints.
- Resolve target/root using existing Git route conventions. Return 404 for absent/non-commit OID rather than a different object. Full message includes body; render as plain text.
- Existing `git:commitFiles` and commit-file diff endpoints remain authoritative for changed files/diff opening.
- Keep existing `git:commitMessage` snapshot API and mutation CAS contract unchanged unless evidence proves a shared read helper can be extracted without weakening those gates. Do not reuse edit eligibility as read eligibility.
- Do not change `GitLogEntry.message` from subject to body or fabricate `isPushed`/branch/action eligibility from annotation metadata.
- Bound raw commit objects before allocation using ODB header size: maximum 5 MiB; encoded details response maximum 32 MiB. Oversize returns `GIT_COMMIT_TOO_LARGE` (413), never a truncated message advertised as full. Native blame metadata resolution applies the same per-object bound before copying author/subject strings.

## 3. Explicit resource bounds

Selected implementation defaults; validate with Phase 01/02 boundary fixtures, not settings knobs.

| Bound | Decision / rationale |
|---|---|
| Buffer UTF-8 bytes | `< 5 * 1024 * 1024`; match existing normal/degraded tier boundary. Unsaved growth across boundary pauses blame with explicit size explanation; editor stays editable. |
| Baseline blob bytes | Same text-size bound before allocating native blame input; reject binary/symlink/submodule blob modes. |
| HTTP JSON body | 32 MiB **only on blame route**; permits worst-case JSON escaping for a <5 MiB buffer plus bounded metadata. Existing other-route 10 MiB limit unchanged. |
| Path metadata | 4096 UTF-8 bytes for path/worktree fields; snapshotId 64; bound before Git work. |
| Encoded blame response | 32 MiB maximum; incrementally bound range/metadata collection memory **before** allocating per-line records, and use bounded serialized writer/size accounting. Return typed limit error; no partial annotations or allocate-then-check response. |
| Concurrent native computations | Two server-wide admitted blame workers, no waiting queue. Try-acquire a shared semaphore before scheduling native work. Busy returns 503; no background retry loop. |
| Edit debounce | 250 ms after last buffer edit; invalidate old attribution immediately, snapshot bytes only when requesting. |
| Client retention | One result and at most one active request plus one latest dirty intent per mounted source editor. No source bytes in query keys or per-keystroke cache entries. |

Use existing `TransportInvokeOptions` timeout semantics. An HTTP deadline/abort does **not** stop libgit2 work. Owned permit stays inside the blocking closure until native computation/serialization exits, including after caller disconnect. Do not release on async handler cancellation. No new cancelability guarantee.

### Error responses

Existing `{error, code}` and existing target/not-Git/auth codes remain. Proposed new stable codes:

| Code | HTTP | Action |
|---|---:|---|
| GIT_BLAME_INVALID_INPUT | 400 | Safe validation explanation; no compute. |
| GIT_BLAME_TOO_LARGE | 413 | Input/baseline/response limit; no partial result. |
| GIT_BLAME_UNSUPPORTED_FILE | 415 | Binary or unsupported Git object mode. |
| GIT_BLAME_STALE_REVISION | 409 | HEAD/root mapping changed during calculation; clear annotations, explicit refresh available. |
| GIT_BLAME_BUSY | 503 | All permits occupied; explicit retry via next edit/focus/manual Refresh, no automatic timer loop. |
| GIT_COMMIT_NOT_FOUND | 404 | Missing/pruned or non-commit OID; keep editor intact. |
| GIT_COMMIT_TOO_LARGE | 413 | Raw commit/details limit; no truncated full-message claim. |

Use typed domain errors and `AppError`/`ApiError` mapping. Stock JSON/body-limit rejections must still be recognized by `ApiRequestError` without echoing request bytes. Verify route-layer order overrides the global `DefaultBodyLimit` for blame only, and unauthorized requests remain rejected.

## 4. Native attribution

1. Validate target/path and bound content (< 5 MiB); no dirty-file disk reread used as the blame snapshot.
2. Resolve owning VCS root and internal repository path via `resolve_git_path_root`. Capture canonical target/root mapping and current HEAD OID.
3. Empty buffer short-circuit: Libgit2's `git_blame_buffer` requires `buffer && buffer_len != 0` and returns `GenericError` (`invalid argument: 'buffer && buffer_len'`) on empty input. If `content.is_empty()`, the server short-circuits native compute and returns status `empty`, 0 ranges, 0 commits, and `bufferLineCount = 1` (with line 1 uncommitted if non-empty editor display required).
4. Line ending normalization: Git ODB blobs normalize text lines with LF (`\n`). Raw CRLF (`\r\n`) in `content` causes native `blame_buffer` to diff `\r` against LF blobs, falsely marking all lines as zero OID. The server normalizes `content` by stripping `\r` before passing bytes to `blame_buffer`.
5. Trailing newline & display rows: In Git diff/blame, omitting a trailing newline modifies the last line in the ODB comparison. Monaco computes `bufferLineCount = content.split('\n').length`. A trailing newline creates an empty terminal display line in Monaco; that terminal row has no Git line attribution and is emitted as an explicit uncommitted range (`commitIndex: null`), never attributed to the preceding commit.
6. For a committed text path: `Repository::blame_file` with `BlameOptions::newest_commit(baseOid)`; then `Blame::blame_buffer(normalized_bytes)`.
7. Resolve committed hunks to author time/offset and subject once per OID; emit compact ranges. Treat zero OIDs as uncommitted, never resolve them as Git objects.
8. Committed renames: Libgit2 `blame_file` automatically tracks whole-file renames across commit history back to the original commit and path (`hunk.orig_commit_id()`, `hunk.path()`).
9. Staged renames: When a file is renamed in the working directory/index but uncommitted, it does not exist at HEAD. The server executes `repo.diff_tree_to_index(Some(&head_tree), Some(&index))` with `DiffFindOptions::renames(true)` via `diff.find_similar`. If the file is reported as `Delta::Renamed`, the server resolves `delta.old_file().path()` at HEAD, executes `blame_file(old_path)` at HEAD, and applies `blame_buffer(normalized_new_bytes)`.
10. Untracked/new/missing-at-HEAD path without a unique rename baseline: all lines uncommitted.
11. Empty/unborn paths: direct honest response with `baseCommitOid: null`, status `uncommitted`, all lines uncommitted.
12. Arbitrary commit read via ODB: `repo.find_commit(oid)` reads arbitrary commit objects directly from the ODB without local branch reference or branch reachability constraints, returning full author signature, committer signature, summary, and full body.
13. Revalidate HEAD and target/root mapping before publication. Any observed change returns stale error (`GIT_BLAME_STALE_REVISION`, 409).
## 5. Client lifecycle and freshness

### State

- Proposed `Tab.blameEnabled?: boolean` (or equivalent field in existing editor state), default false; omitted by `partialize` and normalized to false on hydration. Existing metadata whitelist remains authoritative. No new persistent store.
- Proposed `use-editor-git-blame.ts` owns results, epoch, debounce, model listeners and request cleanup; no raw bytes in global editor state beyond existing tab content.
- State: `off | waiting | loading | ready | unavailable | error`. `waiting/loading` show no stale author/link rows.
- Request identity: `{ owner: {profileId,generation}, targetKey, tabKey, modelId, modelVersion, localEpoch, repositoryRefreshEpoch }`; root/HEAD response belongs to this exact request.
- Acquire owner from live `useConnectionSnapshot`/`captureConnection`; require connected current owner and valid tab resource binding. No fabricated generation from a missing profile and no ambient `getTransport()` fallback.

### Transitions

| Event | Required behavior |
|---|---|
| Enable | Gate supported active source editor; clear old result, fetch current model snapshot. |
| Content change | Increment epoch, clear author/link data synchronously; debounce next latest snapshot. |
| More edits during request | Do not accumulate requests. Mark latest intent; cancel supported transport work but treat abort as local cancellation only. |
| Completion | Publish only after owner, tab/model identity+version, refresh epoch and enabled/source-visible state still match. Then service latest pending intent if superseded. |
| Disable/close/model replacement | Cancel timer/listeners; retire request and result. Closed/reopened tab starts off. |
| Preview-only mode/inactive tab/hidden workspace | Stop requests; keep enabled preference in tab but retire source result; refresh on visible source remount. |
| Save/reload/external file event | Invalidate and fetch current model after source reload/settle; never overwrite dirty content. |
| HEAD/root/repo-changing UI operation | Target/root-scoped invalidation independent of file mtime. Clean unchanged files must reblame. |
| Window focus/visibility restoration or explicit Refresh Annotations | Invalidate immediately, refresh owner-bound root discovery and fetch the latest buffer even when mtime/HEAD is unchanged; coalesce duplicate restoration events. |
| Owner disconnect/reconnect | Retire captured generation; no network fallback; recompute on new current owner only when tab binding allows. |
| Busy/limit/error | Honest status; no previous attribution. Manual refresh or later relevant user event may request again. |

Reuse `invalidateGitHistoryOperation`, `invalidateGitBranchOperation`, target Git query invalidation and owner-bound FS events. Hook observes relevant invalidated target/root Git cache families without caching buffer content; dedupe events so one operation triggers one refresh. Subscribe directly to existing profile-qualified `status:changed` and `workspace:changed` IPC channels with generation checks; do not assume current status invalidation keys match all Git query families. Focus/visibility restoration refreshes enabled source editors even when file mtime is unchanged.

External Git refresh is **event-driven, never feature-polled**. Reuse `useGitRoots` owner/target discovery and each `VcsRoot.status.lastCommit.hash` (`server/src/git/types.rs:41-52`, `vcs_roots.rs:38-133`); do not add `refetchInterval`, periodic timers, watchers, revision endpoints or `git:changed` events. On window focus, document visibility restoration, source activation/remount, explicit Refresh Annotations or relevant repository invalidation, retire the old epoch and refresh scoped discovery without trusting stale cache freshness, then request the current buffer. Changed owning-root mapping/full HEAD invalidates attribution; missing/error root fails closed without primary-root fallback. Unchanged root/HEAD does not suppress an explicit/focus refresh. Deduplicate discovery completion and the initiating event so they do not self-trigger a second refresh. Unrelated cache updates alone do not reblame; preserve unrelated existing Git observers' behavior.

External HEAD changes while continuously focused may remain undetected until a relevant event or focus/manual refresh; no interval or immediate-detection promise. The line-number menu exposes **Refresh Annotations** while enabled, including busy/error states; disable with an explanation when the source/owner is unavailable. It uses the same owner/model/epoch-gated latest-intent path and never saves/reloads dirty bytes or changes selection. Ordinary focus moves within the editor/menu/tooltip are not window/source-restoration triggers.

## 6. Rendering and input

- Proposed `EditorGitBlameGutter.tsx` React component beside `MonacoHost`; reuse existing app tokens and truncation/tooltip patterns. Responsive contract uses the available **whole editor-wrapper inner width before allocating the column**, not browser viewport or post-column Monaco width: at `>=640 CSS px`, column `220px`, author + date; below640, column `min(120px, wrapperWidth / 3)`, author only. Date and exact timestamp/timezone/hash/subject remain available on hover and keyboard focus in both modes; Uncommitted never gains invented metadata. No minimum width that forces overflow, no silent feature disable.
- Reuse the existing MonacoHost `ResizeObserver` lifecycle (`MonacoHost.tsx:147-156`) to measure the stable outer wrapper and update only when mode/allocated width changes. Then relayout Monaco and recompute public geometry in the existing rAF batch. Do not attach a second independent sizing loop or fetch blame on resize. Verify narrow source splits on a wide viewport and both sides of640; if actual visual proof requires numeric tuning, update this contract, phases and verification together without changing compact/full semantics.
- Render only visible actual model lines; locate ranges via binary search or advancing cursor, not scanning every hunk per row. Key rows by model+line identity and full snapshot identity.
- Use public `getVisibleRanges`, `getTopForLineNumber`/`getScrolledVisiblePosition`, scroll top, `getLayoutInfo`, font/line-height options, and layout/hidden-area/configuration/model events. One requestAnimationFrame batches geometry notifications. Disposables and rAF always cleaned up.
- No `line * lineHeight`, private `.view-lines` DOM scraping, author strings inside line-number callback, or custom replacement fold controls.
- Context menu: existing coordinated Radix `ContextMenu` primitive, gated to public mouse hit test `GUTTER_LINE_NUMBERS`. Ordinary code area retains Monaco menu. Native browser menu and app/Monaco menu must not appear simultaneously.
- Prefer a wrapper trigger whose `disabled`/event gate is resolved before context menu handling; prove with actual browser event ordering. If event bridging is necessary, limit to the gutter and use existing menu coordinator rather than a second menu framework.
- Existing Git marker `onMouseDown` must check primary button before invoking `onGitIndicatorClick`. Do not alter marker colors or file-diff baseline.
- Keyboard equivalent: focusable annotation rows and context menu key / Shift+F10 at current editor line; Escape restores focus. No new configurable shortcut.
- Hover: author, original authored timezone date/time, full OID and subject. Plain text, no untrusted HTML/Markdown execution.
- Preserve Cognito capture/inert isolation. Menus/tooltips stay within existing coordinated input/portal policy; no global bypass listener.

## 7. Workspace commit reveal

New workspace-owned request:

```ts
interface GitCommitRevealRequest {
  nonce: number;
  owner: { profileId: string; generation: number };
  target: ProjectTargetRef;
  rootId: string;
  hash: string;
}
```

- Created only from a current committed annotation. Full OID, server-resolved root, original tab target; never ambient project selection.
- `WorkspacePage` carries request to correct target-bound `WorkspaceGitPanel`. Use explicit ensure-open/reveal operation for IDE bottom tool, terminal floating panel, and compact surface. Existing shortcut toggles remain unchanged.
- `TerminalWorkspacePanelRequest` can gain `intent: "toggle" | "reveal"` with current shortcut callers defaulting/explicitly using toggle; migrate all callers/tests when changed. IDE tool activation and compact surface already have request paths; reuse rather than route to GitPage.
- Do not silently change active project to an unqualified name. Target mismatch/disconnect cancels request with reason; owner-qualified selection used where necessary.
- Workspace panel tracks inspected hash separately from normal `useGitHistoryView.selectedCommit`, scoped to target/root/generation. Normal history selection exits inspection. Close clears inspection. Branch/filter/page changes do not coerce inspection into a visible history row.
- Apply root activation before consuming reveal nonce; avoid existing hook's root-change reset erasing the requested selection. Missing requested root fails closed, never defaults to `.`.
- `CommitDetailsPanel` gains explicit discriminated history/inspect modes. History mode retains real `GitLogEntry` and existing action callbacks; inspect mode uses exact hash/details and exposes read-only files/diff viewing only. No fabricated mutation flags. Clicking a real history row restores existing mutation eligibility.
- Full message is displayed in both modes via canonical read-only details API; fetch only while a commit is selected. Changed files reuse existing endpoint; file double-click opens correct root-qualified historical diff.
- If inspected hash is outside visible logs, show clear `Commit opened from annotation; outside current history view` notice rather than resetting filters/pagination or walking all history.

## 8. Native/UI proof gates

- Phase 01 native semantics proven with installed `git2 = 0.19` / `libgit2 1.8.1`: empty buffer short-circuit, CRLF normalization, display-row mapping, committed rename tracking, staged rename diff resolution, ODB commit details, and zero-write immutability verified via executable fixture probe (`git_blame_probe`).
- Public Monaco docs establish feasibility, not installed-package availability or pixel alignment. Real Monaco browser verification mandatory in Phase 04.
- Body limits, worker permit lifetime, stale publication and all three shell layouts are explicit tests/smokes, not assertions from source reading.
- No new dependency, settings, persistence migration, version bump, or broad refactor planned.

## Unresolved questions

- No unresolved native semantics or product decisions. Phase 01 native algorithm proof complete. Phase 02 may implement native blame and read-only Git API endpoints using the proven algorithms without ambiguity.
