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
    assert_eq!(
        parsed.phases[0].reported_status.value,
        PlanStatus::Completed
    );
    assert_eq!(
        parsed.phases[1].reported_status.value,
        PlanStatus::InProgress
    );
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
    assert_eq!(
        parsed.phases[0].reported_status.value,
        PlanStatus::Completed
    );
    assert_eq!(parsed.phases[0].reported_status.captured.len(), 1);
    assert_eq!(
        parsed.phases[0].reported_status.captured[0].value,
        PlanStatus::Pending
    );
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
    assert!(parsed_conflict
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_STATUS_CONFLICT));

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
    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_PROGRESS_MISSING));
    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_STATUS_CONFLICT));
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
    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_PHASE_UNREPORTED));
    // Phase 03 is in progress but undeclared in plan -> unmatched diagnostic
    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_PHASE_UNMATCHED));
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

    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_LINK_REJECTED));
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
    assert_eq!(
        parsed.dates.created.as_ref().map(|d| d.value.as_str()),
        Some("2026-10-01")
    );
    assert_eq!(
        parsed.dates.created.as_ref().map(|d| d.precision),
        Some(DatePrecision::Day)
    );

    // Planned from plan
    assert_eq!(
        parsed
            .dates
            .planned_start
            .as_ref()
            .map(|d| d.value.as_str()),
        Some("2026-10-02")
    );
    assert_eq!(
        parsed.dates.planned_end.as_ref().map(|d| d.value.as_str()),
        Some("2026-10-10")
    );

    // Actual start conflict -> suppressed
    assert!(parsed.dates.actual_start.is_none());
    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_DATE_CONFLICT));

    // Published from progress with instant precision
    assert_eq!(
        parsed.dates.published.as_ref().map(|d| d.value.as_str()),
        Some("2026-10-06T12:00:00+00:00")
    );
    assert_eq!(
        parsed.dates.published.as_ref().map(|d| d.precision),
        Some(DatePrecision::Instant)
    );
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
    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_INVALID_DATE));
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
    assert!(parsed_nul
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_INVALID_DOCUMENT));

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
    assert!(parsed_big
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_DOCUMENT_TOO_LARGE));
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
    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_INVALID_DATE && d.message.contains("start is after end")));

    // Case B: mixed precision (Day start, Instant end)
    let plan_mixed = r#"---
actual_start: 2026-10-01
actual_end: 2026-10-15T12:00:00Z
---

# Mixed Precision
"#;
    let plan_doc_mixed = make_readable_snapshot("plans/mix/plan.md", plan_mixed);
    let parsed_mixed = parse_plan("plans/mix", &plan_doc_mixed, &progress_doc);
    assert!(parsed_mixed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_INVALID_DATE && d.message.contains("mixed date precision")));
}

#[test]
fn test_tags_limit_and_metadata_bounds() {
    // 35 tags (> 32 limit) and oversize priority (> 4 KiB)
    let mut tags_yaml = String::from("tags:\n");
    for i in 1..=35 {
        tags_yaml.push_str(&format!("  - tag_{i}\n"));
    }
    let huge_p = "x".repeat(5000);
    let plan_md = format!("---\npriority: \"{huge_p}\"\n{tags_yaml}---\n\n# Tags Test\n");
    let plan_doc = make_readable_snapshot("plans/tags/plan.md", &plan_md);
    let progress_doc = make_absent_snapshot("plans/tags/progress.md");

    let parsed = parse_plan("plans/tags", &plan_doc, &progress_doc);
    assert_eq!(parsed.metadata.tags.len(), 32);
    assert!(parsed.diagnostics.iter().any(|d| d.code == DIAG_SCAN_LIMIT));
    assert!(parsed.metadata.priority.is_none());
    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_FIELD_TOO_LARGE));
}

#[test]
fn test_diagnostics_cap_at_32() {
    // Plan with invalid links on 40 rows
    let mut table = String::from("| # | Phase | Status | Detail |\n|---|---|---|---|\n");
    for i in 1..=40 {
        table.push_str(&format!(
            "| {i:02} | P{i} | Pending | [link](https://bad.com/{i}) |\n"
        ));
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
    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_INVALID_METADATA));

    let plan_alias = r#"---
base: &anchor "val"
other: *anchor
---

# Plan Alias
"#;
    let alias_doc = make_readable_snapshot("plans/alias/plan.md", plan_alias);
    let parsed_alias = parse_plan("plans/alias", &alias_doc, &progress_doc);
    assert!(parsed_alias
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_INVALID_METADATA));
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
    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_STATUS_CONFLICT));

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
    assert!(parsed_neg
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_UNSUPPORTED_STATUS));
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
    assert_eq!(
        parsed
            .diagnostics
            .iter()
            .filter(|d| d.code == DIAG_LINK_REJECTED)
            .count(),
        2
    );
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

#[test]
fn test_progress_identity_hints_and_duplicate_rows_never_complete_wrong_phases() {
    let plan_md = "# Identity\n\n## Phases\n\n\
        | # | Phase | Status | Detail |\n|---|---|---|---|\n\
        | 1 | One | Completed | [One](./one.md) |\n\
        | 2 | Two | Completed | [Two](./two.md) |\n\
        | 3 | Three | Pending | [Three](./three.md) |\n";
    let plan_doc = make_readable_snapshot("plans/identity/plan.md", plan_md);
    for rows in [
        "| [02](./one.md) | Completed |\n",
        "| [01](./missing.md) | Completed |\n| 2 | Pending |\n",
        "| [99](./one.md) | Completed |\n| 2 | Pending |\n",
        "| [01](./one.md) | Completed |\n| 1 | Pending |\n| 2 | Pending |\n",
        "| 1 | Pending |\n| [01](./one.md) | Completed |\n| 2 | Pending |\n",
        "| 1 | Completed |\n| 1 | Completed |\n| 2 | Pending |\n",
    ] {
        let progress_md = format!(
            "# Progress\n\n## Phase Reconciliation\n\n\
             | Phase | Current status |\n|---|---|\n{rows}| 3 | Completed |\n"
        );
        let progress_doc = make_readable_snapshot("plans/identity/progress.md", &progress_md);
        let parsed = parse_plan("plans/identity", &plan_doc, &progress_doc);
        assert_eq!(parsed.phases.len(), 3, "{rows}");
        assert_eq!(parsed.phases[0].id, "one.md");
        assert_eq!(
            parsed.phases[0].reported_status.value,
            PlanStatus::Conflict,
            "{rows}"
        );
        assert_ne!(
            parsed.phases[1].reported_status.value,
            PlanStatus::Completed,
            "{rows}"
        );
        assert_eq!(
            parsed.phases[2].reported_status.value,
            PlanStatus::Completed,
            "{rows}"
        );
        assert_eq!(parsed.completion.declared, Some(3));
        assert_eq!(parsed.completion.completed, 1);
        assert_eq!(parsed.completion.fraction, Some(1.0 / 3.0));
        assert_ne!(
            parsed.reported_status.value,
            PlanStatus::Completed,
            "{rows}"
        );
        assert!(parsed
            .diagnostics
            .iter()
            .any(|d| d.code == DIAG_STATUS_CONFLICT));
        assert!(parsed
            .diagnostics
            .iter()
            .any(|d| d.code == DIAG_PHASE_UNMATCHED));
    }

    // Agreeing hints, link-only, and number-only each consume one distinct row.
    let progress_md = "# Progress\n\n## Phase Reconciliation\n\n\
        | Phase | Current status |\n|---|---|\n\
        | [01](./one.md) | Completed |\n\
        | [Two](./two.md) | Completed |\n\
        | 3 | Completed |\n";
    let progress_doc = make_readable_snapshot("plans/identity/progress.md", progress_md);
    let parsed = parse_plan("plans/identity", &plan_doc, &progress_doc);
    assert_eq!(parsed.completion.completed, 3);
    assert_eq!(parsed.completion.fraction, Some(1.0));
    assert_eq!(parsed.reported_status.value, PlanStatus::Completed);
    assert!(parsed.diagnostics.is_empty());
}

#[test]
fn test_unreadable_progress_retains_inventory_and_captured_plan_evidence_only() {
    let plan_md = "# Frozen\n\n## Phases\n\n\
        | # | Phase | Status | Detail |\n|---|---|---|---|\n\
        | 1 | One | Completed | [One](./one.md) |\n\
        | 2 | Two | Completed | [Two](./two.md) |\n";
    let plan_doc = make_readable_snapshot("plans/frozen/plan.md", plan_md);
    for state in [
        PlanDocumentState::Unreadable,
        PlanDocumentState::Invalid,
        PlanDocumentState::Oversize,
        PlanDocumentState::Changed,
        PlanDocumentState::Readable,
    ] {
        let progress_doc = DocumentSnapshot {
            path: "plans/frozen/progress.md",
            state,
            bytes: Some(b"# Progress\0invalid"),
            size_bytes: Some(18),
            modified_at: None,
        };
        let parsed = parse_plan("plans/frozen", &plan_doc, &progress_doc);
        assert_eq!(
            parsed.reported_status.value,
            PlanStatus::Unknown,
            "{state:?}"
        );
        assert_eq!(parsed.reported_status.authority, PlanAuthority::Progress);
        assert_eq!(parsed.phases.len(), 2);
        for (index, phase) in parsed.phases.iter().enumerate() {
            assert_eq!(phase.number, Some(index as u32 + 1));
            assert_eq!(
                phase.path.as_deref(),
                Some(if index == 0 { "one.md" } else { "two.md" })
            );
            assert_eq!(phase.reported_status.value, PlanStatus::Unknown);
            assert_eq!(phase.reported_status.authority, PlanAuthority::Progress);
            assert!(phase.reported_status.raw.is_none());
            assert!(phase.reported_status.evidence.is_empty());
            assert_eq!(phase.reported_status.captured.len(), 1);
            let captured = &phase.reported_status.captured[0];
            assert_eq!(captured.value, PlanStatus::Completed);
            assert_eq!(captured.raw, "Completed");
            assert_eq!(captured.evidence.path, "plans/frozen/plan.md");
            assert_eq!(captured.evidence.line_start, 7 + index);
        }
        assert_eq!(parsed.completion.declared, Some(2));
        assert_eq!(parsed.completion.completed, 0);
        assert_eq!(parsed.completion.unknown, 2);
        assert_eq!(parsed.completion.fraction, None);
        assert!(parsed
            .diagnostics
            .iter()
            .any(|d| d.code == DIAG_PROGRESS_UNREADABLE));
    }
}

#[test]
fn test_short_gfm_rows_preserve_declared_and_current_denominators() {
    let plan_md = "# Short rows\n\n## Phases\n\n\
        | # | Phase | Status | Detail |\n|---|---|---|---|\n\
        | 1 | One | Completed | [One](./one.md) |\n\
        2 | Two | Pending\n\
        | 3 | Three\n";
    let plan_doc = make_readable_snapshot("plans/short/plan.md", plan_md);
    let absent = make_absent_snapshot("plans/short/progress.md");
    let parsed = parse_plan("plans/short", &plan_doc, &absent);
    assert_eq!(parsed.phases.len(), 3);
    assert_eq!(parsed.phases[1].id, "phase:2");
    assert_eq!(parsed.phases[1].reported_status.value, PlanStatus::Pending);
    assert_eq!(parsed.phases[2].reported_status.value, PlanStatus::Unknown);
    assert_eq!(parsed.completion.declared, Some(3));
    assert_eq!(parsed.completion.completed, 1);
    assert_eq!(parsed.completion.unknown, 1);
    assert_eq!(parsed.completion.fraction, Some(1.0 / 3.0));
    assert!(parsed.diagnostics.is_empty());

    let progress_md = "# Progress\n\n## Phase Reconciliation\n\n\
        | Phase | Current status | Captured status | Detail |\n|---|---|---|---|\n\
        | 1 | Completed | Pending | Sealed |\n\
        2 | Pending\n\
        | 3\n";
    let progress_doc = make_readable_snapshot("plans/short/progress.md", progress_md);
    let parsed = parse_plan("plans/short", &plan_doc, &progress_doc);
    assert_eq!(parsed.phases.len(), 3);
    assert_eq!(
        parsed.phases[0].reported_status.captured[0].value,
        PlanStatus::Pending
    );
    assert_eq!(parsed.phases[1].reported_status.value, PlanStatus::Pending);
    assert_eq!(parsed.phases[2].reported_status.value, PlanStatus::Unknown);
    assert_eq!(parsed.completion.fraction, Some(1.0 / 3.0));
    assert!(parsed.diagnostics.is_empty());
}

#[test]
fn test_explicit_current_status_column_wins_in_both_orders_and_when_empty() {
    let plan_md = "# Columns\n\n## Phases\n\n\
        | # | Phase | Status |\n|---|---|---|\n| 1 | One | Pending |\n";
    let plan_doc = make_readable_snapshot("plans/columns/plan.md", plan_md);
    for (header, row, expected, fraction) in [
        (
            "Phase | Status | Current status",
            "1 | Pending | Completed",
            PlanStatus::Completed,
            Some(1.0),
        ),
        (
            "Phase | Current status | Status",
            "1 | Completed | Pending",
            PlanStatus::Completed,
            Some(1.0),
        ),
        (
            "Phase | Status | Current status",
            "1 | Completed",
            PlanStatus::Unknown,
            None,
        ),
        (
            "Phase | Status",
            "1 | Completed",
            PlanStatus::Completed,
            Some(1.0),
        ),
    ] {
        let delimiter = vec!["---"; header.split('|').count()].join("|");
        let plan_table =
            format!("# Columns\n\n## Phases\n\n| {header} |\n|{delimiter}|\n| {row} |\n");
        let table_doc = make_readable_snapshot("plans/columns/plan.md", &plan_table);
        let absent = make_absent_snapshot("plans/columns/progress.md");
        let fallback = parse_plan("plans/columns", &table_doc, &absent);
        assert_eq!(
            fallback.phases[0].reported_status.value, expected,
            "{header}"
        );
        assert_eq!(fallback.completion.fraction, fraction, "{header}");
        let progress_md = format!(
            "# Progress\n\n## Phase Reconciliation\n\n| {header} |\n|{delimiter}|\n| {row} |\n"
        );
        let progress_doc = make_readable_snapshot("plans/columns/progress.md", &progress_md);
        let parsed = parse_plan("plans/columns", &plan_doc, &progress_doc);
        assert_eq!(parsed.phases[0].reported_status.value, expected, "{header}");
        assert_eq!(parsed.reported_status.value, expected, "{header}");
        assert_eq!(parsed.completion.fraction, fraction, "{header}");
    }
}

#[test]
fn test_labelled_completion_prose_uses_corroboration_range_and_negation_checks() {
    let plan_md = "# Summary\n\n## Phases\n\n\
        | # | Phase | Status |\n|---|---|---|\n\
        | 1 | One | Pending |\n| 2 | Two | Pending |\n";
    let plan_doc = make_readable_snapshot("plans/labelled/plan.md", plan_md);
    for (value, second_status, expected, diagnostic) in [
        ("All phases (Phase 01–02) completed with durable task sealing. Plan execution complete.", "Completed", PlanStatus::Completed, None),
        ("All phases (Phase 01 and Phase 02) are completed.", "Completed", PlanStatus::Completed, None),
        ("Plan execution complete.", "Completed", PlanStatus::Completed, None),
        ("All phases (01–03) completed.", "Completed", PlanStatus::Conflict, Some(DIAG_STATUS_CONFLICT)),
        ("All phases (01–02) completed.", "Pending", PlanStatus::Conflict, Some(DIAG_STATUS_CONFLICT)),
        ("All phases (01–02) completed.", "", PlanStatus::Conflict, Some(DIAG_STATUS_CONFLICT)),
        ("All phases are not complete.", "Completed", PlanStatus::Unknown, Some(DIAG_UNSUPPORTED_STATUS)),
        ("All phases complete if verification passes.", "Completed", PlanStatus::Unknown, Some(DIAG_UNSUPPORTED_STATUS)),
        ("All phases (01–02) incomplete.", "Completed", PlanStatus::Unknown, Some(DIAG_UNSUPPORTED_STATUS)),
        ("Not all phases (01–02) completed.", "Completed", PlanStatus::Unknown, Some(DIAG_UNSUPPORTED_STATUS)),
        ("All phases (Phase 01–bogus) completed.", "Completed", PlanStatus::Unknown, Some(DIAG_UNSUPPORTED_STATUS)),
        ("All phases (01–02oops) completed.", "Completed", PlanStatus::Unknown, Some(DIAG_UNSUPPORTED_STATUS)),
        ("All phases () completed.", "Completed", PlanStatus::Unknown, Some(DIAG_UNSUPPORTED_STATUS)),
        ("All phases (01 and bogus) completed.", "Completed", PlanStatus::Unknown, Some(DIAG_UNSUPPORTED_STATUS)),
        ("All phases (02–01) completed.", "Completed", PlanStatus::Unknown, Some(DIAG_UNSUPPORTED_STATUS)),
        ("All phases (01–02) completed. Not really.", "Completed", PlanStatus::Unknown, Some(DIAG_UNSUPPORTED_STATUS)),
        ("All phases (01–02) completed unless verification fails.", "Completed", PlanStatus::Unknown, Some(DIAG_UNSUPPORTED_STATUS)),
        ("Plan execution incomplete.", "Completed", PlanStatus::Unknown, Some(DIAG_UNSUPPORTED_STATUS)),
        // Explicit administrative scalars remain independent of phase completion.
        ("Completed", "Pending", PlanStatus::Completed, None),
        ("Completed (not independently verified)", "Pending", PlanStatus::Completed, None),
    ] {
        let progress_md = format!(
            "# Progress\n\n**Current status:** {value}\n\n\
             ## Phase Reconciliation\n\n| Phase | Current status |\n|---|---|\n\
             | 1 | Completed |\n| 2 | {second_status} |\n"
        );
        let progress_doc = make_readable_snapshot("plans/labelled/progress.md", &progress_md);
        let parsed = parse_plan("plans/labelled", &plan_doc, &progress_doc);
        assert_eq!(parsed.reported_status.value, expected, "{value} / {second_status}");
        assert_eq!(parsed.reported_status.raw.as_deref(), Some(value));
        assert_eq!(parsed.reported_status.evidence[0].line_start, 3);
        if let Some(code) = diagnostic {
            assert!(parsed.diagnostics.iter().any(|d| d.code == code), "{value}");
        } else {
            assert!(parsed.diagnostics.is_empty(), "{value}");
        }
    }
}

#[test]
fn test_gfm_optional_edge_pipes_preserve_short_inventory() {
    for (header, delimiter) in [
        ("| # | Phase | Status | Detail |", "|---|---|---|---|"),
        ("# | Phase | Status | Detail", "---|---|---|---"),
    ] {
        let text = format!(
            "# Mixed edges\n\n## Phases\n\n{header}\n{delimiter}\n\
             | 1 | One | Completed | [One](./one.md) |\n2 | Two | Pending\n"
        );
        let plan = make_readable_snapshot("plans/mixed/plan.md", &text);
        let progress = make_absent_snapshot("plans/mixed/progress.md");
        let parsed = parse_plan("plans/mixed", &plan, &progress);
        assert_eq!(parsed.phases.len(), 2);
        assert_eq!(parsed.phases[1].reported_status.value, PlanStatus::Pending);
        assert_eq!(parsed.completion.declared, Some(2));
        assert_eq!(parsed.completion.completed, 1);
        assert_eq!(parsed.completion.fraction, Some(0.5));
        assert!(parsed.diagnostics.is_empty());
    }
}

#[test]
fn test_bare_gfm_cells_preserve_inventory_and_table_block_termination() {
    for terminator in [
        "\n",
        "> Outside\n",
        "### Outside\n",
        "- Outside\n",
        "```\n",
        "---\n",
        "<div>\n",
    ] {
        let text = format!(
            "# Bare cells\n\n## Phases\n\n| # | Phase | Status | Detail |\n|---|---|---|---|\n\
             | 1 | One | Completed | [One](./one.md) |\n2\n{terminator}3\n"
        );
        let plan_doc = make_readable_snapshot("plans/bare/plan.md", &text);
        let absent = make_absent_snapshot("plans/bare/progress.md");
        let parsed = parse_plan("plans/bare", &plan_doc, &absent);
        assert_eq!(parsed.phases.len(), 2, "{terminator}");
        assert_eq!(parsed.phases[1].id, "phase:2");
        assert_eq!(parsed.phases[1].reported_status.value, PlanStatus::Unknown);
        assert_eq!(parsed.completion.declared, Some(2));
        assert_eq!(parsed.completion.completed, 1);
        assert_eq!(parsed.completion.unknown, 1);
        assert_eq!(parsed.completion.fraction, Some(0.5));
        assert!(parsed.diagnostics.is_empty());

        let progress_text = format!(
            "# Progress\n\n## Phase Reconciliation\n\n\
             | Phase | Current status | Detail |\n|---|---|---|\n\
             | 1 | Completed | Done |\n2\n{terminator}3\n"
        );
        let progress_doc = make_readable_snapshot("plans/bare/progress.md", &progress_text);
        let parsed = parse_plan("plans/bare", &plan_doc, &progress_doc);
        assert_eq!(parsed.completion.declared, Some(2));
        assert_eq!(parsed.completion.completed, 1);
        assert_eq!(parsed.completion.unknown, 1);
        assert_eq!(parsed.completion.fraction, Some(0.5));
        assert!(parsed.diagnostics.is_empty(), "{terminator}");
    }
}

#[test]
fn test_summary_high_phase_identifiers_and_bounded_range_cardinality() {
    for (numbers, restriction, expected) in [
        (vec![129], "Phase 129", PlanStatus::Completed),
        (vec![129, 130], "129–130", PlanStatus::Completed),
        (
            vec![129, 300],
            "Phase 129 and Phase 300",
            PlanStatus::Completed,
        ),
        (vec![u32::MAX], "4294967295", PlanStatus::Completed),
        (
            vec![u32::MAX - 1, u32::MAX],
            "4294967294–4294967295",
            PlanStatus::Completed,
        ),
        ((129..=256).collect(), "129–256", PlanStatus::Completed),
        (vec![129, 130], "129–257", PlanStatus::Unknown),
        (vec![1], "1–4294967295", PlanStatus::Unknown),
        (vec![129], "0–129", PlanStatus::Unknown),
    ] {
        let mut plan_text = "# Identifiers\n\n## Phases\n\n\
            | # | Phase | Status |\n|---|---|---|\n"
            .to_string();
        let mut progress_text = format!(
            "# Progress\n\nCurrent status: All phases ({restriction}) completed.\n\n\
             ## Phase Reconciliation\n\n| Phase | Current status |\n|---|---|\n"
        );
        for number in &numbers {
            plan_text.push_str(&format!("| {number} | Phase {number} | Pending |\n"));
            progress_text.push_str(&format!("| {number} | Completed |\n"));
        }
        let plan_doc = make_readable_snapshot("plans/ids/plan.md", &plan_text);
        let progress_doc = make_readable_snapshot("plans/ids/progress.md", &progress_text);
        let parsed = parse_plan("plans/ids", &plan_doc, &progress_doc);
        assert_eq!(parsed.reported_status.value, expected, "{restriction}");
        assert_eq!(parsed.completion.completed as usize, numbers.len());
        assert_eq!(parsed.completion.fraction, Some(1.0));
        if expected == PlanStatus::Unknown {
            assert!(parsed
                .diagnostics
                .iter()
                .any(|d| d.code == DIAG_UNSUPPORTED_STATUS));
        } else {
            assert!(parsed.diagnostics.is_empty(), "{restriction}");
        }
    }
}
