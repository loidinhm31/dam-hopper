use std::io::Read;
use std::path::Path;
use std::process::Command;

use crate::error::GitBlameError;
use crate::git::types::GitCommitDetails;

/// Maximum raw commit object size allowed before allocation (5 MiB).
pub const MAX_COMMIT_OBJECT_BYTES: usize = 5 * 1024 * 1024;

/// Reads immutable commit metadata and full message directly from the repository's
/// object database (ODB) by exact OID, without requiring branch reachability or a checked-out branch.
pub fn get_commit_details(repo_path: &Path, hash: &str) -> Result<GitCommitDetails, GitBlameError> {
    let trimmed_hash = hash.trim();
    if (trimmed_hash.len() != 40 && trimmed_hash.len() != 64)
        || !trimmed_hash.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err(GitBlameError::InvalidInput(format!(
            "invalid commit hash: must be a full 40-character or 64-character OID, got '{hash}'"
        )));
    }

    if trimmed_hash.len() == 40 {
        match get_commit_details_libgit2(repo_path, trimmed_hash) {
            Ok(details) => return Ok(details),
            Err(GitBlameError::Git(msg))
                if msg.contains("unsupported") || msg.contains("failed to open repository") =>
            {
                // Fall back to CLI if repository format is unsupported by libgit2
            }
            Err(err) => return Err(err),
        }
    }

    get_commit_details_cli(repo_path, trimmed_hash)
}

fn get_commit_details_libgit2(
    repo_path: &Path,
    trimmed_hash: &str,
) -> Result<GitCommitDetails, GitBlameError> {
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
    let author_email = author
        .email()
        .map(str::to_string)
        .unwrap_or_else(|| String::from_utf8_lossy(author.email_bytes()).into_owned());

    let committer = commit.committer();
    let committer_when = committer.when();
    let committer_name = committer
        .name()
        .map(str::to_string)
        .unwrap_or_else(|| String::from_utf8_lossy(committer.name_bytes()).into_owned());
    let committer_email = committer
        .email()
        .map(str::to_string)
        .unwrap_or_else(|| String::from_utf8_lossy(committer.email_bytes()).into_owned());

    let full_message = commit
        .message()
        .map(str::to_string)
        .unwrap_or_else(|| String::from_utf8_lossy(commit.message_bytes()).into_owned());

    let subject = commit.summary().map(str::to_string).unwrap_or_else(|| {
        full_message
            .lines()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("")
            .trim()
            .to_string()
    });

    Ok(GitCommitDetails {
        hash: commit.id().to_string(),
        author_name,
        author_email,
        author_timestamp: author_when.seconds(),
        author_timezone_offset_minutes: author_when.offset_minutes(),
        committer_name,
        committer_email,
        committer_timestamp: committer_when.seconds(),
        committer_timezone_offset_minutes: committer_when.offset_minutes(),
        subject,
        full_message,
    })
}

fn get_commit_details_cli(
    repo_path: &Path,
    trimmed_hash: &str,
) -> Result<GitCommitDetails, GitBlameError> {
    // 1. Inspect object type
    let type_output = Command::new("git")
        .args(["--no-replace-objects", "-c", "safe.directory=*"])
        .env("GIT_NO_REPLACE_OBJECTS", "1")
        .arg("cat-file")
        .arg("-t")
        .arg(trimmed_hash)
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitBlameError::Git(format!("failed to spawn git: {e}")))?;

    if !type_output.status.success() {
        if !repo_path.exists() {
            return Err(GitBlameError::Git(format!(
                "repository path does not exist: {}",
                repo_path.display()
            )));
        }
        return Err(GitBlameError::CommitNotFound(trimmed_hash.to_string()));
    }

    let obj_type = String::from_utf8_lossy(&type_output.stdout)
        .trim()
        .to_string();
    if obj_type != "commit" {
        return Err(GitBlameError::CommitNotFound(format!(
            "object {trimmed_hash} is not a commit (type: {obj_type})"
        )));
    }

    // 2. Inspect object size before payload allocation
    let size_output = Command::new("git")
        .args(["--no-replace-objects", "-c", "safe.directory=*"])
        .env("GIT_NO_REPLACE_OBJECTS", "1")
        .arg("cat-file")
        .arg("-s")
        .arg(trimmed_hash)
        .current_dir(repo_path)
        .output()
        .map_err(|e| GitBlameError::Git(format!("failed to spawn git: {e}")))?;

    if !size_output.status.success() {
        return Err(GitBlameError::CommitNotFound(trimmed_hash.to_string()));
    }

    let size_str = String::from_utf8_lossy(&size_output.stdout)
        .trim()
        .to_string();
    let size: usize = size_str
        .parse()
        .map_err(|_| GitBlameError::Git("invalid size returned by git cat-file".to_string()))?;

    if size > MAX_COMMIT_OBJECT_BYTES {
        return Err(GitBlameError::CommitTooLarge(format!(
            "commit object size ({size} bytes) exceeds {MAX_COMMIT_OBJECT_BYTES} bytes limit"
        )));
    }

    // 3. Stream commit payload with strictly bounded stdout
    let mut child = Command::new("git")
        .args(["--no-replace-objects", "-c", "safe.directory=*"])
        .env("GIT_NO_REPLACE_OBJECTS", "1")
        .arg("cat-file")
        .arg("-p")
        .arg(trimmed_hash)
        .current_dir(repo_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| GitBlameError::Git(format!("failed to spawn git: {e}")))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| GitBlameError::Git("failed to capture child stdout".to_string()))?;

    let mut buffer = Vec::with_capacity(size.min(MAX_COMMIT_OBJECT_BYTES));
    let bytes_read = (&mut stdout)
        .take((MAX_COMMIT_OBJECT_BYTES + 1) as u64)
        .read_to_end(&mut buffer)
        .map_err(|e| GitBlameError::Git(format!("failed to read commit object: {e}")))?;

    if bytes_read > MAX_COMMIT_OBJECT_BYTES {
        let _ = child.kill();
        let _ = child.wait();
        return Err(GitBlameError::CommitTooLarge(format!(
            "commit object size exceeds {MAX_COMMIT_OBJECT_BYTES} bytes limit"
        )));
    }

    let status = child
        .wait()
        .map_err(|e| GitBlameError::Git(format!("failed to wait for git child: {e}")))?;

    if !status.success() {
        return Err(GitBlameError::CommitNotFound(trimmed_hash.to_string()));
    }

    // 4. Parse raw commit
    parse_raw_commit(trimmed_hash, &buffer)
}

fn parse_signature_bytes(bytes: &[u8]) -> (String, String, i64, i32) {
    let open_idx = bytes.iter().position(|&b| b == b'<');
    let close_idx = bytes.iter().rposition(|&b| b == b'>');

    if let (Some(open), Some(close)) = (open_idx, close_idx) {
        if close > open {
            let name = String::from_utf8_lossy(&bytes[..open]).trim().to_string();
            let email = String::from_utf8_lossy(&bytes[open + 1..close])
                .trim()
                .to_string();
            let rest = String::from_utf8_lossy(&bytes[close + 1..]);
            let tokens: Vec<&str> = rest.split_whitespace().collect();

            let timestamp = tokens
                .first()
                .and_then(|t| t.parse::<i64>().ok())
                .unwrap_or(0);
            let tz_offset = tokens
                .get(1)
                .and_then(|tz| parse_tz_offset(tz))
                .unwrap_or(0);

            return (name, email, timestamp, tz_offset);
        }
    }
    (String::new(), String::new(), 0, 0)
}

fn parse_tz_offset(s: &str) -> Option<i32> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let (sign, rest) = match s.as_bytes().first() {
        Some(b'+') => (1, &s[1..]),
        Some(b'-') => (-1, &s[1..]),
        _ => (1, s),
    };
    if rest.len() < 4 {
        return None;
    }
    let hours: i32 = rest[..2].parse().ok()?;
    let minutes: i32 = rest[2..4].parse().ok()?;
    Some(sign * (hours * 60 + minutes))
}

fn parse_raw_commit(hash: &str, raw: &[u8]) -> Result<GitCommitDetails, GitBlameError> {
    let mut header_end = raw.len();
    let mut body_start = raw.len();

    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'\n' {
            if i + 1 < raw.len() && raw[i + 1] == b'\n' {
                header_end = i;
                body_start = i + 2;
                break;
            } else if i + 2 < raw.len() && raw[i + 1] == b'\r' && raw[i + 2] == b'\n' {
                header_end = i;
                body_start = i + 3;
                break;
            }
        }
        i += 1;
    }

    let headers_bytes = &raw[..header_end];
    let body_bytes = if body_start < raw.len() {
        &raw[body_start..]
    } else {
        &[]
    };

    let full_message = String::from_utf8_lossy(body_bytes).into_owned();
    let subject = full_message
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string();

    let mut author_name = String::new();
    let mut author_email = String::new();
    let mut author_timestamp = 0i64;
    let mut author_timezone_offset_minutes = 0i32;

    let mut committer_name = String::new();
    let mut committer_email = String::new();
    let mut committer_timestamp = 0i64;
    let mut committer_timezone_offset_minutes = 0i32;

    for line in headers_bytes.split(|&b| b == b'\n') {
        let line = if line.ends_with(b"\r") {
            &line[..line.len() - 1]
        } else {
            line
        };

        if line.starts_with(b" ") {
            // Continuation line for multiline signed headers
            continue;
        }

        if let Some(rest) = line.strip_prefix(b"author ") {
            let (name, email, ts, tz) = parse_signature_bytes(rest);
            author_name = name;
            author_email = email;
            author_timestamp = ts;
            author_timezone_offset_minutes = tz;
        } else if let Some(rest) = line.strip_prefix(b"committer ") {
            let (name, email, ts, tz) = parse_signature_bytes(rest);
            committer_name = name;
            committer_email = email;
            committer_timestamp = ts;
            committer_timezone_offset_minutes = tz;
        }
    }

    Ok(GitCommitDetails {
        hash: hash.to_string(),
        author_name,
        author_email,
        author_timestamp,
        author_timezone_offset_minutes,
        committer_name,
        committer_email,
        committer_timestamp,
        committer_timezone_offset_minutes,
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
            let message =
                "feat(test): initial commit\n\nFull detailed commit body here.\nMultiple lines.";
            repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[])
                .unwrap()
        };

        (dir, repo, oid)
    }

    fn create_test_sha256_repo() -> (TempDir, String) {
        let dir = TempDir::new().unwrap();
        let path = dir.path();

        let run = |args: &[&str]| {
            let output = Command::new("git")
                .args(["-c", "safe.directory=*"])
                .args(args)
                .current_dir(path)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "git {:?} failed: {}",
                args,
                String::from_utf8_lossy(&output.stderr)
            );
            output
        };

        run(&["init", "--object-format=sha256"]);
        run(&["config", "user.name", "Alice Dev"]);
        run(&["config", "user.email", "alice@example.com"]);
        std::fs::write(path.join("file.txt"), "hello sha256\n").unwrap();
        run(&["add", "file.txt"]);
        run(&[
            "commit",
            "-m",
            "feat(sha256): initial commit\n\nFull body message on sha256 repo.",
        ]);

        let out = run(&["rev-parse", "HEAD"]);
        let hash = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (dir, hash)
    }

    #[test]
    fn test_get_commit_details_success() {
        let (dir, _repo, oid) = create_test_repo();
        let details = get_commit_details(dir.path(), &oid.to_string()).unwrap();

        assert_eq!(details.hash, oid.to_string());
        assert_eq!(details.author_name, "Alice Dev");
        assert_eq!(details.author_email, "alice@example.com");
        assert_eq!(details.committer_name, "Alice Dev");
        assert_eq!(details.committer_email, "alice@example.com");
        assert_eq!(details.subject, "feat(test): initial commit");
        assert!(details
            .full_message
            .contains("Full detailed commit body here."));
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
        repo.set_head_detached(oid).unwrap();
        assert!(repo.head_detached().unwrap());

        let details = get_commit_details(dir.path(), &oid.to_string()).unwrap();
        assert_eq!(details.hash, oid.to_string());
        assert_eq!(details.author_email, "alice@example.com");
        assert_eq!(details.subject, "feat(test): initial commit");
        assert_eq!(
            details.full_message,
            "feat(test): initial commit\n\nFull detailed commit body here.\nMultiple lines."
        );
    }

    #[test]
    fn test_get_commit_details_sha256_success() {
        let (dir, hash) = create_test_sha256_repo();
        assert_eq!(hash.len(), 64);

        let details = get_commit_details(dir.path(), &hash).unwrap();
        assert_eq!(details.hash, hash);
        assert_eq!(details.author_name, "Alice Dev");
        assert_eq!(details.author_email, "alice@example.com");
        assert_eq!(details.committer_name, "Alice Dev");
        assert_eq!(details.committer_email, "alice@example.com");
        assert_eq!(details.subject, "feat(sha256): initial commit");
        assert_eq!(
            details.full_message,
            "feat(sha256): initial commit\n\nFull body message on sha256 repo.\n"
        );
    }

    #[test]
    fn test_get_commit_details_sha256_not_found() {
        let (dir, _hash) = create_test_sha256_repo();
        let non_existent = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let err = get_commit_details(dir.path(), non_existent).unwrap_err();
        match err {
            GitBlameError::CommitNotFound(hash) => {
                assert_eq!(hash, non_existent);
            }
            _ => panic!("expected CommitNotFound, got: {err:?}"),
        }
    }

    #[test]
    fn test_parse_raw_commit_multiline_gpgsig() {
        let raw = b"tree 19f5043660c808b7ed1db6a44b8025f0d17788eebeb15c19cd73cf4b7b6dc4c9\n\
parent ae9cb2e65ef73a83a0dab325392be9b4f6b66f99c860317758da858ebcc1f820\n\
author Alice Dev <alice@example.com> 1791260736 +0700\n\
committer Bob Committer <bob@example.com> 1791260750 -0500\n\
gpgsig -----BEGIN PGP SIGNATURE-----\n\
\x20Version: GnuPG v1\n\
\x20\n\
\x20iQIzBAABCAAdFiEE...\n\
\x20-----END PGP SIGNATURE-----\n\
\n\
feat(scope): test commit subject\n\
\n\
This is the message body.\n";

        let hash = "89830a4dbf3a6d798f9e36dc1998ee21c21f0dc9107c59b322f05da1d40fadd1";
        let details = parse_raw_commit(hash, raw).unwrap();

        assert_eq!(details.hash, hash);
        assert_eq!(details.author_name, "Alice Dev");
        assert_eq!(details.author_email, "alice@example.com");
        assert_eq!(details.author_timestamp, 1791260736);
        assert_eq!(details.author_timezone_offset_minutes, 420);
        assert_eq!(details.committer_name, "Bob Committer");
        assert_eq!(details.committer_email, "bob@example.com");
        assert_eq!(details.committer_timestamp, 1791260750);
        assert_eq!(details.committer_timezone_offset_minutes, -300);
        assert_eq!(details.subject, "feat(scope): test commit subject");
        assert_eq!(
            details.full_message,
            "feat(scope): test commit subject\n\nThis is the message body.\n"
        );
    }
}
