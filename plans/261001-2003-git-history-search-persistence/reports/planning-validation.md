# Planning validation — Git history search and persistence

Status: plan complete; implementation pending. Date: 2026-10-01.

## User-confirmed decisions

Three decision topics plus one clarification:

1. Search commit subject and body, not subject only.
2. Git page restores its own initialized project-checkbox selection; Workspace changes do not replace it. Shared Workspace focus seeds first use only.
3. History branch selection is independent of checkout. Every explicit pick pins the branch, including current branch. External checkout changes do not change pinned history. Follow checked-out branch remains default before selection and explicit opt-in action.

[Final design contract](../design-contract.md) and affected phases incorporate all answers. No unanswered decisions; no implementation performed.

## Repository evidence and resolved research questions

- `server/src/git/repository.rs:1468–1552`: current `get_log` uses Git CLI, subject `%s`, validated revision and existing offset/count. Add conditional fixed-string grep; no git2 rewrite necessary.
- `server/src/api/git.rs:628–650`: actual DTO/handler names `GetLogQuery` / `get_log_route`; plan uses them. REST defaults 100/0; UI uses 200.
- `packages/ui/src/api/ws-transport.ts:517–537`: `git:log` invocation maps to REST GET; no server WS history handler required.
- UI history callers: `components/organisms/WorkspaceGitPanel.tsx:296` and `components/pages/GitPage.tsx:474`. Both explicitly migrated in Phases 05/06.
- `apps/native/src/main.tsx:17` uses shared `connectProfile`; `packages/ui/src/api/connections.ts:547` creates shared `WsTransport`. Native Git uses same REST mapping, not new Tauri Git command.
- `server/src/git/repository.rs:244–248`: `validate_revision` delegates to `repo.revparse_single`; search term added as one `--grep=` argument. Existing revision validator preserved; no inserting `--` before revision (would turn it into pathspec).
- `server/src/git/types.rs:152–160`: BranchInfo supplies name/isRemote/lastCommit, not canonical ref. Derive `refs/heads/...` vs `refs/remotes/...`; preserves local/remote name distinction.
- `workspace.ts:15–67`: selected qualified project already persisted. `project-target.ts:132–227` currently in-memory; broad worktree persistence explicitly excluded.
- `WorkspacePage.tsx:1951,2092,2158`: all three mounts currently pass target but not availability. Phase 05 assigns availability propagation to Workspace worker.
- Empty/unborn repository: source has no special empty handling; CLI errors propagate. Plan preserves existing behavior and calls for real compatibility fixture in implementation; no unsupported claim of successful empty-array response.
- Research alternatives are nonbinding: final field `messageQuery`, trimmed outer whitespace and single-line validation selected by parent. Report notices point workers to final contract.

## Executed planning checks

- Versions: Node `v24.16.0`; pnpm `10.28.2`; Git `2.55.0`.
- Read-only installed Git capability smoke:
  `git log --fixed-strings --regexp-ignore-case --grep=git --skip=0 --max-count=3 --format=%h:%s`
  returned `443b934c`, `a5d1020e`, `79f3134d` with matching Git-feature subjects. Only proves flag support/current repo filtering, not new API/UI behavior.
- Structural/link/frontmatter validation passed for 13 planning documents and seven phases. Every phase has required sections in order; local linked targets resolve. Plan 68 lines; command overview 22 lines; research reports 64/37 lines (both under 150).
- Initial structural check caught Phase 07 validation commands as an extra level-two section. Corrected to level three; failed check rerun passed.
- `pnpm exec prettier --write 'plans/261001-2003-git-history-search-persistence/**/*.md'` exited 0 with no output. Post-command integrity verification passed for all 14 planning documents: seven ordered phase structures, every local link target exists, code fences balanced, required frontmatter present; implementation status pending.

## Workflow/runtime limits

- `/cmd-plan__hard` instructions loaded from global command file and followed directly; no native slash-dispatch tool exposed. Top-level synthesis retained by parent; two independent bounded research workers used.
- Planning, sequential-thinking, and frontend-development skills read directly. Repository conventions win over generic frontend skill's unrelated MUI/router examples.
- Local `.omp/` absent. Global `set-active-plan.cjs` invoked successfully as a command, but emitted warning: `EVCRATE_SESSION_ID not set - session state will not persist`. Plan files exist; automatic active-plan session tracking unavailable.
- LSP status: no configured language servers. During implementation use LSP references if configured, otherwise focused source references.

## Not executed / not claimed

No source implementation, server/API feature smoke, application browser walkthrough, build, unit/integration/browser suite, lint, native visual qualification, commit or push. Only planning documents and explicitly proposed architecture subsection changed. Phase 07 contains concrete future verification commands/scenarios; all implementation phases remain pending.

## Unresolved questions

None blocking. Runtime activation warning does not block the saved plan; refer to plan path explicitly when assigning implementation work.
