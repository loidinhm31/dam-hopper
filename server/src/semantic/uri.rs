//! Virtual URI grammar, secure path mediation, and location filtering for the semantic gateway.
//!
//! Enforces:
//! - Canonical virtual URI grammar: `dam-hopper://semantic/<target-id>/<encoded-relative-path>`
//! - Single percent-decode, traversal/NUL/separator/drive rejection.
//! - Canonical target containment checking: no symlink escapes outside the target root.
//! - Translation between virtual URIs and child `file://` URIs.
//! - Non-disclosing `outsideTarget` result filtering: external/system libraries or sibling files
//!   are never echoed as host paths or file URIs.
//! - Strict range ordering and zero-based UTF-16 coordinate validation.

use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, CONTROLS};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::borrow::Cow;
use std::path::{Component, Path, PathBuf};
use thiserror::Error;
use url::Url;

use super::protocol::{Position, Range};
use crate::workspace_target::target_path_is_within;

/// Canonical URI scheme for DamHopper semantic resources.
pub const SEMANTIC_SCHEME: &str = "dam-hopper";

/// Canonical URI authority for DamHopper semantic resources.
pub const SEMANTIC_AUTHORITY: &str = "semantic";

/// Characters that must be percent-encoded in URI path segments.
/// Encodes control chars, spaces, quotes, hashes, queries, and path separators.
const PATH_SEGMENT_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'`')
    .add(b'{')
    .add(b'}')
    .add(b'/')
    .add(b'\\')
    .add(b'%');

#[derive(Debug, Error, PartialEq, Eq)]
pub enum UriMediationError {
    #[error("Invalid URI scheme: expected '{SEMANTIC_SCHEME}', got '{0}'")]
    InvalidScheme(String),

    #[error("Invalid URI authority: expected '{SEMANTIC_AUTHORITY}', got '{0}'")]
    InvalidAuthority(String),

    #[error("Target ID mismatch: expected '{expected}', got '{actual}'")]
    TargetIdMismatch { expected: String, actual: String },

    #[error("Invalid URI format: {0}")]
    InvalidUriFormat(String),

    #[error("URI contains null bytes")]
    NullByte,

    #[error("Path traversal detected in relative path")]
    TraversalDetected,

    #[error("Absolute, UNC, or drive paths are not permitted")]
    AbsoluteOrDrivePath,

    #[error("Empty relative path in URI")]
    EmptyRelativePath,

    #[error("Query and fragment components are forbidden in semantic URIs")]
    QueryOrFragmentForbidden,

    #[error("Path resolves outside the attached target root")]
    OutsideTarget,

    #[error("Invalid coordinate or range: {0}")]
    InvalidRange(String),

    #[error("Filesystem canonicalization error")]
    FsError,
}

/// Parsed and validated canonical virtual URI components.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedVirtualUri {
    pub target_id: String,
    pub relative_path: PathBuf,
}

/// Parse and validate a virtual document URI against the session's attached target ID.
///
/// Ensures single percent-decode, checks for null bytes, path traversal, drive specifiers,
/// and query/fragment tampering.
pub fn parse_virtual_uri(
    uri_str: &str,
    expected_target_id: &str,
) -> Result<ParsedVirtualUri, UriMediationError> {
    if uri_str.contains('?') || uri_str.contains('#') {
        return Err(UriMediationError::QueryOrFragmentForbidden);
    }

    if uri_str.contains('\0') {
        return Err(UriMediationError::NullByte);
    }

    let prefix = format!("{SEMANTIC_SCHEME}://{SEMANTIC_AUTHORITY}/");
    if !uri_str.starts_with(&prefix) {
        if let Ok(parsed) = Url::parse(uri_str) {
            if parsed.scheme() != SEMANTIC_SCHEME {
                return Err(UriMediationError::InvalidScheme(
                    parsed.scheme().to_string(),
                ));
            }
            if parsed.host_str() != Some(SEMANTIC_AUTHORITY) {
                return Err(UriMediationError::InvalidAuthority(
                    parsed.host_str().unwrap_or_default().to_string(),
                ));
            }
        }
        return Err(UriMediationError::InvalidUriFormat(
            "URI must start with dam-hopper://semantic/".into(),
        ));
    }

    let remainder = &uri_str[prefix.len()..];
    let (target_id, encoded_relative_path) = match remainder.split_once('/') {
        Some((tid, rel)) => (tid, rel),
        None => return Err(UriMediationError::EmptyRelativePath),
    };

    if target_id != expected_target_id {
        return Err(UriMediationError::TargetIdMismatch {
            expected: expected_target_id.to_string(),
            actual: target_id.to_string(),
        });
    }

    if encoded_relative_path.is_empty() {
        return Err(UriMediationError::EmptyRelativePath);
    }

    // Split on '/' before decode to prevent encoded separators (%2F, %5C) from crossing component boundaries
    let raw_segments: Vec<&str> = encoded_relative_path.split('/').collect();
    let mut relative_path = PathBuf::new();

    for segment in raw_segments {
        if segment.is_empty() {
            return Err(UriMediationError::EmptyRelativePath);
        }
        if segment == "." || segment == ".." {
            return Err(UriMediationError::TraversalDetected);
        }

        // Check for non-canonical percent-encoding of unreserved characters (e.g. %61 for 'a', %2e for '.')
        let bytes = segment.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' {
                if i + 2 >= bytes.len() {
                    return Err(UriMediationError::InvalidUriFormat(
                        "Truncated percent encoding".into(),
                    ));
                }
                let hex_bytes = [bytes[i + 1], bytes[i + 2]];
                let hex_str = std::str::from_utf8(&hex_bytes).map_err(|_| {
                    UriMediationError::InvalidUriFormat("Invalid percent hex".into())
                })?;
                let byte_val = u8::from_str_radix(hex_str, 16).map_err(|_| {
                    UriMediationError::InvalidUriFormat("Invalid percent hex".into())
                })?;

                // RFC 3986 unreserved characters must not be percent-encoded
                if byte_val.is_ascii_alphanumeric()
                    || byte_val == b'-'
                    || byte_val == b'.'
                    || byte_val == b'_'
                    || byte_val == b'~'
                {
                    return Err(UriMediationError::InvalidUriFormat(format!(
                        "Unreserved ASCII character '{}' must not be percent-encoded",
                        byte_val as char
                    )));
                }
                i += 3;
            } else {
                i += 1;
            }
        }

        // Single decode per segment
        let decoded = percent_decode_str(segment).decode_utf8().map_err(|_| {
            UriMediationError::InvalidUriFormat("Invalid UTF-8 percent encoding".into())
        })?;

        if decoded.contains('\0') {
            return Err(UriMediationError::NullByte);
        }
        if decoded.chars().any(|c| c.is_control()) {
            return Err(UriMediationError::InvalidUriFormat(
                "Control characters are forbidden in URI path".into(),
            ));
        }

        // Must not contain path separators or traversal components after decoding
        if decoded.contains('/') || decoded.contains('\\') || decoded == "." || decoded == ".." {
            return Err(UriMediationError::TraversalDetected);
        }

        let dec_bytes = decoded.as_bytes();
        if dec_bytes.len() >= 2 && dec_bytes[1] == b':' && dec_bytes[0].is_ascii_alphabetic() {
            return Err(UriMediationError::AbsoluteOrDrivePath);
        }
        relative_path.push(decoded.as_ref());
    }

    if relative_path.as_os_str().is_empty() {
        return Err(UriMediationError::EmptyRelativePath);
    }
    Ok(ParsedVirtualUri {
        target_id: target_id.to_string(),
        relative_path,
    })
}

/// Verify that `canonical_target_root` is an existing real directory (not replaced by a symlink).
fn verify_canonical_target_root(canonical_target_root: &Path) -> Result<(), UriMediationError> {
    let root_meta = std::fs::symlink_metadata(canonical_target_root)
        .map_err(|_| UriMediationError::OutsideTarget)?;
    if root_meta.file_type().is_symlink() || !root_meta.is_dir() {
        return Err(UriMediationError::OutsideTarget);
    }
    let resolved_root =
        dunce::canonicalize(canonical_target_root).map_err(|_| UriMediationError::OutsideTarget)?;
    if resolved_root != canonical_target_root {
        return Err(UriMediationError::OutsideTarget);
    }
    Ok(())
}

/// Convert a parsed virtual URI into an authorized canonical host path and child `file://` URI.
///
/// Ensures the path does not escape the canonical target root via live or dangling symlinks.
pub fn virtual_uri_to_file_uri(
    parsed: &ParsedVirtualUri,
    canonical_target_root: &Path,
) -> Result<(Url, PathBuf), UriMediationError> {
    verify_canonical_target_root(canonical_target_root)?;

    let candidate = canonical_target_root.join(&parsed.relative_path);

    // Lexical containment check first
    if !target_path_is_within(&candidate, canonical_target_root) {
        return Err(UriMediationError::OutsideTarget);
    }

    // Component-by-component symlink inspection (catches both live and dangling symlinks)
    let mut cur = canonical_target_root.to_path_buf();
    for comp in parsed.relative_path.components() {
        let Component::Normal(part) = comp else {
            return Err(UriMediationError::TraversalDetected);
        };
        cur.push(part);
        match std::fs::symlink_metadata(&cur) {
            Ok(meta) => {
                if meta.file_type().is_symlink() {
                    let resolved =
                        dunce::canonicalize(&cur).map_err(|_| UriMediationError::OutsideTarget)?;
                    if !target_path_is_within(&resolved, canonical_target_root) {
                        return Err(UriMediationError::OutsideTarget);
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // Non-existent suffix (e.g. unsaved new file in editor); verified nearest existing parent
            }
            Err(_) => return Err(UriMediationError::FsError),
        }
    }

    // Physical canonicalization and symlink escape verification
    let canonical_path = match std::fs::symlink_metadata(&candidate) {
        Ok(_) => dunce::canonicalize(&candidate).map_err(|_| UriMediationError::OutsideTarget)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let mut ancestor = candidate.as_path();
            while let Some(parent) = ancestor.parent() {
                if std::fs::symlink_metadata(parent).is_ok() {
                    let canonical_parent = dunce::canonicalize(parent)
                        .map_err(|_| UriMediationError::OutsideTarget)?;
                    if !target_path_is_within(&canonical_parent, canonical_target_root) {
                        return Err(UriMediationError::OutsideTarget);
                    }
                    break;
                }
                ancestor = parent;
            }
            candidate.clone()
        }
        Err(_) => return Err(UriMediationError::FsError),
    };

    if !target_path_is_within(&canonical_path, canonical_target_root) {
        return Err(UriMediationError::OutsideTarget);
    }

    let file_url = Url::from_file_path(&canonical_path)
        .map_err(|_| UriMediationError::InvalidUriFormat("Failed to build file URL".into()))?;

    Ok((file_url, canonical_path))
}

/// Translate a child `file://` URI into a client-safe virtual `dam-hopper://semantic/...` URI
/// and its canonical host path.
pub fn file_uri_to_virtual_uri_and_path(
    file_uri_str: &str,
    session_target_id: &str,
    canonical_target_root: &Path,
) -> Result<(String, String, PathBuf), UriMediationError> {
    verify_canonical_target_root(canonical_target_root)?;

    let url = Url::parse(file_uri_str)
        .map_err(|_| UriMediationError::InvalidUriFormat("Malformed file URL from child".into()))?;

    if url.scheme() != "file" {
        return Err(UriMediationError::InvalidUriFormat(
            "Expected file:// URL from child".into(),
        ));
    }

    let file_path = url
        .to_file_path()
        .map_err(|_| UriMediationError::InvalidUriFormat("Failed to parse file URL path".into()))?;

    // Child result files must exist (or be canonicalizable within target root; dangling symlinks fail closed)
    let canonical_path = match std::fs::symlink_metadata(&file_path) {
        Ok(_) => dunce::canonicalize(&file_path).map_err(|_| UriMediationError::OutsideTarget)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // Allow open unsaved in-target buffer whose parent directory is canonical inside target root
            if !target_path_is_within(&file_path, canonical_target_root) {
                return Err(UriMediationError::OutsideTarget);
            }
            let mut ancestor = file_path.as_path();
            let mut verified_parent = false;
            while let Some(parent) = ancestor.parent() {
                if std::fs::symlink_metadata(parent).is_ok() {
                    let canonical_parent = dunce::canonicalize(parent)
                        .map_err(|_| UriMediationError::OutsideTarget)?;
                    if !target_path_is_within(&canonical_parent, canonical_target_root) {
                        return Err(UriMediationError::OutsideTarget);
                    }
                    verified_parent = true;
                    break;
                }
                ancestor = parent;
            }
            if !verified_parent {
                return Err(UriMediationError::OutsideTarget);
            }
            file_path
        }
        Err(_) => return Err(UriMediationError::OutsideTarget),
    };

    if !target_path_is_within(&canonical_path, canonical_target_root) {
        return Err(UriMediationError::OutsideTarget);
    }

    let rel = canonical_path
        .strip_prefix(canonical_target_root)
        .map_err(|_| UriMediationError::OutsideTarget)?;

    let mut encoded_segments = Vec::new();
    for comp in rel.components() {
        if let Component::Normal(s) = comp {
            let str_val = s.to_string_lossy();
            let encoded = utf8_percent_encode(&str_val, PATH_SEGMENT_ENCODE_SET).to_string();
            encoded_segments.push(encoded);
        } else {
            return Err(UriMediationError::TraversalDetected);
        }
    }
    if encoded_segments.is_empty() {
        return Err(UriMediationError::EmptyRelativePath);
    }

    let normalized_file_uri = Url::from_file_path(&canonical_path)
        .map_err(|_| UriMediationError::InvalidUriFormat("Failed to build file URL".into()))?
        .to_string();
    let encoded_rel_path = encoded_segments.join("/");
    let virtual_uri =
        format!("{SEMANTIC_SCHEME}://{SEMANTIC_AUTHORITY}/{session_target_id}/{encoded_rel_path}");
    Ok((virtual_uri, normalized_file_uri, canonical_path))
}

/// Translate a child `file://` URI into a client-safe virtual `dam-hopper://semantic/...` URI.
///
/// If the resolved file path falls outside the canonical target root (e.g. external library,
/// package store, or sibling repository), returns `Err(UriMediationError::OutsideTarget)`.
/// This prevents any host paths or system directory disclosures to the client.
pub fn file_uri_to_virtual_uri(
    file_uri_str: &str,
    session_target_id: &str,
    canonical_target_root: &Path,
) -> Result<String, UriMediationError> {
    let (virtual_uri, _, _) =
        file_uri_to_virtual_uri_and_path(file_uri_str, session_target_id, canonical_target_root)?;
    Ok(virtual_uri)
}

/// Build a canonical virtual URI from relative path components and target ID.
pub fn build_virtual_uri(session_target_id: &str, relative_path: &Path) -> String {
    let mut encoded_segments = Vec::new();
    for comp in relative_path.components() {
        if let Component::Normal(s) = comp {
            let str_val = s.to_string_lossy();
            let encoded = utf8_percent_encode(&str_val, PATH_SEGMENT_ENCODE_SET).to_string();
            encoded_segments.push(encoded);
        }
    }
    let encoded_rel_path = encoded_segments.join("/");
    format!("{SEMANTIC_SCHEME}://{SEMANTIC_AUTHORITY}/{session_target_id}/{encoded_rel_path}")
}

/// Validate that a Range has valid, ordered zero-based coordinates.
pub fn validate_range(range: &Range) -> Result<(), UriMediationError> {
    // Coordinates must be finite and within reasonable LSP document limits (100 million lines/cols)
    if range.start.line > 100_000_000
        || range.start.character > 100_000_000
        || range.end.line > 100_000_000
        || range.end.character > 100_000_000
    {
        return Err(UriMediationError::InvalidRange(
            "Range coordinates exceed maximum allowed boundary".into(),
        ));
    }

    if range.start.line > range.end.line
        || (range.start.line == range.end.line && range.start.character > range.end.character)
    {
        return Err(UriMediationError::InvalidRange(format!(
            "Start position ({}:{}) is after end position ({}:{})",
            range.start.line, range.start.character, range.end.line, range.end.character
        )));
    }
    Ok(())
}

/// Compute the lowercase hex SHA-256 digest of a UTF-8 document text.
pub fn compute_text_sha256(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

/// Materialize and project disk file content for destination freshness pinning,
/// exactly matching the composed client TextDecoder + Monaco materialization pipeline.
pub fn project_disk_text_for_pin<'a>(disk_text: &'a str) -> Cow<'a, str> {
    // 1. Strip up to two leading BOMs from disk metadata:
    //    - 1st BOM: stripped by TextDecoder
    //    - 2nd BOM: stripped by Monaco PieceTreeTextBufferBuilder
    let mut current = disk_text;
    if let Some(stripped) = current.strip_prefix('\u{feff}') {
        current = stripped;
    }
    if let Some(stripped) = current.strip_prefix('\u{feff}') {
        current = stripped;
    }
    let without_bom = current;

    // 2. Project EOLs to canonical LF (\n)
    project_semantic_text(without_bom)
}

/// Project text to canonical LF EOLs while preserving all characters (including literal U+FEFF).
pub fn project_semantic_text<'a>(text: &'a str) -> Cow<'a, str> {
    if !text.contains('\r') {
        return Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
            out.push('\n');
        } else {
            out.push(ch);
        }
    }
    Cow::Owned(out)
}

/// Validate that a zero-based UTF-16 `Range` falls within the actual lines and
/// UTF-16 column boundaries of `text`.
pub fn validate_range_in_text(range: &Range, text: &str) -> Result<(), UriMediationError> {
    validate_range(range)?;

    let check_pos = |pos: Position| -> Result<(), UriMediationError> {
        let mut total_lines = 0u32;
        for span in crate::semantic::overlay::lossless_line_spans(text) {
            total_lines = span.line_number.saturating_add(1);
            if span.line_number == pos.line {
                let utf16_len = span.content.encode_utf16().count() as u32;
                if pos.character <= utf16_len {
                    return Ok(());
                } else {
                    return Err(UriMediationError::InvalidRange(format!(
                        "Position ({}:{}) character exceeds line UTF-16 length {}",
                        pos.line, pos.character, utf16_len
                    )));
                }
            }
        }
        Err(UriMediationError::InvalidRange(format!(
            "Position ({}:{}) line exceeds document line count {}",
            pos.line, pos.character, total_lines
        )))
    };

    check_pos(range.start)?;
    check_pos(range.end)?;
    Ok(())
}

/// Proven destination content association for G5 freshness validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DestinationProvenance {
    pub content_sha256: String,
    pub version: Option<i64>,
    pub open_incarnation: Option<u64>,
    pub text: String,
}

/// Unwrap a child JSON-RPC response envelope `{"jsonrpc":"2.0","id":...,"result":...}`
/// if present, or return `raw` directly if already unwrapped.
/// Returns `Err` if the child response is a JSON-RPC `"error"` envelope.
pub fn unwrap_lsp_result_payload(raw: &Value) -> Result<&Value, UriMediationError> {
    if let Some(obj) = raw.as_object() {
        if obj.contains_key("jsonrpc") || obj.contains_key("id") {
            if obj.get("error").is_some() {
                return Err(UriMediationError::InvalidUriFormat(
                    "Child returned JSON-RPC error response".into(),
                ));
            }
            if let Some(res) = obj.get("result") {
                return Ok(res);
            }
        }
    }
    Ok(raw)
}

/// Extract deduplicated `(normalized_file_uri, canonical_path)` pairs for all valid
/// in-target destination locations present in `raw_result`.
pub fn extract_in_target_destination_uris(
    raw_result: &Value,
    session_target_id: &str,
    canonical_target_root: &Path,
) -> Vec<(String, PathBuf)> {
    let Ok(payload) = unwrap_lsp_result_payload(raw_result) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut inspect_item = |item: &Value| {
        let Some(obj) = item.as_object() else {
            return;
        };
        let uri_opt = obj
            .get("uri")
            .and_then(|v| v.as_str())
            .or_else(|| obj.get("targetUri").and_then(|v| v.as_str()));
        if let Some(uri_str) = uri_opt {
            if let Ok((_, normalized_file_uri, canonical_path)) =
                file_uri_to_virtual_uri_and_path(uri_str, session_target_id, canonical_target_root)
            {
                if !out.iter().any(|(u, _)| u == &normalized_file_uri) {
                    out.push((normalized_file_uri, canonical_path));
                }
            }
        }
    };

    match payload {
        Value::Array(items) => {
            for item in items {
                inspect_item(item);
            }
        }
        Value::Object(_) => inspect_item(payload),
        _ => {}
    }
    out
}

/// Filter raw child JSON-RPC `Location` or `LocationLink` result with G5 proven destination
/// content association (`damHopperDestinationContentSha256`, `damHopperDestinationVersion`,
/// `damHopperDestinationIncarnation`) and exact UTF-16 range-in-text validation.
pub fn filter_location_or_link_result_with_provenance(
    raw_result: &Value,
    session_target_id: &str,
    canonical_target_root: &Path,
    provenance_map: &HashMap<String, DestinationProvenance>,
    source_text: Option<&str>,
) -> Result<Value, UriMediationError> {
    let payload = unwrap_lsp_result_payload(raw_result)?;
    match payload {
        Value::Null => Ok(Value::Null),
        Value::Array(items) => {
            if items.is_empty() {
                return Ok(Value::Array(Vec::new()));
            }
            let mut filtered = Vec::new();
            let mut had_outside = false;
            for item in items {
                match filter_single_location_or_link_with_provenance(
                    item,
                    session_target_id,
                    canonical_target_root,
                    provenance_map,
                    source_text,
                ) {
                    Ok(Some(sanitized)) => filtered.push(sanitized),
                    Ok(None) | Err(UriMediationError::OutsideTarget) => had_outside = true,
                    Err(_) => {}
                }
            }
            if filtered.is_empty() && had_outside {
                Ok(json!({ "outsideTarget": true }))
            } else {
                Ok(Value::Array(filtered))
            }
        }
        Value::Object(_) => {
            match filter_single_location_or_link_with_provenance(
                payload,
                session_target_id,
                canonical_target_root,
                provenance_map,
                source_text,
            ) {
                Ok(Some(sanitized)) => Ok(sanitized),
                Ok(None) | Err(UriMediationError::OutsideTarget) => {
                    Ok(json!({ "outsideTarget": true }))
                }
                Err(_) => Ok(Value::Null),
            }
        }
        _ => Ok(Value::Null),
    }
}

fn filter_single_location_or_link_with_provenance(
    item: &Value,
    session_target_id: &str,
    canonical_target_root: &Path,
    provenance_map: &HashMap<String, DestinationProvenance>,
    source_text: Option<&str>,
) -> Result<Option<Value>, UriMediationError> {
    let obj = match item.as_object() {
        Some(o) => o,
        None => return Ok(None),
    };

    // Case 1: Standard Location { uri, range }
    if let (Some(uri_val), Some(range_val)) = (obj.get("uri"), obj.get("range")) {
        let uri_str = match uri_val.as_str() {
            Some(s) => s,
            None => return Ok(None),
        };

        let (virtual_uri, normalized_file_uri, _) = match file_uri_to_virtual_uri_and_path(
            uri_str,
            session_target_id,
            canonical_target_root,
        ) {
            Ok(v) => v,
            Err(UriMediationError::OutsideTarget) => return Ok(None),
            Err(e) => return Err(e),
        };

        let prov = provenance_map.get(&normalized_file_uri).ok_or_else(|| {
            UriMediationError::InvalidRange("Missing G5 destination provenance".into())
        })?;

        let range: Range = serde_json::from_value(range_val.clone())
            .map_err(|e| UriMediationError::InvalidRange(e.to_string()))?;
        validate_range_in_text(&range, &prov.text)?;

        return Ok(Some(json!({
            "uri": virtual_uri,
            "range": range,
            "damHopperDestinationContentSha256": prov.content_sha256,
            "damHopperDestinationVersion": prov.version,
            "damHopperDestinationIncarnation": prov.open_incarnation,
        })));
    }

    // Case 2: LocationLink { targetUri, targetRange, targetSelectionRange, originSelectionRange? }
    if let (Some(target_uri_val), Some(target_range_val), Some(target_selection_range_val)) = (
        obj.get("targetUri"),
        obj.get("targetRange"),
        obj.get("targetSelectionRange"),
    ) {
        let target_uri_str = match target_uri_val.as_str() {
            Some(s) => s,
            None => return Ok(None),
        };

        let (virtual_target_uri, normalized_file_uri, _) = match file_uri_to_virtual_uri_and_path(
            target_uri_str,
            session_target_id,
            canonical_target_root,
        ) {
            Ok(v) => v,
            Err(UriMediationError::OutsideTarget) => return Ok(None),
            Err(e) => return Err(e),
        };

        let prov = provenance_map.get(&normalized_file_uri).ok_or_else(|| {
            UriMediationError::InvalidRange("Missing G5 destination provenance".into())
        })?;

        let target_range: Range = serde_json::from_value(target_range_val.clone())
            .map_err(|e| UriMediationError::InvalidRange(e.to_string()))?;
        validate_range_in_text(&target_range, &prov.text)?;

        let target_selection_range: Range =
            serde_json::from_value(target_selection_range_val.clone())
                .map_err(|e| UriMediationError::InvalidRange(e.to_string()))?;
        validate_range_in_text(&target_selection_range, &prov.text)?;

        let mut out = json!({
            "targetUri": virtual_target_uri,
            "targetRange": target_range,
            "targetSelectionRange": target_selection_range,
            "damHopperDestinationContentSha256": prov.content_sha256,
            "damHopperDestinationVersion": prov.version,
            "damHopperDestinationIncarnation": prov.open_incarnation,
        });

        if let Some(origin_val) = obj.get("originSelectionRange") {
            let origin_range: Range = serde_json::from_value(origin_val.clone())
                .map_err(|e| UriMediationError::InvalidRange(e.to_string()))?;
            if let Some(src_txt) = source_text {
                validate_range_in_text(&origin_range, src_txt)?;
            } else {
                validate_range(&origin_range)?;
            }
            out.as_object_mut()
                .unwrap()
                .insert("originSelectionRange".into(), json!(origin_range));
        }

        return Ok(Some(out));
    }

    Ok(None)
}

/// Filter raw child JSON-RPC `Location` or `LocationLink` result.
///
/// Translates child `file://` URIs to virtual `dam-hopper://semantic/...` URIs.
/// Drops and filters out external or outside-target paths, stripping unknown metadata.
pub fn filter_location_or_link_result(
    raw_result: &Value,
    session_target_id: &str,
    canonical_target_root: &Path,
) -> Result<Value, UriMediationError> {
    let payload = unwrap_lsp_result_payload(raw_result)?;
    match payload {
        Value::Null => Ok(Value::Null),
        Value::Array(items) => {
            if items.is_empty() {
                return Ok(Value::Array(Vec::new()));
            }
            let mut filtered = Vec::new();
            let mut had_outside = false;
            for item in items {
                match filter_single_location_or_link(item, session_target_id, canonical_target_root)
                {
                    Ok(Some(sanitized)) => filtered.push(sanitized),
                    Ok(None) => had_outside = true,
                    Err(UriMediationError::OutsideTarget) => had_outside = true,
                    Err(_) => {} // Skip malformed item without dropping other valid results
                }
            }
            if filtered.is_empty() && had_outside {
                Ok(json!({ "outsideTarget": true }))
            } else {
                Ok(Value::Array(filtered))
            }
        }
        Value::Object(_) => {
            match filter_single_location_or_link(payload, session_target_id, canonical_target_root)
            {
                Ok(Some(sanitized)) => Ok(sanitized),
                Ok(None) | Err(UriMediationError::OutsideTarget) => {
                    Ok(json!({ "outsideTarget": true }))
                }
                Err(_) => Ok(Value::Null),
            }
        }
        _ => Ok(Value::Null),
    }
}

/// Filter a single Location or LocationLink object.
fn filter_single_location_or_link(
    item: &Value,
    session_target_id: &str,
    canonical_target_root: &Path,
) -> Result<Option<Value>, UriMediationError> {
    let obj = match item.as_object() {
        Some(o) => o,
        None => return Ok(None),
    };

    // Case 1: Standard Location { uri, range }
    if let (Some(uri_val), Some(range_val)) = (obj.get("uri"), obj.get("range")) {
        let uri_str = match uri_val.as_str() {
            Some(s) => s,
            None => return Ok(None),
        };

        let virtual_uri =
            match file_uri_to_virtual_uri(uri_str, session_target_id, canonical_target_root) {
                Ok(v) => v,
                Err(UriMediationError::OutsideTarget) => return Ok(None),
                Err(e) => return Err(e),
            };

        let range: Range = serde_json::from_value(range_val.clone())
            .map_err(|e| UriMediationError::InvalidRange(e.to_string()))?;
        validate_range(&range)?;

        return Ok(Some(json!({
            "uri": virtual_uri,
            "range": range,
        })));
    }

    // Case 2: LocationLink { targetUri, targetRange, targetSelectionRange, originSelectionRange? }
    if let (Some(target_uri_val), Some(target_range_val), Some(target_selection_range_val)) = (
        obj.get("targetUri"),
        obj.get("targetRange"),
        obj.get("targetSelectionRange"),
    ) {
        let target_uri_str = match target_uri_val.as_str() {
            Some(s) => s,
            None => return Ok(None),
        };

        let virtual_target_uri =
            match file_uri_to_virtual_uri(target_uri_str, session_target_id, canonical_target_root)
            {
                Ok(v) => v,
                Err(UriMediationError::OutsideTarget) => return Ok(None),
                Err(e) => return Err(e),
            };

        let target_range: Range = serde_json::from_value(target_range_val.clone())
            .map_err(|e| UriMediationError::InvalidRange(e.to_string()))?;
        validate_range(&target_range)?;

        let target_selection_range: Range =
            serde_json::from_value(target_selection_range_val.clone())
                .map_err(|e| UriMediationError::InvalidRange(e.to_string()))?;
        validate_range(&target_selection_range)?;

        let mut out = json!({
            "targetUri": virtual_target_uri,
            "targetRange": target_range,
            "targetSelectionRange": target_selection_range,
        });

        if let Some(origin_val) = obj.get("originSelectionRange") {
            let origin_range: Range = serde_json::from_value(origin_val.clone())
                .map_err(|e| UriMediationError::InvalidRange(e.to_string()))?;
            validate_range(&origin_range)?;
            out.as_object_mut()
                .unwrap()
                .insert("originSelectionRange".into(), json!(origin_range));
        }

        return Ok(Some(out));
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic::protocol::Position;
    use tempfile::tempdir;

    #[test]
    fn test_parse_valid_virtual_uri() {
        let uri = "dam-hopper://semantic/target-1/src/index.ts";
        let parsed = parse_virtual_uri(uri, "target-1").unwrap();
        assert_eq!(parsed.target_id, "target-1");
        assert_eq!(parsed.relative_path, PathBuf::from("src/index.ts"));
    }

    #[test]
    fn test_parse_encoded_spaces_and_special_chars() {
        let uri = "dam-hopper://semantic/target-1/src/my%20cool%20file.ts";
        let parsed = parse_virtual_uri(uri, "target-1").unwrap();
        assert_eq!(parsed.relative_path, PathBuf::from("src/my cool file.ts"));
    }

    #[test]
    fn test_reject_target_id_mismatch() {
        let uri = "dam-hopper://semantic/target-other/src/index.ts";
        let err = parse_virtual_uri(uri, "target-1").unwrap_err();
        assert!(matches!(err, UriMediationError::TargetIdMismatch { .. }));
    }

    #[test]
    fn test_reject_traversal_dot_dot() {
        let err1 = parse_virtual_uri("dam-hopper://semantic/t1/../etc/passwd", "t1").unwrap_err();
        assert_eq!(err1, UriMediationError::TraversalDetected);

        let err2 =
            parse_virtual_uri("dam-hopper://semantic/t1/src/%2e%2e/secret.ts", "t1").unwrap_err();
        assert!(matches!(
            err2,
            UriMediationError::TraversalDetected | UriMediationError::InvalidUriFormat(_)
        ));
    }
    #[test]
    fn test_reject_encoded_separators() {
        let err1 = parse_virtual_uri("dam-hopper://semantic/t1/a%2Fb.ts", "t1").unwrap_err();
        assert_eq!(err1, UriMediationError::TraversalDetected);

        let err2 = parse_virtual_uri("dam-hopper://semantic/t1/a%5Cb.ts", "t1").unwrap_err();
        assert_eq!(err2, UriMediationError::TraversalDetected);
    }

    #[test]
    fn test_reject_non_canonical_and_aliasing_encodings() {
        // Alternative hex encoding of standard ASCII char
        let err1 = parse_virtual_uri("dam-hopper://semantic/t1/%61/b.ts", "t1").unwrap_err();
        assert!(matches!(err1, UriMediationError::InvalidUriFormat(_)));

        // Double slashes
        let err2 = parse_virtual_uri("dam-hopper://semantic/t1/a//b.ts", "t1").unwrap_err();
        assert_eq!(err2, UriMediationError::EmptyRelativePath);

        // CurDir component
        let err3 = parse_virtual_uri("dam-hopper://semantic/t1/a/./b.ts", "t1").unwrap_err();
        assert_eq!(err3, UriMediationError::TraversalDetected);

        // Trailing slash
        let err4 = parse_virtual_uri("dam-hopper://semantic/t1/a/b.ts/", "t1").unwrap_err();
        assert_eq!(err4, UriMediationError::EmptyRelativePath);
    }
    #[test]
    fn test_parse_complex_valid_names() {
        // Encoded bracket name from browser encodeURIComponent
        let p1 = parse_virtual_uri("dam-hopper://semantic/t1/%5Bid%5D.tsx", "t1").unwrap();
        assert_eq!(p1.relative_path, PathBuf::from("[id].tsx"));

        // Raw bracket name
        let p2 = parse_virtual_uri("dam-hopper://semantic/t1/[id].tsx", "t1").unwrap();
        assert_eq!(p2.relative_path, PathBuf::from("[id].tsx"));

        // Scoped @types
        let p3 = parse_virtual_uri("dam-hopper://semantic/t1/@types/node.d.ts", "t1").unwrap();
        assert_eq!(p3.relative_path, PathBuf::from("@types/node.d.ts"));

        // Plus sign
        let p4 = parse_virtual_uri("dam-hopper://semantic/t1/a+b.ts", "t1").unwrap();
        assert_eq!(p4.relative_path, PathBuf::from("a+b.ts"));
    }

    #[test]
    fn test_reject_null_bytes() {
        let err1 = parse_virtual_uri("dam-hopper://semantic/t1/src/file\0.ts", "t1").unwrap_err();
        assert_eq!(err1, UriMediationError::NullByte);

        let err2 = parse_virtual_uri("dam-hopper://semantic/t1/src/file%00.ts", "t1").unwrap_err();
        assert_eq!(err2, UriMediationError::NullByte);
    }

    #[test]
    fn test_reject_query_and_fragment() {
        let err1 = parse_virtual_uri("dam-hopper://semantic/t1/src/file.ts?v=1", "t1").unwrap_err();
        assert_eq!(err1, UriMediationError::QueryOrFragmentForbidden);

        let err2 = parse_virtual_uri("dam-hopper://semantic/t1/src/file.ts#L10", "t1").unwrap_err();
        assert_eq!(err2, UriMediationError::QueryOrFragmentForbidden);
    }

    #[test]
    fn test_reject_absolute_or_drive_paths() {
        let err1 = parse_virtual_uri("dam-hopper://semantic/t1//etc/passwd", "t1").unwrap_err();
        assert!(matches!(
            err1,
            UriMediationError::EmptyRelativePath | UriMediationError::AbsoluteOrDrivePath
        ));
        let err2 =
            parse_virtual_uri("dam-hopper://semantic/t1/C:/Windows/win.ini", "t1").unwrap_err();
        assert_eq!(err2, UriMediationError::AbsoluteOrDrivePath);
    }

    #[test]
    fn test_reject_wrong_scheme_and_authority() {
        let err1 = parse_virtual_uri("file:///target-1/src/index.ts", "target-1").unwrap_err();
        assert!(matches!(err1, UriMediationError::InvalidScheme(_)));

        let err2 = parse_virtual_uri(
            "dam-hopper://wrong-authority/target-1/src/index.ts",
            "target-1",
        )
        .unwrap_err();
        assert!(matches!(err2, UriMediationError::InvalidAuthority(_)));
    }

    #[test]
    fn test_file_uri_translation_containment() {
        let temp = tempdir().unwrap();
        let canonical_root = dunce::canonicalize(temp.path()).unwrap();

        let in_file = canonical_root.join("src").join("index.ts");
        std::fs::create_dir_all(in_file.parent().unwrap()).unwrap();
        std::fs::write(&in_file, "console.log(1);").unwrap();

        let file_url = Url::from_file_path(&in_file).unwrap();
        let virt = file_uri_to_virtual_uri(file_url.as_str(), "target-1", &canonical_root).unwrap();
        assert_eq!(virt, "dam-hopper://semantic/target-1/src/index.ts");

        // Outside target file (e.g. /etc/hosts or tempdir2)
        let temp2 = tempdir().unwrap();
        let out_file = temp2.path().join("external.ts");
        std::fs::write(&out_file, "export const x = 1;").unwrap();
        let out_file_url = Url::from_file_path(&out_file).unwrap();

        let err = file_uri_to_virtual_uri(out_file_url.as_str(), "target-1", &canonical_root)
            .unwrap_err();
        assert_eq!(err, UriMediationError::OutsideTarget);
    }

    #[test]
    fn test_filter_location_and_location_link() {
        let temp = tempdir().unwrap();
        let canonical_root = dunce::canonicalize(temp.path()).unwrap();

        let in_file = canonical_root.join("src").join("mod.ts");
        std::fs::create_dir_all(in_file.parent().unwrap()).unwrap();
        std::fs::write(&in_file, "export const foo = 42;").unwrap();
        let in_url = Url::from_file_path(&in_file).unwrap().to_string();

        let temp3 = tempdir().unwrap();
        let out_file = temp3.path().join("lib.d.ts");
        std::fs::write(&out_file, "declare var foo: number;").unwrap();
        let out_url = Url::from_file_path(&out_file).unwrap().to_string();

        // Array with 1 in-target and 1 outside-target Location
        let raw_locations = json!([
            {
                "uri": in_url,
                "range": { "start": { "line": 0, "character": 0 }, "end": { "line": 0, "character": 5 } },
                "unknownField": "secret-path"
            },
            {
                "uri": out_url,
                "range": { "start": { "line": 1, "character": 0 }, "end": { "line": 1, "character": 10 } }
            }
        ]);

        let filtered =
            filter_location_or_link_result(&raw_locations, "target-1", &canonical_root).unwrap();
        let arr = filtered.as_array().unwrap();
        assert_eq!(arr.len(), 1, "Outside target location must be omitted");
        assert_eq!(arr[0]["uri"], "dam-hopper://semantic/target-1/src/mod.ts");
        assert!(
            arr[0].get("unknownField").is_none(),
            "Metadata must be stripped"
        );
    }

    #[test]
    fn test_range_validation_rejection() {
        let invalid_range = Range {
            start: Position {
                line: 5,
                character: 10,
            },
            end: Position {
                line: 2,
                character: 0,
            },
        };
        let err = validate_range(&invalid_range).unwrap_err();
        assert!(matches!(err, UriMediationError::InvalidRange(_)));
    }

    #[test]
    #[cfg(unix)]
    fn test_reject_dangling_and_outside_symlinks() {
        let temp = tempdir().unwrap();
        let canonical_root = dunce::canonicalize(temp.path()).unwrap();
        let outside = tempdir().unwrap();
        let outside_file = outside.path().join("secret.ts");
        std::fs::write(&outside_file, "export const secret = 1;\n").unwrap();

        // 1. Live symlink pointing outside target root
        let live_link = canonical_root.join("escape.ts");
        std::os::unix::fs::symlink(&outside_file, &live_link).unwrap();
        let parsed_live = parse_virtual_uri("dam-hopper://semantic/t1/escape.ts", "t1").unwrap();
        assert_eq!(
            virtual_uri_to_file_uri(&parsed_live, &canonical_root).unwrap_err(),
            UriMediationError::OutsideTarget
        );

        // 2. Dangling symlink pointing to non-existent outside path
        let dangling_link = canonical_root.join("dangling.ts");
        std::os::unix::fs::symlink(outside.path().join("nonexistent.ts"), &dangling_link).unwrap();
        let parsed_dangling =
            parse_virtual_uri("dam-hopper://semantic/t1/dangling.ts", "t1").unwrap();
        assert_eq!(
            virtual_uri_to_file_uri(&parsed_dangling, &canonical_root).unwrap_err(),
            UriMediationError::OutsideTarget
        );

        // 3. Intermediate directory symlink pointing outside
        let dir_link = canonical_root.join("linked_dir");
        std::os::unix::fs::symlink(outside.path(), &dir_link).unwrap();
        let parsed_dir_escape =
            parse_virtual_uri("dam-hopper://semantic/t1/linked_dir/new_file.ts", "t1").unwrap();
        assert_eq!(
            virtual_uri_to_file_uri(&parsed_dir_escape, &canonical_root).unwrap_err(),
            UriMediationError::OutsideTarget
        );
    }

    #[test]
    fn test_validate_range_in_text_and_provenance_filtering() {
        let text = "/* 🚀 */ export const value = 42;\nconst next = value;\n";
        // Line 0 has '🚀' (2 UTF-16 code units), total UTF-16 length = 33
        let valid_range = Range {
            start: Position {
                line: 0,
                character: 22,
            },
            end: Position {
                line: 0,
                character: 27,
            },
        };
        assert!(validate_range_in_text(&valid_range, text).is_ok());

        // Out-of-bounds character on line 0
        let bad_char_range = Range {
            start: Position {
                line: 0,
                character: 30,
            },
            end: Position {
                line: 0,
                character: 50,
            },
        };
        assert!(validate_range_in_text(&bad_char_range, text).is_err());

        // Out-of-bounds line
        let bad_line_range = Range {
            start: Position {
                line: 5,
                character: 0,
            },
            end: Position {
                line: 5,
                character: 1,
            },
        };
        assert!(validate_range_in_text(&bad_line_range, text).is_err());

        // Lone CR text range validation
        let cr_text = "line0\rline1\rline2";
        let cr_valid_range = Range {
            start: Position { line: 1, character: 0 },
            end: Position { line: 1, character: 5 },
        };
        assert!(validate_range_in_text(&cr_valid_range, cr_text).is_ok());

        let cr_oob_char = Range {
            start: Position { line: 1, character: 0 },
            end: Position { line: 1, character: 6 },
        };
        assert!(validate_range_in_text(&cr_oob_char, cr_text).is_err());

        let cr_oob_line = Range {
            start: Position { line: 3, character: 0 },
            end: Position { line: 3, character: 0 },
        };
        assert!(validate_range_in_text(&cr_oob_line, cr_text).is_err());

        let temp = tempdir().unwrap();
        let canonical_root = dunce::canonicalize(temp.path()).unwrap();
        let file_path = canonical_root.join("src").join("dest.ts");
        std::fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        std::fs::write(&file_path, text).unwrap();
        let file_url = Url::from_file_path(&file_path).unwrap().to_string();
        let sha = compute_text_sha256(text);

        let mut prov_map = HashMap::new();
        prov_map.insert(
            file_url.clone(),
            DestinationProvenance {
                content_sha256: sha.clone(),
                version: Some(3),
                open_incarnation: Some(1),
                text: text.to_string(),
            },
        );

        let raw = json!([{
            "uri": file_url,
            "range": {
                "start": { "line": 0, "character": 22 },
                "end": { "line": 0, "character": 27 }
            }
        }]);
        let filtered = filter_location_or_link_result_with_provenance(
            &raw,
            "target-1",
            &canonical_root,
            &prov_map,
            Some(text),
        )
        .unwrap();
        let arr = filtered.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["damHopperDestinationContentSha256"], sha);
        assert_eq!(arr[0]["damHopperDestinationVersion"], 3);
        assert_eq!(arr[0]["damHopperDestinationIncarnation"], 1);
    }
    #[test]
    fn test_project_disk_text_for_pin_boms_and_eols() {
        // 0 BOM
        assert_eq!(project_disk_text_for_pin("const x = 1;\n"), "const x = 1;\n");

        // 1 BOM stripped
        assert_eq!(project_disk_text_for_pin("\u{feff}const x = 1;\n"), "const x = 1;\n");

        // 2 BOMs stripped (double-stripping named STOP/GO outcome)
        assert_eq!(project_disk_text_for_pin("\u{feff}\u{feff}const x = 1;\n"), "const x = 1;\n");

        // Literal editor U+FEFF inside the file is preserved
        assert_eq!(
            project_disk_text_for_pin("const x = '\u{feff}';\n"),
            "const x = '\u{feff}';\n"
        );

        // CRLF normalized to LF
        assert_eq!(
            project_disk_text_for_pin("line1\r\nline2\r\n"),
            "line1\nline2\n"
        );

        // Lone CR normalized to LF
        assert_eq!(
            project_disk_text_for_pin("line1\rline2\r"),
            "line1\nline2\n"
        );

        // Mixed EOL normalized to LF
        assert_eq!(
            project_disk_text_for_pin("line1\r\nline2\nline3\rline4"),
            "line1\nline2\nline3\nline4"
        );

        // 1 BOM + CRLF
        assert_eq!(
            project_disk_text_for_pin("\u{feff}line1\r\nline2\r\n"),
            "line1\nline2\n"
        );
    }
}
