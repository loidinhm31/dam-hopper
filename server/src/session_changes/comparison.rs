use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use crate::session_changes::inventory::capture_inventory;
use crate::session_changes::store::{SessionChangesKey, SessionChangesService};
use crate::session_changes::text_diff::{compute_line_stats, count_logical_lines, DiffStatsResult};
use crate::session_changes::types::*;

pub use crate::session_changes::store::{ComparisonArtifact, FileRowInternal};

pub async fn run_comparison_scan(
    service: &Arc<SessionChangesService>,
    key: &SessionChangesKey,
    settled_turn_id: Option<String>,
) -> Result<Comparison, ErrorCode> {
    // Check record exists and is ready/incomplete
    let (canonical_root, baseline_inventory, expected_baseline_id) = {
        let records = service.records.lock();
        let rec = records.get(key).ok_or(ErrorCode::BaselineMissing)?;
        if rec.state != StatusState::Ready && rec.state != StatusState::Incomplete {
            return Err(ErrorCode::OriginalUnavailable);
        }
        let inv = rec
            .baseline_inventory
            .as_ref()
            .ok_or(ErrorCode::BaselineMissing)?
            .clone();
        let bid = rec.baseline_id.clone().ok_or(ErrorCode::BaselineMissing)?;
        (rec.canonical_root.clone(), inv, bid)
    };

    // Acquire global blocking permit
    let _permit = service
        .blocking_permits
        .clone()
        .try_acquire_owned()
        .map_err(|_| ErrorCode::Busy)?;

    // Fresh scan of current files
    let current_inventory = tokio::task::spawn_blocking(move || {
        capture_inventory(&canonical_root, Duration::from_secs(MAX_COMPARISON_DURATION_SECS))
    })
    .await
    .map_err(|_| ErrorCode::Deadline)?
    .map_err(|_| ErrorCode::TargetUnavailable)?;

    // Union paths
    let mut all_paths = BTreeMap::new();
    for (p, f) in &baseline_inventory.files {
        all_paths.insert(p.clone(), (Some(f.clone()), None));
    }
    for (p, f) in &current_inventory.files {
        all_paths
            .entry(p.clone())
            .or_insert_with(|| (None, None))
            .1 = Some(f.clone());
    }

    let mut changed_rows = Vec::new();
    let mut total_adds: u64 = 0;
    let mut total_dels: u64 = 0;
    let mut counts_complete = true;

    let mut file_idx = 1;

    for (path, (base_opt, curr_opt)) in all_paths {
        match (base_opt, curr_opt) {
            (Some(base_file), Some(curr_file)) => {
                let bytes_equal = if base_file.kind != FileContentKind::Text || curr_file.kind != FileContentKind::Text {
                    base_file.sha256 == curr_file.sha256
                } else {
                    base_file.bytes == curr_file.bytes
                };
                if bytes_equal {
                    if base_file.mode != curr_file.mode {
                        // Mode only change
                        let row = FileRow {
                            file_id: format!("fid-{file_idx}"),
                            path: path.clone(),
                            change: FileChangeKind::ModeOnly,
                            original_presence: Presence::Present,
                            original_provenance: Provenance::Captured,
                            current_presence: Presence::Present,
                            original_kind: base_file.kind,
                            current_kind: curr_file.kind,
                            original_mode: base_file.mode,
                            current_mode: curr_file.mode,
                            additions: Some(0),
                            deletions: Some(0),
                            reasons: Vec::new(),
                        };
                        file_idx += 1;
                        changed_rows.push(FileRowInternal {
                            row,
                            original_file: Some(base_file),
                            current_file: Some(curr_file),
                        });
                    }
                    // Else: unchanged, omitted from changed list
                } else {
                    // Content modified
                    let diff_stats = if base_file.kind == FileContentKind::Text && curr_file.kind == FileContentKind::Text {
                        compute_line_stats(&base_file.bytes, &curr_file.bytes)
                    } else {
                        counts_complete = false;
                        DiffStatsResult {
                            additions: None,
                            deletions: None,
                            reasons: vec![CoverageReason::Binary],
                        }
                    };
                    if let (Some(a), Some(d)) = (diff_stats.additions, diff_stats.deletions) {
                        total_adds = total_adds.saturating_add(a);
                        total_dels = total_dels.saturating_add(d);
                    } else {
                        counts_complete = false;
                    }

                    let row = FileRow {
                        file_id: format!("fid-{file_idx}"),
                        path: path.clone(),
                        change: FileChangeKind::Modified,
                        original_presence: Presence::Present,
                        original_provenance: Provenance::Captured,
                        current_presence: Presence::Present,
                        original_kind: base_file.kind,
                        current_kind: curr_file.kind,
                        original_mode: base_file.mode,
                        current_mode: curr_file.mode,
                        additions: diff_stats.additions,
                        deletions: diff_stats.deletions,
                        reasons: diff_stats.reasons,
                    };
                    file_idx += 1;
                    changed_rows.push(FileRowInternal {
                        row,
                        original_file: Some(base_file),
                        current_file: Some(curr_file),
                    });
                }
            }
            (Some(base_file), None) => {
                let proof = current_inventory.trie.prove_path(Path::new(&path));
                let is_verified_deleted = proof.provenance == Provenance::AbsentInVerifiedDirectory;

                let (dels, dels_complete) = if base_file.kind == FileContentKind::Text {
                    match std::str::from_utf8(&base_file.bytes) {
                        Ok(s) => count_logical_lines(s),
                        Err(_) => (0, false),
                    }
                } else {
                    (0, false)
                };

                if is_verified_deleted && dels_complete && base_file.kind == FileContentKind::Text {
                    total_dels = total_dels.saturating_add(dels as u64);
                } else {
                    counts_complete = false;
                }

                let mut reasons = Vec::new();
                if !is_verified_deleted {
                    reasons.push(CoverageReason::AbsenceUnknown);
                }
                if base_file.kind != FileContentKind::Text {
                    reasons.push(CoverageReason::Binary);
                }

                let row = FileRow {
                    file_id: format!("fid-{file_idx}"),
                    path: path.clone(),
                    change: if is_verified_deleted { FileChangeKind::Deleted } else { FileChangeKind::Unknown },
                    original_presence: Presence::Present,
                    original_provenance: Provenance::Captured,
                    current_presence: if is_verified_deleted { Presence::Absent } else { Presence::Unknown },
                    original_kind: base_file.kind,
                    current_kind: FileContentKind::Unknown,
                    original_mode: base_file.mode,
                    current_mode: None,
                    additions: Some(0),
                    deletions: if base_file.kind == FileContentKind::Text && is_verified_deleted { Some(dels as u64) } else { None },
                    reasons,
                };
                file_idx += 1;
                changed_rows.push(FileRowInternal {
                    row,
                    original_file: Some(base_file),
                    current_file: None,
                });
            }
            (None, Some(curr_file)) => {
                // File only in current inventory: test absence proof against baseline trie
                let proof = baseline_inventory.trie.prove_path(Path::new(&path));

                if proof.provenance == Provenance::AbsentInVerifiedDirectory {
                    // Truly absent sibling proven -> known Added!
                    let (adds, _) = match std::str::from_utf8(&curr_file.bytes) {
                        Ok(s) => count_logical_lines(s),
                        Err(_) => (0, false),
                    };
                    total_adds = total_adds.saturating_add(adds as u64);

                    let row = FileRow {
                        file_id: format!("fid-{file_idx}"),
                        path: path.clone(),
                        change: FileChangeKind::Added,
                        original_presence: Presence::Absent,
                        original_provenance: Provenance::AbsentInVerifiedDirectory,
                        current_presence: Presence::Present,
                        original_kind: FileContentKind::Unknown,
                        current_kind: curr_file.kind,
                        original_mode: None,
                        current_mode: curr_file.mode,
                        additions: Some(adds as u64),
                        deletions: Some(0),
                        reasons: Vec::new(),
                    };
                    file_idx += 1;
                    changed_rows.push(FileRowInternal {
                        row,
                        original_file: None,
                        current_file: Some(curr_file),
                    });
                } else {
                    // ExcludedAtCapture or Unproven => Unknown change, null counts
                    counts_complete = false;
                    let mut reasons = Vec::new();
                    if let Some(r) = proof.reason {
                        reasons.push(r);
                    } else {
                        reasons.push(CoverageReason::AbsenceUnknown);
                    }

                    let row = FileRow {
                        file_id: format!("fid-{file_idx}"),
                        path: path.clone(),
                        change: FileChangeKind::Unknown,
                        original_presence: proof.presence,
                        original_provenance: proof.provenance,
                        current_presence: Presence::Present,
                        original_kind: FileContentKind::Unknown,
                        current_kind: curr_file.kind,
                        original_mode: None,
                        current_mode: curr_file.mode,
                        additions: None,
                        deletions: None,
                        reasons,
                    };
                    file_idx += 1;
                    changed_rows.push(FileRowInternal {
                        row,
                        original_file: None,
                        current_file: Some(curr_file),
                    });
                }
            }
            (None, None) => {}
        }
    }

    let changed_count = changed_rows.len() as u64;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let mut records = service.records.lock();
    let rec = records.get_mut(key).ok_or(ErrorCode::BaselineMissing)?;
    if rec.baseline_id.as_deref() != Some(&expected_baseline_id) {
        return Err(ErrorCode::RefreshRequired);
    }
    rec.comparison_revision += 1;
    let revision_str = rec.comparison_revision.to_string();

    let comparison = Comparison {
        server_epoch: service.server_epoch.clone(),
        baseline_id: rec.baseline_id.clone().unwrap_or_default(),
        comparison_revision: revision_str,
        compared_at_ms: now_ms,
        current_coverage: current_inventory.coverage,
        changed_file_count: changed_count,
        additions: if counts_complete { Some(total_adds) } else { None },
        deletions: if counts_complete { Some(total_dels) } else { None },
        counts_complete,
        settled_turn_id,
    };

    rec.comparison = Some(ComparisonArtifact {
        comparison: comparison.clone(),
        rows: changed_rows,
    });

    Ok(comparison)
}

pub fn list_changed_files(
    service: &Arc<SessionChangesService>,
    key: &SessionChangesKey,
    expected_revision: &str,
    cursor: Option<&str>,
    limit: Option<usize>,
) -> Result<FilePage, ErrorCode> {
    let records = service.records.lock();
    let rec = records.get(key).ok_or(ErrorCode::BaselineMissing)?;

    let artifact = rec.comparison.as_ref().ok_or(ErrorCode::RefreshRequired)?;
    if artifact.comparison.comparison_revision != expected_revision {
        return Err(ErrorCode::RefreshRequired);
    }

    let start_offset = if let Some(c) = cursor {
        if let Ok(decoded) = BASE64.decode(c) {
            String::from_utf8(decoded)
                .ok()
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap_or(0)
        } else {
            0
        }
    } else {
        0
    };

    let page_size = limit.unwrap_or(DEFAULT_PAGE_LIMIT).clamp(1, MAX_PAGE_LIMIT);
    let total_rows = artifact.rows.len();

    let paged_rows = if start_offset < total_rows {
        let end = (start_offset + page_size).min(total_rows);
        artifact.rows[start_offset..end]
            .iter()
            .map(|r| r.row.clone())
            .collect()
    } else {
        Vec::new()
    };

    let next_cursor = if start_offset + page_size < total_rows {
        Some(BASE64.encode((start_offset + page_size).to_string()))
    } else {
        None
    };

    Ok(FilePage {
        version: 1,
        comparison: artifact.comparison.clone(),
        files: paged_rows,
        next_cursor,
    })
}

pub fn get_file_detail(
    service: &Arc<SessionChangesService>,
    key: &SessionChangesKey,
    expected_revision: &str,
    file_id: &str,
) -> Result<FileDetail, ErrorCode> {
    let records = service.records.lock();
    let rec = records.get(key).ok_or(ErrorCode::BaselineMissing)?;

    let artifact = rec.comparison.as_ref().ok_or(ErrorCode::RefreshRequired)?;
    if artifact.comparison.comparison_revision != expected_revision {
        return Err(ErrorCode::RefreshRequired);
    }

    let row_internal = artifact
        .rows
        .iter()
        .find(|r| r.row.file_id == file_id)
        .ok_or(ErrorCode::FileMissing)?;

    let row = &row_internal.row;
    let original_side = if let Some(b) = &row_internal.original_file {
        ContentSide {
            presence: Presence::Present,
            content: if row.original_kind == FileContentKind::Text {
                std::str::from_utf8(&b.bytes).ok().map(|s| s.to_string())
            } else {
                None
            },
            byte_length: Some(b.size_bytes),
            sha256: Some(b.sha256.clone()),
            mode: b.mode,
        }
    } else {
        ContentSide {
            presence: row.original_presence,
            content: None,
            byte_length: None,
            sha256: None,
            mode: None,
        }
    };

    let current_side = if let Some(c) = &row_internal.current_file {
        ContentSide {
            presence: Presence::Present,
            content: if row.current_kind == FileContentKind::Text {
                std::str::from_utf8(&c.bytes).ok().map(|s| s.to_string())
            } else {
                None
            },
            byte_length: Some(c.size_bytes),
            sha256: Some(c.sha256.clone()),
            mode: c.mode,
        }
    } else {
        ContentSide {
            presence: row.current_presence,
            content: None,
            byte_length: None,
            sha256: None,
            mode: None,
        }
    };

    let renderable = match row.change {
        FileChangeKind::Added => row.current_kind == FileContentKind::Text,
        FileChangeKind::Deleted => row.original_kind == FileContentKind::Text,
        FileChangeKind::Modified => {
            row.original_kind == FileContentKind::Text && row.current_kind == FileContentKind::Text
        }
        FileChangeKind::ModeOnly => true,
        FileChangeKind::Unknown => false,
    };

    Ok(FileDetail {
        version: 1,
        server_epoch: service.server_epoch.clone(),
        baseline_id: rec.baseline_id.clone().unwrap_or_default(),
        comparison_revision: expected_revision.to_string(),
        file: row.clone(),
        original: original_side,
        current: current_side,
        renderable,
    })
}
