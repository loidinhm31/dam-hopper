use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
#[cfg(unix)]
use std::os::unix::io::{AsRawFd, FromRawFd, RawFd};
use std::path::{Component, Path};
use std::sync::Arc;
use std::time::{Duration, Instant};
use uuid::Uuid;

use crate::session_changes::inventory::is_binary_buffer;
use crate::session_changes::root::{validate_project_root_preflight, PreflightBudget};
use crate::session_changes::store::{
    CaptureReservationState, SessionChangesKey, SessionChangesRecord, SessionChangesService,
    TrackedPathEntry,
};
use crate::session_changes::types::*;

pub const CAPTURE_TIMEOUT_DEADLINE: Duration = Duration::from_millis(1500);

#[cfg(unix)]
pub type RootDescriptor = RawFd;
#[cfg(not(unix))]
pub type RootDescriptor = i32;

#[derive(Debug)]
pub enum ProbeResult {
    Present {
        bytes: Arc<[u8]>,
        size_bytes: u64,
        sha256: String,
        mode: Option<u32>,
        kind: FileContentKind,
    },
    AbsentAtFirstTouch,
    Unknown {
        reason: CoverageReason,
    },
    Excluded {
        reason: CoverageReason,
    },
}

pub fn normalize_and_validate_path(rel_path: &str) -> Result<String, CoverageReason> {
    if rel_path.is_empty() || rel_path.len() > MAX_PATH_BYTES || rel_path.contains('\0') {
        return Err(CoverageReason::PathLimit);
    }
    if rel_path.contains('*') || rel_path.contains('?') {
        return Err(CoverageReason::PathLimit);
    }
    if rel_path.starts_with('/') || rel_path.starts_with('\\') {
        return Err(CoverageReason::PathLimit);
    }

    let p = Path::new(rel_path);
    let mut normalized = Vec::new();

    for c in p.components() {
        match c {
            Component::Normal(s) => {
                let s_str = s.to_string_lossy();
                if s_str == ".git" {
                    return Err(CoverageReason::NestedRoot);
                }
                normalized.push(s_str.to_string());
            }
            _ => {
                return Err(CoverageReason::PathLimit);
            }
        }
    }

    if normalized.is_empty() || normalized.len() > MAX_PATH_DEPTH {
        return Err(CoverageReason::PathLimit);
    }

    Ok(normalized.join("/"))
}

#[cfg(unix)]
fn probe_file_safely_unix(root_fd: Option<RawFd>, canonical_root: &Path, rel_path: &str) -> ProbeResult {
    use std::ffi::CString;
    use std::io::Read;

    let components: Vec<&str> = rel_path.split('/').filter(|s| !s.is_empty()).collect();
    if components.is_empty() {
        return ProbeResult::Unknown { reason: CoverageReason::PathLimit };
    }

    let opened_root_file;
    let base_fd = match root_fd {
        Some(fd) => fd,
        None => {
            opened_root_file = match std::fs::File::open(canonical_root) {
                Ok(f) => f,
                Err(_) => return ProbeResult::Unknown { reason: CoverageReason::Unreadable },
            };
            opened_root_file.as_raw_fd()
        }
    };

    let mut current_fd = base_fd;
    let mut intermediate_fds = Vec::new();

    for (idx, comp) in components.iter().enumerate() {
        let is_last = idx == components.len() - 1;
        let c_str = match CString::new(comp.as_bytes()) {
            Ok(s) => s,
            Err(_) => {
                for fd in intermediate_fds {
                    unsafe { libc::close(fd) };
                }
                return ProbeResult::Unknown { reason: CoverageReason::PathLimit };
            }
        };

        if !is_last {
            let next_fd = unsafe {
                libc::openat(
                    current_fd,
                    c_str.as_ptr(),
                    libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            if next_fd < 0 {
                let err = std::io::Error::last_os_error();
                for fd in intermediate_fds {
                    unsafe { libc::close(fd) };
                }
                if err.raw_os_error() == Some(libc::ENOENT) {
                    return ProbeResult::AbsentAtFirstTouch;
                } else if err.raw_os_error() == Some(libc::ELOOP) {
                    return ProbeResult::Unknown { reason: CoverageReason::Symlink };
                } else {
                    return ProbeResult::Unknown { reason: CoverageReason::Unreadable };
                }
            }
            intermediate_fds.push(next_fd);
            current_fd = next_fd;
        } else {
            // Final component: open with O_NONBLOCK | O_NOFOLLOW to prevent hanging on FIFOs!
            let file_fd = unsafe {
                libc::openat(
                    current_fd,
                    c_str.as_ptr(),
                    libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                )
            };
            for fd in intermediate_fds {
                unsafe { libc::close(fd) };
            }
            if file_fd < 0 {
                let err = std::io::Error::last_os_error();
                if err.raw_os_error() == Some(libc::ENOENT) {
                    return ProbeResult::AbsentAtFirstTouch;
                } else if err.raw_os_error() == Some(libc::ELOOP) {
                    return ProbeResult::Unknown { reason: CoverageReason::Symlink };
                } else {
                    return ProbeResult::Unknown { reason: CoverageReason::Unreadable };
                }
            }

            // Safe bounded read on file_fd directly
            let mut file = unsafe { std::fs::File::from_raw_fd(file_fd) };
            let mut stat_buf: libc::stat = unsafe { std::mem::zeroed() };
            if unsafe { libc::fstat(file_fd, &mut stat_buf) } != 0 {
                return ProbeResult::Unknown { reason: CoverageReason::Unreadable };
            }

            // Reject special files (FIFO, socket, block/char device, directory)
            if stat_buf.st_mode & libc::S_IFMT != libc::S_IFREG {
                return ProbeResult::Unknown { reason: CoverageReason::SpecialFile };
            }

            if stat_buf.st_size < 0 || stat_buf.st_size > MAX_FILE_RAW_BYTES as i64 {
                return ProbeResult::Unknown { reason: CoverageReason::FileTooLarge };
            }

            let mut bytes = Vec::new();
            let mut reader = (&mut file).take(MAX_FILE_RAW_BYTES as u64 + 1);
            if reader.read_to_end(&mut bytes).is_err() {
                return ProbeResult::Unknown { reason: CoverageReason::Unreadable };
            }

            if bytes.len() > MAX_FILE_RAW_BYTES {
                return ProbeResult::Unknown { reason: CoverageReason::FileTooLarge };
            }

            // Stability check on same descriptor including nanosecond precision
            let mut post_stat: libc::stat = unsafe { std::mem::zeroed() };
            if unsafe { libc::fstat(file_fd, &mut post_stat) } != 0
                || post_stat.st_size != stat_buf.st_size
                || post_stat.st_mtime != stat_buf.st_mtime
                || post_stat.st_mtime_nsec != stat_buf.st_mtime_nsec
            {
                return ProbeResult::Unknown { reason: CoverageReason::Unstable };
            }

            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            let sha256 = format!("{:x}", hasher.finalize());
            let mode = Some((stat_buf.st_mode & 0o777) as u32);
            let kind = if is_binary_buffer(&bytes) {
                FileContentKind::Binary
            } else {
                FileContentKind::Text
            };

            return ProbeResult::Present {
                bytes: Arc::from(bytes.into_boxed_slice()),
                size_bytes: stat_buf.st_size as u64,
                sha256,
                mode,
                kind,
            };
        }
    }

    ProbeResult::AbsentAtFirstTouch
}

#[cfg(not(unix))]
fn probe_file_safely_fallback(canonical_root: &Path, rel_path: &str) -> ProbeResult {
    use std::io::Read;

    let components: Vec<&str> = rel_path.split('/').filter(|s| !s.is_empty()).collect();
    if components.is_empty() {
        return ProbeResult::Unknown { reason: CoverageReason::PathLimit };
    }

    let mut current = canonical_root.to_path_buf();
    for (idx, comp) in components.iter().enumerate() {
        current.push(comp);
        let is_last = idx == components.len() - 1;

        match std::fs::symlink_metadata(&current) {
            Ok(meta) => {
                if meta.is_symlink() {
                    return ProbeResult::Unknown { reason: CoverageReason::Symlink };
                }
                if !is_last {
                    if !meta.is_dir() {
                        return ProbeResult::Unknown { reason: CoverageReason::Unreadable };
                    }
                } else {
                    if !meta.is_file() {
                        return ProbeResult::Unknown { reason: CoverageReason::SpecialFile };
                    }
                    let size = meta.len();
                    if size > MAX_FILE_RAW_BYTES as u64 {
                        return ProbeResult::Unknown { reason: CoverageReason::FileTooLarge };
                    }
                    let mut file = match std::fs::File::open(&current) {
                        Ok(f) => f,
                        Err(_) => return ProbeResult::Unknown { reason: CoverageReason::Unreadable },
                    };
                    let mut bytes = Vec::new();
                    let mut reader = (&mut file).take(MAX_FILE_RAW_BYTES as u64 + 1);
                    if reader.read_to_end(&mut bytes).is_err() || bytes.len() > MAX_FILE_RAW_BYTES {
                        return ProbeResult::Unknown { reason: CoverageReason::FileTooLarge };
                    }
                    if let Ok(post_meta) = std::fs::symlink_metadata(&current) {
                        if post_meta.len() != size {
                            return ProbeResult::Unknown { reason: CoverageReason::Unstable };
                        }
                    }
                    let mut hasher = Sha256::new();
                    hasher.update(&bytes);
                    let sha256 = format!("{:x}", hasher.finalize());
                    let kind = if is_binary_buffer(&bytes) {
                        FileContentKind::Binary
                    } else {
                        FileContentKind::Text
                    };
                    return ProbeResult::Present {
                        bytes: Arc::from(bytes.into_boxed_slice()),
                        size_bytes: size,
                        sha256,
                        mode: None,
                        kind,
                    };
                }
            }
            Err(e) => {
                if e.kind() == std::io::ErrorKind::NotFound {
                    return ProbeResult::AbsentAtFirstTouch;
                } else {
                    return ProbeResult::Unknown { reason: CoverageReason::Unreadable };
                }
            }
        }
    }

    ProbeResult::AbsentAtFirstTouch
}

pub fn probe_file_safely(
    root_fd: Option<RootDescriptor>,
    canonical_root: &Path,
    rel_path: &str,
) -> ProbeResult {
    let canonical_path = match normalize_and_validate_path(rel_path) {
        Ok(p) => p,
        Err(reason) => return ProbeResult::Unknown { reason },
    };

    let p = Path::new(&canonical_path);
    // Check gitignore if repository is present
    if let Ok(repo) = git2::Repository::open(canonical_root) {
        if repo.is_path_ignored(p).unwrap_or(true) {
            return ProbeResult::Excluded {
                reason: CoverageReason::NestedRoot,
            };
        }
    }

    #[cfg(unix)]
    {
        probe_file_safely_unix(root_fd, canonical_root, &canonical_path)
    }
    #[cfg(not(unix))]
    {
        let _ = root_fd;
        probe_file_safely_fallback(canonical_root, &canonical_path)
    }
}

pub async fn register_session(
    service: &Arc<SessionChangesService>,
    terminal_id: String,
    terminal_incarnation: String,
    project_root: &Path,
    req: RegisterRequest,
) -> Result<RegisterResponse, ErrorCode> {
    let (enabled, generation) = service.current_generation();
    if !enabled {
        return Err(ErrorCode::TrackingDisabled);
    }
    if req.version != 1 {
        return Err(ErrorCode::InvalidRequest);
    }
    if !is_valid_canonical_decimal_string(&terminal_incarnation) {
        return Err(ErrorCode::IncarnationMismatch);
    }

    let mut preflight_budget = PreflightBudget::default();
    let validated_root = validate_project_root_preflight(
        project_root,
        &req.root_id,
        req.cwd_hint.as_deref(),
        &mut preflight_budget,
    )
    .map_err(|e| match e {
        crate::session_changes::root::RootPreflightError::InvalidRootId(_) => {
            ErrorCode::InvalidRequest
        }
        crate::session_changes::root::RootPreflightError::RootEscapesProject => {
            ErrorCode::RootMismatch
        }
        crate::session_changes::root::RootPreflightError::GitMarkerMissing => {
            ErrorCode::TargetUnavailable
        }
        crate::session_changes::root::RootPreflightError::BudgetExhausted(_) => ErrorCode::Deadline,
        crate::session_changes::root::RootPreflightError::TargetUnavailable => {
            ErrorCode::TargetUnavailable
        }
        crate::session_changes::root::RootPreflightError::Io(_) => ErrorCode::TargetUnavailable,
    })?;

    let key = SessionChangesKey {
        terminal_id: terminal_id.clone(),
        terminal_incarnation: terminal_incarnation.clone(),
        omp_session_id: req.omp_session_id.clone(),
        root_id: req.root_id.clone(),
    };

    // Lock ordering: lifecycle before records
    let lifecycle = service.lifecycle.read();
    if !lifecycle.enabled || lifecycle.generation != generation {
        return Err(ErrorCode::TrackingDisabled);
    }

    let mut records = service.records.lock();
    if let Some(existing) = records.get(&key) {
        return Ok(RegisterResponse {
            server_epoch: service.server_epoch.clone(),
            terminal_incarnation,
            omp_session_id: req.omp_session_id,
            root_id: req.root_id,
            baseline_id: existing.baseline_id.clone(),
            canonical_root: existing.canonical_root.to_string_lossy().to_string(),
        });
    }

    if records.len() >= MAX_RETAINED_IDENTITIES {
        return Err(ErrorCode::Capacity);
    }

    let baseline_id = Uuid::new_v4().to_string();
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    #[cfg(unix)]
    let root_dir_file = {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let c_path = CString::new(validated_root.canonical_root.as_os_str().as_bytes())
            .map_err(|_| ErrorCode::TargetUnavailable)?;
        let fd = unsafe {
            libc::open(
                c_path.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(ErrorCode::TargetUnavailable);
        }
        Some(Arc::new(unsafe { std::fs::File::from_raw_fd(fd) }))
    };
    #[cfg(not(unix))]
    let root_dir_file = None;

    let record = SessionChangesRecord {
        baseline_id: baseline_id.clone(),
        omp_session_id: req.omp_session_id.clone(),
        root_id: req.root_id.clone(),
        canonical_root: validated_root.canonical_root.clone(),
        root_dir_file,
        generation,
        created_at_ms: now_ms,
        captured_at_ms: now_ms,
        state: StatusState::Ready,
        tracked_paths: std::collections::BTreeMap::new(),
        retained_bytes: 0,
        comparison: None,
        comparison_revision: 0,
        capture_generation: 0,
        reason: None,
        recent_turn_ids: BTreeSet::new(),
        last_settled_turn_id: None,
        dirty_settled_hint: false,
    };

    records.insert(key, record);

    Ok(RegisterResponse {
        server_epoch: service.server_epoch.clone(),
        terminal_incarnation,
        omp_session_id: req.omp_session_id,
        root_id: req.root_id,
        baseline_id,
        canonical_root: validated_root.canonical_root.to_string_lossy().to_string(),
    })
}

pub async fn capture_session_paths(
    service: &Arc<SessionChangesService>,
    terminal_id: String,
    terminal_incarnation: String,
    req: CaptureRequest,
) -> Result<CaptureResponse, ErrorCode> {
    let (enabled, generation) = service.current_generation();
    if !enabled {
        return Err(ErrorCode::TrackingDisabled);
    }
    if req.version != 1 {
        return Err(ErrorCode::InvalidRequest);
    }
    if req.server_epoch != service.server_epoch {
        return Err(ErrorCode::ServerRestarted);
    }
    if !is_valid_canonical_decimal_string(&terminal_incarnation) {
        return Err(ErrorCode::IncarnationMismatch);
    }
    if req.terminal_incarnation != terminal_incarnation {
        return Err(ErrorCode::IncarnationMismatch);
    }

    let key = SessionChangesKey {
        terminal_id,
        terminal_incarnation,
        omp_session_id: req.omp_session_id,
        root_id: req.root_id,
    };

    let (canonical_root, root_file_opt) = {
        let lifecycle = service.lifecycle.read();
        if !lifecycle.enabled || lifecycle.generation != generation {
            return Err(ErrorCode::TrackingDisabled);
        }
        let records = service.records.lock();
        let rec = records.get(&key).ok_or(ErrorCode::BaselineMissing)?;
        if rec.baseline_id != req.baseline_id {
            return Err(ErrorCode::BaselineMissing);
        }
        (rec.canonical_root.clone(), rec.root_dir_file.clone())
    };

    match req.mode {
        CaptureMode::Unproven => {
            let lifecycle = service.lifecycle.read();
            if !lifecycle.enabled || lifecycle.generation != generation {
                return Err(ErrorCode::TrackingDisabled);
            }
            let mut records = service.records.lock();
            let rec = records.get_mut(&key).ok_or(ErrorCode::BaselineMissing)?;
            let mut results = Vec::new();

            for raw_path in req.paths {
                let canonical_path = match normalize_and_validate_path(&raw_path) {
                    Ok(p) => p,
                    Err(_) => {
                        results.push(PathCaptureDisposition {
                            path: raw_path,
                            file_id: None,
                            status: PathCaptureStatus::Unknown,
                            presence: Some(PathPresence::Unknown),
                            reason: Some("invalidPath".into()),
                        });
                        continue;
                    }
                };

                let path = canonical_path;
                if let Some(entry) = rec.tracked_paths.get_mut(&path) {
                    if entry.last_capture_id.as_deref() == Some(&req.capture_id) {
                        // Unproven for this attempt: downgrade attempt and release any reserved bytes
                        if entry.bytes.is_some() {
                            service.release_storage(entry.size_bytes);
                            rec.retained_bytes = rec.retained_bytes.saturating_sub(entry.size_bytes);
                        }
                        entry.bytes = None;
                        entry.size_bytes = 0;
                        entry.presence = Presence::Unknown;
                        entry.provenance = Provenance::Unproven;
                        entry.reservation = CaptureReservationState::Sealed;
                        entry.acknowledged = false;
                        rec.comparison = None;
                        rec.comparison_revision += 1;
                        rec.capture_generation += 1;
                    }
                    results.push(PathCaptureDisposition {
                        path: path.clone(),
                        file_id: Some(entry.file_id.clone()),
                        status: PathCaptureStatus::Unproven,
                        presence: Some(PathPresence::Unknown),
                        reason: Some("unproven".into()),
                    });
                } else if rec.tracked_paths.len() < MAX_PATHS_PER_SESSION {
                    let file_id = Uuid::new_v4().to_string();
                    rec.tracked_paths.insert(
                        path.clone(),
                        TrackedPathEntry {
                            file_id: file_id.clone(),
                            path: path.clone(),
                            presence: Presence::Unknown,
                            provenance: Provenance::Unproven,
                            size_bytes: 0,
                            sha256: None,
                            mode: None,
                            kind: FileContentKind::Unknown,
                            bytes: None,
                            reasons: vec![CoverageReason::AbsenceUnknown],
                            reservation: CaptureReservationState::Sealed,
                            last_capture_id: Some(req.capture_id.clone()),
                            acknowledged: false,
                        },
                    );
                    rec.capture_generation += 1;
                    results.push(PathCaptureDisposition {
                        path,
                        file_id: Some(file_id),
                        status: PathCaptureStatus::Unproven,
                        presence: Some(PathPresence::Unknown),
                        reason: Some("unproven".into()),
                    });
                } else {
                    results.push(PathCaptureDisposition {
                        path,
                        file_id: None,
                        status: PathCaptureStatus::Unknown,
                        presence: Some(PathPresence::Unknown),
                        reason: Some("pathLimit".into()),
                    });
                }
            }

            Ok(CaptureResponse {
                version: 1,
                capture_id: req.capture_id,
                results,
            })
        }
        CaptureMode::PreEdit => {
            let mut paths_to_probe = Vec::new();
            let mut results = Vec::new();

            {
                let lifecycle = service.lifecycle.read();
                if !lifecycle.enabled || lifecycle.generation != generation {
                    return Err(ErrorCode::TrackingDisabled);
                }
                let mut records = service.records.lock();
                let rec = records.get_mut(&key).ok_or(ErrorCode::BaselineMissing)?;

                for raw_path in req.paths {
                    let canonical_path = match normalize_and_validate_path(&raw_path) {
                        Ok(p) => p,
                        Err(_) => {
                            results.push(PathCaptureDisposition {
                                path: raw_path,
                                file_id: None,
                                status: PathCaptureStatus::Unknown,
                                presence: Some(PathPresence::Unknown),
                                reason: Some("invalidPath".into()),
                            });
                            continue;
                        }
                    };

                    let path = canonical_path;
                    if let Some(existing) = rec.tracked_paths.get_mut(&path) {
                        if existing.acknowledged {
                            let path_presence = match existing.presence {
                                Presence::Present => Some(PathPresence::Present),
                                Presence::Absent => Some(PathPresence::AbsentAtFirstTouch),
                                Presence::Unknown => Some(PathPresence::Unknown),
                            };
                            results.push(PathCaptureDisposition {
                                path: path.clone(),
                                file_id: Some(existing.file_id.clone()),
                                status: PathCaptureStatus::AlreadyKnown,
                                presence: path_presence,
                                reason: None,
                            });
                        } else {
                            // Conflicting concurrent capture while an in-flight probe is pending:
                            // Invalidate pending reservation to Unknown so in-flight probe cannot adopt mutated bytes!
                            existing.presence = Presence::Unknown;
                            existing.provenance = Provenance::Unproven;
                            existing.reservation = CaptureReservationState::Sealed;
                            existing.acknowledged = false;
                            rec.capture_generation += 1;
                            results.push(PathCaptureDisposition {
                                path: path.clone(),
                                file_id: Some(existing.file_id.clone()),
                                status: PathCaptureStatus::Unknown,
                                presence: Some(PathPresence::Unknown),
                                reason: Some("concurrentConflictInvalidated".into()),
                            });
                        }
                    } else if rec.tracked_paths.len() >= MAX_PATHS_PER_SESSION {
                        results.push(PathCaptureDisposition {
                            path,
                            file_id: None,
                            status: PathCaptureStatus::Unknown,
                            presence: Some(PathPresence::Unknown),
                            reason: Some("pathLimit".into()),
                        });
                    } else {
                        let file_id = Uuid::new_v4().to_string();
                        rec.tracked_paths.insert(
                            path.clone(),
                            TrackedPathEntry {
                                file_id: file_id.clone(),
                                path: path.clone(),
                                presence: Presence::Unknown,
                                provenance: Provenance::Unproven,
                                size_bytes: 0,
                                sha256: None,
                                mode: None,
                                kind: FileContentKind::Unknown,
                                bytes: None,
                                reasons: Vec::new(),
                                reservation: CaptureReservationState::Pending {
                                    capture_id: req.capture_id.clone(),
                                    reserved_at: Instant::now(),
                                },
                                last_capture_id: Some(req.capture_id.clone()),
                                acknowledged: false,
                            },
                        );
                        rec.capture_generation += 1;
                        paths_to_probe.push((path, file_id));
                    }
                }
            }

            for (path, file_id) in paths_to_probe {
                let service_clone = service.clone();
                let canonical_root_clone = canonical_root.clone();
                let path_clone = path.clone();
                let root_file_clone = root_file_opt.clone();

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
                .unwrap_or(ProbeResult::Unknown {
                    reason: CoverageReason::Deadline,
                });

                // Strict lock ordering: lifecycle before records
                let lifecycle = service.lifecycle.read();
                if !lifecycle.enabled || lifecycle.generation != generation {
                    return Err(ErrorCode::TrackingDisabled);
                }

                let mut records = service.records.lock();
                let rec = match records.get_mut(&key) {
                    Some(r) => r,
                    None => return Err(ErrorCode::BaselineMissing),
                };
                if rec.baseline_id != req.baseline_id {
                    return Err(ErrorCode::BaselineMissing);
                }


                let entry = match rec.tracked_paths.get_mut(&path) {
                    Some(e) => e,
                    None => continue,
                };

                // Check reservation ownership and timeout deadline
                let (is_matching_pending, is_timed_out) = match &entry.reservation {
                    CaptureReservationState::Pending { capture_id, reserved_at } => {
                        (capture_id == &req.capture_id, reserved_at.elapsed() > CAPTURE_TIMEOUT_DEADLINE)
                    }
                    CaptureReservationState::Sealed => (false, false),
                };

                if !is_matching_pending || is_timed_out {
                    // Reservation timed out or was already sealed: DO NOT adopt post-edit bytes!
                    if is_timed_out {
                        entry.presence = Presence::Unknown;
                        entry.provenance = Provenance::Unproven;
                        entry.reservation = CaptureReservationState::Sealed;
                        entry.acknowledged = false;
                        rec.capture_generation += 1;
                    }
                    let path_presence = match entry.presence {
                        Presence::Present => Some(PathPresence::Present),
                        Presence::Absent => Some(PathPresence::AbsentAtFirstTouch),
                        Presence::Unknown => Some(PathPresence::Unknown),
                    };
                    results.push(PathCaptureDisposition {
                        path,
                        file_id: Some(file_id),
                        status: PathCaptureStatus::Unknown,
                        presence: path_presence,
                        reason: Some("timeoutOrReplaced".into()),
                    });
                    continue;
                }

                entry.reservation = CaptureReservationState::Sealed;
                rec.capture_generation += 1;
                match probe_res {
                    ProbeResult::Present {
                        bytes,
                        size_bytes,
                        sha256,
                        mode,
                        kind,
                    } => {
                        if service.try_reserve_storage(size_bytes).is_ok() {
                            rec.retained_bytes += size_bytes;
                            entry.presence = Presence::Present;
                            entry.provenance = Provenance::Captured;
                            entry.size_bytes = size_bytes;
                            entry.sha256 = Some(sha256);
                            entry.mode = mode;
                            entry.kind = kind;
                            entry.bytes = Some(bytes);
                            entry.reasons.clear();
                            entry.acknowledged = true;

                            results.push(PathCaptureDisposition {
                                path,
                                file_id: Some(file_id),
                                status: PathCaptureStatus::Captured,
                                presence: Some(PathPresence::Present),
                                reason: None,
                            });
                        } else {
                            entry.presence = Presence::Unknown;
                            entry.provenance = Provenance::Unproven;
                            entry.reasons.push(CoverageReason::Capacity);
                            entry.acknowledged = false;

                            results.push(PathCaptureDisposition {
                                path,
                                file_id: Some(file_id),
                                status: PathCaptureStatus::Unknown,
                                presence: Some(PathPresence::Unknown),
                                reason: Some("capacity".into()),
                            });
                        }
                    }
                    ProbeResult::AbsentAtFirstTouch => {
                        entry.presence = Presence::Absent;
                        entry.provenance = Provenance::AbsentAtFirstTouch;
                        entry.size_bytes = 0;
                        entry.bytes = None;
                        entry.reasons.clear();
                        entry.acknowledged = true;

                        results.push(PathCaptureDisposition {
                            path,
                            file_id: Some(file_id),
                            status: PathCaptureStatus::Captured,
                            presence: Some(PathPresence::AbsentAtFirstTouch),
                            reason: None,
                        });
                    }
                    ProbeResult::Unknown { reason } => {
                        entry.presence = Presence::Unknown;
                        entry.provenance = Provenance::Unproven;
                        entry.reasons.push(reason);
                        entry.acknowledged = false;

                        results.push(PathCaptureDisposition {
                            path,
                            file_id: Some(file_id),
                            status: PathCaptureStatus::Unknown,
                            presence: Some(PathPresence::Unknown),
                            reason: Some(format!("{:?}", reason)),
                        });
                    }
                    ProbeResult::Excluded { reason } => {
                        entry.presence = Presence::Unknown;
                        entry.provenance = Provenance::ExcludedAtCapture;
                        entry.reasons.push(reason);
                        entry.acknowledged = false;

                        results.push(PathCaptureDisposition {
                            path,
                            file_id: Some(file_id),
                            status: PathCaptureStatus::Unknown,
                            presence: Some(PathPresence::Unknown),
                            reason: Some(format!("{:?}", reason)),
                        });
                    }
                }
            }

            Ok(CaptureResponse {
                version: 1,
                capture_id: req.capture_id,
                results,
            })
        }
    }
}
