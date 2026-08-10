use std::path::Path;

use axum::{
    body::Body,
    http::{header, HeaderMap, Method, StatusCode},
    response::Response,
};
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use tokio_util::io::ReaderStream;

use crate::{
    fs::{VideoFileVersion, VideoTicketRecord},
    state::AppState,
};

use super::{
    fs::resolve,
    http_byte_range::{parse_single_range, ByteRange},
    video_stream_headers::{if_range_matches, range_not_satisfiable, response_with_body},
};

const STREAM_BUFFER_BYTES: usize = 128 * 1024;

pub(crate) async fn respond(
    state: AppState,
    ticket: String,
    method: Method,
    request_headers: HeaderMap,
) -> Response {
    let _workspace_context = state.workspace_context_guard.read().await;
    let Some(record) = state.video_stream_tickets.lookup_and_touch(&ticket) else {
        return empty(StatusCode::NOT_FOUND);
    };
    let Some(file) = open_revalidated(&state, &record).await else {
        state.video_stream_tickets.revoke(&ticket);
        return empty(StatusCode::GONE);
    };

    if method == Method::HEAD {
        return response_with_body(StatusCode::OK, &record, None, Body::empty())
            .unwrap_or_else(|| stale_response(&state, &ticket));
    }

    let range = match requested_range(&request_headers, record.file.size) {
        Ok(range) => range,
        Err(()) => return range_not_satisfiable(&record),
    };
    let range = if range.is_some() && if_range_matches(&request_headers, &record.file) {
        range
    } else {
        None
    };
    let (status, body_range) = match range {
        Some(range) => (StatusCode::PARTIAL_CONTENT, Some(range)),
        None => (StatusCode::OK, None),
    };
    let body = match stream_body(file, body_range, record.file.size).await {
        Some(body) => body,
        None => {
            return stale_response(&state, &ticket);
        }
    };
    response_with_body(status, &record, body_range, body)
        .unwrap_or_else(|| stale_response(&state, &ticket))
}

fn requested_range(headers: &HeaderMap, size: u64) -> Result<Option<ByteRange>, ()> {
    let values: Vec<_> = headers.get_all(header::RANGE).iter().collect();
    match values.as_slice() {
        [] => Ok(None),
        [value] => parse_single_range(value.to_str().map_err(|_| ())?, size).map(Some),
        _ => Err(()),
    }
}

async fn open_revalidated(state: &AppState, record: &VideoTicketRecord) -> Option<tokio::fs::File> {
    let canonical = resolve(
        state,
        &record.project,
        &record.project_relative_path.to_string_lossy(),
    )
    .await
    .ok()?;
    if canonical != record.file.canonical_path {
        return None;
    }
    let file = open_regular_file(&canonical).await.ok()?;
    let metadata = file.metadata().await.ok()?;
    version_matches(&record.file, &metadata).then_some(file)
}

async fn open_regular_file(path: &Path) -> std::io::Result<tokio::fs::File> {
    if !tokio::fs::symlink_metadata(path).await?.is_file() {
        return Err(std::io::Error::other("not a regular file"));
    }
    #[cfg(unix)]
    let file = {
        use std::os::unix::fs::OpenOptionsExt;
        let path = path.to_path_buf();
        let file = tokio::task::spawn_blocking(move || {
            std::fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW)
                .open(path)
        })
        .await
        .map_err(std::io::Error::other)??;
        tokio::fs::File::from_std(file)
    };
    #[cfg(not(unix))]
    let file = tokio::fs::File::open(path).await?;
    Ok(file)
}

fn version_matches(expected: &VideoFileVersion, actual: &std::fs::Metadata) -> bool {
    if expected.size != actual.len() || actual.modified().ok() != Some(expected.modified) {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        expected.device == actual.dev() && expected.inode == actual.ino()
    }
    #[cfg(not(unix))]
    true
}

async fn stream_body(
    mut file: tokio::fs::File,
    range: Option<ByteRange>,
    size: u64,
) -> Option<Body> {
    if size == 0 {
        return Some(Body::empty());
    }
    let range = range.unwrap_or(ByteRange {
        start: 0,
        end: size.checked_sub(1)?,
    });
    file.seek(SeekFrom::Start(range.start)).await.ok()?;
    Some(Body::from_stream(ReaderStream::with_capacity(
        file.take(range.len()?),
        STREAM_BUFFER_BYTES,
    )))
}

fn empty(status: StatusCode) -> Response {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = status;
    response
}

fn stale_response(state: &AppState, ticket: &str) -> Response {
    state.video_stream_tickets.revoke(ticket);
    empty(StatusCode::GONE)
}
