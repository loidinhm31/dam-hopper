# Documentation Manager Report: Git Blame Caching

- Date: 2026-10-12
- Worktree: `/home/loidinh/WS/worktrees/dam-hopper-git-blame-caching`
- Branch: `feat/git-blame-caching`
- Scope: Review and update documentation for the Git blame caching feature (Phases 01–03, PR review remediations H1, H2, M3, M4, M7)

---

## 1. Current State Assessment

Prior to this documentation update:
- `docs/architecture/workbench-files-editor-and-git.md`: Contained high-level blame caching architecture bullets, but lacked client LRU/GC bounds, buffer SHA-256 fingerprint details, owner retirement lifecycle, and new caching module references in the source map table.
- `docs/api/git.md`: Documented baseline `POST /api/git/{project}/blame` endpoint (buffer limits, concurrency semaphore, EOL normalization), but lacked documentation of the server baseline cache (`BlameBaselineCache`), 128-entry / 64 MiB bounds, zero-context diff projection, shallow repository bypass (`repo.is_shallow()`), and client query cache synchronization. File length was 796 LOC, nearing the 800 LOC limit (`docs.maxLoc`).
- `docs/CHANGELOG.md`: Lacked an entry for Git blame caching under `# 2026-10-12`.
- `docs/codebase-summary.md`: Summary bullet for Git blame described only native blame attribution without dual-layer caching.

---

## 2. Changes Made

### 1. `docs/architecture/workbench-files-editor-and-git.md` (279 LOC)
- **Architecture Specification Updated:** Verified and expanded `#### Git Blame Caching Architecture`:
  - Documented server baseline cache bounds (128 entries / 64 MiB cap), canonical root namespacing, historical span storage `(start_line, line_count, final_commit_oid)`, zero-context diff projection, and shallow repository bypass.
  - Documented client TanStack Query cache bounds (64 entries / 32 MiB accounted total weight ceiling, 5-minute TanStack Query GC), SHA-256 buffer fingerprinting via `@noble/hashes` with Monaco `WeakMap` memoization, synchronous `ready` restoration, local vs target epoch separation, refresh bypass, and profile disconnection owner retirement.
- **Source Map Synchronization:** Updated table rows:
  - Added `packages/ui/src/lib/editor-git-blame-cache.ts` to `Git blame client, cache, and buffer lifecycle`.
  - Added `server/src/git/blame-cache.rs` to `Git blame backend cache and projection`.

### 2. `docs/api/git.md` (793 LOC)
- **API Reference Enhanced:** Added `#### Blame Caching and Baseline Projection` subsection under `POST /api/git/{project}/blame`:
  - Detailed `BlameBaselineCache` in-memory LRU mechanics, 128-entry / 64 MiB ceiling, and zero-context projection for in-memory buffer edits.
  - Documented explicit shallow repository bypass (`repo.is_shallow()`) preventing stale attribution if history deepens.
  - Documented HEAD fencing (`GIT_BLAME_STALE_REVISION`) and preservation of the global 2-permit concurrency semaphore (`503 GIT_BLAME_BUSY`).
  - Documented client attribution cache (64 entries / 32 MiB accounted total weight ceiling, 5-min GC), SHA-256 buffer fingerprinting, synchronous warm hit restoration, and epoch invalidation. Clarified that context-menu "Refresh Annotations" forces client cache bypass (`bypassCache: true`), re-evaluating HEAD and re-projecting against the server baseline.
- **Size & Syntax Optimization:** Compacted redundant multiline whitespace in JSON request/response examples and eliminated duplicate blank lines, keeping the file at 793 LOC (strictly compliant with `docs.maxLoc: 800`). Verified that all 25 JSON code fences parse as strictly valid JSON syntax (including restored `{` and `}` delimiters on leased-push body).

### 3. `docs/CHANGELOG.md` (776 LOC)
- **Changelog Entry Added:** Added conventional entry under `# 2026-10-12`:
  - Documented server baseline cache (`server/src/git/blame-cache.rs`, `server/src/git/blame.rs`), LRU bounds, zero-context projection, and shallow bypass.
  - Documented client query cache (`packages/ui/src/lib/editor-git-blame-cache.ts`, `use-editor-git-blame.ts`), synchronous warm hit restoration, and epoch invalidation.
  - Attributed qualification and performance evidence to `plans/reports/tester-261012-1900-git-blame-caching.md`: 31 Rust unit/differential tests, 16 API integration tests, >21x speedup benchmark on clean repeat requests (7.59 ms vs 161.85 ms cold), 94 Vitest unit/regression tests, and 3 Monaco browser tests.

### 4. `docs/codebase-summary.md` (92 LOC)
- **Summary Bullet Synchronized:** Updated `Git Blame Caching & Commit Reveal` entry under Current Architecture and Invariants to reflect dual-layer caching (128-entry/64 MiB server LRU with zero-context projection and shallow bypass, 64-entry/32 MiB client cache).

---

## 3. Validation and Verification

1. **Documentation Validator Script:**
   - Executed `node /home/loidinh/WS/dam-hopper/.omp/evcrate/scripts/validate-docs.cjs docs/`.
   - Results: Scanned 68 markdown files. Reported:
     - 1 broken internal link: `docs/CHANGELOG.md: ../plans/261009-1403-traditional-terminal-worktree-switching/progress.md` (pre-existing in line 38 from 2026-10-09 entry).
     - 24 unverified environment keys (pre-existing repository constants like `DAM_HOPPER_PORT`, `VITE_DAM_HOPPER_LOG_LEVEL`, etc.).
     - 4 code reference notices (pre-existing warnings for `onProcessRestarted()`, `terminalAttach()`, `onTerminalBuffer()`).
   - Baseline comparison: Exactly 0 new broken links, 0 new unverified config keys, and 0 new code reference warnings were introduced by documentation changes.
2. **JSON Syntax Verification:**
   - Parsed all 25 ` ```json ` blocks in `docs/api/git.md` using Python `json.loads`. All 25 blocks parse as valid JSON.
3. **File Size Compliance (`docs.maxLoc: 800`):**
   - `docs/architecture/workbench-files-editor-and-git.md`: 279 LOC (PASS)
   - `docs/api/git.md`: 793 LOC (PASS)
   - `docs/CHANGELOG.md`: 776 LOC (PASS)
   - `docs/codebase-summary.md`: 92 LOC (PASS)
4. **Evidence & Implementation Grounding:**
   - All server cache structures and bounds grounded in `server/src/git/blame-cache.rs` and `server/src/git/blame.rs`.
   - All client cache structures, bounds, and WeakMap memoization grounded in `packages/ui/src/lib/editor-git-blame-cache.ts` and `packages/ui/src/hooks/use-editor-git-blame.ts`.
   - Qualification numbers directly cite `plans/reports/tester-261012-1900-git-blame-caching.md`.

---

## 4. Gaps Identified & Recommendations

- **Long-term Modularization of `docs/api/git.md`:** At 793 LOC, `docs/api/git.md` is near the 800 LOC limit. When new Git endpoints are introduced in future features, recommend splitting into topic files under `docs/api/git/` (`index.md`, `worktrees.md`, `branches.md`, `history.md`, `blame.md`, `leased-push.md`).

---

## 5. Unresolved Questions

- None. All requested documentation updates and verifications are complete.
