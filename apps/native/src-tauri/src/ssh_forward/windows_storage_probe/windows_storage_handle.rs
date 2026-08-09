//! Handle-relative Windows file opening used by the storage feasibility gate.

use std::ffi::c_void;
use std::io;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::ptr::null;

use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
use windows_sys::Wdk::Storage::FileSystem::{
    NtCreateFile, FILE_DIRECTORY_FILE, FILE_NON_DIRECTORY_FILE, FILE_OPEN, FILE_OPEN_IF,
    FILE_OPEN_REPARSE_POINT, FILE_SYNCHRONOUS_IO_NONALERT,
};
use windows_sys::Win32::Foundation::{
    HANDLE, INVALID_HANDLE_VALUE, OBJ_CASE_INSENSITIVE, UNICODE_STRING,
};
use windows_sys::Win32::Storage::FileSystem::{
    FileAttributeTagInfo, GetFileInformationByHandle, GetFileInformationByHandleEx, GetFileType,
    BY_HANDLE_FILE_INFORMATION, DELETE, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_ATTRIBUTE_TAG_INFO, FILE_DELETE_CHILD, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
    FILE_LIST_DIRECTORY, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TRAVERSE,
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

fn open_relative_with_access(
    parent: &OwnedHandle,
    name: &str,
    directory: bool,
    access: u32,
    disposition: u32,
    managed_component: bool,
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
            SHARES,
            disposition,
            options,
            null(),
            0,
        )
    };
    if result < 0 {
        return Err(io::Error::from_raw_os_error(result));
    }
    reject_invalid_handle(raw)?;
    let owned = unsafe { OwnedHandle::from_raw_handle(raw) };
    if let Err(error) = validate_handle(owned.as_raw_handle() as HANDLE, directory) {
        drop(owned);
        return Err(error);
    }
    Ok(owned)
}

pub(super) fn open_relative(
    parent: &OwnedHandle,
    name: &str,
    directory: bool,
) -> io::Result<OwnedHandle> {
    let access = if directory {
        FILE_READ_ATTRIBUTES
            | FILE_LIST_DIRECTORY
            | FILE_TRAVERSE
            | FILE_DELETE_CHILD
            | DELETE
            | SYNCHRONIZE
    } else {
        FILE_GENERIC_READ | SYNCHRONIZE
    };
    open_relative_with_access(parent, name, directory, access, FILE_OPEN, !directory)
}

pub(super) fn open_relative_for_traversal(
    parent: &OwnedHandle,
    name: &str,
) -> io::Result<OwnedHandle> {
    open_relative_with_access(
        parent,
        name,
        true,
        FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY | FILE_TRAVERSE | SYNCHRONIZE,
        FILE_OPEN,
        false,
    )
}

pub(super) fn open_relative_for_mutation(
    parent: &OwnedHandle,
    name: &str,
) -> io::Result<OwnedHandle> {
    open_relative_with_access(
        parent,
        name,
        false,
        FILE_GENERIC_READ | FILE_GENERIC_WRITE | DELETE | SYNCHRONIZE,
        FILE_OPEN,
        true,
    )
}

pub(super) fn create_relative_file(parent: &OwnedHandle, name: &str) -> io::Result<OwnedHandle> {
    open_relative_with_access(
        parent,
        name,
        false,
        FILE_GENERIC_READ | FILE_GENERIC_WRITE | DELETE | SYNCHRONIZE,
        FILE_OPEN_IF,
        true,
    )
}
