/// SSH credential management for git operations.
///
/// `SshCredStore` holds a private key path and passphrase in memory for the
/// current server session. Saved passphrases are optional and delegated to the
/// host OS credential store; DamHopper never writes plaintext passphrases to app
/// config, localStorage, logs, or API responses.
///
/// Threat model: OS credential storage provides encrypted-at-rest persistence
/// for ordinary disk disclosure. It does not protect against a compromised
/// same-user process that can ask the OS keyring or the running DamHopper server
/// to use the credential.
use base64::Engine as _;
use sha2::{Digest, Sha256};
use std::fmt;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use zeroize::Zeroizing;

// ---------------------------------------------------------------------------
// SshCredStore
// ---------------------------------------------------------------------------

/// In-memory SSH credential for a single key + passphrase pair.
/// Debug impl redacts the passphrase to prevent accidental log leaks.
#[derive(Clone)]
pub struct SshCredStore {
    pub key_path: PathBuf,
    passphrase: Zeroizing<Vec<u8>>,
}

impl SshCredStore {
    pub fn new(key_path: PathBuf, passphrase: &str) -> Self {
        Self {
            key_path,
            passphrase: Zeroizing::new(passphrase.as_bytes().to_vec()),
        }
    }

    /// Returns the passphrase as a &str.
    /// Panics only if the bytes are not valid UTF-8, which cannot happen because
    /// `new()` only accepts &str input.
    pub fn passphrase(&self) -> &str {
        std::str::from_utf8(&self.passphrase).unwrap_or("")
    }

    /// Returns the corresponding public key path if it exists alongside the private key.
    pub fn public_key_path(&self) -> Option<PathBuf> {
        let pub_path = self.key_path.with_extension("pub");
        if pub_path.exists() {
            Some(pub_path)
        } else {
            None
        }
    }
}

// ---------------------------------------------------------------------------
// Saved credential keying + OS keyring persistence
// ---------------------------------------------------------------------------

const KEYRING_SERVICE: &str = "dam-hopper.ssh-passphrase";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SshCredentialKey {
    account: String,
    label: String,
    public_fingerprint: Option<String>,
}

impl SshCredentialKey {
    pub fn account(&self) -> &str {
        &self.account
    }

    pub fn label(&self) -> &str {
        &self.label
    }

    pub fn public_fingerprint(&self) -> Option<&str> {
        self.public_fingerprint.as_deref()
    }
}

/// Builds a stable saved-secret key scoped to this workspace and SSH key.
pub fn credential_key(workspace_dir: &Path, key_path: &Path) -> SshCredentialKey {
    let workspace = normalize_path_for_key(workspace_dir);
    let key = normalize_path_for_key(key_path);
    let public_fingerprint = public_key_fingerprint(key_path);
    let material = match &public_fingerprint {
        Some(fingerprint) => format!("workspace={workspace}\nkey={key}\npub={fingerprint}"),
        None => format!("workspace={workspace}\nkey={key}"),
    };
    let account = format!("v1:{}", sha256_hex(material.as_bytes()));
    let key_name = key_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("ssh-key");
    let label = format!("DamHopper SSH passphrase for {key_name}");

    SshCredentialKey {
        account,
        label,
        public_fingerprint,
    }
}

pub fn public_key_fingerprint(key_path: &Path) -> Option<String> {
    let pub_path = key_path.with_extension("pub");
    let bytes = std::fs::read(pub_path).ok()?;
    if bytes.is_empty() {
        return None;
    }
    Some(format!("sha256:{}", sha256_hex(&bytes)))
}

fn normalize_path_for_key(path: &Path) -> String {
    dunce::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use fmt::Write as _;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SshCredentialStoreError {
    Unavailable(String),
    Failed(String),
    Utf8(String),
}

impl fmt::Display for SshCredentialStoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable(message) | Self::Failed(message) | Self::Utf8(message) => {
                f.write_str(message)
            }
        }
    }
}

impl std::error::Error for SshCredentialStoreError {}

pub trait PersistentSshCredentialStore {
    fn save(&self, key: &SshCredentialKey, passphrase: &str)
        -> Result<(), SshCredentialStoreError>;
    fn load(&self, key: &SshCredentialKey) -> Result<Zeroizing<String>, SshCredentialStoreError>;
    fn delete(&self, key: &SshCredentialKey) -> Result<bool, SshCredentialStoreError>;
    fn exists(&self, key: &SshCredentialKey) -> Result<bool, SshCredentialStoreError>;
}

#[derive(Clone, Debug)]
pub struct KeyringSshCredentialStore {
    program: PathBuf,
}

impl Default for KeyringSshCredentialStore {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyringSshCredentialStore {
    pub fn new() -> Self {
        Self {
            program: PathBuf::from("secret-tool"),
        }
    }

    #[cfg(test)]
    pub fn with_program(program: PathBuf) -> Self {
        Self { program }
    }

    fn ensure_supported(&self) -> Result<(), SshCredentialStoreError> {
        if cfg!(target_os = "linux") {
            Ok(())
        } else {
            Err(SshCredentialStoreError::Unavailable(
                "OS keyring persistence is not supported on this platform yet".to_string(),
            ))
        }
    }

    fn command(&self) -> Command {
        Command::new(&self.program)
    }

    fn run(&self, args: &[&str]) -> Result<Output, SshCredentialStoreError> {
        self.ensure_supported()?;
        self.command()
            .args(args)
            .output()
            .map_err(|e| keyring_io_error(&self.program, e))
    }
}

impl PersistentSshCredentialStore for KeyringSshCredentialStore {
    fn save(
        &self,
        key: &SshCredentialKey,
        passphrase: &str,
    ) -> Result<(), SshCredentialStoreError> {
        self.ensure_supported()?;
        let mut child = self
            .command()
            .args([
                "store",
                "--label",
                key.label(),
                "service",
                KEYRING_SERVICE,
                "account",
                key.account(),
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| keyring_io_error(&self.program, e))?;

        let encoded = base64::engine::general_purpose::STANDARD.encode(passphrase.as_bytes());
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(encoded.as_bytes()).map_err(|e| {
                SshCredentialStoreError::Failed(format!(
                    "Failed to write passphrase to OS keyring: {e}"
                ))
            })?;
        }

        let output = child.wait_with_output().map_err(|e| {
            SshCredentialStoreError::Failed(format!("Failed to wait for OS keyring: {e}"))
        })?;

        if output.status.success() {
            Ok(())
        } else {
            Err(SshCredentialStoreError::Failed(format!(
                "OS keyring save failed: {}",
                stderr_message(&output)
            )))
        }
    }

    fn load(&self, key: &SshCredentialKey) -> Result<Zeroizing<String>, SshCredentialStoreError> {
        let output = self.run(&[
            "lookup",
            "service",
            KEYRING_SERVICE,
            "account",
            key.account(),
        ])?;

        if !output.status.success() {
            return Err(SshCredentialStoreError::Failed(format!(
                "No saved SSH passphrase found: {}",
                stderr_message(&output)
            )));
        }

        let encoded = String::from_utf8(output.stdout)
            .map_err(|e| SshCredentialStoreError::Utf8(format!("Invalid keyring secret: {e}")))?;
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded.trim_end_matches(['\r', '\n']))
            .map_err(|e| SshCredentialStoreError::Utf8(format!("Invalid keyring secret: {e}")))?;
        String::from_utf8(decoded)
            .map(Zeroizing::new)
            .map_err(|e| SshCredentialStoreError::Utf8(format!("Invalid keyring secret: {e}")))
    }

    fn delete(&self, key: &SshCredentialKey) -> Result<bool, SshCredentialStoreError> {
        let had_secret = self.exists(key)?;
        if !had_secret {
            return Ok(false);
        }

        let output = self.run(&[
            "clear",
            "service",
            KEYRING_SERVICE,
            "account",
            key.account(),
        ])?;

        if output.status.success() {
            Ok(true)
        } else {
            Err(SshCredentialStoreError::Failed(format!(
                "OS keyring delete failed: {}",
                stderr_message(&output)
            )))
        }
    }

    fn exists(&self, key: &SshCredentialKey) -> Result<bool, SshCredentialStoreError> {
        let output = self.run(&[
            "search",
            "service",
            KEYRING_SERVICE,
            "account",
            key.account(),
        ])?;

        Ok(output.status.success() && !output.stdout.is_empty())
    }
}

fn keyring_io_error(program: &Path, error: std::io::Error) -> SshCredentialStoreError {
    if error.kind() == std::io::ErrorKind::NotFound {
        SshCredentialStoreError::Unavailable(format!(
            "OS keyring command not available: {}",
            program.display()
        ))
    } else {
        SshCredentialStoreError::Failed(format!("OS keyring error: {error}"))
    }
}

fn stderr_message(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let trimmed = stderr.trim();
    if trimmed.is_empty() {
        format!("exit status {}", output.status)
    } else {
        trimmed.to_string()
    }
}

impl std::fmt::Debug for SshCredStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SshCredStore")
            .field("key_path", &self.key_path)
            .field("passphrase", &"[REDACTED]")
            .finish()
    }
}

// ---------------------------------------------------------------------------
// Key discovery
// ---------------------------------------------------------------------------

/// Well-known OpenSSH private key file basenames (no extension).
const KNOWN_KEY_NAMES: &[&str] = &[
    "id_ed25519",
    "id_ed25519_sk",
    "id_rsa",
    "id_ecdsa",
    "id_ecdsa_sk",
    "id_dsa",
];

/// Returns the `~/.ssh` directory, or `%USERPROFILE%\.ssh` on Windows when
/// `dirs::home_dir()` is unavailable.
pub fn ssh_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".ssh")).or_else(|| {
        std::env::var("USERPROFILE")
            .ok()
            .map(|p| PathBuf::from(p).join(".ssh"))
    })
}

/// Resolves a key basename to its absolute path inside `~/.ssh`.
/// Returns `None` if the file does not exist or the SSH dir cannot be found.
pub fn resolve_key_path(basename: &str) -> Option<PathBuf> {
    let dir = ssh_dir()?;
    let path = dir.join(basename);
    if path.exists() && path.is_file() {
        Some(path)
    } else {
        None
    }
}

/// Scan `~/.ssh` for private key files and return their basenames.
///
/// Discovery order:
/// 1. Well-known names (`id_ed25519`, `id_rsa`, etc.) that exist on disk.
/// 2. Any other non-`.pub` file in the directory whose content starts with a
///    PEM private key header (best-effort; skips files that cannot be read).
pub fn scan_ssh_keys() -> Vec<String> {
    let dir = match ssh_dir().filter(|d| d.is_dir()) {
        Some(d) => d,
        None => return Vec::new(),
    };

    let mut keys: Vec<String> = Vec::new();

    // Pass 1 — well-known names in priority order
    for name in KNOWN_KEY_NAMES {
        if dir.join(name).is_file() {
            keys.push((*name).to_string());
        }
    }

    // Pass 2 — any remaining file that looks like a private key
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy().to_string();

            if name_str.ends_with(".pub") {
                continue;
            }
            if keys.contains(&name_str) {
                continue;
            }

            let path = entry.path();
            if !path.is_file() {
                continue;
            }

            if looks_like_private_key(&path) {
                keys.push(name_str);
            }
        }
    }

    keys
}

fn looks_like_private_key(path: &Path) -> bool {
    use std::io::BufRead;
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut reader = std::io::BufReader::new(file);
    let mut first_line = String::new();
    if reader.read_line(&mut first_line).is_err() {
        return false;
    }
    first_line.contains("-----BEGIN") && first_line.contains("PRIVATE KEY")
        || first_line.trim() == "-----BEGIN OPENSSH PRIVATE KEY-----"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ssh_credential_debug_redacts_passphrase() {
        let cred = SshCredStore::new(PathBuf::from("/tmp/id_ed25519"), "super-secret");
        let debug = format!("{cred:?}");

        assert!(debug.contains("[REDACTED]"));
        assert!(!debug.contains("super-secret"));
    }

    #[test]
    fn credential_key_is_stable_and_scoped() {
        let workspace = Path::new("/tmp/workspace");
        let key = Path::new("/tmp/.ssh/id_ed25519");

        let first = credential_key(workspace, key);
        let second = credential_key(workspace, key);
        let other_workspace = credential_key(Path::new("/tmp/other"), key);

        assert_eq!(first, second);
        assert_ne!(first.account(), other_workspace.account());
        assert!(first.account().starts_with("v1:"));
        assert_eq!(first.account().len(), 67);
    }

    #[cfg(unix)]
    #[test]
    fn keyring_store_uses_stdin_and_supports_roundtrip_with_secret_tool() {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let secret_file = dir.path().join("secret.txt");
        let script = dir.path().join("secret-tool");
        fs::write(
            &script,
            format!(
                r#"#!/usr/bin/env sh
set -eu
cmd="$1"
shift
case "$cmd" in
  store)
    cat > "{}"
    ;;
  lookup)
    cat "{}"
    ;;
  search)
    if [ -f "{}" ]; then echo "attribute.service = dam-hopper.ssh-passphrase"; fi
    ;;
  clear)
    rm -f "{}"
    ;;
  *)
    exit 2
    ;;
esac
"#,
                secret_file.display(),
                secret_file.display(),
                secret_file.display(),
                secret_file.display()
            ),
        )
        .unwrap();
        let mut perms = fs::metadata(&script).unwrap().permissions();
        perms.set_mode(0o700);
        fs::set_permissions(&script, perms).unwrap();

        let store = KeyringSshCredentialStore::with_program(script);
        let key = credential_key(
            Path::new("/tmp/workspace"),
            Path::new("/tmp/.ssh/id_ed25519"),
        );

        assert!(!store.exists(&key).unwrap());
        store.save(&key, "super-secret\n").unwrap();
        assert!(store.exists(&key).unwrap());
        assert_eq!(store.load(&key).unwrap().as_str(), "super-secret\n");
        assert!(store.delete(&key).unwrap());
        assert!(!store.exists(&key).unwrap());
    }

    #[cfg(unix)]
    #[test]
    fn keyring_store_reports_missing_command_as_unavailable() {
        let store = KeyringSshCredentialStore::with_program(PathBuf::from(
            "/tmp/dam-hopper-definitely-missing-secret-tool",
        ));
        let key = credential_key(
            Path::new("/tmp/workspace"),
            Path::new("/tmp/.ssh/id_ed25519"),
        );

        let err = store.exists(&key).unwrap_err();
        assert!(matches!(err, SshCredentialStoreError::Unavailable(_)));
        assert!(!err.to_string().contains("id_ed25519"));
    }
}
