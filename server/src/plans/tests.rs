use crate::plans::dto::*;
use crate::plans::parser::parse_plan;
use crate::plans::scan::read_selected_plan;
use std::fs;
use tempfile::tempdir;

fn make_readable_snapshot<'a>(path: &'a str, content: &'a str) -> DocumentSnapshot<'a> {
    DocumentSnapshot {
        path,
        state: PlanDocumentState::Readable,
        bytes: Some(content.as_bytes()),
        size_bytes: Some(content.len() as u64),
        modified_at: Some("2026-10-06T12:00:00Z".to_string()),
    }
}

#[test]
fn test_plan_phases_and_completion_derivation() {
    let plan_md = r#"---
title: "Project Plans Dashboard"
description: "Expand Plan with folder-first selection"
status: in-progress
priority: P2
effort: 40h
created: 2026-10-06
---

# Project Plans Dashboard

## Phases

| # | Phase | Status | Effort | Detail |
|---|---|---|---|---|
| 01 | File parsing, source/date semantics | Completed | 8h | [Parser contract](./phase-01.md) |
| 02 | Native read API and containment | Completed | 8h | [Read API](./phase-02.md) |
| 03 | Owner-bound client and refresh | In-Progress | 6h | [Client lifecycle](./phase-03.md) |
| 04 | Dashboard and documents | Pending | 10h | [Dashboard](./phase-04.md) |
| 05 | Full-app qualification | Pending | 8h | [Qualification](./phase-05.md) |
"#;

    let plan_doc = make_readable_snapshot("plans/test-plan/plan.md", plan_md);
    let parsed = parse_plan("plans/test-plan", &plan_doc);

    assert_eq!(parsed.id, "plans/test-plan");
    assert_eq!(parsed.title.as_deref(), Some("Project Plans Dashboard"));
    assert_eq!(parsed.reported_status.value, PlanStatus::InProgress);
    assert_eq!(parsed.reported_status.authority, PlanAuthority::Plan);

    assert_eq!(parsed.phases.len(), 5);
    assert_eq!(parsed.phases[0].reported_status.value, PlanStatus::Completed);
    assert_eq!(parsed.phases[0].reported_status.authority, PlanAuthority::Plan);
    assert_eq!(parsed.phases[1].reported_status.value, PlanStatus::Completed);
    assert_eq!(parsed.phases[2].reported_status.value, PlanStatus::InProgress);
    assert_eq!(parsed.phases[3].reported_status.value, PlanStatus::Pending);
    assert_eq!(parsed.phases[4].reported_status.value, PlanStatus::Pending);

    assert_eq!(parsed.completion.declared, Some(5));
    assert_eq!(parsed.completion.completed, 2);
    assert_eq!(parsed.completion.unknown, 0);
    assert_eq!(parsed.completion.conflicted, 0);
    assert_eq!(parsed.completion.fraction, Some(2.0 / 5.0));

    // Documents only has plan.md
    assert_eq!(parsed.documents.plan.path, "plans/test-plan/plan.md");
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
    let parsed = parse_plan("plans/p", &plan_doc);

    assert_eq!(parsed.phases.len(), 3);
    assert_eq!(parsed.phases[0].reported_status.value, PlanStatus::Completed);
    assert_eq!(parsed.phases[1].reported_status.value, PlanStatus::InProgress);
    assert_eq!(parsed.phases[2].reported_status.value, PlanStatus::Pending);
    assert_eq!(parsed.reported_status.value, PlanStatus::InProgress);
    assert_eq!(parsed.reported_status.authority, PlanAuthority::Plan);
}

#[test]
fn test_plan_frontmatter_and_inventory_conflict_and_legacy_link() {
    // Frontmatter completed while phase rows are pending -> STATUS_CONFLICT
    // Link to progress.md does NOT emit any warning or error
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
    let parsed = parse_plan("plans/absent", &plan_doc);

    assert_eq!(parsed.reported_status.value, PlanStatus::Conflict);
    assert_eq!(parsed.reported_status.authority, PlanAuthority::Plan);
    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_STATUS_CONFLICT));
    // No PROGRESS_MISSING diagnostic
    assert_eq!(parsed.diagnostics.len(), 1);
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
    let parsed = parse_plan("plans/link", &plan_doc);

    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_LINK_REJECTED));
    assert!(parsed.phases[0].path.is_none());
}

#[test]
fn test_date_parsing_and_ranges() {
    let plan_md = r#"---
created: 2026-10-01
planned_start: 2026-10-02
planned_end: 2026-10-10
actual_start: 2026-10-03
actual_end: 2026-10-09
---
# Dates
"#;
    let plan_doc = make_readable_snapshot("plans/d/plan.md", plan_md);
    let parsed = parse_plan("plans/d", &plan_doc);

    assert_eq!(
        parsed.dates.created.as_ref().map(|d| d.value.as_str()),
        Some("2026-10-01")
    );
    assert_eq!(
        parsed.dates.planned_start.as_ref().map(|d| d.value.as_str()),
        Some("2026-10-02")
    );
    assert_eq!(
        parsed.dates.planned_end.as_ref().map(|d| d.value.as_str()),
        Some("2026-10-10")
    );
    assert!(parsed.diagnostics.is_empty());
}

#[test]
fn test_invalid_leap_date_and_mixed_precision_range() {
    let plan_md = r#"---
planned_start: 2026-02-29
---
# Leap
"#;
    let plan_doc = make_readable_snapshot("plans/leap/plan.md", plan_md);
    let parsed = parse_plan("plans/leap", &plan_doc);

    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_INVALID_DATE));
    assert!(parsed.dates.planned_start.is_none());
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
    let parsed_nul = parse_plan("plans/nul", &nul_doc);
    assert!(parsed_nul
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_INVALID_DOCUMENT));

    // 2. Oversize document (> 64 KiB)
    let oversize_doc = DocumentSnapshot {
        path: "plans/big/plan.md",
        state: PlanDocumentState::Oversize,
        bytes: None,
        size_bytes: Some(70000),
        modified_at: None,
    };
    let parsed_big = parse_plan("plans/big", &oversize_doc);
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
    let parsed = parse_plan("plans/empty", &plan_doc);

    assert_eq!(parsed.phases.len(), 0);
    assert_eq!(parsed.completion.declared, None);
    assert_eq!(parsed.completion.fraction, None);
    assert!(parsed.diagnostics.is_empty());
}

#[test]
fn test_reversed_date_range_and_mixed_precision() {
    // Case A: reversed planned range (start > end)
    let plan_md = r#"---
planned_start: 2026-10-15
planned_end: 2026-10-10
---
# Reversed
"#;
    let plan_doc = make_readable_snapshot("plans/rev/plan.md", plan_md);
    let parsed = parse_plan("plans/rev", &plan_doc);
    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_INVALID_DATE));

    // Case B: mixed precision (month vs day)
    let plan_mixed = r#"---
planned_start: 2026-10-01
planned_end: 2026-10
---
# Mixed
"#;
    let plan_doc_mixed = make_readable_snapshot("plans/mix/plan.md", plan_mixed);
    let parsed_mixed = parse_plan("plans/mix", &plan_doc_mixed);
    assert!(parsed_mixed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_INVALID_DATE));
}

#[test]
fn test_tags_limit_and_metadata_bounds() {
    // 35 tags (> 32 limit) and oversize priority (> 4 KiB)
    let mut tags_yaml = String::from("tags:\n");
    for i in 1..=35 {
        tags_yaml.push_str(&format!("  - tag{i}\n"));
    }
    let oversize_priority = "A".repeat(5000);
    let plan_md = format!(
        "---\n{tags_yaml}priority: \"{oversize_priority}\"\n---\n# Metadata Limits\n"
    );
    let plan_doc = make_readable_snapshot("plans/tags/plan.md", &plan_md);
    let parsed = parse_plan("plans/tags", &plan_doc);

    assert_eq!(parsed.metadata.tags.len(), 32);
    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_SCAN_LIMIT));
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
            "| {i:02} | Phase {i} | Pending | [Ext](https://example.com/{i}.md) |\n"
        ));
    }
    let plan_md = format!("# Many Diagnostics\n\n## Phases\n\n{table}");
    let plan_doc = make_readable_snapshot("plans/cap/plan.md", &plan_md);
    let parsed = parse_plan("plans/cap", &plan_doc);

    assert_eq!(parsed.diagnostics.len(), 32);
    assert_eq!(
        parsed.diagnostics.last().unwrap().code,
        DIAG_DIAGNOSTICS_LIMIT
    );
}

#[test]
fn test_yaml_duplicate_keys_and_aliases_rejected() {
    let plan_dup = r#"---
title: "First"
title: "Second"
---
# Dup
"#;
    let plan_doc = make_readable_snapshot("plans/dup/plan.md", plan_dup);
    let parsed = parse_plan("plans/dup", &plan_doc);
    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_INVALID_METADATA));

    let plan_alias = r#"---
default_priority: &p "P1"
priority: *p
---
# Alias
"#;
    let alias_doc = make_readable_snapshot("plans/alias/plan.md", plan_alias);
    let parsed_alias = parse_plan("plans/alias", &alias_doc);
    assert!(parsed_alias
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_INVALID_METADATA));
}

#[test]
fn test_relative_escape_and_scheme_links_rejected() {
    let plan_md = r#"# Escape Links

## Phases

| # | Phase | Status | Detail |
|---|---|---|---|
| 01 | Esc | Pending | [Esc](../../outside.md) |
"#;
    let plan_doc = make_readable_snapshot("plans/esc/plan.md", plan_md);
    let parsed = parse_plan("plans/esc", &plan_doc);
    assert!(parsed
        .diagnostics
        .iter()
        .any(|d| d.code == DIAG_LINK_REJECTED));
    assert!(parsed.phases[0].path.is_none());
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
    let parsed = parse_plan("plans/brk", &plan_doc);
    assert_eq!(parsed.phases[0].path.as_deref(), Some("phase-01.md"));
    assert_eq!(parsed.phases[0].id, "phase-01.md");
}

#[test]
fn test_short_gfm_rows_preserve_declared_and_current_denominators() {
    let plan_md = "# Short rows\n\n## Phases\n\n\
        | # | Phase | Status | Detail |\n|---|---|---|---|\n\
        | 1 | One | Completed | [One](./one.md) |\n\
        2 | Two | Pending\n\
        | 3 | Three\n";
    let plan_doc = make_readable_snapshot("plans/short/plan.md", plan_md);
    let parsed = parse_plan("plans/short", &plan_doc);
    assert_eq!(parsed.phases.len(), 3);
    assert_eq!(parsed.phases[1].id, "phase:2");
    assert_eq!(parsed.phases[1].reported_status.value, PlanStatus::Pending);
    assert_eq!(parsed.phases[2].reported_status.value, PlanStatus::Unknown);
    assert_eq!(parsed.completion.declared, Some(3));
    assert_eq!(parsed.completion.completed, 1);
    assert_eq!(parsed.completion.unknown, 1);
    assert_eq!(parsed.completion.fraction, Some(1.0 / 3.0));
    assert!(parsed.diagnostics.is_empty());
}

#[test]
fn test_explicit_current_status_column_wins() {
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
        let parsed = parse_plan("plans/columns", &table_doc);
        assert_eq!(
            parsed.phases[0].reported_status.value, expected,
            "{header}"
        );
        assert_eq!(parsed.completion.fraction, fraction, "{header}");
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
        let parsed = parse_plan("plans/mixed", &plan);
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
        let parsed = parse_plan("plans/bare", &plan_doc);
        assert_eq!(parsed.phases.len(), 2, "{terminator}");
        assert_eq!(parsed.phases[1].id, "phase:2");
        assert_eq!(parsed.phases[1].reported_status.value, PlanStatus::Unknown);
        assert_eq!(parsed.completion.declared, Some(2));
        assert_eq!(parsed.completion.completed, 1);
        assert_eq!(parsed.completion.unknown, 1);
        assert_eq!(parsed.completion.fraction, Some(0.5));
        assert!(parsed.diagnostics.is_empty());
    }
}

#[test]
fn test_legacy_progress_file_completely_ignored_by_scanner_and_parser() {
    let temp = tempdir().expect("create temp dir");
    let root = temp.path();
    let plan_dir = root.join("plans").join("legacy-sample");
    fs::create_dir_all(&plan_dir).expect("create plan dir");

    let plan_content = r#"---
title: "Legacy Sample"
status: pending
---
# Legacy Sample Plan

## Phases

| # | Phase | Status |
|---|---|---|
| 01 | Phase One | Pending |
"#;
    let plan_path = plan_dir.join("plan.md");
    fs::write(&plan_path, plan_content).expect("write plan.md");

    // Write a legacy progress.md file with conflicting status, malformed text, and large size
    let progress_content = r#"# Legacy Progress
**Current status:** Completed

## Phase Reconciliation
| Phase | Current status |
|---|---|
| 01 | Completed |
| 99 | Unknown |
"#;
    let progress_path = plan_dir.join("progress.md");
    fs::write(&progress_path, progress_content).expect("write progress.md");

    let target = PlanTarget {
        project: "test".to_string(),
        worktree_path: None,
        target_key: "default:test".to_string(),
    };

    let result = read_selected_plan(root, "plans/legacy-sample", target);
    assert!(result.is_ok(), "read_selected_plan should succeed");

    let selected = result.unwrap();
    // Status must be derived strictly from plan.md (Pending, not Completed from progress.md)
    assert_eq!(selected.plan.reported_status.value, PlanStatus::Pending);
    assert_eq!(selected.plan.reported_status.authority, PlanAuthority::Plan);
    assert_eq!(selected.plan.phases.len(), 1);
    assert_eq!(
        selected.plan.phases[0].reported_status.value,
        PlanStatus::Pending
    );
    assert_eq!(
        selected.plan.phases[0].reported_status.authority,
        PlanAuthority::Plan
    );

    // No progress diagnostics (PROGRESS_MISSING, PROGRESS_UNREADABLE, etc.)
    assert!(selected.plan.diagnostics.is_empty());

    // documents only has plan
    assert_eq!(selected.plan.documents.plan.path, "plans/legacy-sample/plan.md");
    assert_eq!(selected.plan.documents.plan.state, PlanDocumentState::Readable);
}
