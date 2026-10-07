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

    /// Keep every directory alive so a renamed parent cannot silently turn an
    /// open-time snapshot into the current named file.
    struct PinnedDirectories {
        directories: Vec<(Option<std::ffi::CString>, OwnedFd)>,
    }

    impl PinnedDirectories {
        fn open(root: &Path, relative: &Path) -> Result<Self, FsError> {
            let mut directories = vec![(None, open_directory(root)?)];
            for component in relative.components() {
                let Component::Normal(name) = component else {
                    return Err(FsError::PathEscape);
                };
                let name = std::ffi::CString::new(name.as_encoded_bytes())
                    .map_err(|_| FsError::PathEscape)?;
                let child = open_child_directory(&directories.last().unwrap().1, &name)?;
                directories.push((Some(name), child));
            }
            Ok(Self { directories })
        }

        fn parent(&self) -> &OwnedFd {
            &self.directories.last().unwrap().1
        }

        fn validate(&self, root: &Path) -> Result<(), FsError> {
            let current_root = open_directory(root).map_err(|_| FsError::Conflict)?;
            if identity_from_fd(&current_root)? != identity_from_fd(&self.directories[0].1)? {
                return Err(FsError::Conflict);
            }
            for pair in self.directories.windows(2) {
                let named = stat_at(&pair[0].1, pair[1].0.as_ref().unwrap())
                    .map_err(|_| FsError::Conflict)?;
                let pinned = identity_from_fd(&pair[1].1)?;
                if named.st_mode & libc::S_IFMT != libc::S_IFDIR
                    || named.st_dev as u64 != pinned.device
                    || named.st_ino as u64 != pinned.inode
                {
                    return Err(FsError::Conflict);
                }
            }
            Ok(())
        }
    }

    pub fn read_regular_snapshot(
        root: &Path,
        relative: &Path,
        max_bytes: u64,
    ) -> Result<super::RegularFileSnapshot, FsError> {
        read_regular_snapshot_impl(root, relative, max_bytes, || {}, || {})
    }

    // Hooks are per invocation, not process-global; tests mutate the real
    // filesystem at the exact descriptor/read publication boundaries.
    pub(super) fn read_regular_snapshot_impl(
        root: &Path,
        relative: &Path,
        max_bytes: u64,
        after_open: impl FnOnce(),
        after_read: impl FnOnce(),
    ) -> Result<super::RegularFileSnapshot, FsError> {
        use std::os::unix::fs::MetadataExt;
        let parent_path = relative.parent().unwrap_or_else(|| Path::new(""));
        let directories = PinnedDirectories::open(root, parent_path)?;
        let parent = directories.parent();
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
        let mut file = File::from(owned_fd);
        let initial = file.metadata().map_err(io_error)?;
        if !initial.is_file() {
            return Err(FsError::MutationRefused(
                "target is not a regular file".into(),
            ));
        }
        if initial.len() > max_bytes {
            return Err(FsError::TooLarge(initial.len()));
        }
        after_open();
        use std::io::Read;
        let mut buffer = Vec::new();
        Read::take(&mut file, max_bytes.saturating_add(1))
            .read_to_end(&mut buffer)
            .map_err(io_error)?;
        after_read();

        let final_metadata = file.metadata().map_err(io_error)?;
        let named = stat_at(parent, &name).map_err(|_| FsError::Conflict)?;
        directories.validate(root)?;
        if !final_metadata.is_file()
            || final_metadata.dev() != initial.dev()
            || final_metadata.ino() != initial.ino()
            || final_metadata.len() != initial.len()
            || final_metadata.mtime() != initial.mtime()
            || final_metadata.mtime_nsec() != initial.mtime_nsec()
            || final_metadata.ctime() != initial.ctime()
            || final_metadata.ctime_nsec() != initial.ctime_nsec()
            || named.st_mode & libc::S_IFMT != libc::S_IFREG
            || named.st_dev as u64 != initial.dev()
            || named.st_ino as u64 != initial.ino()
            || buffer.len() as u64 != initial.len()
        {
            return Err(FsError::Conflict);
        }

        let mtime_secs = initial.mtime();
        let mtime_nanos = initial.mtime_nsec() as u32;
        let modified_at =
            chrono::DateTime::from_timestamp(mtime_secs, mtime_nanos).map(|dt| dt.to_rfc3339());

        Ok(super::RegularFileSnapshot {
            bytes: buffer,
            size_bytes: initial.len(),
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

    #[cfg(windows)]
    pub use super::windows::{probe_file_marker, read_immediate_dir, read_regular_snapshot};

    #[cfg(not(windows))]
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
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Ok(super::FileMarkerKind::NotFound)
            }
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                Err(FsError::PermissionDenied)
            }
            Err(e) => Err(FsError::Io(e)),
        }
    }

    #[cfg(not(windows))]
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

    #[cfg(not(windows))]
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
        if post_meta.len() != meta.len()
            || post_meta.modified().map_err(FsError::Io)? != initial_mtime
        {
            return Err(FsError::Conflict);
        }
        let mtime_dur = initial_mtime
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();
        let mtime_secs = mtime_dur.as_secs() as i64;
        let mtime_nanos = mtime_dur.subsec_nanos();
        let modified_at =
            chrono::DateTime::from_timestamp(mtime_secs, mtime_nanos).map(|dt| dt.to_rfc3339());
        Ok(super::RegularFileSnapshot {
            bytes: buffer,
            size_bytes: post_meta.len(),
            mtime_secs,
            mtime_nanos,
            modified_at,
        })
    }
}

#[cfg(windows)]
mod windows {
    use std::ffi::{c_void, OsStr, OsString};
    use std::fs::{File, OpenOptions};
    use std::io::Read;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle};
    use std::path::{Component, Path, PathBuf, Prefix};

    use crate::fs::error::FsError;
    use crate::utils::fs::WindowsFileIdentity;
    use windows_sys::Win32::Storage::FileSystem::{
        FileBasicInfo, FileIdBothDirectoryInfo, FileIdBothDirectoryRestartInfo, FileStandardInfo,
        GetFileInformationByHandle, GetFileInformationByHandleEx, BY_HANDLE_FILE_INFORMATION,
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_BASIC_INFO,
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_BOTH_DIR_INFO,
        FILE_READ_ATTRIBUTES, FILE_READ_DATA, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        FILE_STANDARD_INFO,
    };

    // Native ABI layouts. IO_STATUS_BLOCK's first member is a pointer-sized
    // union (NTSTATUS or pointer); using usize preserves its size/alignment.
    #[repr(C)]
    struct UnicodeString {
        length: u16,
        maximum_length: u16,
        buffer: *mut u16,
    }

    #[repr(C)]
    struct ObjectAttributes {
        length: u32,
        root_directory: *mut c_void,
        object_name: *mut UnicodeString,
        attributes: u32,
        security_descriptor: *mut c_void,
        security_quality_of_service: *mut c_void,
    }

    #[repr(C)]
    struct IoStatusBlock {
        status: usize,
        information: usize,
    }

    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn NtCreateFile(
            handle: *mut *mut c_void,
            desired_access: u32,
            object_attributes: *mut ObjectAttributes,
            io_status: *mut IoStatusBlock,
            allocation_size: *const i64,
            file_attributes: u32,
            share_access: u32,
            create_disposition: u32,
            create_options: u32,
            ea_buffer: *mut c_void,
            ea_length: u32,
        ) -> i32;
        fn RtlNtStatusToDosError(status: i32) -> u32;
    }

    fn io_error(error: std::io::Error) -> FsError {
        match error.kind() {
            std::io::ErrorKind::NotFound => FsError::NotFound,
            std::io::ErrorKind::PermissionDenied => FsError::PermissionDenied,
            _ => FsError::Io(error),
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct DescriptorState {
        identity: WindowsFileIdentity,
        size: u64,
        write_time: i64,
        change_time: i64,
        attributes: u32,
        is_directory: bool,
        delete_pending: bool,
    }

    fn descriptor_state(file: &File) -> Result<DescriptorState, FsError> {
        let mut identity = BY_HANDLE_FILE_INFORMATION::default();
        let mut basic = FILE_BASIC_INFO::default();
        let mut standard = FILE_STANDARD_INFO::default();
        // SAFETY: all buffers are correctly sized native structures, and the
        // borrowed handle stays open for each synchronous query.
        let success = unsafe {
            GetFileInformationByHandle(file.as_raw_handle(), &mut identity) != 0
                && GetFileInformationByHandleEx(
                    file.as_raw_handle(),
                    FileBasicInfo,
                    (&mut basic as *mut FILE_BASIC_INFO).cast(),
                    std::mem::size_of::<FILE_BASIC_INFO>() as u32,
                ) != 0
                && GetFileInformationByHandleEx(
                    file.as_raw_handle(),
                    FileStandardInfo,
                    (&mut standard as *mut FILE_STANDARD_INFO).cast(),
                    std::mem::size_of::<FILE_STANDARD_INFO>() as u32,
                ) != 0
        };
        if !success {
            return Err(io_error(std::io::Error::last_os_error()));
        }
        let size = u64::try_from(standard.EndOfFile).map_err(|_| FsError::Conflict)?;
        Ok(DescriptorState {
            identity: WindowsFileIdentity {
                volume_serial: identity.dwVolumeSerialNumber,
                file_index: (u64::from(identity.nFileIndexHigh) << 32)
                    | u64::from(identity.nFileIndexLow),
            },
            size,
            write_time: basic.LastWriteTime,
            change_time: basic.ChangeTime,
            attributes: basic.FileAttributes,
            is_directory: standard.Directory,
            delete_pending: standard.DeletePending,
        })
    }

    fn require_directory(file: &File) -> Result<(), FsError> {
        let state = descriptor_state(file)?;
        if !state.is_directory || state.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(FsError::PathEscape);
        }
        Ok(())
    }

    fn open_anchor(path: &Path) -> Result<File, FsError> {
        let file = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
            .map_err(io_error)?;
        require_directory(&file)?;
        Ok(file)
    }

    fn open_child(parent: &File, name: &OsStr, read_data: bool) -> Result<File, FsError> {
        let mut wide: Vec<u16> = name.encode_wide().collect();
        // A native rooted open must have exactly one ordinary component.
        // Reject ADS and object-manager separators as well as embedded NULs.
        if wide.is_empty()
            || wide.iter().any(|&c| matches!(c, 0 | 47 | 58 | 92))
            || name == OsStr::new(".")
            || name == OsStr::new("..")
        {
            return Err(FsError::PathEscape);
        }
        let length = wide
            .len()
            .checked_mul(2)
            .and_then(|n| u16::try_from(n).ok())
            .ok_or(FsError::PathEscape)?;
        let mut object_name = UnicodeString {
            length,
            maximum_length: length,
            buffer: wide.as_mut_ptr(),
        };
        let mut attributes = ObjectAttributes {
            length: std::mem::size_of::<ObjectAttributes>() as u32,
            root_directory: parent.as_raw_handle(),
            object_name: &mut object_name,
            attributes: 0x40, // OBJ_CASE_INSENSITIVE; handle is not inheritable.
            security_descriptor: std::ptr::null_mut(),
            security_quality_of_service: std::ptr::null_mut(),
        };
        let mut status = IoStatusBlock {
            status: 0,
            information: 0,
        };
        let mut handle = std::ptr::null_mut();
        // FILE_OPEN_REPARSE_POINT applies to this single component, not only
        // the leaf of a multi-component pathname. Never follow reparse data.
        // SYNCHRONIZE + FILE_SYNCHRONOUS_IO_NONALERT makes File::read safe.
        let result = unsafe {
            NtCreateFile(
                &mut handle,
                FILE_READ_ATTRIBUTES | 0x0010_0000 | if read_data { FILE_READ_DATA } else { 0 },
                &mut attributes,
                &mut status,
                std::ptr::null(),
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                1, // FILE_OPEN: never create or modify an entry.
                0x0020_0000 | 0x20,
                std::ptr::null_mut(),
                0,
            )
        };
        if result < 0 {
            // SAFETY: ntdll translates this native operation's failure status.
            let error = unsafe { RtlNtStatusToDosError(result) };
            return Err(io_error(std::io::Error::from_raw_os_error(error as i32)));
        }
        // SAFETY: successful NtCreateFile transfers one owned file handle.
        Ok(unsafe { File::from_raw_handle(handle) })
    }

    struct PinnedDirectories {
        anchor: PathBuf,
        directories: Vec<(Option<OsString>, File)>,
    }

    impl PinnedDirectories {
        fn open(root: &Path, relative: &Path) -> Result<Self, FsError> {
            let absolute = if root.is_absolute() {
                root.to_path_buf()
            } else {
                std::env::current_dir().map_err(io_error)?.join(root)
            };
            let mut components = absolute.components();
            let Some(Component::Prefix(prefix)) = components.next() else {
                return Err(FsError::PathEscape);
            };
            if !matches!(
                prefix.kind(),
                Prefix::Disk(_)
                    | Prefix::VerbatimDisk(_)
                    | Prefix::UNC(_, _)
                    | Prefix::VerbatimUNC(_, _)
            ) || components.next() != Some(Component::RootDir)
            {
                return Err(FsError::PathEscape);
            }
            // This volume/share anchor has no filesystem ancestor to follow.
            // Walk the configured root itself too, not just its descendants.
            let mut anchor = PathBuf::from(prefix.as_os_str());
            anchor.push(r"\");
            let first = open_anchor(&anchor)?;
            let mut pinned = Self {
                anchor,
                directories: vec![(None, first)],
            };
            for component in components.chain(relative.components()) {
                let Component::Normal(name) = component else {
                    return Err(FsError::PathEscape);
                };
                let child = open_child(pinned.parent(), name, true)?;
                require_directory(&child)?;
                pinned.directories.push((Some(name.to_os_string()), child));
            }
            Ok(pinned)
        }

        fn parent(&self) -> &File {
            &self.directories.last().unwrap().1
        }

        fn validate(&self) -> Result<(), FsError> {
            let current_anchor = open_anchor(&self.anchor).map_err(|_| FsError::Conflict)?;
            if descriptor_state(&current_anchor)?.identity
                != descriptor_state(&self.directories[0].1)?.identity
            {
                return Err(FsError::Conflict);
            }
            for pair in self.directories.windows(2) {
                let named = open_child(&pair[0].1, pair[1].0.as_ref().unwrap(), false)
                    .map_err(|_| FsError::Conflict)?;
                require_directory(&named).map_err(|_| FsError::Conflict)?;
                if descriptor_state(&named)?.identity != descriptor_state(&pair[1].1)?.identity {
                    return Err(FsError::Conflict);
                }
            }
            Ok(())
        }
    }

    fn timestamp(ticks: i64) -> (i64, u32) {
        // Windows FILETIME is 100ns since 1601, including dates before Unix.
        let ticks = ticks - 116_444_736_000_000_000;
        (
            ticks.div_euclid(10_000_000),
            (ticks.rem_euclid(10_000_000) * 100) as u32,
        )
    }

    pub fn probe_file_marker(
        root: &Path,
        relative: &Path,
    ) -> Result<super::FileMarkerKind, FsError> {
        if relative.as_os_str().is_empty() {
            let directories = PinnedDirectories::open(root, relative)?;
            directories.validate()?;
            return Ok(super::FileMarkerKind::Directory);
        }
        let parent = relative.parent().unwrap_or_else(|| Path::new(""));
        let directories = match PinnedDirectories::open(root, parent) {
            Ok(directories) => directories,
            Err(FsError::NotFound) => return Ok(super::FileMarkerKind::NotFound),
            Err(error) => return Err(error),
        };
        let name = relative.file_name().ok_or(FsError::PathEscape)?;
        let file = match open_child(directories.parent(), name, false) {
            Ok(file) => file,
            Err(FsError::NotFound) => return Ok(super::FileMarkerKind::NotFound),
            Err(error) => return Err(error),
        };
        let state = descriptor_state(&file)?;
        directories.validate()?;
        Ok(if state.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            super::FileMarkerKind::Symlink
        } else if state.is_directory {
            super::FileMarkerKind::Directory
        } else if file.metadata().map_err(io_error)?.is_file() {
            super::FileMarkerKind::RegularFile {
                size: state.size,
                mtime_secs: timestamp(state.write_time).0,
            }
        } else {
            super::FileMarkerKind::Other
        })
    }

    pub fn read_immediate_dir(
        root: &Path,
        relative: &Path,
        max_entries: usize,
    ) -> Result<(Vec<super::ImmediateDirEntry>, bool), FsError> {
        let directories = PinnedDirectories::open(root, relative)?;
        let mut buffer = [0u64; 512]; // Native structure alignment; bounded 4KiB batch.
        let buffer_size = std::mem::size_of_val(&buffer);
        let mut restart = true;
        let mut entries = Vec::new();
        let mut visited = 0;
        loop {
            buffer.fill(0);
            // SAFETY: this directory handle and aligned buffer remain alive.
            let success = unsafe {
                GetFileInformationByHandleEx(
                    directories.parent().as_raw_handle(),
                    if restart {
                        FileIdBothDirectoryRestartInfo
                    } else {
                        FileIdBothDirectoryInfo
                    },
                    buffer.as_mut_ptr().cast(),
                    buffer_size as u32,
                )
            };
            if success == 0 {
                let error = std::io::Error::last_os_error();
                if error.raw_os_error() == Some(18) {
                    // ERROR_NO_MORE_FILES
                    break;
                }
                return Err(io_error(error));
            }
            restart = false;
            let mut offset = 0usize;
            loop {
                if offset + std::mem::size_of::<FILE_ID_BOTH_DIR_INFO>() > buffer_size {
                    return Err(FsError::Io(std::io::Error::other(
                        "invalid directory information",
                    )));
                }
                let ptr = unsafe { buffer.as_ptr().cast::<u8>().add(offset) };
                // SAFETY: bounds checked above; native entry alignment need not
                // match Rust's typed references, so copy the fixed header.
                let entry = unsafe { ptr.cast::<FILE_ID_BOTH_DIR_INFO>().read_unaligned() };
                let name_start = offset + std::mem::offset_of!(FILE_ID_BOTH_DIR_INFO, FileName);
                let name_end = name_start + entry.FileNameLength as usize;
                let next = entry.NextEntryOffset as usize;
                if entry.FileNameLength % 2 != 0
                    || name_end > buffer_size
                    || (next != 0
                        && (next % 8 != 0
                            || next < name_end - offset
                            || offset + next >= buffer_size))
                {
                    return Err(FsError::Io(std::io::Error::other(
                        "invalid directory entry",
                    )));
                }
                // SAFETY: buffer alignment and validated even byte count.
                let wide_name = unsafe {
                    std::slice::from_raw_parts(
                        buffer.as_ptr().cast::<u8>().add(name_start).cast::<u16>(),
                        entry.FileNameLength as usize / 2,
                    )
                };
                let name = String::from_utf16(wide_name).ok();
                if name.as_deref() != Some(".") && name.as_deref() != Some("..") {
                    if visited >= max_entries {
                        directories.validate()?;
                        return Ok((entries, false));
                    }
                    visited += 1;
                    if let Some(name) = name {
                        let is_symlink = entry.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0;
                        let is_dir =
                            !is_symlink && entry.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0;
                        entries.push(super::ImmediateDirEntry {
                            name,
                            is_dir,
                            is_symlink,
                            is_regular_file: !is_symlink && !is_dir,
                        });
                    }
                }
                if next == 0 {
                    break;
                }
                offset += next;
            }
        }
        directories.validate()?;
        Ok((entries, true))
    }

    pub fn read_regular_snapshot(
        root: &Path,
        relative: &Path,
        max_bytes: u64,
    ) -> Result<super::RegularFileSnapshot, FsError> {
        read_regular_snapshot_impl(root, relative, max_bytes, || {}, || {})
    }

    pub(super) fn read_regular_snapshot_impl(
        root: &Path,
        relative: &Path,
        max_bytes: u64,
        after_open: impl FnOnce(),
        after_read: impl FnOnce(),
    ) -> Result<super::RegularFileSnapshot, FsError> {
        let parent = relative.parent().unwrap_or_else(|| Path::new(""));
        let directories = PinnedDirectories::open(root, parent)?;
        let name = relative.file_name().ok_or(FsError::PathEscape)?;
        let mut file = open_child(directories.parent(), name, true)?;
        let initial = descriptor_state(&file)?;
        if initial.is_directory
            || initial.attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || !file.metadata().map_err(io_error)?.is_file()
        {
            return Err(FsError::MutationRefused(
                "target is not a regular file".into(),
            ));
        }
        if initial.size > max_bytes {
            return Err(FsError::TooLarge(initial.size));
        }
        after_open();
        let mut bytes = Vec::new();
        Read::take(&mut file, max_bytes.saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(io_error)?;
        after_read();
        let named = open_child(directories.parent(), name, false).map_err(|_| FsError::Conflict)?;
        let current = descriptor_state(&file)?;
        let named_state = descriptor_state(&named)?;
        directories.validate()?;
        if current != initial
            || named_state != initial
            || initial.delete_pending
            || bytes.len() as u64 != initial.size
        {
            return Err(FsError::Conflict);
        }
        let (mtime_secs, mtime_nanos) = timestamp(initial.write_time);
        let modified_at =
            chrono::DateTime::from_timestamp(mtime_secs, mtime_nanos).map(|dt| dt.to_rfc3339());
        Ok(super::RegularFileSnapshot {
            bytes,
            size_bytes: initial.size,
            mtime_secs,
            mtime_nanos,
            modified_at,
        })
    }

    #[cfg(test)]
    #[test]
    fn rejects_edit_with_restored_windows_write_time() {
        use std::io::Write;
        use std::time::{Duration, Instant};

        let tmp = tempfile::tempdir().unwrap();
        let named = tmp.path().join("progress.md");
        std::fs::write(&named, b"Pending").unwrap();
        let mut writer = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&named)
            .unwrap();
        let initial = descriptor_state(&writer).unwrap();
        let times =
            std::fs::FileTimes::new().set_modified(writer.metadata().unwrap().modified().unwrap());
        let result = read_regular_snapshot_impl(
            tmp.path(),
            Path::new("progress.md"),
            100,
            || {},
            || {
                writer.write_all(b"Changed").unwrap();
                let deadline = Instant::now() + Duration::from_secs(2);
                loop {
                    writer.set_times(times).unwrap();
                    let current = descriptor_state(&writer).unwrap();
                    assert_eq!(current.size, initial.size);
                    assert_eq!(current.write_time, initial.write_time);
                    if current.change_time != initial.change_time {
                        break;
                    }
                    assert!(
                        Instant::now() < deadline,
                        "filesystem did not update change time"
                    );
                }
            },
        );
        assert!(matches!(result, Err(FsError::Conflict)));
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

pub(crate) fn probe_file_marker(root: &Path, relative: &Path) -> Result<FileMarkerKind, FsError> {
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
        let marker_file = probe_file_marker(&root, std::path::Path::new("plans/plan.md")).unwrap();
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
        let err_sym = read_regular_snapshot(&root, std::path::Path::new("plans/sym.md"), 1024);
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

#[cfg(all(test, any(unix, windows)))]
mod snapshot_tests {
    use std::path::Path;

    #[cfg(unix)]
    use super::unix::read_regular_snapshot_impl;
    #[cfg(windows)]
    use super::windows::read_regular_snapshot_impl;
    use super::{probe_file_marker, read_immediate_dir, read_regular_snapshot, FileMarkerKind};
    use crate::fs::error::FsError;

    #[test]
    fn rejects_atomic_named_replacement_and_next_read_observes_replacement() {
        let tmp = tempfile::tempdir().unwrap();
        let named = tmp.path().join("progress.md");
        let replacement = tmp.path().join("replacement.md");
        std::fs::write(&named, b"Pending").unwrap();
        std::fs::write(&replacement, b"Complete").unwrap();

        let result = read_regular_snapshot_impl(
            tmp.path(),
            Path::new("progress.md"),
            100,
            || {
                std::fs::rename(&replacement, &named).unwrap();
            },
            || {},
        );
        assert!(matches!(result, Err(FsError::Conflict)));
        assert_eq!(
            read_regular_snapshot(tmp.path(), Path::new("progress.md"), 100)
                .unwrap()
                .bytes,
            b"Complete"
        );
    }

    #[test]
    fn rejects_named_file_removed_after_reading() {
        let tmp = tempfile::tempdir().unwrap();
        let named = tmp.path().join("progress.md");
        std::fs::write(&named, b"Pending").unwrap();
        let result = read_regular_snapshot_impl(
            tmp.path(),
            Path::new("progress.md"),
            100,
            || {},
            || {
                std::fs::remove_file(&named).unwrap();
            },
        );
        assert!(matches!(result, Err(FsError::Conflict)));
    }

    #[test]
    fn rejects_same_size_in_place_edit_after_reading() {
        let tmp = tempfile::tempdir().unwrap();
        let named = tmp.path().join("progress.md");
        std::fs::write(&named, b"Pending").unwrap();
        let changed_mtime = std::fs::metadata(&named).unwrap().modified().unwrap()
            + std::time::Duration::from_secs(2);
        let result = read_regular_snapshot_impl(
            tmp.path(),
            Path::new("progress.md"),
            100,
            || {},
            || {
                std::fs::write(&named, b"Changed").unwrap();
                std::fs::OpenOptions::new()
                    .write(true)
                    .open(&named)
                    .unwrap()
                    .set_times(std::fs::FileTimes::new().set_modified(changed_mtime))
                    .unwrap();
            },
        );
        assert!(matches!(result, Err(FsError::Conflict)));
        assert_eq!(
            read_regular_snapshot(tmp.path(), Path::new("progress.md"), 100)
                .unwrap()
                .bytes,
            b"Changed"
        );
    }

    #[test]
    fn rejects_replaced_ancestor_even_when_the_named_file_is_the_same_inode() {
        let tmp = tempfile::tempdir().unwrap();
        let selected = tmp.path().join("plans/selected");
        std::fs::create_dir_all(&selected).unwrap();
        std::fs::write(selected.join("progress.md"), b"Pending").unwrap();
        let old_plans = tmp.path().join("old-plans");

        let result = read_regular_snapshot_impl(
            tmp.path(),
            Path::new("plans/selected/progress.md"),
            100,
            || {
                std::fs::rename(tmp.path().join("plans"), &old_plans).unwrap();
                std::fs::create_dir(tmp.path().join("plans")).unwrap();
                // Preserve the exact selected parent/file objects. Comparing
                // only the final parent or file would miss this replacement.
                std::fs::rename(old_plans.join("selected"), &selected).unwrap();
            },
            || {},
        );
        assert!(matches!(result, Err(FsError::Conflict)));
        assert_eq!(
            read_regular_snapshot(tmp.path(), Path::new("plans/selected/progress.md"), 100)
                .unwrap()
                .bytes,
            b"Pending"
        );
    }

    #[test]
    fn rejects_replaced_root_with_an_unchanged_descendant() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let old_root = tmp.path().join("old-root");
        std::fs::create_dir_all(root.join("plans")).unwrap();
        std::fs::write(root.join("plans/progress.md"), b"Pending").unwrap();

        let result = read_regular_snapshot_impl(
            &root,
            Path::new("plans/progress.md"),
            100,
            || {
                std::fs::rename(&root, &old_root).unwrap();
                std::fs::create_dir(&root).unwrap();
                std::fs::rename(old_root.join("plans"), root.join("plans")).unwrap();
            },
            || {},
        );
        assert!(matches!(result, Err(FsError::Conflict)));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_same_size_edit_with_restored_high_precision_mtime() {
        use std::io::Write;
        use std::os::unix::fs::MetadataExt;
        use std::time::{Duration, Instant, UNIX_EPOCH};

        let tmp = tempfile::tempdir().unwrap();
        let named = tmp.path().join("progress.md");
        std::fs::write(&named, b"Pending").unwrap();
        let mut writer = std::fs::OpenOptions::new()
            .write(true)
            .open(&named)
            .unwrap();
        let modified = UNIX_EPOCH + Duration::new(1_700_000_000, 123_456_789);
        let times = std::fs::FileTimes::new().set_modified(modified);
        writer.set_times(times).unwrap();
        let initial = writer.metadata().unwrap();

        let result = read_regular_snapshot_impl(
            tmp.path(),
            Path::new("progress.md"),
            100,
            || {},
            || {
                writer.write_all(b"Changed").unwrap();
                // Force an observed ctime change even on a low-resolution
                // filesystem; no sleeps, process-global hooks, or read races.
                let deadline = Instant::now() + Duration::from_secs(2);
                loop {
                    writer.set_times(times).unwrap();
                    let current = writer.metadata().unwrap();
                    assert_eq!(current.len(), initial.len());
                    assert_eq!(current.mtime(), initial.mtime());
                    assert_eq!(current.mtime_nsec(), initial.mtime_nsec());
                    if (current.ctime(), current.ctime_nsec())
                        != (initial.ctime(), initial.ctime_nsec())
                    {
                        break;
                    }
                    assert!(Instant::now() < deadline, "filesystem did not update ctime");
                }
            },
        );
        assert!(matches!(result, Err(FsError::Conflict)));
    }

    #[cfg(unix)]
    fn directory_link(target: &Path, link: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[cfg(windows)]
    fn directory_link(target: &Path, link: &Path) {
        // Junction creation needs no Developer Mode or symlink privilege.
        let result = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "junction creation failed: {}",
            String::from_utf8_lossy(&result.stderr)
        );
    }

    #[test]
    fn rejects_linked_ancestor_for_all_strict_read_operations() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let outside = tmp.path().join("outside");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("secret.md"), b"Outside secret").unwrap();
        directory_link(&outside, &root.join("bridge"));

        assert!(probe_file_marker(&root, Path::new("bridge/secret.md")).is_err());
        assert!(read_immediate_dir(&root, Path::new("bridge"), 100).is_err());
        assert!(read_regular_snapshot(&root, Path::new("bridge/secret.md"), 100).is_err());
        assert_eq!(
            std::fs::read(outside.join("secret.md")).unwrap(),
            b"Outside secret"
        );
    }

    #[test]
    fn classifies_linked_leaf_without_traversing_it() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let outside = tmp.path().join("outside");
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(&outside).unwrap();
        directory_link(&outside, &root.join("bridge"));

        assert_eq!(
            probe_file_marker(&root, Path::new("bridge")).unwrap(),
            FileMarkerKind::Symlink
        );
        let (entries, complete) = read_immediate_dir(&root, Path::new(""), 100).unwrap();
        assert!(complete);
        let bridge = entries.iter().find(|entry| entry.name == "bridge").unwrap();
        assert!(bridge.is_symlink);
        assert!(!bridge.is_regular_file);
        assert!(read_regular_snapshot(&root, Path::new("bridge"), 100).is_err());
    }

    #[test]
    fn ordinary_strict_reads_remain_bounded_and_rooted() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("plans")).unwrap();
        std::fs::write(tmp.path().join("plans/plan.md"), b"# Plan").unwrap();
        std::fs::write(tmp.path().join("plans/progress.md"), b"Pending").unwrap();
        let snapshot = read_regular_snapshot(tmp.path(), Path::new("plans/plan.md"), 6).unwrap();
        assert_eq!(snapshot.bytes, b"# Plan");
        assert_eq!(snapshot.size_bytes, 6);
        assert!(snapshot.modified_at.is_some());
        assert!(matches!(
            read_regular_snapshot(tmp.path(), Path::new("plans/plan.md"), 5),
            Err(FsError::TooLarge(6))
        ));
        let (entries, complete) = read_immediate_dir(tmp.path(), Path::new("plans"), 1).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(!complete);
        assert!(entries[0].is_regular_file);
        assert!(matches!(
            read_regular_snapshot(tmp.path(), Path::new("../outside.md"), 100),
            Err(FsError::PathEscape)
        ));
    }
}
