# Phase 03: Client Core & Canonical Editor Identity

**Status:** Pending execution; implementation/validation evidence required
**Execution Mode:** Parallel A client core; one owner, concurrent only with Phase 02
**Prerequisite:** `workspace-core-authority` complete; use its frozen fixtures, not unfinished server code
**Effort:** 8h
**Context:** [Overview](./plan.md), [Phase 01](./phase-01-core-contracts-and-workspace-authority.md), [scout](../reports/scout-261103-1608-workspace-file-tree-project-marks.md)

## 1. Objectives & Scope

1. **Explicit target contracts:** Define profile-owned `FsTargetRef` as Workspace or Project/worktree; project-only Git target remains separate. Wire projection is exactly the overview's `{ type: ... }` union. No implicit workspace fallback, sentinel `"global"` project, or legacy adapter. Migrate core API callers and tests together; Phase 04 migrates component/OS callers.
2. **Actual transport cutover:** Update `client.ts`, `ws-transport.ts`, `transport.ts`, `fs-types.ts`, queries/cache keys, video ticket helpers and FS/search/encrypted hooks, not just facade signatures. Apply required targets to REST query/body serialization, WS messages, encrypted puts/uploads, subscriptions, downloads and media ticket requests.
   - Distinguish route cache identity from editable document identity. Include profile, connection/current workspace authority and target in subscriptions/query keys; stale completions cannot update another target or workspace.
   - Retain bounds, cancellation and teardown on target changes; no broad workspace invalidations triggered by a different owner's updates.
   - Add typed mark/unmark methods matching Phase 02's frozen request/response, including folder target/path and action-time owner/authority.
   - Expose explicit folder terminal `{ target, cwd }` through client/transport while preserving untargeted terminal semantics.
3. **Server-normalized editor identity:** `fileIdentity: { workspaceId, workspaceEpoch, canonicalPath }` from authorized stat/read is the sole input to `JSON.stringify(["file", profileId, workspaceId, workspaceEpoch, canonicalPath])`.
   - Resolve identity before allocating an editable model; coalesce simultaneous route opens to the same canonical document, then share content, dirty/edit version, undo, save conflict boundary and save-in-flight state.
   - Access routes/breadcrumbs are separate from identity. Save uses the current explicit authorizing route and relative path; never reuse a canonical path as an authorization grant.
   - Atomic save replaces physical file/version without changing document identity. Target metadata/mark/unmark changes do not fork models; workspace/root replacement does invalidate authority. Never use inode-only keys or client-generated root concatenation.
   - Revoke stale project access after unmark. In-root buffers may acquire a freshly validated explicit Workspace route with unchanged canonical identity; external dirty buffers stay intact and unsavable until authorization is restored.
   - Keep diff keys/content separate; project-only blame/Git affordances require valid project targets. Do not force workspace files into fake project fields.
4. **Persisted-state migration:** Update editor persistence version, active keys/route metadata and OS allowlists. Preserve existing dirty content; if old route keys cannot yet be proven canonical, retain detached buffers until authorized revalidation rather than guessing identity, merging conflicting edits, silently dropping content or auto-saving.
   - Files appState persists bounded validated `mode`, `projectFilter`, per-mode expansion/selection/scroll state by window and exact owner/workspace.
   - Missing/stale filters remain visibly unavailable; never retarget to another arbitrary project. Restored authority tokens are not trusted; reacquire live authorization.
   - Do not change unrelated terminal, layout, profile or desktop state.

## 2. File Ownership

The literal task allowlists below are exhaustive:

- `packages/ui/src/api/`: Target DTOs, actual transport serialization, queries/cache identity, media helpers and corresponding tests; unrelated API domains are out of scope.
- FS subscription/operation/upload hooks and tests; encrypted-write and file-search hooks and tests.
- `packages/ui/src/stores/editor.ts`, `editor.test.ts`: Canonical resource/store migration, dirty-buffer preservation, route authorization.
- `packages/ui/src/os/persistence.ts`, `persistence.test.ts`: Allowlisted view-state and editor identity migration support.

### Read-Only:

All `server/`, Android, plan files and UI components/OS files other than persistence. Phase 04 owns MonacoKeepAliveHost, EditorApp, intents and all consumer integration; document exact interface handoff so they do not recreate route-based keys.

## 3. Conflict Prevention & Invariants

- ZERO writable overlap with Phase 02, including generated types/tests; no shared generated-code file.
- Preserve existing working-tree changes throughout `packages/ui`, not only the tree components.
- Existing project target types remain only where semantically project-specific; migrate all affected FS signatures/callers rather than retain compatibility overloads.
- Implementer authors tests, does not run checks mid-flight. Main coordinator verifies the coherent integrated result.

## 4. Implementation Steps / Task Ownership

### workspace-client-transport

1. Consume Phase 01 target/identity/errors/terminal fixtures; define explicit FS target and response types.
2. Update actual REST/WS transport and client commands end-to-end, including encrypted/media paths and typed mark/unmark.
3. Migrate query keys, search/FS hooks and owner/current-authority completion checks; retain lazy subscription teardown.
4. Author serialization/rejection/isolation/cancellation tests. Contract fixtures support development, not a claim of live backend interoperability.

- [ ] <!-- evcrate-task:workspace-client-transport --> Implement complete client target transport and scoped caches

### workspace-editor-identity

1. Replace route-based file keys with server-normalized document identity; preserve distinct diffs.
2. Update editor state, save route selection/conflicts and persistence migration; protect dirty buffers when identity/authorization is unresolved.
3. Extend per-window Files persistence; define identity-before-Monaco handoff consumed by Phase 04.
4. Author concurrent alias-open, nested project, atomic-save, external-unmark, cross-owner/workspace and dirty-persistence regressions.

- [ ] <!-- evcrate-task:workspace-editor-identity --> Implement canonical document state and safe persistence migration

```evcrate-tasks
[
  {
    "id": "workspace-client-transport",
    "title": "Migrate client transports, FS hooks and caches to explicit targets",
    "blocked_by": ["workspace-core-authority"],
    "allowed_files": ["packages/ui/src/api", "packages/ui/src/hooks/use-fs-subscription.ts", "packages/ui/src/hooks/use-fs-subscription.test.tsx", "packages/ui/src/hooks/use-fs-ops.ts", "packages/ui/src/hooks/use-fs-ops.test.tsx", "packages/ui/src/hooks/use-fs-upload.ts", "packages/ui/src/hooks/use-fs-upload.test.tsx", "packages/ui/src/hooks/use-encrypted-write.ts", "packages/ui/src/hooks/use-encrypted-write.test.tsx", "packages/ui/src/hooks/use-file-search.ts", "packages/ui/src/hooks/use-file-search.test.tsx"],
    "constraints": ["Only FS/target-related API changes; never server, Android, plan or UI component writes.", "Consume Phase 01 fixtures without depending on Phase 02 unfinished sources.", "No compatibility overloads or implicit workspace/default-owner fallback.", "Preserve user edits; no checks mid-flight."],
    "acceptance": ["Actual REST/WS/encrypted/media serialization carries explicit targets and consumes frozen canonical identity/error DTOs.", "Queries/watches/async completions stay isolated by profile, current connection/workspace authority and access target.", "Typed mark/unmark and folder terminal requests match frozen server contracts; subscriptions release on target changes."],
    "verification": ["Coordinator runs applicable ownership/transport/query/FS hook unit tests and pnpm --filter @dam-hopper/ui build after integration.", "Exercise real client-to-server Workspace and Project REST/WS requests in Phase 04/05; fixture tests alone do not prove interoperability."]
  },
  {
    "id": "workspace-editor-identity",
    "title": "Separate canonical editable documents from routes and migrate persisted state",
    "blocked_by": ["workspace-client-transport"],
    "allowed_files": ["packages/ui/src/stores/editor.ts", "packages/ui/src/stores/editor.test.ts", "packages/ui/src/os/persistence.ts", "packages/ui/src/os/persistence.test.ts"],
    "constraints": ["Use server-normalized owner/workspace-qualified identities; physical versions and route authority are separate.", "Keep dirty buffers on unmark, reconnect and persistence migration; no silent conflict merge or auto-save.", "Monaco host and app consumer integration is Phase 04, not concurrent edits.", "No server/Android/plan writes or mid-flight checks."],
    "acceptance": ["Concurrent Workspace/Project/nested-project aliases share one dirty document and save boundary; atomic saves do not fork identity.", "External project revocation preserves dirty content but denies saves; replacement workspace/root does not inherit old authority.", "Diff identities stay separate; stale persisted filters and detached legacy buffers never retarget arbitrarily.", "Files mode/filter/expansion/selection/scroll restore independently per window within validated owner/workspace scope."],
    "verification": ["Coordinator runs editor and OS persistence tests plus integrated UI typecheck after Phase 04 caller migration.", "Real Monaco alias-open/undo/save and unmark flows are required in Phase 05, not inferred from store tests."]
  }
]
```

## 5. Success Criteria / Failure / Rollback

All task acceptance must hold. A failed canonical lookup creates no provisional editable route model; surface the error while retaining existing dirty documents. Mark/unmark refreshes registration and route availability without rebuilding document identity. Rollback preserves raw persisted/dirty data before reverting only feature-owned state changes; never clear localStorage broadly or erase user buffers to make a migration pass.
