//! Target-relative filesystem commits.
//!
//! The regular sandbox checks protect the logical path. These helpers add a
//! second boundary for delayed writes: parent directories are opened without
//! following symlinks, then metadata checks and the final rename use those
//! directory handles instead of resolving the path again.

use std::path::{Path, PathBuf};

use crate::fs::error::FsError;

/// Stable identity for the directory selected as a delayed-write target.
///
/// The value is intentionally opaque to callers. It may be captured at
/// operation start and supplied to the commit helper, which verifies that the
/// directory handle it opens still refers to the same filesystem object.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct DirectoryIdentity {
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(windows)]
    volume_serial: Option<u32>,
    #[cfg(windows)]
    file_index: Option<u64>,
    #[cfg(not(any(unix, windows)))]
    marker: (),
}

/// Capture the identity of an existing directory.
pub(crate) fn directory_identity(path: &Path) -> Result<DirectoryIdentity, FsError> {
    let metadata = std::fs::metadata(path).map_err(FsError::Io)?;
    if !metadata.is_dir() {
        return Err(FsError::PathEscape);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        return Ok(DirectoryIdentity {
            device: metadata.dev(),
            inode: metadata.ino(),
        });
    }
    #[cfg(windows)]
    {
        let identity = crate::utils::fs::windows_file_identity(path).map_err(FsError::Io)?;
        return Ok(DirectoryIdentity {
            volume_serial: Some(identity.volume_serial),
            file_index: Some(identity.file_index),
        });
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = metadata;
        Ok(DirectoryIdentity { marker: () })
    }
}


/// Snapshot of a regular file's bytes and descriptor metadata.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RegularFileSnapshot {
    pub(crate) bytes: Vec<u8>,
    pub(crate) size_bytes: u64,
    pub(crate) mtime_secs: i64,
    pub(crate) mtime_nanos: u32,
    pub(crate) modified_at: Option<String>,
}

/// Result of probing a path without following symlinks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FileMarkerKind {
    RegularFile { size: u64, mtime_secs: i64 },
    Symlink,
    Directory,
    Other,
    NotFound,
}

/// Immediate directory entry representation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ImmediateDirEntry {
    pub(crate) name: String,
    pub(crate) is_dir: bool,
    pub(crate) is_symlink: bool,
    pub(crate) is_regular_file: bool,
}
#[cfg(unix)]
mod unix {
    use std::fs::File;
    use std::io::Write;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::path::{Component, Path};

    use crate::fs::error::FsError;

    fn io_error(error: std::io::Error) -> FsError {
        match error.kind() {
            std::io::ErrorKind::NotFound => FsError::NotFound,
            std::io::ErrorKind::PermissionDenied => FsError::PermissionDenied,
            _ => FsError::Io(error),
        }
    }

    fn open_directory(path: &Path) -> Result<OwnedFd, FsError> {
        let path = std::ffi::CString::new(path.as_os_str().as_encoded_bytes())
            .map_err(|_| FsError::PathEscape)?;
        let fd = unsafe {
            libc::open(
                path.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if fd < 0 {
            return Err(io_error(std::io::Error::last_os_error()));
        }
        // SAFETY: `fd` is owned by this function after a successful open.
        Ok(unsafe { OwnedFd::from_raw_fd(fd) })
    }

    fn open_child_directory(parent: &OwnedFd, name: &std::ffi::CStr) -> Result<OwnedFd, FsError> {
        let fd = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if fd < 0 {
            return Err(io_error(std::io::Error::last_os_error()));
        }
        // SAFETY: `fd` is owned by this function after a successful openat.
        Ok(unsafe { OwnedFd::from_raw_fd(fd) })
    }

    fn identity_from_fd(fd: &OwnedFd) -> Result<super::DirectoryIdentity, FsError> {
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        let result = unsafe { libc::fstat(fd.as_raw_fd(), stat.as_mut_ptr()) };
        if result < 0 {
            return Err(io_error(std::io::Error::last_os_error()));
        }
        // SAFETY: fstat initialized the structure on success.
        let stat = unsafe { stat.assume_init() };
        Ok(super::DirectoryIdentity {
            device: stat.st_dev as u64,
            inode: stat.st_ino as u64,
        })
    }

    fn open_parent(
        root: &Path,
        relative: &Path,
        expected_root: Option<super::DirectoryIdentity>,
    ) -> Result<OwnedFd, FsError> {
        if relative.is_absolute() {
            return Err(FsError::PathEscape);
        }
        let mut current = open_directory(root)?;
        if let Some(expected_root) = expected_root {
            if identity_from_fd(&current)? != expected_root {
                return Err(FsError::MutationRefused(
                    "filesystem target was replaced while operation was in flight".into(),
                ));
            }
        }
        for component in relative.components() {
            let Component::Normal(name) = component else {
                return Err(FsError::PathEscape);
            };
            let name =
                std::ffi::CString::new(name.as_encoded_bytes()).map_err(|_| FsError::PathEscape)?;
            current = open_child_directory(&current, &name)?;
        }
        Ok(current)
    }

    fn component_name(path: &Path) -> Result<std::ffi::CString, FsError> {
        let name = path
            .file_name()
            .ok_or_else(|| FsError::MutationRefused("target path has no filename".into()))?;
        std::ffi::CString::new(name.as_encoded_bytes()).map_err(|_| FsError::PathEscape)
    }

    fn stat_at(parent: &OwnedFd, name: &std::ffi::CStr) -> Result<libc::stat, FsError> {
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        let result = unsafe {
            libc::fstatat(
                parent.as_raw_fd(),
                name.as_ptr(),
                stat.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        if result < 0 {
            return Err(io_error(std::io::Error::last_os_error()));
        }
        // SAFETY: fstatat initialized the structure on success.
        Ok(unsafe { stat.assume_init() })
    }

    fn mtime(stat: &libc::stat) -> i64 {
        stat.st_mtime
    }

    fn check_expected_mtime(
        parent: &OwnedFd,
        name: &std::ffi::CStr,
        expected_mtime: Option<i64>,
    ) -> Result<(), FsError> {
        let Some(expected_mtime) = expected_mtime else {
            return Ok(());
        };
        let stat = stat_at(parent, name)?;
        if mtime(&stat) != expected_mtime {
            return Err(FsError::Conflict);
        }
        Ok(())
    }

    fn rename_at(
        parent: &OwnedFd,
        old: &std::ffi::CStr,
        new: &std::ffi::CStr,
    ) -> Result<(), FsError> {
        let result = unsafe {
            libc::renameat(
                parent.as_raw_fd(),
                old.as_ptr(),
                parent.as_raw_fd(),
                new.as_ptr(),
            )
        };
        if result < 0 {
            return Err(io_error(std::io::Error::last_os_error()));
        }
        Ok(())
    }

    fn stat_mtime_after_rename(parent: &OwnedFd, name: &std::ffi::CStr) -> Result<i64, FsError> {
        let stat = stat_at(parent, name)?;
        if (stat.st_mode & libc::S_IFMT) != libc::S_IFREG {
            return Err(FsError::MutationRefused(
                "target is not a regular file".into(),
            ));
        }
        Ok(mtime(&stat))
    }

    pub fn persist_temp(
        root: &Path,
        relative: &Path,
        temp: tempfile::NamedTempFile,
        expected_mtime: Option<i64>,
        expected_root: Option<super::DirectoryIdentity>,
        fsync: bool,
    ) -> Result<i64, FsError> {
        let parent_path = relative
            .parent()
            .ok_or_else(|| FsError::MutationRefused("target path has no parent".into()))?;
        let parent = open_parent(root, parent_path, expected_root)?;
        let name = component_name(relative)?;
        check_expected_mtime(&parent, &name, expected_mtime)?;
        let temp_name = component_name(temp.path())?;
        if fsync {
            temp.as_file().sync_data().map_err(io_error)?;
        }
        rename_at(&parent, &temp_name, &name)?;
        stat_mtime_after_rename(&parent, &name)
    }

    pub fn write_bytes(
        root: &Path,
        relative: &Path,
        bytes: &[u8],
        expected_mtime: Option<i64>,
        expected_root: Option<super::DirectoryIdentity>,
        fsync: bool,
    ) -> Result<i64, FsError> {
        let parent_path = relative
            .parent()
            .ok_or_else(|| FsError::MutationRefused("target path has no parent".into()))?;
        let parent = open_parent(root, parent_path, expected_root)?;
        let name = component_name(relative)?;
        check_expected_mtime(&parent, &name, expected_mtime)?;

        let temp_name =
            std::ffi::CString::new(format!(".dam-hopper-{}", uuid::Uuid::new_v4().as_simple()))
                .map_err(|_| FsError::PathEscape)?;
        let fd = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                temp_name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                0o600,
            )
        };
        if fd < 0 {
            return Err(io_error(std::io::Error::last_os_error()));
        }
        // SAFETY: `fd` is owned by this function after a successful openat.
        let mut file = unsafe { File::from_raw_fd(fd) };
        if let Err(error) = file.write_all(bytes) {
            let _ = unsafe { libc::unlinkat(parent.as_raw_fd(), temp_name.as_ptr(), 0) };
            return Err(io_error(error));
        }
        if fsync {
            file.sync_data().map_err(io_error)?;
        }
        drop(file);
        if let Err(error) = rename_at(&parent, &temp_name, &name) {
            let _ = unsafe { libc::unlinkat(parent.as_raw_fd(), temp_name.as_ptr(), 0) };
            return Err(error);
        }
        stat_mtime_after_rename(&parent, &name)
    }

    pub fn read_regular_file_bounded(
        root: &Path,
        relative: &Path,
        max_bytes: u64,
    ) -> Result<Vec<u8>, FsError> {
        let parent_path = relative.parent().unwrap_or_else(|| Path::new(""));
        let parent = open_parent(root, parent_path, None)?;
        let name = component_name(relative)?;
        let fd = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if fd < 0 {
            return Err(io_error(std::io::Error::last_os_error()));
        }
        let mut file = unsafe { File::from_raw_fd(fd) };
        let meta = file.metadata().map_err(io_error)?;
        if !meta.file_type().is_file() {
            return Err(FsError::MutationRefused(
                "target is not a regular file".into(),
            ));
        }
        if meta.len() > max_bytes {
            return Err(FsError::MutationRefused(
                "target file exceeds maximum size".into(),
            ));
        }
        use std::io::Read;
        let mut buffer = Vec::new();
        Read::take(&mut file, max_bytes + 1)
            .read_to_end(&mut buffer)
            .map_err(io_error)?;
        if buffer.len() as u64 > max_bytes {
            return Err(FsError::MutationRefused(
                "target file exceeds maximum size".into(),
            ));
        }
        Ok(buffer)
    }

    pub fn replace_regular_file_if_bytes_match(
        root: &Path,
        relative: &Path,
        expected_bytes: &[u8],
        replacement_bytes: &[u8],
        fsync: bool,
    ) -> Result<(), FsError> {
        let parent_path = relative.parent().unwrap_or_else(|| Path::new(""));
        let parent = open_parent(root, parent_path, None)?;
        let name = component_name(relative)?;

        let target_fd = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            )
        };
        if target_fd < 0 {
            return Err(io_error(std::io::Error::last_os_error()));
        }
        let mut target_file = unsafe { File::from_raw_fd(target_fd) };
        let meta = target_file.metadata().map_err(io_error)?;
        if !meta.file_type().is_file() {
            return Err(FsError::MutationRefused(
                "target is not a regular file".into(),
            ));
        }
        use std::io::Read;
        let mut current_bytes = Vec::new();
        target_file
            .read_to_end(&mut current_bytes)
            .map_err(io_error)?;
        drop(target_file);

        if current_bytes != expected_bytes {
            return Err(FsError::Conflict);
        }

        let temp_name =
            std::ffi::CString::new(format!(".dam-hopper-{}", uuid::Uuid::new_v4().as_simple()))
                .map_err(|_| FsError::PathEscape)?;
        let fd = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                temp_name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_CLOEXEC | libc::O_NOFOLLOW,
                0o600,
            )
        };
        if fd < 0 {
            return Err(io_error(std::io::Error::last_os_error()));
        }
        let mut temp_file = unsafe { File::from_raw_fd(fd) };
        if let Err(error) = temp_file.write_all(replacement_bytes) {
            let _ = unsafe { libc::unlinkat(parent.as_raw_fd(), temp_name.as_ptr(), 0) };
            return Err(io_error(error));
        }
        if fsync {
            if let Err(error) = temp_file.sync_data() {
                let _ = unsafe { libc::unlinkat(parent.as_raw_fd(), temp_name.as_ptr(), 0) };
                return Err(io_error(error));
            }
        }
        drop(temp_file);

        if let Err(error) = rename_at(&parent, &temp_name, &name) {
            let _ = unsafe { libc::unlinkat(parent.as_raw_fd(), temp_name.as_ptr(), 0) };
            return Err(error);
        }
        stat_mtime_after_rename(&parent, &name)?;

        if fsync {
            let ret = unsafe { libc::fsync(parent.as_raw_fd()) };
            if ret < 0 {
                return Err(io_error(std::io::Error::last_os_error()));
            }
        }

        Ok(())
    }
    pub fn probe_file_marker(
        root: &Path,
        relative: &Path,
    ) -> Result<super::FileMarkerKind, FsError> {
        if relative.as_os_str().is_empty() {
            let parent = open_directory(root)?;
            let _ = identity_from_fd(&parent)?;
            return Ok(super::FileMarkerKind::Directory);
        }
        let parent_path = relative.parent().unwrap_or_else(|| Path::new(""));
        let parent = match open_parent(root, parent_path, None) {
            Ok(p) => p,
            Err(FsError::NotFound) => return Ok(super::FileMarkerKind::NotFound),
            Err(e) => return Err(e),
        };
        let name = match component_name(relative) {
            Ok(n) => n,
            Err(_) => return Ok(super::FileMarkerKind::NotFound),
        };
        match stat_at(&parent, &name) {
            Ok(stat) => {
                let mode = stat.st_mode & libc::S_IFMT;
                if mode == libc::S_IFLNK {
                    Ok(super::FileMarkerKind::Symlink)
                } else if mode == libc::S_IFDIR {
                    Ok(super::FileMarkerKind::Directory)
                } else if mode == libc::S_IFREG {
                    Ok(super::FileMarkerKind::RegularFile {
                        size: stat.st_size as u64,
                        mtime_secs: stat.st_mtime,
                    })
                } else {
                    Ok(super::FileMarkerKind::Other)
                }
            }
            Err(FsError::NotFound) => Ok(super::FileMarkerKind::NotFound),
            Err(e) => Err(e),
        }
    }

    pub fn read_immediate_dir(
        root: &Path,
        relative: &Path,
        max_entries: usize,
    ) -> Result<(Vec<super::ImmediateDirEntry>, bool), FsError> {
        let dir_fd = open_parent(root, relative, None)?;
        let dup_fd = unsafe { libc::dup(dir_fd.as_raw_fd()) };
        if dup_fd < 0 {
            return Err(io_error(std::io::Error::last_os_error()));
        }
        let dir_ptr = unsafe { libc::fdopendir(dup_fd) };
        if dir_ptr.is_null() {
            unsafe { libc::close(dup_fd) };
            return Err(io_error(std::io::Error::last_os_error()));
        }

        let mut entries = Vec::new();
        let mut complete = true;
        let mut visited = 0;

        loop {
            let entry = unsafe { libc::readdir(dir_ptr) };
            if entry.is_null() {
                break;
            }
            let d_name = unsafe { std::ffi::CStr::from_ptr((*entry).d_name.as_ptr()) };
            let bytes = d_name.to_bytes();
            if bytes == b"." || bytes == b".." {
                continue;
            }
            visited += 1;
            if visited > max_entries {
                complete = false;
                break;
            }
            let name_str = match std::str::from_utf8(bytes) {
                Ok(s) => s.to_string(),
                Err(_) => continue,
            };
            let d_type = unsafe { (*entry).d_type };
            let (is_dir, is_symlink, is_regular_file) = if d_type == libc::DT_DIR {
                (true, false, false)
            } else if d_type == libc::DT_LNK {
                (false, true, false)
            } else if d_type == libc::DT_REG {
                (false, false, true)
            } else {
                if let Ok(st) = stat_at(&dir_fd, d_name) {
                    let mode = st.st_mode & libc::S_IFMT;
                    (
                        mode == libc::S_IFDIR,
                        mode == libc::S_IFLNK,
                        mode == libc::S_IFREG,
                    )
                } else {
                    (false, false, false)
                }
            };
            entries.push(super::ImmediateDirEntry {
                name: name_str,
                is_dir,
                is_symlink,
                is_regular_file,
            });
        }
        unsafe { libc::closedir(dir_ptr) };
        Ok((entries, complete))
    }

    pub fn read_regular_snapshot(
        root: &Path,
        relative: &Path,
        max_bytes: u64,
    ) -> Result<super::RegularFileSnapshot, FsError> {
        let parent_path = relative.parent().unwrap_or_else(|| Path::new(""));
        let parent = open_parent(root, parent_path, None)?;
        let name = component_name(relative)?;
        let fd = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK,
            )
        };
        if fd < 0 {
            return Err(io_error(std::io::Error::last_os_error()));
        }
        let owned_fd = unsafe { OwnedFd::from_raw_fd(fd) };
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        let ret = unsafe { libc::fstat(owned_fd.as_raw_fd(), stat.as_mut_ptr()) };
        if ret < 0 {
            return Err(io_error(std::io::Error::last_os_error()));
        }
        let stat = unsafe { stat.assume_init() };
        if (stat.st_mode & libc::S_IFMT) != libc::S_IFREG {
            return Err(FsError::MutationRefused(
                "target is not a regular file".into(),
            ));
        }
        if (stat.st_size as u64) > max_bytes {
            return Err(FsError::TooLarge(stat.st_size as u64));
        }
        let mut file = File::from(owned_fd);
        use std::io::Read;
        let mut buffer = Vec::new();
        Read::take(&mut file, max_bytes + 1)
            .read_to_end(&mut buffer)
            .map_err(io_error)?;
        if buffer.len() as u64 > max_bytes {
            return Err(FsError::TooLarge(buffer.len() as u64));
        }
        let mut post_stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        let ret = unsafe { libc::fstat(file.as_raw_fd(), post_stat.as_mut_ptr()) };
        if ret < 0 {
            return Err(io_error(std::io::Error::last_os_error()));
        }
        let post_stat = unsafe { post_stat.assume_init() };
        if (post_stat.st_mode & libc::S_IFMT) != libc::S_IFREG {
            return Err(FsError::MutationRefused(
                "target is not a regular file".into(),
            ));
        }
        if post_stat.st_size != stat.st_size || post_stat.st_mtime != stat.st_mtime {
            return Err(FsError::Conflict);
        }
        #[cfg(target_os = "linux")]
        if post_stat.st_mtime_nsec != stat.st_mtime_nsec {
            return Err(FsError::Conflict);
        }

        let mtime_secs = stat.st_mtime;
        #[cfg(target_os = "linux")]
        let mtime_nanos = stat.st_mtime_nsec as u32;
        #[cfg(not(target_os = "linux"))]
        let mtime_nanos = 0u32;

        let modified_at = chrono::DateTime::from_timestamp(mtime_secs, mtime_nanos)
            .map(|dt| dt.to_rfc3339());

        Ok(super::RegularFileSnapshot {
            bytes: buffer,
            size_bytes: stat.st_size as u64,
            mtime_secs,
            mtime_nanos,
            modified_at,
        })
    }
}

#[cfg(not(unix))]
mod unix {
    use std::io::Write;
    use std::path::Path;
    use std::time::UNIX_EPOCH;

    use crate::fs::error::FsError;

    pub fn persist_temp(
        root: &Path,
        relative: &Path,
        temp: tempfile::NamedTempFile,
        expected_mtime: Option<i64>,
        expected_root: Option<super::DirectoryIdentity>,
        fsync: bool,
    ) -> Result<i64, FsError> {
        if let Some(expected_root) = expected_root {
            if super::directory_identity(root)? != expected_root {
                return Err(FsError::MutationRefused(
                    "filesystem target was replaced while operation was in flight".into(),
                ));
            }
        }
        let target = root.join(relative);
        if let Some(expected) = expected_mtime {
            let metadata = std::fs::metadata(&target).map_err(FsError::Io)?;
            let current = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs() as i64)
                .unwrap_or(0);
            if current != expected {
                return Err(FsError::Conflict);
            }
        }
        if fsync {
            temp.as_file().sync_data().map_err(FsError::Io)?;
        }
        temp.persist(&target)
            .map_err(|error| FsError::Io(error.error))?;
        let metadata = std::fs::metadata(target).map_err(FsError::Io)?;
        Ok(metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or(0))
    }

    pub fn write_bytes(
        root: &Path,
        relative: &Path,
        bytes: &[u8],
        expected_mtime: Option<i64>,
        expected_root: Option<super::DirectoryIdentity>,
        fsync: bool,
    ) -> Result<i64, FsError> {
        if let Some(expected_root) = expected_root {
            if super::directory_identity(root)? != expected_root {
                return Err(FsError::MutationRefused(
                    "filesystem target was replaced while operation was in flight".into(),
                ));
            }
        }
        let target = root.join(relative);
        if let Some(expected) = expected_mtime {
            let metadata = std::fs::metadata(&target).map_err(FsError::Io)?;
            let current = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs() as i64)
                .unwrap_or(0);
            if current != expected {
                return Err(FsError::Conflict);
            }
        }
        let parent = target
            .parent()
            .ok_or_else(|| FsError::MutationRefused("target path has no parent".into()))?;
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(FsError::Io)?;
        temp.write_all(bytes).map_err(FsError::Io)?;
        if fsync {
            temp.as_file().sync_data().map_err(FsError::Io)?;
        }
        temp.persist(&target)
            .map_err(|error| FsError::Io(error.error))?;
        let metadata = std::fs::metadata(target).map_err(FsError::Io)?;
        Ok(metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or(0))
    }

    pub fn read_regular_file_bounded(
        root: &Path,
        relative: &Path,
        max_bytes: u64,
    ) -> Result<Vec<u8>, FsError> {
        let target = root.join(relative);
        let meta = std::fs::symlink_metadata(&target).map_err(FsError::Io)?;
        if meta.file_type().is_symlink() || !meta.file_type().is_file() {
            return Err(FsError::MutationRefused(
                "target is not a regular file".into(),
            ));
        }
        if meta.len() > max_bytes {
            return Err(FsError::MutationRefused(
                "target file exceeds maximum size".into(),
            ));
        }
        use std::io::Read;
        let mut file = std::fs::File::open(&target).map_err(FsError::Io)?;
        let mut buffer = Vec::new();
        Read::take(&mut file, max_bytes + 1)
            .read_to_end(&mut buffer)
            .map_err(FsError::Io)?;
        if buffer.len() as u64 > max_bytes {
            return Err(FsError::MutationRefused(
                "target file exceeds maximum size".into(),
            ));
        }
        Ok(buffer)
    }

    pub fn replace_regular_file_if_bytes_match(
        root: &Path,
        relative: &Path,
        expected_bytes: &[u8],
        replacement_bytes: &[u8],
        fsync: bool,
    ) -> Result<(), FsError> {
        let target = root.join(relative);
        let meta = std::fs::symlink_metadata(&target).map_err(FsError::Io)?;
        if meta.file_type().is_symlink() || !meta.file_type().is_file() {
            return Err(FsError::MutationRefused(
                "target is not a regular file".into(),
            ));
        }
        use std::io::Read;
        let mut file = std::fs::File::open(&target).map_err(FsError::Io)?;
        let mut current_bytes = Vec::new();
        file.read_to_end(&mut current_bytes).map_err(FsError::Io)?;
        drop(file);

        if current_bytes != expected_bytes {
            return Err(FsError::Conflict);
        }

        let parent = target
            .parent()
            .ok_or_else(|| FsError::MutationRefused("target path has no parent".into()))?;
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(FsError::Io)?;
        temp.write_all(replacement_bytes).map_err(FsError::Io)?;
        if fsync {
            temp.as_file().sync_data().map_err(FsError::Io)?;
        }
        temp.persist(&target)
            .map_err(|error| FsError::Io(error.error))?;
        let post_meta = std::fs::symlink_metadata(&target).map_err(FsError::Io)?;
        if post_meta.file_type().is_symlink() || !post_meta.file_type().is_file() {
            return Err(FsError::MutationRefused(
                "target is not a regular file".into(),
            ));
        }
        Ok(())
    }

    pub fn probe_file_marker(
        root: &Path,
        relative: &Path,
    ) -> Result<super::FileMarkerKind, FsError> {
        let target = root.join(relative);
        match std::fs::symlink_metadata(&target) {
            Ok(meta) => {
                if meta.file_type().is_symlink() {
                    Ok(super::FileMarkerKind::Symlink)
                } else if meta.file_type().is_dir() {
                    Ok(super::FileMarkerKind::Directory)
                } else if meta.file_type().is_file() {
                    let mtime_secs = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);
                    Ok(super::FileMarkerKind::RegularFile {
                        size: meta.len(),
                        mtime_secs,
                    })
                } else {
                    Ok(super::FileMarkerKind::Other)
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(super::FileMarkerKind::NotFound),
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => Err(FsError::PermissionDenied),
            Err(e) => Err(FsError::Io(e)),
        }
    }

    pub fn read_immediate_dir(
        root: &Path,
        relative: &Path,
        max_entries: usize,
    ) -> Result<(Vec<super::ImmediateDirEntry>, bool), FsError> {
        let target = root.join(relative);
        let meta = std::fs::symlink_metadata(&target).map_err(FsError::Io)?;
        if meta.file_type().is_symlink() || !meta.file_type().is_dir() {
            return Err(FsError::PathEscape);
        }
        let read_dir = std::fs::read_dir(&target).map_err(FsError::Io)?;
        let mut entries = Vec::new();
        let mut complete = true;
        let mut visited = 0;
        for entry_res in read_dir {
            let entry = entry_res.map_err(FsError::Io)?;
            let file_name = entry.file_name();
            let name_str = match file_name.to_str() {
                Some(s) => s.to_string(),
                None => continue,
            };
            if name_str == "." || name_str == ".." {
                continue;
            }
            visited += 1;
            if visited > max_entries {
                complete = false;
                break;
            }
            let file_type = entry.file_type().map_err(FsError::Io)?;
            entries.push(super::ImmediateDirEntry {
                name: name_str,
                is_dir: file_type.is_dir(),
                is_symlink: file_type.is_symlink(),
                is_regular_file: file_type.is_file(),
            });
        }
        Ok((entries, complete))
    }

    pub fn read_regular_snapshot(
        root: &Path,
        relative: &Path,
        max_bytes: u64,
    ) -> Result<super::RegularFileSnapshot, FsError> {
        let target = root.join(relative);
        let meta = std::fs::symlink_metadata(&target).map_err(FsError::Io)?;
        if meta.file_type().is_symlink() || !meta.file_type().is_file() {
            return Err(FsError::MutationRefused(
                "target is not a regular file".into(),
            ));
        }
        if meta.len() > max_bytes {
            return Err(FsError::TooLarge(meta.len()));
        }
        let initial_mtime = meta.modified().map_err(FsError::Io)?;
        let mut file = std::fs::File::open(&target).map_err(FsError::Io)?;
        let mut buffer = Vec::new();
        use std::io::Read;
        Read::take(&mut file, max_bytes + 1)
            .read_to_end(&mut buffer)
            .map_err(FsError::Io)?;
        if buffer.len() as u64 > max_bytes {
            return Err(FsError::TooLarge(buffer.len() as u64));
        }
        let post_meta = file.metadata().map_err(FsError::Io)?;
        if post_meta.file_type().is_symlink() || !post_meta.file_type().is_file() {
            return Err(FsError::MutationRefused(
                "target is not a regular file".into(),
            ));
        }
        if post_meta.len() != meta.len() || post_meta.modified().map_err(FsError::Io)? != initial_mtime {
            return Err(FsError::Conflict);
        }
        let mtime_dur = initial_mtime
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        let mtime_secs = mtime_dur.as_secs() as i64;
        let mtime_nanos = mtime_dur.subsec_nanos();
        let modified_at = chrono::DateTime::from_timestamp(mtime_secs, mtime_nanos)
            .map(|dt| dt.to_rfc3339());
        Ok(super::RegularFileSnapshot {
            bytes: buffer,
            size_bytes: post_meta.len(),
            mtime_secs,
            mtime_nanos,
            modified_at,
        })
    }
}

pub(crate) async fn persist_temp(
    root: PathBuf,
    relative: PathBuf,
    temp: tempfile::NamedTempFile,
    expected_mtime: Option<i64>,
    expected_root: Option<DirectoryIdentity>,
    fsync: bool,
) -> Result<i64, FsError> {
    tokio::task::spawn_blocking(move || {
        unix::persist_temp(&root, &relative, temp, expected_mtime, expected_root, fsync)
    })
    .await
    .map_err(|error| FsError::Io(std::io::Error::other(error.to_string())))?
}

pub(crate) fn persist_temp_sync(
    root: &Path,
    relative: &Path,
    temp: tempfile::NamedTempFile,
    expected_mtime: Option<i64>,
    expected_root: Option<DirectoryIdentity>,
    fsync: bool,
) -> Result<i64, FsError> {
    unix::persist_temp(root, relative, temp, expected_mtime, expected_root, fsync)
}

pub(crate) fn write_bytes(
    root: &Path,
    relative: &Path,
    bytes: &[u8],
    expected_mtime: Option<i64>,
    expected_root: Option<DirectoryIdentity>,
    fsync: bool,
) -> Result<i64, FsError> {
    unix::write_bytes(root, relative, bytes, expected_mtime, expected_root, fsync)
}

pub(crate) fn read_regular_file_bounded(
    root: &Path,
    relative: &Path,
    max_bytes: u64,
) -> Result<Vec<u8>, FsError> {
    unix::read_regular_file_bounded(root, relative, max_bytes)
}

pub(crate) fn replace_regular_file_if_bytes_match(
    root: &Path,
    relative: &Path,
    expected_bytes: &[u8],
    replacement_bytes: &[u8],
    fsync: bool,
) -> Result<(), FsError> {
    unix::replace_regular_file_if_bytes_match(
        root,
        relative,
        expected_bytes,
        replacement_bytes,
        fsync,
    )
}

pub(crate) fn probe_file_marker(
    root: &Path,
    relative: &Path,
) -> Result<FileMarkerKind, FsError> {
    unix::probe_file_marker(root, relative)
}

pub(crate) fn read_immediate_dir(
    root: &Path,
    relative: &Path,
    max_entries: usize,
) -> Result<(Vec<ImmediateDirEntry>, bool), FsError> {
    unix::read_immediate_dir(root, relative, max_entries)
}

pub(crate) fn read_regular_snapshot(
    root: &Path,
    relative: &Path,
    max_bytes: u64,
) -> Result<RegularFileSnapshot, FsError> {
    unix::read_regular_snapshot(root, relative, max_bytes)
}

#[cfg(all(test, unix))]
mod tests {
    use super::{read_regular_file_bounded, replace_regular_file_if_bytes_match, write_bytes};
    use crate::fs::FsError;

    #[test]
    fn writes_through_directory_handles_and_checks_mtime() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        std::fs::create_dir_all(root.join("nested")).unwrap();
        let file = root.join("nested/data.txt");
        std::fs::write(&file, "old").unwrap();
        let mtime = std::fs::metadata(&file)
            .unwrap()
            .modified()
            .unwrap()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        let new_mtime = write_bytes(
            &root,
            std::path::Path::new("nested/data.txt"),
            b"new",
            Some(mtime),
            None,
            false,
        )
        .unwrap();

        assert_eq!(std::fs::read(&file).unwrap(), b"new");
        assert!(new_mtime >= mtime);
        assert!(matches!(
            write_bytes(
                &root,
                std::path::Path::new("nested/data.txt"),
                b"blocked",
                Some(mtime.saturating_sub(1)),
                None,
                false,
            ),
            Err(FsError::Conflict)
        ));
        assert_eq!(std::fs::read(&file).unwrap(), b"new");
    }

    #[test]
    fn rejects_symlinked_parent_without_touching_outside() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();

        let result = write_bytes(
            &root,
            std::path::Path::new("link/secret.txt"),
            b"must-not-write",
            None,
            None,
            false,
        );

        assert!(result.is_err());
        assert_eq!(
            std::fs::read(outside.join("secret.txt")).unwrap(),
            b"secret"
        );
    }

    #[test]
    fn refuses_replaced_root_identity_before_commit() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let old_root = tmp.path().join("old-root");
        std::fs::create_dir_all(&root).unwrap();
        let identity = super::directory_identity(&root).unwrap();

        std::fs::rename(&root, &old_root).unwrap();
        std::fs::create_dir(&root).unwrap();

        let result = write_bytes(
            &root,
            std::path::Path::new("data.txt"),
            b"must-not-write",
            None,
            Some(identity),
            false,
        );

        assert!(matches!(result, Err(FsError::MutationRefused(_))));
        assert!(!root.join("data.txt").exists());
    }

    #[test]
    fn replace_regular_file_success_and_conflict() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        std::fs::create_dir_all(&root).unwrap();
        let file_path = root.join("policy.json");
        std::fs::write(&file_path, b"original-content").unwrap();

        // Conflict when expected bytes do not match
        let err = replace_regular_file_if_bytes_match(
            &root,
            std::path::Path::new("policy.json"),
            b"wrong-expected",
            b"new-content",
            false,
        )
        .unwrap_err();
        assert!(matches!(err, FsError::Conflict));
        assert_eq!(std::fs::read(&file_path).unwrap(), b"original-content");

        // Success when expected bytes match
        replace_regular_file_if_bytes_match(
            &root,
            std::path::Path::new("policy.json"),
            b"original-content",
            b"new-content",
            false,
        )
        .unwrap();
        assert_eq!(std::fs::read(&file_path).unwrap(), b"new-content");

        // Verify no leftover .dam-hopper-* temp files exist
        for entry in std::fs::read_dir(&root).unwrap().flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            assert!(
                !name.starts_with(".dam-hopper-"),
                "found leftover temp file: {name}"
            );
        }
    }

    #[test]
    fn replace_regular_file_rejects_symlink_and_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        // Symlink target
        let outside_file = outside.join("target.txt");
        std::fs::write(&outside_file, b"outside-data").unwrap();
        std::os::unix::fs::symlink(&outside_file, root.join("link.txt")).unwrap();

        let res = replace_regular_file_if_bytes_match(
            &root,
            std::path::Path::new("link.txt"),
            b"outside-data",
            b"mutated-data",
            false,
        );
        assert!(res.is_err());
        assert_eq!(std::fs::read(&outside_file).unwrap(), b"outside-data");

        // Directory target
        let dir_target = root.join("subdir");
        std::fs::create_dir_all(&dir_target).unwrap();
        let res_dir = replace_regular_file_if_bytes_match(
            &root,
            std::path::Path::new("subdir"),
            b"",
            b"data",
            false,
        );
        assert!(matches!(res_dir, Err(FsError::MutationRefused(_))));
    }

    #[test]
    fn read_regular_file_bounded_limits_and_symlinks() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        let file = root.join("bounded.txt");
        std::fs::write(&file, b"1234567890").unwrap();

        // Within bound
        let content =
            read_regular_file_bounded(&root, std::path::Path::new("bounded.txt"), 10).unwrap();
        assert_eq!(content, b"1234567890");

        // Exceeds bound
        let err =
            read_regular_file_bounded(&root, std::path::Path::new("bounded.txt"), 9).unwrap_err();
        assert!(matches!(err, FsError::MutationRefused(_)));

        // Symlink rejection
        let outside_file = outside.join("sym.txt");
        std::fs::write(&outside_file, b"symlink-target").unwrap();
        std::os::unix::fs::symlink(&outside_file, root.join("symlink.txt")).unwrap();
        let err_sym = read_regular_file_bounded(&root, std::path::Path::new("symlink.txt"), 100);
        assert!(err_sym.is_err());
    }

    #[test]
    fn read_regular_snapshot_and_probing() {
        use super::{probe_file_marker, read_immediate_dir, read_regular_snapshot, FileMarkerKind};

        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        let plans_dir = root.join("plans");
        std::fs::create_dir_all(&plans_dir).unwrap();

        let plan_file = plans_dir.join("plan.md");
        std::fs::write(&plan_file, b"# Test Plan").unwrap();

        // Probe directory
        let marker_dir = probe_file_marker(&root, std::path::Path::new("plans")).unwrap();
        assert_eq!(marker_dir, FileMarkerKind::Directory);

        // Probe regular file
        let marker_file =
            probe_file_marker(&root, std::path::Path::new("plans/plan.md")).unwrap();
        assert!(matches!(marker_file, FileMarkerKind::RegularFile { .. }));

        // Probe non-existent
        let marker_none =
            probe_file_marker(&root, std::path::Path::new("plans/absent.md")).unwrap();
        assert_eq!(marker_none, FileMarkerKind::NotFound);

        // Probe symlink
        let outside_file = outside.join("target.md");
        std::fs::write(&outside_file, b"outside").unwrap();
        std::os::unix::fs::symlink(&outside_file, plans_dir.join("sym.md")).unwrap();
        let marker_sym = probe_file_marker(&root, std::path::Path::new("plans/sym.md")).unwrap();
        assert_eq!(marker_sym, FileMarkerKind::Symlink);

        // Read regular snapshot
        let snap =
            read_regular_snapshot(&root, std::path::Path::new("plans/plan.md"), 1024).unwrap();
        assert_eq!(snap.bytes, b"# Test Plan");
        assert_eq!(snap.size_bytes, 11);
        assert!(snap.modified_at.is_some());

        // Read snapshot of symlink must fail
        let err_sym =
            read_regular_snapshot(&root, std::path::Path::new("plans/sym.md"), 1024);
        assert!(err_sym.is_err());

        // Read immediate dir
        let (entries, complete) =
            read_immediate_dir(&root, std::path::Path::new("plans"), 100).unwrap();
        assert!(complete);
        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"plan.md"));
        assert!(names.contains(&"sym.md"));
    }
}
