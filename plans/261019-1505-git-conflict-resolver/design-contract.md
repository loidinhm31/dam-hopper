# Proposed Git conflict resolver contract

**Status: proposed, not implemented or executable-qualified.** Planning authority: [brainstorm](../reports/brainstorm-261019-1326-git-conflict-resolver.md), now superseded only in its final statement declining a detailed plan: user has requested planning, not implementation.

## Current evidence and corrections

- `server/src/git/diff.rs:830-919`: content-heavy optional-string conflict DTO; invalid UTF-8 lossy decode; paths can default to empty; direct write then index add without version check.
- `server/src/api/git_diff.rs:241-286`: reuse registered project/worktree and VCS-root resolution. Actual route file is **`server/src/api/router.rs:220-224`**, not `server/src/router.rs` (incorrect scout path).
- `server/src/git/cli_fallback.rs:40-54,115-137`: existing runner is unbounded `.output()` with lossy output; recovery enum/detection lacks revert, merge `canContinue` is false. Do not treat these hints as authoritative resolver status.
- `packages/ui/src/components/organisms/MergeConflictEditor.tsx`: existing disconnected marker-based three-editor component; only located external import is its test. Header's claimed WorkspacePage lazy import is stale. It resets result on file/target changes; nonempty result required for resolved state incorrectly excludes empty-file results.
- `packages/ui/src/lib/conflict-parser.ts`: sole located consumer is that component; normalizes EOL to LF and derives resolution from markers. Replace obsolete behavior rather than leave a second path.
- `ChangedFilesList.tsx:203-227,444-480,710-764`: bulk excludes conflicts, row checkbox/context-menu stage do not. Row selections currently open ordinary diff via WorkspacePage.
- `terminal-workspace-panel.ts:7-31`: existing floating identities `files|tool`, base/front z-order. TerminalFloatingToolPanel's 720px default and global unconditional Escape cannot be copied unchanged.
- Installed dependency declarations: Monaco `^0.55.1`, Monaco React `^4.7.0`, resizable panels `^4.9.0`; no diff3 dependency committed. Exact selected package version/license remains Phase 01 gate.
- Semantic references attempted for Rust and TS via `xd://lsp`; no language server available. Targeted source searches provided callsite evidence; repeat semantic checks when an implementation runtime has LSP.

## Scope and non-goals

One shared floating resolver, independent of EditorTabs/DiffViewer and optimistic `ConflictDialog`. Immutable left/right and base, editable center, full core actions, conflict-file navigation, explicit Apply & stage and separate Continue/Finish/Abort. All merge/rebase/cherry-pick/revert, including terminal-started operations. Text, whole-side binary and delete/modify actions; unsupported entries remain visible.

No operation initiation, AI/semantic merging, exact JetBrains intraline algorithm, private VS Code merge code, new service, durable draft store, restoring staged files to original conflict stages, full complex rename/symlink/submodule resolution, automatic skip, hooks/signing bypass, Git config changes or automatic continuation. Stash/patch conflicts may be resolved by index discovery, without promised operation recovery.

Validated release scope and contract decisions:
- **Coordinated UI/server upgrade:** Single new resolver contract across all callers; no legacy resolver write fallback, compatibility shim, or incompatible intermediate deployment.
- **Commit-message editing:** Continue requiring message editing hands off to the exact owning repository/worktree terminal bound to captured profile/generation/server/project/root, where Git invokes its configured editor. No resolver message form/adapter, handler-launched interactive editor or automatic PTY injection. Preserve hooks/signing and dirty drafts/history. Handoff is neither completion nor guaranteed zero-write: refresh authoritative operation/full-index/worktree facts after every attempted command and terminal return. Retain stale recovery until explicit fresh-snapshot import/review; failed refresh leaves unknown/no replay. Safe editor-required detection and bounded execution remain technical gates.
- **Initial platform gate:** Authenticated production web + actual Linux Tauri interactions + fresh local full-viewport captures + explicit human ACCEPTED are required. Missing required/shared safety evidence blocks release. Windows-native client qualification remains separately Pending/nonblocking/unqualified; no Windows resolver qualification claim until separately tested. Applicable supported-server safety is not waived; shared web/native architecture is unchanged. See [qualification matrix](./acceptance-matrix.md#authoritative-qualification-matrix).

## Phase inventory and dependency contract

| Phase | Deliverable | Depends on | Gate |
| --- | --- | --- | --- |
| 01 | Executable feasibility + exact contract qualification | None | Text/metadata history, imported results, bytes/staging and operation process proofs before committing mechanisms |
| 02 | Bounded inventory and coherent on-demand conflict snapshots | 01 | Missing/empty/binary/error/types distinct; no lossy reads |
| 03 | Preconditioned text/side/delete apply + stage | 02 | Exact intended path/index outcome and truthful partial/unknown outcomes |
| 04 | Authoritative operation status + guarded continue/abort | 03 | Four operations, repeated stops and interactive blockers |
| 05 | Owner-bound client contracts and retained draft lifetime | 02–04 | Full owner/root binding and no automatic retry/rebind |
| 06 | Structured merge model, remapping and joint history | 01, 05 | Full actions plus manual edits/undo/redo; no marker authority |
| 07 | Floating host and aligned responsive public Monaco surface | 05–06 | Cross-shell lifetime, focus/stacking, narrow pane choice |
| 08 | Workspace entry, explicit apply/stage and recovery UI cutover | 03–07 | One production path; no generic conflict-stage bypass |
| 09 | Real-app/host/resource qualification + implementation docs | 01–08 | Authenticated web + Linux Tauri host + human ACCEPTED; Windows-native separately Pending/nonblocking; full server process safety |

Default execute numbered order. Backend phases 02–04 and pure model work may overlap only after Phase 01 freezes shared invariants and a single owner assigns API/type files; no independent conflicting edits to client.ts/types.rs/WorkspacePage. Do not mark a contract-only scaffold as a completed feature. All phases start Pending, 0%; no effort/deadline invented. Qualification tasks below are future implementation work, not evidence from this planning task.

## Ownership and lifetime

- Draft key includes captured `{profileId, generation, serverUrl/resourceBinding, project, canonicalWorktreeIdentity, rootId, conflictId, snapshotVersion}`. Server supplies actual root/index identity; client identities are routing, not authentication claims.
- Workspace-level owner/controller above IDE/terminal/mobile shell selection retains drafts, result model, source snapshot, review metadata, history and view state. Do not store in editor tabs or a durable persisted Zustand slice.
- Hide is nondestructive; close control means Hide. A distinct Discard action confirms dirty loss. File/target/shell switching does not dispose another draft. In-progress apply captures the submitted result revision; edits made after submit survive response handling.
- Retired generation, endpoint change, unavailable target/root or external Git change freezes writes while retaining recovery text. Reconnect never silently rebinds; compare fresh snapshot and explicitly import/review into the new captured owner before mutation.
- Bound retained source/model/history memory, including growth while typing/pasting into an existing draft and its undo history. Evict only clean/discarded drafts; at capacity, visibly refuse new loads or prospective over-budget edits using the Phase 01 qualified input guard and reserved transaction headroom. Never truncate accepted edits or silently drop dirty history; Undo/Redo and recovery remain usable. Bounds chosen by Phase 01/09 measurement.
- Browser beforeunload is best effort; native host-close protection must use supported lifecycle if available or document its limitation. No crash/reload persistence guarantee. Profile removal/logout/server change must not accidentally send old draft bytes to a new server.

## Proposed wire cutover

Reuse existing `GET /api/git/{project}/conflicts` and `POST /api/git/{project}/resolve`, replacing payloads atomically with all client/transport/query consumers. Single coordinated UI and server upgrade across all callers; no legacy resolver write fallback, compatibility shim, or incompatible intermediate deployment. New names below are proposed; freeze in Phase 01 before exports change.

| Surface | Proposed response/request |
| --- | --- |
| GET conflicts + `worktreePath?`, `root` | Bounded `{targetRevision, entries, truncated, nextCursor?}` summary; no blob text. Prefer deterministic paging only if needed to avoid dropping unsupported entries |
| GET conflicts/file + same scope, `conflictId` | Coherent `ConflictSnapshot`, immutable source stage descriptors and supported content; actual worktree result/type and precondition token |
| POST resolve | Scope + conflictId + precondition + discriminated `reviewedText`, `indexSide` or `delete` action |
| GET operation + same scope | `none|merge|rebase|cherry-pick|revert|unsupported|unknown`, identity/version, actual stage-role labels, allowed actions/blockers |
| POST operation | Scope + operation precondition + `continue|abort`; abort requires explicit confirmation bound to displayed operation |

Use existing REST-backed `git:*` transport convention; one typed schema through Rust/ApiClient/WsTransport/queries, camelCase JSON; existing operation string casing migrated consistently. The exact DTO names/errors/HTTP codes must be frozen, not improvised independently by phases.

### ConflictSnapshot invariants

- Stage descriptors 1/2/3 each include presence, path identity, OID, mode/type, byte size and `missing|text|binary|unsupported|readError` classification. Missing is not empty string or zero-byte text. OIDs opaque strings with qualified object-format handling, not hardcoded 40 chars.
- Preserve exact underlying path identity via server-issued conflictId; unsupported/non-UTF-8 paths display escaped safe labels and no mutating path guessed from them. Complex rename stage paths remain separate, not flattened into one misleading path.
- Worktree descriptor distinguishes absent/regular/symlink/directory/gitlink/unreadable, actual content version and text eligibility. Preserve original bytes/EOL/BOM/final-newline metadata, not lossy String conversions.
- Attribute/conversion policy includes the relevant `.gitattributes` and effective conversion/config fingerprint. Unknown custom filters/encoding remain unsupported before write; discovery must not execute them.
- Bound stage bytes before materialization/JSON decode; limit total base+sources+result response, lines, maximum line length and region count. Over-limit/unsupported entries remain in summary with terminal handoff.
- Snapshot token covers normalized repository/worktree/index/root, HEAD/operation metadata, stage OIDs/modes/paths, effective conversion policy, and worktree content/type. Content fingerprint not mtime alone. Before/after state validation rejects a changed-during-read result. Tokens are preconditions, not authorization or a promise against ABA/external races.

## Mutation contract

### Commands

- `reviewedText`: complete explicitly reviewed worktree text representation including EOL/BOM/final-newline decisions and applicable mode. Empty text is valid. No server marker heuristic grants resolution; UI review model controls explicit intent, while server validates actual Git/path/types/precondition.
- `indexSide`: select existing stage 2 or 3 descriptor (or separately named base if later explicitly required; base resolution is not implied). Stage 0 must equal selected stage OID/mode, worktree must be checkout-compatible under qualified conversions. Preview is not text re-encoding of a binary blob.
- `delete`: remove the actual intended regular/missing file and conflict index entries; never materialize a missing side as empty text. Reject unsafe symlink/type/path change before mutation.
- Whole-file text-side choice first changes draft with replacement confirmation; it does not stage or continue. Binary side action has explicit confirmation then Apply & stage.

### Safety sequence

1. Authenticate/authorize through existing protected route; decode bounded discriminated body. Resolve registered project/worktree and explicit nonaggregate nested root.
2. Acquire narrowly scoped application mutation coordination for actual worktree/index; continuation/ref-affecting actions may also require common repository coordination, fixed order. Make affected application Git writers participate or reject incompatible active operation; no claim that conflict-only mutex covers all app writers.
3. Reopen/validate actual repo, operation and relevant index entries; securely recheck file ancestor containment/type and effective attributes. Do not follow symlink/reparse ancestors outside root. Validate precondition immediately before action.
4. Perform qualified worktree/index update with native Git locking. Do not acquire index.lock then run a Git command that needs that lock. Preserve unrelated index entries and applicable modes; no `git add .`, hard reset or clean.
5. Read actual resulting stage 0/worktree/operation; return explicit facts and new snapshot/status, not an unconditional `{ok:true}`. Never claim filesystem/index atomicity against arbitrary terminal/editor writes.
6. Late write/stage failure preserves draft and reports phases. No automatic rollback over a newer writer. Network/cancel/timeout without conclusive result is outcome unknown; refetch and review before another command, never auto-replay.

Proposed outcome union: `applied`, `stale` (no mutation), `unsupported` (no mutation), `busy` (no mutation), `failedBeforeWrite`, `worktreeChangedStageFailed`, `outcomeUnknown`. Include stable error reason, observed worktree/index facts and refresh requirement. Deletion and index-side application can have their own partial sequence; report whichever steps really happened.

Generic stage endpoint/function must preflight explicit selected paths for unmerged entries and reject conflicted paths without partially staging an earlier path in a batch. Keep nonconflict staging behavior. UI checkbox/context/bulk paths route conflict resolution to the resolver. Remove old unchecked resolve behavior; terminal `git add` remains outside app enforcement and is discovered as external state.

## Operation lifecycle

- Query actual worktree-specific Git metadata with sequencer details; distinguish rebase-merge/rebase-apply from `git am`, empty/edit/exec stops and unsupported ambiguity. Add revert to existing recovery enum and migrate consumers consistently.
- Roles are stage+OID plus evidence-backed branch/commit description. Rebase stage 2 is onto/current rebased state; stage 3 replayed change. Revert stage 1/3 semantics differ; show truthful stage labels when branch identity unavailable.
- Continue and Abort fixed server-selected commands only. Revalidate operation/version plus relevant full-index fingerprint, including stage-0 entries Continue may commit and all actual unmerged state. A changed unrelated staged file invalidates displayed operation intent; require refreshed review, not a commit of different contents. No conflicts is necessary, not sufficient. No auto continue when final file resolves; rebase can return new conflicts into same panel.
- Piped/closed stdin, safe editor-required detection, bounded concurrent output draining, deadline and process-tree cleanup must be qualified on applicable supported server OSes; deferred Windows-native client evidence grants no server-safety waiver. Hooks/signing run normally; no config changes, policy bypass or unconditional `GIT_EDITOR=true`.
- Required commit-message editing uses Git's configured editor in the verified owning repository/worktree terminal. No resolver message form/adapter, handler-launched interactive editor or automatic PTY injection. Other interactive blockers (pinentry, hooks, empty commit, todo, exec) receive truthful diagnostics/handoff, not skip/bypass. Handoff is neither completion nor zero-write proof: refresh operation/full-index/worktree facts after every attempted command and terminal return, retaining dirty drafts/history as stale recovery until explicit fresh-snapshot import/review. Failed refresh stays unknown/no replay; even successful refresh never automatically retries an uncertain command. Pre-write stale rejection retains its distinct zero-mutation guarantee.
- Abort separate destructive confirmation explains resolution-work loss and retained local dirty drafts. Refetch state afterward, preserve drafts as stale recovery copies until explicit discard. Unsupported/no operation never shows misleading Continue/Abort.
- Use existing owner-scoped workspace/status events, focus/visibility refresh and post-mutation invalidation. No new observation service. Stage/commit/checkout/operation changes invalidate summaries, detail preconditions, operation status, diff/history/status and affected editor views without replacing dirty tabs.

## Structured merge/history semantics

- Immutable stage inputs produce deterministic source blocks; result is authoritative output. `node-diff3` only candidate, must pass license/version/performance/fidelity gate before pinning. Feed lossless line tokens, never whitespace strings. No new generic diff algorithm.
- Distinct source block identity, source/base ranges, current result mapping, per-side decisions, manual review and draft revision. Metadata states include pending, accepted-side, ordered-both, ignored-side, manual-needs-review/reviewed; ambiguous mapping disables destructive per-block action immediately.
- Accept left/right replaces only mapped region. Ordered-both explicit left→right or right→left. Ignore a side preserves current result and records rejection, never silently resets base. Define how remaining side/review requirements clear a block; metadata-only changes participate in undo/redo.
- Whole-file choice/rebuild/nonconflicting application never overwrites imported/manual work without preview and confirmation; one coherent undoable transaction. Base comparison read-only, no implicit result replacement. Navigation uses current unresolved/review state and root/file identity.
- Native editor typing/IME/paste/cut/multicursor edits and app decisions share one qualified history authority; native shortcuts/context menu/toolbar all agree. Model versionId is not enough and synthetic no-op edits are not accepted proof. Cross-block edits remap/recompute or force explicit review; Undo restores result AND state; Redo restores decisions; new edit invalidates redo.
- Existing/imported marker-free partial edits remain review-needed until explicit acknowledgement. Literal marker-like text warnings cannot be the sole resolution truth. Support empty result/deletion distinctly.

## Floating UI and cutover

- Workspace-owned host above shell branching, dedicated draggable/resizable/maximizable panel, no EditorTabs tab and no DiffViewer adaptation. Reuse geometry clamp/stacking vocabulary, extend single floating identity contract (resolver) with existing files/tool behavior migrated as needed.
- Active/topmost focus owns shortcuts; Escape first belongs to Monaco suggest/find/context widget and only hides the topmost resolver if unconsumed. No document-wide close cascade or terminal key leakage. Do not make nonmodal resolver an indiscriminate global focus trap.
- Aligned source/result change/conflict highlights, mapped view zones/scroll guards; layout after resize/font/zoom/maximize/viewport change. Wide three panes, narrow explicit Left/Result/Right/Base selection with reachable actions/list; no unreadable squeezed columns.
- Show exact profile/project/worktree/root/operation, readonly source labels, file list all supported/unsupported types, review count, explicit file Apply & stage and separate Continue/Finish/Abort.
- Rework existing `MergeConflictEditor.tsx` into this renderer, preserving useful public input/accessibility policy patterns; remove marker-only ConflictBlock/parser and stale comments after confirming remaining references. Migrate or delete obsolete implementation/default-pinning tests rather than asserting new internals. Keep `ConflictDialog` unrelated.

## Verification boundary

See [acceptance matrix](./acceptance-matrix.md#authoritative-qualification-matrix). Real temporary Git repositories prove stage OIDs/modes/worktree bytes and workflow transitions; permanent tests target behavior, not source text/wiring/mock echoes. Remove throwaway proofs after extracting relevant regressions. Initial qualification requires authenticated production web, actual Linux Tauri interactions, fresh local full-viewport captures and explicit human ACCEPTED; missing required/shared safety proof blocks release. Windows-native client evidence remains separately Pending/nonblocking/unqualified, not inferred from shared code or browser/Linux proof. Qualify applicable supported-server safety separately. No implementation/build/runtime checks run during this planning task; all feature checks remain Pending, 0%.

## Unresolved technical gates

1. Phase 01: selected engine/version/license, imported-result mapper, public Monaco joint history mechanism and exact byte representation, including mixed endings.
2. Phase 01/03: supported filters/encodings/modes/hash formats, secure path publication and exact-side checkout/staging algorithm.
3. Phase 01/04: operation metadata/process lifecycle, sequencer/interactive/platform matrix and coordination scope, including safe noninteractive execution and editor-required detection.
4. Phase 01/09: measured payload/line/draft/performance budgets, authenticated production web and actual Linux Tauri runtime interactions with human visual `ACCEPTED` verdict, while Windows-native client qualification remains separately Pending/nonblocking/unqualified. No product preference blocker; unsupported cases must remain honest handoff, not silent scope reduction.
