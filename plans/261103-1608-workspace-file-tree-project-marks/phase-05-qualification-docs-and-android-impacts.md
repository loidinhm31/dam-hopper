# Phase 05: Qualification, Documentation & Android Impacts

**Status:** Pending execution; no qualification claimed by this plan
**Execution Mode:** Sequential final phase; coordinator owns coherent verification/evidence, then one docs owner
**Prerequisites:** Both Parallel A branches and Phase 04 complete; `workspace-tree-actions` is the immediate dependency
**Effort:** 6h
**Context:** [Overview](./plan.md), [brainstorm acceptance](../reports/brainstorm-261103-1552-workspace-file-tree-project-marks.md#acceptance-and-validation), [Phase 04](./phase-04-ui-filetree-dual-modes-and-actions.md)

## 1. Qualification Matrix

Use temporary isolated roots/config/profiles and controlled local server/browser sessions; never real credentials, repositories or destructive operations in the user's workspace. Keep existing fixture/safety conventions. Fixture cleanup is part of the exercised scenario, not product recovery.

| # | Required behavior / observable result | Lowest reliable evidence plus full-app journey |
|---|---|---|
| 1 | Zero-project workspace: browse nested folders, create/read/edit/save/rename/delete, folder search and new terminal at displayed CWD; root CWD allowed. | Real FS/terminal routes plus actual Files/Editor/Search/terminal UI. |
| 2 | Mark from folder; badge/roots update and persist after restart/reload; another authorized client sees change. | Real atomic config API, disk inspection in fixture, two-client refresh. |
| 3 | Existing configured projects are already marked; canonical aliases/duplicate names rejected; nested roots accepted. No command/Git init or unrelated settings loss. | Config concurrency/duplicate tests and folder actions. |
| 4 | All/one-project views, empty return action, external labels, independent windows/modes and reload restoration. Stale filter does not select another project. | Persistence/component tests and two real Files windows. |
| 5 | Workspace/project/nested-project aliases share one model, dirty content, undo and save-version boundary, including simultaneous opens and atomic save replacement. | Store races plus real Monaco URI/parking/claim/focus and edit/undo/save flow. |
| 6 | Unmarked and workspace Git direct requests fail; marked repository works; marked non-repo says No repository. | Direct server API denial, then actual Git CTA and marked UI. |
| 7 | Browsing/marking/filtering/default changes never retarget Git/Changes/Resolver or live terminal CWD; no PTY termination/duplicate creation. | Capture exact target/session identities before and after real actions. |
| 8 | Unmark removes registration only; dirty buffers/processes/files remain. Project-only windows unavailable; external saves/tickets denied, in-root explicit Workspace route still valid. | Server delayed revocation tests plus dirty editor and running-terminal journey. |
| 9 | Missing/implicit/unsafe roots fail closed with remediation; traversal, escaping symlinks, `.git`, root/marked-root/worktree ancestor mutation and source/destination overwrite rejected. Delayed plain/encrypted writes/uploads fail after root replacement/workspace switch/parent swap. | Deterministic server barriers and byte-level no-mutation assertions; actual error UI. |
| 10 | Same-name cross-profile/workspace paths, external roots and registered worktrees isolated. Late async completions and stale restored authority cannot bleed across owners. | Transport/store tests plus two profiles and same-path replacement scenarios. |
| 11 | Lazy child loading, bounded/truncated/cancelled search, watches released on collapse/mode/close/disconnect. No whole-workspace/project/Git crawl on initial load. | Resource/request instrumentation in fixture and large-tree browser flow, not an invented numeric budget. |
| 12 | Full-app flow and fresh visual review: Files toolbar/tree/dialogs, empty/error states, search, editor and terminal; modal/Cognito input isolation preserved. | Actual screenshots reviewed at normal and compact viewport; record filenames and observations, not screenshot existence alone. |

## 2. Verification & Evidence Rules

1. Add meaningful FilesApp integration tests and a scoped real-server Playwright journey in the existing e2e structure. Mocked boundaries may cover narrow UI cases; they cannot replace real sandbox, terminal, Monaco or cross-client claims.
2. Main coordinator selects/runs checks only after coherent integration, using installed test principles and existing fixture conventions:
   - `cargo test --manifest-path server/Cargo.toml --test fs_workspace_target`
   - `cargo test --manifest-path server/Cargo.toml --test api_workspace_fs`
   - `pnpm --filter @dam-hopper/ui build`
   - `pnpm --filter @dam-hopper/ui test`
   - `pnpm --filter @dam-hopper/ui test:e2e:typecheck`
   - `pnpm --filter @dam-hopper/ui test:e2e -- e2e/os-workspace-files/workspace-files.spec.ts` with documented isolated real-server fixture setup.
   - `pnpm check` once for full web build/lint/server regressions; do not also rerun its component suites merely to duplicate evidence.
3. Record exact commands, exit codes, checks actually exercised, fixture prerequisites, screenshots/visual observations, failures/skips and untested platforms in `reports/qualification.md`. Environmental dependency failures (including MongoDB) remain blocked/unexecuted, never silently excluded or relabelled pass. No Android qualification.
4. Product defects do not authorize Phase 05 product edits: coordinator returns work to the owning earlier phase, serializes ownership, reopens affected downstream gates and collects fresh evidence before final acceptance. No verification against half-edited sources and no independent full-suite storms.
5. Readiness requires every matrix item and applicable required checks, plus no unresolved severe security/correctness finding. Unit success alone does not establish full-app qualification; retain a precise blocked gate if real-server/browser prerequisites are unavailable.

## 3. Documentation Deliverable

- `docs/system-architecture.md`: Root authority, explicit targets, server-normalized documents vs route authorization, epochs/commit fencing, lazy watches, mark/unmark/external revocation, unchanged active-workspace lifecycle.
- `docs/api-reference.md` and `docs/ws-protocol-guide.md`: Actual registered routes, explicit REST/body/WS target syntax, canonical identity DTOs, errors, plain/encrypted writes/uploads/media binding and folder terminal validation. Preserve the WS `kind` discriminator.
- `docs/configuration/index.md`: Explicit safe `[workspace] root`, config-relative resolution, upgrade guidance for old implicit `"."` installations, missing/dangerous-root remediation, and mark/unmark/schema/commands behavior.
- `docs/android-contract-impacts.md`: Actual finalized changes, not an assumed blanket incompatibility. Inventory list/read/stat/write/watch/search/upload/media/encrypted and terminal requests plus owner/workspace epoch handling; distinguish unchanged project-Git semantics. No Android adapters, implementation or qualification.
- `docs/CHANGELOG.md` and `docs/project-roadmap.md`: Feature and security behavior, configuration/contract migration and evidence-backed completion status. Do not mark an unqualified gate complete.
- Docs updates follow observed final implementation; if doc reconciliation reveals a contract change, reopen affected implementation and qualification before claiming completion.

## 4. Ownership / Durable Task Contract

Only the listed test/journey/report files and named docs may be edited. All product source and Android remain read-only. A test file under `packages/ui/src` is an explicit exception to the source freeze; there is no implicit qualification-repair exception.

### workspace-qualification

- [ ] <!-- evcrate-task:workspace-qualification --> Qualify all acceptance journeys with recorded coherent evidence

### workspace-documentation

- [ ] <!-- evcrate-task:workspace-documentation --> Publish accurate architecture/API/configuration and Android impact docs

```evcrate-tasks
[
  {
    "id": "workspace-qualification",
    "title": "Qualify workspace file and marked-project end-to-end behavior",
    "blocked_by": ["workspace-tree-actions"],
    "allowed_files": ["packages/ui/src/os/apps/FilesApp.test.tsx", "packages/ui/e2e/os-workspace-files/workspace-files.spec.ts", "plans/261103-1608-workspace-file-tree-project-marks/reports/qualification.md", "plans/261103-1608-workspace-file-tree-project-marks/reports/screenshots"],
    "constraints": ["Coordinator owns verification; no product/Android edits or competing suite execution.", "Use isolated safe real-server fixtures; preserve real credentials/user files/dirty buffers.", "Record failures, blocked prerequisites, skips and visual review honestly; no mocked full-app success."],
    "acceptance": ["All twelve qualification matrix cases have behavioral evidence, including real Monaco, direct server denial, root replacement and external revocation.", "Required compile/tests/smoke/visual gates pass with exact commands/results and no unresolved severe findings.", "Existing user UI modifications and unrelated behavior remain preserved."],
    "verification": ["Run the focused Rust tests, UI build/unit/e2e typecheck and scoped real-server browser journey listed above, then pnpm check once.", "Review actual screenshots at normal/compact viewports and record observations, resource bounds, lifecycle identities and any untested surfaces in reports/qualification.md."]
  },
  {
    "id": "workspace-documentation",
    "title": "Document authoritative contracts, migration, Android impacts and qualified status",
    "blocked_by": ["workspace-qualification"],
    "allowed_files": ["docs/system-architecture.md", "docs/api-reference.md", "docs/ws-protocol-guide.md", "docs/configuration/index.md", "docs/android-contract-impacts.md", "docs/CHANGELOG.md", "docs/project-roadmap.md"],
    "constraints": ["One docs owner after qualification; no product, Android, plan-state or Git finalization writes.", "Use finalized contracts and actual evidence, not obsolete plan examples or assumed Android compatibility."],
    "acceptance": ["Docs explain fail-closed root upgrade/remediation, explicit targets, canonical identity, write fences and mark/unmark lifecycle.", "Actual Android request impacts and unqualified platforms are clearly separated from completed web/server evidence.", "Changelog/roadmap reflect only evidence-backed implementation and qualification state."],
    "verification": ["Inspect documented request/response/errors and config examples against final code and qualification evidence.", "Check affected documentation links and migration examples; if material contract drift appears, reopen affected implementation/qualification instead of documenting a false pass."]
  }
]
```

## 5. Failure / Rollback

Unavailable fixtures/platforms and failed checks block the relevant gate; do not suppress tests or invent waivers. Any rollback is coordinator-scoped to feature-owned changes/config snapshots after preserving dirty buffers and user edits. No destructive Git commands, arbitrary config overwrite, Android changes or automatic commit/push.
