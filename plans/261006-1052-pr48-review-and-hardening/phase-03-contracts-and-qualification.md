# Phase 03 — Contracts and Qualification

## Context links
- [User approval receipt](../reports/approval-261006-1227-pr48-hardening.json)
- [Parent adjudication](../reports/adjudication-261006-1226-pr48-hardening.md)
- [Code review report](../reports/code-reviewer-261006-1216-pr48-hardening.md)
- [Verification report](../reports/verification-261006-1205-pr48-hardening.md)
- [Source byte receipt](../reports/source-261006-1226-pr48-hardening.json)
- [HTTP scenarios](../reports/http-261006-1201-pr48-hardening.json)
- [Visual review record](../../packages/ui/e2e/editor-git-blame/review.md)
- [Git API](../../docs/api/git.md), [changelog](../../docs/CHANGELOG.md)
## Overview
- Date: 2026-10-06. Priority: P2. Status: completed; API/DTO, real SHA-256 inspection, production E2E and explicit human visual acceptance qualified. Scoped commit authorized; no push.
- All three advertised scopes (SHA-256 inspection, email/committer metadata, and row-click affordance) delivered without narrowing.
- No library-wide upgrade, doc reorganization, new validator or generic fallback framework.
## Key Insights
- Exact 64-hex SHA-256 commit details, file lists, and historical diff inspection implemented via bounded read-only Git CLI (`cli_fallback.rs` conventions) without library overhaul.
- Supporting SHA-256 read scope: root discovery, repository status, log, commit details, changed files, and historical diffs function in HTTP and real production Workspace Git. Native blame, branch discovery, and mutations remain libgit2/SHA-1; branch UI exhibits waiting state in SHA-256 repositories while read inspection succeeds.
- Author and committer email and timezone offsets (+0700, -0530) implemented end-to-end from native Git signature through Serde camelCase DTOs to UI tooltip and commit details panel.
- Dirty buffer E2E verified: newly typed row 6 transitions to Uncommitted while neighboring Alice and Bob rows retain committed attribution. Mouse click, Enter, and context menu all reveal exact commits.
- Host-specific symlink artifact `.omp/evcrate/scripts/worktree.cjs` removed cleanly.
- Human visual review: session operator inspected all five fresh checkpoints in run `e2e-run-1791264287476-0b473ba8` and granted explicit acceptance at 2026-10-06T05:34:16.946Z.
## Requirements
- Exact commit inspection works for promised OID formats, or user explicitly approves documented capability narrowing.
- Published email/metadata behavior implemented end-to-end, or explicit user-approved claim correction.
- E2E verifies edited-line attribution transition, retained neighbors, and real mouse/Enter/menu reveal paths.
- Tooling contains no accidental host-specific script symlink.
- Human review record remains attributable to actual operator, artifacts, source fingerprint and actual review time.

## Architecture
- SHA-1 retains current fast libgit2 path. Candidate SHA-256 path: bounded read-only Git CLI using existing `server/src/git/cli_fallback.rs` conventions, not a new abstraction.
- Feasibility prerequisite: inspect root discovery, status, commit files and historical diff paths for SHA-256 repositories. An endpoint-only parser is not full Workspace Git support.
- Validate exact OID, object type and size; bound actual stdout, not only trust a prior size subprocess. Use argument arrays, existing error mapping and sandboxed target/root.
- Email flows native Signature → Serde camelCase DTO → typed client validation → escaped tooltip/details. No synthetic metadata.
- Keep existing E2E fixture and capture governance. Assistant/browser checks do not grant operator approval.

## Related code files
- Modify `server/src/git/commit_details.rs`, `types.rs`, `blame.rs`; inspect existing `cli_fallback.rs`, VCS root and read-only file/diff routes before changing SHA-256 behavior.
- Modify `packages/ui/src/api/client.ts`, blame response validation, layout metadata, `CommitDetailsPanel.tsx`; migrate all DTO fixtures/callers.
- Modify existing API/browser/E2E behavior tests, `e2e/editor-git-blame/editor-git-blame.spec.ts`; fixture changes only as needed.
- Remove accidental `.omp/evcrate/scripts/worktree.cjs` artifact, or track required helper using existing portable convention; no compatibility shim.
- Update existing Git API/architecture/changelog and PR description only once actual behavior/approved scope established. Human record edited only with attributable information.

## Implementation Steps
1. Preserve scope by default: establish real SHA-256 fixture and trace root/details/files/diff inspection. Document any prerequisite not reachable through current binding.
2. Implement bounded exact-OID read-only CLI support if feasible through existing patterns. If product approves SHA-1-only instead, restrict and document it consistently; do not retain misleading64hex validation.
3. Wire author email through native DTOs, client validation, hover/focus metadata and commit details. Fulfill published committer metadata or obtain explicit approval to correct that claim.
4. Update broken DTO fixtures; test actual metadata content/timezone and detached/outside-pagination commit inspection, not copies or mock echoes.
5. Change dirty journey to identify typed line or edit a previously committed row and verify committed→Uncommitted while neighbors retain correct commits. Do not assert merely count growth.
6. Verify mouse click, Enter and menu open exact OID; Uncommitted rows never reveal; inspect mode remains read-only and dirty buffer survives.
7. Remove nonportable symlink; inspect existing consumers before choosing removal versus portable real script.
8. Run targeted API/UI/browser/E2E checks and actual app smoke after all edits settle. Capture fresh artifacts according to policy; obtain actual operator review.
9. Resolve review timestamp with operator/source evidence. Do not substitute parent03:59Z, assume local10:25 conversion, or overwrite recorded ACCEPTED as though disproven. If sign-off cannot be verified, mark merge qualification unresolved in reports.

## Todo list
- [x] Establish complete SHA-256 feasibility or explicit narrower-contract approval.
- [x] Implement advertised email/metadata or approved claim correction.
- [x] Strengthen dirty attribution and reveal behavior assertions.
- [x] Remove host-specific tooling artifact.
- [x] Run final qualification and capture fresh visual evidence.
- [x] Obtain attributable operator sign-off and correct timestamp.

## Success Criteria
- Real64hex commit details and supporting inspection surface work, or all narrowed claims match explicit approval.
- Email/metadata visible as promised; missing/non-UTF8 metadata handled using current native conventions.
- Dirty E2E fails if only pre-existing terminal row is Uncommitted.
- New configured line heights and mouse reveal work in actual application.
- Existing inspect mode exposes no mutation controls; target/profile/root remain qualified.
- Human visual evidence is traceable; automation never synthesizes acceptance.

## Risk Assessment
- Git executable support for SHA-256 and existing libgit2 root/status assumptions need runtime proof. Never claim endpoint-only fallback finishes surface support.
- Metadata DTO changes require every caller/fixture migration; no deprecated parallel DTO.
- Capture-disabled checks verify assertions, not human acceptance or refreshed visual review.

## Security Considerations
- Strict full OIDs prevent revision-expression/option input; no shell interpolation, ref mutation, network fetch, or ambient repository fallback.
- Object header checks plus bounded stdout constrain reads; preserve existing auth and project/worktree sandbox.
- Names/emails/messages remain React-escaped text. Never render as HTML or overwrite private operator credentials.

## Next steps
Completed. All three phases approved by session operator. Verification, independent code review (9.8/10), parent adjudication, and human visual acceptance recorded. Scoped commit pending parent execution; push unauthorized.

## Unresolved questions
1. Preserve published SHA-256/email/committer metadata scope, or explicitly approve narrower contract? — CLOSED: All three scopes delivered without narrowing. Bounded SHA-256 read inspection (details, files, historical diffs), author/committer emails, and timezone offsets delivered end-to-end.
2. Has operator inspected existing five checkpoints, and what actual review time/timezone should record? — CLOSED: Session operator inspected all five fresh checkpoints (`normal-author-date.png`, `uncommitted-buffer.png`, `gutter-context-menu.png`, `workspace-git-full-body.png`, `compact-author-only.png`) in capture run `e2e-run-1791264287476-0b473ba8`, accepted at `2026-10-06T05:34:16.946Z`, recorded in `plans/reports/approval-261006-1227-pr48-hardening.json` and `packages/ui/e2e/editor-git-blame/review.md` (ACCEPTED). Historical visual records preserved under `reports/prior-visual-evidence/`.
