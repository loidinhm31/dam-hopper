//! Windows handle gate for contained, reparse-safe storage operations.

use std::fs::OpenOptions;
use std::io;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, IntoRawHandle, OwnedHandle};
use std::path::{Component, Path, Prefix};
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::Storage::FileSystem::{
    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_LIST_DIRECTORY,
    FILE_READ_ATTRIBUTES, FILE_TRAVERSE,
};

mod windows_storage_component;
mod windows_storage_directory;
mod windows_storage_handle;
mod windows_storage_identity;
mod windows_storage_lock;

use windows_storage_handle::{validate_handle, SHARES, SYNCHRONIZE};

pub(crate) use windows_storage_directory::{
    enumerate_directory, enumerate_directory_except, DirectoryEntry,
};
pub(crate) use windows_storage_handle::open_relative_for_traversal;
pub(crate) use windows_storage_handle::{
    create_new_relative_file, ntstatus_error, open_activity_lock_file,
    open_exclusive_relative_file, open_or_create_relative_directory_no_delete,
    open_or_create_scope_directory, open_relative, open_relative_directory_for_deletion_no_delete,
    open_relative_directory_no_delete, open_relative_directory_shared, open_relative_for_mutation,
    open_root_directory, open_scope_directory_existing, open_scope_operation_file,
    validate_retained_handle,
};
pub(crate) use windows_storage_identity::{
    delete_handle, file_identity, flush_handle, FileIdentity,
};
pub(crate) use windows_storage_lock::{
    acquire_file_lock, acquire_file_lock_at, release_file_lock_at,
};

fn open_volume_root(path: &Path) -> io::Result<OwnedHandle> {
    let file = OpenOptions::new()
        .read(true)
        .access_mode(FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | FILE_TRAVERSE | SYNCHRONIZE)
        .share_mode(SHARES)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)?;
    let raw = file.into_raw_handle();
    let owned = unsafe { OwnedHandle::from_raw_handle(raw) };
    validate_handle(owned.as_raw_handle() as HANDLE, true)?;
    Ok(owned)
}

/// Opens the final managed directory as a retained handle.
///
/// Traversal handles are used only to reach that directory without following a
/// reparse entry. Later operations stay relative to the returned handle, so
/// they never need to reopen an ancestor by path.
pub(crate) fn open_root(path: &Path) -> io::Result<OwnedHandle> {
    let mut components = path.components();
    let volume_root = match components.next() {
        Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_)) => {
            let mut volume_root = prefix.as_os_str().to_os_string();
            volume_root.push("\\");
            volume_root
        }
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "unsafe_root_prefix",
            ))
        }
    };
    if !matches!(components.next(), Some(Component::RootDir)) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "unsafe_root_path",
        ));
    }

    let names = components
        .map(|component| match component {
            Component::Normal(name) => name.to_str().ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "non_unicode_component")
            }),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "unsafe_root_path",
            )),
        })
        .collect::<io::Result<Vec<_>>>()?;

    let mut current = open_volume_root(Path::new(&volume_root))?;
    for (index, name) in names.iter().enumerate() {
        current = if index + 1 == names.len() {
            open_root_directory(&current, name)?
        } else {
            open_relative_for_traversal(&current, name)?
        };
    }
    Ok(current)
}

#[cfg(test)]
#[path = "windows_storage_probe_tests.rs"]
mod tests;

#[cfg(test)]
mod windows_storage_operations_probe;
