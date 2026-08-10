use axum::{
    body::Body,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::Response,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::fs::{VideoFileVersion, VideoTicketPurpose, VideoTicketRecord};

use super::http_byte_range::ByteRange;

pub(super) fn if_range_matches(headers: &HeaderMap, file: &VideoFileVersion) -> bool {
    let values: Vec<_> = headers.get_all(header::IF_RANGE).iter().collect();
    let Some(value) = (values.len() == 1)
        .then(|| values[0].to_str().ok())
        .flatten()
    else {
        return values.is_empty();
    };
    value == format!("\"{}\"", file.validator)
        || httpdate::parse_http_date(value).is_ok_and(|date| last_modified_time(file) <= date)
}

pub(super) fn response_with_body(
    status: StatusCode,
    record: &VideoTicketRecord,
    range: Option<ByteRange>,
    body: Body,
) -> Option<Response> {
    let length = match range {
        Some(range) => range.len()?,
        None => record.file.size,
    };
    let mut response = Response::new(body);
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(
        header::CONTENT_TYPE,
        header_value(&record.mime, "application/octet-stream"),
    );
    headers.insert(header::CONTENT_LENGTH, number_header(length));
    headers.insert(header::ETAG, etag(&record.file));
    headers.insert(header::LAST_MODIFIED, last_modified(&record.file));
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        disposition(record.purpose, &record.filename),
    );
    if let Some(range) = range {
        headers.insert(
            header::CONTENT_RANGE,
            header_value(
                &format!("bytes {}-{}/{}", range.start, range.end, record.file.size),
                "bytes */0",
            ),
        );
    }
    Some(response)
}

pub(super) fn range_not_satisfiable(record: &VideoTicketRecord) -> Response {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::RANGE_NOT_SATISFIABLE;
    let headers = response.headers_mut();
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from_static("0"));
    headers.insert(
        header::CONTENT_RANGE,
        header_value(&format!("bytes */{}", record.file.size), "bytes */0"),
    );
    headers.insert(header::ETAG, etag(&record.file));
    headers.insert(header::LAST_MODIFIED, last_modified(&record.file));
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    response
}

fn etag(file: &VideoFileVersion) -> HeaderValue {
    header_value(&format!("\"{}\"", file.validator), "\"invalid\"")
}

fn last_modified(file: &VideoFileVersion) -> HeaderValue {
    header_value(
        &httpdate::fmt_http_date(last_modified_time(file)),
        "Thu, 01 Jan 1970 00:00:00 GMT",
    )
}

/// HTTP dates have whole-second precision and `httpdate` only formats 1970–9999.
/// Clamp the stored mtime to that wire domain so emitted validators round-trip safely.
fn last_modified_time(file: &VideoFileVersion) -> SystemTime {
    const MAX_HTTP_DATE_SECONDS: u64 = 253_402_300_799;
    let seconds = file
        .modified
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs().min(MAX_HTTP_DATE_SECONDS));
    UNIX_EPOCH + Duration::from_secs(seconds)
}

fn disposition(purpose: VideoTicketPurpose, filename: &str) -> HeaderValue {
    match purpose {
        VideoTicketPurpose::Playback => HeaderValue::from_static("inline"),
        VideoTicketPurpose::Download => header_value(
            &format!(
                "attachment; filename=\"{}\"; filename*=UTF-8''{}",
                ascii_filename(filename),
                rfc5987_filename(filename)
            ),
            "attachment; filename=\"download\"",
        ),
    }
}

fn ascii_filename(filename: &str) -> String {
    let value: String = filename
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_') {
                byte as char
            } else {
                '_'
            }
        })
        .collect();
    (!value.is_empty())
        .then_some(value)
        .unwrap_or_else(|| "download".into())
}

fn rfc5987_filename(filename: &str) -> String {
    filename
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'!' | b'#'
                        | b'$'
                        | b'&'
                        | b'+'
                        | b'-'
                        | b'.'
                        | b'^'
                        | b'_'
                        | b'`'
                        | b'|'
                        | b'~'
                )
            {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

fn number_header(value: u64) -> HeaderValue {
    header_value(&value.to_string(), "0")
}

fn header_value(value: &str, fallback: &'static str) -> HeaderValue {
    HeaderValue::from_str(value).unwrap_or_else(|_| HeaderValue::from_static(fallback))
}

#[cfg(test)]
mod tests {
    use super::{ascii_filename, if_range_matches, last_modified, rfc5987_filename};
    use crate::fs::VideoFileVersion;
    use axum::http::{header, HeaderMap, HeaderValue};
    use std::{
        path::PathBuf,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn filename_policy_cannot_emit_control_or_path_bytes() {
        assert_eq!(ascii_filename("../bad\r\n.mp4"), ".._bad__.mp4");
        assert_eq!(rfc5987_filename("a b/é.webm"), "a%20b%2F%C3%A9.webm");
    }

    #[test]
    fn only_exact_strong_etags_match_if_range() {
        let file = VideoFileVersion {
            canonical_path: PathBuf::new(),
            size: 1,
            modified: SystemTime::UNIX_EPOCH,
            validator: "opaque".into(),
            #[cfg(unix)]
            device: 1,
            #[cfg(unix)]
            inode: 1,
        };
        let mut headers = HeaderMap::new();
        headers.insert(header::IF_RANGE, HeaderValue::from_static("\"opaque\""));
        assert!(if_range_matches(&headers, &file));
        headers.insert(header::IF_RANGE, HeaderValue::from_static("W/\"opaque\""));
        assert!(!if_range_matches(&headers, &file));
    }

    #[test]
    fn last_modified_is_panic_free_and_round_trips_at_http_second_precision() {
        let mut file = VideoFileVersion {
            canonical_path: PathBuf::new(),
            size: 1,
            modified: UNIX_EPOCH - Duration::from_secs(1),
            validator: "opaque".into(),
            #[cfg(unix)]
            device: 1,
            #[cfg(unix)]
            inode: 1,
        };
        assert_eq!(
            last_modified(&file),
            HeaderValue::from_static("Thu, 01 Jan 1970 00:00:00 GMT")
        );
        file.modified = UNIX_EPOCH + Duration::from_secs(1) + Duration::from_nanos(999_999_999);
        let mut headers = HeaderMap::new();
        headers.insert(header::IF_RANGE, last_modified(&file));
        assert!(if_range_matches(&headers, &file));
        file.modified = UNIX_EPOCH + Duration::from_secs(253_402_300_800);
        assert_eq!(
            httpdate::parse_http_date(last_modified(&file).to_str().unwrap()).unwrap(),
            UNIX_EPOCH + Duration::from_secs(253_402_300_799)
        );
    }
}
