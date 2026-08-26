use std::fs;
use std::os::windows::io::{AsRawHandle, OwnedHandle};
use std::path::PathBuf;

use super::open_relative;
use super::open_root;

struct Fixture {
    root: PathBuf,
    outside: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let suffix = format!("{}-{}", std::process::id(), unique_nanos());
        let root = std::env::temp_dir().join(format!("dam-hopper-storage-{suffix}"));
        let outside = std::env::temp_dir().join(format!("dam-hopper-outside-{suffix}"));
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        Self { root, outside }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
        let _ = fs::remove_dir_all(&self.outside);
    }
}

fn unique_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

#[test]
fn retained_handles_reject_reparse_points_and_hard_links() {
    let fixture = Fixture::new();
    let scope = fixture.root.join("scope");
    fs::create_dir(&scope).unwrap();
    fs::write(scope.join("meta"), b"safe").unwrap();
    fs::write(fixture.outside.join("escaped"), b"outside").unwrap();

    let root_handle = open_root(&fixture.root).unwrap();
    let scope_handle = open_relative(&root_handle, "scope", true).unwrap();
    let retained_file: OwnedHandle = open_relative(&scope_handle, "meta", false).unwrap();

    let junction = fixture.root.join("junction");
    let junction_status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&junction)
        .arg(&fixture.outside)
        .status()
        .unwrap();
    assert!(junction_status.success(), "junction creation failed");
    assert!(open_relative(&root_handle, "junction", true).is_err());
    assert!(!retained_file.as_raw_handle().is_null());

    fs::hard_link(scope.join("meta"), fixture.root.join("linked-meta")).unwrap();
    assert!(open_relative(&root_handle, "linked-meta", false).is_err());
    drop(scope_handle);
    drop(root_handle);
}

#[test]
fn root_open_rejects_an_ancestor_junction() {
    let fixture = Fixture::new();
    let escaped_directory = fixture.outside.join("escaped-directory");
    fs::create_dir(&escaped_directory).unwrap();
    let junction = fixture.root.join("ancestor-junction");
    let junction_status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&junction)
        .arg(&fixture.outside)
        .status()
        .unwrap();
    assert!(junction_status.success(), "junction creation failed");

    assert!(open_root(&junction.join("escaped-directory")).is_err());
}

#[test]
fn retained_managed_handle_blocks_a_name_swap() {
    let fixture = Fixture::new();
    let managed = fixture.root.join("managed");
    let moved = fixture.outside.join("moved-managed");
    fs::create_dir(&managed).unwrap();
    fs::write(managed.join("meta"), b"safe").unwrap();

    let managed_handle = open_root(&managed).unwrap();
    assert!(fs::rename(&managed, &moved).is_err());
    assert!(open_relative(&managed_handle, "meta", false).is_ok());
}
