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
        use std::os::windows::fs::MetadataExt;
        return Ok(DirectoryIdentity {
            volume_serial: metadata.volume_serial_number(),
            file_index: metadata.file_index(),
        });
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = metadata;
        Ok(DirectoryIdentity { marker: () })
    }
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

#[cfg(all(test, unix))]
mod tests {
    use super::write_bytes;
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
}
