# Scout: Git Management Files

Date: 2026-05-16

## Backend Files

- `server/src/api/router.rs`: register new Git routes.
- `server/src/api/git.rs`: add route handlers for checkout, branch create, cherry-pick, reset.
- `server/src/api/git_diff.rs`: extend commit body with `amend`.
- `server/src/git/repository.rs`: add branch/history mutation functions.
- `server/src/git/diff.rs`: update commit implementation for amend or extract commit helper.
- `server/src/git/cli_fallback.rs`: reuse/expose validation and command helpers where appropriate.
- `server/src/git/types.rs`: add request/result structs if shared beyond API handlers.
- `server/src/git/mod.rs`: re-export new operations.
- `server/src/git/tests.rs`: add real temp-repo tests.

## Frontend Files

- `packages/web/src/api/client.ts`: add types and Git client methods.
- `packages/web/src/api/queries.ts`: add mutations and invalidate related query keys.
- `packages/web/src/api/ws-transport.ts`: map new transport actions to REST endpoints.
- `packages/web/src/components/organisms/WorkspaceGitPanel.tsx`: replace static branch text with shared control.
- `packages/web/src/components/organisms/GitLogTree.tsx`: add row context menu callbacks.
- `packages/web/src/components/organisms/FileTree.tsx`: add branch control in Explorer header.
- New likely component: `packages/web/src/components/organisms/GitBranchControl.tsx`.
- New likely dialogs: branch create, checkout dirty options, reset confirmation. Keep them compact and colocated if small.

## Test Commands

- `cd server && cargo test git::tests`
- `pnpm --filter @dam-hopper/web test`
- `pnpm build`
- `pnpm test`

## Unresolved Questions

None.
