# Code Review — Phase 13 Workflow Tracking & Project Plans

Score: **4/10** (builds, tests green, shell invariants hold; but 4 server-contract/functional defects block real use of W02 and parts of W01).

## Critical
1. **Plan selection unreachable** (`ProjectPlanScreens.kt` `PlanFoldersListView`). Server `/api/plans/folders` returns only *directory* entries; a `kind:"plan"` folder returns `folders: []` (server/tests/plans_api.rs `test_plan_folders_plan_kind_no_children`). UI picks "plan" via `.md` suffix heuristic that never matches; `PlanFoldersResponse.kind` unused in UI/controller. User drilling into `plans/feature-a` sees "No plan folders found" and can never call `selectPlan`. Fix: when `response.kind == PLAN` call `selectPlan(response.path)` (or show "Open plan" action); drop `.md` heuristic.
2. **`getSelectedPlan` query param wrong** (`ProjectPlansRepository.kt:50`). Sends `plan_path`; server `SelectedPlanQuery` is `camelCase, deny_unknown_fields` with alias only for `worktree_path` → `planPath` required, `plan_path` → 400. Plan overview always fails. Use `planPath` (web client does, ws-transport.ts:782). Unit tests don't assert query names → add one.
3. **Hardcoded timestamps** (`WorkflowScreens.kt:548,755,773`): End session and Start session send literal `"2026-10-16T12:00:00.000Z"`; purge default `"2026-01-01T00:00:00.000Z"`. Wrong session durations; end < start rejected once a session starts after 12:00Z; stale default. `kotlinx-datetime` is already a dependency → use `Clock.System.now()` (RFC3339 millis) via an injectable clock.
4. **Event target nullability** (`WorkflowModels.kt` `EventDto.target: WorkflowTargetDto` non-null). Server `EventDto.target: Option<TargetDto>` (mapping.rs `event()` → None when `project_name` None, e.g. workspace purge events). One such event makes the whole overview/events decode throw (`ProtocolJson` has no coercion) and panel shows error. Make `target` nullable; `WorkflowEventsView` uses `event.target.project` (line ~) → `?.`. Add serialization test with null target. (`ProjectSummaryDto.target` also server-Option; always Some today, make nullable for symmetry.)

## Warnings
- **CAS retry loop stuck after conflict** (`WorkflowController.refreshOverview`): keeps `current.selectedItem` (stale `updatedAt`) instead of the refreshed node, so retry reuses stale CAS token → conflicts forever. Also Save button calls `onUpdate` then `onDismiss()` immediately (`ItemDetailDialog`) → draft discarded, contradicting "draft was preserved" banner. Refresh `selectedItem` from overview; keep dialog open until mutation succeeds; hold draft in controller/state.
- **Failed mutations silently swallowed in UI**: create/start/purge dialogs close regardless of `Result`; non-conflict errors never surfaced. Keep dialog open + show error on failure.
- **Delete item has no confirmation**; purge dialog lacks target/workspace-labelled confirmation (spec step 3: "explicit target-labelled confirmation"). Item delete may soft-delete subtree.
- **Spec gaps (dead controller code, no UI)**: terminal/agent link & unlink (`linkTerminal`, `linkAgent`, `unlinkResource`), `selectSession`, project/status/kind filters (`setProjectFilter/StatusFilter/KindFilter`; state fields never read), notes list/delete (`deleteNote`), session↔item selection, plan timeline/undated milestones, linked-document navigation (`evidenceLinks`), watcher install/rebind/degradation (`watchPaths` parsed, unused), explicit retry states. Todo items "folder-first views/watch lifecycle" and W01 link flows are not fully delivered. Unused code violates YAGNI; unimplemented spec violates completeness.
- **`loadMoreEvents` duplicates**: `eventsNextCursor == null` means both "not loaded" and "exhausted"; screen falls back to `overview.recentEvents` and only shows Load More when cursor non-null, so first page never paginates (cursor stays null) — pagination effectively unreachable; `state.events` never seeded from `recentEvents`/cursor.
- **System Back not wired**: `ProjectPlansController.handleBack()` is only called by the on-screen button; `MainActivity`/`WorkbenchNavigation.handleBackPress` doesn't consult it → Android back exits panel instead of document→plan→folder hierarchy (script/test only assert the method exists).
- **Stale-response races**: `ProjectPlansController.loadFolders/selectPlan/openDocument` fence profile/generation/project/worktree but not request sequence; rapid taps let an older response overwrite a newer one (`currentPath` ≠ `foldersResponse.path`). `WorkflowController` mutation continuations (`updateItem` conflict handler, `onSuccess` refresh) aren't context-fenced; `isCurrentContext()` is dead and logically wrong (compares active to ctor vals).
- **Eager network on connect**: both controllers launch REST in `init` even if the Workflow panel is never opened; `ProjectPlansController` created with `initialWorktreePath=null` then immediately retargeted → duplicate load for worktrees. Overview also never refreshes on panel re-entry (no watcher, no LaunchedEffect refresh).
- `readPlanDocument`: `normalized.contains("..")` rejects legit names like `phase..1.md` (should check path *segments*); REST fallback treats raw `/api/fs/read` body as Markdown (copied from `FileRepository` fallback — verify server returns raw text, otherwise JSON envelope is rendered); duplicated bounded-read/fallback logic vs `FileRepository`. `Absent` detected via `errorCode.contains("not found")` string match.
- Closed enums have no unknown fallback: any new server enum value (`eventType` safe, but `ItemStatus`/`ResourceObservedState`/`PlanStatus`) fails whole payload. Acceptable only if intentionally fail-closed — document.

## Suggestions
- DRY: `wireName` on every enum duplicates `@SerialName`; derive once (or a shared helper).
- `PatchItemRequestSerializer.deserialize` hand-rolled with `?: ""` defaults — only used by tests; consider removing (YAGNI) or making strict.
- `WorkbenchScreen`: use local `val` instead of `workflowController!!`; `workflowRepo`/`projectPlansRepo` state vars are write-only → remove.
- Files > 800 LOC guideline: `WorkflowScreens.kt` is 924 lines → split dialogs/sessions/events views into separate files.
- Emoji icons (📄📁) in Compose text: font-dependent; use project icon glyph convention.
- Add tests: query-param names, null event target, 409 vs non-409 failure, stale-response fencing, `readPlanDocument` through `fileRepository` path (oversize at 64 KiB+1, binary), purge-after-context-switch.
- Static script is purely grep-based (91 assertions of declaration presence); add negative assertions (e.g., no literal timestamps, `planPath` param) so contract regressions are caught. Note it lives at repo-root `tests/`, matching earlier phases.

## Positive
- REST paths/verbs/body shapes for items, sessions, links, notes, history match `ws-transport.ts` and server DTOs (camelCase, `MutationDto<TombstoneDto>` wrapper, `deleteJson` bodies, `encodePathSegment`).
- `PatchItemRequest` tri-state summary (omit / null / value) correctly modelled; enum spellings (`in_progress`/`canceled` vs `in-progress`/`cancelled`) correct on both products.
- Overview 404 → unavailable only; other errors propagate. UUID v4 request ids use proper version/variant bits (`kotlin.random.Random`, not crypto — ok for idempotency keys, not secrets).
- Plan DTOs match server `plans/dto.rs` field-for-field; plan product is read-only; 64 KiB bounded read requests `max+1`; client-side path containment (defense in depth).
- NAV01/B01/B02 hold: zero `FloatingActionButton`/`WebView` in features/workflow; panel routed through single `workflowContent` host; Mermaid handled by existing `MarkdownPreviewView` fence block.
- Generation/profile/target fencing on async completions for overview/folders/plan/doc; reset on `updateContext/updateTarget`.

## Security
- No secrets/transcripts in payloads or logs; path inputs percent-encoded; no WebView; delete/purge destructive paths lack confirmation (see warnings). No injection surfaces found. Hardcoded timestamps are an integrity (audit-trail) issue.

## Validation
- `bash tests/test-phase-13-workflow-plans.sh` → 91 passed, 0 failed (rerun by reviewer).
- `./gradlew --offline -q :shared:jvmTest --tests 'dev.damhopper.nativeapp.features.workflow.*'` → completed with no failure output (only JVM native-access warnings). Reported QA run: 221 jvm + 50 android unit tests, assembleDebug OK (not rerun).
- Server contract cross-check by reading `server/src/api/plans.rs`, `server/src/plans/dto.rs`, `server/src/api/workflow/{dto,mapping}.rs`, `packages/ui/src/api/ws-transport.ts` — found issues 1, 2, 4. Passing tests/static script did NOT catch them (no query-name or null-target assertions; no device/runtime proof as phase doc requires).

## Reviewed Files
features/workflow/{WorkflowModels,WorkflowRepository,ProjectPlanModels,ProjectPlansRepository,WorkflowController,ProjectPlansController,WorkflowScreens,ProjectPlanScreens,WorkflowPanelScreen}.kt; ui/screens/WorkbenchScreen.kt (diff); tests/test-phase-13-workflow-plans.sh; androidApp WorkflowPhase13Test.kt; jvmTest workflow tests (listed/spot-checked, not line-audited).

## Unresolved Questions
- Is `/api/fs/read` REST body raw text or JSON envelope? (affects fallback in `readPlanDocument` and existing `FileRepository`).
- Are link/unlink UI, filters, notes list, plan timeline, and watcher lifecycle intentionally deferred (needs approval per no-scope-shrink rule), or required for Phase 13 acceptance?
- Should unknown-enum values fail the whole payload (fail-closed) or degrade to an `UNKNOWN` member?
- Plan phase `path`: project-root-relative on server? (assumed; matches `PlanDocument.path` usage).
- Phase doc still shows "pending/0%" and no runtime/device evidence ledger update.
