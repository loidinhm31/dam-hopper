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
use std::path::{Component, Path, PathBuf};
use thiserror::Error;
use url::Url;

use super::protocol::Range;
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

        // Must not contain path separators or traversal components after decoding
        if decoded.contains('/') || decoded.contains('\\') || decoded == "." || decoded == ".." {
            return Err(UriMediationError::TraversalDetected);
        }

        let dec_bytes = decoded.as_bytes();
        if dec_bytes.len() == 2 && dec_bytes[1] == b':' && dec_bytes[0].is_ascii_alphabetic() {
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

/// Convert a parsed virtual URI into an authorized canonical host path and child `file://` URI.
///
/// Ensures the path does not escape the canonical target root via symlinks.
pub fn virtual_uri_to_file_uri(
    parsed: &ParsedVirtualUri,
    canonical_target_root: &Path,
) -> Result<(Url, PathBuf), UriMediationError> {
    let candidate = canonical_target_root.join(&parsed.relative_path);

    // Lexical containment check first
    if !target_path_is_within(&candidate, canonical_target_root) {
        return Err(UriMediationError::OutsideTarget);
    }

    // Physical canonicalization and symlink escape verification
    let canonical_path = if candidate.exists() {
        dunce::canonicalize(&candidate).map_err(|_| UriMediationError::FsError)?
    } else {
        // If file doesn't exist yet (e.g. newly created file opened in editor),
        // check that the nearest existing parent directory resolves within target root.
        let mut ancestor = candidate.as_path();
        while let Some(parent) = ancestor.parent() {
            if parent.exists() {
                let canonical_parent =
                    dunce::canonicalize(parent).map_err(|_| UriMediationError::FsError)?;
                if !target_path_is_within(&canonical_parent, canonical_target_root) {
                    return Err(UriMediationError::OutsideTarget);
                }
                break;
            }
            ancestor = parent;
        }
        candidate.clone()
    };

    if !target_path_is_within(&canonical_path, canonical_target_root) {
        return Err(UriMediationError::OutsideTarget);
    }

    let file_url = Url::from_file_path(&canonical_path)
        .map_err(|_| UriMediationError::InvalidUriFormat("Failed to build file URL".into()))?;

    Ok((file_url, canonical_path))
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

    let canonical_path = if file_path.exists() {
        dunce::canonicalize(&file_path).map_err(|_| UriMediationError::FsError)?
    } else {
        file_path.clone()
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

    let encoded_rel_path = encoded_segments.join("/");
    Ok(format!(
        "{SEMANTIC_SCHEME}://{SEMANTIC_AUTHORITY}/{session_target_id}/{encoded_rel_path}"
    ))
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

/// Filter raw child JSON-RPC `Location` or `LocationLink` result.
///
/// Translates child `file://` URIs to virtual `dam-hopper://semantic/...` URIs.
/// Drops and filters out external or outside-target paths, stripping unknown metadata.
pub fn filter_location_or_link_result(
    raw_result: &Value,
    session_target_id: &str,
    canonical_target_root: &Path,
) -> Result<Value, UriMediationError> {
    match raw_result {
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
            match filter_single_location_or_link(
                raw_result,
                session_target_id,
                canonical_target_root,
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
}
