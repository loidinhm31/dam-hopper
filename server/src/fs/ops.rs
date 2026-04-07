use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::fs::error::FsError;

/// Hard cap for unrestricted reads. Callers must supply a range for files
/// exceeding this size.
pub const MAX_READ_BYTES: u64 = 100 * 1024 * 1024;

const BINARY_PROBE_BYTES: usize = 8192;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub kind: String, // "file" | "dir"
    pub size: u64,
    pub mtime: i64, // Unix seconds
    pub is_symlink: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub kind: String,
    pub size: u64,
    pub mtime: i64,
    pub mime: Option<String>,
    pub is_binary: bool,
}

pub async fn list_dir(abs: &Path) -> Result<Vec<DirEntry>, FsError> {
    let mut rd = fs::read_dir(abs).await.map_err(map_io)?;
    let mut entries = Vec::new();

    while let Some(entry) = rd.next_entry().await? {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();

        // symlink_metadata does NOT follow symlinks — tells us if entry IS a symlink
        let link_meta = fs::symlink_metadata(&path).await?;
        let is_symlink = link_meta.file_type().is_symlink();

        // metadata DOES follow symlinks — gives us the target's kind/size
        let meta = fs::metadata(&path).await.unwrap_or(link_meta);

        let kind = if meta.is_dir() { "dir" } else { "file" };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        entries.push(DirEntry {
            name,
            kind: kind.to_string(),
            size: meta.len(),
            mtime,
            is_symlink,
        });
    }

    // Dirs first, then files; each group sorted alphabetically
    entries.sort_by(|a, b| match (a.kind.as_str(), b.kind.as_str()) {
        ("dir", "file") => std::cmp::Ordering::Less,
        ("file", "dir") => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });

    Ok(entries)
}

/// Read up to `BINARY_PROBE_BYTES` and determine if the file is binary.
/// Returns `(is_binary, mime_type)`.
pub async fn detect_binary(abs: &Path) -> Result<(bool, Option<String>), FsError> {
    let mut file = fs::File::open(abs).await.map_err(map_io)?;
    let mut buf = vec![0u8; BINARY_PROBE_BYTES];
    let n = file.read(&mut buf).await?;
    let probe = &buf[..n];

    // 1. Magic-bytes detection via infer
    if let Some(kind) = infer::get(probe) {
        return Ok((true, Some(kind.mime_type().to_string())));
    }

    // 2. NUL byte scan
    if probe.contains(&0u8) {
        return Ok((true, None));
    }

    // 3. UTF-8 validity
    if std::str::from_utf8(probe).is_err() {
        return Ok((true, None));
    }

    let mime = mime_guess::from_path(abs).first_raw().map(|m| m.to_string());
    Ok((false, mime))
}

pub async fn stat(abs: &Path) -> Result<FileStat, FsError> {
    let meta = fs::metadata(abs).await.map_err(map_io)?;

    let kind = if meta.is_dir() { "dir" } else { "file" };
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let (is_binary, mime) = if meta.is_file() {
        detect_binary(abs).await?
    } else {
        (false, None)
    };

    Ok(FileStat {
        kind: kind.to_string(),
        size: meta.len(),
        mtime,
        mime,
        is_binary,
    })
}

/// Read file bytes, optionally restricted to a byte range.
///
/// Without a range: rejects files larger than `max` bytes with `TooLarge`.
/// With a range `(offset, len)`: reads at most `len` bytes from `offset`.
pub async fn read_file(abs: &Path, range: Option<(u64, u64)>, max: u64) -> Result<Vec<u8>, FsError> {
    let meta = fs::metadata(abs).await.map_err(map_io)?;
    let file_size = meta.len();

    let (offset, read_len) = match range {
        Some((o, l)) => (o, l.min(file_size.saturating_sub(o))),
        None => {
            if file_size > max {
                return Err(FsError::TooLarge(file_size));
            }
            (0, file_size)
        }
    };

    let mut file = fs::File::open(abs).await.map_err(map_io)?;

    if offset > 0 {
        file.seek(std::io::SeekFrom::Start(offset)).await?;
    }

    let mut buf = vec![0u8; read_len as usize];
    let mut total = 0usize;
    while total < buf.len() {
        let n = file.read(&mut buf[total..]).await?;
        if n == 0 {
            break;
        }
        total += n;
    }
    buf.truncate(total);

    Ok(buf)
}

fn map_io(e: std::io::Error) -> FsError {
    if e.kind() == std::io::ErrorKind::NotFound {
        FsError::NotFound
    } else if e.kind() == std::io::ErrorKind::PermissionDenied {
        FsError::PermissionDenied
    } else {
        FsError::Io(e)
    }
}
