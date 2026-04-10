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

/// Atomically write `bytes` to `abs`, guarded by mtime check.
///
/// 1. Stats `abs`; if mtime ≠ `expected_mtime` returns `FsError::Conflict`.
/// 2. Creates a `NamedTempFile` in the same directory (same fs partition).
/// 3. Writes all bytes; optionally fsyncs.
/// 4. Atomically renames temp → `abs`.
/// 5. Returns the new mtime (Unix seconds).
///
/// Temp file lives in the target directory to avoid cross-device rename failures.
pub async fn atomic_write_with_check(
    abs: &Path,
    expected_mtime: i64,
    bytes: &[u8],
    fsync: bool,
) -> Result<i64, FsError> {
    // Mtime guard — stat the current file
    let meta = fs::metadata(abs).await.map_err(map_io)?;
    let current_mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    if current_mtime != expected_mtime {
        return Err(FsError::Conflict);
    }

    // Write size cap: 100 MB
    if bytes.len() as u64 > MAX_READ_BYTES {
        return Err(FsError::TooLarge(bytes.len() as u64));
    }

    // Resolve parent directory; fail loudly if missing (sandbox guarantees it exists)
    let parent = abs.parent().ok_or_else(|| FsError::Io(std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        "path has no parent",
    )))?;

    // Create temp file on same FS partition as target (avoids cross-device rename)
    tokio::task::spawn_blocking({
        let parent = parent.to_path_buf();
        let bytes = bytes.to_vec();
        let abs = abs.to_path_buf();
        move || -> Result<(), FsError> {
            use std::io::Write;
            let mut tmp = tempfile::NamedTempFile::new_in(&parent)
                .map_err(FsError::Io)?;
            tmp.write_all(&bytes).map_err(FsError::Io)?;
            if fsync {
                tmp.as_file().sync_data().map_err(FsError::Io)?;
            }
            tmp.persist(&abs).map_err(|e| FsError::Io(e.error))?;
            Ok(())
        }
    })
    .await
    .map_err(|e| FsError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))??;

    // Stat again for the real new mtime
    let new_meta = fs::metadata(abs).await.map_err(map_io)?;
    let new_mtime = new_meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    Ok(new_mtime)
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

// ---------------------------------------------------------------------------
// File content search
// ---------------------------------------------------------------------------

pub const MAX_SEARCH_RESULTS: usize = 1000;
const MAX_LINE_LEN: usize = 500;
const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10 MB

#[derive(Debug, Serialize)]
pub struct SearchMatch {
    pub path: String,
    pub line: u64,
    pub col: u64,
    pub text: String,
}

/// Search file contents within `root` for `query` (plain text, internally regex-escaped).
///
/// Returns `(matches, truncated)`. Walks only text files; respects .gitignore via the
/// `ignore` crate. Capped at `max_results.min(MAX_SEARCH_RESULTS)`.
pub async fn search_files(
    root: &Path,
    query: &str,
    case_sensitive: bool,
    max_results: usize,
) -> Result<(Vec<SearchMatch>, bool), FsError> {
    let root_clone = root.to_path_buf();
    let escaped = regex::escape(query);
    let max = max_results.min(MAX_SEARCH_RESULTS);

    tokio::task::spawn_blocking(move || {
        use ignore::WalkBuilder;
        use regex::RegexBuilder;

        let re = RegexBuilder::new(&escaped)
            .case_insensitive(!case_sensitive)
            .build()
            .map_err(|e| FsError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("Invalid pattern: {e}"),
            )))?;

        let mut matches: Vec<SearchMatch> = Vec::new();
        let mut truncated = false;

        for entry in WalkBuilder::new(&root_clone)
            .hidden(false)
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .build()
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().map_or(false, |ft| ft.is_file()) {
                continue;
            }
            let path = entry.path();

            if let Ok(meta) = std::fs::metadata(path) {
                if meta.len() > MAX_FILE_SIZE {
                    continue;
                }
            }

            // read_to_string skips binary files (non-UTF8 → Err)
            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let rel = path
                .strip_prefix(&root_clone)
                .unwrap_or(path)
                .to_string_lossy()
                .replace('\\', "/");

            for (line_idx, line) in content.lines().enumerate() {
                if let Some(m) = re.find(line) {
                    let text = if line.len() > MAX_LINE_LEN {
                        format!("{}...", &line[..MAX_LINE_LEN])
                    } else {
                        line.to_string()
                    };
                    matches.push(SearchMatch {
                        path: rel.clone(),
                        line: (line_idx + 1) as u64,
                        col: (m.start() + 1) as u64,
                        text,
                    });
                    if matches.len() >= max {
                        truncated = true;
                        return Ok((matches, truncated));
                    }
                }
            }
        }
        Ok((matches, truncated))
    })
    .await
    .map_err(|e| FsError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?
}
