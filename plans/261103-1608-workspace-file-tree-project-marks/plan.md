---
title: "Workspace File Tree and Marked Projects Implementation Plan"
description: "Workspace-first files, canonical shared editor resources, explicit project marking, and project-gated Git."
status: pending
priority: P2
effort: 40h
branch: main
tags: [feature, frontend, backend, api, security]
created: 2026-11-03
plan_dir: plans/261103-1608-workspace-file-tree-project-marks
related_brainstorm: ../reports/brainstorm-261103-1552-workspace-file-tree-project-marks.md
related_scout: ../reports/scout-261103-1608-workspace-file-tree-project-marks.md
---

# Architecture & Execution Plan: Workspace File Tree and Marked Projects

Enables whole-workspace filesystem navigation independent of project registration, explicit "Mark as Project", dual Workspace/Projects view modes, and project-gated Git.

## Dependency Graph & Execution Strategy

```
Phase 01: Core Contracts & Workspace Authority (Sequential Prerequisite)
       │
       ├─────────────────────────────────┐
       ▼                                 ▼
Phase 02: Server APIs & Mark/Unmark   Phase 03: Client Core & Canonical Identity
(Parallel Group A - Backend)          (Parallel Group A - Frontend)
       │                                 │
       └────────────────┬────────────────┘
                        ▼
Phase 04: UI FileTree Dual Modes & Actions (Sequential Integration)
                        │
                        ▼
Phase 05: Qualification, Docs & Android Impacts (Sequential Final)
```

- **Phase 01 (8h):** Sequential prerequisite; freeze the contracts below and establish root/sandbox authority. Existing project/worktree authorization remains authoritative for Git.
- **Phase 02 (10h) & 03 (8h):** Parallel A; backend and client-core writers have disjoint ownership. Both consume Phase 01, not each other's unfinished files. No build/lint/test/formatter runs over the half-integrated group.
- **Phase 04 (8h):** One sequential integration owner, after both Parallel A terminal results. Migrate every affected web caller, including Monaco parking, intents, previews and Git entry points; no compatibility adapters.
- **Phase 05 (6h):** Sequential qualification and documentation. Main coordinator owns coherent verification and evidence; product defects return to the owning phase with downstream gates reopened, not ad-hoc concurrent repairs.
- Estimates are planning estimates, not deadlines. Phase statuses remain pending until actual execution evidence exists.

## Frozen Cross-Phase Contracts

- **Browse authority:** Only an explicitly configured, existing, canonical `workspace.root`, resolved relative to the selected config file, authorizes workspace browsing. Missing/invalid roots disable workspace access with actionable `UNCONFIGURED_WORKSPACE_ROOT`; no fallback to `workspace_dir`, config parent, HOME, CWD or a project. Reject roots equal to, inside, or containing sensitive daemon/config directories, including `~/.config/dam-hopper`; no override.
- **Targets:** JSON target is exactly `{ type: "workspace" }` or `{ type: "project", project, worktreePath? }`. REST uses explicit `targetType=workspace|project` plus project fields only for project targets; WS FS/body payloads use required nested `target`. Reject missing, ambiguous or mixed targets; `scope` selects search extent, never authorization. Preserve the existing WS `kind` envelope discriminator.
- **Canonical identity:** Authorized stat/read results provide `fileIdentity: { workspaceId, workspaceEpoch, canonicalPath }`. `workspaceId` identifies the selected server config/workspace; `workspaceEpoch` changes on workspace/root replacement (including same-path directory replacement), not ordinary mark/unmark or atomic file saves. Server normalizes path aliases/case per platform. Editable `documentKey = JSON.stringify(["file", profileId, workspaceId, workspaceEpoch, canonicalPath])`; access route, target generation and file version remain separate. Diff keys stay distinct. Never derive identity from client path concatenation or inode alone.
- **Write authority:** Capture target/config generation and root `directory_identity`; re-resolve authorization, containment, protected-root rules and identity at each commit through pinned/secure-path primitives. Fence delayed plain/encrypted writes, uploads, media capabilities and watches. Unmarking withdraws external access immediately; dirty buffers survive but cannot save through revoked routes.
- **Terminal/Git:** Explicit folder launch carries `target` and `cwd`; workspace CWD must be an existing canonical directory at or below its authorized root, rechecked immediately before spawn. No home fallback/reuse/cd for this action. Git remains registered-project/worktree only; workspace/unmarked requests fail server-side and UI shows “Mark as project to use Git”.
- **Protection/lifecycle:** Deny workspace-root mutation, marked-root/worktree mutation through aliases or ancestors (source and destination), and existing `.git` restrictions. Preserve lazy bounded watches/search, profile/connection isolation, and all user working-tree edits. Tree modes/marking never retarget live windows or terminate PTYs. Existing explicit active-workspace switching lifecycle is unchanged.

## File Ownership Matrix

Paths are literal project-relative files/directories; directories include descendants. Each phase's task fence is the exhaustive writable allowlist, not these abbreviated summaries. Same-file handoff is allowed only sequentially.

| Phase | Execution | Writable boundary / single owner |
|---|---|---|
| **01** | Sequential | Six named core files plus `server/tests/fs_workspace_target.rs` (seven files total); exhaustive paths in Phase 01. |
| **02** | Parallel A backend | `server/src/api/`, named server FS/config/authority integration files, `server/tests/api_workspace_fs.rs`. Never `packages/ui/` or plan files. |
| **03** | Parallel A client core | `packages/ui/src/api/`, named FS/encrypted/search hooks and their tests, editor store/tests, OS persistence/tests. Never `server/` or plan files. |
| **04** | Sequential integration | `packages/ui/src/`, restricted to affected FS/identity/marking consumers and tests; one integration owner after both parallel writers are terminal. |
| **05** | Sequential final | FilesApp integration test, scoped browser journey, qualification report and named docs/roadmap/changelog. No product-code ownership. |

No writable path in Phase 02 intersects Phase 03, including test and directory descendants. Unexpected required files trigger coordinator ownership amendment before writing; never silently extend an allowlist.

## Execution Gates & Review Disposition

- Phase DAG is `workspace-core-authority -> {workspace-server-files -> workspace-server-project-actions, workspace-client-transport -> workspace-editor-identity} -> workspace-os-integration -> workspace-tree-actions -> workspace-qualification -> workspace-documentation`. Parallel A branches must both finish before integration.
- Phase 01 freezes complete request/response/error fixtures before Parallel A. Phase 03 may implement those fixtures without waiting for server code; live interoperability is a Phase 04/05 gate, not a mocked success claim.
- Review corrected ambiguous targets/root overrides, incomplete identity and commit fencing, missing media/Monaco/intent ownership, omitted acceptance edges, unsupported test commands, and missing durable-task contracts. Original approved product direction is unchanged; `pending` is execution state, not withdrawal of that decision.
- Existing OS redesign is an architectural predecessor (see brainstorm), not proof of this feature or an extra parallel writer. Coordinator must serialize any live external work touching the allowlists, including existing user UI modifications.
- Planning review does not authorize implementation, hydrate task state, or assert build/test/visual success. Coordinator retains final validation/approval. Rollback restores only feature-owned changes/config snapshots after preserving dirty buffers and user edits; never reset the worktree.
- Unresolved product-design questions: none. Execution prerequisites: consume Phase 01's frozen contract, explicit safe root, and authorized isolated qualification fixtures.
## Linked Phase Specifications

1. [Phase 01: Core Contracts & Workspace Authority](./phase-01-core-contracts-and-workspace-authority.md)
2. [Phase 02: Server APIs & Mark/Unmark Endpoints](./phase-02-server-apis-and-mark-unmark.md)
3. [Phase 03: Client Core & Canonical Editor Identity](./phase-03-client-core-and-canonical-identity.md)
4. [Phase 04: UI FileTree Dual Modes & Context Actions](./phase-04-ui-filetree-dual-modes-and-actions.md)
5. [Phase 05: Qualification, Documentation & Android Impacts](./phase-05-qualification-docs-and-android-impacts.md)
