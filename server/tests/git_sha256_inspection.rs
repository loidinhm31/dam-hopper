use std::path::Path;
use std::process::Command;
use tempfile::TempDir;

use dam_hopper_server::error::GitBlameError;
use dam_hopper_server::git::{
    get_commit_details, get_commit_file_diff, get_commit_files, get_log, get_status,
};

fn run_git(args: &[&str], cwd: &Path, envs: &[(&str, &str)]) -> std::process::Output {
    let mut cmd = Command::new("git");
    cmd.args(["--no-replace-objects", "-c", "safe.directory=*"])
        .env("GIT_NO_REPLACE_OBJECTS", "1")
        .args(args)
        .current_dir(cwd);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let output = cmd.output().expect("failed to spawn git command");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn git_stdout(args: &[&str], cwd: &Path) -> String {
    let out = run_git(args, cwd, &[]);
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn create_sha256_fixture() -> (TempDir, String, String, String) {
    let dir = TempDir::new().unwrap();
    let path = dir.path();

    // 1. Initialize pure SHA-256 repository
    run_git(&["init", "--object-format=sha256", "-b", "main"], path, &[]);
    run_git(&["config", "user.name", "Alice Dev"], path, &[]);
    run_git(&["config", "user.email", "alice@example.com"], path, &[]);

    // 2. Root commit with author Alice Dev and committer Alice Dev (+07:00)
    std::fs::write(path.join("file1.txt"), "hello world\nline 2\n").unwrap();
    std::fs::write(path.join("file2.txt"), "secondary file\n").unwrap();
    run_git(&["add", "file1.txt", "file2.txt"], path, &[]);

    run_git(
        &[
            "commit",
            "-m",
            "feat(core): initial sha256 root commit\n\nFull root commit message body.\nSigned-off-by: Alice Dev <alice@example.com>",
        ],
        path,
        &[
            ("GIT_AUTHOR_NAME", "Alice Dev"),
            ("GIT_AUTHOR_EMAIL", "alice@example.com"),
            ("GIT_AUTHOR_DATE", "2026-10-06T10:00:00+07:00"),
            ("GIT_COMMITTER_NAME", "Alice Dev"),
            ("GIT_COMMITTER_EMAIL", "alice@example.com"),
            ("GIT_COMMITTER_DATE", "2026-10-06T10:00:00+07:00"),
        ],
    );

    let root_hash = git_stdout(&["rev-parse", "HEAD"], path);
    assert_eq!(root_hash.len(), 64);

    let root_tree = git_stdout(&["rev-parse", "HEAD^{tree}"], path);
    assert_eq!(root_tree.len(), 64);

    // 3. Second commit with distinct committer Bob (+02:00) and renames/modifications
    std::fs::write(
        path.join("file1.txt"),
        "hello world\nline 2 modified\nline 3 added\n",
    )
    .unwrap();
    run_git(&["mv", "file2.txt", "file2_renamed.txt"], path, &[]);
    std::fs::write(path.join("file3.txt"), "third new file\n").unwrap();
    run_git(&["add", "file1.txt", "file3.txt"], path, &[]);

    run_git(
        &[
            "commit",
            "-m",
            "refactor(engine): update files and rename\n\nDetailed second commit description.\nAcross multiple lines.",
        ],
        path,
        &[
            ("GIT_AUTHOR_NAME", "Alice Dev"),
            ("GIT_AUTHOR_EMAIL", "alice@example.com"),
            ("GIT_AUTHOR_DATE", "2026-10-06T11:30:00+07:00"),
            ("GIT_COMMITTER_NAME", "Bob Committer"),
            ("GIT_COMMITTER_EMAIL", "bob@example.com"),
            ("GIT_COMMITTER_DATE", "2026-10-06T12:00:00+02:00"),
        ],
    );

    let second_hash = git_stdout(&["rev-parse", "HEAD"], path);
    assert_eq!(second_hash.len(), 64);

    (dir, root_hash, second_hash, root_tree)
}

#[test]
fn test_sha256_root_and_detached_commit_details() {
    let (dir, root_hash, second_hash, _) = create_sha256_fixture();
    let path = dir.path();

    // Verify root commit details
    let root_details = get_commit_details(path, &root_hash).expect("root commit details");
    assert_eq!(root_details.hash, root_hash);
    assert_eq!(root_details.author_name, "Alice Dev");
    assert_eq!(root_details.author_email, "alice@example.com");
    assert_eq!(root_details.committer_name, "Alice Dev");
    assert_eq!(root_details.committer_email, "alice@example.com");
    assert_eq!(root_details.author_timezone_offset_minutes, 420);
    assert_eq!(root_details.committer_timezone_offset_minutes, 420);
    assert_eq!(
        root_details.subject,
        "feat(core): initial sha256 root commit"
    );
    assert!(root_details
        .full_message
        .contains("Full root commit message body."));

    // Detach HEAD to second commit and verify
    run_git(&["checkout", "--detach", "HEAD"], path, &[]);
    let is_detached = git_stdout(
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "HEAD"],
        path,
    );
    assert_eq!(is_detached, "HEAD");

    let second_details = get_commit_details(path, &second_hash).expect("second commit details");
    assert_eq!(second_details.hash, second_hash);
    assert_eq!(second_details.author_name, "Alice Dev");
    assert_eq!(second_details.author_email, "alice@example.com");
    assert_eq!(second_details.committer_name, "Bob Committer");
    assert_eq!(second_details.committer_email, "bob@example.com");
    assert_eq!(second_details.author_timezone_offset_minutes, 420);
    assert_eq!(second_details.committer_timezone_offset_minutes, 120);
    assert_eq!(
        second_details.subject,
        "refactor(engine): update files and rename"
    );
    assert!(second_details
        .full_message
        .contains("Detailed second commit description."));
}

#[test]
fn test_sha256_commit_details_errors() {
    let (dir, _root_hash, _second_hash, root_tree) = create_sha256_fixture();
    let path = dir.path();

    // 1. Non-existent 64-hex commit OID -> 404 CommitNotFound
    let non_existent = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    let err = get_commit_details(path, non_existent).unwrap_err();
    match &err {
        GitBlameError::CommitNotFound(hash) => {
            assert_eq!(hash, non_existent);
            assert_eq!(err.status_code(), 404);
            assert_eq!(err.api_code(), Some("GIT_COMMIT_NOT_FOUND"));
        }
        _ => panic!("expected CommitNotFound, got {err:?}"),
    }

    // 2. Tree object (exists in ODB, but is not a commit) -> 404 CommitNotFound with type note
    let err = get_commit_details(path, &root_tree).unwrap_err();
    match &err {
        GitBlameError::CommitNotFound(_) => {
            assert_eq!(err.status_code(), 404);
        }
        _ => panic!("expected CommitNotFound for tree object, got {err:?}"),
    }

    // 3. Invalid hash formats (wrong length, non-hex) -> 400 InvalidInput
    let bad_hashes = [
        "abc",
        "12345678",
        "0123456789abcdef0123456789abcdef0123456z",
    ];
    for bad in bad_hashes {
        let err = get_commit_details(path, bad).unwrap_err();
        match &err {
            GitBlameError::InvalidInput(_) => {
                assert_eq!(err.status_code(), 400);
            }
            _ => panic!("expected InvalidInput for '{bad}', got {err:?}"),
        }
    }
}

#[test]
fn test_sha256_commit_files_and_renames() {
    let (dir, root_hash, second_hash, _) = create_sha256_fixture();
    let path = dir.path();

    // Root commit files: file1.txt and file2.txt added
    let root_files = get_commit_files(path, &root_hash).expect("root commit files");
    assert_eq!(root_files.len(), 2);
    for entry in &root_files {
        assert_eq!(entry.status, "added");
        assert_eq!(entry.staged, false);
        assert!(entry.additions > 0);
        assert_eq!(entry.deletions, 0);
    }
    let paths: Vec<&str> = root_files.iter().map(|f| f.path.as_str()).collect();
    assert!(paths.contains(&"file1.txt"));
    assert!(paths.contains(&"file2.txt"));

    // Second commit files: file1.txt modified, file2.txt renamed, file3.txt added
    let second_files = get_commit_files(path, &second_hash).expect("second commit files");
    assert_eq!(second_files.len(), 3);

    let file1 = second_files
        .iter()
        .find(|f| f.path == "file1.txt")
        .expect("file1 entry");
    assert_eq!(file1.status, "modified");

    let file2 = second_files
        .iter()
        .find(|f| f.path == "file2_renamed.txt")
        .expect("renamed entry");
    assert_eq!(file2.status, "renamed");
    assert_eq!(file2.old_path.as_deref(), Some("file2.txt"));

    let file3 = second_files
        .iter()
        .find(|f| f.path == "file3.txt")
        .expect("file3 entry");
    assert_eq!(file3.status, "added");
}

#[test]
fn test_sha256_commit_file_diff_unified() {
    let (dir, root_hash, second_hash, _) = create_sha256_fixture();
    let path = dir.path();

    // 1. Root commit diff for file1.txt: new file (original is None, modified is Some)
    let root_diff = get_commit_file_diff(path, "file1.txt", &root_hash).expect("root diff");
    assert_eq!(root_diff.path, "file1.txt");
    assert!(root_diff.original.is_none());
    assert_eq!(root_diff.modified.as_deref(), Some("hello world\nline 2\n"));
    assert!(!root_diff.is_binary);
    assert!(!root_diff.hunks.is_empty());
    assert!(!root_diff.line_changes.is_empty());
    assert_eq!(root_diff.line_changes[0].kind, "added");

    // 2. Second commit diff for file1.txt: modified (both original and modified present)
    let second_diff = get_commit_file_diff(path, "file1.txt", &second_hash).expect("second diff");
    assert_eq!(
        second_diff.original.as_deref(),
        Some("hello world\nline 2\n")
    );
    assert_eq!(
        second_diff.modified.as_deref(),
        Some("hello world\nline 2 modified\nline 3 added\n")
    );
    assert!(!second_diff.is_binary);
    assert!(!second_diff.hunks.is_empty());
    assert!(!second_diff.line_changes.is_empty());

    // 3. Binary file diff
    std::fs::write(path.join("binary.bin"), [0u8, 1, 2, 3, 0, 255]).unwrap();
    run_git(&["add", "binary.bin"], path, &[]);
    run_git(&["commit", "-m", "add binary file"], path, &[]);
    let bin_hash = git_stdout(&["rev-parse", "HEAD"], path);

    let bin_diff = get_commit_file_diff(path, "binary.bin", &bin_hash).expect("binary diff");
    assert_eq!(bin_diff.path, "binary.bin");
    assert!(bin_diff.is_binary);
    assert!(bin_diff.original.is_none());
    assert!(bin_diff.modified.is_none());
}

#[test]
fn test_sha256_read_only_log_and_status() {
    let (dir, root_hash, second_hash, _) = create_sha256_fixture();
    let path = dir.path();

    // Read status on SHA-256 repo
    let status = get_status(path, "sha256-project").expect("get_status");
    assert_eq!(status.project_name, "sha256-project");
    assert!(status.is_clean);
    assert_eq!(status.staged, 0);
    assert_eq!(status.modified, 0);
    assert_eq!(status.untracked, 0);
    assert_eq!(status.last_commit.hash, second_hash);

    // Read log on SHA-256 repo
    let entries = get_log(path, 10, 0, None, None).expect("get_log");
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].hash, second_hash);
    assert_eq!(entries[0].author_name, "Alice Dev");
    assert_eq!(entries[0].author_email, "alice@example.com");
    assert_eq!(entries[1].hash, root_hash);
    assert_eq!(entries[1].author_name, "Alice Dev");
}

#[test]
fn test_sha256_immutability() {
    let (dir, root_hash, second_hash, _) = create_sha256_fixture();
    let path = dir.path();

    // Snapshot pre-inspection state
    let head_before = git_stdout(&["rev-parse", "HEAD"], path);
    let status_before = git_stdout(&["status", "--porcelain"], path);
    let reflog_before = git_stdout(&["reflog", "show", "main"], path);
    let file1_before = std::fs::read_to_string(path.join("file1.txt")).unwrap();

    // Execute all inspection operations multiple times
    let _ = get_commit_details(path, &root_hash).unwrap();
    let _ = get_commit_details(path, &second_hash).unwrap();
    let _ = get_commit_files(path, &root_hash).unwrap();
    let _ = get_commit_files(path, &second_hash).unwrap();
    let _ = get_commit_file_diff(path, "file1.txt", &second_hash).unwrap();
    let _ = get_status(path, "sha256-project").unwrap();
    let _ = get_log(path, 10, 0, None, None).unwrap();

    // Verify post-inspection state is strictly identical
    let head_after = git_stdout(&["rev-parse", "HEAD"], path);
    let status_after = git_stdout(&["status", "--porcelain"], path);
    let reflog_after = git_stdout(&["reflog", "show", "main"], path);
    let file1_after = std::fs::read_to_string(path.join("file1.txt")).unwrap();

    assert_eq!(head_before, head_after);
    assert_eq!(status_before, status_after);
    assert_eq!(reflog_before, reflog_after);
    assert_eq!(file1_before, file1_after);
}
