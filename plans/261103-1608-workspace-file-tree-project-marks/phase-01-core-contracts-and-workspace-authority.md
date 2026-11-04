# Phase 01: Core Contracts & Workspace Authority

**Status:** Pending execution; implementation/validation evidence required
**Execution Mode:** Sequential prerequisite; one owner
**Effort:** 8h
**Context:** [Overview and frozen contracts](./plan.md), [brainstorm](../reports/brainstorm-261103-1552-workspace-file-tree-project-marks.md), [scout](../reports/scout-261103-1608-workspace-file-tree-project-marks.md)

## 1. Objectives & Frozen Contracts

1. **Frozen Wire Target Schemas:**
   - REST and WS target discrimination:
     - `ProjectTarget`: `{ type: "project", project: String, worktreePath?: Option<String> }`
     - `WorkspaceTarget`: `{ type: "workspace" }`
   - REST: explicit `targetType=workspace|project`; only project targets carry `project`/`worktreePath`. Required nested `target` on WS FS and JSON body requests. Reject omitted, conflicting or unknown targets; never interpret missing project as workspace. `scope` is not a target alias; keep WS `kind` envelope.
   - Frozen error codes:
     - `UNCONFIGURED_WORKSPACE_ROOT` (403 / WS error): When workspace root cannot be safely authorized.
     - `PATH_ESCAPE` (400 / WS error): Directory traversal or symlink escape.
     - `MUTATION_REFUSED` (409 / WS error): Attempting to mutate workspace root or project root through parent.
     - `UNKNOWN_PROJECT` (404 / WS error): Project name not configured.
   - Extend errors for invalid/mixed targets (`INVALID_FS_TARGET`, 400) and stale authority (`STALE_FS_TARGET`, 409); map consistently on REST and WS without masking existing permission/conflict errors.
   - Freeze DTO examples for stat/read `fileIdentity: { workspaceId, workspaceEpoch, canonicalPath }`, target generation, write version/conflict responses and folder terminal `{ target, cwd }`; Phase 02 owns wire plumbing, Phase 03 consumes the identical fixtures.
2. **Authoritative Browse Root Resolution:**
   - Do NOT derive security authority from ambient `workspace_dir`, config parent, HOME, CWD or configured projects.
   - Resolve an explicitly supplied `workspace.root` relative to the selected config file; require an existing directory and canonicalize via the existing platform path helpers.
   - Preserve absence distinctly from the legacy implicit `"."` default. Missing/empty/non-directory/inaccessible roots disable workspace access, not all existing project/config services.
   - Reject roots equal to, inside, or containing sensitive daemon/config directories (`~/.config/dam-hopper`, actual daemon config/state paths, `/etc/dam-hopper`, `/var/lib/dam-hopper`); no override. Report actionable `UNCONFIGURED_WORKSPACE_ROOT` directing operators to configure a dedicated directory.
3. **First-Class Workspace Sandbox in `FsSubsystem` & `AppState`:**
   - Store `Option<WorkspaceSandbox>` separately from project roots; use `reinit_workspace_sandbox(Option<PathBuf>)` for authority refresh.
   - `WorkspaceSandbox` captures root `directory_identity`, generation, canonical containment and secure new-path checks; expose `check_identity`, root-mutation rejection and workspace tree subscription.
   - `AppState::workspace_sandbox()` fails closed when absent. `resolve_filesystem_target(&FilesystemTargetRef)` returns Workspace root or existing resolved Project/worktree authority; helpers expose `root_path`, `target_key`, `project`, `is_workspace`.
   - Specify separate stable logical workspace identity and replacement epoch, versus revocable target generation; mark/unmark must not create a second editable document.
   - Keep lazy per-directory watcher leases distinct from project leases; no fake/sentinel project identity that could collide with a real project.
4. **Mark / Unmark & Protected Root Rules (frozen semantics, Phase 02 integration):**
   - Reject duplicate canonical roots and project names using existing schema/platform comparison semantics; allow distinct nested projects and explicit external configured projects.
   - Workspace mutations cannot rename/delete/overwrite marked roots, authorized worktree roots, or ancestors containing them. Check source and destination; preserve `.git` controls. Commit-time enforcement belongs to Phase 02 secure mutation integration.
   - Unmark revokes project authority but preserves bytes/processes/dirty buffers. An in-root file may use a freshly validated explicit workspace route; external files remain unsavable until access is restored.

## 2. File Ownership

### Writable Files:
- `server/src/workspace_target.rs`: Define `FilesystemTargetRef`, `ResolvedFilesystemTarget`, resolution methods on `AppState`.
- `server/src/fs/sandbox.rs`: Enhance `WorkspaceSandbox` with root identity tracking, containment checks, and new path validation.
- `server/src/fs/mod.rs`: Integrate `Option<WorkspaceSandbox>` into `FsSubsystem`, add `reinit_workspace_sandbox`, and support workspace-targeted subscriptions.
- `server/src/config/schema.rs`: Preserve configured-vs-absent root intent; expose validated root resolution without changing the on-disk string format.
- `server/src/config/parser.rs`: Authoritatively resolve `workspace.root` and enforce security boundary checks.
- `server/src/state.rs`: Add `workspace_sandbox(&self) -> Result<WorkspaceSandbox, FsError>` helper to `AppState`.
- `server/tests/fs_workspace_target.rs`: Unit and integration tests for target resolution and sandbox enforcement.

### Read-Only Files:
- `server/src/fs/mutate.rs`
- `server/src/fs/secure_path.rs`
- `server/src/fs/ops.rs`

## 3. Conflict Prevention & Invariants

- Reuse existing project resolver/worktree authorization; migrate FS callers in later phases without Android-only shims. Do not widen Git authority.
- Never hold `FsSubsystem` inner Mutex across an `.await` boundary.
- Do not modify files in `server/src/api/` in this phase (owned by Phase 02).

## 4. Implementation Steps

1. Update `server/src/workspace_target.rs`:
   - Add enum `FilesystemTargetRef { Workspace, Project(ProjectTargetRef) }`.
   - Add `ResolvedFilesystemTarget` representing either a validated workspace root or resolved project target.
   - Implement `resolve_filesystem_target(&self, target_ref: &FilesystemTargetRef)`.
2. Update `server/src/config/schema.rs` & `server/src/config/parser.rs`:
   - Preserve whether `workspace.root` was explicitly configured; resolve it with `DamHopperConfig::resolve_workspace_root` and a typed root error.
   - Reject dangerous roots and aliases/ancestors; keep old project/config access operational when workspace browsing is disabled.
3. Update `server/src/fs/sandbox.rs` & `server/src/fs/mod.rs`:
   - Add `workspace_sandbox: Option<WorkspaceSandbox>` to `Inner` in `FsSubsystem`.
   - Provide `subscribe_workspace_tree`, identity/generation checks and root invalidation without eager recursive watching; retain existing project interfaces.
4. Update `server/src/state.rs`:
   - Expose `fs.workspace_sandbox()`.
5. Author tests in `server/tests/fs_workspace_target.rs`:
   - Cover missing/implicit root, explicit safe root, relative config resolution, non-directory/unreadable roots, dangerous root/parent/descendant/symlink aliases, traversal, missing-child parent validation, root replacement and workspace/project isolation.
6. Freeze request/response/error examples in this phase before releasing Parallel A; semantic contracts in `plan.md` are shared authority. Later transport changes must not silently reinterpret them.

## 5. Success Criteria & Verification

- Dedicated explicit root works with zero projects. Missing/unsafe roots fail closed with remediation and without exposing config files or disabling unrelated configured-project operations.
- Existing project/worktree resolution is unchanged. Workspace target cannot be inferred from missing/invalid project fields.
- `WorkspaceSandbox` rejects escapes and root mutation; an old sandbox detects same-path root replacement. Workspace watcher identities cannot collide with a same-named project.
- Verification owner runs `cargo test --manifest-path server/Cargo.toml --test fs_workspace_target` after the coherent group, plus resolver/config regressions; record actual pass/failure, not a coverage-percentage claim.

## 6. Durable Task Contract

### workspace-core-authority

- [ ] <!-- evcrate-task:workspace-core-authority --> Establish explicit root authority and freeze cross-layer contracts

```evcrate-tasks
[
  {
    "id": "workspace-core-authority",
    "title": "Establish workspace root authority and filesystem target contracts",
    "blocked_by": [],
    "allowed_files": ["server/src/workspace_target.rs", "server/src/fs/sandbox.rs", "server/src/fs/mod.rs", "server/src/config/schema.rs", "server/src/config/parser.rs", "server/src/state.rs", "server/tests/fs_workspace_target.rs"],
    "constraints": ["Only the seven listed files; API and client integration belong to later phases.", "Explicit safe root only; preserve configured-vs-absent intent and existing project authority.", "No build, lint, test or formatter runs by implementers mid-flight; hand checks to the coordinator.", "Preserve all pre-existing working-tree modifications; escalate any additional required writable path."],
    "acceptance": ["Safe explicit root authorizes zero-project browsing; absent and dangerous roots fail closed with actionable errors.", "Target, identity, error and terminal request semantics are frozen for both parallel consumers.", "Sandbox detects root replacement and rejects traversal, symlink escapes and workspace-root mutation."],
    "verification": ["Coordinator runs cargo test --manifest-path server/Cargo.toml --test fs_workspace_target and applicable config/resolver regressions.", "Inspect frozen request/response fixtures against overview semantics before releasing both Parallel A workers."]
  }
]
```

## 7. Failure / Rollback

Fail closed on unresolved or replaced roots; never fall back to config parent. Keep project/config management available for remediation. Revert only this feature's core changes if integration cannot consume the contract; preserve user edits and existing project configuration. No automatic config rewrite or project discovery.
