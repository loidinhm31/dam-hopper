//! Stopped-app trust-repair command parser and contained-store entry point.

use std::{
    fmt,
    path::{Path, PathBuf},
};

use super::{
    profile::{canonicalize_ssh_host, validate_uuid_v4},
    store::{scope_storage_key, SshForwardStore, StoredTrust},
};

pub(crate) const REMEDIATION_COPY: &str = "Connection blocked because the saved SSH host identity no longer matches. Do not approve it yet. Stop all forwards, quit DamHopper, verify the expected fingerprint with the server administrator, then run the displayed trust-repair command. Reopen DamHopper, start the forward, compare the fingerprint exactly, approve it, then start again.";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum TrustRepairCommand {
    RemoveEndpoint {
        scope_id: String,
        host: String,
        port: u16,
    },
    Restore {
        scope_id: String,
        backup_id: String,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TrustRepairError {
    InvalidArguments,
    InvalidScope,
    InvalidEndpoint,
    InvalidBackupId,
    Store,
}

impl fmt::Display for TrustRepairError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidArguments => "invalid_trust_repair_arguments",
            Self::InvalidScope => "invalid_scope_id",
            Self::InvalidEndpoint => "invalid_repair_endpoint",
            Self::InvalidBackupId => "invalid_backup_id",
            Self::Store => "trust_repair_store_failed",
        })
    }
}

impl TrustRepairCommand {
    pub(crate) fn parse(arguments: &[String]) -> Result<Option<Self>, TrustRepairError> {
        if arguments.first().map(String::as_str) != Some("--ssh-forward-trust-repair") {
            return Ok(None);
        }
        match arguments.get(1).map(String::as_str) {
            Some("remove-endpoint") if arguments.len() == 8 => {
                if arguments[2] != "--scope" || arguments[4] != "--host" || arguments[6] != "--port"
                {
                    return Err(TrustRepairError::InvalidArguments);
                }
                validate_uuid_v4(&arguments[3]).map_err(|_| TrustRepairError::InvalidScope)?;
                let host = canonicalize_ssh_host(&arguments[5])
                    .map_err(|_| TrustRepairError::InvalidEndpoint)?;
                let port = arguments[7]
                    .parse::<u16>()
                    .ok()
                    .filter(|port| *port != 0)
                    .ok_or(TrustRepairError::InvalidEndpoint)?;
                Ok(Some(Self::RemoveEndpoint {
                    scope_id: arguments[3].clone(),
                    host,
                    port,
                }))
            }
            Some("restore") if arguments.len() == 6 => {
                if arguments[2] != "--scope" || arguments[4] != "--backup-id" {
                    return Err(TrustRepairError::InvalidArguments);
                }
                validate_uuid_v4(&arguments[3]).map_err(|_| TrustRepairError::InvalidScope)?;
                if !is_safe_backup_id(&arguments[5]) {
                    return Err(TrustRepairError::InvalidBackupId);
                }
                Ok(Some(Self::Restore {
                    scope_id: arguments[3].clone(),
                    backup_id: arguments[5].clone(),
                }))
            }
            _ => Err(TrustRepairError::InvalidArguments),
        }
    }
}

pub(crate) fn resolved_trust_path(
    app_config_dir: &Path,
    scope_id: &str,
) -> Result<PathBuf, TrustRepairError> {
    validate_uuid_v4(scope_id).map_err(|_| TrustRepairError::InvalidScope)?;
    let key = scope_storage_key(scope_id).map_err(|_| TrustRepairError::InvalidScope)?;
    Ok(app_config_dir
        .join("ssh-forward")
        .join("scopes")
        .join(key)
        .join("known-hosts.toml"))
}

pub(crate) fn resolved_trust_path_from_app(
    app: &tauri::AppHandle,
    scope_id: &str,
) -> Result<PathBuf, TrustRepairError> {
    use tauri::Manager;

    let app_config_dir = app
        .path()
        .app_config_dir()
        .map_err(|_| TrustRepairError::Store)?;
    resolved_trust_path(&app_config_dir, scope_id)
}

pub(crate) fn execute(
    app_config_dir: &Path,
    command: TrustRepairCommand,
) -> Result<StoredTrust, TrustRepairError> {
    let _runtime = SshForwardStore::acquire_feature_runtime_lease_at(app_config_dir)
        .map_err(|_| TrustRepairError::Store)?;
    let store = SshForwardStore::open(app_config_dir).map_err(|_| TrustRepairError::Store)?;
    match command {
        TrustRepairCommand::RemoveEndpoint {
            scope_id,
            host,
            port,
        } => store
            .scope(&scope_id)
            .map_err(|_| TrustRepairError::Store)?
            .repair_remove_endpoint(&host, port, super::model::UtcTimestamp::now())
            .map_err(|_| TrustRepairError::Store),
        TrustRepairCommand::Restore {
            scope_id,
            backup_id,
        } => {
            let scope = store
                .scope(&scope_id)
                .map_err(|_| TrustRepairError::Store)?;
            let expected_revision = scope
                .load_trust()
                .map_err(|_| TrustRepairError::Store)?
                .trust_revision;
            scope
                .repair_restore_backup(&backup_id, expected_revision)
                .map_err(|_| TrustRepairError::Store)
        }
    }
}

fn is_safe_backup_id(value: &str) -> bool {
    let Some((timestamp, digest)) = value.rsplit_once('-') else {
        return false;
    };
    timestamp.len() == 17
        && timestamp.bytes().all(|byte| byte.is_ascii_digit())
        && digest.len() == 64
        && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{resolved_trust_path, TrustRepairCommand, REMEDIATION_COPY};

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).into()).collect()
    }

    const SCOPE: &str = "c1f5890a-55d7-46ca-949b-0d63972f0a68";

    #[test]
    fn parser_canonicalizes_endpoint_and_rejects_paths() {
        let command = TrustRepairCommand::parse(&args(&[
            "--ssh-forward-trust-repair",
            "remove-endpoint",
            "--scope",
            SCOPE,
            "--host",
            "Example.COM...",
            "--port",
            "22",
        ]))
        .unwrap()
        .unwrap();
        assert_eq!(
            command,
            TrustRepairCommand::RemoveEndpoint {
                scope_id: SCOPE.into(),
                host: "example.com".into(),
                port: 22,
            }
        );
        assert!(TrustRepairCommand::parse(&args(&[
            "--ssh-forward-trust-repair",
            "remove-endpoint",
            "--scope",
            SCOPE,
            "--host",
            "C:\\secret\\known-hosts.toml",
            "--port",
            "22",
        ]))
        .is_err());
    }

    #[test]
    fn command_prompt_arguments_round_trip_through_native_parser() {
        let command = TrustRepairCommand::parse(&args(&[
            "--ssh-forward-trust-repair",
            "restore",
            "--scope",
            SCOPE,
            "--backup-id",
            "20260810000000000-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        ]))
        .unwrap()
        .unwrap();
        assert_eq!(
            command,
            TrustRepairCommand::Restore {
                scope_id: SCOPE.into(),
                backup_id: "20260810000000000-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".into(),
            }
        );
    }

    #[test]
    fn resolved_path_is_tauri_root_relative_and_copy_is_exact() {
        let path = resolved_trust_path(Path::new("C:\\Users\\test\\AppData"), SCOPE).unwrap();
        assert!(path.ends_with("known-hosts.toml"));
        assert!(path.to_string_lossy().contains("ssh-forward"));
        assert!(REMEDIATION_COPY.starts_with("Connection blocked because"));
    }
}
