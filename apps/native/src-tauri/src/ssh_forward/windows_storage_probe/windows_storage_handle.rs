//! Handle-relative Windows file opening used by the storage feasibility gate.

use std::ffi::c_void;
use std::io;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::ptr::null;

use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
use windows_sys::Wdk::Storage::FileSystem::{
    NtCreateFile, FILE_CREATE, FILE_DIRECTORY_FILE, FILE_NON_DIRECTORY_FILE, FILE_OPEN,
    FILE_OPEN_IF, FILE_OPEN_REPARSE_POINT, FILE_SYNCHRONOUS_IO_NONALERT,
};
use windows_sys::Win32::Foundation::{
    RtlNtStatusToDosError, HANDLE, INVALID_HANDLE_VALUE, OBJ_CASE_INSENSITIVE, UNICODE_STRING,
};
use windows_sys::Win32::Storage::FileSystem::{
    FileAttributeTagInfo, GetFileInformationByHandle, GetFileInformationByHandleEx, GetFileType,
    BY_HANDLE_FILE_INFORMATION, DELETE, FILE_ADD_FILE, FILE_ADD_SUBDIRECTORY,
    FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO,
    FILE_DELETE_CHILD, FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_LIST_DIRECTORY,
    FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TRAVERSE,
    FILE_TYPE_DISK,
};
use windows_sys::Win32::System::IO::IO_STATUS_BLOCK;

use super::windows_storage_component::{validate_managed_component, validate_root_component};

pub(super) const SHARES: u32 = FILE_SHARE_READ | FILE_SHARE_WRITE;
pub(super) const SYNCHRONIZE: u32 = 0x0010_0000;

fn reject_invalid_handle(handle: HANDLE) -> io::Result<()> {
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

pub(crate) fn ntstatus_error(status: i32) -> io::Error {
    io::Error::from_raw_os_error(unsafe { RtlNtStatusToDosError(status) } as i32)
}

pub(super) fn validate_handle(handle: HANDLE, directory: bool) -> io::Result<()> {
    let mut tag = FILE_ATTRIBUTE_TAG_INFO::default();
    let ok = unsafe {
        GetFileInformationByHandleEx(
            handle,
            FileAttributeTagInfo,
            &mut tag as *mut _ as *mut c_void,
            std::mem::size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32,
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    if tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "reparse_point"));
    }
    if directory != (tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "wrong_file_kind",
        ));
    }
    if !directory {
        if unsafe { GetFileType(handle) } != FILE_TYPE_DISK {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "not_disk_file"));
        }
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        if unsafe { GetFileInformationByHandle(handle, &mut info) } == 0 {
            return Err(io::Error::last_os_error());
        }
        if info.nNumberOfLinks != 1 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "multiple_links"));
        }
    }
    Ok(())
}

/// Rechecks a retained managed handle immediately before an operation. This
/// catches post-open reparse or hard-link changes without reopening by path.
pub(crate) fn validate_retained_handle(handle: &OwnedHandle, directory: bool) -> io::Result<()> {
    validate_handle(handle.as_raw_handle() as HANDLE, directory)
}

pub(crate) fn validate_retained_handle_any(handle: &OwnedHandle) -> io::Result<()> {
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(handle.as_raw_handle() as HANDLE, &mut info) } == 0 {
        return Err(io::Error::last_os_error());
    }
    validate_handle(
        handle.as_raw_handle() as HANDLE,
        info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0,
    )
}

fn open_relative_with_access(
    parent: &OwnedHandle,
    name: &str,
    directory: bool,
    access: u32,
    disposition: u32,
    managed_component: bool,
) -> io::Result<OwnedHandle> {
    open_relative_with_access_and_shares(
        parent,
        name,
        directory,
        access,
        disposition,
        managed_component,
        SHARES,
    )
}

fn open_relative_with_access_and_shares(
    parent: &OwnedHandle,
    name: &str,
    directory: bool,
    access: u32,
    disposition: u32,
    managed_component: bool,
    shares: u32,
) -> io::Result<OwnedHandle> {
    if managed_component {
        validate_managed_component(name)?;
    } else {
        validate_root_component(name)?;
    }
    let mut wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let unicode = UNICODE_STRING {
        Length: ((wide.len() - 1) * 2) as u16,
        MaximumLength: (wide.len() * 2) as u16,
        Buffer: wide.as_mut_ptr(),
    };
    let attributes = OBJECT_ATTRIBUTES {
        Length: std::mem::size_of::<OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: parent.as_raw_handle() as HANDLE,
        ObjectName: &unicode,
        Attributes: OBJ_CASE_INSENSITIVE,
        SecurityDescriptor: null(),
        SecurityQualityOfService: null(),
    };
    let mut status = IO_STATUS_BLOCK::default();
    let mut raw = INVALID_HANDLE_VALUE;
    let options = FILE_OPEN_REPARSE_POINT
        | FILE_SYNCHRONOUS_IO_NONALERT
        | if directory {
            FILE_DIRECTORY_FILE
        } else {
            FILE_NON_DIRECTORY_FILE
        };
    let result = unsafe {
        NtCreateFile(
            &mut raw,
            access,
            &attributes,
            &mut status,
            null(),
            0,
            shares,
            disposition,
            options,
            null(),
            0,
        )
    };
    if result < 0 {
        return Err(ntstatus_error(result));
    }
    reject_invalid_handle(raw)?;
    let owned = unsafe { OwnedHandle::from_raw_handle(raw) };
    if let Err(error) = validate_handle(owned.as_raw_handle() as HANDLE, directory) {
        drop(owned);
        return Err(error);
    }
    Ok(owned)
}

pub(crate) fn open_relative(
    parent: &OwnedHandle,
    name: &str,
    directory: bool,
) -> io::Result<OwnedHandle> {
    let access = if directory {
        FILE_READ_ATTRIBUTES
            | FILE_LIST_DIRECTORY
            | FILE_TRAVERSE
            | FILE_DELETE_CHILD
            | FILE_ADD_FILE
            | FILE_ADD_SUBDIRECTORY
            | FILE_GENERIC_WRITE
            | DELETE
            | SYNCHRONIZE
    } else {
        FILE_GENERIC_READ | SYNCHRONIZE
    };
    open_relative_with_access(parent, name, directory, access, FILE_OPEN, !directory)
}

/// Opens the retained app-config root for traversal and child creation while
/// preserving the no-delete-share fence that blocks a name swap.
pub(crate) fn open_root_directory(parent: &OwnedHandle, name: &str) -> io::Result<OwnedHandle> {
    open_relative_with_access_and_shares(
        parent,
        name,
        true,
        FILE_READ_ATTRIBUTES
            | FILE_LIST_DIRECTORY
            | FILE_TRAVERSE
            | FILE_ADD_FILE
            | FILE_ADD_SUBDIRECTORY
            | FILE_GENERIC_WRITE
            | SYNCHRONIZE,
        FILE_OPEN,
        false,
        SHARES,
    )
}

pub(crate) fn open_relative_for_traversal(
    parent: &OwnedHandle,
    name: &str,
) -> io::Result<OwnedHandle> {
    open_relative_with_access_and_shares(
        parent,
        name,
        true,
        FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY | FILE_TRAVERSE | SYNCHRONIZE,
        FILE_OPEN,
        false,
        SHARES,
    )
}

pub(crate) fn open_or_create_relative_directory_no_delete(
    parent: &OwnedHandle,
    name: &str,
) -> io::Result<OwnedHandle> {
    open_relative_with_access_and_shares(
        parent,
        name,
        true,
        FILE_READ_ATTRIBUTES
            | FILE_LIST_DIRECTORY
            | FILE_TRAVERSE
            | FILE_ADD_FILE
            | FILE_ADD_SUBDIRECTORY
            | FILE_GENERIC_WRITE
            | SYNCHRONIZE,
        FILE_OPEN_IF,
        false,
        SHARES,
    )
}

fn open_scope_directory(
    parent: &OwnedHandle,
    name: &str,
    disposition: u32,
) -> io::Result<OwnedHandle> {
    open_relative_with_access_and_shares(
        parent,
        name,
        true,
        FILE_READ_ATTRIBUTES
            | FILE_LIST_DIRECTORY
            | FILE_TRAVERSE
            | FILE_ADD_FILE
            | FILE_ADD_SUBDIRECTORY
            | FILE_GENERIC_WRITE
            | SYNCHRONIZE,
        disposition,
        false,
        SHARES,
    )
}

pub(crate) fn open_or_create_scope_directory(
    parent: &OwnedHandle,
    name: &str,
) -> io::Result<OwnedHandle> {
    open_scope_directory(parent, name, FILE_OPEN_IF)
}

pub(crate) fn open_scope_directory_existing(
    parent: &OwnedHandle,
    name: &str,
) -> io::Result<OwnedHandle> {
    open_scope_directory(parent, name, FILE_OPEN)
}

pub(crate) fn open_relative_directory_shared(
    parent: &OwnedHandle,
    name: &str,
) -> io::Result<OwnedHandle> {
    open_relative_with_access_and_shares(
        parent,
        name,
        true,
        FILE_READ_ATTRIBUTES
            | FILE_LIST_DIRECTORY
            | FILE_TRAVERSE
            | FILE_DELETE_CHILD
            | FILE_ADD_FILE
            | FILE_ADD_SUBDIRECTORY
            | FILE_GENERIC_WRITE
            | DELETE
            | SYNCHRONIZE,
        FILE_OPEN,
        false,
        SHARES | FILE_SHARE_DELETE,
    )
}

fn open_relative_directory_no_delete_with_disposition(
    parent: &OwnedHandle,
    name: &str,
    disposition: u32,
) -> io::Result<OwnedHandle> {
    open_relative_with_access_and_shares(
        parent,
        name,
        true,
        FILE_READ_ATTRIBUTES
            | FILE_LIST_DIRECTORY
            | FILE_TRAVERSE
            | FILE_ADD_FILE
            | FILE_ADD_SUBDIRECTORY
            | FILE_GENERIC_WRITE
            | SYNCHRONIZE,
        disposition,
        false,
        SHARES,
    )
}

pub(crate) fn open_relative_directory_no_delete(
    parent: &OwnedHandle,
    name: &str,
) -> io::Result<OwnedHandle> {
    open_relative_directory_no_delete_with_disposition(parent, name, FILE_OPEN)
}

pub(crate) fn open_relative_directory_for_deletion_no_delete(
    parent: &OwnedHandle,
    name: &str,
) -> io::Result<OwnedHandle> {
    open_relative_with_access_and_shares(
        parent,
        name,
        true,
        FILE_READ_ATTRIBUTES
            | FILE_LIST_DIRECTORY
            | FILE_TRAVERSE
            | FILE_DELETE_CHILD
            | FILE_ADD_FILE
            | FILE_ADD_SUBDIRECTORY
            | FILE_GENERIC_WRITE
            | DELETE
            | SYNCHRONIZE,
        FILE_OPEN,
        false,
        SHARES,
    )
}

pub(crate) fn open_relative_for_mutation(
    parent: &OwnedHandle,
    name: &str,
) -> io::Result<OwnedHandle> {
    // Hold an operation handle that permits only concurrent reads. A new
    // writer, delete, reparse, or hard-link operation must wait until the
    // retained-handle mutation completes.
    open_relative_with_access_and_shares(
        parent,
        name,
        false,
        FILE_GENERIC_READ | FILE_GENERIC_WRITE | DELETE | SYNCHRONIZE,
        FILE_OPEN,
        true,
        FILE_SHARE_READ,
    )
}

pub(crate) fn create_relative_file(parent: &OwnedHandle, name: &str) -> io::Result<OwnedHandle> {
    open_relative_with_access(
        parent,
        name,
        false,
        FILE_GENERIC_READ | FILE_GENERIC_WRITE | DELETE | SYNCHRONIZE,
        FILE_OPEN_IF,
        true,
    )
}

/// Creates a collision-resistant staging file. Existing names are rejected.
pub(crate) fn create_new_relative_file(
    parent: &OwnedHandle,
    name: &str,
) -> io::Result<OwnedHandle> {
    open_relative_with_access(
        parent,
        name,
        false,
        FILE_GENERIC_READ | FILE_GENERIC_WRITE | DELETE | SYNCHRONIZE,
        FILE_CREATE,
        true,
    )
}

/// Opens the feature-wide lock file; byte-range ownership is acquired per operation.
pub(crate) fn open_exclusive_relative_file(
    parent: &OwnedHandle,
    name: &str,
) -> io::Result<OwnedHandle> {
    open_lock_file(parent, name, FILE_SHARE_READ | FILE_SHARE_WRITE, false)
}

pub(crate) fn open_activity_lock_file(parent: &OwnedHandle, name: &str) -> io::Result<OwnedHandle> {
    open_lock_file(parent, name, FILE_SHARE_READ | FILE_SHARE_WRITE, false)
}

pub(crate) fn open_scope_operation_file(
    parent: &OwnedHandle,
    name: &str,
) -> io::Result<OwnedHandle> {
    open_lock_file(parent, name, FILE_SHARE_READ | FILE_SHARE_WRITE, true)
}

fn open_lock_file(
    parent: &OwnedHandle,
    name: &str,
    shares: u32,
    delete_access: bool,
) -> io::Result<OwnedHandle> {
    if !name
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "unsafe_component",
        ));
    }
    let mut wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let unicode = UNICODE_STRING {
        Length: ((wide.len() - 1) * 2) as u16,
        MaximumLength: (wide.len() * 2) as u16,
        Buffer: wide.as_mut_ptr(),
    };
    let attributes = OBJECT_ATTRIBUTES {
        Length: std::mem::size_of::<OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: parent.as_raw_handle() as HANDLE,
        ObjectName: &unicode,
        Attributes: OBJ_CASE_INSENSITIVE,
        SecurityDescriptor: null(),
        SecurityQualityOfService: null(),
    };
    let mut status = IO_STATUS_BLOCK::default();
    let mut raw = INVALID_HANDLE_VALUE;
    let access = FILE_GENERIC_READ
        | FILE_GENERIC_WRITE
        | SYNCHRONIZE
        | if delete_access { DELETE } else { 0 };
    let result = unsafe {
        NtCreateFile(
            &mut raw,
            access,
            &attributes,
            &mut status,
            null(),
            0,
            shares,
            FILE_OPEN_IF,
            FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
            null(),
            0,
        )
    };
    if result < 0 {
        return Err(ntstatus_error(result));
    }
    reject_invalid_handle(raw)?;
    let owned = unsafe { OwnedHandle::from_raw_handle(raw) };
    validate_handle(owned.as_raw_handle() as HANDLE, false)?;
    Ok(owned)
}
