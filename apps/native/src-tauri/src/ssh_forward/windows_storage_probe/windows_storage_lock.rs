//! Cross-process byte-range lock held only for one store operation.

use std::{
    io,
    os::windows::io::{AsRawHandle, OwnedHandle},
};

use windows_sys::{
    Wdk::Storage::FileSystem::{NtLockFile, NtUnlockFile},
    Win32::{Foundation::HANDLE, System::IO::IO_STATUS_BLOCK},
};

use super::windows_storage_handle::ntstatus_error;

const LOCK_LENGTH: i64 = 1;

pub(crate) struct FileLockGuard<'a> {
    handle: &'a OwnedHandle,
    offset: i64,
}

pub(crate) fn acquire_file_lock(handle: &OwnedHandle) -> io::Result<FileLockGuard<'_>> {
    acquire_file_lock_at(handle, 0)
}

pub(crate) fn acquire_file_lock_at(
    handle: &OwnedHandle,
    offset: i64,
) -> io::Result<FileLockGuard<'_>> {
    let mut status = IO_STATUS_BLOCK::default();
    let result = unsafe {
        NtLockFile(
            handle.as_raw_handle() as HANDLE,
            std::ptr::null_mut(),
            None,
            std::ptr::null(),
            &mut status,
            &offset,
            &LOCK_LENGTH,
            0,
            true,
            true,
        )
    };
    if result < 0 {
        Err(ntstatus_error(result))
    } else {
        Ok(FileLockGuard { handle, offset })
    }
}

pub(crate) fn release_file_lock_at(handle: &OwnedHandle, offset: i64) {
    let mut status = IO_STATUS_BLOCK::default();
    unsafe {
        NtUnlockFile(
            handle.as_raw_handle() as HANDLE,
            &mut status,
            &offset,
            &LOCK_LENGTH,
            0,
        );
    }
}

impl Drop for FileLockGuard<'_> {
    fn drop(&mut self) {
        release_file_lock_at(self.handle, self.offset);
    }
}
