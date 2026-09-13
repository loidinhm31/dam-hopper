use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

use crate::diagnostics::DiagnosticEvent;
use crate::idle_suspend::audit::HelperAuditRecord;
use crate::idle_suspend::event::IdleSuspendEventEnvelopeV1;
use crate::idle_suspend::server_audit::ServerAuditRecord;

use super::model::{
    Applicability, CollectionStatus, Historicity, ProjectedDiagnosticEvent, ProjectedHelperAudit,
    ProjectedServerAudit, ProjectedServerEvent, SourceCoverage, SourceEnvelope, TypedCollectionError,
    MAX_ACCEPTED_RECORDS_PER_SOURCE, MAX_FILE_SCAN_BYTES, MAX_JSONL_LINE_BYTES, MAX_SOURCE_ERRORS,
};
use super::redaction::{
    project_diagnostic_event, project_helper_audit, project_server_audit, project_server_event,
};

pub struct RawLineRecord {
    pub line_offset: usize,
    pub raw_bytes: Vec<u8>,
}

pub struct FileScanResult {
    pub status: CollectionStatus,
    pub byte_count: usize,
    pub malformed_count: usize,
    pub retention_limited: bool,
    pub truncated: bool,
    pub errors: Vec<TypedCollectionError>,
    pub lines: Vec<RawLineRecord>,
}

fn push_error(errors: &mut Vec<TypedCollectionError>, error: TypedCollectionError) {
    if errors.len() < MAX_SOURCE_ERRORS {
        errors.push(error);
    }
}

fn discard_until_newline<R: Read>(reader: &mut R, total_bytes_scanned: &mut usize, max_scan: usize) {
    let mut byte = [0u8; 1];
    while *total_bytes_scanned < max_scan {
        match reader.read(&mut byte) {
            Ok(0) => break,
            Ok(_) => {
                *total_bytes_scanned += 1;
                if byte[0] == b'\n' {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

pub fn scan_bounded_jsonl_file(source_name: &str, path: &Path) -> FileScanResult {
    let mut errors = Vec::new();

    let meta = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(err) => {
            let status = match err.kind() {
                std::io::ErrorKind::NotFound => CollectionStatus::Missing,
                std::io::ErrorKind::PermissionDenied => CollectionStatus::PermissionDenied,
                _ => CollectionStatus::IoError,
            };
            push_error(&mut errors, TypedCollectionError::new(
                source_name,
                match status {
                    CollectionStatus::Missing => "fileMissing",
                    CollectionStatus::PermissionDenied => "permissionDenied",
                    _ => "ioError",
                },
                format!("Failed to stat file: {}", err.kind()),
            ));
            return FileScanResult {
                status,
                byte_count: 0,
                malformed_count: 0,
                retention_limited: false,
                truncated: false,
                errors,
                lines: Vec::new(),
            };
        }
    };

    if meta.file_type().is_symlink() {
        push_error(&mut errors, TypedCollectionError::new(
            source_name,
            "unsupportedSymlink",
            "Symlink traversal is rejected",
        ));
        return FileScanResult {
            status: CollectionStatus::Unsupported,
            byte_count: 0,
            malformed_count: 0,
            retention_limited: false,
            truncated: false,
            errors,
            lines: Vec::new(),
        };
    }

    if !meta.file_type().is_file() {
        push_error(&mut errors, TypedCollectionError::new(
            source_name,
            "notRegularFile",
            "Source is not a regular file",
        ));
        return FileScanResult {
            status: CollectionStatus::Unsupported,
            byte_count: 0,
            malformed_count: 0,
            retention_limited: false,
            truncated: false,
            errors,
            lines: Vec::new(),
        };
    }

    let file_len = meta.len() as usize;
    if file_len == 0 {
        return FileScanResult {
            status: CollectionStatus::Available,
            byte_count: 0,
            malformed_count: 0,
            retention_limited: false,
            truncated: false,
            errors,
            lines: Vec::new(),
        };
    }

    let mut open_options = std::fs::OpenOptions::new();
    open_options.read(true);
    #[cfg(unix)]
    open_options.custom_flags(libc::O_NOFOLLOW);

    let file = match open_options.open(path) {
        Ok(f) => f,
        Err(err) => {
            let status = match err.kind() {
                std::io::ErrorKind::NotFound => CollectionStatus::Missing,
                std::io::ErrorKind::PermissionDenied => CollectionStatus::PermissionDenied,
                _ => CollectionStatus::IoError,
            };
            push_error(&mut errors, TypedCollectionError::new(
                source_name,
                match status {
                    CollectionStatus::Missing => "fileMissing",
                    CollectionStatus::PermissionDenied => "permissionDenied",
                    _ => "ioError",
                },
                format!("Failed to open file: {}", err.kind()),
            ));
            return FileScanResult {
                status,
                byte_count: 0,
                malformed_count: 0,
                retention_limited: false,
                truncated: false,
                errors,
                lines: Vec::new(),
            };
        }
    };

    let mut reader = BufReader::new(file);
    let mut retention_limited = false;

    if file_len > MAX_FILE_SCAN_BYTES {
        retention_limited = true;
        let seek_pos = (file_len - MAX_FILE_SCAN_BYTES) as u64;
        if reader.seek(SeekFrom::Start(seek_pos)).is_err() {
            push_error(&mut errors, TypedCollectionError::new(
                source_name,
                "seekFailed",
                "Failed to seek to bounded scan start",
            ));
            return FileScanResult {
                status: CollectionStatus::IoError,
                byte_count: 0,
                malformed_count: 0,
                retention_limited: true,
                truncated: false,
                errors,
                lines: Vec::new(),
            };
        }
        // Discard any partial line after seek without unbounded allocation
        let mut dummy = 0usize;
        discard_until_newline(&mut reader, &mut dummy, MAX_FILE_SCAN_BYTES);
    }

    let mut reader = reader.take(MAX_FILE_SCAN_BYTES as u64);

    let mut lines = Vec::new();
    let mut malformed_count = 0usize;
    let mut truncated = false;
    let mut line_offset = 0usize;
    let mut total_bytes_scanned = 0usize;

    loop {
        line_offset += 1;
        let mut raw_buf = Vec::new();

        // Read up to MAX_JSONL_LINE_BYTES + 1
        let mut take_reader = (&mut reader).take((MAX_JSONL_LINE_BYTES + 1) as u64);
        let read_bytes = match take_reader.read_until(b'\n', &mut raw_buf) {
            Ok(n) => n,
            Err(e) => {
                push_error(&mut errors, TypedCollectionError::new(
                    source_name,
                    "readError",
                    format!("Error reading line {line_offset}: {e}"),
                ));
                break;
            }
        };

        if read_bytes == 0 {
            break; // EOF
        }

        total_bytes_scanned = total_bytes_scanned.saturating_add(read_bytes);

        // Check if line was capped without reaching '\n'
        if read_bytes > MAX_JSONL_LINE_BYTES && !raw_buf.ends_with(b"\n") {
            malformed_count += 1;
            push_error(&mut errors, TypedCollectionError::new(
                source_name,
                "lineExceedsCap",
                format!("Line {line_offset} exceeded 16 KiB cap and was discarded"),
            ));
            // Read until next newline without keeping buffer
            discard_until_newline(&mut reader, &mut total_bytes_scanned, MAX_FILE_SCAN_BYTES);
            continue;
        }

        let has_newline = raw_buf.ends_with(b"\n");
        if !has_newline {
            // Partial tail at EOF
            malformed_count += 1;
            push_error(&mut errors, TypedCollectionError::new(
                source_name,
                "partialTail",
                format!("Line {line_offset} ended without trailing newline"),
            ));
        }

        // Trim newline bytes for JSON parsing
        while raw_buf.ends_with(b"\n") || raw_buf.ends_with(b"\r") {
            raw_buf.pop();
        }

        if raw_buf.is_empty() {
            continue; // Skip empty lines
        }

        lines.push(RawLineRecord {
            line_offset,
            raw_bytes: raw_buf,
        });

        if lines.len() > MAX_ACCEPTED_RECORDS_PER_SOURCE {
            truncated = true;
            lines.truncate(MAX_ACCEPTED_RECORDS_PER_SOURCE);
            break;
        }
    }

    let status = if malformed_count > 0 {
        CollectionStatus::Malformed
    } else if truncated {
        CollectionStatus::Truncated
    } else if retention_limited {
        CollectionStatus::RetentionLimited
    } else {
        CollectionStatus::Available
    };

    FileScanResult {
        status,
        byte_count: total_bytes_scanned,
        malformed_count,
        retention_limited,
        truncated,
        errors,
        lines,
    }
}

pub fn read_server_events(
    path: &Path,
    window_start_ms: u64,
    window_end_ms: u64,
    required: bool,
) -> SourceEnvelope<Vec<ProjectedServerEvent>> {
    let source_name = "serverEvents";
    let scan = scan_bounded_jsonl_file(source_name, path);
    let mut envelope = SourceEnvelope::empty(
        scan.status,
        Historicity::Historical,
        Applicability::Applicable,
        required,
        SourceCoverage::new(window_start_ms, window_end_ms),
    );

    envelope.byte_count = scan.byte_count;
    envelope.malformed_count = scan.malformed_count;
    envelope.retention_limited = scan.retention_limited;
    envelope.truncated = scan.truncated;
    envelope.errors = scan.errors;

    if scan.status == CollectionStatus::Missing
        || scan.status == CollectionStatus::PermissionDenied
        || scan.status == CollectionStatus::Unsupported
        || scan.status == CollectionStatus::IoError
    {
        envelope.coverage.coverage_unknown = Some(format!("Source status: {:?}", scan.status));
        return envelope;
    }

    let mut projected_events = Vec::new();
    let mut min_ts: Option<u64> = None;
    let mut max_ts: Option<u64> = None;
    let mut first_seq: Option<u64> = None;

    for raw in scan.lines {
        let text = match std::str::from_utf8(&raw.raw_bytes) {
            Ok(s) => s,
            Err(_) => {
                envelope.malformed_count += 1;
                envelope.collection_status = CollectionStatus::Malformed;
                push_error(&mut envelope.errors, TypedCollectionError::new(
                    source_name,
                    "malformedUtf8",
                    format!("Line {} is not valid UTF-8", raw.line_offset),
                ));
                continue;
            }
        };

        let decoded: IdleSuspendEventEnvelopeV1 = match serde_json::from_str(text) {
            Ok(d) => d,
            Err(e) => {
                envelope.malformed_count += 1;
                envelope.collection_status = CollectionStatus::Malformed;
                push_error(&mut envelope.errors, TypedCollectionError::new(
                    source_name,
                    "malformedJson",
                    format!("Line {}: {e}", raw.line_offset),
                ));
                continue;
            }
        };

        if first_seq.is_none() {
            first_seq = Some(decoded.producer_sequence);
        }

        let ts = decoded.timestamp_ms;
        min_ts = Some(min_ts.map_or(ts, |m| m.min(ts)));
        max_ts = Some(max_ts.map_or(ts, |m| m.max(ts)));

        // Include records in the window
        if ts >= window_start_ms && ts <= window_end_ms {
            match project_server_event(decoded) {
                Ok(proj) => projected_events.push(proj),
                Err(err_msg) => {
                    envelope.malformed_count += 1;
                    envelope.collection_status = CollectionStatus::Malformed;
                    push_error(&mut envelope.errors, TypedCollectionError::new(
                        source_name,
                        "projectionFailed",
                        format!("Line {}: {err_msg}", raw.line_offset),
                    ));
                }
            }
        }
    }

    envelope.record_count = projected_events.len();
    envelope.records = projected_events;

    // Derive coverage
    if envelope.record_count == 0 && scan.byte_count == 0 {
        // Readable empty file
        envelope.coverage.proven_start_ms = Some(window_start_ms);
        envelope.coverage.proven_end_ms = Some(window_end_ms);
    } else if let Some(min) = min_ts {
        if min <= window_start_ms || first_seq == Some(1) {
            envelope.coverage.proven_start_ms = Some(window_start_ms);
        } else {
            envelope.drop_suspected = true;
            envelope.rotation_suspected = true;
            envelope.coverage.coverage_unknown =
                Some("producerSequenceStartedAboveOneWithoutEarlierEvents".to_string());
        }
        envelope.coverage.proven_end_ms = Some(max_ts.unwrap_or(window_end_ms));
    } else {
        envelope.coverage.coverage_unknown = Some("noEventsFound".to_string());
    }

    envelope
}

pub fn read_server_audit(
    path: &Path,
    window_start_ms: u64,
    window_end_ms: u64,
    required: bool,
) -> SourceEnvelope<Vec<ProjectedServerAudit>> {
    let source_name = "serverAudit";
    let scan = scan_bounded_jsonl_file(source_name, path);
    let mut envelope = SourceEnvelope::empty(
        scan.status,
        Historicity::Historical,
        Applicability::Applicable,
        required,
        SourceCoverage::new(window_start_ms, window_end_ms),
    );

    envelope.byte_count = scan.byte_count;
    envelope.malformed_count = scan.malformed_count;
    envelope.retention_limited = scan.retention_limited;
    envelope.truncated = scan.truncated;
    envelope.errors = scan.errors;

    if scan.status == CollectionStatus::Missing
        || scan.status == CollectionStatus::PermissionDenied
        || scan.status == CollectionStatus::Unsupported
        || scan.status == CollectionStatus::IoError
    {
        envelope.coverage.coverage_unknown = Some(format!("Source status: {:?}", scan.status));
        return envelope;
    }

    let mut projected_audits = Vec::new();
    let mut min_ts: Option<u64> = None;
    let mut max_ts: Option<u64> = None;

    for raw in scan.lines {
        let text = match std::str::from_utf8(&raw.raw_bytes) {
            Ok(s) => s,
            Err(_) => {
                envelope.malformed_count += 1;
                envelope.collection_status = CollectionStatus::Malformed;
                push_error(&mut envelope.errors, TypedCollectionError::new(
                    source_name,
                    "malformedUtf8",
                    format!("Line {} is not valid UTF-8", raw.line_offset),
                ));
                continue;
            }
        };

        let decoded: ServerAuditRecord = match serde_json::from_str(text) {
            Ok(d) => d,
            Err(e) => {
                envelope.malformed_count += 1;
                envelope.collection_status = CollectionStatus::Malformed;
                push_error(&mut envelope.errors, TypedCollectionError::new(
                    source_name,
                    "malformedJson",
                    format!("Line {}: {e}", raw.line_offset),
                ));
                continue;
            }
        };

        let ts = decoded.timestamp_ms();
        min_ts = Some(min_ts.map_or(ts, |m| m.min(ts)));
        max_ts = Some(max_ts.map_or(ts, |m| m.max(ts)));

        if ts >= window_start_ms && ts <= window_end_ms {
            match project_server_audit(decoded) {
                Ok(proj) => projected_audits.push(proj),
                Err(err_msg) => {
                    envelope.malformed_count += 1;
                    envelope.collection_status = CollectionStatus::Malformed;
                    push_error(&mut envelope.errors, TypedCollectionError::new(
                        source_name,
                        "projectionFailed",
                        format!("Line {}: {err_msg}", raw.line_offset),
                    ));
                }
            }
        }
    }

    envelope.record_count = projected_audits.len();
    envelope.records = projected_audits;

    if envelope.record_count == 0 && scan.byte_count == 0 {
        envelope.coverage.proven_start_ms = Some(window_start_ms);
        envelope.coverage.proven_end_ms = Some(window_end_ms);
    } else if let Some(min) = min_ts {
        if min <= window_start_ms {
            envelope.coverage.proven_start_ms = Some(window_start_ms);
        } else {
            envelope.rotation_suspected = true;
            envelope.coverage.coverage_unknown =
                Some("earliestRecordNewerThanWindowStart".to_string());
        }
        envelope.coverage.proven_end_ms = Some(max_ts.unwrap_or(window_end_ms));
    } else {
        envelope.coverage.coverage_unknown = Some("noRecordsFound".to_string());
    }

    envelope
}

pub fn read_helper_audit(
    path: &Path,
    window_start_ms: u64,
    window_end_ms: u64,
    required: bool,
) -> SourceEnvelope<Vec<ProjectedHelperAudit>> {
    let source_name = "helperAudit";
    let scan = scan_bounded_jsonl_file(source_name, path);
    let mut envelope = SourceEnvelope::empty(
        scan.status,
        Historicity::Historical,
        Applicability::Applicable,
        required,
        SourceCoverage::new(window_start_ms, window_end_ms),
    );

    envelope.byte_count = scan.byte_count;
    envelope.malformed_count = scan.malformed_count;
    envelope.retention_limited = scan.retention_limited;
    envelope.truncated = scan.truncated;
    envelope.errors = scan.errors;

    if scan.status == CollectionStatus::Missing
        || scan.status == CollectionStatus::PermissionDenied
        || scan.status == CollectionStatus::Unsupported
        || scan.status == CollectionStatus::IoError
    {
        envelope.coverage.coverage_unknown = Some(format!("Source status: {:?}", scan.status));
        return envelope;
    }

    let mut projected_helper_audits = Vec::new();
    let mut min_ts: Option<u64> = None;
    let mut max_ts: Option<u64> = None;
    let mut first_seq: Option<u64> = None;

    for raw in scan.lines {
        let text = match std::str::from_utf8(&raw.raw_bytes) {
            Ok(s) => s,
            Err(_) => {
                envelope.malformed_count += 1;
                envelope.collection_status = CollectionStatus::Malformed;
                push_error(&mut envelope.errors, TypedCollectionError::new(
                    source_name,
                    "malformedUtf8",
                    format!("Line {} is not valid UTF-8", raw.line_offset),
                ));
                continue;
            }
        };

        let decoded: HelperAuditRecord = match serde_json::from_str(text) {
            Ok(d) => d,
            Err(e) => {
                envelope.malformed_count += 1;
                envelope.collection_status = CollectionStatus::Malformed;
                push_error(&mut envelope.errors, TypedCollectionError::new(
                    source_name,
                    "malformedJson",
                    format!("Line {}: {e}", raw.line_offset),
                ));
                continue;
            }
        };

        if first_seq.is_none() && decoded.producer_sequence.is_some() {
            first_seq = decoded.producer_sequence;
        }

        let ts = decoded.timestamp_ms.unwrap_or(decoded.timestamp_epoch_ms);
        min_ts = Some(min_ts.map_or(ts, |m| m.min(ts)));
        max_ts = Some(max_ts.map_or(ts, |m| m.max(ts)));

        if ts >= window_start_ms && ts <= window_end_ms {
            match project_helper_audit(decoded) {
                Ok(proj) => projected_helper_audits.push(proj),
                Err(err_msg) => {
                    envelope.malformed_count += 1;
                    envelope.collection_status = CollectionStatus::Malformed;
                    push_error(&mut envelope.errors, TypedCollectionError::new(
                        source_name,
                        "projectionFailed",
                        format!("Line {}: {err_msg}", raw.line_offset),
                    ));
                }
            }
        }
    }

    envelope.record_count = projected_helper_audits.len();
    envelope.records = projected_helper_audits;

    if envelope.record_count == 0 && scan.byte_count == 0 {
        envelope.coverage.proven_start_ms = Some(window_start_ms);
        envelope.coverage.proven_end_ms = Some(window_end_ms);
    } else if let Some(min) = min_ts {
        if min <= window_start_ms || first_seq == Some(1) {
            envelope.coverage.proven_start_ms = Some(window_start_ms);
        } else {
            envelope.rotation_suspected = true;
            envelope.coverage.coverage_unknown =
                Some("earliestRecordNewerThanWindowStart".to_string());
        }
        envelope.coverage.proven_end_ms = Some(max_ts.unwrap_or(window_end_ms));
    } else {
        envelope.coverage.coverage_unknown = Some("noRecordsFound".to_string());
    }

    envelope
}

pub fn read_backend_diagnostics(
    path: &Path,
    window_start_ms: u64,
    window_end_ms: u64,
    required: bool,
) -> SourceEnvelope<Vec<ProjectedDiagnosticEvent>> {
    let source_name = "diagnosticEvents";
    let scan = scan_bounded_jsonl_file(source_name, path);
    let mut envelope = SourceEnvelope::empty(
        scan.status,
        Historicity::Historical,
        Applicability::Applicable,
        required,
        SourceCoverage::new(window_start_ms, window_end_ms),
    );

    envelope.byte_count = scan.byte_count;
    envelope.malformed_count = scan.malformed_count;
    envelope.retention_limited = scan.retention_limited;
    envelope.truncated = scan.truncated;
    envelope.errors = scan.errors;

    if scan.status == CollectionStatus::Missing
        || scan.status == CollectionStatus::PermissionDenied
        || scan.status == CollectionStatus::Unsupported
        || scan.status == CollectionStatus::IoError
    {
        envelope.coverage.coverage_unknown = Some(format!("Source status: {:?}", scan.status));
        return envelope;
    }

    let mut projected_events = Vec::new();
    let mut min_ts: Option<u64> = None;
    let mut max_ts: Option<u64> = None;

    for raw in scan.lines {
        let text = match std::str::from_utf8(&raw.raw_bytes) {
            Ok(s) => s,
            Err(_) => {
                envelope.malformed_count += 1;
                envelope.collection_status = CollectionStatus::Malformed;
                push_error(&mut envelope.errors, TypedCollectionError::new(
                    source_name,
                    "malformedUtf8",
                    format!("Line {} is not valid UTF-8", raw.line_offset),
                ));
                continue;
            }
        };

        let decoded: DiagnosticEvent = match serde_json::from_str(text) {
            Ok(d) => d,
            Err(e) => {
                envelope.malformed_count += 1;
                envelope.collection_status = CollectionStatus::Malformed;
                push_error(&mut envelope.errors, TypedCollectionError::new(
                    source_name,
                    "malformedJson",
                    format!("Line {}: {e}", raw.line_offset),
                ));
                continue;
            }
        };

        let ts = decoded.timestamp_ms;
        min_ts = Some(min_ts.map_or(ts, |m| m.min(ts)));
        max_ts = Some(max_ts.map_or(ts, |m| m.max(ts)));

        if ts >= window_start_ms && ts <= window_end_ms {
            if let Some(proj) = project_diagnostic_event(decoded) {
                projected_events.push(proj);
            }
        }
    }

    envelope.record_count = projected_events.len();
    envelope.records = projected_events;

    if envelope.record_count == 0 && scan.byte_count == 0 {
        envelope.coverage.proven_start_ms = Some(window_start_ms);
        envelope.coverage.proven_end_ms = Some(window_end_ms);
    } else if let Some(min) = min_ts {
        if min <= window_start_ms {
            envelope.coverage.proven_start_ms = Some(window_start_ms);
        } else {
            envelope.rotation_suspected = true;
            envelope.coverage.coverage_unknown =
                Some("earliestRecordNewerThanWindowStart".to_string());
        }
        envelope.coverage.proven_end_ms = Some(max_ts.unwrap_or(window_end_ms));
    } else {
        envelope.coverage.coverage_unknown = Some("noRecordsFound".to_string());
    }

    envelope
}
