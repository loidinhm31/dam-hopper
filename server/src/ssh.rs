/// SSH credential management for git operations.
///
/// `SshCredStore` holds a private key path and passphrase in memory
/// for the current server session. The passphrase is stored as raw bytes
/// so it never appears in `{:?}` formatted log output.
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// SshCredStore
// ---------------------------------------------------------------------------

/// In-memory SSH credential for a single key + passphrase pair.
/// Debug impl redacts the passphrase to prevent accidental log leaks.
#[derive(Clone)]
pub struct SshCredStore {
    pub key_path: PathBuf,
    passphrase: Vec<u8>,
}

impl SshCredStore {
    pub fn new(key_path: PathBuf, passphrase: &str) -> Self {
        Self {
            key_path,
            passphrase: passphrase.as_bytes().to_vec(),
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
    dirs::home_dir()
        .map(|h| h.join(".ssh"))
        .or_else(|| {
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
