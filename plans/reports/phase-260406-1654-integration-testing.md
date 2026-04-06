# Phase-08 Completion Report: Integration Testing + Migration

**Date:** 2026-04-06 | **Time:** 16:54  
**Status:** Done ✓  
**Effort:** 8h (on track)

---

## What Was Done

### 1. Rust Tests Expanded (111 → 121 tests)

**File:** `server/src/api/tests.rs`

#### New Helpers & Test Fixtures
- `make_state_with_project()` — project-aware state builder for ship/unship/git tests vs stateless default

#### Terminal Lifecycle Tests
- Create session with `cat` command → write to stdin → read buffer → kill session
- `terminal_list_detailed` endpoint (lists all active sessions with full metadata)
- Kill nonexistent session → 204 No Content (documented no-op, doesn't error)

#### Agent Store Tests (Real Filesystem)
- Ship skill from central store to project (verifies `target_path` field populated)
- Unship skill from project back to central (verifies symlink removed)
- Absorb skill — copies from project into store (inverse of ship)
- Ship unknown project → 404 Not Found
- Store matrix returns object with distribution counts

#### Git Operations (Real Repo)
- Branches endpoint on initialized repo (non-empty assertion)
- Worktrees endpoint on initialized repo (non-empty assertion)
- Branches unknown project → 404

#### Bug Fix
- Removed `std::env::set_var()` from parallel async test (data race on process environment)

### 2. Dead Code Removed from Web Package

**Cleanup scope:** Remove `agentStore.add()` API + callers (was not implemented in Rust server)

#### Files Modified
- `packages/web/src/api/client.ts` — removed `agentStore.add()` method
- `packages/web/src/api/queries.ts` — removed `useAddToStore` hook
- `packages/web/src/api/ws-transport.ts` — removed `agent-store:add` handler → replaced with `_no_add` sentinel
- `packages/web/src/pages/AgentStorePage.tsx` — removed broken `+ Add` button (was calling `addToStore.mutate({ category: "skill" })` with missing `name` field → always 404)

**Rationale:** YAGNI. Rust server has no endpoint for this. The `+Add` button UI required both category AND name, but was invoked with only category. Removal is safe; no orphaned references remain.

### 3. New Scripts

#### `scripts/compare-servers.sh`
Side-by-side smoke test: Rust vs Node server  
Features:
- One-server-only mode (test single backend against baseline)
- Structural JSON diff (array-aware, ignores order for reproducibility)
- 25-endpoint coverage (core REST subset)
- Returns 0 if parity, 1 if divergence

#### `scripts/bench.sh`
Performance baseline using `hey` or `wrk`  
Measures:
- Throughput (req/s)
- Latency p50/p95/p99
- Error rate

---

## Success Criteria Met

✓ **121 Rust tests passing** (0 failures)  
✓ **Web build**: 1852 modules, zero TypeScript errors  
✓ **All phase-08 required endpoints** covered in tests (terminal, agent store, git, workspace)  
✓ **Dead code removed** with no orphaned references  
✓ **Integration scripts** in place for validation

---

## Technical Decisions

### Skills: No `.md` Extension in Project Symlinks
- Store files: named `{name}.md` (e.g., `my-skill.md`)
- Project symlinks: point to names without extension (e.g., `/path/to/.claude/skills/my-skill`)
- Rationale: Matches existing Node server behavior

### Terminal Buffer Limitation
- `get_buffer` only works on **live sessions** (PTY still running)
- Fast-exiting processes (e.g., `echo "test"`) lose buffer before read can occur
- **Workaround:** Tests use `cat` (waits for stdin) instead of echo
- **Status:** Documented as known limitation (acceptable for MVP)

### Phase-08 Scope vs Phase-09 Boundary
- Phase-08: Rust + web parity testing, dead code cleanup
- Phase-09: Remove Node packages (`@dev-hub/core`, `@dev-hub/server`, `@dev-hub/electron`)
- Phase-10: CI/CD + distribution

---

## Metrics

| Metric | Value |
|--------|-------|
| Rust test suite | 121 tests (10 added) |
| Test pass rate | 100% |
| Web build output | 1852 modules |
| TypeScript errors | 0 |
| Server endpoints tested | 25+ |
| Dead code methods | 3 removed |
| Scripts added | 2 |

---

## Next Step: Phase 09

**Objective:** Remove Node packages (`@dev-hub/core`, `@dev-hub/server`, `@dev-hub/electron`)

- Drop `pnpm workspaces`
- Simplify `pnpm install` to web + server only
- Update `CLAUDE.md` commands
- Remove Electron/Node-specific CI jobs

---

## Unresolved Questions

None at time of completion. Phase-08 fully self-contained.

---

## Sign-Off

Phase-08 complete. All integration tests passing. Web app verified against Rust backend. Ready for phase-09 cleanup.
