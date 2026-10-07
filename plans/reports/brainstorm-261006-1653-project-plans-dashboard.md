# Project Plans Dashboard — Agreed Brainstorm

Date: 2026-10-06. Status: design agreed and validation interview incorporated; implementation not started. Latest folder-first selection supersedes the initial automatic collection Board proposal.

## 1. Problem and final artifact

Extend DamHopper's existing Plan feature with folder-first browsing of the selected project/worktree's `plans/`. Open one plan at a time, borrowing phase breakdown and factual timeline concepts plus readable document details from the references. Do not run standalone servers or automatically load every plan.

Final behavior:
- Existing Plan entry/ribbon opens an expanded responsive dashboard.
- File-backed view starts with folder names; open one selected plan's Overview, Timeline and read-only Plan/Progress/evidence documents. No project-wide Board/Timeline comparison or sibling-status prefetch.
- Current status comes from `progress.md` when present; otherwise from `plan.md`.
- Existing SQLite-backed manual plans/tasks, notes and execution sessions remain available, separate from file-backed plans.
- Shared React implementation serves browser and native hosts. Native Rust read API supplies normalized file data.
- No application status writes, file migrations, database import or agent execution.
- Cross-platform safe Unix/Windows implementation and preserved builds; runtime proof Linux here, Windows runtime explicitly unqualified until exercised there.
- Markdown/GFM/Mermaid previews; local images show accessible notices, no new image ticket/media integration.

Brainstorm artifact: this report. User subsequently approved detailed planning; the [pending implementation plan](../261006-1653-project-plans-dashboard/plan.md) and [frozen contracts](../261006-1653-project-plans-dashboard/contracts.md) are now written. No implementation authorization implied.

## 2. User decisions

| Gate | Agreed contract |
|---|---|
| Placement | Expand current Plan feature; do not replace existing manual workflow tracking |
| Writers | Agents/orchestrator publish files; dashboard reads only |
| Compatibility | File presence opts into progress; source-aware parsing of current formats; no required schema migration |
| Scope | Folder browser/name filter; one selected plan's metadata, phase progress, evidence-based Timeline and basic Markdown details; no collection Board |
| Targets | Selected target's `plans/`: configured project root or registered worktree root |
| Architecture | Native Rust read model plus shared React; existing auth, sandbox, owner fencing and renderer |
| Timeline | Explicit planned/actual dates; creation milestones; missing dates remain visible without invented bars |
| Constraints | Maintainability over reference parity; no fixed delivery date specified |
| Validation revision | User requested folders before content, then explicitly selected “Open one plan at a time”; replaces automatic collection loading |
| Platform proof | Cross-platform code/builds; Linux runtime proof; Windows runtime explicitly unqualified until tested there |
| Reader assets | Markdown/Mermaid; local-image notices, no media capability integration |

## 3. Repository and reference evidence

### Existing DamHopper

- `packages/ui/src/components/organisms/WorkflowContextSurface.tsx`: overview query, target/item selection, ribbon, desktop Deck/mobile Sheet and manual mutations.
- `packages/ui/src/components/pages/WorkspacePage.tsx:2521–2592`: embeds the same workflow surface into workspace shells.
- `packages/ui/src/api/workflow-dto-types.ts`: database Plan/Phase/Task hierarchy; no file-plan identity or document fields.
- `server/src/api/workflow/mod.rs`, `server/src/workflow/`: overview reads workflow SQLite, not project `plans/` folders.
- `docs/workflow-api.md:35–109`: workspace scope, registered-worktree resolution, existing shared SQLite persistence.
- `server/src/fs/sandbox.rs:59–105`: validates server-resolved project/worktree targets.
- `server/src/fs/watcher.rs`: shared, refcounted, debounced **non-recursive** filesystem watchers (`:90–97`). Root-only subscriptions cannot observe nested progress edits.
- `packages/ui/src/hooks/use-fs-subscription.ts`: owner-bound subscription transport and cleanup patterns. It currently updates tree/Git state, not a plan index.
- `packages/ui/src/api/workflow-queries.ts` and `docs/architecture/terminal-continuity-and-workflow.md`: profile/connection-generation ownership conventions.
- `packages/ui/src/components/organisms/MarkdownPreview.tsx`: existing ReactMarkdown/GFM renderer. Current links open external tabs; project-relative links need target-aware resolution for dashboard details.
- `server/Cargo.toml`: existing `serde_yaml_ng`, `chrono`, `notify` dependencies; no need for a Node parsing service.

### Evcrate instruction review

Source: `/home/loidinh/WS/evcrate/.evcrate/source/.claude/`.

- `workflows/plan-progress.md:7–12`: ordinary plans retain normal `plan.md` tracking. Protected plans use derived, uncaptured `progress.md`; missing progress does not prove absence of protected history.
- `workflows/plan-progress.md:54–65`: parent alone publishes immutable receipts and mutable progress; sealed plan/phase/evidence files remain untouched. Progress publication is administrative, not execution permission or completion proof.
- `agents/planner.md:86–112` and `skills/planning/references/output-standards.md:5–34`: `plan.md` YAML fields include title, description, status, priority, effort, issue, branch, tags and created date. New plans start `pending`.
- Progress workflow specifies semantic content, not one mandatory YAML/table serialization. Support existing reconciliation/summary documents rather than impose a second writer protocol.

Important distinction: this dashboard does not change Evcrate's ordinary-versus-protected writing rules. It consumes both conventions. Cross-repository command/skill changes are out of scope.

### Reference concepts and incompatibilities

Sources: `/mnt/data/ws/raspberrypi-deepsleep/.claude/commands/{kanban,preview}.md`, `skills/plans-kanban/`, `skills/markdown-novel-viewer/`.

- Kanban scans directories containing `plan.md`, derives metadata/phase progress from that file, and excludes utility folders.
- Preview provides markdown details, directory browsing and phase navigation. Full reader/navigation parity was not selected.
- `plans-kanban/scripts/lib/plan-scanner.cjs:111–155`: current status and phases come from `plan.md`, not `progress.md`.
- `plans-kanban/scripts/lib/dashboard-renderer.cjs:293–317`: timeline may use file modification time for missing completion dates and one-day defaults for other missing ranges. Do not copy these as actual execution history.

Observed incompatibility:
- `plans/261003-1822-advisor-routing-model-selector/plan.md`: frontmatter pending; initial five phases pending.
- Its `progress.md`: all five phases complete; Current status and Captured status explicitly differ.
- Ran reference `parsePlanTable` on that actual plan with Node. Output: five pending phases; each detail-file field pointed back to `plan.md`, not the linked phase file.
- `plans/261003-1820-cognito-privacy-blur/progress.md`: alternate existing format uses Current Status and Phase Summary, with a bold DONE cell.

Conclusion: visual concepts reusable; reference parser unsuitable unchanged.

## 4. Evaluated approaches

| Approach | Pros | Cons | Decision |
|---|---|---|---|
| Native Rust file read model + React | One parser; server-enforced bounds and target containment; consistent source semantics; works across hosts | New read API/parser and UI integration | Selected |
| Browser aggregates filesystem APIs | Smaller new backend surface; reuse existing file reads | Request fan-out; browser parsing; harder bounded scans and consistent snapshots | Viable, not selected |
| Import into workflow SQLite | Can reuse workflow item hierarchy | Persistent identity, deletion reconciliation, competing status authority, stale imported data | Rejected for this scope |

Standalone Node server/iframe is not an integration candidate: extra process, port, authentication boundary and host-specific behavior without a user requirement.

## 5. Source and status contract

### Discovery

- Server resolves authenticated project/registered-worktree target first, then fixed `<target-root>/plans/`.
- Plan identity: relative plan-directory path within that target. Client identity also includes profile and connection generation.
- `plan.md` establishes plan membership, metadata and declared phase inventory. Do not reconstruct a nonexistent plan from arbitrary reports.
- On-demand immediate folder browsing; skip hidden/utility/symlink directories. Probe only current directory's regular plan marker, not child content. Opening a group browses it; opening a plan reads only that plan/progress.
- Missing plans root: explicit empty folder state. Permissions/target failures distinct; bounded folder listing exposes truncation. No recursive status scan, bulk-load API or per-child watches.

### File precedence

| Files/state | Metadata and phase definition | Current displayed status |
|---|---|---|
| `plan.md`, no progress | Plan | Plan; labelled `plan.md` fallback |
| Plan + readable recognized progress | Plan | Progress; labelled `progress.md` reported status |
| Plan + unreadable/unsupported/contradictory progress | Preserve readable plan metadata | Unknown/conflict warning; no silent plan-status fallback |
| Plan points at missing progress | Plan | Fallback snapshot with missing-current-overview warning; no claim of current verified completion |

When progress exists, missing individual phase updates remain unknown/unreported; do not fill them from captured Pending cells as if current.

### Parsing boundaries

- Parse YAML metadata with the existing Rust YAML dependency. Malformed metadata remains diagnostic, not an invented default.
- Support observed Current status/Current Status summaries and Phase Reconciliation/Phase Summary tables.
- Use normalized table headers, not fixed column positions. Current status wins over Captured status; captured values stay historical context.
- Match phases by normalized local phase link where available; otherwise a unique explicit phase number within that plan. Ambiguous matching remains diagnostic.
- Recognize known status tokens and observed qualified forms such as `Complete (Durable Advisor Task Sealing)` and bold `DONE`. Do not use loose substring matching that could interpret `incomplete` or `not completed` as completion.
- Conflicting current summary/table claims remain visible; never erase disagreement by forcing green reported completion.
- Distinguish cancelled, blocked and unknown from pending. File-plan statuses need not mutate the existing workflow enums.
- Progress means completed declared phases / declared phases, not task effort, elapsed time or arbitrary document checkboxes. Unknown phases stay visible; absent breakdown is unavailable, not 0% or 100% by invention.
- Preserve raw status text, source path, warnings and evidence links for inspection.

### Authority boundary

Selected-plan progress describes reported file status. It does not verify durable controller completion, receipts, baseline freshness, implementation qualification or permission to proceed. No controller calls, receipt reconstruction, automatic phase selection or workflow-session mutation.

## 6. Dashboard and timeline

### Surface

- Keep existing ribbon/Plan entry. Expanded surface offers File plans and separate Manual tracking.
- File plans starts with immediate folders, breadcrumbs, name filter and Refresh. Names are navigation identifiers, not title/status/priority claims about unloaded plans.
- Open one plan for selected Overview/Timeline/Documents; no cross-plan comparison, status filters across unloaded folders, load-all control or sibling prefetch. Overview shows metadata, current source/diagnostics and known/unknown phase counts.
- Selected Plan/Progress documents and phase/evidence links stay read-only; progress-unavailable state explicit. Back restores folder focus without opening another plan.
- Reuse MarkdownPreview rather than port reference HTML/CSS. Use existing app theme and responsive shell behavior.
- Resolve local document links through the captured project/worktree owner, not browser-relative URLs. External issue links require a known repository URL; branch text is not permission to switch branches.
- Basic Markdown/GFM/Mermaid included; local images always accessible notices. Novel theme/universal filesystem browser/previous-next reader/media capability excluded.

### Evidence-based Timeline/Gantt

- Selected plan-level only; no cross-plan or inferred phase scheduling comparison.
- Explicit scheduled range: planned bar, visibly distinct from actual execution.
- Explicit actual start/end: actual bar. Open actual execution may extend to the clearly labelled current time only when start/status support that meaning.
- Only explicit creation date: creation milestone, not execution start. No directory-name date inference.
- No usable dates: selected-plan Undated state; Overview/documents remain accessible.
- Published/update/mtime is document freshness, not completion time. Effort is an estimate, not a calendar duration.
- Preserve date precision; date-only values remain calendar dates. Invalid/reversed ranges produce diagnostics.
- Define exact supported explicit date fields/labels in the implementation contract. Optional parsing support does not require rewriting existing files.

## 7. Implementation considerations and touchpoints

Proposed contracts below are design, not existing APIs.

- Add a focused file-plan read service adjacent to existing workflow/filesystem boundaries. Keep SQLite manual workflow service unchanged.
- Protected immediate-folder and single-selected-plan GET operations accept structured target/relative path; selection required for content. No arbitrary absolute roots or implicit collection load. Exact names/DTOs in implementation contracts.
- Read model separates metadata, phase inventory, reported current status, source provenance, date provenance and diagnostics. No DB-backed fake ItemDto identities.
- Read-only details reuse the filesystem seam with a strict bounded `plan-document` read mode. Existing generic reads separately inspect/reopen files and allow uncapped ranges (`server/src/api/ws.rs:2114–2169`); that path alone cannot establish the required safe document snapshot.
- Offload blocking work using existing server patterns. Immediate enumeration/path bounds and selected full64KiB documents bound work; no recursive traversal/status parsing. Reject oversize content rather than parse a prefix.
- Symlinks/path traversal must not escape the selected target. Canonical target checks apply to discovery and document links; no scan of sibling projects or HOME.
- Owner-bound client/query keys include profile, generation, project and worktree. Late responses cannot publish into a changed owner/target.
- Reuse filesystem watches for current navigation/selected plan changes and atomic replacement; tree/Git invalidation alone will not refresh selected reports.
- Refresh on open/reconnect/focus/manual Refresh; release on close/target/plan switch. Watch root/active ancestors/current directory only, plus one evidence parent. No all-child watches. watchOnly avoids snapshots and watches actual directory; event loss refetches/rebinds current selection.
- Snapshot reads can race external publication. Treat mixed/unreadable data as transient/diagnostic; never promise cross-file atomicity the writer does not provide.

Likely affected existing files/modules:
- `server/src/api/router.rs`, API DTO/handler integration, `server/src/workflow/` boundary or focused adjacent plan-reading module.
- `server/src/fs/{sandbox,watcher}.rs` and existing target resolver/subscription APIs: reuse; change only if required.
- `packages/ui/src/api/{client,ws-transport,workflow-queries}.ts` ownership/REST patterns; focused plan-read DTO/query modules as needed.
- `packages/ui/src/components/organisms/WorkflowContext{Surface,Deck,Sheet}.tsx`, existing ribbon and `WorkspacePage.tsx` integration.
- `MarkdownPreview.tsx` or a focused reader adapter for target-aware links; existing filesystem subscription hook patterns.
- `docs/workflow-{api,client-state,context-surface}.md`, architecture references and `docs/CHANGELOG.md` after implementation proof.
- Rust API/parser/security tests, existing workflow component/browser suites and full-application visual evidence.

No required changes to Evcrate commands/skills, external reference scripts, database schema, Tauri-specific backend or running agents.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Free-form progress cannot always be parsed | Explicit supported sections; unknown/conflict states; raw document access |
| Frozen Pending defeats current Complete | Presence-based opt-in; never merge captured status into current status |
| Dashboard green confused with durable proof | `Reported` source labels; evidence links without verification claims |
| External writer changes files during reads | Snapshot diagnostics; refresh/invalidation; no invented atomicity |
| Worktree/profile leakage | Server-resolved targets; owner/generation-scoped queries and subscriptions |
| Fake Gantt duration | Only selected explicit range dates/creation milestones/Undated state |
| Large collection stalls UI/server | Folders first, no sibling reads; bounded immediate listing and selected content, visible limits |
| Manual plans damaged by file integration | Separate read model; preserve existing CRUD/session/notes contracts |

## 9. Acceptance and validation criteria

1. Selecting a configured project browses its immediate folders; registered worktree uses its own plans root. More than200 siblings need no content/status parse; opening one reads only that plan.
2. Existing advisor-routing example displays five completed reported phases despite Pending in the frozen plan. Metadata still comes from `plan.md`.
3. Ordinary plan without progress displays plan-derived status with a fallback source label.
4. Phase Reconciliation and Phase Summary examples both render correctly, including bold statuses and separate captured/current columns.
5. Unreadable, malformed, partial or conflicting progress exposes diagnostic/unknown states; no silent historical status masquerading as current.
6. No breakdown produces unavailable progress, not fabricated percent. Unknown/unmatched phases remain visible.
7. Selected Timeline shows explicit planned/actual distinction, creation milestones or Undated state; no mtime/effort actual-duration bars or cross-plan comparison.
8. Selected Plan/Progress/evidence Markdown stays read-only/target-bound. Mermaid reused; local-image notices without media fetch. Receipt links not verification.
9. Selected agent edits/atomic progress replacement refresh Overview/details; current folder changes/missing-root creation/reconnect recover. No background sibling-content loading.
10. Switching project/worktree/profile or reconnecting prevents stale results and subscriptions from contaminating the new target.
11. Unauthenticated reads and out-of-target/symlink-escape paths are denied. Oversize documents and scan limits are explicit, not silently truncated into success.
12. Browsing/refreshing preserve plan/progress/phase/receipt bytes/mtime/ctime; OS atime may change. No DB import or manual mutation.
13. Existing manual Plan/Phase/Task CRUD, notes and sessions remain usable. Dashboard unavailable state does not disable valid manual workflow tracking, and vice versa.
14. Actual app desktop/mobile/narrow proof, keyboard/scroll/source/target/date checks, fresh captures/human review. Cross-platform safe code/builds preserved; Linux runtime proof, Windows runtime explicitly unqualified.

Permanent tests should cover precedence, parsing boundaries, scoped identity, source conflicts and date semantics. Runtime smoke must cover actual watcher-to-dashboard updates and unchanged manual workflow behavior. Do not certify implementation from mocked rendering alone.

## 10. Verification performed in this brainstorm

- Read current workflow API/UI/source ownership, filesystem sandbox/watch patterns, renderer and dependencies.
- Read reference skills/parser/scanner/timeline code and Evcrate planning/progress contracts.
- Ran actual Node reference phase parser against the repository's advisor-routing plan: observed five Pending phases and incorrect phase-document targets.
- No application implementation, application smoke, build, lint or test suite run. Future acceptance criteria above are not claimed passed.

## 11. Next steps and dependencies

1. User approved detailed planning; installed `/cmd-plan__hard` execute mechanism admitted this report as context.
2. Created [plan.md](../261006-1653-project-plans-dashboard/plan.md), five phases, [contracts.md](../261006-1653-project-plans-dashboard/contracts.md), initial administrative progress and contract research.
3. Plan frontmatter remains `status: pending`; implementation has not started. [Planning validation](../261006-1653-project-plans-dashboard/reports/planning-validation.md) checks artifact structure/navigation only, not feature correctness.
4. Installed `/cmd-plan__validate` invoked; four interview questions resolved folder-first/single-plan flow, cross-platform code/Linux proof and Markdown/Mermaid/image notices. Overview/contracts/phases/research/architecture reconciled. Implementation still requires a separate request; unsupported formats remain explicit unknowns.

## Unresolved questions

None requiring another product decision. Exact parser/date/API/resource contracts are frozen in the pending implementation plan. User review/implementation authorization remains separate.
