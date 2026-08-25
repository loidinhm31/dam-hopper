use std::{fs, io};

use super::{
    backup_current, delete_handle, managed_store_files, purge_file, quarantine_scope, read_managed,
    recover_backup, replace_staged, write_staged,
};
use crate::ssh_forward::windows_storage_probe::{
    create_new_relative_file, open_relative, open_root,
};
use std::{
    sync::{Arc, Barrier},
    thread,
};

struct Fixture {
    root: std::path::PathBuf,
    outside: std::path::PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let suffix = format!("{}-{}", std::process::id(), unique_nanos());
        let root = std::env::temp_dir().join(format!("dam-hopper-storage-operations-{suffix}"));
        let outside = std::env::temp_dir().join(format!("dam-hopper-storage-outside-{suffix}"));
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        Self { root, outside }
    }

    fn create_scope(&self) -> std::path::PathBuf {
        let scope = self.root.join("scope");
        fs::create_dir(&scope).unwrap();
        for name in managed_store_files() {
            fs::write(scope.join(name), format!("initial-{name}")).unwrap();
        }
        scope
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

fn exercise_file_lifecycle(scope: &std::os::windows::io::OwnedHandle, name: &str) {
    let original = format!("initial-{name}");
    let backup = format!("{name}.backup");
    let staged = format!("{name}.next");
    let replacement = format!("replacement-{name}");

    assert_eq!(read_managed(scope, name).unwrap(), original.as_bytes());
    backup_current(scope, name, &backup).unwrap();
    assert!(read_managed(scope, name).is_err());
    recover_backup(scope, &backup, name).unwrap();
    assert_eq!(read_managed(scope, name).unwrap(), original.as_bytes());
    backup_current(scope, name, &backup).unwrap();
    write_staged(scope, &staged, replacement.as_bytes()).unwrap();
    replace_staged(scope, &staged, name).unwrap();
    assert_eq!(read_managed(scope, name).unwrap(), replacement.as_bytes());
    assert_eq!(read_managed(scope, &backup).unwrap(), original.as_bytes());
}

#[test]
fn store_lifecycle_stays_relative_to_retained_handles() {
    let fixture = Fixture::new();
    fixture.create_scope();
    let root = open_root(&fixture.root).unwrap();
    let scope = open_relative(&root, "scope", true).unwrap();

    for name in managed_store_files() {
        exercise_file_lifecycle(&scope, name);
    }

    quarantine_scope(&scope, &root, "scope.tombstone").unwrap();
    assert!(!fixture.root.join("scope").exists());
    assert_eq!(
        read_managed(&scope, "profiles.toml").unwrap(),
        b"replacement-profiles.toml"
    );

    for name in managed_store_files() {
        purge_file(&scope, name).unwrap();
    }
    for name in managed_store_files() {
        purge_file(&scope, &format!("{name}.backup")).unwrap();
    }
    delete_handle(&scope).unwrap();
    drop(scope);
    assert!(!fixture.root.join("scope.tombstone").exists());
}

#[test]
fn managed_file_hard_links_and_scope_junctions_fail_closed() {
    let fixture = Fixture::new();
    let scope_path = fixture.create_scope();
    for name in managed_store_files() {
        fs::hard_link(
            scope_path.join(name),
            fixture.outside.join(format!("linked-{name}")),
        )
        .unwrap();
    }
    let root = open_root(&fixture.root).unwrap();
    let scope = open_relative(&root, "scope", true).unwrap();
    for name in managed_store_files() {
        assert!(
            read_managed(&scope, name).is_err(),
            "{name} accepted a hard link"
        );
    }
    assert!(backup_current(&scope, "profiles.toml", "profiles.backup").is_err());

    drop(scope);
    fs::remove_dir_all(&scope_path).unwrap();
    let junction = fixture.root.join("scope");
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&junction)
        .arg(&fixture.outside)
        .status()
        .unwrap();
    assert!(status.success(), "junction creation failed");
    assert!(open_relative(&root, "scope", true).is_err());
}

#[test]
fn unsafe_store_components_are_rejected_before_opening() {
    let fixture = Fixture::new();
    fixture.create_scope();
    let root = open_root(&fixture.root).unwrap();
    let scope = open_relative(&root, "scope", true).unwrap();

    for name in [
        "..",
        "../outside",
        "name:stream",
        "name ",
        "name.",
        "bad\u{0000}name",
    ] {
        assert!(read_managed(&scope, name).is_err(), "{name:?} was accepted");
    }
    assert!(read_managed(&scope, &"a".repeat(256)).is_err());
}

#[test]
fn trusted_root_allows_normal_windows_space_and_unicode_components() {
    let fixture = Fixture::new();
    let root = fixture.root.join("Jane Doe").join("用户");
    fs::create_dir_all(&root).unwrap();
    assert!(open_root(&root).is_ok());
}

#[test]
fn oversized_managed_file_is_rejected_before_parsing() {
    let fixture = Fixture::new();
    let scope_path = fixture.create_scope();
    fs::write(
        scope_path.join("profiles.toml"),
        vec![b'x'; 1024 * 1024 + 1],
    )
    .unwrap();
    let root = open_root(&fixture.root).unwrap();
    let scope = open_relative(&root, "scope", true).unwrap();
    assert!(read_managed(&scope, "profiles.toml").is_err());
}

#[test]
fn concurrent_staging_create_has_exactly_one_owner() {
    let fixture = Fixture::new();
    fixture.create_scope();
    let root = open_root(&fixture.root).unwrap();
    let scope = open_relative(&root, "scope", true).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let staging_name = "profiles.toml.tmp-00000000-0000-4000-8000-000000000000";

    let workers = (0..2)
        .map(|_| {
            let scope = scope.try_clone().unwrap();
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                create_new_relative_file(&scope, staging_name)
            })
        })
        .collect::<Vec<_>>();

    let outcomes = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect::<Vec<io::Result<_>>>();
    assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
    let errors = outcomes
        .into_iter()
        .filter_map(Result::err)
        .collect::<Vec<_>>();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].kind(), io::ErrorKind::AlreadyExists);
    assert!(fixture.root.join("scope").join(staging_name).is_file());
}
