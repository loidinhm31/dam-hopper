# Code Review Summary: Phase 01 — Domain and Relational Persistence

## Scope
- **Files reviewed:**
  - `server/src/lib.rs`
  - `server/src/persistence/mod.rs`
  - `server/src/persistence/migrations/010_workflow_tracking.sql`
  - `server/src/workflow/mod.rs`
  - `server/src/workflow/model/mod.rs`
  - `server/src/workflow/model/enums.rs`
  - `server/src/workflow/model/types.rs`
  - `server/src/workflow/model/validation.rs`
  - `server/src/workflow/store/mod.rs`
  - `server/src/workflow/store/error.rs`
  - `server/src/workflow/store/workspace.rs`
  - `server/src/workflow/store/item.rs`
  - `server/src/workflow/store/session.rs`
  - `server/src/workflow/store/note.rs`
  - `server/src/workflow/store/event.rs`
  - `server/src/workflow/store/overview.rs`
  - `server/src/workflow/tests.rs`
- **Lines of code analyzed:** ~2,650 lines across 17 files
- **Review focus:** Plan-first hierarchy invariants, transaction isolation, manual timestamp immutability during observations, migration 010 safety, keyset pagination, and factual progress calculation.
- **Updated plans:**
  - `plans/260901-0919-workflow-tracking-notes/phase-01-domain-and-relational-persistence.md`
  - `plans/260901-0919-workflow-tracking-notes/plan.md`

## Overall Assessment
- **Score:** 9.2 / 10
- High quality implementation. Conforms to domain invariants, Plan-first hierarchy constraints, UTF-8 char/byte bounds, transactional isolation, and event idempotency. Zero warnings or errors in cargo test/check.

## Critical Issues
None.

## High Priority Findings & Warnings
1. **SQLite Foreign Key Enforcement Missing on Connection:**
   - **Problem:** `SessionStore::open` in `server/src/persistence/mod.rs` connects to SQLite without executing `PRAGMA foreign_keys = ON;`. SQLite defaults `foreign_keys` to OFF.
   - **Impact:** Foreign key actions declared in `010_workflow_tracking.sql` (`ON DELETE CASCADE` for child items/notes, `ON DELETE SET NULL` for sessions) will not execute automatically on `DELETE FROM workflow_items` unless enabled.
   - **Recommendation:** Add `conn.execute_batch("PRAGMA foreign_keys = ON;")?;` in `SessionStore::open`.

2. **Overview Item Truncation Flag Ineffective at Max Limit:**
   - **Problem:** In `server/src/workflow/store/overview.rs`, `get_overview` requests `max_items + 1` from `item::list_items`. However, `list_items` internally clamps the limit to `MAX_OVERVIEW_ITEMS` (500). When `max_items == 500`, `list_items` returns at most 500 rows.
   - **Impact:** `all_items.len() > max_items` evaluates to `500 > 500` (`false`), leaving `truncated: false` even when >500 items exist.
   - **Recommendation:** In `list_items`, allow fetching up to `limit` without clamping below `MAX_OVERVIEW_ITEMS + 1`, or pass an explicit un-clamped limit from overview.

## Medium Priority Improvements
1. **N+1 Query Pattern in Overview Notes:**
   - **Problem:** `overview.rs::build_node` calls `note::list_notes_for_item` for every node recursively (up to 500 separate queries).
   - **Recommendation:** Query all active notes for the workspace once in `get_overview` and index into `HashMap<String, Vec<WorkflowNote>>` by `item_id`, matching the `sessions_by_item` pattern.

2. **Error Message Specificity in Note Creation:**
   - **Problem:** `note::create_note_tx` returns `WorkflowModelError::NoteEmpty` when both `item_id` and `session_id` are `None`.
   - **Recommendation:** Introduce a dedicated `WorkflowModelError::TargetMissing` variant for clearer API error reporting in Phase 02.

## Positive Observations
- **Plan-First Hierarchy Rules:** Exact enforcement of `Plan` (no parent), `Phase` (must have `Plan` parent), `Task` (optional `Plan` or `Phase` parent, never `Task` parent), and cycle/depth prevention up to depth 3.
- **Observation Isolation:** `update_resource_observation_tx` updates only `workflow_resource_links` and never touches `workflow_sessions` status or manual timestamps.
- **Factual Progress Computation:** Returns `None` (null) when an item has no descendant tasks; never calculates misleading completion percentages.
- **Migration Safety:** Additive migration preserves existing terminal sessions, ports, names, and buffers without destructive changes.
- **Privacy Controls:** `WorkflowWorkspace.locator` annotated with `#[serde(skip_serializing)]` to prevent filesystem path leakage.
- **Strict Character vs Byte Bounds:** Correctly uses `chars().count()` for UTF-8 text titles/labels and `.len()` for raw byte payloads/notes.

## Validation Commands & Results
- `cargo test --lib workflow` (in `server/`): 14 passed, 0 failed, 0 ignored (0.02s)
- `cargo check --tests` (in `server/`): Clean compilation with 0 errors / 0 warnings in `workflow` module.

## Metrics
- **Type Coverage:** 100% Rust type-checked
- **Test Coverage:** 14 unit & integration store tests covering CRUD, migrations, hierarchy, duplicate request IDs, overlapping sessions, soft deletion, and purge.
- **Compiler Warnings:** 0 warnings in `workflow/` module.

## Unresolved Questions
None.
