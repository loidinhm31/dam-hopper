//! Windows atomic-replace and runtime-lock feasibility gate.

use std::fs::{self, OpenOptions};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::ptr::null;

use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_WRITE_THROUGH};

fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn fixture_dir() -> PathBuf {
    let suffix = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let path = std::env::temp_dir().join(format!("dam-hopper-atomic-{suffix}"));
    fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn same_directory_replace_is_atomic_and_lock_is_exclusive() {
    let root = fixture_dir();
    let current = root.join("meta");
    let replacement = root.join("meta.tmp");
    let backup = root.join("meta.bak");
    let lock_path = root.join("runtime.lock");
    fs::write(&current, b"before").unwrap();
    fs::write(&replacement, b"after").unwrap();

    let current_wide = wide(&current);
    let replacement_wide = wide(&replacement);
    let backup_wide = wide(&backup);
    let replaced = unsafe {
        ReplaceFileW(
            current_wide.as_ptr(),
            replacement_wide.as_ptr(),
            backup_wide.as_ptr(),
            REPLACEFILE_WRITE_THROUGH,
            null(),
            null(),
        )
    };
    assert_ne!(replaced, 0);
    assert_eq!(fs::read(&current).unwrap(), b"after");
    assert_eq!(fs::read(&backup).unwrap(), b"before");

    let held = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .share_mode(0)
        .open(&lock_path)
        .unwrap();
    assert!(OpenOptions::new()
        .read(true)
        .write(true)
        .open(&lock_path)
        .is_err());
    drop(held);
    fs::remove_dir_all(root).unwrap();
}
