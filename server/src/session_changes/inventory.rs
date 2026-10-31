use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::session_changes::absence::{AbsenceTrie, EntryKind};
use crate::session_changes::types::{
    Coverage, CoverageReason, CoverageState, FileContentKind, MAX_BASELINE_RAW_BYTES,
    MAX_FILE_RAW_BYTES, MAX_METADATA_NODES, MAX_PATH_DEPTH,
};

#[derive(Debug, Clone)]
pub struct CapturedFile {
    pub file_id: String,
    pub relative_path: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub mode: Option<u32>,
    pub kind: FileContentKind,
    pub bytes: Vec<u8>,
    pub reasons: Vec<CoverageReason>,
}

#[derive(Debug, Clone)]
pub struct BaselineInventory {
    pub trie: AbsenceTrie,
    pub files: BTreeMap<String, CapturedFile>,
    pub coverage: Coverage,
}

pub fn is_binary_buffer(bytes: &[u8]) -> bool {
    bytes.contains(&0)
}

pub fn capture_inventory(
    root: &Path,
    max_duration: Duration,
) -> Result<BaselineInventory, String> {
    let start_time = Instant::now();
    let mut trie = AbsenceTrie::new();
    let mut files = BTreeMap::new();
    let mut reasons = Vec::new();

    let mut eligible_entries: u64 = 0;
    let mut captured_entries: u64 = 0;
    let mut omitted_entries: Option<u64> = None;
    let mut total_raw_bytes: u64 = 0;
    let mut inventory_complete = true;

    // Open git repository if available for ignore rules
    let git_repo = git2::Repository::open(root).ok();

    let mut dir_queue: VecDeque<PathBuf> = VecDeque::new();
    dir_queue.push_back(PathBuf::from(""));

    while let Some(rel_dir) = dir_queue.pop_front() {
        if start_time.elapsed() > max_duration {
            inventory_complete = false;
            trie.proof_complete = false;
            reasons.push(CoverageReason::Deadline);
            break;
        }

        if trie.total_nodes >= MAX_METADATA_NODES {
            inventory_complete = false;
            trie.proof_complete = false;
            reasons.push(CoverageReason::InventoryLimit);
            break;
        }

        let abs_dir = if rel_dir.as_os_str().is_empty() {
            root.to_path_buf()
        } else {
            root.join(&rel_dir)
        };

        let read_res = fs::read_dir(&abs_dir);
        if read_res.is_err() {
            trie.record_directory(&rel_dir, false, &[]);
            reasons.push(CoverageReason::Unreadable);
            inventory_complete = false;
            continue;
        }

        let mut raw_entries = Vec::new();
        let mut dir_truncated = false;
        for entry in read_res.unwrap() {
            if let Ok(e) = entry {
                if raw_entries.len() >= MAX_METADATA_NODES {
                    dir_truncated = true;
                    inventory_complete = false;
                    reasons.push(CoverageReason::PathLimit);
                    break;
                }
                raw_entries.push(e);
            }
        }
        // Deterministic order
        raw_entries.sort_by_key(|e| e.file_name());
        let mut trie_entries = Vec::new();
        let mut subdirs_to_queue = Vec::new();

        for entry in raw_entries {
            let file_name_os = entry.file_name();
            let file_name = match file_name_os.into_string() {
                Ok(s) => s,
                Err(_) => {
                    reasons.push(CoverageReason::NonUtf8);
                    inventory_complete = false;
                    continue;
                }
            };

            // Never traverse into .git marker
            if file_name == ".git" {
                trie_entries.push((file_name, EntryKind::Dir, true));
                continue;
            }

            let child_rel = if rel_dir.as_os_str().is_empty() {
                PathBuf::from(&file_name)
            } else {
                rel_dir.join(&file_name)
            };

            let symlink_meta = match entry.path().symlink_metadata() {
                Ok(m) => m,
                Err(_) => {
                    trie_entries.push((file_name, EntryKind::Other, false));
                    reasons.push(CoverageReason::Unreadable);
                    continue;
                }
            };

            if symlink_meta.file_type().is_symlink() {
                trie_entries.push((file_name, EntryKind::Symlink, false));
                reasons.push(CoverageReason::Symlink);
                continue;
            }

            let is_dir = symlink_meta.is_dir();

            // Check ignore rule (ensure directories have trailing slash so patterns like 'target/' match)
            let git_ignored = if let Some(repo) = &git_repo {
                let ignore_path = if is_dir {
                    let mut s = child_rel.to_string_lossy().to_string();
                    if !s.ends_with('/') {
                        s.push('/');
                    }
                    PathBuf::from(s)
                } else {
                    child_rel.clone()
                };
                repo.status_should_ignore(&ignore_path)
                    .unwrap_or_else(|_| repo.status_should_ignore(&child_rel).unwrap_or(false))
            } else {
                false
            };

            // Respect gitignore, and safely skip common massive build/vendor folders if unignored
            let is_ignored = git_ignored
                || (is_dir
                    && matches!(
                        file_name.as_str(),
                        "node_modules"
                            | "target"
                            | ".venv"
                            | "venv"
                            | ".pytest_cache"
                            | ".ruff_cache"
                            | ".turbo"
                            | ".next"
                    ));

            if symlink_meta.is_dir() {
                // Check for nested .git or submodule boundary
                if entry.path().join(".git").exists() {
                    trie_entries.push((file_name, EntryKind::Dir, true));
                    continue;
                }
                if is_ignored {
                    trie_entries.push((file_name, EntryKind::Dir, true));
                } else {
                    trie_entries.push((file_name, EntryKind::Dir, false));
                    let depth = child_rel.components().count();
                    if depth <= MAX_PATH_DEPTH {
                        subdirs_to_queue.push(child_rel);
                    } else {
                        reasons.push(CoverageReason::PathLimit);
                        inventory_complete = false;
                    }
                }
            } else if symlink_meta.is_file() {
                if is_ignored {
                    trie_entries.push((file_name, EntryKind::File, true));
                } else {
                    trie_entries.push((file_name, EntryKind::File, false));
                    eligible_entries += 1;

                    let file_size = symlink_meta.len();
                    let norm_path = child_rel.to_string_lossy().replace('\\', "/");
                    let file_id = format!("f-{}", files.len() + 1);

                    let mode = {
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            Some(symlink_meta.permissions().mode() & 0o777)
                        }
                        #[cfg(not(unix))]
                        {
                            None
                        }
                    };

                    if file_size > MAX_FILE_RAW_BYTES as u64 {
                        reasons.push(CoverageReason::FileTooLarge);
                        captured_entries += 1;
                        files.insert(
                            norm_path.clone(),
                            CapturedFile {
                                file_id,
                                relative_path: norm_path,
                                size_bytes: file_size,
                                sha256: "".into(),
                                mode,
                                kind: FileContentKind::Unsupported,
                                bytes: Vec::new(),
                                reasons: vec![CoverageReason::FileTooLarge],
                            },
                        );
                    } else if total_raw_bytes + file_size > MAX_BASELINE_RAW_BYTES as u64 {
                        reasons.push(CoverageReason::ByteLimit);
                        inventory_complete = false;
                        omitted_entries = Some(omitted_entries.unwrap_or(0) + 1);
                    } else {
                        // Read regular file safely
                        match crate::fs::secure_path::read_regular_snapshot(
                            root,
                            &child_rel,
                            MAX_FILE_RAW_BYTES as u64,
                        ) {
                            Ok(snap) => {
                                let bytes = snap.bytes;
                                total_raw_bytes += bytes.len() as u64;
                                captured_entries += 1;

                                let mut file_reasons = Vec::new();
                                let kind = if is_binary_buffer(&bytes) {
                                    file_reasons.push(CoverageReason::Binary);
                                    FileContentKind::Binary
                                } else if std::str::from_utf8(&bytes).is_err() {
                                    file_reasons.push(CoverageReason::NonUtf8);
                                    FileContentKind::Binary
                                } else {
                                    FileContentKind::Text
                                };

                                let sha256 = hex::encode(Sha256::digest(&bytes));

                                files.insert(
                                    norm_path.clone(),
                                    CapturedFile {
                                        file_id,
                                        relative_path: norm_path,
                                        size_bytes: file_size,
                                        sha256,
                                        mode,
                                        kind,
                                        bytes,
                                        reasons: file_reasons,
                                    },
                                );
                            }
                            Err(_) => {
                                reasons.push(CoverageReason::Unreadable);
                                omitted_entries = Some(omitted_entries.unwrap_or(0) + 1);
                            }
                        }
                    }
                }
            } else {
                trie_entries.push((file_name, EntryKind::Other, false));
                reasons.push(CoverageReason::SpecialFile);
            }
        }

        trie.record_directory(&rel_dir, !dir_truncated, &trie_entries);

        for sd in subdirs_to_queue {
            dir_queue.push_back(sd);
        }
    }

    // Deduplicate coverage reasons
    reasons.sort_by_key(|r| format!("{r:?}"));
    reasons.dedup();

    let coverage_state = if reasons.is_empty()
        && inventory_complete
        && trie.proof_complete
        && omitted_entries.is_none()
    {
        CoverageState::Complete
    } else {
        CoverageState::Incomplete
    };

    let coverage = Coverage {
        state: coverage_state,
        inventory_complete,
        absence_proof_complete: trie.proof_complete,
        provenance_entries: trie.total_nodes as u64,
        eligible_entries,
        captured_entries,
        omitted_entries,
        raw_bytes: total_raw_bytes,
        reasons,
    };

    Ok(BaselineInventory {
        trie,
        files,
        coverage,
    })
}
