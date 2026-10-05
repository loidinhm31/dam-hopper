use std::path::Path;

use crate::error::GitBlameError;
use crate::git::types::GitCommitDetails;

/// Maximum raw commit object size allowed before allocation (5 MiB).
pub const MAX_COMMIT_OBJECT_BYTES: usize = 5 * 1024 * 1024;

/// Reads immutable commit metadata and full message directly from the repository's
/// object database (ODB) by exact OID, without requiring branch reachability or a checked-out branch.
pub fn get_commit_details(
    repo_path: &Path,
    hash: &str,
) -> Result<GitCommitDetails, GitBlameError> {
    let trimmed_hash = hash.trim();
    if (trimmed_hash.len() != 40 && trimmed_hash.len() != 64)
        || !trimmed_hash.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err(GitBlameError::InvalidInput(format!(
            "invalid commit hash: must be a full 40-character or 64-character OID, got '{hash}'"
        )));
    }

    let repo = git2::Repository::open(repo_path)
        .map_err(|e| GitBlameError::Git(format!("failed to open repository: {}", e.message())))?;

    let oid = git2::Oid::from_str(trimmed_hash)
        .map_err(|e| GitBlameError::InvalidInput(format!("failed to parse commit hash: {e}")))?;

    let odb = repo
        .odb()
        .map_err(|e| GitBlameError::Git(format!("failed to open ODB: {}", e.message())))?;

    let (size, obj_type) = odb.read_header(oid).map_err(|e| {
        if e.code() == git2::ErrorCode::NotFound {
            GitBlameError::CommitNotFound(trimmed_hash.to_string())
        } else {
            GitBlameError::Git(format!("failed to inspect commit header: {}", e.message()))
        }
    })?;

    if obj_type != git2::ObjectType::Commit {
        return Err(GitBlameError::CommitNotFound(format!(
            "object {trimmed_hash} is not a commit (type: {obj_type:?})"
        )));
    }

    if size > MAX_COMMIT_OBJECT_BYTES {
        return Err(GitBlameError::CommitTooLarge(format!(
            "commit object size ({size} bytes) exceeds {MAX_COMMIT_OBJECT_BYTES} bytes limit"
        )));
    }

    let commit = repo.find_commit(oid).map_err(|e| {
        if e.code() == git2::ErrorCode::NotFound {
            GitBlameError::CommitNotFound(trimmed_hash.to_string())
        } else {
            GitBlameError::Git(format!("failed to find commit object: {}", e.message()))
        }
    })?;

    let author = commit.author();
    let author_when = author.when();
    let author_name = author
        .name()
        .map(str::to_string)
        .unwrap_or_else(|| String::from_utf8_lossy(author.name_bytes()).into_owned());

    let full_message = commit
        .message()
        .map(str::to_string)
        .unwrap_or_else(|| String::from_utf8_lossy(commit.message_bytes()).into_owned());

    let subject = commit
        .summary()
        .map(str::to_string)
        .unwrap_or_else(|| full_message.lines().next().unwrap_or("").to_string());

    Ok(GitCommitDetails {
        hash: commit.id().to_string(),
        author_name,
        author_timestamp: author_when.seconds(),
        author_timezone_offset_minutes: author_when.offset_minutes(),
        subject,
        full_message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_repo() -> (TempDir, git2::Repository, git2::Oid) {
        let dir = TempDir::new().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();

        let sig = git2::Signature::now("Alice Dev", "alice@example.com").unwrap();
        let tree_id = {
            let mut index = repo.index().unwrap();
            let file_path = dir.path().join("file.txt");
            std::fs::write(&file_path, "hello world\n").unwrap();
            index.add_path(Path::new("file.txt")).unwrap();
            index.write().unwrap();
            index.write_tree().unwrap()
        };
        let oid = {
            let tree = repo.find_tree(tree_id).unwrap();
            let message = "feat(test): initial commit\n\nFull detailed commit body here.\nMultiple lines.";
            repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[])
                .unwrap()
        };

        (dir, repo, oid)
    }

    #[test]
    fn test_get_commit_details_success() {
        let (dir, _repo, oid) = create_test_repo();
        let details = get_commit_details(dir.path(), &oid.to_string()).unwrap();

        assert_eq!(details.hash, oid.to_string());
        assert_eq!(details.author_name, "Alice Dev");
        assert_eq!(details.subject, "feat(test): initial commit");
        assert!(details.full_message.contains("Full detailed commit body here."));
    }

    #[test]
    fn test_get_commit_details_invalid_hash() {
        let (dir, _repo, _oid) = create_test_repo();
        let err = get_commit_details(dir.path(), "abc").unwrap_err();
        match err {
            GitBlameError::InvalidInput(msg) => {
                assert!(msg.contains("must be a full 40-character or 64-character OID"));
            }
            _ => panic!("expected InvalidInput, got: {err:?}"),
        }
    }

    #[test]
    fn test_get_commit_details_not_found() {
        let (dir, _repo, _oid) = create_test_repo();
        let non_existent = "0123456789abcdef0123456789abcdef01234567";
        let err = get_commit_details(dir.path(), non_existent).unwrap_err();
        match err {
            GitBlameError::CommitNotFound(hash) => {
                assert_eq!(hash, non_existent);
            }
            _ => panic!("expected CommitNotFound, got: {err:?}"),
        }
    }

    #[test]
    fn test_get_commit_details_tree_is_not_commit() {
        let (dir, repo, _oid) = create_test_repo();
        let head_commit = repo.head().unwrap().peel_to_commit().unwrap();
        let tree_id = head_commit.tree_id();

        let err = get_commit_details(dir.path(), &tree_id.to_string()).unwrap_err();
        match err {
            GitBlameError::CommitNotFound(msg) => {
                assert!(msg.contains("not a commit"));
            }
            _ => panic!("expected CommitNotFound, got: {err:?}"),
        }
    }

    #[test]
    fn test_get_commit_details_detached_head_and_full_body() {
        let (dir, repo, oid) = create_test_repo();
        // Detach HEAD to this commit
        repo.set_head_detached(oid).unwrap();
        assert!(repo.head_detached().unwrap());

        let details = get_commit_details(dir.path(), &oid.to_string()).unwrap();
        assert_eq!(details.hash, oid.to_string());
        assert_eq!(details.subject, "feat(test): initial commit");
        assert_eq!(
            details.full_message,
            "feat(test): initial commit\n\nFull detailed commit body here.\nMultiple lines."
        );
    }
}
