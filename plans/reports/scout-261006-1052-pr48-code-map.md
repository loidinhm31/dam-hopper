# PR48 Native Code Map

Date: 2026-10-06. HEAD `9c74aaeeb5efe2e1b4f17878ac0b4933c1854fd4`; base `9e727b4bee3b8634add7d049a247a7d3599f282a`.

## Discovery method
Loaded `/home/loidinh/.omp/agent/commands/cmd-scout__ext.md`; native-tool fallback used. PR diff supplies all 226 paths, eliminating need for external re-discovery. `xd://lsp` status: no configured language servers. Scope via PR manifest, native read/glob/grep; no external scout completion claimed.

## Slices and interfaces
| Slice | Implementation | Boundary |
|---|---|---|
| Native read-only API | `server/src/git/blame.rs`, `commit_details.rs`, `types.rs`; `server/src/api/git_blame.rs`, `git.rs`, `router.rs`; `state.rs`, error modules | Project/worktree sandbox; HEAD snapshot; range/commit DTO; global semaphore |
| Owner/model lifecycle | `packages/ui/src/hooks/use-editor-git-blame.ts`; `lib/editor-git-blame.ts`; API client/transport/queries; editor store | Profile+generation, tab/model version, epochs, cancellation, ephemeral toggle |
| Gutter/reveal | Monaco/Markdown/HTML/EditorTabs; gutter/menu/row/layout/wheel modules; WorkspacePage/WorkspaceGitPanel/CommitDetailsPanel | Public Monaco geometry; typed target/root/OID reveal; read-only inspection |
| Qualification/docs | browser/E2E suites, Git fixture, evidence/review; docs and `.omp` scripts | Real app proof vs component assertions; human acceptance; portability |

## Existing conventions
- `docs/architecture/workbench-files-editor-and-git.md` already documents architecture; no redesign necessary for review.
- Existing feature plan: `plans/261005-2106-editor-git-blame-annotations/`; local modifications user-owned. Review plan uses separate directory.
- Native tests: `server/tests/git_blame_api.rs` plus inline modules.
- Frontend tests: hook/lib/panel unit suites; `browser-tests/editor-git-blame.browser.tsx`; full app `e2e/editor-git-blame/editor-git-blame.spec.ts`.
- E2E isolated production Rust server + built SPA + real Mongo; capture disabled for verification to preserve existing human-review artifacts.

## Unresolved questions
None for file discovery.
