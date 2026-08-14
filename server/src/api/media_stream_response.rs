use std::{
    io,
    path::{Path, PathBuf},
};

use axum::{
    body::Body,
    http::{header, HeaderMap, Method, StatusCode},
    response::Response,
};
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use tokio_util::io::ReaderStream;

use crate::{
    fs::{
        media_session::media_session_from_headers, MediaFileVersion, MediaTicketKind,
        MediaTicketPurpose, MediaTicketRecord, VideoTicketPurpose,
    },
    state::AppState,
};

use super::{
    fs::resolve,
    http_byte_range::{parse_single_range, ByteRange},
    media_stream_headers::{
        if_range_matches, range_not_satisfiable, response_with_body, MediaDisposition,
    },
};

const STREAM_BUFFER_BYTES: usize = 128 * 1024;

pub(crate) async fn respond(
    state: AppState,
    ticket: String,
    expected_kind: MediaTicketKind,
    method: Method,
    request_headers: HeaderMap,
    allow_ticket_only: bool,
) -> Response {
    let _workspace_context = state.workspace_context_guard.read().await;
    enum AuthorizationMode {
        Cookie(crate::fs::media_session::MediaSessionToken),
        Ticket,
    }

    let authorization = if let Some(token) = media_session_from_headers(&request_headers) {
        state
            .media_tickets
            .authorize_bound(&ticket, expected_kind, &token)
            .map(|authorization| (authorization, AuthorizationMode::Cookie(token)))
            .or_else(|| {
                allow_ticket_only.then(|| {
                    state
                        .media_tickets
                        .authorize_ticket(&ticket, expected_kind)
                        .map(|authorization| (authorization, AuthorizationMode::Ticket))
                })?
            })
    } else if allow_ticket_only {
        state
            .media_tickets
            .authorize_ticket(&ticket, expected_kind)
            .map(|authorization| (authorization, AuthorizationMode::Ticket))
    } else {
        None
    };
    let Some((authorization, authorization_mode)) = authorization else {
        return empty(StatusCode::NOT_FOUND);
    };
    let record = authorization.record.clone();
    let Some(disposition) = disposition_for(&record, expected_kind) else {
        return empty(StatusCode::NOT_FOUND);
    };
    let Some(file) = open_revalidated(&state, &record).await else {
        state.media_tickets.revoke(&ticket, expected_kind);
        return empty(StatusCode::GONE);
    };
    if method == Method::HEAD {
        let finalized = match &authorization_mode {
            AuthorizationMode::Cookie(token) => state.media_tickets.finalize_bound_and_touch(
                &ticket,
                expected_kind,
                token,
                &authorization,
            ),
            AuthorizationMode::Ticket => state.media_tickets.finalize_ticket_and_touch(
                &ticket,
                expected_kind,
                &authorization,
            ),
        };
        if !finalized {
            return empty(StatusCode::NOT_FOUND);
        }
        return response_with_body(StatusCode::OK, &record, None, Body::empty(), disposition)
            .unwrap_or_else(|| stale_response(&state, &ticket, expected_kind));
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
    let finalized = match &authorization_mode {
        AuthorizationMode::Cookie(token) => state.media_tickets.finalize_bound_and_touch(
            &ticket,
            expected_kind,
            token,
            &authorization,
        ),
        AuthorizationMode::Ticket => {
            state
                .media_tickets
                .finalize_ticket_and_touch(&ticket, expected_kind, &authorization)
        }
    };
    if !finalized {
        return empty(StatusCode::NOT_FOUND);
    }
    let (status, body_range) = match range {
        Some(range) => (StatusCode::PARTIAL_CONTENT, Some(range)),
        None => (StatusCode::OK, None),
    };
    let body = match stream_body(file, body_range, record.file.size).await {
        Some(body) => body,
        None => return stale_response(&state, &ticket, expected_kind),
    };
    response_with_body(status, &record, body_range, body, disposition)
        .unwrap_or_else(|| stale_response(&state, &ticket, expected_kind))
}

fn disposition_for(record: &MediaTicketRecord, kind: MediaTicketKind) -> Option<MediaDisposition> {
    match kind {
        MediaTicketKind::Image => {
            (record.purpose == MediaTicketPurpose::Preview).then_some(MediaDisposition::Inline)
        }
        MediaTicketKind::Video => match record.purpose {
            MediaTicketPurpose::Playback => {
                Some(MediaDisposition::Video(VideoTicketPurpose::Playback))
            }
            MediaTicketPurpose::Download => {
                Some(MediaDisposition::Video(VideoTicketPurpose::Download))
            }
            MediaTicketPurpose::Preview => None,
        },
    }
}

fn requested_range(headers: &HeaderMap, size: u64) -> Result<Option<ByteRange>, ()> {
    let values: Vec<_> = headers.get_all(header::RANGE).iter().collect();
    match values.as_slice() {
        [] => Ok(None),
        [value] => parse_single_range(value.to_str().map_err(|_| ())?, size).map(Some),
        _ => Err(()),
    }
}

async fn open_revalidated(state: &AppState, record: &MediaTicketRecord) -> Option<tokio::fs::File> {
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
    version_matches(&record.file, &metadata, &file).then_some(file)
}

/// Open only regular files and avoid following a final symlink/reparse point.
pub(crate) async fn open_regular_file(path: &Path) -> std::io::Result<tokio::fs::File> {
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
    #[cfg(windows)]
    let file = {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;

        let path = path.to_path_buf();
        let file = tokio::task::spawn_blocking(move || {
            std::fs::OpenOptions::new()
                .read(true)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
                .open(path)
        })
        .await
        .map_err(std::io::Error::other)??;
        tokio::fs::File::from_std(file)
    };
    #[cfg(not(any(unix, windows)))]
    return Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "safe media opens are unavailable on this platform",
    ));
    #[cfg(any(unix, windows))]
    {
        if !file.metadata().await?.is_file() {
            return Err(std::io::Error::other("not a regular file"));
        }
        #[cfg(windows)]
        validate_windows_handle_path(&file, path)?;
        Ok(file)
    }
    #[cfg(not(any(unix, windows)))]
    unreachable!("safe media opens are unavailable on this platform")
}

pub(crate) fn version_from_open_file(
    canonical_path: PathBuf,
    file: &tokio::fs::File,
    metadata: &std::fs::Metadata,
) -> io::Result<MediaFileVersion> {
    #[cfg(windows)]
    {
        let mut version = MediaFileVersion::from_metadata(canonical_path, metadata)?;
        let identity = windows_file_identity(file)?;
        version.volume_serial = Some(identity.volume_serial);
        version.file_index = Some(identity.file_index);
        return Ok(version);
    }
    #[cfg(not(windows))]
    {
        let _ = file;
        MediaFileVersion::from_metadata(canonical_path, metadata)
    }
}

fn version_matches(
    expected: &MediaFileVersion,
    actual: &std::fs::Metadata,
    _file: &tokio::fs::File,
) -> bool {
    if !actual.is_file()
        || expected.size != actual.len()
        || actual.modified().ok() != Some(expected.modified)
    {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        expected.device == actual.dev() && expected.inode == actual.ino()
    }
    #[cfg(windows)]
    {
        let Ok(identity) = windows_file_identity(_file) else {
            return false;
        };
        expected.volume_serial == Some(identity.volume_serial)
            && expected.file_index == Some(identity.file_index)
    }
    #[cfg(not(any(unix, windows)))]
    {
        true
    }
}

#[cfg(windows)]
#[derive(Clone, Copy)]
struct WindowsFileIdentity {
    volume_serial: u32,
    file_index: u64,
}

#[cfg(windows)]
fn windows_file_identity(file: &tokio::fs::File) -> io::Result<WindowsFileIdentity> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };

    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    let success = unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) };
    if success == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(WindowsFileIdentity {
        volume_serial: info.dwVolumeSerialNumber,
        file_index: (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
    })
}

#[cfg(windows)]
fn validate_windows_handle_path(file: &tokio::fs::File, expected: &Path) -> io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{GetFinalPathNameByHandleW, VOLUME_NAME_DOS};

    let mut capacity = 256_u32;
    let actual = loop {
        let mut buffer = vec![0_u16; capacity as usize];
        let length = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle(),
                buffer.as_mut_ptr(),
                capacity,
                VOLUME_NAME_DOS,
            )
        };
        if length == 0 {
            return Err(io::Error::last_os_error());
        }
        if length < capacity {
            buffer.truncate(length as usize);
            break String::from_utf16(buffer.as_slice())
                .map_err(|_| io::Error::other("invalid Windows path"))?;
        }
        capacity = length
            .checked_add(1)
            .ok_or_else(|| io::Error::other("Windows path is too long"))?;
        if capacity > 32 * 1024 {
            return Err(io::Error::other("Windows path is too long"));
        }
    };

    if normalize_windows_path(&actual) == normalize_windows_path(&expected.to_string_lossy()) {
        Ok(())
    } else {
        Err(io::Error::other("opened path escaped its canonical path"))
    }
}

#[cfg(windows)]
fn normalize_windows_path(path: &str) -> String {
    let mut normalized = path.replace('/', "\\");
    if let Some(unc) = normalized.strip_prefix(r"\\?\UNC\") {
        normalized = format!(r"\\{unc}");
    } else if let Some(dos) = normalized.strip_prefix(r"\\?\") {
        normalized = dos.to_owned();
    }
    normalized.trim_end_matches('\\').to_ascii_lowercase()
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
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("private, no-store"),
    );
    response
}

fn stale_response(state: &AppState, ticket: &str, expected_kind: MediaTicketKind) -> Response {
    state.media_tickets.revoke(ticket, expected_kind);
    empty(StatusCode::GONE)
}
