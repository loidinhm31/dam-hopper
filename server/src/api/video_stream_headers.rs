//! Compatibility adapters for the pre-extraction video stream module.
//!
//! The public video route now uses `media_stream_headers` directly through the
//! shared response core. These wrappers keep the old private module contract
//! available to existing module-local tests without duplicating header policy.

use axum::{
    body::Body,
    http::{HeaderMap, HeaderValue, StatusCode},
    response::Response,
};

use crate::fs::{VideoFileVersion, VideoTicketRecord};

use super::{
    http_byte_range::ByteRange,
    media_stream_headers::{self, MediaDisposition},
};

pub(super) fn if_range_matches(headers: &HeaderMap, file: &VideoFileVersion) -> bool {
    media_stream_headers::if_range_matches(headers, file)
}

pub(super) fn response_with_body(
    status: StatusCode,
    record: &VideoTicketRecord,
    range: Option<ByteRange>,
    body: Body,
) -> Option<Response> {
    let media_record = record.clone().into_media();
    media_stream_headers::response_with_body(
        status,
        &media_record,
        range,
        body,
        MediaDisposition::Video(record.purpose),
    )
}

pub(super) fn range_not_satisfiable(record: &VideoTicketRecord) -> Response {
    let media_record = record.clone().into_media();
    media_stream_headers::range_not_satisfiable(&media_record)
}

fn ascii_filename(filename: &str) -> String {
    media_stream_headers::ascii_filename(filename)
}

fn rfc5987_filename(filename: &str) -> String {
    media_stream_headers::rfc5987_filename(filename)
}

fn last_modified(file: &VideoFileVersion) -> HeaderValue {
    media_stream_headers::last_modified(file)
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
        let file = file();
        let mut headers = HeaderMap::new();
        headers.insert(header::IF_RANGE, HeaderValue::from_static("\"opaque\""));
        assert!(if_range_matches(&headers, &file));
        headers.insert(header::IF_RANGE, HeaderValue::from_static("W/\"opaque\""));
        assert!(!if_range_matches(&headers, &file));
    }

    #[test]
    fn last_modified_is_panic_free_and_round_trips_at_http_second_precision() {
        let mut file = file();
        file.modified = UNIX_EPOCH - Duration::from_secs(1);
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

    fn file() -> VideoFileVersion {
        VideoFileVersion {
            canonical_path: PathBuf::new(),
            size: 1,
            modified: SystemTime::UNIX_EPOCH,
            validator: "opaque".into(),
            #[cfg(unix)]
            device: 1,
            #[cfg(unix)]
            inode: 1,
            #[cfg(windows)]
            volume_serial: None,
            #[cfg(windows)]
            file_index: None,
        }
    }
}
