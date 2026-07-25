use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::Serialize;
use sha2::Sha256;
use std::fs::{self, File, OpenOptions};
use std::io::{self, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};

pub const HMAC_KEY_LENGTH: usize = 32;
pub const FORBIDDEN_CONTENT_FIELDS: &[&str] = &[
    "command",
    "argv",
    "cwd",
    "environment",
    "pty_output",
    "prompt",
    "response",
    "tool_arguments",
    "tool_output",
    "raw_otlp",
];

#[derive(Clone)]
pub struct TelemetryHmacKey([u8; HMAC_KEY_LENGTH]);

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct HmacDigest(String);

impl TryFrom<String> for HmacDigest {
    type Error = String;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            Ok(Self(value))
        } else {
            Err("HMAC digest must be 64 lowercase hexadecimal characters".to_string())
        }
    }
}

impl From<HmacDigest> for String {
    fn from(value: HmacDigest) -> Self {
        value.0
    }
}

impl TelemetryHmacKey {
    pub fn as_bytes(&self) -> &[u8; HMAC_KEY_LENGTH] {
        &self.0
    }

    pub fn digest(&self, domain: &[u8], fields: &[&[u8]]) -> HmacDigest {
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.0).expect("valid HMAC key length");
        mac.update(domain);
        for field in fields {
            mac.update(&(field.len() as u64).to_be_bytes());
            mac.update(field);
        }
        HmacDigest(hex::encode(mac.finalize().into_bytes()))
    }
}

pub fn hmac_key_path() -> io::Result<PathBuf> {
    dirs::config_dir()
        .map(|path| path.join("dam-hopper").join("telemetry-hmac-key"))
        .ok_or_else(|| io::Error::new(ErrorKind::NotFound, "configuration directory unavailable"))
}

pub fn load_or_create_hmac_key(path: &Path) -> io::Result<TelemetryHmacKey> {
    match read_key(path) {
        Ok(key) => return Ok(key),
        Err(error) if error.kind() != ErrorKind::NotFound => return Err(error),
        Err(_) => {}
    }

    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(ErrorKind::InvalidInput, "HMAC key path has no parent"))?;
    fs::create_dir_all(parent)?;

    let mut bytes = [0_u8; HMAC_KEY_LENGTH];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    match create_key(path, &bytes) {
        Ok(()) => Ok(TelemetryHmacKey(bytes)),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => read_key(path),
        Err(error) => Err(error),
    }
}

/// Shared, replaceable HMAC material for terminal and Codex telemetry. Replacing
/// it is only safe while telemetry admission is paused and all persisted rows
/// have been deleted.
pub struct TelemetryKeyRing {
    path: PathBuf,
    key: std::sync::RwLock<TelemetryHmacKey>,
}

impl TelemetryKeyRing {
    pub fn load_or_create(path: PathBuf) -> io::Result<Self> {
        let key = load_or_create_hmac_key(&path)?;
        Ok(Self {
            path,
            key: std::sync::RwLock::new(key),
        })
    }

    pub fn digest(&self, domain: &[u8], fields: &[&[u8]]) -> HmacDigest {
        self.key
            .read()
            .expect("telemetry HMAC key lock poisoned")
            .digest(domain, fields)
    }

    pub fn rotate_after_delete(&self) -> io::Result<()> {
        let parent = self.path.parent().ok_or_else(|| {
            io::Error::new(ErrorKind::InvalidInput, "HMAC key path has no parent")
        })?;
        let replacement = parent.join("telemetry-hmac-key.next");
        let _ = fs::remove_file(&replacement);
        let mut bytes = [0_u8; HMAC_KEY_LENGTH];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        create_key(&replacement, &bytes)?;
        fs::rename(&replacement, &self.path)?;
        *self.key.write().expect("telemetry HMAC key lock poisoned") = TelemetryHmacKey(bytes);
        Ok(())
    }
}

// Replacing this key must be coupled with the authenticated delete-all operation
// in the telemetry store so existing fingerprints never become orphaned.

pub fn assert_serialized_without_content<T: Serialize>(
    value: &T,
    forbidden_values: &[&str],
) -> Result<(), String> {
    let serialized = serde_json::to_string(value).map_err(|error| error.to_string())?;
    let value: serde_json::Value =
        serde_json::from_str(&serialized).map_err(|error| error.to_string())?;
    if contains_forbidden_content(&value, forbidden_values) {
        return Err("serialized telemetry contains forbidden fixture content".to_string());
    }
    Ok(())
}

fn contains_forbidden_content(value: &serde_json::Value, forbidden: &[&str]) -> bool {
    match value {
        serde_json::Value::Object(values) => values.iter().any(|(key, value)| {
            FORBIDDEN_CONTENT_FIELDS.contains(&key.as_str())
                || contains_forbidden_content(value, forbidden)
        }),
        serde_json::Value::Array(values) => values
            .iter()
            .any(|value| contains_forbidden_content(value, forbidden)),
        serde_json::Value::String(value) => {
            forbidden.iter().any(|forbidden| value.contains(forbidden))
        }
        _ => false,
    }
}

fn read_key(path: &Path) -> io::Result<TelemetryHmacKey> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut options = OpenOptions::new();
        options.read(true).custom_flags(libc::O_NOFOLLOW);
        let mut file = options.open(path)?;
        let metadata = file.metadata()?;
        if !metadata.file_type().is_file() || metadata.permissions().mode() & 0o077 != 0 {
            return Err(io::Error::new(
                ErrorKind::PermissionDenied,
                "telemetry HMAC key must be a 0600 regular file",
            ));
        }
        let mut bytes = Vec::with_capacity(HMAC_KEY_LENGTH);
        file.read_to_end(&mut bytes)?;
        return key_from_bytes(bytes);
    }

    #[cfg(not(unix))]
    let bytes = fs::read(path)?;
    #[cfg(not(unix))]
    key_from_bytes(bytes)
}

fn key_from_bytes(bytes: Vec<u8>) -> io::Result<TelemetryHmacKey> {
    let key: [u8; HMAC_KEY_LENGTH] = bytes
        .try_into()
        .map_err(|_| io::Error::new(ErrorKind::InvalidData, "invalid telemetry HMAC key length"))?;
    Ok(TelemetryHmacKey(key))
}

fn create_key(path: &Path, bytes: &[u8; HMAC_KEY_LENGTH]) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file: File = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::{
        assert_serialized_without_content, load_or_create_hmac_key, TelemetryKeyRing,
        HMAC_KEY_LENGTH,
    };

    #[test]
    fn creates_a_stable_32_byte_key() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("telemetry-hmac-key");
        let first = load_or_create_hmac_key(&path).unwrap();
        let second = load_or_create_hmac_key(&path).unwrap();
        assert_eq!(first.as_bytes().len(), HMAC_KEY_LENGTH);
        assert_eq!(first.as_bytes(), second.as_bytes());
    }

    #[cfg(unix)]
    #[test]
    fn creates_key_with_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("telemetry-hmac-key");
        load_or_create_hmac_key(&path).unwrap();
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_or_permissive_existing_key() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let directory = tempfile::tempdir().unwrap();
        let real = directory.path().join("real-key");
        load_or_create_hmac_key(&real).unwrap();
        let link = directory.path().join("linked-key");
        symlink(&real, &link).unwrap();
        assert!(load_or_create_hmac_key(&link).is_err());

        std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(load_or_create_hmac_key(&real).is_err());
    }

    #[test]
    fn content_scan_rejects_fixture_secret() {
        assert!(assert_serialized_without_content(&"fixture-secret", &["fixture-secret"]).is_err());
    }

    #[test]
    fn digest_is_deterministic_and_domain_separated() {
        let directory = tempfile::tempdir().unwrap();
        let key = load_or_create_hmac_key(&directory.path().join("telemetry-hmac-key")).unwrap();
        let first = key.digest(b"cmd:v1", &[b"git"]);
        assert_eq!(first, key.digest(b"cmd:v1", &[b"git"]));
        assert_ne!(first, key.digest(b"agent:v1", &[b"git"]));
        assert!(serde_json::from_str::<super::HmacDigest>("\"invalid\"").is_err());
    }

    #[test]
    fn rotation_replaces_the_persisted_key_and_changes_digests() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("telemetry-hmac-key");
        let keys = TelemetryKeyRing::load_or_create(path.clone()).unwrap();
        let before = keys.digest(b"test", &[b"value"]);
        keys.rotate_after_delete().unwrap();
        let after = keys.digest(b"test", &[b"value"]);
        assert_ne!(before, after);
        assert_eq!(
            after,
            TelemetryKeyRing::load_or_create(path)
                .unwrap()
                .digest(b"test", &[b"value"])
        );
    }
}
