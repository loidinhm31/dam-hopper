use aes_gcm::aead::{generic_array::GenericArray, Aead};
use aes_gcm::{Aes256Gcm, KeyInit};
use zeroize::Zeroizing;

use crate::fs::error::FsError;

const IV_LEN: usize = 12; // AES-GCM nonce (96 bits)

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/// Result of a successful decryption.
pub struct DecryptResult {
    /// Parsed metadata JSON from the plaintext envelope.
    pub metadata: serde_json::Value,
    /// Decrypted file content bytes.
    pub content: Vec<u8>,
}

// ---------------------------------------------------------------------------
// decrypt_blob — pure function, no I/O
// ---------------------------------------------------------------------------

/// Decrypt an encrypted blob using the HKDF-derived AES key.
///
/// Envelope: `iv(12) || ciphertext+tag`.
/// Plaintext: `metadata_json + 0x00 + content_bytes`.
///
/// No PBKDF2 — aes_key is used as AES-256-GCM key directly.
/// AES-GCM tag verification is automatic via `decrypt()`.
pub fn decrypt_blob(
    ciphertext_blob: &[u8],
    aes_key: &[u8],
) -> Result<DecryptResult, FsError> {
    if ciphertext_blob.len() < IV_LEN + 16 {
        return Err(FsError::MutationRefused(
            "encrypted blob too short".into(),
        ));
    }
    if aes_key.len() != 32 {
        return Err(FsError::MutationRefused(
            "aes_key must be 32 bytes".into(),
        ));
    }

    let iv = &ciphertext_blob[..IV_LEN];
    let ct = &ciphertext_blob[IV_LEN..];

    let cipher = Aes256Gcm::new(GenericArray::from_slice(aes_key));
    let nonce = GenericArray::from_slice(iv);

    // Decrypt and authenticate in one step; any bit-flip → Err
    let plaintext: Zeroizing<Vec<u8>> = Zeroizing::new(
        cipher
            .decrypt(nonce, ct)
            .map_err(|_| {
                FsError::MutationRefused(
                    "AES-GCM decryption failed — wrong key or corrupted data".into(),
                )
            })?,
    );

    // Parse envelope: metadata_json + 0x00 + content_bytes
    let sep_idx = plaintext
        .iter()
        .position(|&b| b == 0x00)
        .ok_or_else(|| {
            FsError::MutationRefused(
                "plaintext missing metadata separator (0x00)".into(),
            )
        })?;

    // FIX-06: cap metadata size to prevent unbounded allocation before UTF-8 parse
    const METADATA_MAX: usize = 4096;
    if sep_idx > METADATA_MAX {
        return Err(FsError::MutationRefused(format!(
            "metadata section too large: {sep_idx} bytes (max {METADATA_MAX})"
        )));
    }

    let meta_json = std::str::from_utf8(&plaintext[..sep_idx]).map_err(|e| {
        FsError::MutationRefused(format!("metadata is not valid UTF-8: {e}"))
    })?;

    let metadata: serde_json::Value =
        serde_json::from_str(meta_json).map_err(|e| {
            FsError::MutationRefused(format!("metadata JSON parse error: {e}"))
        })?;

    let content = plaintext[sep_idx + 1..].to_vec();

    Ok(DecryptResult { metadata, content })
}

// ---------------------------------------------------------------------------
// decrypt_and_write — convenience wrapper with atomic file write
// ---------------------------------------------------------------------------

/// Decrypt `ciphertext_blob` and atomically write content to `output_abs`.
///
/// Uses `tempfile::NamedTempFile` + `persist()` for atomic write.
/// `output_abs` must already be sandbox-validated by the caller.
/// The directory referenced by `output_abs` must exist.
///
/// # Returns
///
/// The same `DecryptResult` as `decrypt_blob` on success.
pub fn decrypt_and_write(
    ciphertext_blob: &[u8],
    aes_key: &[u8],
    output_abs: std::path::PathBuf,
) -> Result<DecryptResult, FsError> {
    let result = decrypt_blob(ciphertext_blob, aes_key)?;

    let parent = output_abs.parent().ok_or_else(|| {
        FsError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "output path has no parent",
        ))
    })?;

    let mut tmp = tempfile::NamedTempFile::new_in(parent).map_err(FsError::Io)?;
    use std::io::Write as _;
    tmp.write_all(&result.content).map_err(FsError::Io)?;
    tmp.persist(&output_abs)
        .map_err(|e| FsError::Io(e.error))?;

    Ok(result)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const TEST_KEY: [u8; 32] = [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
        20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
    ];

    /// Encrypt plaintext using the same AES-256-GCM scheme as the client.
    /// Uses a fixed IV — acceptable in test code only.
    fn encrypt_for_test(
        aes_key: &[u8; 32],
        metadata: &str,
        content: &[u8],
    ) -> Vec<u8> {
        let iv: [u8; 12] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

        let mut plaintext = Vec::new();
        plaintext.extend_from_slice(metadata.as_bytes());
        plaintext.push(0x00);
        plaintext.extend_from_slice(content);

        let cipher =
            Aes256Gcm::new(GenericArray::from_slice(aes_key));
        let nonce = GenericArray::from_slice(&iv);
        let ct = cipher
            .encrypt(nonce, plaintext.as_slice())
            .expect("test encrypt failed");

        let mut blob = Vec::new();
        blob.extend_from_slice(&iv);
        blob.extend_from_slice(&ct);
        blob
    }

    #[test]
    fn test_round_trip() {
        let metadata = r#"{"name":"hello.txt","size":5,"type":"text/plain"}"#;
        let content = b"hello";
        let blob = encrypt_for_test(&TEST_KEY, metadata, content);

        let result = decrypt_blob(&blob, &TEST_KEY).unwrap();
        assert_eq!(result.content, b"hello");
        assert_eq!(result.metadata["name"], "hello.txt");
        assert_eq!(result.metadata["size"], 5);
    }

    #[test]
    fn test_wrong_key_returns_error() {
        let blob = encrypt_for_test(
            &TEST_KEY,
            r#"{"name":"f","size":1,"type":""}"#,
            b"x",
        );
        let wrong_key = [0u8; 32];
        let result = decrypt_blob(&blob, &wrong_key);
        assert!(result.is_err(), "expected error for wrong key");
    }

    #[test]
    fn test_truncated_ciphertext_returns_error() {
        let result = decrypt_blob(&[0u8; 10], &TEST_KEY);
        assert!(result.is_err());
    }

    #[test]
    fn test_missing_separator_returns_error() {
        // Encrypt plaintext that has no 0x00 byte
        let iv = [0u8; 12];
        let plaintext_no_sep = b"no-separator-here-just-bytes";
        let cipher = Aes256Gcm::new(GenericArray::from_slice(&TEST_KEY));
        let nonce = GenericArray::from_slice(&iv);
        let ct = cipher
            .encrypt(nonce, plaintext_no_sep.as_slice())
            .unwrap();
        let mut blob = Vec::new();
        blob.extend_from_slice(&iv);
        blob.extend_from_slice(&ct);

        let result = decrypt_blob(&blob, &TEST_KEY);
        assert!(result.is_err());
    }

    #[test]
    fn test_decrypt_and_write() {
        let dir = tempdir().unwrap();
        let metadata = r#"{"path":"src/main.rs","size":11}"#;
        let content = b"hello world";
        let blob = encrypt_for_test(&TEST_KEY, metadata, content);

        let out_path = dir.path().join("out.txt");
        let result =
            decrypt_and_write(&blob, &TEST_KEY, out_path.clone()).unwrap();

        let written = std::fs::read(&out_path).unwrap();
        assert_eq!(written, b"hello world");
        assert_eq!(result.metadata["path"], "src/main.rs");
    }

    #[test]
    fn test_wrong_key_no_file_written() {
        let dir = tempdir().unwrap();
        let blob = encrypt_for_test(
            &TEST_KEY,
            r#"{"name":"f","size":1,"type":""}"#,
            b"x",
        );
        let out_path = dir.path().join("out.txt");
        let wrong_key = [0u8; 32];

        let result = decrypt_and_write(&blob, &wrong_key, out_path.clone());
        assert!(result.is_err());
        assert!(!out_path.exists(), "output file must not be created on failure");
    }

    // FIX-09 additional edge case tests

    #[test]
    fn test_empty_content() {
        let metadata = r#"{"name":"empty.txt","size":0}"#;
        let blob = encrypt_for_test(&TEST_KEY, metadata, b"");
        let result = decrypt_blob(&blob, &TEST_KEY).unwrap();
        assert_eq!(result.content, b"");
        assert_eq!(result.metadata["name"], "empty.txt");
    }

    #[test]
    fn test_metadata_cap_boundary() {
        // Metadata of exactly 4096 bytes (sep_idx == 4096) — at cap, should pass
        let base = r#"{"k":""}"#; // 8 bytes
        let filler_ok: String = "x".repeat(4096 - base.len());
        let meta_4096 = format!(r#"{{"k":"{filler_ok}"}}"#);
        assert_eq!(meta_4096.len(), 4096, "fixture must be exactly 4096 bytes");
        let blob_ok = encrypt_for_test(&TEST_KEY, &meta_4096, b"data");
        assert!(decrypt_blob(&blob_ok, &TEST_KEY).is_ok(), "4096-byte metadata must pass");

        // Metadata of 4097 bytes (sep_idx == 4097) — over cap, should fail
        let filler_over: String = "x".repeat(4097 - base.len());
        let meta_4097 = format!(r#"{{"k":"{filler_over}"}}"#);
        assert_eq!(meta_4097.len(), 4097, "fixture must be exactly 4097 bytes");
        let blob_over = encrypt_for_test(&TEST_KEY, &meta_4097, b"data");
        assert!(decrypt_blob(&blob_over, &TEST_KEY).is_err(), "4097-byte metadata must fail");
    }

    #[test]
    fn test_null_byte_in_content() {
        let metadata = r#"{"name":"binary.bin"}"#;
        // Content contains null bytes; only the first 0x00 (the separator) should be consumed
        let content: &[u8] = b"\x00binary\x00data\x00";
        let blob = encrypt_for_test(&TEST_KEY, metadata, content);
        let result = decrypt_blob(&blob, &TEST_KEY).unwrap();
        assert_eq!(result.content, content, "null bytes in content must be preserved");
    }

    #[test]
    fn test_invalid_utf8_in_metadata() {
        // Manually encrypt plaintext with invalid UTF-8 bytes before the 0x00 separator
        let iv = [2u8; 12]; // distinct IV from other tests
        let mut plaintext = Vec::new();
        plaintext.extend_from_slice(&[0xFF, 0xFE]); // invalid UTF-8 bytes
        plaintext.push(0x00); // separator
        plaintext.extend_from_slice(b"content");

        let cipher = Aes256Gcm::new(GenericArray::from_slice(&TEST_KEY));
        let nonce = GenericArray::from_slice(&iv);
        let ct = cipher.encrypt(nonce, plaintext.as_slice()).unwrap();
        let mut blob = Vec::new();
        blob.extend_from_slice(&iv);
        blob.extend_from_slice(&ct);

        let result = decrypt_blob(&blob, &TEST_KEY);
        assert!(result.is_err(), "invalid UTF-8 in metadata must return error");
    }
}
