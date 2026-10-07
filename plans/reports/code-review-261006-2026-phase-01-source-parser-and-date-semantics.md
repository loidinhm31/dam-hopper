# Code Review: Phase 01 — Source Parser and Date Semantics

**Date**: 2026-10-06  
**Reviewer**: Senior Software Engineer (Phase01Reviewer)  
**Phase**: `phase-01-source-parser-and-date-semantics`  
**Score**: 9.0/10  

---

## Code Review Summary

### Scope
- **Files reviewed**: 5 files (4 newly created, 1 modified)
  - `server/src/plans/mod.rs` (new, 5 LOC)
  - `server/src/plans/dto.rs` (new, 267 LOC)
  - `server/src/plans/parser.rs` (new, 1,872 LOC)
  - `server/src/plans/tests.rs` (new, 438 LOC)
  - `server/src/lib.rs` (modified, +1 LOC)
- **Lines of code analyzed**: ~2,583 LOC
- **Review focus**: Phase 01 pure bounded Markdown/YAML plan parser, authority precedence, status reconciliation, date semantics, security/resource bounds, performance, architecture, and YAGNI/KISS/DRY compliance
- **Updated plans**:
  - `plans/261006-1653-project-plans-dashboard/phase-01-source-parser-and-date-semantics.md`

---

## Overall Assessment

Phase 01 establishes a clean, self-contained `plans` domain in `server/src/plans/` with zero coupling to `WorkflowService`, database models, or filesystem controllers. Wire DTOs in `dto.rs` match `contracts.md §2–3` field-for-field with explicit `camelCase` and `kebab-case` serde attributes. Resource bounds (64 KiB document cap, NUL rejection, 128 phase rows, 32 tags, 32 diagnostics cap, 4 KiB metadata strings, 512B title/tag) and Gregorian/RFC3339 date validation rules work deterministically. All 14 unit tests execute in <1ms and pass with zero compiler errors.

Four contract/edge-case warnings and four maintainability/performance suggestions were identified below.

### Security, Performance, Architecture & YAGNI/KISS/DRY
- **Security**: Pure algorithmic parser over in-memory byte slices; no filesystem/network/process execution. Enforces 64 KiB cap, NUL byte rejection, UTF-8 validation, and diagnostic caps prior to deep parsing.
- **Performance**: Sub-millisecond execution (14 tests in 0.00s). Can further reduce allocations by borrowing `&'a str` slices from `DocumentSnapshot<'a>` instead of cloning document/line strings.
- **Architecture**: Clean separation between `dto.rs` (wire contracts) and `parser.rs` (pure parsing/reconciliation). Independent of `WorkflowService`.
- **YAGNI/KISS/DRY**: Reuses existing `serde_yaml_ng` and `chrono` crates without adding external Markdown AST dependencies. Shares date evidence and status cell normalization helpers across plan and progress parsers.

---

## Critical Issues (MUST FIX)

*None.* No exploitable security vulnerabilities, data loss risks, or breaking changes.

---

## High Priority Findings / Warnings (SHOULD FIX)

### 1. YAML frontmatter deserialization into `serde_json::Value` silently allows duplicate keys and aliases
- **Location**: `server/src/plans/parser.rs:366-393`
- **Issue**: `serde_yaml_ng::from_str::<serde_json::Value>(content)` deserializes into `serde_json::Map`, which silently overwrites duplicate keys rather than rejecting them, and does not reject YAML anchors/aliases. `contracts.md §5.1` and `phase-01.md §Risk Assessment` require rejecting duplicate YAML keys and aliases.
- **Impact**: Duplicate keys in frontmatter (e.g., two `status` or `title` entries) silently take the last value instead of emitting `INVALID_METADATA`.
- **Fix**: Deserialize using a custom `serde::de::Visitor` that rejects duplicate map keys, or pre-scan/validate YAML mapping entries for duplicate keys and `&`/`*` anchor/alias tokens before accepting frontmatter.

### 2. `DIAG_UNSUPPORTED_STATUS` is never emitted and summary list/range grammar is not corroborated against phase numbers
- **Location**: `server/src/plans/dto.rs:11`, `server/src/plans/parser.rs:1209-1212, 1307-1329, 1508-1535`
- **Issue**:
  1. `DIAG_UNSUPPORTED_STATUS` is defined in `dto.rs` but never referenced in `parser.rs`. When `parse_completion_summary_sentence` detects negated/conditional prose and returns `PlanStatus::Unknown`, no `UNSUPPORTED_STATUS` diagnostic is recorded (`contracts.md §5.8`).
  2. `parse_completion_summary_sentence` checks `lower.contains("all phases") && (lower.contains("complete") || lower.contains("done"))` without parsing parenthesized phase lists/ranges (e.g. `All phases (01–03) complete`) to verify the normalized set equals the declared phase inventory.
- **Impact**: Unsupported/negated summary prose sets status to `Unknown` without diagnostic explanation; partial range claims in summary prose are not checked against the declared phase number set.
- **Fix**: Emit `DIAG_UNSUPPORTED_STATUS` when summary prose is unsupported/negated, and parse any parenthesized number list/range in `"All phases (...)"` to verify exact set equality with declared phase numbers.

### 3. `is_rejected_link` misses non-http/file schemes and `..` path traversal escapes
- **Location**: `server/src/plans/parser.rs:1060-1080`
- **Issue**: `is_rejected_link` checks only `http:`, `https:`, `file:`, leading `/`, and `\0`. It does not reject other URI schemes (`javascript:`, `data:`, `mailto:`, `ftp:`) or parent-directory traversal (`..` segments) as required by `contracts.md §5.3` (`reject scheme/absolute/NUL/escapes`). Furthermore, when a link is rejected in `parse_gfm_table` (line 928), `detail_link` is still retained in `RawPhaseRow` and used as the phase `id` and `path` in `extract_phase_inventory` (line 786).
- **Impact**: Escaping relative paths (`../outside.md`) or custom schemes (`javascript:alert(1)`) are accepted as phase `path`/`id` without `LINK_REJECTED` diagnostics, and rejected links still populate `phase.path`.
- **Fix**: Reject any link containing `:` (scheme), `\` (backslash), or `..` path segments; set `detail_link = None` when `is_rejected_link` triggers so rejected links never become `phase.path`.

### 4. `extract_markdown_link` fails when bracketed text precedes the Markdown link
- **Location**: `server/src/plans/parser.rs:1045-1058`
- **Issue**: `extract_markdown_link` searches only the first `[` and first `]`. If a table cell contains `[WIP] [Phase 01](./phase-01.md)`, `s.find('[')` matches `[WIP]`, sees a space instead of `(`, and returns `None`.
- **Impact**: Valid phase links preceded by bracketed tags/labels in the same cell are missed.
- **Fix**: Search for `](` and scan backward for the matching `[` and forward for `)`.

---

## Medium Priority Improvements / Suggestions (NICE TO HAVE)

### 1. Avoid full-document and per-line `String` allocations in parser pipeline
- **Location**: `server/src/plans/parser.rs:148-210, 213-220, 298, 307, 1170`
- **Issue**: `validate_document_snapshot` returns `Option<String>` via `s.to_string()` (copying up to 64 KiB per document), and `ParsedSections` / `parse_progress_document` store `(usize, String)` copies for every metadata and table line.
- **Fix**: Return `Option<&'a str>` from `validate_document_snapshot` and store `(usize, &'a str)` in `ParsedSections` and `table_lines` to honor zero-copy span borrowing (`phase-01.md §Architecture`).

### 2. Enforce `MAX_DIAGNOSTIC_RAW_TEXT_BYTES` (1 KiB) in `add_diagnostic` and raw status fields
- **Location**: `server/src/plans/dto.rs:31`, `server/src/plans/parser.rs:1845-1860`
- **Issue**: `MAX_DIAGNOSTIC_RAW_TEXT_BYTES` (1,024 bytes) and `MAX_EVIDENCE_LINKS_PER_PLAN` (64) are defined in `dto.rs` but unused in `parser.rs`. Oversize raw status cells or diagnostic messages are not bounded to 1 KiB (`contracts.md §3`).
- **Fix**: Truncate diagnostic messages at a valid UTF-8 boundary ≤ `MAX_DIAGNOSTIC_RAW_TEXT_BYTES` (with a clipping suffix) and bound `raw` status strings to 1 KiB.

### 3. Simplify `extract_clean_title` prefix stripping (anagram false positive)
- **Location**: `server/src/plans/parser.rs:1013-1026`
- **Issue**: `prefix.trim().chars().all(|c| c.is_ascii_digit() || c.is_whitespace() || c.to_ascii_lowercase() == 'p' || ...)` matches any prefix composed of the letters `{p, h, a, s, e}` (e.g., `"Shape — Overview"` strips `"Shape — "`). Also triggers 10 Clippy `manual_ignore_ascii_case` warnings.
- **Fix**: Check whether `prefix.trim()` (case-insensitively) optionally starts with `"phase"` followed by whitespace and ASCII digits.

### 4. Clean up 25 Clippy warnings in `server/src/plans/parser.rs`
- **Location**: `server/src/plans/parser.rs:227, 242, 353, 593, 641-666, 970, 1016, 1022, 1136, 1160, 1332, 1693`
- **Issue**: `cargo clippy --lib` emits 25 warnings in `src/plans/parser.rs`:
  - `type_complexity` on 3 tuple return signatures (lines 227, 353, 1136)
  - `too_many_arguments` (11/7) on `reconcile_statuses` (line 1332)
  - `collapsible_match` on 6 date label match arms (lines 641–666)
  - `manual_ignore_ascii_case` (10 instances at lines 1016, 1022)
  - `needless_range_loop` (line 242), `unneeded_return` (line 593), `while_let_on_iterator` (line 970), `bool_assign` (line 1160), `field_reassign_with_default` (line 1693)
- **Fix**: Introduce small internal structs for `ParsedPlanDoc`, `ParsedFrontmatter`, `ParsedProgressDoc`, and `ReconcileInput`, and apply idiomatic iterator/match patterns.

---

## Positive Observations

- **Exact DTO Contract Alignment**: `dto.rs` types, enums (`PlanStatus`, `PlanAuthority`, `PlanDocumentState`, `DatePrecision`), and serde attributes (`camelCase` / `kebab-case` / `lowercase`) match `contracts.md §2` verbatim.
- **Authority Precedence & Provenance**: Progress authority overrides frozen `plan.md` statuses while preserving initial captured statuses in `captured: Vec<StatusEvidence>` with 1-based line `SourceRef` provenance.
- **Syntax-Aware Table Tokenizer**: `tokenize_table_row` properly respects escaped pipes (`\|`) and inline code spans (`` `...` ``) and resolves columns by normalized header names rather than fixed positions.
- **Strict Date & Range Semantics**: `parse_date_value` enforces valid Gregorian calendar dates (rejecting non-leap `2026-02-29`) and normalizes RFC3339 timestamps to UTC while rejecting timezone-free local datetimes, reversed ranges, and mixed-precision endpoints.

---

## Validation Commands & Results

| Command | Result | Details |
|---|---|---|
| `cargo test --lib plans::tests` (in `server/`) | **PASS** | 14 passed, 0 failed, 0.00s execution (0.25s wall) |
| `cargo check --lib` (in `server/`) | **PASS** | 0 errors, 0 warnings in `src/plans/` |
| `cargo clippy --lib --message-format=short` | **WARN** | 0 errors in `src/plans/`; 25 style/complexity warnings in `src/plans/parser.rs` |
| `TODO` / `FIXME` scan in `server/src/plans/` | **PASS** | 0 remaining TODO/FIXME markers |

---

## Recommended Actions

1. Reject duplicate keys and aliases in `parse_yaml_frontmatter`.
2. Emit `DIAG_UNSUPPORTED_STATUS` on unsupported/negated summary prose and validate parenthesized phase number ranges against declared inventory.
3. Harden `is_rejected_link` against arbitrary URI schemes and `..` path traversal, and clear `detail_link` when rejected.
4. Fix `extract_markdown_link` to handle bracketed prefixes before `[text](url)` and simplify `extract_clean_title`.
5. Resolve the 25 Clippy warnings in `parser.rs` and borrow `&'a str` slices to avoid unnecessary `String` copies.

---

## Unresolved Questions

*None.* All Phase 01 architectural and contract requirements are clear.
