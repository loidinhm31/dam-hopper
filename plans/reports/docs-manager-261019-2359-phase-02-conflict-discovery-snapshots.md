# Documentation Report: Phase 02 Conflict Discovery & Snapshots

- **Date:** 2026-10-20
- **Author:** Phase02DocsManager
- **Plan Reference:** `plans/261019-1505-git-conflict-resolver/phase-02-conflict-discovery-and-snapshots.md`
- **Scope:** Document Phase 02 unmerged conflict discovery summary, on-demand detail snapshots, and fail-closed legacy resolution endpoint across project documentation.

## 1. Current State Assessment

Phase 02 (Conflict discovery and baseline snapshots) delivered backend logic in `server/src/git/conflict.rs`, exposed REST route handlers in `server/src/api/git_diff.rs`, updated the Axum router in `server/src/api/router.rs`, updated UI client methods and queries in `packages/ui/src/api/`, and integrated baseline state in `MergeConflictEditor.tsx`. Phase 02 is complete with user-accepted deferrals (cycle 3 review noted 6 deferred gate warnings; safety gates remain open pending Phase 03/05 remediation).

Documentation previously contained obsolete or proposed representations:
- `docs/api/rest-endpoints.md` had an outdated eager `GET /api/git/:project/conflicts` spec returning lossy optional stage strings (`{ conflicts: [...] }`) and a duplicated 45-line trailing block from older revisions.
- `docs/api/git.md` lacked cross-references to the unmerged conflict discovery contracts.
- `docs/api-reference.md` did not link conflict discovery and snapshot contracts.
- `docs/system-architecture.md` categorized conflict discovery DTOs under "Phase 01 Feasibility / Proposed Contracts" rather than implemented Phase 02 behavior.
- `docs/codebase-summary.md` listed Git Conflict Resolver under Phase 01 feasibility spikes.
- `docs/project-overview-pdr.md` and `docs/code-standards.md` omitted conflict discovery invariants.

## 2. Changes Made

### A. REST Endpoint Reference (`docs/api/rest-endpoints.md`)
- **Documented `GET /api/git/{project}/conflicts`:**
  - Query parameters: `worktreePath` (absolute registered worktree path or omitted for configured root), `root` (explicit VCS root), `cursor` (opaque cursor), `limit` (1–500, default 100).
  - Response: `ConflictSummaryResponse` with `targetRevision`, `entries`, `truncated`, `nextCursor`.
  - Fields & behaviors: opaque `conflictId` (`cid_<hex>`), `status` enum (`bothModified`, `modifyDelete`, `deleteModify`, `bothAdded`, `unsupported`), `isBinary` (computed from `.gitattributes` diff attribute, binary file extensions, and bounded $\le$ 8,000-byte ODB sniff without eager blob loading), and `unsupportedReason`.
- **Documented `GET /api/git/{project}/conflicts/file`:**
  - Query parameters: `conflictId` (required, max 4096 bytes), `worktreePath`, `root`.
  - Response: `ConflictSnapshot` with `conflictId`, `path`, `repositoryRoot`, `worktreeRoot`, `snapshotVersion`, `fullIndexFingerprint`, `status`, `stages` (`base`, `ours`, `theirs`), `worktree` (`exists`, `kind`, `mode`, `byteLength`, `textTokens`, `hasConflictMarkers`, `isDirtyVsStages`), and `effectiveAttributes` (`eol`, `ident`, `filterQualified`).
  - Pre-allocation limits: ODB header checks before allocating blob memory (`MAX_STAGE_BYTES = 5 MiB`, `MAX_TOTAL_STAGE_BYTES = 15 MiB`); disk read bounded to `MAX_WORKTREE_BYTES = 5 MiB` (retaining `kind: regular`, setting `isDirtyVsStages: true`, withholding `textTokens`).
  - Lossless line tokenization: tokenizes UTF-8 lines preserving raw terminators (`\n`, `\r\n`, lone `\r`), enforcing `MAX_LINES = 50,000` and `MAX_LINE_LENGTH = 100,000` bytes during tokenization.
  - Stage classifications: `text`, `binary`, `missing` (omitted path/oid), `invalidEncoding`, `unsupported`, `readError`. Serde omission: `stages.base` and `textTokens` omitted when `None`.
  - Filter qualification: custom filters set `filterQualified: false`, withholding text tokens and marking stages `unsupported`.
  - Coherence verification: HTTP 409 `REFRESH_REQUIRED` on detected state drift between before and after reads (HEAD OID, full index hash, worktree file metadata).
  - Not found: HTTP 404 if `conflictId` is missing from unmerged index.
- **Documented `POST /api/git/{project}/resolve`:**
  - Documented fail-closed status: returns HTTP 400 `LEGACY_PAYLOAD_REJECTED` for all callers. Precondition-verified resolution mutation (`snapshotVersion`, `fullIndexFingerprint`, structured actions) scheduled for Phase 03.
- **Removed duplicate trailing block:** Eliminated 45 lines of redundant Git endpoint documentation (lines 595–640).
- File size: 699 LOC (target $\le$ 800 LOC).

### B. API Reference Index (`docs/api-reference.md`)
- Added cross-references in `## Git API` and `## Git Operations` linking to `[Git Conflict Discovery & Snapshots](./api/rest-endpoints.md#git-conflict-discovery--snapshots)`.
- File size: 83 LOC.

### C. Git API Reference (`docs/api/git.md`)
- Added cross-reference note linking to `[Git Conflict Discovery & Snapshots](./rest-endpoints.md#git-conflict-discovery--snapshots)`.
- File size: 792 LOC (strictly below 800 LOC ceiling).

### D. System Architecture (`docs/system-architecture.md`)
- Updated `### Git Conflict Resolver Architecture (Phase 02 Discovery & Snapshots Complete with Accepted Deferrals)`.
- Documented implemented discovery (`GET .../conflicts`), on-demand snapshots (`GET .../conflicts/file`), pre-allocation bounds (5 MiB stage/worktree, 15 MiB aggregate stages), lossless line tokenization (50k lines, 100k line length), coherence verification (`REFRESH_REQUIRED`), and fail-closed legacy resolve guard (`LEGACY_PAYLOAD_REJECTED`).
- Preserved open Phase 01 qualification gates for `JointHistoryAuthority` (Monaco EOL/byte fidelity) and `node-diff3` main-thread execution budget ($\le$ 5,000 lines / 500 KB, with proposed worker/terminal handoff).
- Kept Phase 03 resolution mutation and Phase 04 operation status explicitly designated as proposed contracts.
- File size: 339 LOC.

### E. Codebase Summary (`docs/codebase-summary.md`)
- Updated Git conflict resolver section to reflect Phase 02 completion with accepted deferrals while safety gates remain open.
- Refreshed codebase packaging via `repomix` (`repomix-output.xml`).
- Preserved original 2026-10-05 dated inventory table metrics.
- File size: 93 LOC.

### F. Product Development Requirements (`docs/project-overview-pdr.md`)
- Updated `PR-003` to include conflict discovery, on-demand snapshots with before/after state coherence checks, and fail-closed legacy resolution guards.
- Expanded `### Git safety` acceptance criteria with pre-allocation bounds (5 MiB stage/worktree, 15 MiB aggregate stages), bounded line tokenization (50,000 lines, 100,000 bytes line length), and coherence verification returning HTTP 409 `REFRESH_REQUIRED`.
- File size: 117 LOC.

### G. Code Standards (`docs/code-standards.md`)
- Added `### Git conflict discovery and snapshots` under `## Domain-specific invariants`.
- Specified invariants: bounded unmerged index discovery, target revision cursor validation, pre-allocation byte bounds before blob materialization, lossless line tokenization preserving raw endings, before/after state coherence verification, and fail-closed resolution rejection.
- File size: 112 LOC.

### H. Changelog Link Hygiene & LOC Trimming (`docs/CHANGELOG.md`)
- Fixed broken internal link to nonexistent `plans/261009-1403-traditional-terminal-worktree-switching/progress.md`, updating to valid `phase-03-behavioral-qualification.md`.
- Consolidated historical trailing entry formatting to bring file size from 805 LOC down to 789 LOC (strictly under 800 LOC limit).

## 3. Metrics & Verification

1. **Internal Link Validation:**
   - Command: `node .omp/evcrate/scripts/validate-docs.cjs docs/`
   - Result: `✓ All internal markdown links point to existing files.` (Zero broken links in entire repo).
   - Pre-existing non-blocking warnings: 24 unverified config keys, 4 code reference notices (all pre-existing).

2. **File Size Limits (`docs.maxLoc: 800`):**
   - Verified across all markdown documents in `docs/`: zero files exceed 800 LOC.
   - Longest documentation files: `docs/api/git.md` (792 LOC), `docs/CHANGELOG.md` (789 LOC), `docs/frontend-components/terminal-and-ide.md` (756 LOC).

3. **Backend Test Verification:**
   - API Integration Tests: `cargo test --manifest-path server/Cargo.toml --test git_conflict_discovery_api` -> **9 passed, 0 failed**.
     - `test_conflict_summary_and_snapshot_both_modified`
     - `test_conflict_binary_files`
     - `test_conflict_delete_modify`
     - `test_conflict_summary_paging_and_bounds`
     - `test_conflict_legacy_resolve_fails_closed`
     - `test_conflict_symlink_marked_unsupported`
     - `test_conflict_non_utf8_path_marked_unsupported`
     - `test_conflict_stale_cursor_rejected`
     - `test_conflict_custom_filter_withholds_tokens`
   - Unit Tests: `cargo test --manifest-path server/Cargo.toml git::conflict` -> **6 passed, 0 failed**.
     - `git::conflict::tests::test_encode_decode_conflict_id`
     - `git::conflict::tests::test_split_lossless_line_tokens`
     - `git::conflict::tests::test_split_lossless_line_tokens_bounded_limits`
     - `git::conflict::tests::test_detect_conflict_markers`
     - `git::conflict::tests::test_is_binary_content`
     - `git::conflict::tests::test_state_fingerprint_changes_on_commit`

4. **Codebase Compaction:**
   - Ran `repomix` to update `repomix-output.xml` (3,007 files packed, 7,389,722 tokens).

## 4. Gaps & Accepted Deferrals Identified

- **Phase 02 Cycle-3 Gate Warnings (Deferred):**
  - W1: Coherent snapshot mtime/race gate (file mtime checked rather than full pre-read content hashing).
  - W2: Effective conversion gating (custom filter conversions withhold text tokens rather than applying git-filter clean/smudge).
  - W3: Path escaping in UI display labels.
  - W4: Memory materialization limit on worktree reads.
  - W6: Inventory completeness semantics across pagination boundaries.
  - W7: Windows-native path/character support qualification.
  - W12: Recovery banner copy synchronization with backend active operations.
- **Mutation Scope:** `POST /api/git/{project}/resolve` remains intentionally non-functional and fails closed. All write operations require Phase 03 precondition-governed mutation implementation.

## 5. Unresolved Questions

None. All Phase 02 documentation tasks, schema cross-referencing, size limit constraints, and link validations are complete and verified against source code and passing test suites.
