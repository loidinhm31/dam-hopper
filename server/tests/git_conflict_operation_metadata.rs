use std::fs;
use std::path::Path;
use std::process::Command;

use dam_hopper_server::git::types::GitRecoveryOperation;
use dam_hopper_server::git::active_git_operation;
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
fn test_lossless_text_encodings_and_bom() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    let utf8_bom = b"\xEF\xBB\xBFHello CRLF\r\nSecond Line\r\nNo EOF NL";
    fs::write(root.join("bom_file.txt"), utf8_bom).unwrap();
    git(&["add", "bom_file.txt"], root);
    git(&["commit", "-m", "bom commit"], root);

    let repo = git2::Repository::open(root).unwrap();
    let index = repo.index().unwrap();
    let entry = index.get_path(Path::new("bom_file.txt"), 0).unwrap();
    let blob = repo.find_blob(entry.id).unwrap();

    assert_eq!(
        blob.content(),
        utf8_bom,
        "Raw Git blob bytes must match UTF-8 BOM, CRLF, and no-trailing-newline exactly"
    );
}

#[tokio::test]
async fn test_operation_detection_and_sequencer_metadata() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    init_repo(root);

    fs::write(root.join("file.txt"), b"line 1\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "commit 1"], root);

    git(&["checkout", "-b", "branch-a"], root);
    fs::write(root.join("file.txt"), b"line 1 A\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "commit 2 A"], root);

    git(&["checkout", "main"], root);
    fs::write(root.join("file.txt"), b"line 1 B\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "commit 2 B"], root);

    // 1. Merge conflict
    let _ = git_try(&["merge", "branch-a"], root);
    let op = active_git_operation(root).await.unwrap();
    assert_eq!(
        op.map(|s| s.operation),
        Some(GitRecoveryOperation::Merge),
        "Production active_git_operation must detect Merge conflict"
    );
    git(&["merge", "--abort"], root);
    assert!(
        active_git_operation(root).await.unwrap().is_none(),
        "Operation must be None after abort"
    );

    // 2. Rebase conflict
    let _ = git_try(&["rebase", "branch-a"], root);
    let op = active_git_operation(root).await.unwrap();
    assert_eq!(
        op.map(|s| s.operation),
        Some(GitRecoveryOperation::Rebase),
        "Production active_git_operation must detect Rebase conflict"
    );
    git(&["rebase", "--abort"], root);
    assert!(active_git_operation(root).await.unwrap().is_none());

    // 3. Cherry-pick conflict
    let commit_a = String::from_utf8(git(&["rev-parse", "branch-a"], root))
        .unwrap()
        .trim()
        .to_string();
    let _ = git_try(&["cherry-pick", &commit_a], root);
    let op = active_git_operation(root).await.unwrap();
    assert_eq!(
        op.map(|s| s.operation),
        Some(GitRecoveryOperation::CherryPick),
        "Production active_git_operation must detect CherryPick conflict"
    );
    git(&["cherry-pick", "--abort"], root);
    assert!(active_git_operation(root).await.unwrap().is_none());

    // 4. Revert conflict
    fs::write(root.join("file.txt"), b"line 1 revert target\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "commit 3 target"], root);
    fs::write(root.join("file.txt"), b"line 1 conflicting change\n").unwrap();
    git(&["add", "file.txt"], root);
    git(&["commit", "-m", "commit 4 conflicting"], root);

    let _ = git_try(&["revert", "HEAD~1"], root);
    let op = active_git_operation(root).await.unwrap();
    assert_eq!(
        op.map(|s| s.operation),
        Some(GitRecoveryOperation::Revert),
        "Production active_git_operation must detect Revert conflict"
    );
    git(&["revert", "--abort"], root);
    assert!(active_git_operation(root).await.unwrap().is_none());
}
