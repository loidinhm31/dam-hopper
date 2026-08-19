//! Windows OpenSSH named-pipe agent and contained `.ssh` inventory adapter.

use std::{
    env,
    fs::File,
    io::{self, Read},
    path::{Path, PathBuf},
    time::Duration,
};

use base64::Engine as _;
use russh::keys::{agent::client::AgentClient, HashAlg, PrivateKey};
use sha2::{Digest, Sha256};
use tokio::time::timeout;
use zeroize::Zeroizing;

use super::{CredentialError, KeySource, LoadedSafeKey, SafeKeyRecord};
use crate::ssh_forward::known_hosts::is_supported_algorithm;
use crate::ssh_forward::windows_storage_probe::{
    enumerate_directory_tolerant, open_root, validate_retained_handle,
};

const OPENSSH_AGENT_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

pub(crate) async fn agent_inventory() -> Result<Vec<SafeKeyRecord>, CredentialError> {
    let mut agent = timeout(
        Duration::from_secs(5),
        AgentClient::connect_named_pipe(OPENSSH_AGENT_PIPE),
    )
    .await
    .map_err(|_| CredentialError::AgentUnavailable)?
    .map_err(|_| CredentialError::AgentUnavailable)?;
    let identities = timeout(Duration::from_secs(5), agent.request_identities())
        .await
        .map_err(|_| CredentialError::AgentUnavailable)?
        .map_err(|_| CredentialError::AgentUnavailable)?;
    Ok(identities
        .into_iter()
        .filter_map(|identity| {
            let public_key = identity.public_key();
            let algorithm = public_key.algorithm().to_string();
            if !is_supported_algorithm(&algorithm) {
                return None;
            }
            let fingerprint = public_key.fingerprint(HashAlg::Sha256).to_string();
            Some((algorithm, fingerprint))
        })
        .take(super::MAX_AGENT_IDENTITIES)
        .enumerate()
        .map(|(index, (algorithm, fingerprint))| SafeKeyRecord {
            key_id: format!("agent-{index}"),
            label: format!("Agent identity {}", index + 1),
            algorithm,
            fingerprint,
            encrypted: false,
            source: KeySource::Agent,
        })
        .collect())
}

pub(crate) fn safe_key_inventory() -> Result<Vec<SafeKeyRecord>, CredentialError> {
    let root = ssh_directory()?;
    scan_inventory(&root)
}

pub(crate) fn load_safe_key(
    key_id: &str,
    passphrase: Option<&str>,
) -> Result<LoadedSafeKey, CredentialError> {
    let root = ssh_directory()?;
    let entries = inventory_entries(&root)?;
    for entry in entries {
        if entry.is_directory {
            continue;
        }
        if !is_private_candidate(&entry.name) {
            continue;
        }
        if validate_retained_handle(&entry.handle, false).is_err() {
            continue;
        }
        let bytes = match read_bounded(File::from(entry.handle)).map(Zeroizing::new) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let key = match PrivateKey::from_openssh(&bytes) {
            Ok(key) => key,
            Err(_) => continue,
        };
        if key_id_for(&key) != key_id {
            continue;
        }
        let algorithm = key.public_key().algorithm().to_string();
        if !is_supported_algorithm(&algorithm) {
            continue;
        }
        if key.is_encrypted() {
            let Some(passphrase) = passphrase else {
                return Err(CredentialError::KeyEncrypted);
            };
            return key
                .decrypt(passphrase.as_bytes())
                .map(|key| LoadedSafeKey {
                    key,
                    encrypted: true,
                })
                .map_err(|_| CredentialError::InvalidPassphrase);
        }
        return Ok(LoadedSafeKey {
            key,
            encrypted: false,
        });
    }
    Err(CredentialError::KeyNotFound)
}

fn ssh_directory() -> Result<std::os::windows::io::OwnedHandle, CredentialError> {
    let user_profile = env::var_os("USERPROFILE").ok_or(CredentialError::KeyUnsafe)?;
    let path = PathBuf::from(user_profile).join(".ssh");
    open_root(&path).map_err(|_| CredentialError::KeyUnsafe)
}

fn scan_inventory(
    root: &std::os::windows::io::OwnedHandle,
) -> Result<Vec<SafeKeyRecord>, CredentialError> {
    let entries = inventory_entries(root)?;
    let mut records = Vec::new();
    for entry in entries {
        if entry.is_directory || !is_private_candidate(&entry.name) {
            continue;
        }
        if validate_retained_handle(&entry.handle, false).is_err() {
            continue;
        }
        let bytes = match read_bounded(File::from(entry.handle)).map(Zeroizing::new) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let Ok(key) = PrivateKey::from_openssh(&bytes) else {
            continue;
        };
        let algorithm = key.public_key().algorithm().to_string();
        if !is_supported_algorithm(&algorithm) {
            continue;
        }
        let encrypted = key.is_encrypted();
        records.push(SafeKeyRecord {
            key_id: key_id_for(&key),
            label: if encrypted {
                format!("{} (passphrase required)", safe_label(&entry.name))
            } else {
                safe_label(&entry.name)
            },
            algorithm,
            fingerprint: key.public_key().fingerprint(HashAlg::Sha256).to_string(),
            encrypted,
            source: KeySource::Local,
        });
        if records.len() == super::MAX_AGENT_IDENTITIES {
            break;
        }
    }
    Ok(records)
}

fn inventory_entries(
    root: &std::os::windows::io::OwnedHandle,
) -> Result<Vec<crate::ssh_forward::windows_storage_probe::DirectoryEntry>, CredentialError> {
    validate_retained_handle(root, true).map_err(|_| CredentialError::KeyUnsafe)?;
    let entries = enumerate_directory_tolerant(root, super::MAX_INVENTORY_ENTRIES)
        .map_err(|_| CredentialError::KeyUnsafe)?;
    validate_retained_handle(root, true).map_err(|_| CredentialError::KeyUnsafe)?;
    Ok(entries)
}

fn read_bounded(file: File) -> Result<Vec<u8>, CredentialError> {
    let metadata = file.metadata().map_err(|_| CredentialError::KeyUnsafe)?;
    if !metadata.is_file() || metadata.len() as usize > super::MAX_KEY_BYTES {
        return Err(CredentialError::KeyUnsafe);
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take((super::MAX_KEY_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| CredentialError::KeyUnsafe)?;
    if bytes.len() > super::MAX_KEY_BYTES {
        Err(CredentialError::KeyUnsafe)
    } else {
        Ok(bytes)
    }
}

fn is_private_candidate(name: &str) -> bool {
    !name.starts_with('.') && !name.ends_with(".pub") && name != "config" && name != "known_hosts"
}

fn safe_label(name: &str) -> String {
    name.chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
        })
        .take(64)
        .collect::<String>()
        .trim_matches('.')
        .to_string()
}

fn key_id_for(key: &PrivateKey) -> String {
    let mut digest = Sha256::new();
    digest.update(key.public_key().to_bytes().unwrap_or_default());
    format!(
        "key-{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest.finalize())
    )
}

#[allow(dead_code)]
fn _path_is_internal_only(path: &Path) -> bool {
    path.file_name().is_some()
}

#[allow(dead_code)]
fn _io(_: io::Error) -> CredentialError {
    CredentialError::KeyUnsafe
}
