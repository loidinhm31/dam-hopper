//! Operation-level contained-handle proofs for native SSH-forward storage.

use std::fs::File;
use std::io::{self, Read, Write};
use std::mem::{size_of, MaybeUninit};
use std::os::windows::io::{AsRawHandle, OwnedHandle};

use windows_sys::Wdk::Storage::FileSystem::{
    FileDispositionInformation, FileRenameInformation, NtSetInformationFile,
    FILE_DISPOSITION_INFORMATION, FILE_RENAME_INFORMATION,
};
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::System::IO::IO_STATUS_BLOCK;

use super::windows_storage_component::validate_managed_component;
use super::windows_storage_handle::{
    create_relative_file, ntstatus_error, open_relative, open_relative_for_mutation,
};

const STORE_FILES: [&str; 3] = ["profiles.toml", "known-hosts.toml", "scope-meta.toml"];
const MAX_STORE_BYTES: u64 = 1024 * 1024;

pub(super) fn write_staged(scope: &OwnedHandle, name: &str, contents: &[u8]) -> io::Result<()> {
    let handle = create_relative_file(scope, name)?;
    let mut file = File::from(handle);
    file.set_len(0)?;
    file.write_all(contents)?;
    file.sync_all()
}

pub(super) fn read_managed(scope: &OwnedHandle, name: &str) -> io::Result<Vec<u8>> {
    let handle = open_relative(scope, name, false)?;
    let mut contents = Vec::new();
    File::from(handle)
        .take(MAX_STORE_BYTES + 1)
        .read_to_end(&mut contents)?;
    if contents.len() as u64 > MAX_STORE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "store_file_too_large",
        ));
    }
    Ok(contents)
}

pub(super) fn replace_staged(
    scope: &OwnedHandle,
    staged_name: &str,
    destination_name: &str,
) -> io::Result<()> {
    let staged = open_relative_for_mutation(scope, staged_name)?;
    rename_relative(&staged, scope, destination_name, true)
}

pub(super) fn backup_current(
    scope: &OwnedHandle,
    source_name: &str,
    backup_name: &str,
) -> io::Result<()> {
    let source = open_relative_for_mutation(scope, source_name)?;
    rename_relative(&source, scope, backup_name, true)
}

pub(super) fn recover_backup(
    scope: &OwnedHandle,
    backup_name: &str,
    destination_name: &str,
) -> io::Result<()> {
    let backup = open_relative_for_mutation(scope, backup_name)?;
    rename_relative(&backup, scope, destination_name, true)
}

pub(super) fn quarantine_scope(
    scope: &OwnedHandle,
    root: &OwnedHandle,
    tombstone: &str,
) -> io::Result<()> {
    rename_relative(scope, root, tombstone, false)
}

pub(super) fn purge_file(scope: &OwnedHandle, name: &str) -> io::Result<()> {
    let file = open_relative_for_mutation(scope, name)?;
    delete_handle(&file)
}

pub(super) fn managed_store_files() -> &'static [&'static str] {
    &STORE_FILES
}

pub(super) fn delete_handle(handle: &OwnedHandle) -> io::Result<()> {
    let mut status = IO_STATUS_BLOCK::default();
    let mut disposition = FILE_DISPOSITION_INFORMATION { DeleteFile: true };
    let result = unsafe {
        NtSetInformationFile(
            handle.as_raw_handle() as HANDLE,
            &mut status,
            &mut disposition as *mut _ as *const _,
            size_of::<FILE_DISPOSITION_INFORMATION>() as u32,
            FileDispositionInformation,
        )
    };
    if result < 0 {
        Err(ntstatus_error(result))
    } else {
        Ok(())
    }
}

fn rename_relative(
    source: &OwnedHandle,
    parent: &OwnedHandle,
    name: &str,
    replace: bool,
) -> io::Result<()> {
    validate_managed_component(name)?;
    let wide: Vec<u16> = name.encode_utf16().collect();
    let bytes =
        size_of::<FILE_RENAME_INFORMATION>() - size_of::<u16>() + wide.len() * size_of::<u16>();
    let words = bytes.div_ceil(size_of::<usize>());
    // The Windows ABI ends this structure with a variable-size UTF-16 name.
    // The source and destination remain retained handles; only this component is supplied.
    let mut buffer = vec![MaybeUninit::<usize>::zeroed(); words];
    let info = buffer.as_mut_ptr() as *mut FILE_RENAME_INFORMATION;
    unsafe {
        (*info).Anonymous.ReplaceIfExists = replace;
        (*info).RootDirectory = parent.as_raw_handle() as HANDLE;
        (*info).FileNameLength = (wide.len() * size_of::<u16>()) as u32;
        std::ptr::copy_nonoverlapping(wide.as_ptr(), (*info).FileName.as_mut_ptr(), wide.len());
    }
    let mut status = IO_STATUS_BLOCK::default();
    let result = unsafe {
        NtSetInformationFile(
            source.as_raw_handle() as HANDLE,
            &mut status,
            info.cast(),
            bytes as u32,
            FileRenameInformation,
        )
    };
    if result < 0 {
        Err(ntstatus_error(result))
    } else {
        Ok(())
    }
}

#[cfg(test)]
#[path = "windows_storage_operations_probe_tests.rs"]
mod tests;
