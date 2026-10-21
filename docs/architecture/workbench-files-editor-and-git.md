# Workbench Files, Editor, Search, and Git Architecture

**Authority:** Workbench Core (`packages/ui/src/`, `server/src/fs/`, `server/src/git/`)  
**Status:** Maintained Architecture Specification  

The profile-qualified IDE workbench operates on top of the unified shell. Files, editor tabs, search results, replace operations, previews, and Git mutations all retain the server profile and optional Git worktree that owns the resource. This ensures identical project names or paths on two servers never share state or collide.

## Target Identity

The browser uses a project target reference:

```ts
interface ProjectTargetRef {
  profileId: string;
  project: string;
  worktreePath?: string | null;
}
```

A missing `worktreePath` selects the configured project root. A non-empty path selects a server-validated registered worktree. `profileId` is a browser connection owner and is not sent in the server wire target; the owner-bound API client projects a target to `{ project, worktreePath? }` only after checking that its profile matches the captured connection.

Each asynchronous request captures `{ profileId, generation }`. A disconnected, replaced, or reconnected profile makes the captured generation stale. Stale responses are ignored, mutations do not fall back to another profile, and an unavailable worktree remains unavailable until discovery proves it usable again.

The target store keeps root and worktree selection separately for every profile/project scope. Project names, worktree paths, query keys, editor keys, folder expansion, and invalidation keys must not be built from an unqualified project name.

## Files and Live Tree

The selected target is passed to every file operation:

| Surface | Contract |
| --- | --- |
| List/stat/read | REST or owner-bound transport with `project`, optional `worktreePath`, and project-relative path. Range reads accept `offset` and `len`. |
| Write | `fs:write_begin` → chunk frames → `fs:write_commit`; the server checks the expected mtime and returns a conflict instead of overwriting newer content. |
| CRUD | `fs:op` supports `create_file`, `create_dir`, `rename`, `delete`, and `move`; `new_path` is used for rename/move. |
| Watch | `fs:subscribe_tree` returns a subscription ID; `fs:event` applies safe deltas or triggers a target-scoped refetch; cleanup sends `fs:unsubscribe_tree`. |
| Upload | `fs:upload_begin` → acknowledged binary chunks → `fs:upload_commit`, with bounded in-flight chunks and progress reporting. |
| Download | Target-qualified download/ticket requests; an unavailable owner or target produces an explicit error rather than a root/profile fallback. |

The tree cache and persisted folder expansion include profile and target keys. File events update only the matching target. A create, rename, or move that cannot be applied safely causes a scoped refetch; it never mutates another profile's tree.

### Transport-Safe Watcher Lifecycle

The live-tree watcher resolves ownership before it resolves transport. For a qualified target, `useFsSubscription` captures the target profile's current `ConnectionRef` and obtains that profile's transport; it never falls through to the ambient transport when the owner is unavailable. Only legacy, unqualified targets may use the ambient compatibility transport. The hook observes `useTransportGeneration(profileId)`, so a replacement of the target profile retires the old watch before binding a new generation.

The transport captured when `fs:subscribe_tree` succeeds remains authoritative for the whole watch lifecycle. Event binding, lazy `fs:list` child loading, listener cleanup, and `fs:unsubscribe_tree` all use that same transport. A transport may expose the typed `onFsEvent` helper or the generic `onEvent("fs:<sub_id>", ...)` seam; neither path changes the owner. Cleanup removes the exact cached `{ sub_id, nodes }` payload after unsubscribe, so a remount cannot bind an already-retired subscription ID and must request a new watch. Abort after a subscription response also unsubscribes that returned ID before rejecting.

The defensive `IdleTransport` implements the filesystem capability surface so setup/offline screens remain callable: event registration and unsubscribe are safe no-ops, while tree subscription and filesystem mutation reject with `Error("Server profile required")`. This is a fail-closed compatibility seam, not a successful empty-tree response or a route to another profile.

`WorkspacePage` contains each desktop IDE, compact IDE, and terminal floating Explorer in its own target-keyed `ErrorBoundary`, with the existing `Suspense` fallback inside the boundary. A FileTree render/effect failure therefore replaces only that Explorer region; the workspace shell, editor, and mounted terminals remain available. See [Frontend Components](../frontend-components.md) for the component-level boundary contract.

The connection registry also compares the disconnecting entry's transport identity with the actual ambient singleton before replacing ambient state. Disconnecting a non-ambient or failed profile leaves the healthy ambient transport and generation unchanged; disconnecting the true ambient owner demotes the compatibility slot to `IdleTransport`. The WebSocket wire messages and backend subscription protocol remain unchanged.

## Editor and Previews

`editor.ts` qualifies file and diff tab keys with profile, project, worktree scope, path, and diff metadata. Monaco receives an in-memory URI containing the qualified tab key, so `src/app.ts` on Server A and the same path on Server B are different models. Persisted tab metadata excludes dirty file bytes.

Editor behavior is intentionally conservative:

- A target-bound read or write captures the owner generation and verifies it before committing state.
- Save uses the observed mtime. A conflict remains visible and offers reload or force overwrite; it is not silently retried against a different target.
- Watch/Git invalidation reloads clean tabs. A dirty tab keeps local edits and becomes `stale`, so remote bytes never overwrite unsaved work.
- A profile endpoint change detaches clean tabs from the old resource. Dirty tabs remain visible for recovery but cannot save through the stale owner.
- Large files (at least 5 MiB) use `LargeFileViewer`, which reads 64 KiB ranges on demand and is read-only. Normal and degraded text tiers use Monaco; binary, image, video, and HTML files use their dedicated preview policy.
- Image and video previews use owner-scoped, short-lived media capabilities; they do not place a bearer token in a media URL or materialize the whole file as a Blob.

Git mutations invalidate only the affected profile/target caches and reconcile only tabs belonging to that target. Project root and worktree tabs remain independent even when their relative paths match.

### Git Blame Annotation Architecture and Client Lifecycle

Git blame annotations provide inline line-by-line attribution within the Monaco editor gutter without mutating repository references, the index, or working-tree files. The client architecture binds native `git2` blame computation (`POST /api/git/{project}/blame`) to the active Monaco editor model lifecycle, enforcing profile-qualified owner gating, buffer size safety thresholds, keystroke edit debouncing, single-flight concurrency, and event-driven invalidation.

See the [phased implementation plan](../../plans/261005-2106-editor-git-blame-annotations/plan.md) and [agreed brainstorm](../../plans/reports/brainstorm-261005-2106-editor-git-blame-annotations.md) for full contract context.

#### Target Identity and Owner Gating

Blame operations strictly adhere to profile-qualified target ownership:

- **Connection Ownership:** `useEditorGitBlame` resolves the connection snapshot via `useConnectionSnapshot(profileId)`. Blame requests only execute when `snapshot.status === "connected"` and the resource binding matches (`!tab.resourceBinding?.serverUrl || snapshot.serverUrl === tab.resourceBinding.serverUrl`). When disconnected, status transitions to `"unavailable"` (`"No active connection"` or `"Connection not connected or binding mismatch"`).
- **Wire Projection:** The client projects the project target reference via `toWireTarget(target)`, omitting the client-side `profileId` and submitting `{ project, worktreePath? }` over the captured owner's transport.
- **Post-Await Identity Guarding:** When an asynchronous blame request resolves, the hook verifies:
  1. `isCurrentConnection(owner)` matches the active profile generation.
  2. Initiating tab key matches the current tab (`tabRef.current?.key === currentTabKey`).
  3. Feature remains enabled (`isEnabledRef.current`).
  4. Monaco text model identity matches (`freshModelId === currentModelId`).
  5. Model version matches (`freshModel.getVersionId() === currentModelVersion`).
  6. Buffer edit epoch matches (`localEpochRef.current === currentLocalEpoch`).
  7. Repository refresh epoch matches (`repositoryRefreshEpochRef.current === currentRefreshEpoch`).
  Stale, mismatched, or out-of-order responses are discarded immediately without applying state.

#### Tab Eligibility and Ephemeral Store State

Blame annotations are scoped strictly to active text editing sessions:

- **Tab Eligibility:** `isBlameEligibleTab` gates enablement. Only clean or dirty text tabs in normal or degraded tiers with `targetAvailable: true`, `conflicted: false`, and a non-empty `path` are eligible. Excluded tiers: `diff`, `binary`, `image`, `video`, and `large` (≥5 MiB).
- **Session-Only Ephemeral State:** `Tab.blameEnabled` is an ephemeral per-tab flag toggled via `setBlameEnabled(tabKey, enabled)`.
- **Persistence Exclusion:** `Tab.blameEnabled` is explicitly excluded from `partialize` in `useEditorStore` so it is never persisted to `localStorage`.
- **Rehydration Normalization:** On store rehydration, `onRehydrateStorage` normalizes `tab.blameEnabled = false` across all tabs to prevent stale gutter activation across page reloads.

#### Buffer Lifecycle and Safety Boundaries

The client enforces strict boundaries on buffer content before dispatching to the transport:

- **Size Threshold (5 MiB):** `GIT_BLAME_MAX_BUFFER_BYTES = 5 * 1024 * 1024`. `isBufferOverLimit(content)` validates UTF-8 byte length (`new TextEncoder().encode(content).length`). Buffers exceeding 5 MiB short-circuit client requests immediately, setting status to `"unavailable"`, error code to `"GIT_BLAME_TOO_LARGE"`, and clearing attribution data.
- **Line Count Normalization:** `computeMonacoLineCount(content)` calculates expected lines: an empty buffer evaluates to 1 line, and each `\n` character increments the display line count, aligning client expectations with Monaco line metrics.
- **Snapshot Correlation:** Each blame request generates a correlated `snapshotId` (`${localEpoch}-${generateUUID().substring(0, 8)}`) paired with the monotonic `modelVersion` (`model.getVersionId()`).
- **Baseline Safety and EOL Boundaries:** Direct HEAD paths and staged rename origins share unified regular-file mode, object-header size/type, and binary baseline checks. Tree symlinks are rejected (even when missing on disk), oversized baseline payloads reject before blob materialization, and HEAD is rechecked before publication. Buffer normalization converts LF, CRLF, and lone-CR content to LF while preserving display row counts. For CRLF-committed baselines, a zero-context diff against the CRLF-normalized HEAD blob maps unchanged spans back to native historical blame hunks. EOL-only CRLF/LF differences retain attribution; genuine content and whitespace edits remain Uncommitted. Brand-new staged files absent from HEAD remain Uncommitted.
- **Response Validation:** `validateBlameResponse` enforces strict structural invariants on incoming data:
  - Echoed `snapshotId` and `modelVersion` match request parameters.
  - `bufferLineCount` matches client-computed Monaco line count.
  - `ranges` form a contiguous, non-overlapping, 1-based partition covering `[1..bufferLineCount]`.
  - Every range with a non-null `commitIndex` references a valid entry in `commits`. Uncommitted lines have `commitIndex: null`.
- **Lookup and Formatting:**
  - `findBlameRangeForLine(ranges, lineNumber)` performs an $O(\log N)$ binary search over the ordered range partition.
  - `findCommitForRange(commits, range)` resolves the commit metadata or returns `null` for uncommitted lines.
  - `formatBlameDate(timestampSeconds)` formats author dates into `YYYY-MM-DD`.
  - `formatBlameFullTimestamp(timestampSeconds, tzOffsetMinutes)` formats complete timestamps with the author's original timezone offset (e.g. `2026-10-05 14:32:00 +0700`).

#### Edit Debounce and Single-Flight Concurrency

Buffer edits synchronize attribution without overloading the server or libgit2 worker threads:

- **Synchronous Invalidation:** On `model.onDidChangeContent`, visible attribution is wiped synchronously (`setData(null)`, `setStatus("waiting")`), and `localEpochRef` increments. This guarantees edited lines never display obsolete blame annotations while awaiting computation.
- **Single-Flight Concurrency:** If a blame request is currently in flight (`inFlightRef.current`):
  1. The active `AbortController` aborts the in-flight request.
  2. `pendingIntentRef` is marked `true`.
- **Keystroke Debounce (250 ms):** Keystrokes reset a 250 ms debounce timer (`GIT_BLAME_DEBOUNCE_MS = 250`). When the timer fires (or when an in-flight request completes with a pending intent), a new request dispatches with the latest buffer snapshot.
- **Model Switch:** `editor.onDidChangeModel` aborts in-flight requests, clears debounce timers, increments the local epoch, clears attribution, rebinds content change listeners, and dispatches blame for the newly bound model.

#### Invalidation Event Flow and External Refresh

External repository modifications trigger event-driven refresh coordination without background polling:

- **Repository Refresh Coordinator:** `triggerRepositoryRefresh({ force, reblameOnSameHead })` debounces root discovery by 50 ms. Post-await checks require mounted, enabled, connected, current owner/tab and refresh epoch before publishing. The epoch advances when dispatching replacement attribution, not for an unchanged-HEAD focus check.
- **HEAD Revision Tracking:** If `owningRoot.status?.lastCommit?.hash` or `rootId` has changed (or on forced refresh), existing blame data is invalidated (`setStatus("waiting")`), and the runner re-fetches attribution against the new revision. A successful unborn-HEAD response records a known empty revision, distinct from an unobserved revision, so discovering the first commit triggers re-blame.
- **Subscribed Invalidation Sources:**
  1. **Window Focus:** `window.addEventListener("focus")` forces a repository check on window activation.
  2. **Visibility Change:** `document.addEventListener("visibilitychange")` forces a check when `visibilityState === "visible"`.
  3. **Profile IPC Events:** `subscribeIpc(profileId, "status:changed")` (filtered by owner generation and matching project) and `"workspace:changed"` trigger repository checks.
  4. **QueryCache Invalidation:** Scoped keys require exact profile, generation, project and canonical worktree identity; known root-specific keys must match the owning root (or wildcard). Index-sensitive `git-diff` invalidation recomputes attribution even when HEAD is unchanged. Focus/visibility checks coalesce with valid in-flight work.
  5. **Explicit Manual Refresh:** The `refresh()` callback exposed by `useEditorGitBlame` forces an immediate check and re-blame.

#### Wire Transport, Query Integration, and Error Taxonomy

- **Wire Commands:**
  - `git:blame`: Maps to `POST /api/git/{project}/blame` with `{ path, content, snapshotId, modelVersion, worktreePath? }`.
  - `git:commitDetails`: Maps to `GET /api/git/{project}/commit/{hash}/details?worktreePath=...&root=...`.
- **Commit Details Query:** `useGitCommitDetails(target, hash, root)` caches commit inspection payloads via `gitCommitDetailsQueryKey` and `gitCommitDetailsQueryOptions` with `staleTime: Infinity` (historical Git commits are immutable).
- **Error Taxonomy:**
  - `GIT_BLAME_BUSY` (HTTP 503): Server worker queue or concurrency limit reached; sets `status: "unavailable"`, `isBusy: true`.
  - `GIT_BLAME_TOO_LARGE` (HTTP 413 or client pre-check): Buffer exceeds 5 MiB; sets `status: "unavailable"`, `isBusy: false`.
  - `GIT_BLAME_STALE_REVISION` (HTTP 409): Base commit shifted; sets `status: "waiting"`, awaiting revision refresh.
  - `GIT_BLAME_INVALID_RESPONSE` or Transport Error: Malformed response or network failure; sets `status: "error"`.

#### Git Blame Caching Architecture

Dual-layer caching optimizes "Annotate with Git blame" by eliminating repeated historical graph traversal on the server and avoiding redundant API calls across editor tab switches on the client:

- **Server Baseline Cache:** Process-wide bounded LRU cache (`BlameBaselineCache`, 128 entries / 64 MiB cap) shared across `AppState` clones. Keys combine canonical owning repository root path, project-relative `rootId`, `headOid`, and committed baseline path. Caches owned normalized baseline bytes, line counts, and historical attribution spans `(start_line, line_count, final_commit_oid)`, completely avoiding borrowed `git2::Blame` native handles in shared memory. Shallow repositories (`repo.is_shallow()`) bypass baseline caching to prevent stale attribution if history deepens.
- **Zero-Context Projection:** In-memory dirty buffers project against the cached historical baseline using zero-context diff, avoiding repeated `repo.blame_file` graph traversals. Admission retains the global 2-permit semaphore and verifies HEAD stability before and after computation.
- **Client Query Cache:** TanStack Query-backed completed attribution cache in `@dam-hopper/ui` (bounded LRU: 64 entries, 32 MiB total weight ceiling, 5-minute TanStack Query GC, SHA-256 buffer fingerprint via `@noble/hashes` with Monaco `WeakMap` memoization). Synchronously restores `status: "ready"` on tab remount/reopen when owner, target, root, HEAD, and buffer fingerprint match, eliminating the "Loading blame…" spinner frame and avoiding HTTP requests.
- **Shared Invalidation & Epoch Separation:**
  - *Local edit epoch*: Buffer keystrokes advance local edit epoch and clear annotations (250 ms debounce), preserving cache entries for instant undo-to-cache reuse.
  - *Shared target epoch*: Advanced by Git mutations (commit, checkout, stash, pull) and SSE events, invalidating cached entries across all unmounted editors.
  - *Refresh escape hatch*: Context-menu "Refresh Annotations" forces cache bypass (`bypassCache: true`) and advances target epoch.
  - *Owner retirement*: Profile disconnection cleans up client cache entries, request leases, and listeners.
#### Gutter UI and Geometry Contract

- **Gutter Presentation:** Line-number gutter context menu toggles dedicated annotations and exposes Refresh Annotations while enabled; existing markers and left-click diff remain separate. Whole editor-wrapper width ≥640px uses 220px author/date; narrower panes use author-only `min(120px, wrapperWidth / 3)`, with full date/timezone/hash/subject on hover/focus. Wide viewport does not prevent a narrow source Split from compacting.
- **Monaco Geometry:** Typed `EditorOption.lineHeight` is the sole authority for line height metrics, paired with public model-line top positions to determine row height and offsets. Following clean cutover, all 56 lines of legacy constructor probing, mock `getOption(0)`, and magic fallback shims were removed; unmounted or unavailable editors yield no fabricated rows. Configuration, layout, scroll, and model events refresh geometry; pending animation frames are cancelled across editor and data transitions. Line/page wheel deltas use the current editor line height/viewport.
- **Show Commit in Git:** Committed rows support mouse click and Enter, plus the context-menu action. A shared guard requires enabled ready attribution, the current model version and owning root before revealing the exact OID. Uncommitted or stale rows cannot reveal. The source target/root's read-only Workspace Git inspection preserves unsaved content and mutation gates; an already-open panel never toggles closed.

#### Workspace Git Commit Reveal and Details Inspection Contract

The "Show Commit in Git" action transitions from the Monaco gutter annotation to the Workspace Git surface without compromising unsaved editor buffers, active history filters, or repository safety invariants:

- **Reveal Request Contract (`GitCommitRevealRequest`):** Carries typed `{ nonce, owner: { profileId, generation }, target: ProjectTargetRef, rootId, hash }`. The request captures the initiating editor model's owner/target/root rather than ambient active state.
- **Surface Ensure-Open Across Layouts:**
  - `WorkspacePage.handleRevealGitCommit` validates the request using `isGitCommitRevealRequestMatchingTarget(request, currentOwner, currentTarget)`. Mismatched profiles, generations, or target projects/worktrees reject the reveal request to prevent routing to unqualified or disconnected targets.
  - **Desktop IDE:** Invokes `setActiveTool("git")` without `exclusiveTarget`, ensuring an already-open Git panel is never toggled closed.
  - **Terminal Workspace:** Issues a `TerminalWorkspacePanelRequest` with `{ targetId: "git", intent: "reveal", nonce }`. `resolveTerminalWorkspacePanelActivation` distinguishes `intent: "reveal"` (unconditionally foregrounds and activates the target panel without closing) from `intent: "toggle"` (which closes when already active). Existing shortcut calls retain `intent: "toggle"`.
  - **Compact IDE:** Activates `setRequestedCompactSurface("git")` directly, keeping editor tab mounts and unsaved buffer content intact for return navigation.
  - All memoized Git surfaces depend on the current reveal request and consumption callback. Context-menu navigation prevents source focus restoration from raising the Terminal Files panel over the revealed Git panel.
- **Root-Readiness and Nonce Consumption:**
  - `WorkspaceGitPanel` matches the request against the complete target identity and current connection owner profile/generation before switching roots or consuming it. If the requested root differs from `historyView.rootId`, it sets the root first (`historyView.setRootId(revealRequest.rootId)`) and resets scope, deferring nonce consumption until roots load and the matching root becomes active.
  - Once the matching root is active and confirmed in `historyView.rootOptions`, the panel consumes the nonce (`lastConsumedNonceRef`), invokes `onRevealRequestConsumed(nonce)` to clear the request in `WorkspacePage`, clears the normal history selection (`historyView.clearSelectedCommit()`), and mounts local `inspectionState`.
  - Replay protection: stale nonces from previous requests cannot override newer requests or active inspection.
- **Inspection Selection vs History Selection Isolation:**
  - `WorkspaceGitPanel` maintains `inspectionState = { owner, targetKey, rootId, hash, nonce }` locally, completely decoupled from `useGitHistoryView`'s normal history log selection.
  - Visible matching rows are highlighted and scrolled into view in graph and filtered-list presentations. A new reveal nonce focuses the destination row without stealing focus again on ordinary history refreshes or selections.
  - Inspected commits absent from the currently loaded 200 log entries (e.g. older commits, branch filter exclusion, or detached commits) are loaded by exact OID via `useGitCommitDetails` without walking or fetching entire repository history.
  - When the inspected hash is outside the active log view, `outsideViewNotice` is displayed: `"Commit opened from annotation; outside current history view"`.
  - Filter and pagination changes in history view retain active inspection; switching target, root, or disconnecting owner generation clears inspection.
  - Selecting any real log entry in the history tree exits inspect mode (`setInspectionState(null)`) and transitions back to normal history selection with canonical action capabilities.
- **Discriminated `CommitDetailsPanel` Contract:**
  - Props enforce a strict compile-time and runtime discriminated union: `CommitDetailsPanelProps = CommitDetailsPanelHistoryProps | CommitDetailsPanelInspectProps`.
  - **History Mode (`mode: "history"`):** Requires canonical `commit: GitLogEntry` and exposes mutation callbacks (`onCherryPickSelectedChanges`, `onRevertSelectedChanges`, `onDropSelectedChanges`). Eligibility is governed by real repository state; no synthetic flags.
  - **Inspect Mode (`mode: "inspect"`):** Requires exact `commitHash: string` and optional `outsideViewNotice?: boolean`. Mutation callbacks are completely omitted from the interface, enforcing read-only behavior at compile time and runtime.
  - **Data Fetching:** Commit details are queried via `useGitCommitDetails(target, hash, root, enabled)` with `staleTime: Infinity` (immutable commits). File entries are queried via `useGitCommitFiles(target, hash, root)`. Raw commit payloads are bounded at 5 MiB before decoding; this does not bound referenced trees, file-list output or engine history/rename computation.
  - **Rendering:** Displays full commit subject/body as escaped React text, copyable full SHA-1/SHA-256 OID, author name/email/date/timezone and committer name/email/date/timezone. Double-clicking a file opens its historical diff. SHA-256 details/files/diffs and supporting status/log reads use read-only Git CLI paths (requiring `git` on PATH, provided in the runtime Dockerfile; no configuration migration); native blame and mutation support are not expanded.

## Federated Search

Search has two explicit scopes in `SearchPanel`:

- **Project target** searches the selected project/worktree through its owning connection.
- **All connected profiles** queries eligible connected profiles independently, then aggregates content or filename matches. Up to four profile searches run concurrently; each profile retains a connected/connecting/offline/login-required/unsupported/error status instead of hiding a partial failure.

Every result carries its originating profile and project (and target reference when available). Result keys and grouping include `profileId`, so equal `project/path/line/column` matches from two servers do not collide. Aggregation is deterministic by profile display order, project, path, and position.

The UI enforces a 500-match aggregate cap. A server-side truncation signal or client cap sets `truncated`, and the panel displays a warning that results may be incomplete. Filename and content searches share this ownership and cap behavior. Search requests are debounced and are not enabled for queries shorter than two characters.

## Search Replace

`Replace Next` and `Replace All` resolve the target from the selected match, including the match's originating profile. Project-scope replacement preserves the selected worktree when the match belongs to that target; workspace-scope replacement uses the match's profile/project target.

Before writing, replacement re-reads the target, checks the expected mtime and exact match position, and refreshes stale results rather than applying an ambiguous edit. Dirty-tab isolation is target-qualified:

- A dirty tab for the same profile/project/worktree/path blocks replacement for that file and preserves local content.
- A dirty tab for another profile or target never blocks or receives the edit.
- `Replace All` snapshots matches, processes files independently, skips dirty files, reports replaced/skipped/failed counts, and reloads only clean open tabs.

## Git and SSH Retry

Fetch and pull accept lists of root/worktree targets and return per-target results. Normal Push remains fast-forward-only; there is no `force` flag or unconditional force-push route.

Commit-message editing is local and does not depend on cached `isPushed`. The UI captures the selected message, branch, and HEAD tip together, then submits that branch/tip snapshot for a compare-and-swap check. A successful edit rewrites the local history only; it never publishes automatically. Existing drop, undo, reset, and revert protections remain independent. Removing affected signatures requires explicit consent.

Publishing rewritten history is a separate, user-confirmed action shared by the Workspace Git panel, Git page, and Project Info Git section. A fresh preview resolves the configured upstream and displays the destination and expected remote/local OIDs. Missing or ambiguous destinations are blocked. Confirmation publishes the captured branch to that one destination only if the expected remote OID still matches. Stale state requires a new preview; an unknown outcome is not retried blindly.

### Inactive Local Branch Rewrites and UI Surface Parity

Both the compact `WorkspaceGitPanel` and standalone `GitPage` history views support commit-message editing and parent-contiguous squash operations on inactive local branches as well as the active branch:
- **Local branch eligibility**: History actions check `historyView.isViewingLocalBranch` (any discovered `refs/heads/*` branch). When viewing an inactive local branch, commit-message editing and squash checkboxes are fully enabled. Destructive working-tree actions (`reset`, `drop`, `undoLastCommit`) remain strictly guarded by `historyView.isViewingActiveBranch`.
- **Branch banner synchronization**: When viewing an inactive branch, the banner displays: `Viewing {branchLabel}. Cherry-pick and revert apply to checked-out branch {activeBranch}.` Warnings restricting rewrite actions to the active branch are removed.
- **Context menu accessibility**: In `GitLogTree`, disabled "Edit Commit Message" menu items (e.g. when viewing remote branches or detached `HEAD`) provide a unique `useId()` description ID via `aria-describedby`, paired with mouse `title` tooltip fallback and non-interactive `<p>` description text (`"Edit Commit Message is only available for local branches"`). Keyboard navigation through the Radix menu remains fully accessible.
- **Receipt-bound leased publication**: Squashing an inactive local branch produces a receipt containing `receipt.branch`, which drives `useLeasedGitPush` to prepare and publish with exact-OID protection against that branch without ambient `HEAD` fallback. Both surfaces enforce explicit user confirmation before leased publication.

### Server-Side History Search

`GET /api/git/{project}/log` accepts optional `messageQuery`. It matches ASCII-case-insensitive literal text against the full commit subject/body before pagination, while the response format and subject-only `message` field stay unchanged. Whitespace-only input disables filtering. Embedded CR/LF and NUL are rejected; leading/trailing CR/LF is trimmed first.

The server and client contracts are documented in the [Git history search architecture guide](./git-history-search.md).

### Persisted Git History Selection

`useGitHistoryStore` keeps Git-page checkbox state separate from Workspace focus: `null` is uninitialized, `[]` is explicit all, and nonempty qualified project keys remain selected even while unavailable. Recovery state prevents corrupt/unknown-version preferences from silently becoming bulk-all.

Root choice is scoped by profile/project/worktree. Branch preference is scoped by that target and VCS root: absent means follow the currently checked-out branch, while every explicit choice pins a canonical `refs/heads/...` or `refs/remotes/...` identity independent of checkout. Local and remote branches with the same display name remain distinct; a missing pin does not fall back. The store does not checkout branches or persist commit tips.

See [Git history search and selection persistence](./git-history-search.md) for validation, hydration, denied-storage, and profile-deletion details.

Git operations stay bound to the selected profile, project/worktree, and VCS root. Changing the target or root clears a pending lease preview; unavailable targets do not fall through to another profile or the project root. For fetch, pull, and normal Push, the shared SSH passphrase flow retains successful target results and retries only targets that failed authentication after owner validation. Leased publication retries only a known pre-write authentication failure and reuses the approved snapshot.

### Git Conflict Resolver Workspace Cutover and Staging Bypass Closures

Phase 08 integrates the floating conflict resolver across the workspace and closes all bypass paths:
- **Cross-Shell Floating Host Mount:** Mounted conditionally in `WorkspacePage` above `IdeShell`, `TerminalWorkspaceShell`, and `MobileWorkspaceShell` when `conflictResolver.isPanelVisible` is true. Retains in-progress draft text and region decisions for the matching `DraftKey` in `ConflictDraftRegistry` outside component lifecycle (while Monaco-specific view states like scroll position and local undo command stacks reset on remount).
- **Reveal Intent Routing (`ConflictRevealIntent`):** Changed Files conflict row click emits typed `{ nonce, filePath, root }` via `buildConflictRevealIntent`, invoking `handleOpenConflictResolver(selection)` instead of calling `onSelectFile`. `openChangedFileDiff` returns immediately when `selection.status === "conflicted"`, preventing editor tab opening or diff invocation. In aggregate and multi-root views, the entry's actual worktree root (`selection.gitRootId !== "." ? selection.gitRootId : undefined`) is derived rather than assuming the project root.
- **Active Operation Entry Banner & Conflict Pill:** `ChangedFilesList` renders a prominent `GitMerge` status banner when `useGitOperationStatus` detects an active operation (`merge`, `rebase`, `cherry-pick`, `revert`), displaying stopped reasons (`conflicts`, `messageEditRequired`) and providing an "Open Resolver" button. A floating conflict pill also mounts when conflicts exist or an active operation is stopped while the panel is hidden.
- **Stage Bypass Closures (CUT1):** Conflicted row checkboxes in `ChangedFilesList` are disabled (`disabled={isConflicted}`, `readOnly`, `cursor-not-allowed`, click handler early returns). `GitContextMenuPopover` replaces "Add to commit", "Remove from commit", and "Discard changes" with "Resolve conflict…" for conflicted rows. Bulk staging (`handleStageAll`) filters out conflicted entries. Backend `stage_files` in `server/src/git/diff.rs` acquires `GitMutationCoordinator` lock and checks `index.has_conflicts()`; any batch containing unmerged conflicted files is rejected with HTTP 400 `INVALID_INPUT` before staging any clean files. Legacy resolve payloads with `{ path, content }` fail closed with HTTP 400 `LEGACY_PAYLOAD_REJECTED`.
- **Retirement of Legacy Conflict Parser & Block Types (CUT2):** `packages/ui/src/lib/conflict-parser.ts` is deleted (`git status: D`). `ConflictBlock`, `parseConflictRegions`, and `hasRemainingConflicts` removed from `MergeConflictEditor.tsx` and all production exports. Zero production occurrences in `packages/ui` or `server`. Android Chrome read-only input policy coverage preserved through behavioral rewrite against `ConflictRegionNav`.
- **Configured-Editor Terminal Handoff & Post-Terminal Requery:** When `resolver.terminalHandoff` is set (stopped reason `messageEditRequired`), the resolver toolbar and editor card display a prominent guidance banner detailing the exact `worktreeRoot` and Git configured editor requirement. A "Refresh after terminal return" button invokes `resolver.refreshAfterTerminalReturn(terminalHandoff)` or `resolver.refetchAll()`, triggering authoritative requery.
- **Nonce Consumption & Intent Snap-Back Prevention:** `ConflictResolverPanel` tracks `lastConsumedNonceRef` during component mount to apply `revealIntent` file paths once without snapping back during background refetches. Unmounting the panel resets the local ref, re-evaluating fresh reveal intents on remount.

## Source Map and Verification

| Contract | Primary Implementation |
| --- | --- |
| Target identity and wire projection | `packages/ui/src/api/ownership.ts`, `api/client.ts` |
| Connection owner/generation | `packages/ui/src/api/connections.ts` |
| Target selection and unavailable state | `packages/ui/src/stores/project-target.ts` |
| Scoped editor state | `packages/ui/src/stores/editor.ts` |
| Scoped explorer state and watcher | `packages/ui/src/stores/explorer-tree.ts`, `hooks/use-fs-subscription.ts` |
| CRUD/upload | `hooks/use-fs-ops.ts`, `hooks/use-fs-upload.ts`, `api/ws-transport.ts` |
| Search and replace | `hooks/use-file-search.ts`, `hooks/use-search-panel-replace.ts`, `lib/search-replace-next.ts` |
| Git history search and selection persistence | `server/src/api/git.rs`, `server/src/git/repository.rs`, `packages/ui/src/api/client.ts`, `api/ws-transport.ts`, `api/queries.ts`, `packages/ui/src/stores/git-history.ts`, `packages/ui/src/lib/git-branch-ref.ts` |
| Shared history view | `packages/ui/src/hooks/use-git-history-view.ts`, `packages/ui/src/components/molecules/GitHistoryToolbar.tsx`, `packages/ui/src/components/organisms/GitBranchControl.tsx`, `packages/ui/src/components/organisms/GitLogTree.tsx` |
| Git-page history integration | `packages/ui/src/components/pages/GitPage.tsx`, `packages/ui/src/components/organisms/ProjectInfoHelpers.ts` |
| Git edit and leased publication | `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx`, `packages/ui/src/components/pages/GitPage.tsx`, `packages/ui/src/components/organisms/GitLogTree.tsx`, `hooks/use-git-with-ssh-retry.ts`, `hooks/use-leased-git-push.ts`, `hooks/use-git-squash.ts`, `api/queries.ts`, `server/src/git/commit_message_rewrite.rs`, `server/src/git/leased_push.rs`, `server/src/api/git.rs` |
| Git blame client, cache, and buffer lifecycle | `packages/ui/src/hooks/use-editor-git-blame.ts`, `packages/ui/src/lib/editor-git-blame.ts`, `packages/ui/src/lib/editor-git-blame-cache.ts`, `packages/ui/src/stores/editor.ts` |
| Git blame backend cache and projection | `server/src/git/blame-cache.rs`, `server/src/git/blame.rs`, `server/src/api/git_blame.rs` |
| Git blame Monaco gutter and context menu | `packages/ui/src/components/organisms/EditorGitBlameGutter.tsx`, `EditorGitBlameContextMenu.tsx`, `packages/ui/src/components/molecules/EditorGitBlameRow.tsx` |
| Git blame host integration and edge states | `packages/ui/src/components/organisms/EditorTabs.tsx`, `MonacoHost.tsx`, `MarkdownHost.tsx`, `HtmlHost.tsx` |
| Git blame API client and transport | `packages/ui/src/api/client.ts`, `packages/ui/src/api/ws-transport.ts`, `packages/ui/src/api/queries.ts` |
| Git commit reveal and panel intent | `packages/ui/src/lib/git-commit-reveal.ts`, `packages/ui/src/lib/terminal-workspace-panel.ts`, `packages/ui/src/components/pages/WorkspacePage.tsx`, `packages/ui/src/components/templates/TerminalWorkspaceShell.tsx` |
| Git commit inspection and details panel | `packages/ui/src/components/organisms/CommitDetailsPanel.tsx`, `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx`, `packages/ui/src/api/queries.ts` |
| Git blame qualification and verification | `packages/ui/e2e/editor-git-blame/editor-git-blame.spec.ts`, `packages/ui/e2e/editor-git-blame/git-fixture.ts`, `plans/261005-2106-editor-git-blame-annotations/verification.md`, `plans/reports/verification-261006-1205-pr48-hardening.md` |
| Git conflict discovery, snapshot reads, and safe staging | `server/src/git/conflict.rs`, `server/src/git/conflict_resolve.rs`, `server/src/git/mutation_coordination.rs`, `server/src/api/git.rs`, `packages/ui/src/api/queries.ts`, `packages/ui/src/api/client.ts` |
| Git conflict merge model, history, and draft store | `packages/ui/src/lib/conflict-merge-model.ts`, `packages/ui/src/lib/conflict-draft-store.ts`, `packages/ui/src/lib/joint-history-authority.ts`, `packages/ui/src/lib/conflict-tokenization.ts` |
| Git conflict floating Monaco surface and stacking | `packages/ui/src/components/organisms/ConflictResolverPanel.tsx`, `ConflictResolverToolbar.tsx`, `ConflictRegionNav.tsx`, `MergeConflictEditor.tsx`, `packages/ui/src/hooks/use-floating-panel-geometry.ts`, `packages/ui/src/lib/terminal-workspace-panel.ts`, `packages/ui/src/lib/conflict-resolver-panel-state.ts`, `packages/ui/src/lib/conflict-editor-decorations.ts` |
| Git conflict browser component tests | `packages/ui/browser-tests/git-conflict-resolver.browser.tsx`, `packages/ui/browser-tests/conflict-monaco-history.browser.tsx` |
| Git conflict workspace integration and reveal routing | `packages/ui/src/components/organisms/ChangedFilesList.tsx`, `packages/ui/src/components/pages/WorkspacePage.tsx`, `packages/ui/src/hooks/use-conflict-resolver.ts`, `packages/ui/src/components/organisms/ConflictResolverPanel.tsx` |

Related contracts: [API Reference](../api-reference.md), [Git API](../api/git.md), [System Architecture](../system-architecture.md), [Code Standards](../code-standards.md), and [Multi-Server Profiles User Guide](../user-guide-multi-server-profiles.md).
