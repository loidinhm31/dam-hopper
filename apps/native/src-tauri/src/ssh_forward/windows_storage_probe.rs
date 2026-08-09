//! Windows handle gate for contained, reparse-safe storage operations.

use std::ffi::c_void;
use std::fs::OpenOptions;
use std::io;
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, IntoRawHandle, OwnedHandle};
use std::path::{Component, Path, Prefix};
use std::ptr::null;

use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
use windows_sys::Wdk::Storage::FileSystem::{
    NtCreateFile, FILE_DIRECTORY_FILE, FILE_NON_DIRECTORY_FILE, FILE_OPEN, FILE_OPEN_REPARSE_POINT,
    FILE_SYNCHRONOUS_IO_NONALERT,
};
use windows_sys::Win32::Foundation::{
    HANDLE, INVALID_HANDLE_VALUE, OBJ_CASE_INSENSITIVE, UNICODE_STRING,
};
use windows_sys::Win32::Storage::FileSystem::{
    FileAttributeTagInfo, GetFileInformationByHandle, GetFileInformationByHandleEx,
    BY_HANDLE_FILE_INFORMATION, DELETE, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_ATTRIBUTE_TAG_INFO, FILE_DELETE_CHILD, FILE_FLAG_BACKUP_SEMANTICS,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_GENERIC_READ, FILE_LIST_DIRECTORY, FILE_READ_ATTRIBUTES,
    FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TRAVERSE,
};
use windows_sys::Win32::System::IO::IO_STATUS_BLOCK;

const SHARES: u32 = FILE_SHARE_READ | FILE_SHARE_WRITE;
const SYNCHRONIZE: u32 = 0x0010_0000;

fn reject_invalid_handle(handle: HANDLE) -> io::Result<()> {
    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn validate_handle(handle: HANDLE, directory: bool) -> io::Result<()> {
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
) -> io::Result<OwnedHandle> {
    if name.is_empty() || name == "." || name == ".." || name.chars().any(|c| c == '\\' || c == '/')
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
            FILE_OPEN,
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

fn open_relative(parent: &OwnedHandle, name: &str, directory: bool) -> io::Result<OwnedHandle> {
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
    open_relative_with_access(parent, name, directory, access)
}

fn open_relative_for_traversal(parent: &OwnedHandle, name: &str) -> io::Result<OwnedHandle> {
    open_relative_with_access(
        parent,
        name,
        true,
        FILE_READ_ATTRIBUTES | FILE_LIST_DIRECTORY | FILE_TRAVERSE | SYNCHRONIZE,
    )
}

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
fn open_root(path: &Path) -> io::Result<OwnedHandle> {
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
            open_relative(&current, name, true)?
        } else {
            open_relative_for_traversal(&current, name)?
        };
    }
    Ok(current)
}

#[cfg(test)]
#[path = "windows_storage_probe_tests.rs"]
mod tests;
