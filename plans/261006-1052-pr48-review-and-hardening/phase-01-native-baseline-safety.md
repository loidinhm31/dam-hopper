# Phase 01 — Native Baseline Safety

## Context links
- [User approval receipt](../reports/approval-261006-1227-pr48-hardening.json)
- [Parent adjudication](../reports/adjudication-261006-1226-pr48-hardening.md)
- [Code review report](../reports/code-reviewer-261006-1216-pr48-hardening.md)
- [Verification report](../reports/verification-261006-1205-pr48-hardening.md)
- [HTTP scenarios](../reports/http-261006-1201-pr48-hardening.json)
- [Git API](../../docs/api/git.md)
## Overview
- Date: 2026-10-06. Priority: P1. Status: completed; native verification (177 unit + 18 API/SHA-256) and live HTTP (17 scenarios) passed. User accepted all gates and authorized a scoped commit; no push.
- Scope: unified baseline validation and publication safety; existing read-only libgit2 architecture retained.

## Key Insights
- Live staged rename bypass: oversized original path 413 versus renamed 200; binary original 415 versus renamed 200. Unified in `server/src/git/blame.rs`.
- Direct path calls `find_blob` before checking size; rename origin previously bypassed all baseline checks. Resolved via common header-before-payload validation.
- Git symlinks are blobs with mode 0120000. Disk-only symlink check missed deleted working-copy entries; tree mode check rejects absent-disk symlink with 415.
- Revalidation of HEAD state before response publication protects against concurrent HEAD modifications without intrusive locking.
- EOL limits and attribution behavior:
  - Live observed limitation: a CRLF-committed baseline compared to an LF-normalized editor buffer returns all rows as Uncommitted because raw byte contents differ. This is an existing limitation documented during qualification; expanding blame to support EOL-insensitive history attribution was explicitly excluded from Phase 01 scope.
  - For an LF baseline, LF, CRLF, and lone-CR buffers correctly preserve commit attribution, author email, and row integrity across all display rows.
## Requirements
- Apply identical type/mode/size/binary checks to resolved direct and staged-rename baseline entries.
- Reject oversized objects before find_blob requests payload; do not claim libgit2 itself performs zero allocation or bounded total computation.
- Preserve current size threshold semantics unless shared contract explicitly changes.
- Reject HEAD symlink mode even when working-copy file absent; retain disk check.
- Revalidate captured HEAD state before every publication path.
- Keep working tree, index and refs unchanged; preserve existing permit ownership.

## Architecture
- Resolve baseline path as today, then validate its HEAD entry in one shared path before blame_file.
- Entry mode/type → ODB read_header size/type → bounded find_blob binary check → native blame → HEAD revalidation → response.
- Reuse commit_details.rs header-before-object pattern. No new framework, CLI fallback or DTO change in this phase.
- Do not unconditionally run whole-index rename detection for every existing HEAD path. Overwrite-rename behavior is unverified; reproduce and assess contract before changing lookup precedence.

## Related code files
- Modify `server/src/git/blame.rs` baseline validation/publication.
- Modify `server/tests/git_blame_api.rs` behavioral guard regressions; inline module only for distinct algorithm boundaries.
- Reference `server/src/git/commit_details.rs`, `git/types.rs`, `api/git_blame.rs`, `state.rs`, `git/vcs_roots.rs`.

## Implementation Steps
1. Reproduce oversized/binary staged rename and absent-disk symlink using existing real Git fixtures.
2. Move direct-only baseline checks into common resolved-entry validation; inspect ODB header before find_blob.
3. Reject symlink mode0120000 independently of blob kind, including rename origin.
4. Revalidate HEAD before early response publication, including unborn state transitions. Preserve existing error taxonomy.
5. Add one API regression scenario per guard behavior, checking actual HTTP status/code and repository immutability. Avoid duplicate unit/API copies of the same path.
6. If raw lone-CR correction remains in scope, normalize CRLF/loneCR in one output allocation, not chained replacements that duplicate compiled work. `alpha\rbeta\r` yields three Monaco display rows after LF normalization. Validate baseline attribution compatibility before promising more than line integrity.
7. Run targeted tests plus live HTTP smoke. Then update existing Git API/architecture/changelog guard descriptions.

## Todo list
- [x] Common baseline validation after origin resolution.
- [x] Header-before-payload size/type checks.
- [x] Git tree mode check for symlinks.
- [x] Revalidate all early publication paths.
- [x] Add distinct guard regressions and run live smoke.
## Success Criteria
- Renamed oversized file returns413; renamed binary returns415.
- HEAD symlink absent on disk returns415.
- Direct path and rename origin obey identical baseline constraints.
- Inspect HEAD/index/file digests before and after blame: unchanged.
- Existing LF/CRLF/dirty/staged normal rename semantics remain correct.
- Concurrent old revision cannot publish after observed HEAD change; no flaky sleep-loop test.

## Risk Assessment
- Header lookup avoids requesting full oversized payload here, not a universal total-memory guarantee. Rename similarity and history traversal remain library work.
- Lookup-precedence changes can add expensive whole-index work; avoid without verified overwrite-rename requirement.
- Platform symlink creation differs; a Git tree mode fixture must remain deterministic and portable.

## Security Considerations
- Bounds reduce memory pressure exposure. Two permits limit concurrent work, not per-job cost.
- Symlink finding is unsupported-mode attribution, not demonstrated secret read or sandbox escape; existing canonical containment remains mandatory.
- No repository mutations, remote operations, credential changes or auth bypass introduced.

## Next steps
Completed. Verified in native test suites (177 + 18 pass), live HTTP smoke (17 scenarios), independent code review (9.8/10), and parent adjudication. Scoped commit pending parent execution; push unauthorized.

## Unresolved questions
- Deterministic early-HEAD race seam warranted? CLOSED: Implemented pre-blame validation and post-blame HEAD revalidation before publication without intrusive synchronization framework.
