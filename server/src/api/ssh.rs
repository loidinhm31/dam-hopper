/// SSH credential API handlers.
///
/// GET  /api/ssh/keys        — list private key basenames from ~/.ssh
/// GET  /api/ssh/agent       — check if ssh-agent is running with loaded keys
/// POST /api/ssh/keys/load   — store passphrase+key in AppState for git operations
use axum::{Json, extract::State, response::IntoResponse};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::ssh::{SshCredStore, resolve_key_path, scan_ssh_keys};
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
    let output = std::process::Command::new("ssh-add")
        .arg("-l")
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let count = String::from_utf8_lossy(&out.stdout)
                .lines()
                .filter(|l| !l.is_empty())
                .count();
            AgentStatus { has_keys: true, key_count: count }
        }
        _ => AgentStatus { has_keys: false, key_count: 0 },
    }
}

// ---------------------------------------------------------------------------
// POST /api/ssh/keys/load
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadKeyBody {
    pub passphrase: String,
    pub key_path: Option<String>,
}

#[derive(Serialize)]
pub struct LoadKeyResult {
    pub success: bool,
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
    // Resolve the key path
    let key_path = match &body.key_path {
        Some(basename) if !basename.is_empty() => {
            match resolve_key_path(basename) {
                Some(p) => p,
                None => {
                    return LoadKeyResult {
                        success: false,
                        error: Some(format!("Key file not found: ~/.ssh/{basename}")),
                    };
                }
            }
        }
        _ => {
            // Auto-select first available key
            let keys = scan_ssh_keys();
            match keys.first() {
                Some(name) => match resolve_key_path(name) {
                    Some(p) => p,
                    None => {
                        return LoadKeyResult {
                            success: false,
                            error: Some("No SSH private keys found in ~/.ssh".to_string()),
                        };
                    }
                },
                None => {
                    return LoadKeyResult {
                        success: false,
                        error: Some("No SSH private keys found in ~/.ssh".to_string()),
                    };
                }
            }
        }
    };

    // Validate the key + passphrase by attempting to load it via git2/libssh2
    if let Err(e) = validate_ssh_key(&key_path, &body.passphrase) {
        return LoadKeyResult {
            success: false,
            error: Some(e),
        };
    }

    // Store validated credentials in AppState for subsequent git operations
    let cred = Arc::new(SshCredStore::new(key_path, &body.passphrase));
    *state.ssh_creds.write().await = Some(cred);

    LoadKeyResult { success: true, error: None }
}

/// Validate an SSH private key by attempting to create a git2 credential.
/// git2 delegates to libssh2 which decrypts the key — wrong passphrase returns an error.
/// Empty passphrase is treated as None (unencrypted key).
fn validate_ssh_key(key_path: &std::path::Path, passphrase: &str) -> Result<(), String> {
    let pub_path = key_path.with_extension("pub");
    let pub_opt = if pub_path.exists() { Some(pub_path.as_path()) } else { None };
    let passphrase_opt = if passphrase.is_empty() { None } else { Some(passphrase) };

    // git2::Cred::ssh_key validates the private key file + passphrase via libssh2
    git2::Cred::ssh_key("git", pub_opt, key_path, passphrase_opt)
        .map(|_| ())
        .map_err(|e| {
            let msg = e.message().to_lowercase();
            if msg.contains("wrong passphrase") || msg.contains("bad passphrase") || msg.contains("incorrect passphrase") {
                "Wrong passphrase".to_string()
            } else if msg.contains("unable to open") || msg.contains("no such file") {
                format!("Cannot open key file: {}", key_path.display())
            } else {
                format!("Failed to load key: {}", e.message())
            }
        })
}
