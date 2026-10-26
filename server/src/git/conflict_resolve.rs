use std::fs;
use std::path::Path;
use crate::error::AppError;
use crate::git::conflict::{
    compute_full_index_fingerprint, decode_conflict_id, get_conflict_snapshot,
    verify_safe_worktree_path, MAX_LINES, MAX_LINE_LENGTH, MAX_STAGE_BYTES, MAX_WORKTREE_BYTES,
};
use crate::git::diff::open_repo;
use crate::git::mutation_coordination::GLOBAL_MUTATION_COORDINATOR;
use crate::git::types::{
    ConflictStatus, ResolveAction, ResolveEol, ResolveOutcome, ResolveRequest, ResolveSide,
    StageKind, WorktreeKind,
};

fn safe_atomic_write(dest: &Path, content: &[u8], mode: u32) -> Result<(), String> {
    let parent = dest
        .parent()
        .ok_or_else(|| "Target path has no parent directory".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create parent directory: {e}"))?;

    let nonce = format!(".tmp_resolve_{}", hex::encode(rand::random::<[u8; 8]>()));
    let tmp_path = parent.join(nonce);

    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp_path)
        .map_err(|e| format!("Failed to create exclusive temporary file: {e}"))?;
    if let Err(e) = file.write_all(content) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!("Failed to write temporary file: {e}"));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perm = if (mode & 0o111) != 0 { 0o755 } else { 0o644 };
        if let Err(e) = std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(perm)) {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(format!("Failed to set permissions on temporary file: {e}"));
        }
    }

    if let Err(e) = std::fs::rename(&tmp_path, dest) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!("Failed to atomically publish file to worktree: {e}"));
    }

    Ok(())
}

fn stage_index_entry(
    index: &mut git2::Index,
    display_path: &str,
    target_raw_path: &[u8],
    oid: git2::Oid,
    mode: u32,
    file_size: u32,
    disk_path: Option<&Path>,
) -> Result<(), git2::Error> {
    let _ = index.remove(Path::new(display_path), 1);
    let _ = index.remove(Path::new(display_path), 2);
    let _ = index.remove(Path::new(display_path), 3);

    #[cfg(unix)]
    let (ctime_sec, ctime_nsec, mtime_sec, mtime_nsec, dev, ino, uid, gid) = if let Some(p) = disk_path {
        use std::os::unix::fs::MetadataExt;
        if let Ok(m) = fs::symlink_metadata(p) {
            (
                m.ctime() as i32,
                m.ctime_nsec() as u32,
                m.mtime() as i32,
                m.mtime_nsec() as u32,
                m.dev() as u32,
                m.ino() as u32,
                m.uid(),
                m.gid(),
            )
        } else {
            (0, 0, 0, 0, 0, 0, 0, 0)
        }
    } else {
        (0, 0, 0, 0, 0, 0, 0, 0)
    };
    #[cfg(not(unix))]
    let (ctime_sec, ctime_nsec, mtime_sec, mtime_nsec, dev, ino, uid, gid) = (0, 0, 0, 0, 0, 0, 0, 0);

    let entry = git2::IndexEntry {
        ctime: git2::IndexTime::new(ctime_sec, ctime_nsec),
        mtime: git2::IndexTime::new(mtime_sec, mtime_nsec),
        dev,
        ino,
        mode,
        uid,
        gid,
        file_size,
        id: oid,
        flags: 0,
        flags_extended: 0,
        path: target_raw_path.to_vec(),
    };
    index.add(&entry)?;
    index.write()?;
    Ok(())
}

fn verify_applied_oracle(
    canonical_root: &Path,
    display_path: &str,
    safe_disk_path: &Path,
    expected_oid: &str,
    expected_mode: u32,
    expected_bytes: &[u8],
) -> Result<ResolveOutcome, AppError> {
    let verify_repo = match open_repo(canonical_root) {
        Ok(r) => r,
        Err(e) => {
            return Ok(ResolveOutcome::OutcomeUnknown {
                error: format!("Failed to reopen repository for verification: {e}"),
                required_refresh: true,
            });
        }
    };
    let verify_index = match verify_repo.index() {
        Ok(idx) => idx,
        Err(e) => {
            return Ok(ResolveOutcome::OutcomeUnknown {
                error: format!("Failed to reload index for verification: {e}"),
                required_refresh: true,
            });
        }
    };

    let s0 = verify_index.get_path(Path::new(display_path), 0);
    let s1 = verify_index.get_path(Path::new(display_path), 1);
    let s2 = verify_index.get_path(Path::new(display_path), 2);
    let s3 = verify_index.get_path(Path::new(display_path), 3);

    if s1.is_some() || s2.is_some() || s3.is_some() {
        return Ok(ResolveOutcome::OutcomeUnknown {
            error: "Unmerged stages 1-3 still present in index after staging".into(),
            required_refresh: true,
        });
    }

    let s0_entry = match s0 {
        Some(e) => e,
        None => {
            return Ok(ResolveOutcome::OutcomeUnknown {
                error: "Stage 0 entry missing after staging".into(),
                required_refresh: true,
            });
        }
    };

    if s0_entry.id.to_string() != expected_oid || s0_entry.mode != expected_mode {
        return Ok(ResolveOutcome::OutcomeUnknown {
            error: "Stage 0 entry OID or mode mismatch during oracle check".into(),
            required_refresh: true,
        });
    }

    match std::fs::read(safe_disk_path) {
        Ok(actual_disk_bytes) if actual_disk_bytes == expected_bytes => {
            Ok(ResolveOutcome::Applied {
                new_oid: Some(expected_oid.to_string()),
                stage0_mode: Some(expected_mode),
                deleted: false,
            })
        }
        _ => Ok(ResolveOutcome::OutcomeUnknown {
            error: "Worktree disk bytes mismatch during oracle check".into(),
            required_refresh: true,
        }),
    }
}

fn verify_deleted_oracle(
    canonical_root: &Path,
    display_path: &str,
    safe_disk_path: &Path,
) -> Result<ResolveOutcome, AppError> {
    let verify_repo = match open_repo(canonical_root) {
        Ok(r) => r,
        Err(e) => {
            return Ok(ResolveOutcome::OutcomeUnknown {
                error: format!("Failed to reopen repository for verification: {e}"),
                required_refresh: true,
            });
        }
    };
    let verify_index = match verify_repo.index() {
        Ok(idx) => idx,
        Err(e) => {
            return Ok(ResolveOutcome::OutcomeUnknown {
                error: format!("Failed to reload index for verification: {e}"),
                required_refresh: true,
            });
        }
    };

    let s0 = verify_index.get_path(Path::new(display_path), 0);
    let s1 = verify_index.get_path(Path::new(display_path), 1);
    let s2 = verify_index.get_path(Path::new(display_path), 2);
    let s3 = verify_index.get_path(Path::new(display_path), 3);

    if s0.is_some() || s1.is_some() || s2.is_some() || s3.is_some() {
        return Ok(ResolveOutcome::OutcomeUnknown {
            error: "Index entries still present after delete resolution".into(),
            required_refresh: true,
        });
    }

    match std::fs::symlink_metadata(safe_disk_path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // Confirmed absent on disk
        }
        Ok(_) => {
            return Ok(ResolveOutcome::OutcomeUnknown {
                error: "File or symlink still exists on disk after delete resolution".into(),
                required_refresh: true,
            });
        }
        Err(e) => {
            return Ok(ResolveOutcome::OutcomeUnknown {
                error: format!("Cannot verify file absence due to metadata error: {e}"),
                required_refresh: true,
            });
        }
    }

    Ok(ResolveOutcome::Applied {
        new_oid: None,
        stage0_mode: None,
        deleted: true,
    })
}

/// Executes preconditioned conflict resolution with application mutation coordination,
/// secure path/ancestor revalidation, and truthful outcome reporting.
pub fn apply_conflict_resolution(
    root_path: &Path,
    req: &ResolveRequest,
) -> Result<ResolveOutcome, AppError> {
    let canonical_root = dunce::canonicalize(root_path).map_err(AppError::Io)?;

    // 1. Decode and validate target path
    let target_raw_path = match decode_conflict_id(&req.conflict_id) {
        Some(p) => p,
        None => {
            return Ok(ResolveOutcome::FailedBeforeWrite {
                error: "Invalid conflictId format".into(),
            });
        }
    };

    let display_path = match std::str::from_utf8(&target_raw_path) {
        Ok(s) => s.to_string(),
        Err(_) => {
            return Ok(ResolveOutcome::Unsupported {
                reason: "Non-UTF-8 path not supported for in-editor mutation".into(),
            });
        }
    };

    let safe_disk_path = match verify_safe_worktree_path(&canonical_root, &display_path) {
        Ok(p) => p,
        Err(e) => {
            return Ok(ResolveOutcome::FailedBeforeWrite {
                error: e.to_string(),
            });
        }
    };
    if crate::fs::secure_path::is_protected_global_config_path(&safe_disk_path) {
        return Ok(ResolveOutcome::Unsupported {
            reason: "Direct mutation of global config file is forbidden; use dedicated PATCH /api/semantic/settings or config API".into(),
        });
    }

    // 2. Open repository and acquire mutation coordination
    let repo = open_repo(&canonical_root)?;
    let _guard = match GLOBAL_MUTATION_COORDINATOR.try_acquire_for_repo(&repo, &canonical_root) {
        Ok(guard) => guard,
        Err(reason) => {
            return Ok(ResolveOutcome::Busy {
                reason: reason.to_string(),
            });
        }
    };

    // 3. Check native Git locks
    let git_dir = repo.path();
    if git_dir.join("index.lock").exists() {
        return Ok(ResolveOutcome::Busy {
            reason: "Git index.lock is held by another process".into(),
        });
    }

    let mut index = repo
        .index()
        .map_err(|e| AppError::Git(e.message().to_string()))?;

    // 4. Precondition validation: index fingerprint and snapshot version
    let current_index_fp = compute_full_index_fingerprint(&index);
    if current_index_fp != req.full_index_fingerprint {
        return Ok(ResolveOutcome::Stale {
            reason: "Full index fingerprint mismatch; repository index was modified".into(),
            required_refresh: true,
        });
    }

    let snapshot = match get_conflict_snapshot(&canonical_root, &req.conflict_id) {
        Ok(s) => s,
        Err(AppError::ConflictStateChanged) => {
            return Ok(ResolveOutcome::Stale {
                reason: "Conflict state changed during inspection".into(),
                required_refresh: true,
            });
        }
        Err(AppError::NotFound(_)) => {
            return Ok(ResolveOutcome::Stale {
                reason: "Conflict is no longer present in index".into(),
                required_refresh: true,
            });
        }
        Err(e) => {
            return Ok(ResolveOutcome::FailedBeforeWrite {
                error: e.to_string(),
            });
        }
    };

    if snapshot.snapshot_version != req.snapshot_version {
        return Ok(ResolveOutcome::Stale {
            reason: "Snapshot version mismatch; conflict state has changed".into(),
            required_refresh: true,
        });
    }

    if snapshot.status == ConflictStatus::Unsupported {
        return Ok(ResolveOutcome::Unsupported {
            reason: snapshot
                .unsupported_reason
                .unwrap_or_else(|| "Conflict is unsupported".into()),
        });
    }

    // Gate worktree kinds
    match snapshot.worktree.kind {
        WorktreeKind::Symlink => {
            return Ok(ResolveOutcome::Unsupported {
                reason: "Worktree path is a symlink; symlink conflicts unsupported".into(),
            });
        }
        WorktreeKind::Directory => {
            return Ok(ResolveOutcome::Unsupported {
                reason: "Worktree path is a directory; directory conflicts unsupported".into(),
            });
        }
        WorktreeKind::Gitlink => {
            return Ok(ResolveOutcome::Unsupported {
                reason: "Worktree path is a submodule gitlink; gitlink conflicts unsupported".into(),
            });
        }
        WorktreeKind::Unreadable => {
            return Ok(ResolveOutcome::Unsupported {
                reason: "Worktree path is unreadable on disk".into(),
            });
        }
        _ => {}
    }

    // Gate on-disk file type (ensure target is not a symlink or directory)
    if let Ok(meta) = std::fs::symlink_metadata(&safe_disk_path) {
        if meta.file_type().is_symlink() {
            return Ok(ResolveOutcome::Unsupported {
                reason: "Target path in worktree is a symlink; refusing to overwrite".into(),
            });
        }
        if meta.file_type().is_dir() {
            return Ok(ResolveOutcome::Unsupported {
                reason: "Target path in worktree is a directory; refusing to overwrite".into(),
            });
        }
    }

    // Gate non-default conversion policies (W3)
    if !snapshot.effective_attributes.filter_qualified
        || snapshot.effective_attributes.ident
        || snapshot.effective_attributes.encoding.is_some()
    {
        return Ok(ResolveOutcome::Unsupported {
            reason: "File has unqualified conversion policy (filter, ident, or encoding)".into(),
        });
    }

    if let Some(autocrlf) = &snapshot.effective_attributes.core_autocrlf {
        let val = autocrlf.trim().to_lowercase();
        if !val.is_empty() && val != "false" {
            return Ok(ResolveOutcome::Unsupported {
                reason: format!("Non-default core.autocrlf='{autocrlf}' is unsupported before mutation"),
            });
        }
    }

    // 5. Ancestor safety check: verify no ancestor directory is an escaping symlink
    let mut ancestor_chain = canonical_root.clone();
    let rel_components = Path::new(&display_path).components();
    for comp in rel_components {
        if let std::path::Component::Normal(part) = comp {
            ancestor_chain.push(part);
            if ancestor_chain.is_symlink() {
                let target = std::fs::read_link(&ancestor_chain).map_err(AppError::Io)?;
                let resolved = if target.is_relative() {
                    ancestor_chain.parent().unwrap().join(target)
                } else {
                    target
                };
                let canonical_target = match dunce::canonicalize(&resolved) {
                    Ok(p) => p,
                    Err(_) => {
                        return Ok(ResolveOutcome::FailedBeforeWrite {
                            error: "Ancestor symlink target cannot be resolved".into(),
                        });
                    }
                };
                if !canonical_target.starts_with(&canonical_root) {
                    return Ok(ResolveOutcome::FailedBeforeWrite {
                        error: "Ancestor symlink escapes root".into(),
                    });
                }
            }
        }
    }

    // 6. Action Execution
    match &req.action {
        ResolveAction::ReviewedText {
            tokens,
            eol,
            executable,
        } => {
            if tokens.len() > MAX_LINES {
                return Ok(ResolveOutcome::FailedBeforeWrite {
                    error: "Line count exceeds maximum allowed limit".into(),
                });
            }

            let mut full_text = String::new();
            for token in tokens {
                if token.len() > MAX_LINE_LENGTH {
                    return Ok(ResolveOutcome::FailedBeforeWrite {
                        error: "Line length exceeds maximum allowed limit".into(),
                    });
                }
                match eol {
                    ResolveEol::Preserve => {
                        full_text.push_str(token);
                    }
                    ResolveEol::Lf => {
                        if token.ends_with("\r\n") {
                            full_text.push_str(&token[..token.len() - 2]);
                            full_text.push('\n');
                        } else {
                            full_text.push_str(token);
                        }
                    }
                    ResolveEol::Crlf => {
                        if token.ends_with("\r\n") {
                            full_text.push_str(token);
                        } else if token.ends_with('\n') {
                            full_text.push_str(&token[..token.len() - 1]);
                            full_text.push_str("\r\n");
                        } else {
                            full_text.push_str(token);
                        }
                    }
                }
            }

            if full_text.len() as u64 > MAX_WORKTREE_BYTES {
                return Ok(ResolveOutcome::FailedBeforeWrite {
                    error: "Reviewed text exceeds maximum worktree byte size".into(),
                });
            }

            let target_mode = match executable {
                Some(true) => 0o100755,
                Some(false) => 0o100644,
                None => {
                    if snapshot.stages.ours.mode != 0 {
                        snapshot.stages.ours.mode
                    } else if snapshot.stages.theirs.mode != 0 {
                        snapshot.stages.theirs.mode
                    } else if let Some(base) = &snapshot.stages.base {
                        if base.mode != 0 {
                            base.mode
                        } else {
                            0o100644
                        }
                    } else {
                        0o100644
                    }
                }
            };

            let content_bytes = full_text.as_bytes();
            if let Err(e) = safe_atomic_write(&safe_disk_path, content_bytes, target_mode) {
                return Ok(ResolveOutcome::FailedBeforeWrite { error: e });
            }

            let stage_res: Result<String, git2::Error> = (|| {
                let blob_oid = repo.blob(content_bytes)?;
                stage_index_entry(
                    &mut index,
                    &display_path,
                    &target_raw_path,
                    blob_oid,
                    target_mode,
                    content_bytes.len() as u32,
                    Some(&safe_disk_path),
                )?;
                Ok(blob_oid.to_string())
            })();

            match stage_res {
                Err(e) => Ok(ResolveOutcome::WorktreeChangedStageFailed {
                    error: format!("Failed to stage into index: {}", e.message()),
                    worktree_written: true,
                    staged: false,
                }),
                Ok(new_oid) => {
                    drop(index);
                    drop(repo);
                    verify_applied_oracle(
                        &canonical_root,
                        &display_path,
                        &safe_disk_path,
                        &new_oid,
                        target_mode,
                        content_bytes,
                    )
                }
            }
        }
        ResolveAction::IndexSide { side, stage } => {
            if (*stage == 2 && *side != ResolveSide::Ours)
                || (*stage == 3 && *side != ResolveSide::Theirs)
            {
                return Ok(ResolveOutcome::FailedBeforeWrite {
                    error: "Mismatched stage and side".into(),
                });
            }

            let selected_stage = if *stage == 2 {
                &snapshot.stages.ours
            } else if *stage == 3 {
                &snapshot.stages.theirs
            } else {
                return Ok(ResolveOutcome::FailedBeforeWrite {
                    error: "Stage must be 2 or 3".into(),
                });
            };

            if selected_stage.kind == StageKind::Missing {
                return Ok(ResolveOutcome::FailedBeforeWrite {
                    error: "Selected stage is missing".into(),
                });
            }

            if selected_stage.kind == StageKind::Unsupported {
                return Ok(ResolveOutcome::Unsupported {
                    reason: "Selected stage is unsupported (oversized or non-blob)".into(),
                });
            }

            if selected_stage.byte_size > MAX_STAGE_BYTES {
                return Ok(ResolveOutcome::Unsupported {
                    reason: "Selected stage exceeds size limit".into(),
                });
            }

            let selected_oid_str = match &selected_stage.oid {
                Some(s) => s,
                None => {
                    return Ok(ResolveOutcome::FailedBeforeWrite {
                        error: "Selected stage has no OID".into(),
                    });
                }
            };

            let selected_oid = git2::Oid::from_str(selected_oid_str)
                .map_err(|e| AppError::Git(e.message().to_string()))?;
            let selected_mode = selected_stage.mode;

            let blob_bytes = match repo.find_blob(selected_oid) {
                Ok(b) => b.content().to_vec(),
                Err(e) => {
                    return Ok(ResolveOutcome::FailedBeforeWrite {
                        error: format!("Failed to find blob in ODB: {e}"),
                    });
                }
            };

            if let Err(e) = safe_atomic_write(&safe_disk_path, &blob_bytes, selected_mode) {
                return Ok(ResolveOutcome::FailedBeforeWrite { error: e });
            }

            let stage_res: Result<(), git2::Error> = (|| {
                stage_index_entry(
                    &mut index,
                    &display_path,
                    &target_raw_path,
                    selected_oid,
                    selected_mode,
                    blob_bytes.len() as u32,
                    Some(&safe_disk_path),
                )
            })();

            match stage_res {
                Err(e) => Ok(ResolveOutcome::WorktreeChangedStageFailed {
                    error: format!("Failed to stage into index: {}", e.message()),
                    worktree_written: true,
                    staged: false,
                }),
                Ok(()) => {
                    drop(index);
                    drop(repo);
                    verify_applied_oracle(
                        &canonical_root,
                        &display_path,
                        &safe_disk_path,
                        selected_oid_str,
                        selected_mode,
                        &blob_bytes,
                    )
                }
            }
        }
        ResolveAction::Delete {} => {
            match std::fs::symlink_metadata(&safe_disk_path) {
                Ok(meta) => {
                    if meta.file_type().is_symlink() {
                        return Ok(ResolveOutcome::Unsupported {
                            reason: "Cannot delete symlink via conflict resolver".into(),
                        });
                    }
                    if meta.file_type().is_dir() {
                        return Ok(ResolveOutcome::Unsupported {
                            reason: "Cannot delete directory via conflict resolver".into(),
                        });
                    }
                    if let Err(e) = std::fs::remove_file(&safe_disk_path) {
                        return Ok(ResolveOutcome::FailedBeforeWrite {
                            error: format!("Failed to delete worktree file: {e}"),
                        });
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    // Already absent on disk
                }
                Err(e) => {
                    return Ok(ResolveOutcome::FailedBeforeWrite {
                        error: format!("Cannot inspect target file metadata before deletion: {e}"),
                    });
                }
            }

            let stage_res: Result<(), git2::Error> = (|| {
                let _ = index.remove(Path::new(&display_path), 1);
                let _ = index.remove(Path::new(&display_path), 2);
                let _ = index.remove(Path::new(&display_path), 3);
                let _ = index.remove_path(Path::new(&display_path));
                index.write()?;
                Ok(())
            })();

            match stage_res {
                Err(e) => Ok(ResolveOutcome::WorktreeChangedStageFailed {
                    error: format!("Failed to remove from index: {}", e.message()),
                    worktree_written: true,
                    staged: false,
                }),
                Ok(()) => {
                    drop(index);
                    drop(repo);
                    verify_deleted_oracle(&canonical_root, &display_path, &safe_disk_path)
                }
            }
        }
    }
}
