---
title: "PR48 review and targeted hardening"
description: "Resolve verified baseline guards, editor lifecycle/geometry defects, and published contract gaps before merge."
status: completed
priority: P1
issue: 48
branch: feat/editor-git-blame-annotations
tags: [bugfix, backend, frontend, api]
created: 2026-10-06
---

# PR48 Review and Targeted Hardening

## Decision
User explicitly approved all three phases together, confirmed inspection and acceptance of all five fresh captures, and authorized a scoped commit. Implementation, qualification, code review (terminal 9.8/10, zero must-fix) and human visual acceptance are complete across all three phases. Commit authorization is recorded in the approval receipt; push remains unauthorized.
Reviewed HEAD `9c74aaeeb5efe2e1b4f17878ac0b4933c1854fd4`, base `9e727b4bee3b8634add7d049a247a7d3599f282a`.

## Phases
| Phase | Priority | Status / progress | Detail |
|---|---|---|---|
| Native baseline safety | P1 | Completed / verified in native regression (195 pass) and live HTTP (17 scenarios) | [Phase01](./phase-01-native-baseline-safety.md) |
| Owner lifecycle and gutter | P2 | Completed / verified in Vitest (182 scoped, 21 focused post-cleanup) and real Monaco browser (3/3) | [Phase02](./phase-02-owner-lifecycle-and-gutter.md) |
| Contracts and qualification | P2 | Completed / SHA-256 reads, email/committer metadata, human visual acceptance obtained | [Phase03](./phase-03-contracts-and-qualification.md) |
## Evidence
- [User approval receipt](../reports/approval-261006-1227-pr48-hardening.json): explicit session operator approval for all three phases and scoped commit; accepted all five checkpoints at 2026-10-06T05:34:16.946Z.
- [Parent adjudication](../reports/adjudication-261006-1226-pr48-hardening.md): accepted 9.8/10 code review, verified dead geometry fallback removal, acknowledged resource bounds and EOL/SHA-256 limits.
- [Code review](../reports/code-reviewer-261006-1216-pr48-hardening.md): independent code review score 9.8/10, zero must-fix issues, two warnings, approved for final integration.
- [Qualification verification](../reports/verification-261006-1205-pr48-hardening.md): native 177+18 pass, UI 182 pass, post-cleanup 21 pass, real Monaco 3/3 (20px -> 31px), live HTTP 17 scenarios, forced container build & E2E 1/1 pass.
- [Visual review record](../../packages/ui/e2e/editor-git-blame/review.md): status ACCEPTED by session operator for capture run `e2e-run-1791264287476-0b473ba8`.
- [Source byte receipt](../reports/source-261006-1226-pr48-hardening.json): exact byte provenance for 20 reviewed source/test files.
- [HTTP scenarios](../reports/http-261006-1201-pr48-hardening.json): 17 live requests confirming bounds, symlink rejection, metadata offsets, and repository immutability.
- [Code map](../reports/scout-261006-1052-pr48-code-map.md): complete PR manifest and existing subsystem boundaries.
- [Native research](../reports/researcher-261006-1052-pr48-native-blame.md), [frontend research](../reports/researcher-261006-1052-pr48-editor-lifecycle.md).
- Architecture: [workbench/files/editor/Git](../../docs/architecture/workbench-files-editor-and-git.md); no framework or structural overhaul introduced.

## Coordination
- Two smol researchers; four parallel smol code reviewers; bounded smol planner and docs-manager phase drafts.
- Parent adjudicates evidence and owns integration. Native and lifecycle implementations can run independently, with explicit file ownership; contract DTO work owns shared types/client files.
- After edits settle: one verification pass, actual app/API smoke, independent review. Repeat only for new defects/fixes; no ungrounded all-green claims.
- Current implementation: three smol workers own lifecycle, gutter/metadata UI, and SHA-256 read surface; parent owns native guards, regression/application scenarios, provenance preservation and integration.

## Constraints
- KISS/YAGNI/DRY: repair existing modules; no framework upgrade, generic retries, periodic polling, unnecessary abstraction or broad documentation restructure.
- Preserve owner/generation/target/root qualification, exact OID inspection, dirty buffers, read-only Git and ephemeral persistence.
- Advertised SHA-256, email and row-click scope is not silently removed; narrower contract requires explicit product approval.
- Human visual approval cannot be replaced by automation. Existing evidence preserved.
- This run changes authorized product code, qualification artifacts and tracking. One scoped commit is authorized; no push or remote PR mutation.

## Original implementation directive
Implement all three phases in this run. Native and lifecycle/UI slices execute independently; shared DTO work owns Rust/client types. Qualify exact read surfaces, real HTTP immutability, editor lifecycle/geometry and fresh application captures before review approval.

## Unresolved questions
1. Operator visual acceptance of fresh captures — CLOSED: Session operator inspected all five checkpoints (`normal-author-date.png`, `uncommitted-buffer.png`, `gutter-context-menu.png`, `workspace-git-full-body.png`, `compact-author-only.png`) in capture run `e2e-run-1791264287476-0b473ba8`, accepted at `2026-10-06T05:34:16.946Z`, recorded in `plans/reports/approval-261006-1227-pr48-hardening.json` and `packages/ui/e2e/editor-git-blame/review.md` (ACCEPTED). Historical visual records preserved under `reports/prior-visual-evidence/`.
2. Review/finalization/commit authorization — CLOSED: Explicit user approval granted for all three phases and one scoped commit. Push remains unauthorized.
