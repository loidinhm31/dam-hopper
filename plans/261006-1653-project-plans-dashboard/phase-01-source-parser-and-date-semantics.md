# Phase 01 — Source Parser and Date Semantics

## Context links
- [Parent](./plan.md), [contracts sections 2–6](./contracts.md), [backend research](./research/backend-contract.md).
- [Agreed brainstorm](../reports/brainstorm-261006-1653-project-plans-dashboard.md), [code standards](../../docs/code-standards.md).
- No implementation dependency. Freeze types here before [Phase 02](./phase-02-native-read-api.md).

## Overview
- Date: 2026-10-06. Priority: P2. Estimate: 8h.
- Implementation status: Completed.
- Review status: Reviewed (score: 9.8/10, approved by user).
- Advice mode: Active. State disposition: Finalized; types, bounds, and pure parser frozen for [Phase 02](./phase-02-native-read-api.md).
- Scope: Pure bounded parser for one selected plan's metadata, declared phases, reported current/captured status, and explicit dates. Operates on decisive `DocumentSnapshot` bytes without filesystem calls, HTTP queries, or controller dependencies.

## Key Insights
- Reference parser parsed `plan.md` only, misclassifying completed plans as Pending and losing phase links.
- Progress document presence is display opt-in; progress claims control current status over frozen plan metadata even when conflicting.
- Supported progress formats include `Current status:` scalar prose, `Phase Reconciliation` tables, and corroborated `All phases complete` summary sentences.
- Created/publication timestamps and mtime never fabricate actual start/completion dates; missing endpoints remain nullable.
- YAML anchors and aliases are rejected up-front via lexical scan to prevent expansion bombs without requiring an external AST parser.
- Bounded GFM table scanner correctly handles backslash-escaped pipes (`\|`) and code spans, preventing column misalignment.

## Implemented Architecture & Codebase Artifacts
Native `plans` domain registered under `server/src/plans/` and exported via `server/src/lib.rs`:

| File | Role | Key Exports & Implemented Components |
|---|---|---|
| `server/src/lib.rs` | Domain registration | `pub mod plans;` |
| `server/src/plans/mod.rs` | Module facade | `pub mod dto;`, `pub mod parser;`, `#[cfg(test)] mod tests;` |
| `server/src/plans/dto.rs` | Frozen DTOs & bounds | Closed enums (`PlanStatus`, `PlanAuthority`, `PlanDocumentState`, `DatePrecision`, `PlanFolderKind`, `PlanFolderState`), wire models (`FilePlan`, `ReportedStatus`, `StatusEvidence`, `FilePlanPhase`, `FilePlanMetadata`, `PlanDates`, `PlanCompletion`, `Diagnostic`, `DocumentSnapshot`), 17 diagnostic codes, and 10 parser bounds |
| `server/src/plans/parser.rs` | Pure parser engine | `pub fn parse_plan`, snapshot bounds validation, YAML frontmatter scanner, GFM section/table tokenizer, status cell normalizer, progress reconciler, completion calculator, date reconciler |
| `server/src/plans/tests.rs` | Behavioral regressions | 18 deterministic test scenarios verifying A02–A07 acceptance criteria, edge cases, and resource limits |

### Diagnostic Error Codes (contracts.md §5)
`DIAG_INVALID_METADATA`, `DIAG_INVALID_DOCUMENT`, `DIAG_FIELD_TOO_LARGE`, `DIAG_PHASE_INVENTORY_INVALID`, `DIAG_PHASE_UNREPORTED`, `DIAG_PHASE_UNMATCHED`, `DIAG_STATUS_CONFLICT`, `DIAG_UNSUPPORTED_STATUS`, `DIAG_PROGRESS_MISSING`, `DIAG_PROGRESS_UNREADABLE`, `DIAG_DOCUMENT_TOO_LARGE`, `DIAG_DOCUMENT_CHANGED`, `DIAG_LINK_REJECTED`, `DIAG_INVALID_DATE`, `DIAG_DATE_CONFLICT`, `DIAG_SCAN_LIMIT`, `DIAG_DIAGNOSTICS_LIMIT`.

### Parser Resource Bounds (contracts.md §3)
- `MAX_DOCUMENT_BYTES`: 64 KiB per document snapshot
- `MAX_DECISIVE_BYTES_PER_REQUEST`: 128 KiB
- `MAX_DECLARED_PHASE_ROWS`: 128 rows
- `MAX_METADATA_STRING_BYTES`: 4 KiB per string field
- `MAX_TITLE_TAG_BYTES`: 512 bytes
- `MAX_TAGS_COUNT`: 32 tags
- `MAX_EVIDENCE_LINKS_PER_PLAN`: 64 links
- `MAX_DIAGNOSTICS_PER_PLAN`: 32 entries (capped with `DIAG_DIAGNOSTICS_LIMIT`)
- `MAX_DIAGNOSTIC_RAW_TEXT_BYTES`: 1 KiB
- `MAX_YAML_NESTING_DEPTH`: 16 levels

## Implementation Steps & Outcomes
1. **Wire DTOs & Source Spans:** Defined `FilePlan`, `ReportedStatus`, `FilePlanPhase`, `PlanDates`, `PlanCompletion`, `Diagnostic`, and `DocumentSnapshot<'a>` in `dto.rs` matching `contracts.md`.
2. **Bounded Snapshot Decoding:** Implemented `validate_document_snapshot` in `parser.rs`. Enforces 64 KiB cap, checks for NUL bytes, validates UTF-8, and verifies `PlanDocumentState`.
3. **YAML Frontmatter Parser:** Implemented `parse_yaml_frontmatter` with duplicate key and anchor/alias detection (`has_duplicate_yaml_keys_or_aliases`), depth bounds check (max 16), string length enforcement, and field isolation.
4. **GFM Section & Table Tokenizer:** Implemented `parse_gfm_table` and `tokenize_table_row` supporting escaped pipes (`\|`), inline code spans, markdown link extraction, and dynamic header column mapping.
5. **Phase Inventory Extraction:** Implemented `extract_phase_inventory` validating rows under `Phases` heading. Strips markdown styling, normalizes local relative links, and rejects traversal (`../`), external URLs (`http://`), or scheme links (`javascript:`).
6. **Status Normalization:** Implemented `parse_status_cell` mapping aliases (`completed`, `done`, `in-progress`, `pending`, `blocked`, `cancelled`, etc.), handling bold/italic wrappers, and parsing parenthesized qualifiers.
7. **Corroborated Summary Grammar:** Implemented `parse_completion_summary_sentence` and `extract_summary_phase_numbers` validating "All phases [range/list] complete" sentences against declared phase inventory.
8. **Progress Reconciliation:** Implemented `reconcile_statuses` matching rows by link then unique phase number, recording captured vs current authority, and diagnosing unreported/unmatched phases and progress link references.
9. **Known Completion Fraction:** Implemented `compute_completion` returning exact counts (`declared`, `completed`, `in_progress`, `pending`, `unknown`, `conflicted`) and nullable fraction computed only when inventory is valid and non-empty.
10. **Date Parsing & Reconciliation:** Implemented `reconcile_dates`, `parse_date_value`, and `validate_date_range`. Enforces strict Gregorian validity, RFC3339 normalization to UTC, `Day` vs `Instant` precision, start-before-end range checks, and conflict suppression.
11. **Behavioral Regressions:** Implemented 18 comprehensive unit tests in `server/src/plans/tests.rs` covering all contract rules, boundary limits, and diagnostic cases.
12. **Phase 02 Handoff:** Domain exported in `server/src/lib.rs`. `parse_plan` is ready for consumption by Phase 02 native read service.

## Todo list
- [x] Bounded DTO/source/status types defined in `dto.rs`.
- [x] YAML/table tokenization and declared inventory implemented in `parser.rs`.
- [x] Progress precedence, matching, and conflict reconciliation implemented in `parser.rs`.
- [x] Known-completed fraction and explicit date semantics implemented in `parser.rs`.
- [x] Deterministic boundary and consumer-visible parser regressions verified in `tests.rs`.

## Test Coverage & Verification Evidence
18 unit tests implemented in `server/src/plans/tests.rs`:
1. `test_frozen_pending_plan_with_completed_progress`: Frozen Pending plan with Completed progress table reconciles to 100% completed with captured status history preserved.
2. `test_bold_done_and_parenthesized_qualifier`: Strips `**DONE** (verified)` and parenthesized qualifiers to map to `Completed`.
3. `test_reordered_columns_in_progress`: Header-driven column mapping succeeds when progress table reorders Captured and Current columns.
4. `test_completion_summary_corroboration_and_conflict`: Corroborated summary sentences vs table status mismatch triggers `STATUS_CONFLICT`; negation triggers `UNSUPPORTED_STATUS`.
5. `test_absent_progress_with_missing_warning_and_plan_conflict`: Absent progress referenced by plan triggers `PROGRESS_MISSING`; conflicting frontmatter status triggers `STATUS_CONFLICT`.
6. `test_unmatched_and_unreported_phases`: Flags undeclared progress rows with `PHASE_UNMATCHED` and unreported declared phases with `PHASE_UNREPORTED`.
7. `test_rejected_absolute_link`: Absolute URLs in phase links emit `LINK_REJECTED`.
8. `test_date_parsing_and_conflict_reconciliation`: Day/Instant precision, UTC normalization, and conflicting date suppression emitting `DATE_CONFLICT`.
9. `test_invalid_leap_date_and_mixed_precision_range`: Non-existent leap dates (e.g. 2026-02-29) emit `INVALID_DATE`.
10. `test_document_size_limit_and_nul_byte_rejection`: NUL bytes trigger `INVALID_DOCUMENT`; documents > 64 KiB trigger `DOCUMENT_TOO_LARGE`.
11. `test_empty_and_invalid_phase_inventory`: Plans without phases produce null declared count and null completion fraction.
12. `test_reversed_date_range_and_mixed_precision`: Start date after end date and mixed Day/Instant precision emit `INVALID_DATE`.
13. `test_tags_limit_and_metadata_bounds`: Tag counts exceeding 32 emit `SCAN_LIMIT`; oversized string fields emit `FIELD_TOO_LARGE`.
14. `test_diagnostics_cap_at_32`: Excess diagnostics are capped at 32 with the final diagnostic emitting `DIAGNOSTICS_LIMIT`.
15. `test_yaml_duplicate_keys_and_aliases_rejected`: YAML duplicate mapping keys and anchors/aliases emit `INVALID_METADATA`.
16. `test_summary_range_validation_and_unsupported_diagnostic`: Summary phase ranges exceeding declared phases emit `STATUS_CONFLICT`.
17. `test_relative_escape_and_scheme_links_rejected`: Traversal (`../`) and URI scheme (`javascript:`) links emit `LINK_REJECTED`.
18. `test_multi_bracket_cell_link_extraction`: Table cells containing multiple markdown brackets extract target links accurately.

## Success Criteria Verification
- **A02–A07 Parsing & Date Semantics:** Fully satisfied by `parser.rs` and verified in `tests.rs`.
- **Advisor Layout Compatibility:** Tested and verified with 5-phase completed reconciliation layout and captured status preservation.
- **Proven Truth Over Heuristics:** Negation, missing progress, or malformed data produces explicit diagnostics and Unknown/Conflict statuses; never fabricated green completion.
- **Zero Migration Required:** Consumes existing GFM and frontmatter markdown files as written.

## Handoff Contract for Phase 02
Phase 02 (`phase-02-native-read-api.md`) consumes the parser via:
```rust
pub fn parse_plan(
    plan_id: &str,
    plan_doc: &DocumentSnapshot,
    progress_doc: &DocumentSnapshot,
) -> FilePlan;
```
- **Snapshot Construction:** Phase 02 filesystem reader loads raw bytes and metadata into `DocumentSnapshot<'a>`.
- **Containment:** Reader ensures path canonicalization and directory containment before snapshot creation.
- **Lightweight Browsing:** Folder browsing inspects directory entries without invoking full document parsing.

## Security Considerations
- **Memory Boundedness:** Strict caps on document size (64 KiB), strings (4 KiB), tags (32), phases (128), and diagnostics (32).
- **Injection Safety:** Rejection of non-relative links (`http://`, `https://`, `javascript:`) and path traversal (`../`).
- **No Side Effects:** Pure parsing functions with no disk writes, network access, or shell invocation.

## Next steps
- Advance to [Phase 02 — Native Read API and Containment](./phase-02-native-read-api.md).
- Unresolved questions: None. Parser contracts, DTOs, and test suites are complete, approved, and frozen.
