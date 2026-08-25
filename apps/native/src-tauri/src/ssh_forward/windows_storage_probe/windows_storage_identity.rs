//! Stable file identity and metadata flushes for handle-relative replacement.

use std::{
    io,
    os::windows::io::{AsRawHandle, OwnedHandle},
};

use windows_sys::{
    Wdk::Storage::FileSystem::{
        FileDispositionInformation, NtFlushBuffersFile, NtFlushBuffersFileEx, NtSetInformationFile,
        FILE_DISPOSITION_INFORMATION,
    },
    Win32::{
        Foundation::HANDLE,
        Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLUSH_MIN_METADATA,
        },
        System::IO::IO_STATUS_BLOCK,
    },
};

use super::windows_storage_handle::{
    ntstatus_error, validate_retained_handle, validate_retained_handle_any,
};

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) struct FileIdentity {
    pub(crate) volume_serial_number: u32,
    pub(crate) file_index: u64,
}

impl FileIdentity {
    pub(crate) fn marker(self) -> String {
        format!("{}:{}\n", self.volume_serial_number, self.file_index)
    }

    pub(crate) fn parse_marker(value: &str) -> io::Result<Self> {
        let value = value.trim_end_matches('\n');
        let (volume, index) = value
            .split_once(':')
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid_commit_marker"))?;
        Ok(Self {
            volume_serial_number: volume
                .parse()
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid_commit_marker"))?,
            file_index: index
                .parse()
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid_commit_marker"))?,
        })
    }
}

pub(crate) fn file_identity(handle: &OwnedHandle) -> io::Result<FileIdentity> {
    validate_retained_handle_any(handle)?;
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(handle.as_raw_handle() as HANDLE, &mut info) } == 0 {
        return Err(io::Error::last_os_error());
    }
    if info.nNumberOfLinks != 1 {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "multiple_links"));
    }
    Ok(FileIdentity {
        volume_serial_number: info.dwVolumeSerialNumber,
        file_index: (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
    })
}

pub(crate) fn flush_handle(handle: &OwnedHandle) -> io::Result<()> {
    let mut status = IO_STATUS_BLOCK::default();
    let result = unsafe { NtFlushBuffersFile(handle.as_raw_handle() as HANDLE, &mut status) };
    if result < 0 {
        let metadata_result = unsafe {
            NtFlushBuffersFileEx(
                handle.as_raw_handle() as HANDLE,
                FILE_FLUSH_MIN_METADATA as u32,
                std::ptr::null(),
                0,
                &mut status,
            )
        };
        if metadata_result >= 0 {
            Ok(())
        } else {
            Err(ntstatus_error(metadata_result))
        }
    } else {
        Ok(())
    }
}

pub(crate) fn delete_handle(handle: &OwnedHandle) -> io::Result<()> {
    validate_retained_handle(handle, false)?;
    let mut status = IO_STATUS_BLOCK::default();
    let mut disposition = FILE_DISPOSITION_INFORMATION { DeleteFile: true };
    let result = unsafe {
        NtSetInformationFile(
            handle.as_raw_handle() as HANDLE,
            &mut status,
            &mut disposition as *mut _ as *const _,
            std::mem::size_of::<FILE_DISPOSITION_INFORMATION>() as u32,
            FileDispositionInformation,
        )
    };
    if result < 0 {
        Err(ntstatus_error(result))
    } else {
        Ok(())
    }
}
