# Explorer editor Git blame annotations

## Decision and artifact

- Status: brainstorm agreed; application implementation not authorized.
- Final feature: IntelliJ-style, toggleable Git blame column beside the Explorer editor's line-number gutter; explicit navigation into the Workspace Git panel's commit details.
- Backend recommendation accepted: existing native `git2` dependency, not a second CLI blame engine.
- This report records the planning gate. It is not an implementation plan.

## User-confirmed requirements

1. Entry point: right-click the editor **line-number gutter**, not an Explorer-tree action or code-area-only action.
2. Show author and date per line/group; expose exact author timestamp with timezone, commit hash, and subject on hover.
3. Annotate **current editor contents**, including unsaved changes. Unchanged lines retain committed attribution; new/changed lines show `Uncommitted` without a commit link.
4. Annotation context menu offers `Show Commit in Git`; open **Workspace Git panel**, not the dedicated Git page. Preserve the editor tab and unsaved content.
5. Keep Git added/modified/deleted markers beside line numbers, separate from the annotation column.
6. Preserve existing marker click-to-open-file-diff action. **No inline hunk popup.**
7. Toggle state per editor tab for this session. No settings screen or persistence migration.
8. Scope includes normal/degraded Monaco text editors and Markdown/HTML source panes.

Blame means last recorded change to a line, not necessarily original authorship or verified human identity.

## Proposed interaction

```text
Author       Date         Changes  Line   Code
Alice        2026-10-01               41  function save() {
Uncommitted                   |      42    validate(input);
Bob          2026-09-28               43    persist(input);
```

- Line-number context menu: `Annotate with Git Blame` / `Hide Annotations`.
- Annotation hover: author, exact authored date/time and timezone, hash, subject. Use an explicit date rather than ambiguous relative time alone.
- Annotation context menu: `Show Commit in Git`; unavailable for uncommitted lines.
- Keep line-number selection, fold controls, change-marker clicks, editor cursor/scroll, and keyboard accessibility intact.
- Right-clicking a marker must not trigger the existing left-click diff action.
- Keep annotation column width bounded; truncate long authors with full hover text.
- Immediately invalidate obsolete annotation data on buffer changes; show refreshing state until the matching snapshot arrives. Never leave clickable attribution attached to outdated line numbers.
- Empty/new/untracked/no-history files: explicit uncommitted/no-history state as appropriate, never synthetic commit identities. Non-repositories/unavailable roots: explicit unavailable state.

## Evaluated approaches

| Approach | Pros | Cons | Decision |
|---|---|---|---|
| Dedicated blame column + native git2 | Requested UX; existing dependency; in-memory buffer attribution; typed hunks; pin exact commit | Column alignment work; library behavior and bounded CPU work require validation | Selected |
| Same column + Git CLI porcelain | Familiar Git semantics; disposable current-buffer probe passed | Subprocess lifecycle, output parsing, version compatibility; another execution path | Not selected; no automatic fallback |
| Selected-line tooltip only | Small UI surface; no extra column width | Not full-file IntelliJ-style annotation; user must inspect lines individually | Rejected for this request |

Avoid a Monaco fork, private DOM manipulation, misuse of line-number text for author metadata, or a GitLens/plugin subsystem.

## Repository evidence and touchpoints

### UI

- `packages/ui/src/components/organisms/MonacoHost.tsx:30-45`: editor props already carry `lineChanges` and `onGitIndicatorClick`.
- `MonacoHost.tsx:124-137`: gutter mouse-down handling invokes existing diff navigation; must distinguish right-click from left-click.
- `MonacoHost.tsx:236-264`: Git decorations already use glyph margin classes and overview ruler colors.
- `MonacoHost.tsx:303-315`: line numbers, glyph margin, folding and editor sizing configuration. Word wrapping currently off.
- `packages/ui/src/lib/git-line-decorations.ts`: existing added/modified/deleted colors and hunk lookup; preserve conventions.
- `packages/ui/src/components/organisms/EditorTabs.tsx:213-239`: current Git-state/root lookup derives from changed-file entries. Blame must also work on clean files; do not gate eligibility on `activeGitState`.
- `packages/ui/src/components/organisms/MarkdownHost.tsx`, `HtmlHost.tsx`: source editors wrap `MonacoHost`; carry annotation context through these paths.
- `packages/ui/src/stores/editor.ts`: existing tab ownership/lifecycle; integration must respect profile/project/worktree tab identity.
- `packages/ui/src/api/client.ts`, `queries.ts`, transport implementations: new typed read operation and bound profile/generation-scoped fetching.
- `packages/ui/src/components/pages/WorkspacePage.tsx:1001-1026`: existing panel activation requests. Commit navigation needs **open/reveal**, not a shortcut toggle that could close an already-open Git panel. Respect available workspace layouts.
- `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx`: reuse existing history and commit-details surface.
- `packages/ui/src/hooks/use-git-history-view.ts:109-118,299-312,341-374`: commit selection is hook-local; scope transitions clear it; history pages contain 200 entries. Explicit hash navigation must survive intended root activation and must not depend on a visible log row.
- `packages/ui/src/components/organisms/CommitDetailsPanel.tsx:127-151`: current header renders `commit.message` as truncated text; integrate readable full message/body, not just hover over a subject.

### Server

- `server/Cargo.toml:105-106`: existing `git2 = "0.19"`; no new blame dependency needed.
- `server/src/git/vcs_roots.rs:175-264`: existing request/path-to-root resolution, including deepest matching nested root. Reuse resolution; independently enforce normalized safe file paths and containment.
- `server/src/api/git_diff.rs`: target/root-bound read handlers and `spawn_blocking` pattern.
- `server/src/api/git.rs`: history and commit-message routes. Assess reuse of existing full-message read without dragging mutation/branch-edit eligibility into read-only annotation navigation.
- `server/src/git/repository.rs:1468-1567`: existing history supports revision lookup; `%s` means returned log message is subject-only. Existing `limit=1, ref=OID` may supply navigation metadata without walking/paginating history; validate exact returned OID and reuse if sufficient.
- `server/src/git/types.rs`, Git/API module registration: wire response types and bounded read handler.

### Verification and documentation

- Backend real temporary repositories under existing Git/API test conventions.
- Existing editor/history UI test surfaces; browser component tests for actual Monaco gutter geometry and interactions.
- Full application journey in `packages/ui/e2e/` for Explorer → annotations → Workspace Git commit details, including fresh local screenshots and human review policy.
- Update existing relevant API/editor documentation during implementation; no new documentation hierarchy or release/version bump implied.

## Architecture contract for planning

### Blame computation

1. Resolve authenticated project/worktree target and owning VCS root from project-relative file path, including clean files.
2. Validate file/path eligibility and bounded current-buffer input; apply existing supported text/file-size conventions.
3. Capture a concrete HEAD OID. Use native `Repository::blame_file` with `BlameOptions::newest_commit`, then `Blame::blame_buffer` for the submitted editor snapshot.
4. Convert zero-OID hunks to explicit uncommitted records. Return compact line ranges plus deduplicated commit metadata, resolved root/path, base OID, and snapshot identity.
5. Resolve missing-at-HEAD files honestly. Validate staged renames and committed renames; do not silently assign another path's history. No user-configurable copy/move heuristic feature.
6. No file writes, auto-save, staging, commits, or Git fetch operations.

Proposed API shape: authenticated read-only POST carrying project-relative path, optional worktree target, current buffer and model-version token; response uses camelCase. Exact route and DTO names belong to detailed planning, using existing transport conventions.

### Ownership and freshness

- Request/result identity: profile ID, connection generation, project/worktree, VCS root, file path, editor model identity/version, and base HEAD.
- Recompute while enabled after debounced edits, save/external reload, or relevant repository/HEAD changes.
- Reject old responses on edit, tab switch, target/root switch, reconnect, or repository change.
- Unsaved source belongs only in authenticated request bodies; no URLs, logs, persistent query storage, or cross-profile caches.
- Avoid retaining a full cache entry for every keystroke. Prefer bounded latest-snapshot state; reuse established query ownership where applicable.
- No proactive repository-wide blame or background fetch for disabled tabs.

### Rendering

- Dedicated React-managed annotation column adjacent to Monaco; preserve standard line numbers and existing change decorations.
- Render visible rows only, positioned using public Monaco geometry APIs; subscribe to scroll, layout, hidden-area/folding, model, and font changes.
- Do not compute row top as `lineNumber * lineHeight`: folding breaks that assumption.
- Markdown/HTML split source panes receive the same behavior; rendered previews do not.

### Commit navigation

- Typed reveal request owned by workspace integration: target/profile/generation, root, full commit OID, and request identity.
- Reveal correct Git panel/root; fetch exact commit directly rather than searching currently loaded history.
- Show author, timestamp, full message/body, and files. Preserve existing editor tab/content and relevant Git filters; if the selected commit is outside current history view, make that clear rather than pretending a row is visible.
- Do not fabricate `GitLogEntry` mutation eligibility fields from blame metadata. Reuse canonical commit metadata and existing safety gates.
- Missing/pruned commit objects: explicit error, not navigation to a different commit.

## Scope boundaries and constraints

In scope: annotation toggle, live-buffer attribution, timestamp/author display, commit navigation/full-message integration, safe lifecycle/state ownership, marker coexistence, supported source-editor wrappers, and verification/documentation.

Out of scope: Explorer-tree entry point, dedicated Git-page navigation, inline change popups, historical snapshot annotation, previous-revision traversal, configurable whitespace/copy/move blame policies, remote-host links, new settings/persistence, diff/merge/binary/large-file viewer annotations, rendered preview annotations, or a Git-panel redesign.

- Shared UI must remain compatible with web/native hosts; no new host-specific dependency.
- Read-only feature; preserve repository history, index, worktree and unsaved editor data.
- No team/timeline commitment requested or estimated. Correctness and maintainability take priority over imitating every IntelliJ behavior.
- Performance: zero blame requests while off; debounce active edits; visible-row rendering; explicit file/input limits; bound native worker concurrency.
- Native blame is blocking and not generally interruptible by dropping an async future. A request timeout is not proof that CPU work stopped. Plan admission/concurrency bounds and stale-result disposal accordingly; do not promise hard cancellation without evidence.
- No new database, external service, plugin, or telemetry pipeline.

## Acceptance criteria / success metrics

1. Right-click an ordinary line number on a clean tracked file; enable/disable annotations. Right-click never opens a diff as a side effect.
2. Known fixture commits with different authors/dates produce correct attribution; hover includes exact timestamp/zone and full hash.
3. Insert, edit, delete, undo and redo unsaved lines: retained lines preserve attribution; changed lines show uncommitted; stale responses cannot annotate newer content. Disk remains unchanged.
4. Folding/unfolding, scrolling, font zoom, resizing and tab changes keep annotation rows aligned with actual code; change markers and line numbers remain usable.
5. `Show Commit in Git` reveals the correct Workspace Git panel and full message/body even when the commit is older than the loaded 200-entry page or excluded by a filter. Already-open panel stays open.
6. Same-named projects on two profiles, reconnect generations, worktrees and nested roots never share attribution or navigate to the wrong repository.
7. New/untracked/empty/unborn-HEAD/non-repository/unavailable-target files and shallow-history boundaries produce honest states without fabricated attribution. Test CRLF and trailing-newline boundaries.
8. Existing change-marker left-click still opens the file diff; no inline popup introduced. No overlapping click targets with folding or blame menu.
9. Normal/degraded editors and Markdown/HTML source panes work; unsupported viewers explain unavailable annotation rather than silently misbehaving.
10. No requests while off; no unbounded per-keystroke cache or worker accumulation; no source-buffer logging/persistence.
11. Full app journey and fresh local visual evidence required before declaring implementation complete. Passing component tests alone insufficient.

## Feasibility evidence and limits

Executed disposable temporary-repository smoke with Git 2.55.0:

- Committed three lines; submitted an in-memory four-line snapshot containing an insertion and replacement.
- `git blame --line-porcelain --contents - -- sample.txt` preserved committed attribution at new lines 1 and 3; zero OIDs at lines 2 and 4.
- Asserted file on disk remained byte-equivalent to original text.
- Additional invocation with explicit commit OID and `--contents -` exited successfully on this installed Git version. No compatibility claim for other versions.
- Temporary repository removed automatically. No permanent tests or application source edits made.

This probe proves current-buffer blame semantics for Git CLI, **not** native git2 behavior or frontend implementation. Native feasibility is supported by documented APIs in the project's dependency version; implementation must exercise native code against real repositories. No application browser verification performed because no UI change was implemented.

Primary references:

- [git2 0.19 Blame::blame_buffer](https://docs.rs/git2/0.19.0/git2/struct.Blame.html#method.blame_buffer): differing buffer lines receive zero final commit OID.
- [git2 0.19 BlameOptions::newest_commit](https://docs.rs/git2/0.19.0/git2/struct.BlameOptions.html#method.newest_commit): pin base revision.
- [Git blame documentation](https://git-scm.com/docs/git-blame): last-change semantics, contents input, rename behavior.
- [Monaco IStandaloneCodeEditor API](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IStandaloneCodeEditor.html): context-menu events, visible ranges, line geometry, folding/layout/scroll events. Public docs support design; validate API availability against installed Monaco 0.55.x during planning/implementation.

## Next steps and dependencies

1. User chose **No, finish with brainstorm**. Stop at this agreed report; no detailed plan or application implementation created.
2. If planning is requested later, use `/cmd-plan__hard` through the OMP command mechanism with this report as context. Cross-module editor/backend/navigation lifecycles warrant the hard planning path.
3. Reserved planning destination: `plans/261005-2106-editor-git-blame-annotations/plan.md`, YAML `status: pending`; not created in this session.
4. Future detailed planning resolves DTO names, source-buffer limits from existing file tiers, native rename/line-ending semantics, direct commit metadata/full-message reuse, workspace reveal integration, and scenario coverage.

## Unresolved questions

- Product behavior/scope: none after user confirmation.
- Planning decision resolved: user declined detailed planning for this session.
- Implementation validation items remain explicit above; no claim of completed native/UI behavior.
