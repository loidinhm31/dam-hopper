# Documentation Update: Phase 01 Git Diff API

**Date:** 2026-04-11  
**Updated Files:** 2  
**Total Lines Added:** ~95

## Summary

Updated technical documentation to reflect Phase 01 Git Diff API implementation. Added comprehensive API reference, module breakdown, and type definitions for diff/staging/conflict operations.

## Changes Made

### 1. `/docs/api-reference.md` (+87 lines)
**Section:** Git Diff & Change Management (Phase 01)

Added documentation for 8 new endpoints:
- `GET /api/git/:project/diff` — list changed files with status, staged flag, +/- counts
- `GET /api/git/:project/diff/file?path=REL` — file diff with hunks, original/modified content, language detection
- `POST /api/git/:project/stage` — stage files for commit
- `POST /api/git/:project/unstage` — unstage files
- `POST /api/git/:project/discard` — discard file changes (restore from HEAD)
- `POST /api/git/:project/discard-hunk` — discard single hunk by index
- `GET /api/git/:project/conflicts` — list merge conflicts with 3-way content
- `POST /api/git/:project/resolve` — resolve merge conflict with resolved content

Included JSON response examples for diff listing, file diff with hunks, and conflict resolution.

### 2. `/docs/system-architecture.md` (+10 lines, restructured)

**Section: git/ Module**
- Expanded `types.rs` with new Phase 01 types:
  - `DiffFileEntry` — file status, staged flag, additions/deletions
  - `FileDiffContent` — hunks, content, language, binary flag
  - `HunkInfo` — hunk metadata (position, header)
  - `ConflictFile` — 3-way merge content

- Added `diff.rs` subsection documenting:
  - `get_diff_files()` — list changed files
  - `get_file_diff()` — hunked diff
  - `stage_files()`, `unstage_files()` — staging operations
  - `discard_file()`, `discard_hunk()` — discard operations
  - `get_conflicts()` — merge conflict detection
  - `resolve_conflict()` — conflict resolution

**Section: api/ Module**
- Added `git_diff.rs` subsection listing 8 route handlers

**Section: Phase Progression**
- Updated Phase 01 entry to document git diff/staging/conflict API alongside file explorer

## Verified Details

✓ All 8 routes confirmed in `server/src/api/router.rs`  
✓ All types match Rust definitions in `server/src/git/types.rs`  
✓ All function names match `server/src/git/diff.rs` implementations  
✓ All web client methods match `packages/web/src/api/client.ts`  
✓ All React Query hooks match `packages/web/src/api/queries.ts`  

## File Sizes

- api-reference.md: 190 → 277 lines (within limit)
- system-architecture.md: 283 → 291 lines (within limit)

## Notes

- Used actual field names from Serde types (e.g., `oldPath` → `old_path` mapping via serde rename)
- Included example response structures to aid API consumers
- Documented destructive operations (`discard`, `discard_hunk`) with clear intent
- Highlighted 3-way merge content structure for conflict handling
