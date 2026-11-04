# Phase 02: Server APIs & Mark/Unmark Endpoints

**Status:** Pending execution; implementation/validation evidence required
**Execution Mode:** Parallel A backend; one owner, concurrent only with Phase 03
**Prerequisite:** `workspace-core-authority` complete and contract fixtures consumed
**Effort:** 10h
**Context:** [Overview](./plan.md), [Phase 01](./phase-01-core-contracts-and-workspace-authority.md), [scout](../reports/scout-261103-1608-workspace-file-tree-project-marks.md)

## 1. Objectives & Scope

1. **Complete FS target cutover:** Apply the frozen explicit target to existing routes/messages, preserving their actual registered names rather than inventing endpoints. Cover list/read/stat/write, create/rename/move/delete, search/search_paths, download/range reads, upload, encrypted put/save, tree subscriptions, image/video ticket issue/renew/consume. Keep auth, conflict/version limits, `.git` controls and cancellation.
2. **Canonical identity producer:** Authorized stat/read results, including WS/encrypted read metadata, return `fileIdentity: { workspaceId, workspaceEpoch, canonicalPath }` consistently across Workspace, nested Project and worktree aliases. Use server normalization, not client path joining. Atomic saves do not change logical identity; root replacement does. No persistent inode-only identity or route-specific document ID.
3. **Authority fencing:** Generalize existing `TargetBinding`, `revalidate_target_binding`, secure-path/pinned-directory commits and media leases for both targets. Capture current workspace/config authority, target generation, root `directory_identity` and path version. Re-resolve at plain/encrypted write, upload completion, mutate and ticket consumption. Reject replacement, symlink/parent swaps, workspace switch, revoked project or stale completion; no validation-then-unguarded async commit gap.
4. **Root protection:** Refuse source/destination operations that delete, move, rename or overwrite workspace root, marked roots/registered worktree roots, or their containing ancestors, even via workspace aliases. Preserve `.git` restrictions. Protect non-existing destinations by validating existing parents; never grant `force_git` implicitly.
5. **Search/watch lifecycle:** Workspace search traverses the authorized root, not configured-project federation; Project/Folder search remains explicitly targeted. Preserve result/file-size bounds, cancellation/truncation and lazy directory watches. Distinct workspace/project watcher keys; release on collapse/unsubscribe/disconnect. Reconfiguration invalidates old writes/watches/tickets, without changing canonical document identity on metadata-only mark/unmark.
6. **Mark / Unmark:** `POST /api/config/projects` and `DELETE /api/config/projects/:name` use the existing config authority and registry, not a second database.
   - Mark body `{ name, target, path, projectType?, tags? }`; `path` is target-relative. Re-resolve the selected folder and captured authority at action/commit time. Workspace context actions cannot smuggle an arbitrary external absolute path. Existing explicit external-project configuration remains supported by config management.
   - Require existing directory, valid name/schema/type; reuse supported project type defaults/inference (do not require needless setup). Reject duplicate names and canonical roots, accept distinct nested roots; treat retry/duplicate response consistently.
   - Under `workspace_context_guard`/existing config replacement serialization, reread latest disk state, mutate the selected config, validate candidate, atomically replace TOML, then reconcile and publish. Preserve unrelated project commands/tags/settings and concurrent accepted changes. Test invalid input, disk write failure and publication failure; never report success for unpersisted or unreconciled config.
   - Unmark removes only registration and its associated settings; no disk deletion, Git init, command execution, PTY disposal or active-workspace switch. Revoke external-target writes/tickets immediately; preserve in-root workspace access.
   - Register routes in `router.rs`; reconcile workspace sandbox on startup/reload/active workspace switch. Keep project/config access working when workspace browsing is disabled.
7. **Terminal Folder Launch:** Use frozen optional `target: FilesystemTargetRef` on terminal creation, not an alternative boolean flag. Explicit workspace target disallows mixed project/worktree fields; requires `cwd`, existing canonical directory at or below root (root itself allowed). Validate containment and identity/generation immediately before spawn; invalid/missing CWD fails without HOME fallback. Existing untargeted terminal policy and project/worktree containment remain unchanged.
8. **Git Direct API Gating:** All Git/Changes/Resolver direct paths still resolve a configured project and registered worktree. Reject workspace targets, unknown/unmarked project names and arbitrary repository paths, even if `.git` exists. Use frozen `UNKNOWN_PROJECT`/existing target errors consistently; UI CTA is not a security boundary. Marked non-repo returns the established no-repository result; no automatic `git init`.

## 2. File Ownership

The exact task allowlists below are exhaustive. The API directory is owned only for target propagation, config routes/reconciliation, folder terminal validation, Git denial and related in-module regression tests; unrelated handlers are out of scope.

- `server/src/api/`: FS/WS/protocol, image/video, router, config/workspace, terminal and Git entry-point integration.
- `server/src/fs/{mod.rs,sandbox.rs,mutate.rs,secure_path.rs,watcher.rs,ops.rs,upload.rs,enc_upload.rs,decrypt.rs,media_ticket.rs,image_ticket.rs,video_ticket.rs,error.rs}`: Generalize secure target commits/leases without duplicating the existing security machinery (literal paths in task fence).
- `server/src/state.rs`, `server/src/workspace_target.rs`, `server/src/config/replacement.rs`: Authority lifecycle/config serialization integration after Phase 01 ownership handoff.
- `server/tests/api_workspace_fs.rs`: Behavioral REST/WS/config/terminal/Git integration tests.

### Read-Only:

All `packages/ui/`, Android, plan files and unlisted server files. Phase 01 writer must be terminal before touching handed-off core files; Phase 03 owns no server paths.

## 3. Conflict Prevention & Invariants

- Never broaden access when target data is absent; no legacy FS adapter solely for Android.
- Avoid holding the FS mutex across `.await`; serialize config mutations with the existing lock order.
- Preserve existing working-tree changes; escalate additional writable paths before editing.
- Backend implementer authors tests but does not execute checks mid-flight. Main coordinator verifies after both Parallel A results and coherent integration.

## 4. Implementation Steps / Task Ownership

### workspace-server-files

1. Consume Phase 01 fixtures; update existing REST/WS serializers/resolvers and explicit rejection rules.
2. Produce canonical identities and generalize secure mutations, encrypted uploads/saves, ticket bindings and watcher resources.
3. Wire startup/config/workspace publication invalidation; distinguish logical workspace identity from revocable authority generations.
4. Author real API-path tests, with deterministic delayed-commit/root-replacement and symlink-parent-swap barriers. Assert destination bytes remain untouched after rejection, not only error text.

- [ ] <!-- evcrate-task:workspace-server-files --> Implement workspace FS transports, identity and commit-time security

### workspace-server-project-actions

1. Add registered mark/unmark routes using shared atomic config replacement; validate exact folder authority again inside serialization.
2. Update folder terminal CWD validation and all direct Git target gates; keep existing project/worktree behavior.
3. Cover concurrent mark vs config update, duplicate aliases/names, external-root unmark revocation and publication failure.

- [ ] <!-- evcrate-task:workspace-server-project-actions --> Implement project metadata lifecycle, terminal CWD and Git denial

```evcrate-tasks
[
  {
    "id": "workspace-server-files",
    "title": "Cut filesystem transports and secure capabilities over to explicit targets",
    "blocked_by": ["workspace-core-authority"],
    "allowed_files": ["server/src/api", "server/src/fs/mod.rs", "server/src/fs/sandbox.rs", "server/src/fs/mutate.rs", "server/src/fs/secure_path.rs", "server/src/fs/watcher.rs", "server/src/fs/ops.rs", "server/src/fs/upload.rs", "server/src/fs/enc_upload.rs", "server/src/fs/decrypt.rs", "server/src/fs/media_ticket.rs", "server/src/fs/image_ticket.rs", "server/src/fs/video_ticket.rs", "server/src/fs/error.rs", "server/src/state.rs", "server/src/workspace_target.rs", "server/tests/api_workspace_fs.rs"],
    "constraints": ["Only target-related API integration; no unrelated handler changes.", "No packages/ui, Android or plan writes; Phase 01 must be terminal before core-file handoff.", "Reuse pinned secure-path commits; verify directory identity and authority at commit, not only request start.", "No checks mid-flight; coordinator owns coherent verification."],
    "acceptance": ["Every FS read/write/watch/upload/media path supports an explicit workspace or project target and rejects ambiguity.", "Server canonical identities unify route aliases while separating profiles/workspace replacements and file versions.", "Stale delayed commits and capabilities cannot bypass root replacement, containment, project revocation or protected roots.", "Workspace search/watch stays bounded and lazy without project federation."],
    "verification": ["Coordinator runs cargo test --manifest-path server/Cargo.toml --test api_workspace_fs and existing secure-path/media/watch regressions after integration.", "Exercise plain and encrypted delayed writes/uploads plus media consumption after same-path root replacement and external project revocation; assert no bytes changed."]
  },
  {
    "id": "workspace-server-project-actions",
    "title": "Implement atomic marking, unmarking, folder terminal validation and direct Git denial",
    "blocked_by": ["workspace-server-files"],
    "allowed_files": ["server/src/api", "server/src/config/replacement.rs", "server/tests/api_workspace_fs.rs"],
    "constraints": ["One backend owner; sequential handoff from workspace-server-files.", "Use existing config serialization/reconciliation; no second project registry, git init, disk deletion or PTY disposal.", "Never write packages/ui or Android; no checks mid-flight."],
    "acceptance": ["Mark/unmark routes are registered, atomic, schema-valid and observable by another authorized client without losing concurrent config changes.", "Folder terminal accepts workspace root/in-root directories and rejects missing, escaped, stale or symlink-swapped CWD without HOME fallback.", "Direct unmarked/workspace Git requests fail; marked repositories work and marked non-repositories report no repository.", "Unmark revokes external access while preserving dirty data, bytes and running processes."],
    "verification": ["Coordinator runs registered-route config/terminal/Git cases in cargo test --manifest-path server/Cargo.toml --test api_workspace_fs.", "Record concurrent-update and persistence-failure outcomes; exercise terminal CWD and unmarked Git through direct server requests, not UI mocks."]
  }
]
```

## 5. Success Criteria / Failure / Rollback

All task acceptance plus Phase 01 root-failure cases must hold through actual registered REST/WS routes. A stale/invalid target never falls back to broader authority. Config write/publication failure returns a real error and keeps disk/runtime coherent through existing replacement recovery; do not invent rollback by overwriting a newer config. Failed qualification returns to this owner, reopening downstream gates before repair. Feature rollback preserves user edits, project metadata and running processes; no worktree reset.
