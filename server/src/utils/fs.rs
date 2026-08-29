use std::path::Path;

use crate::error::AppError;

/// Write `content` to `target` atomically (temp → rename, same filesystem).
/// On Unix, the temp file is created with mode 0o600.
pub fn atomic_write(target: &Path, content: &str) -> Result<(), AppError> {
    let dir = target.parent().unwrap_or(Path::new("/"));
    std::fs::create_dir_all(dir)
        .map_err(|e| AppError::Config(format!("Cannot create dir {}: {}", dir.display(), e)))?;

    let tmp = dir.join(format!(
        ".dam-hopper-tmp-{}.tmp",
        uuid::Uuid::new_v4().simple()
    ));

    write_with_mode(&tmp, content)?;

    std::fs::rename(&tmp, target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        AppError::Config(format!(
            "Cannot rename {} → {}: {}",
            tmp.display(),
            target.display(),
            e
        ))
    })?;

    Ok(())
}

#[cfg(unix)]
fn write_with_mode(path: &Path, content: &str) -> Result<(), AppError> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| AppError::Config(format!("Cannot open {}: {}", path.display(), e)))?;
    file.write_all(content.as_bytes())
        .map_err(|e| AppError::Config(format!("Cannot write {}: {}", path.display(), e)))
}

#[cfg(not(unix))]
fn write_with_mode(path: &Path, content: &str) -> Result<(), AppError> {
    std::fs::write(path, content)
        .map_err(|e| AppError::Config(format!("Cannot write {}: {}", path.display(), e)))
}
#[cfg(windows)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WindowsFileIdentity {
    pub(crate) volume_serial: u32,
    pub(crate) file_index: u64,
}

#[cfg(windows)]
pub(crate) fn windows_file_identity(path: &Path) -> std::io::Result<WindowsFileIdentity> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS,
    };

    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)?;
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    let success = unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) };
    if success == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(WindowsFileIdentity {
        volume_serial: info.dwVolumeSerialNumber,
        file_index: (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
    })
}
