# Project Plans Dashboard — Frozen Implementation Contracts

Status: proposed implementation; validation decisions incorporated 2026-10-06. No code implemented. This file resolves integration details from [brainstorm](../reports/brainstorm-261006-1653-project-plans-dashboard.md), [backend design](./research/backend-contract.md) and [frontend design](./research/frontend-contract.md). Folder-first, single-plan selection supersedes the earlier automatic collection Board/Timeline design.

## 1. Boundaries and architecture

- Extend existing Plan ribbon/Deck/Sheet. Start with folders; open one selected plan's Overview, Timeline and read-only documents. Preserve separate Manual tracking. Shared React, no new route/iframe/terminal root.
- `server/src/plans/` owns pure parser + bounded synchronous folder browsing/selected-plan reading, each called through one `spawn_blocking` from `server/src/api/plans.rs`.
- Resolver/sandbox/auth are existing authorities. File API availability never depends on optional SQLite WorkflowService. No DB import/cache/migration/controller calls.
- File reports are administrative, never implementation approval, verified completion or automatic phase selection.
- App never creates/changes plan.md, progress.md, phases or receipts. External writers remain unchanged. This plan opts into its own progress.md; parent alone updates that administrative overview.

## 2. Protected folder and selected-plan APIs

`GET /api/plans/folders?project=<configured-name>[&worktreePath=<registered-absolute-worktree>][&path=plans/<group>]`

`GET /api/plans?project=<configured-name>[&worktreePath=<registered-absolute-worktree>]&planPath=plans/<selected-folder>`

- Required nonempty project; omitted worktree means configured root. Reject duplicate/unknown query keys, NUL and invalid values. Percent-encode values normally.
- Resolve target from current workspace/config + registered Git membership. Browse path defaults to `plans`; selected read requires `planPath`. Both are normalized target-relative paths confined to the fixed plans subtree, never arbitrary roots. Omitted selection is 400, not a bulk load.
- Folder browsing lists immediate eligible directories only. Probe the current directory's own no-follow `plan.md` marker, not child document contents. Root is collection; a nonroot directory is a plan if its marker is regular, otherwise a group. Invalid/symlink marker is rejected explicitly. A plan-kind response has `folders:[]` without child enumeration; opening a group browses it, opening a plan triggers selected read.
- Existing API authentication/error envelope; no new admin gate or changed auth/MFA behavior.
- Channels: `plans:folders` with `{target,path}` and `plans:read` with `{target,planPath}`. Captured ApiClient strips profileId; WsTransport maps to these REST GETs. No load-all channel, sibling prefetch or persistent status index.

Proposed required camelCase response fields; nullable explicitly:
```ts
type PlanStatus = 'pending' | 'in-progress' | 'completed' | 'cancelled' | 'blocked' | 'unknown' | 'conflict';
type SourceRef = { path: string; lineStart: number; lineEnd: number }; // target-relative, 1-based inclusive
type Diagnostic = { code: string; path: string | null; line: number | null; message: string };
type StatusEvidence = { value: PlanStatus; raw: string; evidence: SourceRef };
type ReportedStatus = {
  value: PlanStatus; authority: 'plan' | 'progress'; raw: string | null;
  evidence: SourceRef[]; captured: StatusEvidence[];
};
type PlanDocument = {
  path: string; state: 'absent' | 'readable' | 'unreadable' | 'oversize' | 'invalid' | 'changed';
  sizeBytes: number | null; modifiedAt: string | null;
};
type DateEvidence = { value: string; precision: 'day' | 'instant'; evidence: SourceRef };
type FilePlanPhase = {
  id: string; number: number | null; title: string | null; path: string | null;
  reportedStatus: ReportedStatus; evidenceLinks: string[];
};
type FilePlan = {
  id: string; title: string | null; description: string | null;
  metadata: { priority: string | null; effort: string | null; issue: string | null; branch: string | null; tags: string[] };
  documents: { plan: PlanDocument; progress: PlanDocument };
  reportedStatus: ReportedStatus; phases: FilePlanPhase[];
  completion: { declared: number | null; completed: number; unknown: number; conflicted: number; fraction: number | null };
  dates: {
    created: DateEvidence | null; plannedStart: DateEvidence | null; plannedEnd: DateEvidence | null;
    actualStart: DateEvidence | null; actualEnd: DateEvidence | null; published: DateEvidence | null;
  };
  lastDocumentUpdate: string | null; diagnostics: Diagnostic[];
};
type PlanTarget = { project: string; worktreePath: string | null; targetKey: string };
type PlanFoldersResponse = {
  target: PlanTarget; path: string; kind: 'collection' | 'group' | 'plan';
  folderState: 'present' | 'missing'; folders: { path: string; name: string }[];
  listing: { complete: boolean; entriesVisited: number; limitsReached: string[] };
  watchPaths: string[]; diagnostics: Diagnostic[];
};
type SelectedPlanResponse = {
  target: PlanTarget; plan: FilePlan; watchPaths: string[]; diagnostics: Diagnostic[];
};
```

- Plan id: target-relative plan directory `plans/<dir>[/group...]`. Phase id: normalized local phase path or `phase:<unique-number>`; collisions are inventory diagnostics. Never use title/basename/DB UUID as global identity.
- SourceRefs avoid repeating document/raw strings; raw status stored once per status field. Lines/source identify reported claims, not authority to open anything.
- Missing plans root: folder GET returns 200, `folderState:missing`, empty folders, complete listing, `watchPaths:['.']`. Missing nonroot browse/selected path is 404. Symlink/non-directory/unreadable root is an error, not missing.
- Selected regular plan.md retains nullable metadata/unknown status when its content is invalid/unreadable. A group without regular plan.md cannot be loaded as a plan. No fabricated Pending/title/priority; folder names are navigation identifiers, not parsed plan metadata.
- Preserve existing resolver codes for unknown project/unregistered worktree. Additional errors: 400 PLANS_INVALID_QUERY; 403 PLANS_PATH_REJECTED/PLANS_PERMISSION_DENIED; 404 PLANS_NOT_FOUND; 409 PLANS_TARGET_CHANGED; 413 PLANS_RESPONSE_TOO_LARGE; 503 PLANS_FS_UNAVAILABLE; 500 PLANS_READ_FAILED. Sanitize paths/content out of error messages.

## 3. On-demand browsing and resource bounds

- Fixed `<resolved-target>/plans/`. Browse only the immediate requested directory; never recursively discover or parse all plans. A regular plan.md establishes selected membership; progress/phase/report files never create a plan.
- Skip hidden components and case-insensitive utility basenames reports, research, templates, scout, node_modules. Archive folders remain eligible groups. Child names alone carry no status/date/metadata claims.
- Never follow symlink directories/files. Probe selected progress presence without following it: a symlink progress entry still opts into progress authority and yields rejected/unreadable progress, not plan fallback.
- Bytewise sort retained folder entries and deduplicated watchPaths. Bound enumeration even for skipped entries; visible listing truncation is not a partially loaded status board. More than 200 sibling plan folders can be browsed without any plan-content read.

| Bound | Value | Observable result |
|---|---|---|
| Immediate directory entries, including skipped | 5,000 | Stop before next; listing incomplete |
| Relative path | 4 KiB UTF-8; 32 components including plans | Reject before traversal; no recursive depth scan |
| Selected decisive reads | 2: plan.md and progress.md | No sibling/phase/receipt byte reads |
| Each full decisive/detail document | 64 KiB | +1 rejects; never parse a prefix |
| Selected decisive bytes/request | 128 KiB | Complete snapshots only |
| Serialized JSON | 2 MiB | Folder listing omits whole trailing entries with visible limit; selected response rejects 413, never drops phases |
| Declared phase rows/selected plan | 128 | Inventory unavailable + diagnostic on overflow |
| Metadata string | 4 KiB | Oversize field null/unknown + diagnostic |
| Title/tag | 512 UTF-8 bytes; 32 tags | Invalid oversized fields diagnostic, not clipped semantics |
| Evidence links/selected plan | 64 | Explicit diagnostic if additional evidence omitted |
| Diagnostics/selected plan or listing | 32 | Counted DIAGNOSTICS_LIMIT entry, not silent dropping |
| Diagnostic/raw status text | 1 KiB | Semantic overflow unknown; diagnostic clipping labelled |
| YAML nesting | 16 | Invalid metadata; no unbounded recursion/aliases |
| Active navigation watch paths | 33: target root plus requested ancestors/directory | No child/sibling watches; one evidence-parent watch may be added |
| Client concurrent watch registrations | 8 | Bounded queue; late completion cleanup |
| Automatic reconciliation passes/churn episode | 3 | Then explicit unsettled/degraded coverage; user/focus/new event can reconcile |

Folder `limitsReached`: entries, response-bytes. Utility exclusions are intentional; eligible omitted entries make listing incomplete. Selected document/phase errors are plan diagnostics, not silent collection omissions. Watch paths cover only the current navigation chain and selected directory, not every listed folder. No separate telemetry/service/persistent scan index.

## 4. Safe snapshots and file access

- Obtain current workspace-context guard using existing pattern; resolve/bind configured target and root identity. Copy config data, release config lock before I/O. Pin selected target handle; revalidate target/root identity before publication. Never publish changed workspace under captured old target.
- Extend crate-private secure_path primitives for rooted no-follow enumeration and `read_regular_snapshot(rootBinding, relativePath, 64KiB)` returning bytes and descriptor metadata. Share between selected read and strict details, not independent canonicalize/stat/reopen logic.
- Unix: openat through pinned no-follow directory components; final O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_NONBLOCK; fstat regular file before data read, limit+1 bound, size/mtime/ctime from same fd. FIFO/device/socket rejects promptly.
- Windows: native handle/reparse rejection at each component, stable volume/file identity, pinned ancestors without delete-sharing, same final regular-file handle for data/metadata. Preserve compilation and implement platform semantics; never substitute a pathname-only check. Unsupported platform returns explicit safe failure, not unsafe content.
- Qualification decision: implement cross-platform Unix/Windows safety and preserve builds; runtime proof in this environment is Linux. Windows runtime remains explicitly unqualified until exercised on Windows, not declared unsupported merely because untested.
- Check before/after descriptor identity/size/mtime/ctime and named-entry identity. Concurrent in-place write/replacement -> changed diagnostic and unknown decisive status immediately. No automatic per-request reread/retry loop. Watcher/user refetch may obtain a later stable report.
- Two stable documents cannot prove a writer transaction or durable baseline. UI continues to label reported status; no claim of cross-file atomicity.
- Reads preserve bytes/mtime/ctime. OS atime may change; do not promise all filesystem timestamps unchanged.

Existing FS strict detail mode:
- REST `/api/fs/read` optional `mode=plan-document`; WS FsRead optional `readMode:'plan-document'`. Default absent preserves general IDE behavior. Unknown mode rejects.
- Target-relative `.md` (case-insensitive extension), anywhere inside captured selected target: allow local docs/UI review evidence outside plans/. Full UTF-8/no-NUL only, no ranges, 64KiB cap, no symlink/nonregular read, same snapshot primitive and target recheck.
- Preserve existing successful FS response shape; strict failures expose safe existing-style error code. Snapshot changed is not falsely returned as readable success. No new detail endpoint or generic filesystem redesign.

## 5. Metadata, phase inventory and progress precedence

1. Decode UTF-8, reject NUL/binary. Parse leading YAML mapping with existing serde_yaml_ng; reject duplicate keys, aliases/tags/custom objects, excessive nesting. Optional metadata absent -> null, not invented defaults. String fields as DTO; issue may be string or integer text; tags string array. No directory-name title/date inference.
2. Inventory comes from a GFM table under `Phases` heading, including `Phases — Initial Snapshot`. Normalize header names (`#`/number, phase/name, status, detail/link); tokenize escaped pipes, code spans and Markdown links rather than fixed-position regex. Multiple contradictory tables, duplicate paths/numbers or overflow -> inventory unavailable, not merged by guess. No task-checkbox counting.
3. Phase identity: normalize relative link within member directory; otherwise unique explicit positive number from number column or leading `Phase 01`/`01 —`. Decode once; strip query/fragment for identity; reject scheme/absolute/NUL/escapes. Evidence links may point elsewhere within captured target and do not establish phase identity.
4. Status cell: remove surrounding Markdown emphasis/code, normalize case/whitespace; exact aliases pending/planned/not started; in-progress/in progress/ongoing; complete/completed/done; cancelled/canceled; blocked; unknown/unreported. One parenthesized explanatory qualifier allowed. Preserve raw. No substring completion, checkmark/receipt-based inference or inferred success from missing data.
5. If no progress entry, labelled plan authority: plan summary/frontmatter + inventory statuses; contradictory complete inventory/explicit status -> conflict. Link to nonexistent progress adds PROGRESS_MISSING snapshot warning. Missing progress cannot prove absence of protected history.
6. If any progress entry exists, progress authority only for current phase/status. Read top-level labelled Current status/Current Status scalar and Phase Reconciliation/Phase Summary sections. Normalize headers; Current status beats Status; Captured status is separate historical context. Multiple disagreeing current claims -> conflict.
7. Match progress rows by normalized phase link, otherwise unique number. Link/number disagreement, duplicate/unmatched/undeclared row -> diagnostic, never completes another phase. Missing current rows -> unknown/unreported, never captured Pending.
8. Canonical summary token uses step 4. For observed prose, parse a bounded complete grammar: `All phases [(list-or-range)] [are] complete[d] [with durable task sealing]. [Plan execution complete.]`. Phase list supports Phase-prefixed numbers, comma/and lists and explicit positive ranges such as 01–07; normalized set must equal declared inventory, and every declared current row must independently report complete. Optional final `Plan execution complete` alone likewise requires independently complete rows. No fixture-specific exact sentence; negation, conditional/extra clauses or unsupported prose remains unknown with UNSUPPORTED_STATUS.
9. Without summary, derive only from current recognized rows: all complete -> completed; all cancelled -> cancelled; explicit blocked -> blocked; active or complete+pending mix -> in-progress; all pending -> pending. Unknown/conflict/mixed cancelled+pending prevents invented aggregate completion. With explicit supported summary, preserve reported claim but diagnose missing rows; completed versus any explicit noncompleted current row -> conflict. Unknown explicit summary is not silently replaced by green rows.
10. Unreadable/invalid decisive progress -> current unknown/conflict; retain readable metadata, historical captured values and individual recognized evidence. No silent plan fallback.
11. completion counts declared current phases only. Unknown/conflict counts separate and stay in denominator. `fraction=completed/declared` only with nonempty valid inventory and at least one recognized matched current row; otherwise null. Label Known completed phases, not effort/execution estimate. No phases -> unavailable, not 0%/100%.

Diagnostics include INVALID_METADATA, INVALID_DOCUMENT, FIELD_TOO_LARGE, PHASE_INVENTORY_INVALID, PHASE_UNREPORTED, PHASE_UNMATCHED, STATUS_CONFLICT, UNSUPPORTED_STATUS, PROGRESS_MISSING, PROGRESS_UNREADABLE, DOCUMENT_TOO_LARGE, DOCUMENT_CHANGED, LINK_REJECTED, INVALID_DATE, DATE_CONFLICT, SCAN_LIMIT, DIAGNOSTICS_LIMIT.

## 6. Explicit dates and Timeline

- Plan/progress YAML: created, planned_start/plannedStart, planned_end/plannedEnd, actual_start/actualStart, actual_end/actualEnd, published. Explicit legacy started/completed map to actualStart/actualEnd; conflicting aliases -> null + DATE_CONFLICT.
- Standalone metadata-region labels before first level-two heading: Created, Planned start/end, Actual start/end, Started, Completed, Published. Optional bold/list prefix. Do not parse arbitrary prose, receipts, table validation dates or generic updated/date/effort.
- Created/planned: plan first, progress only fills absent fields. Actual: explicit progress and plan evidence must agree when both claim values; disagreement suppresses that endpoint. Published: latest explicit progress publication supersedes older plan publication, not execution date.
- Strict Gregorian YYYY-MM-DD remains precision day; RFC3339 requires explicit zone and normalizes UTC precision instant. Reject timezone-free/local dates, invalid days, reversed or mixed-precision ranges. Preserve valid individual date evidence; invalid ranges get no bar.
- Planned bar only for two valid same-precision scheduled endpoints; outlined/dashed with legend. Actual closed bar solid, two valid same-precision actual endpoints. Both may coexist.
- Open actual bar only with explicit start, absent end, reported in-progress and nonfuture start; extend to labelled Now/Today at matching precision. Other statuses/start-only or end-only produce explicit milestone/missing endpoint, not fabricated execution.
- Creation-only -> creation milestone; all execution/schedule/creation dates missing -> selected-plan Undated state. Published/mtime are freshness only. No directory naming date guess, effort calendar conversion, phase dependency/scheduling Gantt or heatmap.
- Timeline represents only the selected plan's planned/actual date evidence, never cross-plan comparison or inferred phase scheduling. Day endpoints inclusive; never shift by browser/server timezone. Instant display declares timezone; undated selected plans remain readable.

## 7. Watch-only filesystem seam and owner lifecycle

Actual source facts: watcher.rs:90–97 is NonRecursive; fs/mod.rs:184–205 uses target root as WatcherKey.root even for deeper filter; ws.rs:2883–2936 computes tree snapshots;2999 only logs receiver lag. These must change narrowly for this feature.

- Add optional `watchOnly:true` to existing FsSubTree/transport options. Default false preserves tree consumers. In true branch validate actual directory and register new FsSubsystem helper with WatcherKey.root equal to that directory, NOT target root; reuse same nonrecursive/refcount manager and event pump.
- Ack same TreeSnapshot envelope with nodes:[]; skip unused tree enumeration entirely. No new event vocabulary or global recursive mode. Bind watcher root under approved selected target; no symlink watch escape.
- Receiver Lagged or outbound queue overflow sends existing FsOverflow, then releases subscription. Existing onFsOverflow callback triggers rescan/rebind. Never leave event loss invisible as a live dashboard.
- Both APIs return `.` target root and existing requested path ancestors/current directory, max33. One selected evidence-parent watch may be added. No watch per child or unselected sibling. Root spellings supported by resolver; use `.`.
- Client capture `{profileId,generation}`, normalized project/worktree, browse path or selected planPath, original ApiClient/transport and effect lifetime before all work. File APIs never use invented default project or ambient target fallback.
- Open: attach root watch -> browse folders -> bounded attach navigation paths/listeners -> refetch after additions -> reconcile set. Selected read follows deliberate selection only. Add before remove; cap registrations at8, churn passes3. Parent directory change recreates affected child handles even at identical pathnames. On failure retain same-selection stale/degraded data, never claim live coverage.
- Events invalidate only current browsing/selected reads as relevant; no background read of every listed child. Parent replacement/removal/rename reconciles descendants. Both rename path/from matter. Selected detail invalidation uses watched parent + normalized filename or conservative scoped read invalidation.
- Event bursts coalesce one queued invalidation task. No optimistic status patch, periodic collection polling, explorer tree side effects or persistent handles in query cache.
- Close/owner invalidation/target or plan selection change: retire affected lifetime synchronously, detach callbacks, cancel queued work/queries, unsubscribe exact ids on original transport. Late subscribe resolution unsubscribes immediately. New generation rebuilds; old callbacks cannot invalidate current owner/selection, including a different plan under the same owner/target.
- Open/reconnect/focus/manual Refresh reconcile current navigation/selection; missing plans root is covered by root watch until discovered. Directory-registration races close through post-attach refetch, not fictional recursive coverage.

## 8. Surface, renderer and preserved manual flow

- Keep existing ribbon/open controls/WorkspacePage key/callbacks. Ribbon remains manual active-item/session summary; file plans never fake ItemDto or execution sessions.
- Inline desktop Deck grows to min(70dvh,720px), minimum320px, independent scroll areas. File plans / Manual tracking switch; File plans starts at folders. Selected plan offers Overview/Timeline/Documents and Back to folders. Manual forms/content stay mounted while open so toggles preserve drafts.
- Mobile retains Sheet Projects/Plans/Execution segments; same file/manual content inside Plans; dashboard expands to90dvh. Breadcrumb/Back/detail/escape and focus restoration use existing boundaries.
- Key only file-dashboard subtree by owner/target. Never remount workspace/editor/PTY on folder navigation, tab, selection or refresh. File/manual errors remain panel-local; one subsystem unavailable never disables the other.
- Folder browser: immediate names, breadcrumb navigation, name filter and Refresh; explicit empty/missing/truncated/error states. No title/status/priority/tag filtering over unloaded plans. Selected Overview shows source/raw warnings, phase counts/unknowns and available metadata/freshness. Issue links require explicit safe URL or known owning repo URL; otherwise text.
- Basic read-only Plan/Progress tabs and Markdown evidence/phase links. Reuse MarkdownPreview optional link/image policy hooks preserving every existing caller's default behavior. LSP references before export changes.
- Resolve relative links lexically against source within captured selected target; reject escape/absolute/NUL/malformed encoding and unsafe schemes. Fragments target rendered headings; heading IDs generated locally without global keyboard handlers/new dependency. Local Markdown stays in detail, never writable editor.
- Reuse GFM/Mermaid; http/https external links noopener/noreferrer; no raw HTML execution. Local images always show accessible alt/source notices, never browser-relative fetch or new ticket/media capability. Non-Markdown local targets explicitly unsupported; no universal filesystem browser, download fallback or full reader parity.

## 9. Acceptance matrix

| ID | Observable proof |
|---|---|
| A01 | Configured root and registered external worktree browse their own folders and selected same-id plans; invalid/unregistered targets denied |
| A02 | Frozen advisor plan Pending + five complete progress rows -> five completed reported phases, plan metadata unchanged |
| A03 | No progress -> labelled plan fallback; referenced missing overview warning; no protected-history claim |
| A04 | Current/Captured reordered columns, bold DONE summary, list/range prose, matching links/numbers and negations behave correctly |
| A05 | Invalid/partial/unreadable/conflicting/oversize progress never silently falls back or invents completion |
| A06 | Empty/invalid phase inventory -> unavailable fraction; unknown/conflicted current phases remain visible |
| A07 | Planned/actual/creation/undated/invalid dates all selectable; no mtime/effort bars or timezone day shift |
| A08 | Read-only Plan/Progress/evidence details include target-local docs/UI review paths; escapes/unsafe schemes denied |
| A09 | Actual selected nested edit/atomic rename, missing-root creation, current group/plan replacement and event loss -> selected overview/detail or folder refresh, otherwise explicit degraded state |
| A10 | Delayed response/subscription across close, same-target plan selection, root/worktree/profile switch and reconnect cannot publish/clean up another owner or selection |
| A11 | Auth, nofollow descriptor races, FIFO/nonregular, listing/document/response limits and root/config change return defined safe errors |
| A12 | Dashboard reads preserve source bytes/mtime/ctime; no application writes/DB import; no OS-atime promise |
| A13 | Existing manual CRUD/notes/sessions/terminal reveal work; file/manual outages independent; shell/editor/PTY state preserved |
| A14 | Desktop1440x900/mobile390x844/narrow320px keyboard/focus/scroll/layout checked in actual app; fresh human-reviewed captures; capture-disabled CI assertions |
| A15 | Initial folder browsing reads no plan/progress bytes or sibling statuses; more than200 sibling folders remain navigable; selecting one reads only that plan; Back opens no other plan |
| A16 | Cross-platform safe code/builds preserved; Linux runtime evidence recorded, Windows runtime explicitly unqualified; Markdown/Mermaid work and local images show notices without media requests |

No unresolved product decisions. Implementation security/platform behavior must be proved, not assumed. Planning estimates/fixtures are not passed tests or authorization to execute.
