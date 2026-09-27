use std::path::Path;
use std::sync::Arc;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rand::RngCore;
use thiserror::Error;
use zeroize::{Zeroize, Zeroizing};

#[derive(Debug, Error)]
pub enum MfaSecretError {
    #[error("I/O error reading MFA key file: {0}")]
    Io(#[from] std::io::Error),
    #[error("Insecure permissions on MFA key file {0:?}: permissions must be restricted to owner (e.g. chmod 600)")]
    InsecurePermissions(std::path::PathBuf),
    #[error("Invalid MFA key length: expected 32 raw bytes, 64 hex characters, or 44 base64 characters")]
    InvalidKeyLength,
    #[error("Invalid key encoding: {0}")]
    InvalidEncoding(String),
    #[error("Encryption failed: {0}")]
    EncryptionFailed(String),
    #[error("Decryption failed (corrupt data, wrong key, or AAD mismatch): {0}")]
    DecryptionFailed(String),
    #[error("Invalid base64 payload: {0}")]
    Base64Decode(#[from] base64::DecodeError),
    #[error("Key ID mismatch: expected {expected}, found {found}")]
    KeyIdMismatch { expected: String, found: String },
}

/// Dedicated 32-byte key for encrypting MFA secrets at rest.
/// Wipes bytes from memory on drop.
#[derive(Clone)]
pub struct MfaEncryptionKey {
    key_bytes: Arc<Zeroizing<[u8; 32]>>,
    key_id: String,
}

impl MfaEncryptionKey {
    pub fn new(raw: [u8; 32], key_id: impl Into<String>) -> Self {
        Self {
            key_bytes: Arc::new(Zeroizing::new(raw)),
            key_id: key_id.into(),
        }
    }

    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.key_bytes
    }

    /// Load the 32-byte key from a filesystem path, enforcing strict Unix permissions.
    pub fn from_file(path: impl AsRef<Path>) -> Result<Self, MfaSecretError> {
        let path = path.as_ref();
        let metadata = std::fs::symlink_metadata(path)?;
        if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
            return Err(MfaSecretError::InsecurePermissions(path.to_path_buf()));
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = metadata.permissions().mode();
            // Reject any group or world read/write/execute bits (0o077)
            if mode & 0o077 != 0 {
                return Err(MfaSecretError::InsecurePermissions(path.to_path_buf()));
            }
        }

        let mut content = std::fs::read(path)?;
        let key_bytes = parse_key_bytes(&content)?;
        content.zeroize();

        // Key ID derived from file stem or hash
        let key_id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("mfa-key-v1")
            .to_string();

        Ok(Self::new(key_bytes, key_id))
    }

    /// Encrypt plaintext using AES-256-GCM with authenticated associated data.
    /// Returns `(ciphertext_base64, nonce_base64)`.
    pub fn encrypt(
        &self,
        username: &str,
        purpose: &str,
        plaintext: &[u8],
    ) -> Result<(String, String), MfaSecretError> {
        let cipher = Aes256Gcm::new_from_slice(self.as_bytes())
            .map_err(|e| MfaSecretError::EncryptionFailed(e.to_string()))?;

        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let aad = format!("dam-hopper-mfa:{}:{}:{}", self.key_id, username, purpose);
        let payload = Payload {
            msg: plaintext,
            aad: aad.as_bytes(),
        };

        let ciphertext = cipher
            .encrypt(nonce, payload)
            .map_err(|e| MfaSecretError::EncryptionFailed(e.to_string()))?;

        Ok((BASE64.encode(ciphertext), BASE64.encode(nonce_bytes)))
    }

    /// Decrypt ciphertext using AES-256-GCM with authenticated associated data.
    /// Returns the decrypted bytes in zeroizing buffer.
    pub fn decrypt(
        &self,
        username: &str,
        purpose: &str,
        key_id: &str,
        ciphertext_b64: &str,
        nonce_b64: &str,
    ) -> Result<Zeroizing<Vec<u8>>, MfaSecretError> {
        if key_id != self.key_id {
            return Err(MfaSecretError::KeyIdMismatch {
                expected: self.key_id.clone(),
                found: key_id.to_string(),
            });
        }

        let ciphertext = BASE64.decode(ciphertext_b64)?;
        let nonce_bytes = BASE64.decode(nonce_b64)?;
        if nonce_bytes.len() != 12 {
            return Err(MfaSecretError::DecryptionFailed(
                "Invalid nonce length (must be 12 bytes)".into(),
            ));
        }
        let nonce = Nonce::from_slice(&nonce_bytes);

        let cipher = Aes256Gcm::new_from_slice(self.as_bytes())
            .map_err(|e| MfaSecretError::DecryptionFailed(e.to_string()))?;

        let aad = format!("dam-hopper-mfa:{}:{}:{}", key_id, username, purpose);
        let payload = Payload {
            msg: &ciphertext,
            aad: aad.as_bytes(),
        };

        let plaintext = cipher
            .decrypt(nonce, payload)
            .map_err(|e| MfaSecretError::DecryptionFailed(e.to_string()))?;

        Ok(Zeroizing::new(plaintext))
    }
}

fn parse_key_bytes(raw: &[u8]) -> Result<[u8; 32], MfaSecretError> {
    let trimmed = match std::str::from_utf8(raw) {
        Ok(s) => s.trim().as_bytes(),
        Err(_) => raw,
    };

    if trimmed.len() == 32 {
        let mut key = [0u8; 32];
        key.copy_from_slice(trimmed);
        return Ok(key);
    }

    // Try hex decoding (64 hex characters)
    if trimmed.len() == 64 {
        if let Ok(s) = std::str::from_utf8(trimmed) {
            if let Ok(bytes) = hex::decode(s) {
                if bytes.len() == 32 {
                    let mut key = [0u8; 32];
                    key.copy_from_slice(&bytes);
                    return Ok(key);
                }
            }
        }
    }

    // Try base64 decoding (44 characters)
    if trimmed.len() == 44 {
        if let Ok(bytes) = BASE64.decode(trimmed) {
            if bytes.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&bytes);
                return Ok(key);
            }
        }
    }

    Err(MfaSecretError::InvalidKeyLength)
}
