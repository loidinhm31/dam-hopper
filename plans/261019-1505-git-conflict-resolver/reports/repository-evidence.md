# Current repository evidence

Status: read-only discovery completed; no implementation/runtime qualification. Parent plus terminal results from `BackendScout` and `FrontendScout`; both scouts completed. Research agents `GitSemanticsResearch` and `MergeModelResearch` completed; parent corrected unsupported assumptions in their reports. Exact source ranges are snapshots, not durable semantic locations.

## Backend

| Existing path | Current behavior / plan consequence |
| --- | --- |
| `server/src/git/diff.rs:830-919` | `get_conflicts`, `read_blob_utf8`, `resolve_conflict`; optional-string stages, lossy UTF-8, no snapshot, writes then stages. Replace obsolete implementations and migrate reexports/callers |
| `server/src/git/diff.rs:649` | `stage_files` general staging entry; add conflict preflight so resolver safety is not only a disabled UI control |
| `server/src/git/types.rs:190-203,422-430` | Recovery operation enum omits revert; ConflictFile contains path/optional strings. Upgrade, do not add parallel legacy DTO |
| `server/src/git/mod.rs` | Public conflict/recovery reexports; migrate atomically |
| `server/src/git/cli_fallback.rs:40-54,115-137,176-181` | Existing CLI helper unbounded output; detection handles rebase dirs/merge/cherry-pick, no revert/sequencer discrimination; Git path lookup already worktree-aware |
| `server/src/git/vcs_roots.rs:119-205` | Existing root canonicalization/discovery; rejects aggregate write root. Reuse, add secure per-file type/ancestor checks |
| `server/src/api/git_diff.rs:241-286` | Existing list/resolve route handlers correctly start with registered project/worktree resolution and chosen VCS root |
| `server/src/api/router.rs:220-224,582-584` | **Correct actual route path**; protected conflict endpoints and global body limit. Scout's `server/src/router.rs` was incorrect |
| `server/src/git/commit_message_rewrite.rs:1289-1343` | Existing operation-specific index.lock/ref transaction, not a general mutation coordinator or filesystem transaction |
| `server/src/fs/ops.rs:175-258` | Bounded reads/mtime + atomic file write patterns, not by themselves safe Git mutation contract |
| `server/src/git/repository.rs` | Existing object-format handling; SHA-256 conflict mutation support must be qualified, not inferred from read-only detail support |
| `server/src/git/tests.rs`, `server/src/api/tests.rs` | Real filesystem/Git test patterns; current conflict coverage sparse; add consumer-visible behavior scenarios |

## Shared UI and integration

| Existing path | Current behavior / plan consequence |
| --- | --- |
| `packages/ui/src/api/client.ts` | Conflict DTO plus `git.conflicts/resolve`, owner-qualified target projection; migrate signatures |
| `packages/ui/src/api/ws-transport.ts:1026-1055` | Existing `git:conflicts/resolve` REST projection; one coherent schema required |
| `packages/ui/src/api/queries.ts:1402-1412,1465-1480` | Owner/root-qualified query; resolve invalidation/reconcile patterns reusable; add status/detail semantics and disable mutation replay |
| `packages/ui/src/components/organisms/MergeConflictEditor.tsx` | Existing marker-based component, production-unreferenced in scoped search. Stale lazy-import comment; LF marker semantics, per-file resets, empty-output restriction, local model lifecycle insufficient |
| `packages/ui/src/components/organisms/MergeConflictEditor.test.tsx` | Only located external consumer of editor/ConflictBlock; current Android input-policy coverage must be preserved behaviorally, not by retaining obsolete marker logic |
| `packages/ui/src/lib/conflict-parser.ts` | Sole located source consumer old editor; LF normalization and marker-only resolution, replace/remove on clean cutover |
| `packages/ui/src/components/organisms/ChangedFilesList.tsx` | Conflicts reach ordinary selection; bulk excludes them but row checkbox/context actions can stage. Fix all UI paths and backend stage boundary |
| `packages/ui/src/components/pages/WorkspacePage.tsx` | `openChangedFileDiff` currently goes to openDiff for conflict too; owns shell branching and request coordination. Appropriate draft/controller host above responsive shells |
| `packages/ui/src/components/organisms/WorkspaceGitPanel.tsx` | Existing target/generation/root-qualified reveal request pattern, reuse for resolver launch semantics |
| `packages/ui/src/lib/terminal-workspace-panel.ts` | `files|tool` floating identity, base/front z-order; extend/migrate one contract, no parallel stacking convention |
| `packages/ui/src/components/organisms/TerminalFloatingToolPanel.tsx` | Drag/resize/clamp pattern; narrow bounds/720px/global Escape not suitable unchanged |
| `packages/ui/src/components/templates/{IdeShell,TerminalWorkspaceShell,MobileWorkspaceShell}.tsx` | Separate shell surfaces; resolver must share workspace-level lifetime rather than duplicate state per shell |
| `packages/ui/src/api/ownership.ts`, `packages/ui/src/stores/editor.ts` | Server URL/resource binding, generation/late-response/dirty-tab patterns; resolver independent of editor-tab state |
| `packages/ui/src/components/organisms/DiffViewer.tsx` | Public Monaco model/resize/dispose pattern only, not resolver host |
| `packages/ui/src/lib/monaco-setup.ts` | Existing Monaco setup; inspect installed public typings during Phase 01, no private workbench imports |

## Verification and documentation surfaces

- `packages/ui/package.json`: build, test, test:browser, test:e2e, test:e2e:typecheck commands verified as declared scripts.
- `packages/ui/e2e/fixtures/application-fixture.ts`, `capture-policy.ts`, `capture-evidence.ts`: production application fixture; fresh local full viewport captures and human review. Native runtime proof separate from Chromium.
- `packages/ui/src/components/pages/WorkspacePage.test.tsx`, `ChangedFilesList.test.ts`, `TerminalFloatingToolPanel.test.tsx`: existing behavior seams; replace incidental default/wiring assertions with actual consumer behavior where touched.
- `docs/api/git.md`, `docs/api/rest-endpoints.md`, `docs/architecture/workbench-files-editor-and-git.md`, `docs/frontend-components/terminal-and-ide.md`, `docs/system-architecture.md`, `docs/project-roadmap.md`, `docs/CHANGELOG.md`: implementation documentation targets. Current architecture receives only clearly labeled proposed-design note during planning.
- LSP reference attempts for backend and frontend returned `No language server found for this action`. Source reference search used as fallback; repeat semantic reference checks before implementation exported-symbol changes when a server is available.
- `date +%y%m%d` returned `261019`; naming uses injected `261019-1505` session slot. Active-plan setter ran but `EVCRATE_SESSION_ID` absent: session persistence not activated; pass plan path explicitly.

## Unresolved questions

No new product clarification required. Technical feasibility and host qualification remain pending gates in Phase 01/09. Existing disconnected code is evidence to migrate, not proof that the requested feature exists.
