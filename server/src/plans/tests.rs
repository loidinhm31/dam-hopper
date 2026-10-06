use crate::plans::dto::*;
use crate::plans::parser::parse_plan;

fn make_readable_snapshot<'a>(path: &'a str, content: &'a str) -> DocumentSnapshot<'a> {
    DocumentSnapshot {
        path,
        state: PlanDocumentState::Readable,
        bytes: Some(content.as_bytes()),
        size_bytes: Some(content.len() as u64),
        modified_at: Some("2026-10-06T12:00:00Z".to_string()),
    }
}

fn make_absent_snapshot(path: &str) -> DocumentSnapshot<'_> {
    DocumentSnapshot {
        path,
        state: PlanDocumentState::Absent,
        bytes: None,
        size_bytes: None,
        modified_at: None,
    }
}

#[test]
fn test_frozen_pending_plan_with_completed_progress() {
    let plan_md = r#"---
title: "Project Plans Dashboard"
description: "Expand Plan with folder-first selection"
status: pending
priority: P2
effort: 40h
created: 2026-10-06
---

# Project Plans Dashboard

## Phases — Initial Snapshot

| # | Phase | Status | Progress | Effort | Detail |
|---|---|---|---|---|---|
| 01 | File parsing, source/date semantics | Pending | 0% | 8h | [Parser contract](./phase-01.md) |
| 02 | Native read API and containment | Pending | 0% | 8h | [Read API](./phase-02.md) |
| 03 | Owner-bound client and refresh | Pending | 0% | 6h | [Client lifecycle](./phase-03.md) |
| 04 | Dashboard and documents | Pending | 0% | 10h | [Dashboard](./phase-04.md) |
| 05 | Full-app qualification | Pending | 0% | 8h | [Qualification](./phase-05.md) |
"#;

    let progress_md = r#"# Current Progress — Project Plans Dashboard

**Current status:** Completed

## Phase Reconciliation

| Phase | Current status | Captured status | Completion basis / scope |
|---|---|---|---|
| [01 — File parsing](./phase-01.md) | Completed | Pending (initial snapshot) | Implemented |
| [02 — Native read API](./phase-02.md) | Completed | Pending (initial snapshot) | Implemented |
| [03 — Owner-bound client](./phase-03.md) | Completed | Pending (initial snapshot) | Implemented |
| [04 — Dashboard and documents](./phase-04.md) | Completed | Pending (initial snapshot) | Implemented |
| [05 — Full-app qualification](./phase-05.md) | Completed | Pending (initial snapshot) | Implemented |
"#;

    let plan_doc = make_readable_snapshot("plans/test-plan/plan.md", plan_md);
    let progress_doc = make_readable_snapshot("plans/test-plan/progress.md", progress_md);

    let parsed = parse_plan("plans/test-plan", &plan_doc, &progress_doc);

    assert_eq!(parsed.id, "plans/test-plan");
    assert_eq!(parsed.title.as_deref(), Some("Project Plans Dashboard"));
    assert_eq!(parsed.reported_status.value, PlanStatus::Completed);
    assert_eq!(parsed.reported_status.authority, PlanAuthority::Progress);

    assert_eq!(parsed.phases.len(), 5);
    for phase in &parsed.phases {
        assert_eq!(phase.reported_status.value, PlanStatus::Completed);
        assert_eq!(phase.reported_status.authority, PlanAuthority::Progress);
        assert_eq!(phase.reported_status.captured.len(), 1);
        assert_eq!(phase.reported_status.captured[0].value, PlanStatus::Pending);
    }

    assert_eq!(parsed.completion.declared, Some(5));
    assert_eq!(parsed.completion.completed, 5);
    assert_eq!(parsed.completion.unknown, 0);
    assert_eq!(parsed.completion.conflicted, 0);
    assert_eq!(parsed.completion.fraction, Some(1.0));
    assert!(parsed.diagnostics.is_empty());
}

#[test]
fn test_bold_done_and_parenthesized_qualifier() {
    let plan_md = r#"# My Plan

## Phases

| # | Phase | Status |
|---|---|---|
| 01 | Setup | **DONE** (verified) |
| 02 | Work | In-Progress (active) |
| 03 | Next | Pending (initial) |
"#;
    let plan_doc = make_readable_snapshot("plans/p/plan.md", plan_md);
    let progress_doc = make_absent_snapshot("plans/p/progress.md");

    let parsed = parse_plan("plans/p", &plan_doc, &progress_doc);

    assert_eq!(parsed.phases.len(), 3);
    assert_eq!(parsed.phases[0].reported_status.value, PlanStatus::Completed);
    assert_eq!(parsed.phases[1].reported_status.value, PlanStatus::InProgress);
    assert_eq!(parsed.phases[2].reported_status.value, PlanStatus::Pending);
    assert_eq!(parsed.reported_status.value, PlanStatus::InProgress);
    assert_eq!(parsed.reported_status.authority, PlanAuthority::Plan);
}

#[test]
fn test_reordered_columns_in_progress() {
    let plan_md = r#"# Reorder Test

## Phases

| Phase | # | Status |
|---|---|---|
| [Phase One](./one.md) | 1 | Pending |
"#;
    let progress_md = r#"# Progress

## Phase Reconciliation

| Captured status | Current status | Phase |
|---|---|---|
| Pending | Completed | [Phase One](./one.md) |
"#;

    let plan_doc = make_readable_snapshot("plans/reorder/plan.md", plan_md);
    let progress_doc = make_readable_snapshot("plans/reorder/progress.md", progress_md);

    let parsed = parse_plan("plans/reorder", &plan_doc, &progress_doc);

    assert_eq!(parsed.phases.len(), 1);
    assert_eq!(parsed.phases[0].reported_status.value, PlanStatus::Completed);
    assert_eq!(parsed.phases[0].reported_status.captured.len(), 1);
    assert_eq!(parsed.phases[0].reported_status.captured[0].value, PlanStatus::Pending);
}

#[test]
fn test_completion_summary_corroboration_and_conflict() {
    let plan_md = r#"# Summary Test

## Phases

| # | Phase | Status |
|---|---|---|
| 01 | One | Pending |
| 02 | Two | Pending |
"#;

    // Case A: Summary claims complete but rows are pending -> conflict
    let progress_conflict_md = r#"# Progress

All phases complete with durable task sealing. Plan execution complete.

## Phase Reconciliation

| Phase | Current status |
|---|---|
| 01 | Completed |
| 02 | Pending |
"#;

    let plan_doc = make_readable_snapshot("plans/s/plan.md", plan_md);
    let prog_conflict = make_readable_snapshot("plans/s/progress.md", progress_conflict_md);
    let parsed_conflict = parse_plan("plans/s", &plan_doc, &prog_conflict);

    assert_eq!(parsed_conflict.reported_status.value, PlanStatus::Conflict);
    assert!(parsed_conflict.diagnostics.iter().any(|d| d.code == DIAG_STATUS_CONFLICT));

    // Case B: Summary with negation -> unsupported prose / unknown
    let progress_neg_md = r#"# Progress

All phases are not complete yet.

## Phase Reconciliation

| Phase | Current status |
|---|---|
| 01 | Completed |
| 02 | Completed |
"#;
    let prog_neg = make_readable_snapshot("plans/s/progress.md", progress_neg_md);
    let parsed_neg = parse_plan("plans/s", &plan_doc, &prog_neg);
    assert_eq!(parsed_neg.reported_status.value, PlanStatus::Unknown);
}

#[test]
fn test_absent_progress_with_missing_warning_and_plan_conflict() {
    // Plan links to progress.md which is absent -> PROGRESS_MISSING
    // Also frontmatter claims completed but inventory is pending -> STATUS_CONFLICT
    let plan_md = r#"---
status: completed
---

# Missing Progress Test

See [progress.md](./progress.md) for details.

## Phases

| # | Phase | Status |
|---|---|---|
| 01 | Initial | Pending |
"#;

    let plan_doc = make_readable_snapshot("plans/absent/plan.md", plan_md);
    let progress_doc = make_absent_snapshot("plans/absent/progress.md");

    let parsed = parse_plan("plans/absent", &plan_doc, &progress_doc);

    assert_eq!(parsed.reported_status.value, PlanStatus::Conflict);
    assert_eq!(parsed.reported_status.authority, PlanAuthority::Plan);
    assert!(parsed.diagnostics.iter().any(|d| d.code == DIAG_PROGRESS_MISSING));
    assert!(parsed.diagnostics.iter().any(|d| d.code == DIAG_STATUS_CONFLICT));
}

#[test]
fn test_unmatched_and_unreported_phases() {
    let plan_md = r#"# Unmatched Test

## Phases

| # | Phase | Status |
|---|---|---|
| 01 | One | Pending |
| 02 | Two | Pending |
"#;

    let progress_md = r#"# Progress

## Phase Reconciliation

| # | Current status |
|---|---|
| 01 | Completed |
| 03 | Completed |
"#;

    let plan_doc = make_readable_snapshot("plans/u/plan.md", plan_md);
    let progress_doc = make_readable_snapshot("plans/u/progress.md", progress_md);

    let parsed = parse_plan("plans/u", &plan_doc, &progress_doc);

    // Phase 02 is declared in plan but unreported in progress -> unknown
    assert_eq!(parsed.phases[1].reported_status.value, PlanStatus::Unknown);
    assert!(parsed.diagnostics.iter().any(|d| d.code == DIAG_PHASE_UNREPORTED));
    // Phase 03 is in progress but undeclared in plan -> unmatched diagnostic
    assert!(parsed.diagnostics.iter().any(|d| d.code == DIAG_PHASE_UNMATCHED));
}

#[test]
fn test_rejected_absolute_link() {
    let plan_md = r#"# Link Test

## Phases

| # | Phase | Status | Detail |
|---|---|---|---|
| 01 | External | Pending | [Doc](https://example.com/doc.md) |
"#;

    let plan_doc = make_readable_snapshot("plans/link/plan.md", plan_md);
    let progress_doc = make_absent_snapshot("plans/link/progress.md");

    let parsed = parse_plan("plans/link", &plan_doc, &progress_doc);

    assert!(parsed.diagnostics.iter().any(|d| d.code == DIAG_LINK_REJECTED));
}

#[test]
fn test_date_parsing_and_conflict_reconciliation() {
    let plan_md = r#"---
created: 2026-10-01
planned_start: 2026-10-02
planned_end: 2026-10-10
actual_start: 2026-10-03
---

# Date Test
"#;

    // Progress specifies conflicting actual_start -> should suppress endpoint and emit DATE_CONFLICT
    let progress_md = r#"# Progress

- **Actual start:** 2026-10-04
- **Published:** 2026-10-06T12:00:00Z
"#;

    let plan_doc = make_readable_snapshot("plans/d/plan.md", plan_md);
    let progress_doc = make_readable_snapshot("plans/d/progress.md", progress_md);

    let parsed = parse_plan("plans/d", &plan_doc, &progress_doc);

    // Created from plan
    assert_eq!(parsed.dates.created.as_ref().map(|d| d.value.as_str()), Some("2026-10-01"));
    assert_eq!(parsed.dates.created.as_ref().map(|d| d.precision), Some(DatePrecision::Day));

    // Planned from plan
    assert_eq!(parsed.dates.planned_start.as_ref().map(|d| d.value.as_str()), Some("2026-10-02"));
    assert_eq!(parsed.dates.planned_end.as_ref().map(|d| d.value.as_str()), Some("2026-10-10"));

    // Actual start conflict -> suppressed
    assert!(parsed.dates.actual_start.is_none());
    assert!(parsed.diagnostics.iter().any(|d| d.code == DIAG_DATE_CONFLICT));

    // Published from progress with instant precision
    assert_eq!(parsed.dates.published.as_ref().map(|d| d.value.as_str()), Some("2026-10-06T12:00:00+00:00"));
    assert_eq!(parsed.dates.published.as_ref().map(|d| d.precision), Some(DatePrecision::Instant));
}

#[test]
fn test_invalid_leap_date_and_mixed_precision_range() {
    let plan_md = r#"---
planned_start: 2026-02-29
---

# Leap Day Test
"#;
    let plan_doc = make_readable_snapshot("plans/leap/plan.md", plan_md);
    let progress_doc = make_absent_snapshot("plans/leap/progress.md");

    let parsed = parse_plan("plans/leap", &plan_doc, &progress_doc);
    assert!(parsed.dates.planned_start.is_none());
    assert!(parsed.diagnostics.iter().any(|d| d.code == DIAG_INVALID_DATE));
}

#[test]
fn test_document_size_limit_and_nul_byte_rejection() {
    // 1. NUL byte
    let nul_bytes = b"# Plan\0with null";
    let nul_doc = DocumentSnapshot {
        path: "plans/nul/plan.md",
        state: PlanDocumentState::Readable,
        bytes: Some(nul_bytes),
        size_bytes: Some(nul_bytes.len() as u64),
        modified_at: None,
    };
    let progress_doc = make_absent_snapshot("plans/nul/progress.md");
    let parsed_nul = parse_plan("plans/nul", &nul_doc, &progress_doc);
    assert!(parsed_nul.diagnostics.iter().any(|d| d.code == DIAG_INVALID_DOCUMENT));

    // 2. Oversize document (> 64 KiB)
    let oversize_bytes = vec![b'a'; 65537];
    let oversize_doc = DocumentSnapshot {
        path: "plans/big/plan.md",
        state: PlanDocumentState::Readable,
        bytes: Some(&oversize_bytes),
        size_bytes: Some(oversize_bytes.len() as u64),
        modified_at: None,
    };
    let parsed_big = parse_plan("plans/big", &oversize_doc, &progress_doc);
    assert!(parsed_big.diagnostics.iter().any(|d| d.code == DIAG_DOCUMENT_TOO_LARGE));
}

#[test]
fn test_empty_and_invalid_phase_inventory() {
    let plan_md = r#"# No Phases Here
Just a description.
"#;
    let plan_doc = make_readable_snapshot("plans/empty/plan.md", plan_md);
    let progress_doc = make_absent_snapshot("plans/empty/progress.md");

    let parsed = parse_plan("plans/empty", &plan_doc, &progress_doc);
    assert!(parsed.phases.is_empty());
    assert_eq!(parsed.completion.declared, None);
    assert_eq!(parsed.completion.fraction, None);
}

#[test]
fn test_reversed_date_range_and_mixed_precision() {
    // Case A: reversed planned range (start > end)
    let plan_md = r#"---
planned_start: 2026-10-15
planned_end: 2026-10-01
---

# Reversed Dates
"#;
    let plan_doc = make_readable_snapshot("plans/rev/plan.md", plan_md);
    let progress_doc = make_absent_snapshot("plans/rev/progress.md");
    let parsed = parse_plan("plans/rev", &plan_doc, &progress_doc);
    assert!(parsed.diagnostics.iter().any(|d| d.code == DIAG_INVALID_DATE && d.message.contains("start is after end")));

    // Case B: mixed precision (Day start, Instant end)
    let plan_mixed = r#"---
actual_start: 2026-10-01
actual_end: 2026-10-15T12:00:00Z
---

# Mixed Precision
"#;
    let plan_doc_mixed = make_readable_snapshot("plans/mix/plan.md", plan_mixed);
    let parsed_mixed = parse_plan("plans/mix", &plan_doc_mixed, &progress_doc);
    assert!(parsed_mixed.diagnostics.iter().any(|d| d.code == DIAG_INVALID_DATE && d.message.contains("mixed date precision")));
}

#[test]
fn test_tags_limit_and_metadata_bounds() {
    // 35 tags (> 32 limit) and oversize priority (> 4 KiB)
    let mut tags_yaml = String::from("tags:\n");
    for i in 1..=35 {
        tags_yaml.push_str(&format!("  - tag_{i}\n"));
    }
    let huge_p = "x".repeat(5000);
    let plan_md = format!(
        "---\npriority: \"{huge_p}\"\n{tags_yaml}---\n\n# Tags Test\n"
    );
    let plan_doc = make_readable_snapshot("plans/tags/plan.md", &plan_md);
    let progress_doc = make_absent_snapshot("plans/tags/progress.md");

    let parsed = parse_plan("plans/tags", &plan_doc, &progress_doc);
    assert_eq!(parsed.metadata.tags.len(), 32);
    assert!(parsed.diagnostics.iter().any(|d| d.code == DIAG_SCAN_LIMIT));
    assert!(parsed.metadata.priority.is_none());
    assert!(parsed.diagnostics.iter().any(|d| d.code == DIAG_FIELD_TOO_LARGE));
}

#[test]
fn test_diagnostics_cap_at_32() {
    // Plan with invalid links on 40 rows
    let mut table = String::from("| # | Phase | Status | Detail |\n|---|---|---|---|\n");
    for i in 1..=40 {
        table.push_str(&format!("| {i:02} | P{i} | Pending | [link](https://bad.com/{i}) |\n"));
    }
    let plan_md = format!("# Many Diags\n\n## Phases\n\n{table}");
    let plan_doc = make_readable_snapshot("plans/cap/plan.md", &plan_md);
    let progress_doc = make_absent_snapshot("plans/cap/progress.md");

    let parsed = parse_plan("plans/cap", &plan_doc, &progress_doc);
    assert_eq!(parsed.diagnostics.len(), 32);
    assert_eq!(parsed.diagnostics[31].code, DIAG_DIAGNOSTICS_LIMIT);
}

#[test]
fn test_yaml_duplicate_keys_and_aliases_rejected() {
    let plan_dup = r#"---
title: "First"
title: "Second"
---

# Plan
"#;
    let plan_doc = make_readable_snapshot("plans/dup/plan.md", plan_dup);
    let progress_doc = make_absent_snapshot("plans/dup/progress.md");
    let parsed = parse_plan("plans/dup", &plan_doc, &progress_doc);
    assert!(parsed.diagnostics.iter().any(|d| d.code == DIAG_INVALID_METADATA));

    let plan_alias = r#"---
base: &anchor "val"
other: *anchor
---

# Plan Alias
"#;
    let alias_doc = make_readable_snapshot("plans/alias/plan.md", plan_alias);
    let parsed_alias = parse_plan("plans/alias", &alias_doc, &progress_doc);
    assert!(parsed_alias.diagnostics.iter().any(|d| d.code == DIAG_INVALID_METADATA));
}

#[test]
fn test_summary_range_validation_and_unsupported_diagnostic() {
    let plan_md = r#"# Range Plan

## Phases

| # | Phase | Status |
|---|---|---|
| 01 | One | Pending |
| 02 | Two | Pending |
"#;
    let plan_doc = make_readable_snapshot("plans/rng/plan.md", plan_md);

    // Summary claims 01–05 when only 01–02 exist -> conflict
    let prog_bad_range = r#"# Progress

All phases (01–05) are completed.

## Phase Reconciliation

| # | Current status |
|---|---|
| 01 | Completed |
| 02 | Completed |
"#;
    let prog_doc = make_readable_snapshot("plans/rng/progress.md", prog_bad_range);
    let parsed = parse_plan("plans/rng", &plan_doc, &prog_doc);
    assert_eq!(parsed.reported_status.value, PlanStatus::Conflict);
    assert!(parsed.diagnostics.iter().any(|d| d.code == DIAG_STATUS_CONFLICT));

    // Negated summary emits DIAG_UNSUPPORTED_STATUS
    let prog_neg = r#"# Progress

All phases are not complete.

## Phase Reconciliation

| # | Current status |
|---|---|
| 01 | Completed |
| 02 | Completed |
"#;
    let prog_neg_doc = make_readable_snapshot("plans/rng/progress.md", prog_neg);
    let parsed_neg = parse_plan("plans/rng", &plan_doc, &prog_neg_doc);
    assert_eq!(parsed_neg.reported_status.value, PlanStatus::Unknown);
    assert!(parsed_neg.diagnostics.iter().any(|d| d.code == DIAG_UNSUPPORTED_STATUS));
}

#[test]
fn test_relative_escape_and_scheme_links_rejected() {
    let plan_md = r#"# Escape Links

## Phases

| # | Phase | Status | Detail |
|---|---|---|---|
| 01 | Escape | Pending | [Esc](../outside.md) |
| 02 | Scheme | Pending | [JS](javascript:alert(1)) |
"#;
    let plan_doc = make_readable_snapshot("plans/esc/plan.md", plan_md);
    let progress_doc = make_absent_snapshot("plans/esc/progress.md");

    let parsed = parse_plan("plans/esc", &plan_doc, &progress_doc);
    assert_eq!(parsed.phases.len(), 2);
    assert!(parsed.phases[0].path.is_none());
    assert_eq!(parsed.phases[0].id, "phase:1");
    assert!(parsed.phases[1].path.is_none());
    assert_eq!(parsed.phases[1].id, "phase:2");
    assert_eq!(parsed.diagnostics.iter().filter(|d| d.code == DIAG_LINK_REJECTED).count(), 2);
}

#[test]
fn test_multi_bracket_cell_link_extraction() {
    let plan_md = r#"# Bracket Links

## Phases

| # | Phase | Status | Detail |
|---|---|---|---|
| 01 | [P1] [Phase One](./phase-01.md) | Pending | [Tag] [Spec](./phase-01.md) |
"#;
    let plan_doc = make_readable_snapshot("plans/brk/plan.md", plan_md);
    let progress_doc = make_absent_snapshot("plans/brk/progress.md");

    let parsed = parse_plan("plans/brk", &plan_doc, &progress_doc);
    assert_eq!(parsed.phases.len(), 1);
    assert_eq!(parsed.phases[0].path.as_deref(), Some("phase-01.md"));
    assert_eq!(parsed.phases[0].id, "phase-01.md");
}
