use std::collections::HashSet;

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;

use super::dto::*;

/// Result of parsing decisive documents for a selected plan.
pub fn parse_plan(
    plan_id: &str,
    plan_doc: &DocumentSnapshot,
    progress_doc: &DocumentSnapshot,
) -> FilePlan {
    let mut diagnostics = Vec::new();

    // 1. Validate documents
    let plan_text = validate_document_snapshot(plan_doc, &mut diagnostics);
    let progress_text = validate_document_snapshot(progress_doc, &mut diagnostics);

    // 2. Parse plan.md metadata and raw sections
    let (mut metadata, plan_title, plan_desc, plan_frontmatter_status, plan_dates, plan_sections) =
        if let Some(text) = plan_text.as_deref() {
            parse_plan_document(plan_doc.path, text, &mut diagnostics)
        } else {
            (
                FilePlanMetadata::default(),
                None,
                None,
                None,
                PlanDates::default(),
                ParsedSections::default(),
            )
        };

    // 3. Parse declared phase inventory from plan.md
    let (phases_result, declared_inventory_valid) =
        extract_phase_inventory(plan_doc.path, &plan_sections, &mut diagnostics);

    // 4. Parse progress.md if present
    let (
        progress_dates,
        progress_current_scalar,
        progress_summary,
        progress_reconciliation,
        progress_valid,
    ) = if progress_doc.state == PlanDocumentState::Absent {
        // If plan links to a missing progress file, emit warning
        if plan_text
            .as_deref()
            .map(|t| t.contains("progress.md"))
            .unwrap_or(false)
        {
            add_diagnostic(
                &mut diagnostics,
                DIAG_PROGRESS_MISSING,
                Some(plan_doc.path),
                None,
                "Referenced progress.md does not exist in target",
            );
        }
        (PlanDates::default(), None, None, Vec::new(), false)
    } else if let Some(text) = progress_text.as_deref() {
        parse_progress_document(progress_doc.path, text, &mut diagnostics)
    } else {
        // Unreadable or invalid decisive progress
        add_diagnostic(
            &mut diagnostics,
            DIAG_PROGRESS_UNREADABLE,
            Some(progress_doc.path),
            None,
            "Progress document is present but unreadable or invalid",
        );
        (PlanDates::default(), None, None, Vec::new(), false)
    };

    // 5. Reconcile Phase status and evidence
    let (phases, overall_reported_status) = reconcile_statuses(
        plan_doc.path,
        progress_doc.path,
        progress_doc.state != PlanDocumentState::Absent,
        progress_valid,
        phases_result,
        declared_inventory_valid,
        plan_frontmatter_status,
        progress_current_scalar,
        progress_summary,
        progress_reconciliation,
        &mut diagnostics,
    );

    // 6. Compute completion fraction and counts
    let completion = compute_completion(&phases, declared_inventory_valid);

    // 7. Reconcile explicit dates
    let dates = reconcile_dates(
        plan_doc.path,
        progress_doc.path,
        plan_dates,
        progress_dates,
        &mut diagnostics,
    );

    // 8. Reconcile last document update (latest of valid modified_at)
    let last_document_update = match (&plan_doc.modified_at, &progress_doc.modified_at) {
        (Some(a), Some(b)) => Some(std::cmp::max(a, b).clone()),
        (Some(a), None) => Some(a.clone()),
        (None, Some(b)) => Some(b.clone()),
        (None, None) => None,
    };

    // 9. Enforce metadata string bounds
    enforce_metadata_bounds(&mut metadata, plan_doc.path, &mut diagnostics);

    // 10. Bound diagnostics to MAX_DIAGNOSTICS_PER_PLAN
    cap_diagnostics(&mut diagnostics);

    FilePlan {
        id: plan_id.to_string(),
        title: plan_title,
        description: plan_desc,
        metadata,
        documents: PlanDocuments {
            plan: plan_doc.to_plan_document(),
            progress: progress_doc.to_plan_document(),
        },
        reported_status: overall_reported_status,
        phases,
        completion,
        dates,
        last_document_update,
        diagnostics,
    }
}

/// Validate snapshot bounds, NUL bytes, and UTF-8 encoding.
fn validate_document_snapshot(
    doc: &DocumentSnapshot,
    diagnostics: &mut Vec<Diagnostic>,
) -> Option<String> {
    if doc.state == PlanDocumentState::Absent {
        return None;
    }

    let bytes = match doc.bytes {
        Some(b) => b,
        None => {
            if doc.state != PlanDocumentState::Absent {
                add_diagnostic(
                    diagnostics,
                    DIAG_INVALID_DOCUMENT,
                    Some(doc.path),
                    None,
                    format!("Document state is {:?} with missing bytes", doc.state),
                );
            }
            return None;
        }
    };

    if bytes.len() > MAX_DOCUMENT_BYTES {
        add_diagnostic(
            diagnostics,
            DIAG_DOCUMENT_TOO_LARGE,
            Some(doc.path),
            None,
            format!("Document exceeds 64 KiB limit (got {} bytes)", bytes.len()),
        );
        return None;
    }

    if bytes.contains(&0) {
        add_diagnostic(
            diagnostics,
            DIAG_INVALID_DOCUMENT,
            Some(doc.path),
            None,
            "Document contains NUL (0x00) byte",
        );
        return None;
    }

    match std::str::from_utf8(bytes) {
        Ok(s) => Some(s.to_string()),
        Err(e) => {
            add_diagnostic(
                diagnostics,
                DIAG_INVALID_DOCUMENT,
                Some(doc.path),
                None,
                format!("Document contains invalid UTF-8: {e}"),
            );
            None
        }
    }
}

#[derive(Debug, Default)]
struct ParsedSections {
    frontmatter_lines: Option<(usize, usize, String)>,
    metadata_lines: Vec<(usize, String)>,
    title_from_heading: Option<String>,
    desc_from_heading: Option<String>,
    phases_table_lines: Vec<(usize, String)>,
    phases_heading_found: bool,
}

/// Parse plan.md structure: YAML frontmatter, standalone metadata labels, headings, and tables.
fn parse_plan_document(
    path: &str,
    text: &str,
    diagnostics: &mut Vec<Diagnostic>,
) -> (
    FilePlanMetadata,
    Option<String>,
    Option<String>,
    Option<(PlanStatus, String, usize)>,
    PlanDates,
    ParsedSections,
) {
    let mut sections = ParsedSections::default();
    let lines: Vec<&str> = text.lines().collect();

    let mut line_idx = 0;
    // Check for leading YAML frontmatter
    if !lines.is_empty() && lines[0].trim() == "---" {
        let mut fm_end = None;
        for i in 1..lines.len() {
            if lines[i].trim() == "---" {
                fm_end = Some(i);
                break;
            }
        }

        if let Some(end_idx) = fm_end {
            let fm_content = lines[1..end_idx].join("\n");
            sections.frontmatter_lines = Some((1, end_idx + 1, fm_content));
            line_idx = end_idx + 1;
        } else {
            add_diagnostic(
                diagnostics,
                DIAG_INVALID_METADATA,
                Some(path),
                Some(1),
                "Unclosed YAML frontmatter delimiter",
            );
        }
    }

    let mut in_metadata_region = true;
    let mut in_phases_section = false;
    let mut current_first_p = Vec::new();
    let mut past_first_h1 = false;

    while line_idx < lines.len() {
        let line = lines[line_idx];
        let line_num = line_idx + 1;
        let trimmed = line.trim();

        if trimmed.starts_with("## ") {
            in_metadata_region = false;
            let heading_text = trimmed.trim_start_matches("##").trim();
            if heading_text.starts_with("Phases") {
                if sections.phases_heading_found {
                    // Contradictory/multiple Phases headings
                    add_diagnostic(
                        diagnostics,
                        DIAG_PHASE_INVENTORY_INVALID,
                        Some(path),
                        Some(line_num),
                        "Multiple Phases sections detected",
                    );
                }
                sections.phases_heading_found = true;
                in_phases_section = true;
            } else {
                in_phases_section = false;
            }
        } else if trimmed.starts_with("# ") && !past_first_h1 {
            past_first_h1 = true;
            sections.title_from_heading = Some(trimmed.trim_start_matches('#').trim().to_string());
        } else if in_phases_section {
            if (sections.phases_table_lines.len() >= 2 && is_gfm_table_body_line(line))
                || (sections.phases_table_lines.len() < 2 && trimmed.contains('|'))
            {
                sections
                    .phases_table_lines
                    .push((line_num, line.to_string()));
            } else if !sections.phases_table_lines.is_empty()
                && (sections.phases_table_lines.len() >= 2 || !trimmed.is_empty())
            {
                // Table ended
                in_phases_section = false;
            }
        } else if in_metadata_region {
            if past_first_h1
                && !trimmed.is_empty()
                && current_first_p.is_empty()
                && !trimmed.starts_with('#')
            {
                current_first_p.push(trimmed.to_string());
            }
            sections.metadata_lines.push((line_num, line.to_string()));
        }

        line_idx += 1;
    }

    if !current_first_p.is_empty() {
        sections.desc_from_heading = Some(current_first_p.join(" "));
    }

    // Parse YAML frontmatter values
    let (mut metadata, fm_title, fm_desc, fm_status, mut dates) =
        if let Some((start_l, end_l, content)) = &sections.frontmatter_lines {
            parse_yaml_frontmatter(path, content, *start_l, *end_l, diagnostics)
        } else {
            (
                FilePlanMetadata::default(),
                None,
                None,
                None,
                PlanDates::default(),
            )
        };

    // Parse standalone metadata labels before first H2
    parse_standalone_dates_and_status(
        path,
        &sections.metadata_lines,
        &mut dates,
        &mut metadata,
        diagnostics,
    );

    let final_title = fm_title.or(sections.title_from_heading.clone());
    let final_desc = fm_desc.or(sections.desc_from_heading.clone());

    (
        metadata,
        final_title,
        final_desc,
        fm_status,
        dates,
        sections,
    )
}

/// Parse YAML frontmatter content with strict validation.
fn parse_yaml_frontmatter(
    path: &str,
    content: &str,
    start_line: usize,
    _end_line: usize,
    diagnostics: &mut Vec<Diagnostic>,
) -> (
    FilePlanMetadata,
    Option<String>,
    Option<String>,
    Option<(PlanStatus, String, usize)>,
    PlanDates,
) {
    let mut metadata = FilePlanMetadata::default();
    let mut title = None;
    let mut desc = None;
    let mut status = None;
    let mut dates = PlanDates::default();

    if let Some(reason) = has_duplicate_yaml_keys_or_aliases(content) {
        add_diagnostic(
            diagnostics,
            DIAG_INVALID_METADATA,
            Some(path),
            Some(start_line),
            reason,
        );
        return (metadata, title, desc, status, dates);
    }

    let yaml_val: Result<Value, _> = serde_yaml_ng::from_str(content);
    let val = match yaml_val {
        Ok(v) => v,
        Err(e) => {
            add_diagnostic(
                diagnostics,
                DIAG_INVALID_METADATA,
                Some(path),
                Some(start_line),
                format!("Failed to parse YAML frontmatter: {e}"),
            );
            return (metadata, title, desc, status, dates);
        }
    };

    let map = match val.as_object() {
        Some(m) => m,
        None => {
            add_diagnostic(
                diagnostics,
                DIAG_INVALID_METADATA,
                Some(path),
                Some(start_line),
                "Frontmatter is not a YAML mapping",
            );
            return (metadata, title, desc, status, dates);
        }
    };

    // Check depth
    if compute_json_depth(&val) > MAX_YAML_NESTING_DEPTH {
        add_diagnostic(
            diagnostics,
            DIAG_INVALID_METADATA,
            Some(path),
            Some(start_line),
            "YAML frontmatter exceeds maximum nesting depth (16)",
        );
        return (metadata, title, desc, status, dates);
    }

    // Process fields
    for (k, v) in map {
        match k.as_str() {
            "title" => {
                if let Some(s) = v.as_str() {
                    if s.len() > MAX_TITLE_TAG_BYTES {
                        add_diagnostic(
                            diagnostics,
                            DIAG_FIELD_TOO_LARGE,
                            Some(path),
                            Some(start_line),
                            "Title exceeds 512 bytes",
                        );
                    } else {
                        title = Some(s.to_string());
                    }
                }
            }
            "description" => {
                if let Some(s) = v.as_str() {
                    if s.len() > MAX_METADATA_STRING_BYTES {
                        add_diagnostic(
                            diagnostics,
                            DIAG_FIELD_TOO_LARGE,
                            Some(path),
                            Some(start_line),
                            "Description exceeds 4 KiB",
                        );
                    } else {
                        desc = Some(s.to_string());
                    }
                }
            }
            "status" => {
                if let Some(s) = v.as_str() {
                    let parsed = parse_status_cell(s);
                    status = Some((parsed, s.to_string(), start_line));
                }
            }
            "priority" => {
                if let Some(s) = v.as_str() {
                    metadata.priority = Some(s.to_string());
                }
            }
            "effort" => {
                if let Some(s) = v.as_str() {
                    metadata.effort = Some(s.to_string());
                }
            }
            "issue" => {
                if let Some(s) = v.as_str() {
                    metadata.issue = Some(s.to_string());
                } else if let Some(n) = v.as_i64() {
                    metadata.issue = Some(n.to_string());
                }
            }
            "branch" => {
                if let Some(s) = v.as_str() {
                    metadata.branch = Some(s.to_string());
                }
            }
            "tags" => {
                if let Some(arr) = v.as_array() {
                    if arr.len() > MAX_TAGS_COUNT {
                        add_diagnostic(
                            diagnostics,
                            DIAG_SCAN_LIMIT,
                            Some(path),
                            Some(start_line),
                            "Tags array exceeds maximum count of 32",
                        );
                    }
                    for item in arr.iter().take(MAX_TAGS_COUNT) {
                        if let Some(tag_str) = item.as_str() {
                            if tag_str.len() > MAX_TITLE_TAG_BYTES {
                                add_diagnostic(
                                    diagnostics,
                                    DIAG_FIELD_TOO_LARGE,
                                    Some(path),
                                    Some(start_line),
                                    "Tag exceeds 512 bytes",
                                );
                            } else {
                                metadata.tags.push(tag_str.to_string());
                            }
                        }
                    }
                }
            }
            "created" => {
                parse_yaml_date(
                    path,
                    "created",
                    v,
                    start_line,
                    &mut dates.created,
                    diagnostics,
                );
            }
            "planned_start" | "plannedStart" => {
                parse_yaml_date(
                    path,
                    "plannedStart",
                    v,
                    start_line,
                    &mut dates.planned_start,
                    diagnostics,
                );
            }
            "planned_end" | "plannedEnd" => {
                parse_yaml_date(
                    path,
                    "plannedEnd",
                    v,
                    start_line,
                    &mut dates.planned_end,
                    diagnostics,
                );
            }
            "actual_start" | "actualStart" | "started" => {
                parse_yaml_date(
                    path,
                    "actualStart",
                    v,
                    start_line,
                    &mut dates.actual_start,
                    diagnostics,
                );
            }
            "actual_end" | "actualEnd" | "completed" => {
                parse_yaml_date(
                    path,
                    "actualEnd",
                    v,
                    start_line,
                    &mut dates.actual_end,
                    diagnostics,
                );
            }
            "published" => {
                parse_yaml_date(
                    path,
                    "published",
                    v,
                    start_line,
                    &mut dates.published,
                    diagnostics,
                );
            }
            _ => {
                // Unsupported YAML keys can be ignored or diagnosed
            }
        }
    }

    (metadata, title, desc, status, dates)
}

fn compute_json_depth(val: &Value) -> usize {
    match val {
        Value::Object(map) => 1 + map.values().map(compute_json_depth).max().unwrap_or(0),
        Value::Array(arr) => 1 + arr.iter().map(compute_json_depth).max().unwrap_or(0),
        _ => 1,
    }
}

fn parse_yaml_date(
    path: &str,
    field_name: &str,
    val: &Value,
    line: usize,
    target: &mut Option<DateEvidence>,
    diagnostics: &mut Vec<Diagnostic>,
) {
    let date_str = match val.as_str() {
        Some(s) => s,
        None => return,
    };

    match parse_date_value(date_str) {
        Ok((norm_val, prec)) => {
            if let Some(existing) = target {
                if existing.value != norm_val || existing.precision != prec {
                    add_diagnostic(
                        diagnostics,
                        DIAG_DATE_CONFLICT,
                        Some(path),
                        Some(line),
                        format!("Conflicting date alias for {field_name}"),
                    );
                    *target = None;
                    return;
                }
            } else {
                *target = Some(DateEvidence {
                    value: norm_val,
                    precision: prec,
                    evidence: SourceRef {
                        path: path.to_string(),
                        line_start: line,
                        line_end: line,
                    },
                });
            }
        }
        Err(e) => {
            add_diagnostic(
                diagnostics,
                DIAG_INVALID_DATE,
                Some(path),
                Some(line),
                format!("Invalid date for {field_name}: {e}"),
            );
        }
    }
}

/// Parse standalone metadata labels like `- **Created:** 2026-10-06`.
fn parse_standalone_dates_and_status(
    path: &str,
    lines: &[(usize, String)],
    dates: &mut PlanDates,
    _metadata: &mut FilePlanMetadata,
    diagnostics: &mut Vec<Diagnostic>,
) {
    for (line_num, line) in lines {
        let trimmed = line
            .trim()
            .trim_start_matches('-')
            .trim_start_matches('*')
            .trim();
        // Remove markdown bold/italic
        let clean = trimmed.replace("**", "").replace("__", "");
        let parts: Vec<&str> = clean.splitn(2, ':').collect();
        if parts.len() == 2 {
            let label = parts[0].trim().to_lowercase();
            let value = parts[1].trim();
            if value.is_empty() {
                continue;
            }

            match label.as_str() {
                "created" => {
                    if dates.created.is_none() {
                        try_set_date_evidence(
                            path,
                            *line_num,
                            value,
                            &mut dates.created,
                            diagnostics,
                        );
                    }
                }
                "planned start" => {
                    if dates.planned_start.is_none() {
                        try_set_date_evidence(
                            path,
                            *line_num,
                            value,
                            &mut dates.planned_start,
                            diagnostics,
                        );
                    }
                }
                "planned end" => {
                    if dates.planned_end.is_none() {
                        try_set_date_evidence(
                            path,
                            *line_num,
                            value,
                            &mut dates.planned_end,
                            diagnostics,
                        );
                    }
                }
                "actual start" | "started" => {
                    if dates.actual_start.is_none() {
                        try_set_date_evidence(
                            path,
                            *line_num,
                            value,
                            &mut dates.actual_start,
                            diagnostics,
                        );
                    }
                }
                "actual end" | "completed" => {
                    if dates.actual_end.is_none() {
                        try_set_date_evidence(
                            path,
                            *line_num,
                            value,
                            &mut dates.actual_end,
                            diagnostics,
                        );
                    }
                }
                "published" => {
                    if dates.published.is_none() {
                        try_set_date_evidence(
                            path,
                            *line_num,
                            value,
                            &mut dates.published,
                            diagnostics,
                        );
                    }
                }
                _ => {}
            }
        }
    }
}

fn try_set_date_evidence(
    path: &str,
    line: usize,
    raw_val: &str,
    target: &mut Option<DateEvidence>,
    diagnostics: &mut Vec<Diagnostic>,
) {
    match parse_date_value(raw_val) {
        Ok((norm_val, prec)) => {
            *target = Some(DateEvidence {
                value: norm_val,
                precision: prec,
                evidence: SourceRef {
                    path: path.to_string(),
                    line_start: line,
                    line_end: line,
                },
            });
        }
        Err(e) => {
            add_diagnostic(
                diagnostics,
                DIAG_INVALID_DATE,
                Some(path),
                Some(line),
                format!("Invalid date format: {e}"),
            );
        }
    }
}

/// Strict Gregorian YYYY-MM-DD or RFC3339 with explicit timezone normalized to UTC.
fn parse_date_value(s: &str) -> Result<(String, DatePrecision), &'static str> {
    let trimmed = s.trim();
    if trimmed.len() == 10
        && trimmed.chars().nth(4) == Some('-')
        && trimmed.chars().nth(7) == Some('-')
    {
        if let Ok(date) = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
            return Ok((date.format("%Y-%m-%d").to_string(), DatePrecision::Day));
        }
        return Err("Invalid Gregorian calendar date");
    }

    if let Ok(dt) = DateTime::parse_from_rfc3339(trimmed) {
        let utc_dt: DateTime<Utc> = dt.with_timezone(&Utc);
        return Ok((utc_dt.to_rfc3339(), DatePrecision::Instant));
    }

    Err("Date is neither Gregorian YYYY-MM-DD nor RFC3339 with explicit zone")
}

#[derive(Debug, Clone)]
struct RawPhaseRow {
    number: Option<u32>,
    name: String,
    status: PlanStatus,
    raw_status: String,
    detail_link: Option<String>,
    line: usize,
}

/// Tokenize and extract phase rows from the table under Phases heading.
fn extract_phase_inventory(
    path: &str,
    sections: &ParsedSections,
    diagnostics: &mut Vec<Diagnostic>,
) -> (Vec<FilePlanPhase>, bool) {
    if !sections.phases_heading_found || sections.phases_table_lines.is_empty() {
        return (Vec::new(), false);
    }

    let raw_rows = match parse_gfm_table(&sections.phases_table_lines, diagnostics, path) {
        Ok(rows) => rows,
        Err(_) => {
            add_diagnostic(
                diagnostics,
                DIAG_PHASE_INVENTORY_INVALID,
                Some(path),
                None,
                "Failed to parse phases table",
            );
            return (Vec::new(), false);
        }
    };

    if raw_rows.len() > MAX_DECLARED_PHASE_ROWS {
        add_diagnostic(
            diagnostics,
            DIAG_PHASE_INVENTORY_INVALID,
            Some(path),
            None,
            format!(
                "Phases count ({}) exceeds maximum allowed (128)",
                raw_rows.len()
            ),
        );
        add_diagnostic(
            diagnostics,
            DIAG_SCAN_LIMIT,
            Some(path),
            None,
            "Phase inventory table row limit reached",
        );
        return (Vec::new(), false);
    }

    let mut phases = Vec::new();
    let mut seen_ids = HashSet::new();
    let mut seen_numbers = HashSet::new();

    for row in raw_rows {
        // Phase identity: normalized relative link within member directory, otherwise phase:<unique-number>
        let (id, normalized_path) = if let Some(link) = &row.detail_link {
            let norm = normalize_local_link(link);
            (norm.clone(), Some(norm))
        } else if let Some(num) = row.number {
            (format!("phase:{num}"), None)
        } else {
            add_diagnostic(
                diagnostics,
                DIAG_PHASE_INVENTORY_INVALID,
                Some(path),
                Some(row.line),
                "Phase row missing both valid link and number",
            );
            return (Vec::new(), false);
        };

        if !seen_ids.insert(id.clone()) {
            add_diagnostic(
                diagnostics,
                DIAG_PHASE_INVENTORY_INVALID,
                Some(path),
                Some(row.line),
                format!("Duplicate phase identity: {id}"),
            );
            return (Vec::new(), false);
        }

        if let Some(num) = row.number {
            if !seen_numbers.insert(num) {
                add_diagnostic(
                    diagnostics,
                    DIAG_PHASE_INVENTORY_INVALID,
                    Some(path),
                    Some(row.line),
                    format!("Duplicate phase number: {num}"),
                );
                return (Vec::new(), false);
            }
        }

        let clean_title = extract_clean_title(&row.name);

        phases.push(FilePlanPhase {
            id,
            number: row.number,
            title: Some(clean_title),
            path: normalized_path,
            reported_status: ReportedStatus {
                value: row.status,
                authority: PlanAuthority::Plan,
                raw: Some(row.raw_status),
                evidence: vec![SourceRef {
                    path: path.to_string(),
                    line_start: row.line,
                    line_end: row.line,
                }],
                captured: Vec::new(),
            },
            evidence_links: Vec::new(),
        });
    }

    (phases, true)
}

/// Tokenize GFM table with pipe escaping, code spans and link boundaries.
fn parse_gfm_table(
    table_lines: &[(usize, String)],
    diagnostics: &mut Vec<Diagnostic>,
    doc_path: &str,
) -> Result<Vec<RawPhaseRow>, ()> {
    if table_lines.len() < 2 {
        return Err(());
    }

    let (_header_line_num, header_str) = &table_lines[0];
    let header_cells = tokenize_table_row(header_str);
    if header_cells.is_empty() {
        return Err(());
    }

    // Identify column roles
    let mut num_col = None;
    let mut phase_col = None;
    let mut status_col = None;
    let mut current_col = None;
    let mut detail_col = None;

    for (idx, cell) in header_cells.iter().enumerate() {
        let norm = cell.trim().to_lowercase();
        if norm == "#" || norm == "number" || norm == "no" {
            num_col = Some(idx);
        } else if norm == "phase" || norm == "name" || norm == "title" {
            phase_col = Some(idx);
        } else if norm == "current status" {
            current_col = Some(idx);
        } else if norm == "status" {
            status_col = Some(idx);
        } else if norm == "detail" || norm == "link" || norm == "path" {
            detail_col = Some(idx);
        }
    }
    let status_col = current_col.or(status_col);

    // Verify delimiter row
    let delimiter_cells = tokenize_table_row(&table_lines[1].1);
    if delimiter_cells.len() != header_cells.len() {
        return Err(());
    }
    for cell in &delimiter_cells {
        let trimmed = cell.trim();
        if !trimmed.chars().all(|c| c == '-' || c == ':') || !trimmed.contains('-') {
            return Err(());
        }
    }

    let mut rows = Vec::new();
    for (line_num, line_str) in &table_lines[2..] {
        let mut cells = tokenize_table_row(line_str);
        // GFM fills missing trailing body cells and ignores excess cells.
        cells.resize(header_cells.len(), String::new());

        let raw_num_str = num_col.and_then(|idx| cells.get(idx)).map(|s| s.trim());
        let raw_phase_str = phase_col
            .and_then(|idx| cells.get(idx))
            .map(|s| s.trim())
            .unwrap_or("");
        let raw_status_str = status_col
            .and_then(|idx| cells.get(idx))
            .map(|s| s.trim())
            .unwrap_or("");
        let raw_detail_str = detail_col.and_then(|idx| cells.get(idx)).map(|s| s.trim());

        // Extract number from number col or leading name text
        let number = raw_num_str
            .and_then(|s| s.parse::<u32>().ok())
            .or_else(|| extract_number_from_text(raw_phase_str));

        // Extract detail link from detail col or phase col
        let mut detail_link = raw_detail_str
            .and_then(extract_markdown_link)
            .or_else(|| extract_markdown_link(raw_phase_str));

        if let Some(link) = &detail_link {
            if is_rejected_link(link) {
                add_diagnostic(
                    diagnostics,
                    DIAG_LINK_REJECTED,
                    Some(doc_path),
                    Some(*line_num),
                    format!("Phase link '{link}' rejected: absolute, escape, or invalid scheme"),
                );
                detail_link = None;
            }
        }

        let status = parse_status_cell(raw_status_str);

        rows.push(RawPhaseRow {
            number,
            name: raw_phase_str.to_string(),
            status,
            raw_status: raw_status_str.to_string(),
            detail_link,
            line: *line_num,
        });
    }

    Ok(rows)
}

// After a header/delimiter, even a bare cell is a GFM row. Blank lines and
// interrupting block starts terminate the table instead of becoming inventory.
fn is_gfm_table_body_line(line: &str) -> bool {
    let text = line.trim();
    if text.is_empty()
        || text.starts_with('>')
        || text.starts_with("```")
        || text.starts_with("~~~")
    {
        return false;
    }
    let hashes = text.chars().take_while(|c| *c == '#').count();
    if (1..=6).contains(&hashes)
        && (text.len() == hashes || text[hashes..].starts_with(char::is_whitespace))
    {
        return false;
    }
    let mut chars = text.chars();
    if matches!(chars.next(), Some('-' | '+' | '*'))
        && chars.next().is_some_and(char::is_whitespace)
    {
        return false;
    }
    let digits = text.chars().take_while(char::is_ascii_digit).count();
    if (1..=9).contains(&digits) {
        let suffix = &text[digits..];
        if (suffix.starts_with('.') || suffix.starts_with(')'))
            && suffix[1..].starts_with(char::is_whitespace)
        {
            return false;
        }
    }
    let mut marks = text.chars().filter(|c| !c.is_whitespace());
    if let Some(first @ ('-' | '*' | '_')) = marks.next() {
        let mut count = 1;
        let uniform = marks.all(|mark| {
            count += 1;
            mark == first
        });
        if uniform && count >= 3 {
            return false;
        }
    }
    // HTML block openers also interrupt tables; ordinary inline content does not.
    if text.starts_with("<!--") || text.starts_with("<?") || text.starts_with("<!") {
        return false;
    }
    let tag = text
        .trim_start_matches('<')
        .trim_start_matches('/')
        .split(|c: char| c.is_whitespace() || c == '>' || c == '/')
        .next()
        .unwrap_or("");
    !text.starts_with('<')
        || !matches!(
            tag.to_ascii_lowercase().as_str(),
            "address"
                | "article"
                | "aside"
                | "base"
                | "blockquote"
                | "body"
                | "caption"
                | "center"
                | "col"
                | "colgroup"
                | "dd"
                | "details"
                | "dialog"
                | "dir"
                | "div"
                | "dl"
                | "dt"
                | "fieldset"
                | "figcaption"
                | "figure"
                | "footer"
                | "form"
                | "frame"
                | "frameset"
                | "h1"
                | "h2"
                | "h3"
                | "h4"
                | "h5"
                | "h6"
                | "head"
                | "header"
                | "hr"
                | "html"
                | "iframe"
                | "legend"
                | "li"
                | "link"
                | "main"
                | "menu"
                | "menuitem"
                | "nav"
                | "noframes"
                | "ol"
                | "optgroup"
                | "option"
                | "p"
                | "param"
                | "pre"
                | "script"
                | "search"
                | "section"
                | "source"
                | "style"
                | "summary"
                | "table"
                | "tbody"
                | "td"
                | "tfoot"
                | "th"
                | "thead"
                | "title"
                | "tr"
                | "track"
                | "ul"
        )
}

/// Tokenize table row taking into account backslash escaping and code spans.
fn tokenize_table_row(line: &str) -> Vec<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let mut cells = Vec::new();
    let mut current = String::new();
    let mut in_code = false;
    let mut escaped = false;
    let mut chars = trimmed.chars().peekable();

    // Leading and trailing edge pipes are optional in GFM.
    if trimmed.starts_with('|') {
        chars.next();
    }

    while let Some(c) = chars.next() {
        if escaped {
            current.push(c);
            escaped = false;
        } else if c == '\\' {
            escaped = true;
            current.push(c);
        } else if c == '`' {
            in_code = !in_code;
            current.push(c);
        } else if c == '|' && !in_code {
            cells.push(current.trim().to_string());
            current.clear();
        } else {
            current.push(c);
        }
    }

    // Trailing cell if line ended with pipe or content
    if !current.trim().is_empty() {
        cells.push(current.trim().to_string());
    }

    cells
}

fn extract_clean_title(text: &str) -> String {
    // If it's a markdown link [Title](url), take the Title
    let inner = if let Some(start) = text.find('[') {
        if let Some(end) = text.find(']') {
            if end > start {
                &text[start + 1..end]
            } else {
                text
            }
        } else {
            text
        }
    } else {
        text
    };

    let trimmed = inner.trim();
    // Strip leading "Phase 01 - ", "01 — ", "01 - "
    if let Some(idx) = trimmed.find("—") {
        let prefix = &trimmed[..idx];
        if is_phase_number_prefix(prefix) {
            return trimmed[idx + "—".len()..].trim().to_string();
        }
    }
    if let Some(idx) = trimmed.find(" - ") {
        let prefix = &trimmed[..idx];
        if is_phase_number_prefix(prefix) {
            return trimmed[idx + 3..].trim().to_string();
        }
    }

    trimmed.to_string()
}

fn is_phase_number_prefix(prefix: &str) -> bool {
    let lower = prefix.trim().to_lowercase();
    let rest = lower
        .strip_prefix("phase")
        .map(|s| s.trim())
        .unwrap_or(&lower);
    !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())
}

fn extract_number_from_text(s: &str) -> Option<u32> {
    let lower = s.to_lowercase();
    let text = lower.trim().trim_start_matches('[').trim();
    if text.starts_with("phase") {
        let rem = text.trim_start_matches("phase").trim();
        let num_str: String = rem.chars().take_while(|c| c.is_ascii_digit()).collect();
        return num_str.parse::<u32>().ok();
    }
    let num_str: String = text.chars().take_while(|c| c.is_ascii_digit()).collect();
    if !num_str.is_empty() {
        return num_str.parse::<u32>().ok();
    }
    None
}

fn extract_markdown_link(s: &str) -> Option<String> {
    let mut search_from = 0;
    while let Some(rel_idx) = s[search_from..].find("](") {
        let close_bracket = search_from + rel_idx;
        if s[..close_bracket].rfind('[').is_some() {
            let after = &s[close_bracket + 2..];
            if let Some(close_paren) = after.find(')') {
                let link = after[..close_paren].trim();
                if !link.is_empty() {
                    return Some(link.to_string());
                }
            }
        }
        search_from = close_bracket + 2;
    }
    None
}

fn is_rejected_link(link: &str) -> bool {
    let trimmed = link.trim();
    trimmed.is_empty()
        || trimmed.starts_with('/')
        || trimmed.starts_with('\\')
        || trimmed.contains(':')
        || trimmed.contains("..")
        || trimmed.contains('\0')
}

fn normalize_local_link(link: &str) -> String {
    let mut clean = link.trim();
    // Strip query and fragment
    if let Some(idx) = clean.find('?') {
        clean = &clean[..idx];
    }
    if let Some(idx) = clean.find('#') {
        clean = &clean[..idx];
    }
    clean = clean.trim_start_matches("./");
    clean.to_string()
}

/// Normalize status cell: strip emphasis, qualifiers and map aliases.
fn parse_status_cell(cell: &str) -> PlanStatus {
    let trimmed = cell.trim();

    // Strip single parenthesized qualifier e.g. "Pending (initial snapshot)" or "**DONE** (verified)"
    let without_qualifier = if let Some(open_p) = trimmed.find('(') {
        if let Some(close_p) = trimmed.rfind(')') {
            if close_p > open_p {
                trimmed[..open_p].trim()
            } else {
                trimmed
            }
        } else {
            trimmed
        }
    } else {
        trimmed
    };

    // Remove markdown bold/italic/code e.g. **DONE** -> DONE
    let base = without_qualifier
        .trim_matches('*')
        .trim_matches('_')
        .trim_matches('`')
        .trim();

    let norm = base.to_lowercase();
    match norm.as_str() {
        "pending" | "planned" | "not started" => PlanStatus::Pending,
        "in-progress" | "in progress" | "ongoing" => PlanStatus::InProgress,
        "complete" | "completed" | "done" => PlanStatus::Completed,
        "cancelled" | "canceled" => PlanStatus::Cancelled,
        "blocked" => PlanStatus::Blocked,
        "unknown" | "unreported" => PlanStatus::Unknown,
        _ => PlanStatus::Unknown,
    }
}

#[derive(Debug, Clone)]
struct ProgressRow {
    phase_link: Option<String>,
    phase_number: Option<u32>,
    current_status: PlanStatus,
    raw_current: String,
    captured_status: Option<PlanStatus>,
    raw_captured: Option<String>,
    line: usize,
}

/// Parse progress.md: dates, current scalar status, summary prose, and reconciliation table.
fn parse_progress_document(
    path: &str,
    text: &str,
    diagnostics: &mut Vec<Diagnostic>,
) -> (
    PlanDates,
    Option<(PlanStatus, String, usize)>,
    Option<(PlanStatus, String, usize)>,
    Vec<ProgressRow>,
    bool,
) {
    let mut dates = PlanDates::default();
    let mut current_scalar = None;
    let mut summary = None;
    let mut reconciliation_rows = Vec::new();

    let lines: Vec<&str> = text.lines().collect();
    let mut table_lines = Vec::new();
    let mut in_reconciliation_section = false;
    let mut in_metadata_region = true;

    for (idx, line) in lines.iter().enumerate() {
        let line_num = idx + 1;
        let trimmed = line.trim();

        if trimmed.starts_with("## ") {
            in_metadata_region = false;
            let heading = trimmed.trim_start_matches("##").trim();
            if heading.starts_with("Phase Reconciliation")
                || heading.starts_with("Phase Summary")
                || heading.starts_with("Phases")
            {
                in_reconciliation_section = true;
            } else {
                in_reconciliation_section = false;
            }
        } else if in_reconciliation_section {
            if (table_lines.len() >= 2 && is_gfm_table_body_line(line))
                || (table_lines.len() < 2 && trimmed.contains('|'))
            {
                table_lines.push((line_num, line.to_string()));
            } else if !table_lines.is_empty() && (table_lines.len() >= 2 || !trimmed.is_empty()) {
                in_reconciliation_section = false;
            }
        } else if in_metadata_region {
            // Check standalone dates and Current status
            let clean = trimmed.replace("**", "").replace("__", "");
            let clean_line = clean.trim_start_matches('-').trim_start_matches('*').trim();
            let parts: Vec<&str> = clean_line.splitn(2, ':').collect();
            if parts.len() == 2 {
                let label = parts[0].trim().to_lowercase();
                let val = parts[1].trim();
                match label.as_str() {
                    "current status" => {
                        let parsed = parse_status_cell(val);
                        if parsed != PlanStatus::Unknown {
                            current_scalar = Some((parsed, val.to_string(), line_num));
                        } else if let Some((st, raw)) = parse_completion_summary_sentence(val) {
                            if st == PlanStatus::Unknown {
                                add_diagnostic(
                                    diagnostics,
                                    DIAG_UNSUPPORTED_STATUS,
                                    Some(path),
                                    Some(line_num),
                                    format!(
                                        "Unsupported or negated completion summary prose: {raw}"
                                    ),
                                );
                            }
                            summary = Some((st, raw, line_num));
                        } else {
                            current_scalar = Some((parsed, val.to_string(), line_num));
                        }
                    }
                    "published" => {
                        try_set_date_evidence(
                            path,
                            line_num,
                            val,
                            &mut dates.published,
                            diagnostics,
                        );
                    }
                    "created" => {
                        try_set_date_evidence(path, line_num, val, &mut dates.created, diagnostics);
                    }
                    "planned start" => {
                        try_set_date_evidence(
                            path,
                            line_num,
                            val,
                            &mut dates.planned_start,
                            diagnostics,
                        );
                    }
                    "planned end" => {
                        try_set_date_evidence(
                            path,
                            line_num,
                            val,
                            &mut dates.planned_end,
                            diagnostics,
                        );
                    }
                    "actual start" | "started" => {
                        try_set_date_evidence(
                            path,
                            line_num,
                            val,
                            &mut dates.actual_start,
                            diagnostics,
                        );
                    }
                    "actual end" | "completed" => {
                        try_set_date_evidence(
                            path,
                            line_num,
                            val,
                            &mut dates.actual_end,
                            diagnostics,
                        );
                    }
                    _ => {}
                }
            } else {
                // Check if line contains complete summary grammar
                if let Some((st, raw)) = parse_completion_summary_sentence(trimmed) {
                    if st == PlanStatus::Unknown {
                        add_diagnostic(
                            diagnostics,
                            DIAG_UNSUPPORTED_STATUS,
                            Some(path),
                            Some(line_num),
                            format!("Unsupported or negated completion summary prose: {raw}"),
                        );
                    }
                    summary = Some((st, raw, line_num));
                }
            }
        }
    }

    // Parse reconciliation table
    if !table_lines.is_empty() {
        if let Ok(rows) = parse_reconciliation_table(&table_lines) {
            reconciliation_rows = rows;
        } else {
            add_diagnostic(
                diagnostics,
                DIAG_PHASE_INVENTORY_INVALID,
                Some(path),
                None,
                "Failed to parse Phase Reconciliation table in progress.md",
            );
        }
    }

    (dates, current_scalar, summary, reconciliation_rows, true)
}

/// Tokenize and parse progress reconciliation table.
fn parse_reconciliation_table(table_lines: &[(usize, String)]) -> Result<Vec<ProgressRow>, ()> {
    if table_lines.len() < 2 {
        return Err(());
    }

    let header_cells = tokenize_table_row(&table_lines[0].1);
    if header_cells.is_empty() {
        return Err(());
    }

    let mut phase_col = None;
    let mut current_col = None;
    let mut status_col = None;
    let mut captured_col = None;

    for (idx, cell) in header_cells.iter().enumerate() {
        let norm = cell.trim().to_lowercase();
        if norm == "phase" || norm == "name" || norm == "#" {
            phase_col = Some(idx);
        } else if norm == "current status" {
            current_col = Some(idx);
        } else if norm == "status" {
            status_col = Some(idx);
        } else if norm == "captured status" {
            captured_col = Some(idx);
        }
    }
    let current_col = current_col.or(status_col);

    let delimiter_cells = tokenize_table_row(&table_lines[1].1);
    if delimiter_cells.len() != header_cells.len() {
        return Err(());
    }

    let mut rows = Vec::new();
    for (line_num, line_str) in &table_lines[2..] {
        let mut cells = tokenize_table_row(line_str);
        cells.resize(header_cells.len(), String::new());

        let raw_phase = phase_col
            .and_then(|idx| cells.get(idx))
            .map(|s| s.trim())
            .unwrap_or("");
        let raw_current = current_col
            .and_then(|idx| cells.get(idx))
            .map(|s| s.trim())
            .unwrap_or("");
        let raw_captured = captured_col
            .and_then(|idx| cells.get(idx))
            .map(|s| s.trim());

        let phase_link = extract_markdown_link(raw_phase).map(|l| normalize_local_link(&l));
        let phase_number = extract_number_from_text(raw_phase);

        let current_status = parse_status_cell(raw_current);
        let captured_status = raw_captured.map(parse_status_cell);

        rows.push(ProgressRow {
            phase_link,
            phase_number,
            current_status,
            raw_current: raw_current.to_string(),
            captured_status,
            raw_captured: raw_captured.map(|s| s.to_string()),
            line: *line_num,
        });
    }

    Ok(rows)
}

/// Parse corroborated All phases completion summary grammar.
fn parse_completion_summary_sentence(s: &str) -> Option<(PlanStatus, String)> {
    let lower = s.to_lowercase();
    let normalized = lower.split_whitespace().collect::<Vec<_>>().join(" ");
    if !normalized.contains("all phases") && !normalized.contains("plan execution") {
        return None;
    }

    // Accept the entire supported claim, not completion substrings or an
    // otherwise valid claim embedded in negated/conditional/extra prose.
    let sentence = normalized.strip_suffix('.').unwrap_or(&normalized);
    let valid = if sentence == "plan execution complete" {
        true
    } else {
        let sentence = sentence
            .strip_suffix(". plan execution complete")
            .unwrap_or(sentence);
        if let Some(rest) = sentence.strip_prefix("all phases ") {
            let rest = if rest.starts_with('(') {
                rest.find(')').and_then(|close| {
                    extract_summary_phase_numbers(sentence).ok()?;
                    rest[close + 1..].strip_prefix(' ')
                })
            } else {
                Some(rest)
            };
            rest.is_some_and(|rest| {
                let rest = rest.strip_prefix("are ").unwrap_or(rest);
                matches!(
                    rest,
                    "complete"
                        | "completed"
                        | "complete with durable task sealing"
                        | "completed with durable task sealing"
                )
            })
        } else {
            false
        }
    };
    Some((
        if valid {
            PlanStatus::Completed
        } else {
            PlanStatus::Unknown
        },
        s.to_string(),
    ))
}

/// Reconcile declared phases with progress rows and calculate overall status.
fn reconcile_statuses(
    plan_path: &str,
    progress_path: &str,
    has_progress: bool,
    progress_valid: bool,
    declared_phases: Vec<FilePlanPhase>,
    inventory_valid: bool,
    plan_frontmatter_status: Option<(PlanStatus, String, usize)>,
    progress_current_scalar: Option<(PlanStatus, String, usize)>,
    progress_summary: Option<(PlanStatus, String, usize)>,
    progress_rows: Vec<ProgressRow>,
    diagnostics: &mut Vec<Diagnostic>,
) -> (Vec<FilePlanPhase>, ReportedStatus) {
    if !has_progress {
        // Plan authority
        let mut overall_status = plan_frontmatter_status
            .as_ref()
            .map(|(st, _, _)| *st)
            .unwrap_or_else(|| derive_status_from_phases(&declared_phases));

        // Check for contradiction between frontmatter status and inventory
        if let Some((fm_st, _, line)) = plan_frontmatter_status.as_ref() {
            if *fm_st == PlanStatus::Completed
                && declared_phases
                    .iter()
                    .any(|p| p.reported_status.value == PlanStatus::Pending)
            {
                add_diagnostic(
                    diagnostics,
                    DIAG_STATUS_CONFLICT,
                    Some(plan_path),
                    Some(*line),
                    "Plan status claims completed but declared phases are pending",
                );
                overall_status = PlanStatus::Conflict;
            }
        }

        let evidence = plan_frontmatter_status
            .as_ref()
            .map(|(_, _, line)| {
                vec![SourceRef {
                    path: plan_path.to_string(),
                    line_start: *line,
                    line_end: *line,
                }]
            })
            .unwrap_or_default();

        let raw = plan_frontmatter_status.map(|(_, raw, _)| raw);

        return (
            declared_phases,
            ReportedStatus {
                value: overall_status,
                authority: PlanAuthority::Plan,
                raw,
                evidence,
                captured: Vec::new(),
            },
        );
    }

    // Progress authority
    if !progress_valid {
        let mut phases = declared_phases;
        for phase in &mut phases {
            let status = &mut phase.reported_status;
            for evidence in &status.evidence {
                status.captured.push(StatusEvidence {
                    value: status.value,
                    raw: status.raw.clone().unwrap_or_default(),
                    evidence: evidence.clone(),
                });
            }
            status.value = PlanStatus::Unknown;
            status.authority = PlanAuthority::Progress;
            status.raw = None;
            status.evidence.clear();
        }
        return (
            phases,
            ReportedStatus {
                value: PlanStatus::Unknown,
                authority: PlanAuthority::Progress,
                raw: None,
                evidence: vec![SourceRef {
                    path: progress_path.to_string(),
                    line_start: 1,
                    line_end: 1,
                }],
                captured: Vec::new(),
            },
        );
    }

    // Match progress rows to declared phases
    let mut updated_phases = declared_phases;
    let mut phase_matches = vec![None; updated_phases.len()];
    let mut phase_conflicts = vec![false; updated_phases.len()];
    let mut matched_progress_indices = HashSet::new();

    // Resolve all identity hints before projecting any row. A row has exactly one
    // consumer; inconsistent hints and duplicate claims invalidate affected phases.
    for (idx, row) in progress_rows.iter().enumerate() {
        let by_link = row.phase_link.as_ref().and_then(|link| {
            updated_phases
                .iter()
                .position(|phase| phase.path.as_ref() == Some(link))
        });
        let by_number = row.phase_number.and_then(|number| {
            updated_phases
                .iter()
                .position(|phase| phase.number == Some(number))
        });
        let matched_phase = if row.phase_link.is_some() && row.phase_number.is_some() {
            if by_link.is_none() || by_link != by_number {
                for phase_idx in [by_link, by_number].into_iter().flatten() {
                    phase_conflicts[phase_idx] = true;
                }
                add_diagnostic(
                    diagnostics,
                    DIAG_STATUS_CONFLICT,
                    Some(progress_path),
                    Some(row.line),
                    "Progress row phase link and number do not identify the same declared phase",
                );
                continue;
            }
            by_link
        } else if row.phase_link.is_some() {
            by_link
        } else {
            by_number
        };

        if let Some(phase_idx) = matched_phase {
            if phase_matches[phase_idx].is_some() {
                phase_conflicts[phase_idx] = true;
                add_diagnostic(
                    diagnostics,
                    DIAG_STATUS_CONFLICT,
                    Some(progress_path),
                    Some(row.line),
                    "Multiple progress rows identify the same declared phase",
                );
            } else {
                phase_matches[phase_idx] = Some(idx);
                matched_progress_indices.insert(idx);
            }
        }
    }

    for (phase_idx, phase) in updated_phases.iter_mut().enumerate() {
        if let Some(idx) = phase_matches[phase_idx] {
            let p_row = &progress_rows[idx];

            let mut captured = Vec::new();
            if let Some(cap_st) = p_row.captured_status {
                captured.push(StatusEvidence {
                    value: cap_st,
                    raw: p_row.raw_captured.clone().unwrap_or_default(),
                    evidence: SourceRef {
                        path: progress_path.to_string(),
                        line_start: p_row.line,
                        line_end: p_row.line,
                    },
                });
            }

            phase.reported_status = ReportedStatus {
                value: if phase_conflicts[phase_idx] {
                    PlanStatus::Conflict
                } else {
                    p_row.current_status
                },
                authority: PlanAuthority::Progress,
                raw: Some(p_row.raw_current.clone()),
                evidence: vec![SourceRef {
                    path: progress_path.to_string(),
                    line_start: p_row.line,
                    line_end: p_row.line,
                }],
                captured,
            };
        } else {
            // Unreported phase in progress.md
            add_diagnostic(
                diagnostics,
                DIAG_PHASE_UNREPORTED,
                Some(progress_path),
                None,
                format!("Declared phase '{}' unreported in progress.md", phase.id),
            );
            phase.reported_status = ReportedStatus {
                value: if phase_conflicts[phase_idx] {
                    PlanStatus::Conflict
                } else {
                    PlanStatus::Unknown
                },
                authority: PlanAuthority::Progress,
                raw: None,
                evidence: Vec::new(),
                captured: Vec::new(),
            };
        }
    }

    // Check for unmatched progress rows
    for (idx, p_row) in progress_rows.iter().enumerate() {
        if !matched_progress_indices.contains(&idx) {
            add_diagnostic(
                diagnostics,
                DIAG_PHASE_UNMATCHED,
                Some(progress_path),
                Some(p_row.line),
                format!(
                    "Progress row at line {} does not match any declared phase",
                    p_row.line
                ),
            );
        }
    }

    // Determine overall reported status
    let mut overall_value = if let Some((sum_st, sum_raw, line)) = progress_summary.as_ref() {
        if *sum_st == PlanStatus::Completed {
            let range_matches = match extract_summary_phase_numbers(sum_raw) {
                Ok(Some(sum_nums)) => {
                    let declared_nums: HashSet<u32> =
                        updated_phases.iter().filter_map(|p| p.number).collect();
                    sum_nums == declared_nums && declared_nums.len() == updated_phases.len()
                }
                Ok(None) => true,
                Err(()) => false,
            };

            // Corroborate: every declared current phase must independently report complete
            if inventory_valid
                && !updated_phases.is_empty()
                && range_matches
                && updated_phases
                    .iter()
                    .all(|p| p.reported_status.value == PlanStatus::Completed)
            {
                PlanStatus::Completed
            } else {
                add_diagnostic(
                    diagnostics,
                    DIAG_STATUS_CONFLICT,
                    Some(progress_path),
                    Some(*line),
                    "Summary claims complete but declared current phases or range do not match",
                );
                PlanStatus::Conflict
            }
        } else {
            *sum_st
        }
    } else if let Some((scal_st, _, _)) = progress_current_scalar.as_ref() {
        *scal_st
    } else {
        derive_status_from_phases(&updated_phases)
    };

    // If explicit scalar and summary disagree -> conflict
    if let (Some((scal_st, _, scal_line)), Some((sum_st, _, _))) =
        (progress_current_scalar.as_ref(), progress_summary.as_ref())
    {
        if *scal_st != *sum_st && *sum_st != PlanStatus::Unknown {
            add_diagnostic(
                diagnostics,
                DIAG_STATUS_CONFLICT,
                Some(progress_path),
                Some(*scal_line),
                "Current status scalar and summary sentence disagree",
            );
            overall_value = PlanStatus::Conflict;
        }
    }

    let evidence = if let Some((_, _, line)) = progress_current_scalar {
        vec![SourceRef {
            path: progress_path.to_string(),
            line_start: line,
            line_end: line,
        }]
    } else if let Some((_, _, line)) = progress_summary {
        vec![SourceRef {
            path: progress_path.to_string(),
            line_start: line,
            line_end: line,
        }]
    } else {
        Vec::new()
    };

    let raw = progress_current_scalar
        .map(|(_, r, _)| r)
        .or_else(|| progress_summary.map(|(_, r, _)| r));

    (
        updated_phases,
        ReportedStatus {
            value: overall_value,
            authority: PlanAuthority::Progress,
            raw,
            evidence,
            captured: Vec::new(),
        },
    )
}

fn derive_status_from_phases(phases: &[FilePlanPhase]) -> PlanStatus {
    if phases.is_empty() {
        return PlanStatus::Unknown;
    }

    let all_completed = phases
        .iter()
        .all(|p| p.reported_status.value == PlanStatus::Completed);
    if all_completed {
        return PlanStatus::Completed;
    }

    let all_cancelled = phases
        .iter()
        .all(|p| p.reported_status.value == PlanStatus::Cancelled);
    if all_cancelled {
        return PlanStatus::Cancelled;
    }

    let any_blocked = phases
        .iter()
        .any(|p| p.reported_status.value == PlanStatus::Blocked);
    if any_blocked {
        return PlanStatus::Blocked;
    }

    let all_pending = phases
        .iter()
        .all(|p| p.reported_status.value == PlanStatus::Pending);
    if all_pending {
        return PlanStatus::Pending;
    }

    let any_in_progress = phases
        .iter()
        .any(|p| p.reported_status.value == PlanStatus::InProgress);
    let any_completed = phases
        .iter()
        .any(|p| p.reported_status.value == PlanStatus::Completed);
    let any_pending = phases
        .iter()
        .any(|p| p.reported_status.value == PlanStatus::Pending);

    if any_in_progress || (any_completed && any_pending) {
        return PlanStatus::InProgress;
    }

    PlanStatus::Unknown
}

/// Compute known completed/declared fraction only with valid nonempty inventory.
fn compute_completion(phases: &[FilePlanPhase], inventory_valid: bool) -> PlanCompletion {
    if !inventory_valid || phases.is_empty() {
        return PlanCompletion {
            declared: None,
            completed: 0,
            unknown: 0,
            conflicted: 0,
            fraction: None,
        };
    }

    let declared = phases.len() as u32;
    let mut completed = 0;
    let mut unknown = 0;
    let mut conflicted = 0;
    let mut recognized = 0;

    for p in phases {
        match p.reported_status.value {
            PlanStatus::Completed => {
                completed += 1;
                recognized += 1;
            }
            PlanStatus::Unknown => unknown += 1,
            PlanStatus::Conflict => conflicted += 1,
            PlanStatus::Pending
            | PlanStatus::InProgress
            | PlanStatus::Cancelled
            | PlanStatus::Blocked => {
                recognized += 1;
            }
        }
    }

    let fraction = if recognized > 0 {
        Some(completed as f64 / declared as f64)
    } else {
        None
    };

    PlanCompletion {
        declared: Some(declared),
        completed,
        unknown,
        conflicted,
        fraction,
    }
}

/// Reconcile explicit dates according to contracts section 6.
fn reconcile_dates(
    plan_path: &str,
    progress_path: &str,
    plan_dates: PlanDates,
    progress_dates: PlanDates,
    diagnostics: &mut Vec<Diagnostic>,
) -> PlanDates {
    let mut res = PlanDates::default();

    // 1. Created: plan first, progress fills absent
    res.created = plan_dates.created.or(progress_dates.created);

    // 2. Planned: plan first, progress fills absent
    res.planned_start = plan_dates.planned_start.or(progress_dates.planned_start);
    res.planned_end = plan_dates.planned_end.or(progress_dates.planned_end);

    // 3. Actual: explicit progress and plan evidence must agree when both claim values
    res.actual_start = match (plan_dates.actual_start, progress_dates.actual_start) {
        (Some(pl), Some(pr)) => {
            if pl.value == pr.value && pl.precision == pr.precision {
                Some(pl)
            } else {
                add_diagnostic(
                    diagnostics,
                    DIAG_DATE_CONFLICT,
                    Some(progress_path),
                    None,
                    "Actual start date conflict between plan.md and progress.md",
                );
                None
            }
        }
        (Some(pl), None) => Some(pl),
        (None, Some(pr)) => Some(pr),
        (None, None) => None,
    };

    res.actual_end = match (plan_dates.actual_end, progress_dates.actual_end) {
        (Some(pl), Some(pr)) => {
            if pl.value == pr.value && pl.precision == pr.precision {
                Some(pl)
            } else {
                add_diagnostic(
                    diagnostics,
                    DIAG_DATE_CONFLICT,
                    Some(progress_path),
                    None,
                    "Actual end date conflict between plan.md and progress.md",
                );
                None
            }
        }
        (Some(pl), None) => Some(pl),
        (None, Some(pr)) => Some(pr),
        (None, None) => None,
    };

    // 4. Published: latest progress publication supersedes older plan publication
    res.published = progress_dates.published.or(plan_dates.published);

    // Validate ranges
    validate_date_range(
        plan_path,
        &res.planned_start,
        &res.planned_end,
        "planned",
        diagnostics,
    );
    validate_date_range(
        plan_path,
        &res.actual_start,
        &res.actual_end,
        "actual",
        diagnostics,
    );

    res
}

fn validate_date_range(
    path: &str,
    start: &Option<DateEvidence>,
    end: &Option<DateEvidence>,
    range_name: &str,
    diagnostics: &mut Vec<Diagnostic>,
) {
    if let (Some(s), Some(e)) = (start, end) {
        if s.precision != e.precision {
            add_diagnostic(
                diagnostics,
                DIAG_INVALID_DATE,
                Some(path),
                None,
                format!("{range_name} range has mixed date precision"),
            );
        } else if s.value > e.value {
            add_diagnostic(
                diagnostics,
                DIAG_INVALID_DATE,
                Some(path),
                None,
                format!("{range_name} start is after end date"),
            );
        }
    }
}

fn enforce_metadata_bounds(
    metadata: &mut FilePlanMetadata,
    path: &str,
    diagnostics: &mut Vec<Diagnostic>,
) {
    if let Some(p) = &metadata.priority {
        if p.len() > MAX_METADATA_STRING_BYTES {
            add_diagnostic(
                diagnostics,
                DIAG_FIELD_TOO_LARGE,
                Some(path),
                None,
                "Priority exceeds 4 KiB",
            );
            metadata.priority = None;
        }
    }
    if let Some(ef) = &metadata.effort {
        if ef.len() > MAX_METADATA_STRING_BYTES {
            add_diagnostic(
                diagnostics,
                DIAG_FIELD_TOO_LARGE,
                Some(path),
                None,
                "Effort exceeds 4 KiB",
            );
            metadata.effort = None;
        }
    }
    if let Some(iss) = &metadata.issue {
        if iss.len() > MAX_METADATA_STRING_BYTES {
            add_diagnostic(
                diagnostics,
                DIAG_FIELD_TOO_LARGE,
                Some(path),
                None,
                "Issue exceeds 4 KiB",
            );
            metadata.issue = None;
        }
    }
    if let Some(br) = &metadata.branch {
        if br.len() > MAX_METADATA_STRING_BYTES {
            add_diagnostic(
                diagnostics,
                DIAG_FIELD_TOO_LARGE,
                Some(path),
                None,
                "Branch exceeds 4 KiB",
            );
            metadata.branch = None;
        }
    }
}

fn has_duplicate_yaml_keys_or_aliases(content: &str) -> Option<&'static str> {
    let mut seen_keys = HashSet::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if trimmed.contains(": *") || trimmed.contains(": &") || trimmed.contains(": !") {
            return Some("Unsupported YAML alias, anchor, or custom tag");
        }
        if !line.starts_with(' ') && !line.starts_with('\t') && !line.starts_with('-') {
            if let Some(colon_idx) = line.find(':') {
                let key = line[..colon_idx].trim();
                if !key.is_empty() && !seen_keys.insert(key.to_string()) {
                    return Some("Duplicate YAML key in frontmatter");
                }
            }
        }
    }
    None
}

fn extract_summary_phase_numbers(s: &str) -> Result<Option<HashSet<u32>>, ()> {
    let Some(open) = s.find('(') else {
        return if s.contains(')') { Err(()) } else { Ok(None) };
    };
    let close = s[open..].find(')').ok_or(())? + open;
    let inner = s[open + 1..close].trim().to_lowercase();
    if inner.is_empty() || inner.contains('(') || s[close + 1..].contains(['(', ')']) {
        return Err(());
    }

    fn number(value: &str) -> Result<u32, ()> {
        let value = value.trim();
        let value = value.strip_prefix("phase ").unwrap_or(value).trim();
        if value.is_empty() || !value.chars().all(|c| c.is_ascii_digit()) {
            return Err(());
        }
        let number = value.parse::<u32>().map_err(|_| ())?;
        if number == 0 {
            return Err(());
        }
        Ok(number)
    }

    let mut nums = HashSet::new();
    if let Some((left, right)) = inner.split_once('–').or_else(|| inner.split_once('-')) {
        let start = number(left)?;
        let end = number(right)?;
        if end
            .checked_sub(start)
            .and_then(|span| span.checked_add(1))
            .map_or(true, |count| count > MAX_DECLARED_PHASE_ROWS as u32)
        {
            return Err(());
        }
        nums.extend(start..=end);
    } else {
        for part in inner.split(',') {
            for sub in part.split(" and ") {
                if !nums.insert(number(sub)?) || nums.len() > MAX_DECLARED_PHASE_ROWS {
                    return Err(());
                }
            }
        }
    }
    Ok(Some(nums))
}

fn add_diagnostic(
    diagnostics: &mut Vec<Diagnostic>,
    code: &'static str,
    path: Option<&str>,
    line: Option<usize>,
    message: impl Into<String>,
) {
    if diagnostics.len() < MAX_DIAGNOSTICS_PER_PLAN {
        let mut msg = message.into();
        if msg.len() > MAX_DIAGNOSTIC_RAW_TEXT_BYTES {
            let mut trunc = MAX_DIAGNOSTIC_RAW_TEXT_BYTES.saturating_sub(15);
            while !msg.is_char_boundary(trunc) && trunc > 0 {
                trunc -= 1;
            }
            msg.truncate(trunc);
            msg.push_str("... [truncated]");
        }
        diagnostics.push(Diagnostic {
            code: code.to_string(),
            path: path.map(|s| s.to_string()),
            line,
            message: msg,
        });
    }
}

fn cap_diagnostics(diagnostics: &mut Vec<Diagnostic>) {
    if diagnostics.len() >= MAX_DIAGNOSTICS_PER_PLAN {
        diagnostics.truncate(MAX_DIAGNOSTICS_PER_PLAN - 1);
        diagnostics.push(Diagnostic {
            code: DIAG_DIAGNOSTICS_LIMIT.to_string(),
            path: None,
            line: None,
            message: format!("Diagnostics count reached limit of {MAX_DIAGNOSTICS_PER_PLAN}"),
        });
    }
}
