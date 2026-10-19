use std::fs;
use std::path::Path;
use std::process::Command;
use tempfile::TempDir;
fn git(args: &[&str], cwd: &Path) -> Vec<u8> {
    let output = Command::new("git")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("git command failed to spawn");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
    output.stdout
}
fn git_try(args: &[&str], cwd: &Path) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
fn init_repo(cwd: &Path) {
    git(&["init", "-b", "main"], cwd);
    git(&["config", "user.name", "Tester"], cwd);
    git(&["config", "user.email", "tester@example.com"], cwd);
    git(&["config", "commit.gpgsign", "false"], cwd);
    git(&["config", "core.autocrlf", "false"], cwd);
}
#[test]
fn test_binary_conflict_exact_side_staging_and_materialization() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);
    let base_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x01\x02\x03";
    let ours_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\xAA\xBB\xCC\xDD";
    let theirs_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x11\x22\x33\x44";
    fs::write(root.join("image.png"), base_bytes).unwrap();
    git(&["add", "image.png"], root);
    git(&["commit", "-m", "base binary"], root);

    git(&["checkout", "-b", "branch-theirs"], root);
    fs::write(root.join("image.png"), theirs_bytes).unwrap();
    git(&["add", "image.png"], root);
    git(&["commit", "-m", "theirs binary"], root);

    git(&["checkout", "main"], root);
    fs::write(root.join("image.png"), ours_bytes).unwrap();
    git(&["add", "image.png"], root);
    git(&["commit", "-m", "ours binary"], root);

    let _ = git_try(&["merge", "branch-theirs"], root);

    let repo = git2::Repository::open(root).unwrap();
    let mut index = repo.index().unwrap();
    assert!(index.has_conflicts(), "index must report conflicts");

    let mut stage3_oid = None;
    let mut stage3_mode = 0;

    for conflict in index.conflicts().unwrap() {
        let c = conflict.unwrap();
        if let Some(their) = c.their {
            stage3_oid = Some(their.id);
            stage3_mode = their.mode;
        }
    }

    let oid3 = stage3_oid.expect("stage 3 OID must exist");
    let blob3 = repo.find_blob(oid3).unwrap();
    assert_eq!(blob3.content(), theirs_bytes);

    // Direct object-database staging: add stage 0 entry matching exact OID & mode
    let entry = git2::IndexEntry {
        ctime: git2::IndexTime::new(0, 0),
        mtime: git2::IndexTime::new(0, 0),
        dev: 0,
        ino: 0,
        mode: stage3_mode,
        uid: 0,
        gid: 0,
        file_size: blob3.content().len() as u32,
        id: oid3,
        flags: 0, // stage 0
        flags_extended: 0,
        path: b"image.png".to_vec(),
    };
    let _ = index.remove(Path::new("image.png"), 1);
    let _ = index.remove(Path::new("image.png"), 2);
    let _ = index.remove(Path::new("image.png"), 3);
    index.add(&entry).unwrap();
    index.write().unwrap();

    // Worktree materialization
    fs::write(root.join("image.png"), blob3.content()).unwrap();

    // Verify stage 0 matches exact chosen OID and mode
    let stage0_entry = index.get_path(Path::new("image.png"), 0).unwrap();
    assert_eq!(stage0_entry.id, oid3);
    assert_eq!(stage0_entry.mode, stage3_mode);
    assert_eq!(fs::read(root.join("image.png")).unwrap(), theirs_bytes);
    assert!(!index.has_conflicts(), "Conflicts cleared on file after resolution");
}
#[test]
fn test_delete_modify_conflict_resolution() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);
    fs::write(root.join("del_mod.txt"), b"initial\n").unwrap();
    git(&["add", "del_mod.txt"], root);
    git(&["commit", "-m", "base"], root);
    git(&["checkout", "-b", "mod-branch"], root);
    fs::write(root.join("del_mod.txt"), b"modified\n").unwrap();
    git(&["add", "del_mod.txt"], root);
    git(&["commit", "-m", "mod"], root);

    git(&["checkout", "main"], root);
    git(&["rm", "del_mod.txt"], root);
    git(&["commit", "-m", "del"], root);

    let _ = git_try(&["merge", "mod-branch"], root);

    let repo = git2::Repository::open(root).unwrap();
    let mut index = repo.index().unwrap();
    assert!(index.has_conflicts());

    index.remove_path(Path::new("del_mod.txt")).unwrap();
    index.write().unwrap();

    let disk_file = root.join("del_mod.txt");
    if disk_file.exists() {
        fs::remove_file(&disk_file).unwrap();
    }

    assert!(!disk_file.exists());
    assert!(!index.has_conflicts(), "Conflicts cleared after delete resolution");
    assert!(index.get_path(Path::new("del_mod.txt"), 0).is_none());
    assert!(index.get_path(Path::new("del_mod.txt"), 1).is_none());
    assert!(index.get_path(Path::new("del_mod.txt"), 2).is_none());
    assert!(index.get_path(Path::new("del_mod.txt"), 3).is_none());
}

#[test]
fn test_injected_stage_failure_after_worktree_write() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    // Create a real merge conflict
    fs::write(root.join("conflict_file.txt"), b"base content\n").unwrap();
    git(&["add", "conflict_file.txt"], root);
    git(&["commit", "-m", "base"], root);

    git(&["checkout", "-b", "side-branch"], root);
    fs::write(root.join("conflict_file.txt"), b"side change\n").unwrap();
    git(&["add", "conflict_file.txt"], root);
    git(&["commit", "-m", "side"], root);

    git(&["checkout", "main"], root);
    fs::write(root.join("conflict_file.txt"), b"main change\n").unwrap();
    git(&["add", "conflict_file.txt"], root);
    git(&["commit", "-m", "main"], root);

    let _ = git_try(&["merge", "side-branch"], root);

    let repo = git2::Repository::open(root).unwrap();
    let index = repo.index().unwrap();
    assert!(index.has_conflicts(), "Must start in conflicted state");

    let resolved_bytes = b"manually resolved text\n";
    let file_path = root.join("conflict_file.txt");
    fs::write(&file_path, resolved_bytes).unwrap();

    let lock_file = root.join(".git/index.lock");
    fs::write(&lock_file, b"simulated lock").unwrap();

    let mut index = repo.index().unwrap();
    let stage_result = index
        .add_path(Path::new("conflict_file.txt"))
        .and_then(|_| index.write());
    assert!(stage_result.is_err(), "Staging must fail when index.lock is held");

    assert_eq!(fs::read(&file_path).unwrap(), resolved_bytes);
    let repo_after = git2::Repository::open(root).unwrap();
    assert!(repo_after.index().unwrap().has_conflicts());
    let _ = fs::remove_file(lock_file);
}
