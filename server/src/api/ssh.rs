/// SSH credential API handlers.
///
/// GET  /api/ssh/keys        — list private key basenames from ~/.ssh
/// GET  /api/ssh/agent       — check if ssh-agent is running with loaded keys
/// POST /api/ssh/keys/load   — store passphrase+key in AppState for git operations
/// GET  /api/ssh/credentials — return saved-passphrase metadata only
/// DELETE /api/ssh/credentials — forget a saved passphrase
use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use zeroize::Zeroizing;

use crate::ssh::{
    credential_key, resolve_key_path, scan_ssh_keys, KeyringSshCredentialStore,
    PersistentSshCredentialStore, SshCredStore,
};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// GET /api/ssh/keys
// ---------------------------------------------------------------------------

pub async fn list_keys() -> impl IntoResponse {
    let keys = scan_ssh_keys();
    Json(keys)
}

// ---------------------------------------------------------------------------
// GET /api/ssh/agent
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct AgentStatus {
    has_keys: bool,
    key_count: usize,
}

pub async fn check_agent() -> impl IntoResponse {
    let status = probe_ssh_agent();
    Json(status)
}

fn probe_ssh_agent() -> AgentStatus {
    // Run `ssh-add -l` — exit 0 = keys loaded, exit 1 = no keys, exit 2 = no agent
    let output = std::process::Command::new("ssh-add").arg("-l").output();

    match output {
        Ok(out) if out.status.success() => {
            let count = String::from_utf8_lossy(&out.stdout)
                .lines()
                .filter(|l| !l.is_empty())
                .count();
            AgentStatus {
                has_keys: true,
                key_count: count,
            }
        }
        _ => AgentStatus {
            has_keys: false,
            key_count: 0,
        },
    }
}

// ---------------------------------------------------------------------------
// POST /api/ssh/keys/load
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadKeyBody {
    #[serde(default)]
    pub passphrase: Option<String>,
    pub key_path: Option<String>,
    #[serde(default)]
    pub save_for_later: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadKeyResult {
    pub success: bool,
    pub saved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub async fn load_key(
    State(state): State<AppState>,
    Json(body): Json<LoadKeyBody>,
) -> impl IntoResponse {
    let result = do_load_key(&state, body).await;
    Json(result)
}

async fn do_load_key(state: &AppState, body: LoadKeyBody) -> LoadKeyResult {
    let key_path = match resolve_requested_key_path(body.key_path.as_deref()) {
        Ok(path) => path,
        Err(error) => return load_failure(error),
    };
    let config_path = state.config.read().await.config_path.clone();
    let keyring = KeyringSshCredentialStore::new();

    match prepare_loaded_credential(
        &config_path,
        key_path,
        body.passphrase,
        body.save_for_later,
        &keyring,
        validate_ssh_key,
    ) {
        Ok((cred, result)) => {
            *state.ssh_creds.write().await = Some(Arc::new(cred));
            result
        }
        Err(result) => result,
    }
}

fn prepare_loaded_credential<S, F>(
    config_scope_path: &Path,
    key_path: PathBuf,
    passphrase: Option<String>,
    save_for_later: bool,
    keyring: &S,
    validate: F,
) -> Result<(SshCredStore, LoadKeyResult), LoadKeyResult>
where
    S: PersistentSshCredentialStore,
    F: Fn(&Path, &str) -> Result<(), String>,
{
    let key_name = key_name(&key_path);
    let saved_key = credential_key(config_scope_path, &key_path);

    let loaded_from_saved = passphrase.is_none();
    let passphrase = match passphrase {
        Some(passphrase) => Zeroizing::new(passphrase),
        None => match keyring.load(&saved_key) {
            Ok(saved_passphrase) => saved_passphrase,
            Err(error) => {
                return Err(LoadKeyResult {
                    success: false,
                    saved: false,
                    key_path: key_name,
                    error: Some(format!("No saved SSH passphrase is available: {error}")),
                });
            }
        },
    };

    if let Err(e) = validate(&key_path, &passphrase) {
        return Err(LoadKeyResult {
            success: false,
            saved: false,
            key_path: key_name,
            error: Some(e),
        });
    }

    let mut saved = loaded_from_saved;
    let mut error = None;

    if save_for_later && !passphrase.is_empty() {
        match keyring.save(&saved_key, &passphrase) {
            Ok(()) => saved = true,
            Err(e) => {
                saved = false;
                error = Some(format!(
                    "Key loaded for this session only; save for later failed: {e}"
                ));
            }
        }
    } else if !saved {
        saved = keyring.exists(&saved_key).unwrap_or(false);
    }

    let cred = SshCredStore::new(key_path, &passphrase);
    Ok((
        cred,
        LoadKeyResult {
            success: true,
            saved,
            key_path: key_name,
            error,
        },
    ))
}

// ---------------------------------------------------------------------------
// GET/DELETE /api/ssh/credentials
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialQuery {
    pub key_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    pub saved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct ForgetCredentialResult {
    pub success: bool,
    pub forgotten: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub async fn credential_status(
    State(state): State<AppState>,
    Query(query): Query<CredentialQuery>,
) -> impl IntoResponse {
    let result = do_credential_status(&state, query).await;
    Json(result)
}

pub async fn forget_credential(
    State(state): State<AppState>,
    Query(query): Query<CredentialQuery>,
) -> impl IntoResponse {
    let result = do_forget_credential(&state, query).await;
    Json(result)
}

async fn do_credential_status(state: &AppState, query: CredentialQuery) -> CredentialStatus {
    let key_path = match resolve_requested_key_path(query.key_path.as_deref()) {
        Ok(path) => path,
        Err(error) => {
            return CredentialStatus {
                saved: false,
                key_path: None,
                error: Some(error),
            };
        }
    };

    let config_path = state.config.read().await.config_path.clone();
    let saved_key = credential_key(&config_path, &key_path);
    match KeyringSshCredentialStore::new().exists(&saved_key) {
        Ok(saved) => CredentialStatus {
            saved,
            key_path: key_name(&key_path),
            error: None,
        },
        Err(error) => CredentialStatus {
            saved: false,
            key_path: key_name(&key_path),
            error: Some(error.to_string()),
        },
    }
}

async fn do_forget_credential(state: &AppState, query: CredentialQuery) -> ForgetCredentialResult {
    let key_path = match resolve_requested_key_path(query.key_path.as_deref()) {
        Ok(path) => path,
        Err(error) => {
            return ForgetCredentialResult {
                success: false,
                forgotten: false,
                error: Some(error),
            };
        }
    };

    let config_path = state.config.read().await.config_path.clone();
    let saved_key = credential_key(&config_path, &key_path);
    let deleted = match KeyringSshCredentialStore::new().delete(&saved_key) {
        Ok(deleted) => deleted,
        Err(error) => {
            return ForgetCredentialResult {
                success: false,
                forgotten: false,
                error: Some(error.to_string()),
            };
        }
    };

    let should_clear_session = state
        .ssh_creds
        .read()
        .await
        .as_ref()
        .map(|cred| same_path(&cred.key_path, &key_path))
        .unwrap_or(false);
    if should_clear_session {
        *state.ssh_creds.write().await = None;
    }

    ForgetCredentialResult {
        success: true,
        forgotten: deleted,
        error: None,
    }
}

fn resolve_requested_key_path(key_path: Option<&str>) -> Result<PathBuf, String> {
    match key_path {
        Some(basename) if !basename.is_empty() => resolve_key_path(basename)
            .ok_or_else(|| format!("Key file not found: ~/.ssh/{basename}")),
        _ => {
            let keys = scan_ssh_keys();
            let Some(name) = keys.first() else {
                return Err("No SSH private keys found in ~/.ssh".to_string());
            };
            resolve_key_path(name).ok_or_else(|| "No SSH private keys found in ~/.ssh".to_string())
        }
    }
}

fn key_name(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
}

fn same_path(left: &Path, right: &Path) -> bool {
    dunce::canonicalize(left).unwrap_or_else(|_| left.to_path_buf())
        == dunce::canonicalize(right).unwrap_or_else(|_| right.to_path_buf())
}

fn load_failure(error: String) -> LoadKeyResult {
    LoadKeyResult {
        success: false,
        saved: false,
        key_path: None,
        error: Some(error),
    }
}

/// Validate an SSH private key by attempting to create a git2 credential.
/// git2 delegates to libssh2 which decrypts the key — wrong passphrase returns an error.
/// Empty passphrase is treated as None (unencrypted key).
fn validate_ssh_key(key_path: &std::path::Path, passphrase: &str) -> Result<(), String> {
    let pub_path = key_path.with_extension("pub");
    let pub_opt = if pub_path.exists() {
        Some(pub_path.as_path())
    } else {
        None
    };
    let passphrase_opt = if passphrase.is_empty() {
        None
    } else {
        Some(passphrase)
    };

    // git2::Cred::ssh_key validates the private key file + passphrase via libssh2
    git2::Cred::ssh_key("git", pub_opt, key_path, passphrase_opt)
        .map(|_| ())
        .map_err(|e| {
            let msg = e.message().to_lowercase();
            if msg.contains("wrong passphrase")
                || msg.contains("bad passphrase")
                || msg.contains("incorrect passphrase")
            {
                "Wrong passphrase".to_string()
            } else if msg.contains("unable to open") || msg.contains("no such file") {
                format!("Cannot open key file: {}", key_path.display())
            } else {
                format!("Failed to load key: {}", e.message())
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh::SshCredentialStoreError;
    use std::sync::{Arc, Mutex};

    #[derive(Debug, Default)]
    struct FakeStoreState {
        saved_secret: Option<String>,
        exists: bool,
        save_calls: usize,
    }

    #[derive(Clone, Default)]
    struct FakeStore {
        state: Arc<Mutex<FakeStoreState>>,
    }

    impl FakeStore {
        fn save_calls(&self) -> usize {
            self.state.lock().unwrap().save_calls
        }
    }

    impl PersistentSshCredentialStore for FakeStore {
        fn save(
            &self,
            _key: &crate::ssh::SshCredentialKey,
            passphrase: &str,
        ) -> Result<(), SshCredentialStoreError> {
            let mut state = self.state.lock().unwrap();
            state.save_calls += 1;
            state.saved_secret = Some(passphrase.to_string());
            state.exists = true;
            Ok(())
        }

        fn load(
            &self,
            _key: &crate::ssh::SshCredentialKey,
        ) -> Result<Zeroizing<String>, SshCredentialStoreError> {
            self.state
                .lock()
                .unwrap()
                .saved_secret
                .clone()
                .map(Zeroizing::new)
                .ok_or_else(|| {
                    SshCredentialStoreError::Failed("No saved SSH passphrase found".to_string())
                })
        }

        fn delete(
            &self,
            _key: &crate::ssh::SshCredentialKey,
        ) -> Result<bool, SshCredentialStoreError> {
            Ok(false)
        }

        fn exists(
            &self,
            _key: &crate::ssh::SshCredentialKey,
        ) -> Result<bool, SshCredentialStoreError> {
            Ok(self.state.lock().unwrap().exists)
        }
    }

    #[test]
    fn prepare_loaded_credential_keeps_session_only_when_save_disabled() {
        let store = FakeStore::default();
        let (cred, result) = prepare_loaded_credential(
            Path::new("/tmp/workspace"),
            PathBuf::from("/tmp/id_ed25519"),
            Some("test-passphrase".to_string()),
            false,
            &store,
            |_, _| Ok(()),
        )
        .expect("credential should load");

        assert!(result.success);
        assert!(!result.saved);
        assert_eq!(result.key_path.as_deref(), Some("id_ed25519"));
        assert_eq!(store.save_calls(), 0);
        assert_eq!(cred.passphrase(), "test-passphrase");
    }

    #[test]
    fn prepare_loaded_credential_saves_when_requested() {
        let store = FakeStore::default();
        let (_, result) = prepare_loaded_credential(
            Path::new("/tmp/workspace"),
            PathBuf::from("/tmp/id_ed25519"),
            Some("test-passphrase".to_string()),
            true,
            &store,
            |_, _| Ok(()),
        )
        .expect("credential should load");

        assert!(result.success);
        assert!(result.saved);
        assert_eq!(store.save_calls(), 1);
    }

    #[test]
    fn prepare_loaded_credential_does_not_save_when_validation_fails() {
        let store = FakeStore::default();
        let result = prepare_loaded_credential(
            Path::new("/tmp/workspace"),
            PathBuf::from("/tmp/id_ed25519"),
            Some("wrong-passphrase".to_string()),
            true,
            &store,
            |_, _| Err("Wrong passphrase".to_string()),
        )
        .expect_err("validation should fail");

        assert!(!result.success);
        assert_eq!(result.error.as_deref(), Some("Wrong passphrase"));
        assert_eq!(store.save_calls(), 0);
    }

    #[test]
    fn prepare_loaded_credential_reports_existing_saved_state_without_resaving() {
        let store = FakeStore::default();
        {
            let mut state = store.state.lock().unwrap();
            state.exists = true;
            state.saved_secret = Some("already-saved".to_string());
        }

        let (_, result) = prepare_loaded_credential(
            Path::new("/tmp/workspace"),
            PathBuf::from("/tmp/id_ed25519"),
            Some("test-passphrase".to_string()),
            false,
            &store,
            |_, _| Ok(()),
        )
        .expect("credential should load");

        assert!(result.success);
        assert!(result.saved);
        assert_eq!(store.save_calls(), 0);
    }
}
