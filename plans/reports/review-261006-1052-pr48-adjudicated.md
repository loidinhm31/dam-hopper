# PR48 Adjudicated Review

## Verdict
**Request changes before merge.** Reviewed exact PR HEAD `9c74aaeeb5efe2e1b4f17878ac0b4933c1854fd4`. Review/plan task only: no product changes, PR comments, commits or pushes. Original local plan edits preserved.

## Team and evidence
- Two parallel `researcher` agents using `@smol`.
- Four parallel `code-reviewer` agents using `@smol`: native API, lifecycle, gutter/reveal, qualification/docs.
- Bounded `planner` native phase plus `docs-manager` contract/qualification phase using `@smol`; parent owns architecture decisions, final plan and verification.
- Loaded research, planning, code-review, web-testing skills directly. Native PR-manifest discovery replaces redundant external scout; [source map](./scout-261006-1052-pr48-code-map.md).
- Parent adjudicates worker output; worker severities/suggested scope reductions are not authoritative. [Fresh runtime evidence](./verification-261006-1052-pr48-review.md).

## Accepted findings
| Priority | Finding / exact location | Evidence / minimal decision |
|---|---|---|
| P1 | Baseline bounds and binary guards skipped for staged rename; direct path allocates blob before size guard. `server/src/git/blame.rs:194-225,249-258` | Live oversized original413/rename200; binary original415/rename200. Validate resolved baseline uniformly; ODB header before allocation. |
| P2 | Roots continuations publish after disable/identity change. `packages/ui/src/hooks/use-editor-git-blame.ts:382-422` | Throwaway hook scenario ready → pending refresh → disabled off → old reject → unavailable. Fence captured owner/tab/target/epoch on success and catch. |
| P2 | Wrong Monaco enum queried for line height. `packages/ui/src/lib/editor-git-blame-gutter-layout.ts:64-73` | Installed lineHeight75 vs fallback66glyphMargin; real row height16.5px, Monaco19px, invalid inline styles. Use typed public enum, not new magic number. |
| P2 | Missing promised committed-row left-click reveal. `packages/ui/src/components/molecules/EditorGitBlameRow.tsx:66-108`; `docs/CHANGELOG.md:7` | Production app left click focuses only; Enter reveals. Implement same committed/root guard on click. Original design menu/Enter emphasis noted; do not silently change published promise. |
| P2 | Git tree symlinks admitted when disk entry missing. `server/src/git/blame.rs:125-133,195-218` | HEAD symlink then unlink disk: live200ready target-string blame. Check baseline entry mode, including rename origins. No filesystem secret read demonstrated. |
| P2 | 64-hex exact OID advertised but unsupported by installed binding. `server/src/git/commit_details.rs:15-28`; `docs/CHANGELOG.md:4` | Live400 parser `too long`; git2 0.19 fixed SHA-1 Oid. Implement advertised capability with safe real mechanism, or explicit product approval to restrict contract. |
| P2 | Email tooltip promise absent from wire/UI. `docs/CHANGELOG.md:6`; `server/src/git/blame.rs:321-327` | DTO emits name/time/timezone/hash/subject, no email. Complete advertised field/UI, or explicitly approved documentation narrowing. |
| P2 | Dirty E2E assertion can pass using pre-existing row. `packages/ui/e2e/editor-git-blame/editor-git-blame.spec.ts:85-87` | Clean production fixture already has Uncommitted row5; selector first() never identifies dirty row6. Assert transition of edited line and retained neighbors. |
| P2 | Machine-specific committed script symlink. `.omp/evcrate/scripts/worktree.cjs:1` | PR diff mode120000 points `/home/loidinh/.omp/agent/evcrate/scripts/worktree.cjs`; not portable. Remove accidental artifact or use existing portable convention; no shim. |
| Gate | Visual acceptance timestamp inconsistent; human approval not established by this session. `packages/ui/e2e/editor-git-blame/review.md:3-7` | ReviewedAt10:25Z later than actual verification03:59Z. Confirm timezone and explicit operator acceptance; don't infer fabrication, rewrite someone's approval, or treat automation as human. |

## Additional static risks — not runtime-confirmed merge defects
- `[INFERENCE]` Early native uncommitted/unborn returns bypass final HEAD comparison. Revalidate before publication; deterministic race test only if existing seam feasible.
- `[INFERENCE]` Hook key transition can retain old data while status loading; context menu consumes data independently of status. Need same-mounted-host reproduction to distinguish actual model-change clearing.
- `[INFERENCE]` Same-HEAD index rename refresh suppression and cross-profile project-name query invalidation. Existing code demonstrates predicates; reproduce consumer effects before broader event changes.
- Raw lone-CR API collapses line boundaries; live confirmed, Monaco normalization reduces UI impact. P3 follow existing buffer contract, no unrelated parser project.

## Rejected / corrected worker claims
- No evidence of critical exploit in64hex rejection or absolute path disclosure. Ranked contract/portability defects, not critical security vulnerabilities.
- `docs/CHANGELOG.md` read footer has709lines; worker1022LOC/800limit finding false. No archive restoration planned.
- Doc validator explicitly says nonblocking; no requirement for new anchor validator or CI gate. Fresh run found zero checked file-link failures.
- Human acceptance cannot be disproved from a markdown label alone. Future timestamp is observed inconsistency, not proof of fabricated review.
- No generic roving-focus redesign, retry framework, library upgrade or incidental whitespace cleanup required.

## Unresolved questions
1. Is advertised SHA-256/email/row-click behavior required as published, or will product explicitly approve a narrower contract? Plan preserves scope by default.
2. Has the operator approved the five existing visual checkpoints, and what is the correct review timestamp/timezone?
