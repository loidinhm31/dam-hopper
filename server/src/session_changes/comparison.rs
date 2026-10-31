use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
#[cfg(unix)]
use std::os::unix::io::AsRawFd;
use std::sync::Arc;

use crate::session_changes::capture::{probe_file_safely, ProbeResult};
use crate::session_changes::store::{ComparisonRowMeta, SessionChangesKey, SessionChangesService};
use crate::session_changes::text_diff::{compute_line_stats, count_logical_lines, DiffStatsResult};
use crate::session_changes::types::*;

pub use crate::session_changes::store::ComparisonArtifact;

pub async fn run_comparison_scan(
    service: &Arc<SessionChangesService>,
    key: &SessionChangesKey,
    settled_turn_id: Option<String>,
) -> Result<Comparison, ErrorCode> {
    let (enabled, generation) = service.current_generation();
    if !enabled {
        return Err(ErrorCode::TrackingDisabled);
    }

    let (canonical_root, root_file_opt, expected_baseline_id, tracked_entries) = {
        let lifecycle = service.lifecycle.read();
        if !lifecycle.enabled || lifecycle.generation != generation {
            return Err(ErrorCode::TrackingDisabled);
        }
        let records = service.records.lock();
        let rec = records.get(key).ok_or(ErrorCode::BaselineMissing)?;
        if rec.state != StatusState::Ready && rec.state != StatusState::Incomplete {
            return Err(ErrorCode::OriginalUnavailable);
        }
        (
            rec.canonical_root.clone(),
            rec.root_dir_file.clone(),
            rec.baseline_id.clone(),
            rec.tracked_paths.values().cloned().collect::<Vec<_>>(),
        )
    };

    let canonical_root_clone = canonical_root.clone();
    let service_clone = service.clone();
    let root_file_clone = root_file_opt.clone();

    let comparison_eval = tokio::task::spawn_blocking(move || {
        let _permit = match service_clone.blocking_permits.clone().try_acquire_owned() {
            Ok(p) => p,
            Err(_) => return Err(ErrorCode::Busy),
        };

        #[cfg(unix)]
        let root_fd = root_file_clone.as_ref().map(|f| f.as_raw_fd());
        #[cfg(not(unix))]
        let root_fd = None;

        let mut changed_rows = Vec::new();
        let mut total_adds: u64 = 0;
        let mut total_dels: u64 = 0;
        let mut counts_complete = true;

        let mut current_reasons = Vec::new();
        let mut current_captured: u64 = 0;

        let start_time = std::time::Instant::now();
        let max_duration = std::time::Duration::from_secs(MAX_COMPARISON_DURATION_SECS);

        for entry in tracked_entries {
            if start_time.elapsed() > max_duration {
                return Err(ErrorCode::Deadline);
            }
            let path = entry.path.clone();
            let probe_res = probe_file_safely(root_fd, &canonical_root_clone, &path);

            match &probe_res {
                ProbeResult::Present { .. } | ProbeResult::AbsentAtFirstTouch => {
                    current_captured += 1;
                }
                ProbeResult::Unknown { reason } | ProbeResult::Excluded { reason } => {
                    if !current_reasons.contains(reason) {
                        current_reasons.push(*reason);
                    }
                }
            }

            match entry.presence {
                Presence::Present => {
                    let base_bytes = entry.bytes.as_deref().unwrap_or(&[]);

                    match probe_res {
                        ProbeResult::Present {
                            bytes: curr_bytes,
                            size_bytes: curr_size,
                            sha256: curr_sha,
                            mode: curr_mode,
                            kind: curr_kind,
                        } => {
                            let bytes_equal = if entry.kind != FileContentKind::Text
                                || curr_kind != FileContentKind::Text
                            {
                                entry.sha256.as_deref() == Some(&curr_sha)
                            } else {
                                base_bytes == curr_bytes.as_ref()
                            };

                            if bytes_equal {
                                if entry.mode != curr_mode {
                                    let row = FileRow {
                                        file_id: entry.file_id.clone(),
                                        path: path.clone(),
                                        change: FileChangeKind::ModeOnly,
                                        original_presence: Presence::Present,
                                        original_provenance: entry.provenance,
                                        current_presence: Presence::Present,
                                        original_kind: entry.kind,
                                        current_kind: curr_kind,
                                        original_mode: entry.mode,
                                        current_mode: curr_mode,
                                        additions: Some(0),
                                        deletions: Some(0),
                                        reasons: Vec::new(),
                                    };
                                    changed_rows.push(ComparisonRowMeta {
                                        row,
                                        current_sha256: Some(curr_sha),
                                        current_size_bytes: Some(curr_size),
                                        current_mode: curr_mode,
                                    });
                                }
                                // If bytes equal and mode equal, untouched or reverted -> omit!
                            } else {
                                let diff_stats = if entry.kind == FileContentKind::Text
                                    && curr_kind == FileContentKind::Text
                                {
                                    compute_line_stats(base_bytes, &curr_bytes)
                                } else {
                                    counts_complete = false;
                                    DiffStatsResult {
                                        additions: None,
                                        deletions: None,
                                        reasons: vec![CoverageReason::Binary],
                                    }
                                };

                                if let (Some(a), Some(d)) =
                                    (diff_stats.additions, diff_stats.deletions)
                                {
                                    total_adds = total_adds.saturating_add(a);
                                    total_dels = total_dels.saturating_add(d);
                                } else {
                                    counts_complete = false;
                                }

                                let row = FileRow {
                                    file_id: entry.file_id.clone(),
                                    path: path.clone(),
                                    change: FileChangeKind::Modified,
                                    original_presence: Presence::Present,
                                    original_provenance: entry.provenance,
                                    current_presence: Presence::Present,
                                    original_kind: entry.kind,
                                    current_kind: curr_kind,
                                    original_mode: entry.mode,
                                    current_mode: curr_mode,
                                    additions: diff_stats.additions,
                                    deletions: diff_stats.deletions,
                                    reasons: diff_stats.reasons,
                                };
                                changed_rows.push(ComparisonRowMeta {
                                    row,
                                    current_sha256: Some(curr_sha),
                                    current_size_bytes: Some(curr_size),
                                    current_mode: curr_mode,
                                });
                            }
                        }
                        ProbeResult::AbsentAtFirstTouch => {
                            let (dels, dels_complete) = if entry.kind == FileContentKind::Text {
                                match std::str::from_utf8(base_bytes) {
                                    Ok(s) => count_logical_lines(s),
                                    Err(_) => (0, false),
                                }
                            } else {
                                (0, false)
                            };

                            if dels_complete && entry.kind == FileContentKind::Text {
                                total_dels = total_dels.saturating_add(dels as u64);
                            } else {
                                counts_complete = false;
                            }

                            let row = FileRow {
                                file_id: entry.file_id.clone(),
                                path: path.clone(),
                                change: FileChangeKind::Deleted,
                                original_presence: Presence::Present,
                                original_provenance: entry.provenance,
                                current_presence: Presence::Absent,
                                original_kind: entry.kind,
                                current_kind: FileContentKind::Unknown,
                                original_mode: entry.mode,
                                current_mode: None,
                                additions: Some(0),
                                deletions: if entry.kind == FileContentKind::Text {
                                    Some(dels as u64)
                                } else {
                                    None
                                },
                                reasons: if entry.kind != FileContentKind::Text {
                                    vec![CoverageReason::Binary]
                                } else {
                                    Vec::new()
                                },
                            };
                            changed_rows.push(ComparisonRowMeta {
                                row,
                                current_sha256: None,
                                current_size_bytes: None,
                                current_mode: None,
                            });
                        }
                        ProbeResult::Unknown { reason } | ProbeResult::Excluded { reason } => {
                            counts_complete = false;
                            let row = FileRow {
                                file_id: entry.file_id.clone(),
                                path: path.clone(),
                                change: FileChangeKind::Unknown,
                                original_presence: Presence::Present,
                                original_provenance: entry.provenance,
                                current_presence: Presence::Unknown,
                                original_kind: entry.kind,
                                current_kind: FileContentKind::Unknown,
                                original_mode: entry.mode,
                                current_mode: None,
                                additions: None,
                                deletions: None,
                                reasons: vec![reason],
                            };
                            changed_rows.push(ComparisonRowMeta {
                                row,
                                current_sha256: None,
                                current_size_bytes: None,
                                current_mode: None,
                            });
                        }
                    }
                }
                Presence::Absent => {
                    match probe_res {
                        ProbeResult::Present {
                            bytes: curr_bytes,
                            size_bytes: curr_size,
                            sha256: curr_sha,
                            mode: curr_mode,
                            kind: curr_kind,
                        } => {
                            let (adds, adds_complete) = if curr_kind == FileContentKind::Text {
                                match std::str::from_utf8(&curr_bytes) {
                                    Ok(s) => count_logical_lines(s),
                                    Err(_) => (0, false),
                                }
                            } else {
                                (0, false)
                            };

                            if adds_complete && curr_kind == FileContentKind::Text {
                                total_adds = total_adds.saturating_add(adds as u64);
                            } else {
                                counts_complete = false;
                            }

                            let row = FileRow {
                                file_id: entry.file_id.clone(),
                                path: path.clone(),
                                change: FileChangeKind::Added,
                                original_presence: Presence::Absent,
                                original_provenance: entry.provenance,
                                current_presence: Presence::Present,
                                original_kind: FileContentKind::Unknown,
                                current_kind: curr_kind,
                                original_mode: None,
                                current_mode: curr_mode,
                                additions: if curr_kind == FileContentKind::Text {
                                    Some(adds as u64)
                                } else {
                                    None
                                },
                                deletions: Some(0),
                                reasons: if curr_kind != FileContentKind::Text {
                                    vec![CoverageReason::Binary]
                                } else {
                                    Vec::new()
                                },
                            };
                            changed_rows.push(ComparisonRowMeta {
                                row,
                                current_sha256: Some(curr_sha),
                                current_size_bytes: Some(curr_size),
                                current_mode: curr_mode,
                            });
                        }
                        ProbeResult::AbsentAtFirstTouch => {
                            // Was absent, still absent -> untouched!
                        }
                        ProbeResult::Unknown { reason } | ProbeResult::Excluded { reason } => {
                            counts_complete = false;
                            let row = FileRow {
                                file_id: entry.file_id.clone(),
                                path: path.clone(),
                                change: FileChangeKind::Unknown,
                                original_presence: Presence::Absent,
                                original_provenance: entry.provenance,
                                current_presence: Presence::Unknown,
                                original_kind: FileContentKind::Unknown,
                                current_kind: FileContentKind::Unknown,
                                original_mode: None,
                                current_mode: None,
                                additions: None,
                                deletions: None,
                                reasons: vec![reason],
                            };
                            changed_rows.push(ComparisonRowMeta {
                                row,
                                current_sha256: None,
                                current_size_bytes: None,
                                current_mode: None,
                            });
                        }
                    }
                }
                Presence::Unknown => {
                    counts_complete = false;
                    let (curr_presence, curr_kind, curr_mode, curr_sha_opt, curr_size_opt) =
                        match probe_res {
                            ProbeResult::Present {
                                size_bytes: curr_size,
                                sha256: curr_sha,
                                mode: curr_mode,
                                kind: curr_kind,
                                ..
                            } => (
                                Presence::Present,
                                curr_kind,
                                curr_mode,
                                Some(curr_sha),
                                Some(curr_size),
                            ),
                            ProbeResult::AbsentAtFirstTouch => {
                                (Presence::Absent, FileContentKind::Unknown, None, None, None)
                            }
                            _ => (Presence::Unknown, FileContentKind::Unknown, None, None, None),
                        };

                    let row = FileRow {
                        file_id: entry.file_id.clone(),
                        path: path.clone(),
                        change: FileChangeKind::Unknown,
                        original_presence: Presence::Unknown,
                        original_provenance: entry.provenance,
                        current_presence: curr_presence,
                        original_kind: FileContentKind::Unknown,
                        current_kind: curr_kind,
                        original_mode: None,
                        current_mode: curr_mode,
                        additions: None,
                        deletions: None,
                        reasons: entry.reasons.clone(),
                    };
                    changed_rows.push(ComparisonRowMeta {
                        row,
                        current_sha256: curr_sha_opt,
                        current_size_bytes: curr_size_opt,
                        current_mode: curr_mode,
                    });
                }
            }
        }

        Ok((
            changed_rows,
            total_adds,
            total_dels,
            counts_complete,
            current_captured,
            current_reasons,
        ))
    })
    .await
    .map_err(|_| ErrorCode::Deadline)??;

    let (
        changed_rows,
        total_adds,
        total_dels,
        counts_complete,
        current_captured,
        current_reasons,
    ) = comparison_eval;

    let changed_count = changed_rows.len() as u64;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let lifecycle = service.lifecycle.read();
    if !lifecycle.enabled || lifecycle.generation != generation {
        return Err(ErrorCode::TrackingDisabled);
    }

    let mut records = service.records.lock();
    let rec = records.get_mut(key).ok_or(ErrorCode::BaselineMissing)?;
    if rec.baseline_id != expected_baseline_id {
        return Err(ErrorCode::RefreshRequired);
    }

    rec.comparison_revision += 1;
    let revision_str = rec.comparison_revision.to_string();

    let eligible = rec.tracked_paths.len() as u64;
    let coverage_state = if current_captured == eligible && current_reasons.is_empty() {
        CoverageState::Complete
    } else {
        CoverageState::Incomplete
    };

    let comparison = Comparison {
        server_epoch: service.server_epoch.clone(),
        baseline_id: rec.baseline_id.clone(),
        comparison_revision: revision_str,
        compared_at_ms: now_ms,
        current_coverage: Coverage {
            state: coverage_state,
            inventory_complete: true,
            absence_proof_complete: true,
            provenance_entries: eligible,
            eligible_entries: eligible,
            captured_entries: current_captured,
            omitted_entries: None,
            raw_bytes: rec.retained_bytes,
            reasons: current_reasons,
        },
        changed_file_count: changed_count,
        additions: if counts_complete {
            Some(total_adds)
        } else {
            None
        },
        deletions: if counts_complete {
            Some(total_dels)
        } else {
            None
        },
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
    if !service.is_enabled() {
        return Err(ErrorCode::TrackingDisabled);
    }
    let records = service.records.lock();
    let rec = records.get(key).ok_or(ErrorCode::BaselineMissing)?;

    let artifact = rec.comparison.as_ref().ok_or(ErrorCode::RefreshRequired)?;
    if artifact.comparison.comparison_revision != expected_revision {
        return Err(ErrorCode::RefreshRequired);
    }

    let start_offset = if let Some(c) = cursor {
        let decoded = BASE64.decode(c).map_err(|_| ErrorCode::InvalidRequest)?;
        let s = String::from_utf8(decoded).map_err(|_| ErrorCode::InvalidRequest)?;
        s.parse::<usize>().map_err(|_| ErrorCode::InvalidRequest)?
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

fn is_text_renderable(content: &str) -> bool {
    if content.len() > MAX_DETAIL_TEXT_BYTES {
        return false;
    }
    let mut lines = 0;
    for line in content.lines() {
        if line.len() > MAX_TEXT_LINE_BYTES {
            return false;
        }
        lines += 1;
        if lines > MAX_TEXT_RENDER_LINES {
            return false;
        }
    }
    true
}

pub async fn get_file_detail(
    service: &Arc<SessionChangesService>,
    key: &SessionChangesKey,
    expected_revision: &str,
    file_id: &str,
) -> Result<FileDetail, ErrorCode> {
    let (enabled, generation) = service.current_generation();
    if !enabled {
        return Err(ErrorCode::TrackingDisabled);
    }

    let (canonical_root, root_file_opt, baseline_id, row_meta, original_entry) = {
        let lifecycle = service.lifecycle.read();
        if !lifecycle.enabled || lifecycle.generation != generation {
            return Err(ErrorCode::TrackingDisabled);
        }
        let records = service.records.lock();
        let rec = records.get(key).ok_or(ErrorCode::BaselineMissing)?;

        let artifact = rec.comparison.as_ref().ok_or(ErrorCode::RefreshRequired)?;
        if artifact.comparison.comparison_revision != expected_revision {
            return Err(ErrorCode::RefreshRequired);
        }

        let meta = artifact
            .rows
            .iter()
            .find(|r| r.row.file_id == file_id)
            .cloned()
            .ok_or(ErrorCode::FileMissing)?;

        let entry = rec.tracked_paths.get(&meta.row.path).cloned();
        (rec.canonical_root.clone(), rec.root_dir_file.clone(), rec.baseline_id.clone(), meta, entry)
    };

    let row = row_meta.row;
    let expected_sha = row_meta.current_sha256;
    let expected_mode = row_meta.current_mode;
    let expected_size = row_meta.current_size_bytes;
    let canonical_root_clone = canonical_root.clone();
    let root_file_clone = root_file_opt.clone();
    let path_clone = row.path.clone();
    let service_clone = service.clone();

    // Re-verify current file stability on blocking worker with permit
    let probe_res = tokio::task::spawn_blocking(move || {
        let _permit = match service_clone.blocking_permits.clone().try_acquire_owned() {
            Ok(p) => p,
            Err(_) => return ProbeResult::Unknown { reason: CoverageReason::Deadline },
        };
        #[cfg(unix)]
        let root_fd = root_file_clone.as_ref().map(|f| f.as_raw_fd());
        #[cfg(not(unix))]
        let root_fd = None;
        probe_file_safely(root_fd, &canonical_root_clone, &path_clone)
    })
    .await
    .map_err(|_| ErrorCode::Deadline)?;

    // Post-await lifecycle and revision check
    {
        let lifecycle = service.lifecycle.read();
        if !lifecycle.enabled || lifecycle.generation != generation {
            return Err(ErrorCode::TrackingDisabled);
        }
        let records = service.records.lock();
        let rec = records.get(key).ok_or(ErrorCode::BaselineMissing)?;
        if rec.baseline_id != baseline_id || rec.comparison_revision.to_string() != expected_revision {
            return Err(ErrorCode::RefreshRequired);
        }
    }

    let current_side = match (expected_sha, probe_res) {
        (Some(expected), ProbeResult::Present { bytes, size_bytes, sha256, mode, kind }) => {
            if sha256 != expected || mode != expected_mode || Some(size_bytes) != expected_size {
                return Err(ErrorCode::RefreshRequired);
            }
            ContentSide {
                presence: Presence::Present,
                content: if kind == FileContentKind::Text && size_bytes <= MAX_DETAIL_TEXT_BYTES as u64 {
                    std::str::from_utf8(&bytes).ok().map(|s| s.to_string())
                } else {
                    None
                },
                byte_length: Some(size_bytes),
                sha256: Some(sha256),
                mode,
            }
        }
        (None, ProbeResult::AbsentAtFirstTouch) => {
            ContentSide {
                presence: Presence::Absent,
                content: None,
                byte_length: None,
                sha256: None,
                mode: None,
            }
        }
        _ => {
            // File state mutated since comparison revision!
            return Err(ErrorCode::RefreshRequired);
        }
    };

    let original_side = if let Some(e) = original_entry {
        match e.presence {
            Presence::Present => {
                let bytes = e.bytes.as_deref().unwrap_or(&[]);
                ContentSide {
                    presence: Presence::Present,
                    content: if e.kind == FileContentKind::Text && e.size_bytes <= MAX_DETAIL_TEXT_BYTES as u64 {
                        std::str::from_utf8(bytes).ok().map(|s| s.to_string())
                    } else {
                        None
                    },
                    byte_length: Some(e.size_bytes),
                    sha256: e.sha256,
                    mode: e.mode,
                }
            }
            Presence::Absent => ContentSide {
                presence: Presence::Absent,
                content: None,
                byte_length: None,
                sha256: None,
                mode: None,
            },
            Presence::Unknown => ContentSide {
                presence: Presence::Unknown,
                content: None,
                byte_length: None,
                sha256: None,
                mode: None,
            },
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

    let orig_renderable = original_side.content.as_deref().map(is_text_renderable).unwrap_or(true);
    let curr_renderable = current_side.content.as_deref().map(is_text_renderable).unwrap_or(true);

    let renderable = match row.change {
        FileChangeKind::Added => {
            row.current_kind == FileContentKind::Text
                && current_side.content.is_some()
                && curr_renderable
        }
        FileChangeKind::Deleted => {
            row.original_kind == FileContentKind::Text
                && original_side.content.is_some()
                && orig_renderable
        }
        FileChangeKind::Modified => {
            row.original_kind == FileContentKind::Text
                && row.current_kind == FileContentKind::Text
                && original_side.content.is_some()
                && current_side.content.is_some()
                && orig_renderable
                && curr_renderable
        }
        FileChangeKind::ModeOnly => {
            row.original_kind == FileContentKind::Text
                && row.current_kind == FileContentKind::Text
                && original_side.content.is_some()
                && current_side.content.is_some()
                && orig_renderable
                && curr_renderable
        }
        FileChangeKind::Unknown => false,
    };

    Ok(FileDetail {
        version: 1,
        server_epoch: service.server_epoch.clone(),
        baseline_id,
        comparison_revision: expected_revision.to_string(),
        file: row,
        original: original_side,
        current: current_side,
        renderable,
    })
}
