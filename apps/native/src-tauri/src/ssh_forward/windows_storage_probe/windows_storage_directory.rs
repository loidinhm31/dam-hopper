//! Directory enumeration that stays relative to a retained Windows handle.

use std::{
    io,
    mem::offset_of,
    os::windows::io::{AsRawHandle, OwnedHandle},
};

use windows_sys::{
    Wdk::Storage::FileSystem::{
        FileDirectoryInformation, NtQueryDirectoryFile, FILE_DIRECTORY_INFORMATION,
    },
    Win32::{
        Foundation::HANDLE, Storage::FileSystem::FILE_ATTRIBUTE_DIRECTORY,
        System::IO::IO_STATUS_BLOCK,
    },
};

use super::windows_storage_handle::{
    ntstatus_error, open_relative_directory_no_delete, open_relative_for_mutation,
};

const STATUS_NO_MORE_FILES: i32 = 0x8000_0006u32 as i32;
const STATUS_BUFFER_OVERFLOW: i32 = 0x8000_0005u32 as i32;
const BUFFER_SIZE: usize = 64 * 1024;

/// One child retained from a directory enumeration.
pub(crate) struct DirectoryEntry {
    pub(crate) name: String,
    pub(crate) is_directory: bool,
    pub(crate) handle: OwnedHandle,
}

/// Enumerates and retains every direct child without reopening an absolute path.
pub(crate) fn enumerate_directory(parent: &OwnedHandle) -> io::Result<Vec<DirectoryEntry>> {
    enumerate_directory_except(parent, &[])
}

/// Enumerates at most max_entries children while treating an unsafe child
/// as an inventory miss rather than poisoning the entire scan. The strict
/// store enumerator above remains fail-closed for persistence recovery.
pub(crate) fn enumerate_directory_tolerant(
    parent: &OwnedHandle,
    max_entries: usize,
) -> io::Result<Vec<DirectoryEntry>> {
    if max_entries == 0 {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    let mut inspected = 0usize;
    let mut restart_scan = true;

    loop {
        let mut buffer = vec![0u8; BUFFER_SIZE];
        let mut status = IO_STATUS_BLOCK::default();
        let result = unsafe {
            NtQueryDirectoryFile(
                parent.as_raw_handle() as HANDLE,
                std::ptr::null_mut(),
                None,
                std::ptr::null(),
                &mut status,
                buffer.as_mut_ptr().cast(),
                buffer.len() as u32,
                FileDirectoryInformation,
                false,
                std::ptr::null(),
                restart_scan,
            )
        };
        restart_scan = false;
        if result == STATUS_NO_MORE_FILES {
            return Ok(entries);
        }
        if result < 0 && result != STATUS_BUFFER_OVERFLOW {
            return Err(ntstatus_error(result));
        }

        let used = status.Information.min(buffer.len());
        if parse_entries(
            parent,
            &buffer[..used],
            &mut entries,
            &[],
            true,
            &mut inspected,
            max_entries,
        )? {
            return Ok(entries);
        }
        if used == 0 {
            return Ok(entries);
        }
    }
}

/// Enumerates children while leaving known coordination entries unopened.
/// This is needed when the caller already retains a lock or child directory
/// handle whose share mode intentionally excludes mutation opens.
pub(crate) fn enumerate_directory_except(
    parent: &OwnedHandle,
    ignored_names: &[&str],
) -> io::Result<Vec<DirectoryEntry>> {
    let mut entries = Vec::new();
    let mut inspected = 0usize;
    let mut restart_scan = true;

    loop {
        let mut buffer = vec![0u8; BUFFER_SIZE];
        let mut status = IO_STATUS_BLOCK::default();
        let result = unsafe {
            NtQueryDirectoryFile(
                parent.as_raw_handle() as HANDLE,
                std::ptr::null_mut(),
                None,
                std::ptr::null(),
                &mut status,
                buffer.as_mut_ptr().cast(),
                buffer.len() as u32,
                FileDirectoryInformation,
                false,
                std::ptr::null(),
                restart_scan,
            )
        };
        restart_scan = false;
        if result == STATUS_NO_MORE_FILES {
            return Ok(entries);
        }
        if result < 0 && result != STATUS_BUFFER_OVERFLOW {
            return Err(ntstatus_error(result));
        }

        let used = status.Information.min(buffer.len());
        let _ = parse_entries(
            parent,
            &buffer[..used],
            &mut entries,
            ignored_names,
            false,
            &mut inspected,
            usize::MAX,
        )?;
        if used == 0 {
            return Ok(entries);
        }
    }
}

fn parse_entries(
    parent: &OwnedHandle,
    buffer: &[u8],
    entries: &mut Vec<DirectoryEntry>,
    ignored_names: &[&str],
    tolerant: bool,
    inspected: &mut usize,
    max_entries: usize,
) -> io::Result<bool> {
    let name_offset = offset_of!(FILE_DIRECTORY_INFORMATION, FileName);
    let mut offset = 0usize;
    while offset < buffer.len() {
        let remaining = &buffer[offset..];
        if remaining.len() < name_offset || remaining.len() < 64 {
            return Err(invalid_directory());
        }
        let next = read_u32(remaining, 0)? as usize;
        let attributes = read_u32(remaining, 56)?;
        let name_length = read_u32(remaining, 60)? as usize;
        let record_length = if next == 0 { remaining.len() } else { next };
        if record_length < name_offset
            || record_length > remaining.len()
            || !name_length.is_multiple_of(2)
            || name_length > record_length - name_offset
        {
            return Err(invalid_directory());
        }
        let name_bytes = &remaining[name_offset..name_offset + name_length];
        let name = String::from_utf16(
            &name_bytes
                .chunks_exact(2)
                .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                .collect::<Vec<_>>(),
        )
        .map_err(|_| invalid_directory())?;
        if name != "." && name != ".." && !ignored_names.iter().any(|ignored| *ignored == name) {
            if tolerant {
                if *inspected >= max_entries {
                    return Ok(true);
                }
                *inspected += 1;
            }
            let is_directory = attributes & FILE_ATTRIBUTE_DIRECTORY != 0;
            let handle = if is_directory {
                open_relative_directory_no_delete(parent, &name)
            } else {
                open_relative_for_mutation(parent, &name)
            };
            let handle = match handle {
                Ok(handle) => handle,
                Err(_error) if tolerant => {
                    if next == 0 {
                        break;
                    }
                    offset = offset.checked_add(next).ok_or_else(invalid_directory)?;
                    continue;
                }
                Err(error) => return Err(error),
            };
            entries.push(DirectoryEntry {
                name,
                is_directory,
                handle,
            });
        }
        if next == 0 {
            break;
        }
        offset = offset.checked_add(next).ok_or_else(invalid_directory)?;
    }
    Ok(false)
}

fn read_u32(bytes: &[u8], offset: usize) -> io::Result<u32> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or_else(invalid_directory)?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

fn invalid_directory() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "invalid_directory_entry")
}
