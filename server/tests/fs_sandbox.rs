/// Integration tests for the FS sandbox + ops module.
///
/// Uses real tempdir filesystems — no mocking. Mirrors the testing pattern
/// from the existing Rust test suite.
use std::fs;
use std::path::PathBuf;

use dev_hub_server::fs::{
    ops::{detect_binary, list_dir, read_file, stat, MAX_READ_BYTES},
    sandbox::WorkspaceSandbox,
    FsError,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn workspace(tmp: &tempfile::TempDir) -> PathBuf {
    tmp.path().to_path_buf()
}

async fn sandbox(root: PathBuf) -> WorkspaceSandbox {
    WorkspaceSandbox::new(root).expect("sandbox::new failed on existing tempdir")
}

// ---------------------------------------------------------------------------
// Sandbox: happy path
// ---------------------------------------------------------------------------

#[tokio::test]
async fn validate_file_within_root_ok() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("hello.txt");
    fs::write(&file, "hello").unwrap();

    let sb = sandbox(workspace(&tmp)).await;
    let result = sb.validate(file.clone()).await;
    assert!(result.is_ok(), "file inside root should be valid: {result:?}");
    assert_eq!(result.unwrap(), dunce::canonicalize(&file).unwrap());
}

#[tokio::test]
async fn validate_subdir_within_root_ok() {
    let tmp = tempfile::tempdir().unwrap();
    let subdir = tmp.path().join("sub");
    fs::create_dir(&subdir).unwrap();
    fs::write(subdir.join("f.rs"), "fn main() {}").unwrap();

    let sb = sandbox(workspace(&tmp)).await;
    let result = sb.validate(subdir.clone()).await;
    assert!(result.is_ok());
}

// ---------------------------------------------------------------------------
// Sandbox: lexical `..` escape rejection
// ---------------------------------------------------------------------------

#[tokio::test]
async fn validate_dotdot_lexical_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    let sb = sandbox(workspace(&tmp)).await;

    // Attempt to escape via .. suffix
    let proposed = tmp.path().join("sub").join("..").join("..")
        .join("etc").join("passwd");
    let result = sb.validate(proposed).await;

    assert!(
        matches!(result, Err(FsError::PathEscape)),
        "expected PathEscape, got: {result:?}"
    );
}

// ---------------------------------------------------------------------------
// Sandbox: symlink inside root → allowed
// ---------------------------------------------------------------------------

#[tokio::test]
#[cfg(unix)]
async fn validate_symlink_inside_root_allowed() {
    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("real.txt");
    fs::write(&target, "content").unwrap();

    let link = tmp.path().join("link.txt");
    std::os::unix::fs::symlink(&target, &link).unwrap();

    let sb = sandbox(workspace(&tmp)).await;
    let result = sb.validate(link).await;
    assert!(result.is_ok(), "symlink inside root should be allowed: {result:?}");
}

// ---------------------------------------------------------------------------
// Sandbox: symlink pointing outside root → rejected
// ---------------------------------------------------------------------------

#[tokio::test]
#[cfg(unix)]
async fn validate_symlink_escape_rejected() {
    let workspace_tmp = tempfile::tempdir().unwrap();
    let outside_tmp = tempfile::tempdir().unwrap();

    let outside_file = outside_tmp.path().join("secret.txt");
    fs::write(&outside_file, "secret").unwrap();

    let link = workspace_tmp.path().join("escape_link");
    std::os::unix::fs::symlink(&outside_file, &link).unwrap();

    let sb = sandbox(workspace(&workspace_tmp)).await;
    let result = sb.validate(link).await;

    assert!(
        matches!(result, Err(FsError::PathEscape)),
        "symlink outside root should be rejected: {result:?}"
    );
}

// ---------------------------------------------------------------------------
// Sandbox: missing project → NotFound
// ---------------------------------------------------------------------------

#[tokio::test]
async fn validate_nonexistent_path_returns_not_found() {
    let tmp = tempfile::tempdir().unwrap();
    let sb = sandbox(workspace(&tmp)).await;

    let missing = tmp.path().join("does_not_exist.txt");
    let result = sb.validate(missing).await;
    assert!(
        matches!(result, Err(FsError::NotFound)),
        "expected NotFound, got: {result:?}"
    );
}

// ---------------------------------------------------------------------------
// ops: list_dir happy path
// ---------------------------------------------------------------------------

#[tokio::test]
async fn list_dir_returns_entries() {
    let tmp = tempfile::tempdir().unwrap();
    fs::write(tmp.path().join("a.txt"), "aa").unwrap();
    fs::write(tmp.path().join("b.txt"), "bb").unwrap();
    fs::create_dir(tmp.path().join("subdir")).unwrap();

    let entries = list_dir(tmp.path()).await.unwrap();
    assert_eq!(entries.len(), 3);

    // Dirs should sort before files
    assert_eq!(entries[0].kind, "dir");
    assert_eq!(entries[0].name, "subdir");
    assert_eq!(entries[1].kind, "file");
    assert_eq!(entries[2].kind, "file");
}

// ---------------------------------------------------------------------------
// ops: detect_binary — PNG magic bytes
// ---------------------------------------------------------------------------

#[tokio::test]
async fn detect_binary_png_returns_true_with_mime() {
    let tmp = tempfile::tempdir().unwrap();
    let png = tmp.path().join("img.png");
    // Minimal valid PNG header (first 8 bytes)
    let header: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    fs::write(&png, header).unwrap();

    let (is_binary, mime) = detect_binary(&png).await.unwrap();
    assert!(is_binary, "PNG should be detected as binary");
    assert!(
        mime.as_deref().unwrap_or("").contains("image"),
        "expected image MIME, got: {mime:?}"
    );
}

// ---------------------------------------------------------------------------
// ops: detect_binary — plain text
// ---------------------------------------------------------------------------

#[tokio::test]
async fn detect_binary_text_returns_false() {
    let tmp = tempfile::tempdir().unwrap();
    let txt = tmp.path().join("code.rs");
    fs::write(&txt, "fn main() { println!(\"hello\"); }").unwrap();

    let (is_binary, _mime) = detect_binary(&txt).await.unwrap();
    assert!(!is_binary, "Rust source file should not be detected as binary");
}

// ---------------------------------------------------------------------------
// ops: read_file — too large without range → TooLarge
// ---------------------------------------------------------------------------

#[tokio::test]
async fn read_file_over_cap_without_range_returns_too_large() {
    let tmp = tempfile::tempdir().unwrap();
    let large = tmp.path().join("large.bin");

    // Write a file slightly over 100 MB cap using sparse file trick
    // (seek to end + write 1 byte creates a sparse file on most FSes)
    let size = MAX_READ_BYTES + 1;
    {
        use std::io::{Seek, SeekFrom, Write};
        let mut f = fs::File::create(&large).unwrap();
        f.seek(SeekFrom::Start(size - 1)).unwrap();
        f.write_all(&[0u8]).unwrap();
    }

    let result = read_file(&large, None, MAX_READ_BYTES).await;
    assert!(
        matches!(result, Err(FsError::TooLarge(_))),
        "expected TooLarge, got: {result:?}"
    );
}

// ---------------------------------------------------------------------------
// ops: read_file — range read works on large file
// ---------------------------------------------------------------------------

#[tokio::test]
async fn read_file_with_range_reads_correct_slice() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("data.txt");
    fs::write(&file, b"0123456789").unwrap();

    let bytes = read_file(&file, Some((2, 5)), MAX_READ_BYTES).await.unwrap();
    assert_eq!(&bytes, b"23456");
}

// ---------------------------------------------------------------------------
// ops: stat returns correct kind + is_binary
// ---------------------------------------------------------------------------

#[tokio::test]
async fn stat_text_file() {
    let tmp = tempfile::tempdir().unwrap();
    let f = tmp.path().join("hello.txt");
    fs::write(&f, "hello world").unwrap();

    let s = stat(&f).await.unwrap();
    assert_eq!(s.kind, "file");
    assert!(!s.is_binary);
    assert_eq!(s.size, 11);
}

#[tokio::test]
async fn stat_directory() {
    let tmp = tempfile::tempdir().unwrap();
    let s = stat(tmp.path()).await.unwrap();
    assert_eq!(s.kind, "dir");
    assert!(!s.is_binary);
}

// ---------------------------------------------------------------------------
// Windows-only: drive-letter + verbatim prefix handling
// (compile-time gated — Linux CI skips these)
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod windows_tests {
    use super::*;

    #[tokio::test]
    async fn windows_backslash_path_normalizes() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("w.txt");
        fs::write(&file, "w").unwrap();

        // Build path using backslashes
        let backslash: PathBuf = PathBuf::from(file.to_string_lossy().replace('/', "\\"));
        let sb = sandbox(workspace(&tmp)).await;
        assert!(sb.validate(backslash).await.is_ok());
    }

    #[tokio::test]
    async fn windows_verbatim_prefix_stripped_by_dunce() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("v.txt");
        fs::write(&file, "v").unwrap();

        // Simulate \\?\ prefix from std::fs::canonicalize
        let verbatim = PathBuf::from(format!(
            "\\\\?\\{}",
            dunce::canonicalize(&file).unwrap().display()
        ));
        let sb = sandbox(workspace(&tmp)).await;
        // dunce strips the prefix; validate should succeed
        assert!(sb.validate(verbatim).await.is_ok());
    }
}
