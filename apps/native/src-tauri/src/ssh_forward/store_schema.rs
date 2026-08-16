//! Versioned, credential-free SSH-forward storage schemas and migration.

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    io,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use toml::Value;
use uuid::Uuid;

use super::{
    model::WireCounter,
    profile::{
        canonical_connection_identity, validate_uuid_v4, LoopbackHost, ReconnectPolicy,
        SshConnectionIdentity, SshConnectionProfile, SshForwardAuth, SshForwardProfile,
        SshForwardRule,
    },
};

pub(crate) const V1_SCHEMA_VERSION: u8 = 1;
pub(crate) const V2_SCHEMA_VERSION: u8 = 2;
pub(crate) const MAX_SAVED_CONNECTIONS: usize = 64;
pub(crate) const MAX_SAVED_RULES: usize = 64;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(crate) struct StoredProfilesV1 {
    pub(crate) schema_version: u8,
    pub(crate) scope_id: String,
    pub(crate) profiles_revision: WireCounter,
    pub(crate) profiles: Vec<StoredProfileV1>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(crate) struct StoredProfileV1 {
    pub(crate) id: String,
    pub(crate) scope_id: String,
    pub(crate) name: String,
    pub(crate) ssh_host: String,
    pub(crate) ssh_port: u16,
    pub(crate) ssh_user: String,
    pub(crate) auth: StoredAuth,
    pub(crate) local_port: u16,
    pub(crate) target_host: LoopbackHost,
    pub(crate) target_port: u16,
    pub(crate) auto_start: bool,
    pub(crate) reconnect: ReconnectPolicy,
    pub(crate) created_at: super::model::UtcTimestamp,
    pub(crate) updated_at: super::model::UtcTimestamp,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum StoredAuth {
    Agent,
    Key { key_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(crate) struct StoredScopeConfigV2 {
    pub(crate) schema_version: u8,
    pub(crate) scope_id: String,
    pub(crate) connections_revision: WireCounter,
    pub(crate) rules_revision: WireCounter,
    pub(crate) connections: Vec<StoredConnectionProfile>,
    pub(crate) rules: Vec<StoredForwardRule>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(crate) struct StoredConnectionProfile {
    pub(crate) id: String,
    pub(crate) scope_id: String,
    pub(crate) name: String,
    pub(crate) ssh_host: String,
    pub(crate) ssh_port: u16,
    pub(crate) ssh_user: String,
    pub(crate) auth: StoredAuth,
    pub(crate) created_at: super::model::UtcTimestamp,
    pub(crate) updated_at: super::model::UtcTimestamp,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(crate) struct StoredForwardRule {
    pub(crate) id: String,
    pub(crate) scope_id: String,
    pub(crate) connection_profile_id: String,
    pub(crate) name: String,
    pub(crate) local_port: u16,
    pub(crate) target_host: LoopbackHost,
    pub(crate) target_port: u16,
    pub(crate) desired_enabled: bool,
    pub(crate) reconnect: ReconnectPolicy,
    pub(crate) created_at: super::model::UtcTimestamp,
    pub(crate) updated_at: super::model::UtcTimestamp,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub(crate) struct V1RollbackMetadata {
    pub(crate) schema_version: u8,
    pub(crate) scope_id: String,
    pub(crate) sha256: String,
    pub(crate) byte_length: u64,
}

impl StoredProfilesV1 {
    pub(crate) fn empty(scope_id: &str) -> Self {
        Self {
            schema_version: V1_SCHEMA_VERSION,
            scope_id: scope_id.into(),
            profiles_revision: WireCounter::ZERO,
            profiles: vec![],
        }
    }

    pub(crate) fn revision(&self) -> WireCounter {
        self.profiles_revision
    }

    pub(crate) fn profiles(&self) -> io::Result<Vec<SshForwardProfile>> {
        self.profiles
            .iter()
            .map(StoredProfileV1::to_profile)
            .collect()
    }

    pub(crate) fn from_profiles(
        scope_id: &str,
        profiles: Vec<SshForwardProfile>,
    ) -> io::Result<Self> {
        let stored = Self {
            schema_version: V1_SCHEMA_VERSION,
            scope_id: scope_id.into(),
            profiles: profiles
                .into_iter()
                .map(StoredProfileV1::from_profile)
                .collect(),
            profiles_revision: WireCounter::ZERO,
        };
        stored.validate(scope_id)?;
        Ok(stored)
    }

    pub(crate) fn validate(&self, scope_id: &str) -> io::Result<()> {
        validate_header(
            self.schema_version,
            V1_SCHEMA_VERSION,
            &self.scope_id,
            scope_id,
        )?;
        if self.profiles.len() > MAX_SAVED_RULES {
            return Err(invalid_data("profile_limit"));
        }
        let mut ids = HashSet::new();
        let mut local_ports = HashSet::new();
        for profile in &self.profiles {
            profile.validate(scope_id)?;
            if !ids.insert(profile.id.as_str()) {
                return Err(invalid_data("duplicate_profile_id"));
            }
            if !local_ports.insert(profile.local_port) {
                return Err(invalid_data("duplicate_local_port"));
            }
        }
        Ok(())
    }
}

impl StoredProfileV1 {
    fn from_profile(profile: SshForwardProfile) -> Self {
        Self {
            id: profile.id,
            scope_id: profile.scope_id,
            name: profile.name,
            ssh_host: profile.ssh_host,
            ssh_port: profile.ssh_port,
            ssh_user: profile.ssh_user,
            auth: StoredAuth::from_auth(profile.auth),
            local_port: profile.local_port,
            target_host: profile.target_host,
            target_port: profile.target_port,
            auto_start: profile.auto_start,
            reconnect: profile.reconnect,
            created_at: profile.created_at,
            updated_at: profile.updated_at,
        }
    }

    fn to_profile(&self) -> io::Result<SshForwardProfile> {
        Ok(SshForwardProfile {
            id: self.id.clone(),
            scope_id: self.scope_id.clone(),
            name: self.name.clone(),
            ssh_host: self.ssh_host.clone(),
            ssh_port: self.ssh_port,
            ssh_user: self.ssh_user.clone(),
            auth: self.auth.to_auth(),
            local_port: self.local_port,
            target_host: self.target_host,
            target_port: self.target_port,
            auto_start: self.auto_start,
            reconnect: self.reconnect,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }

    fn validate(&self, scope_id: &str) -> io::Result<()> {
        let profile = self.to_profile()?;
        profile
            .validate()
            .map_err(|_| invalid_data("invalid_profile"))?;
        if self.scope_id == scope_id {
            Ok(())
        } else {
            Err(invalid_data("embedded_scope_mismatch"))
        }
    }
}

impl StoredAuth {
    fn from_auth(auth: SshForwardAuth) -> Self {
        match auth {
            SshForwardAuth::Agent => Self::Agent,
            SshForwardAuth::Key { key_id } => Self::Key { key_id },
        }
    }

    fn to_auth(&self) -> SshForwardAuth {
        match self {
            Self::Agent => SshForwardAuth::Agent,
            Self::Key { key_id } => SshForwardAuth::Key {
                key_id: key_id.clone(),
            },
        }
    }
}

impl StoredScopeConfigV2 {
    pub(crate) fn empty(scope_id: &str) -> Self {
        Self {
            schema_version: V2_SCHEMA_VERSION,
            scope_id: scope_id.into(),
            connections_revision: WireCounter::ZERO,
            rules_revision: WireCounter::ZERO,
            connections: vec![],
            rules: vec![],
        }
    }

    pub(crate) fn validate(&self, scope_id: &str) -> io::Result<()> {
        validate_header(
            self.schema_version,
            V2_SCHEMA_VERSION,
            &self.scope_id,
            scope_id,
        )?;
        if self.connections.len() > MAX_SAVED_CONNECTIONS {
            return Err(invalid_data("connection_limit"));
        }
        if self.rules.len() > MAX_SAVED_RULES {
            return Err(invalid_data("rule_limit"));
        }

        let mut connection_ids = HashSet::new();
        let mut identities = HashSet::new();
        for connection in &self.connections {
            let model = connection.to_model()?;
            model
                .validate()
                .map_err(|_| invalid_data("invalid_connection_profile"))?;
            if connection.scope_id != scope_id || !connection_ids.insert(connection.id.as_str()) {
                return Err(invalid_data("duplicate_connection_id"));
            }
            if !identities.insert(
                canonical_connection_identity(&model)
                    .map_err(|_| invalid_data("invalid_connection_identity"))?,
            ) {
                return Err(invalid_data("duplicate_connection_identity"));
            }
        }

        let mut rule_ids = HashSet::new();
        let mut local_ports = HashSet::new();
        for rule in &self.rules {
            let model = rule.to_model()?;
            model
                .validate()
                .map_err(|_| invalid_data("invalid_forward_rule"))?;
            if rule.scope_id != scope_id
                || !rule_ids.insert(rule.id.as_str())
                || !local_ports.insert(rule.local_port)
            {
                return Err(invalid_data("duplicate_rule_or_bind"));
            }
            if !connection_ids.contains(rule.connection_profile_id.as_str()) {
                return Err(invalid_data("dangling_connection_reference"));
            }
        }
        Ok(())
    }

    pub(crate) fn connections(&self) -> io::Result<Vec<SshConnectionProfile>> {
        self.connections
            .iter()
            .map(StoredConnectionProfile::to_model)
            .collect()
    }

    pub(crate) fn rules(&self) -> io::Result<Vec<SshForwardRule>> {
        self.rules.iter().map(StoredForwardRule::to_model).collect()
    }

    pub(crate) fn from_models(
        scope_id: &str,
        connections: Vec<SshConnectionProfile>,
        rules: Vec<SshForwardRule>,
    ) -> io::Result<Self> {
        let config = Self {
            schema_version: V2_SCHEMA_VERSION,
            scope_id: scope_id.into(),
            connections_revision: WireCounter::ZERO,
            rules_revision: WireCounter::ZERO,
            connections: connections
                .into_iter()
                .map(StoredConnectionProfile::from_model)
                .collect(),
            rules: rules
                .into_iter()
                .map(StoredForwardRule::from_model)
                .collect(),
        };
        config.validate(scope_id)?;
        Ok(config)
    }

    /// Rebase a legacy combined-profile write onto the latest v2 connection
    /// collection. Existing rule IDs retain their current connection and
    /// desired intent; only genuinely new rules may add connections.
    pub(crate) fn rebase_legacy_write(&mut self, current: &Self) -> io::Result<bool> {
        let current_rules = current
            .rules
            .iter()
            .map(|rule| (rule.id.as_str(), rule))
            .collect::<HashMap<_, _>>();
        let mut identities = current
            .connections
            .iter()
            .map(|connection| {
                connection
                    .identity()
                    .map(|identity| (identity, connection.id.clone()))
            })
            .collect::<io::Result<HashMap<_, _>>>()?;
        let mut connections = current.connections.clone();

        for rule in &mut self.rules {
            if let Some(current_rule) = current_rules.get(rule.id.as_str()) {
                rule.connection_profile_id = current_rule.connection_profile_id.clone();
                rule.desired_enabled = current_rule.desired_enabled;
                continue;
            }

            let migrated_connection = self
                .connections
                .iter()
                .find(|connection| connection.id == rule.connection_profile_id)
                .ok_or_else(|| invalid_data("dangling_connection_reference"))?;
            let identity = migrated_connection.identity()?;
            if let Some(existing_id) = identities.get(&identity) {
                rule.connection_profile_id = existing_id.clone();
            } else {
                if connections
                    .iter()
                    .any(|connection| connection.id == migrated_connection.id)
                {
                    return Err(invalid_data("connection_id_collision"));
                }
                identities.insert(identity, migrated_connection.id.clone());
                connections.push(migrated_connection.clone());
            }
        }

        let changed = connections != current.connections;
        self.connections = connections;
        Ok(changed)
    }

    pub(crate) fn to_legacy_profiles(&self) -> io::Result<StoredProfilesV1> {
        let connections = self
            .connections
            .iter()
            .map(|connection| (connection.id.as_str(), connection))
            .collect::<HashMap<_, _>>();
        let profiles = self
            .rules
            .iter()
            .map(|rule| {
                let connection = connections
                    .get(rule.connection_profile_id.as_str())
                    .ok_or_else(|| invalid_data("dangling_connection_reference"))?;
                Ok(SshForwardProfile {
                    id: rule.id.clone(),
                    scope_id: rule.scope_id.clone(),
                    name: rule.name.clone(),
                    ssh_host: connection.ssh_host.clone(),
                    ssh_port: connection.ssh_port,
                    ssh_user: connection.ssh_user.clone(),
                    auth: connection.auth.to_auth(),
                    local_port: rule.local_port,
                    target_host: rule.target_host,
                    target_port: rule.target_port,
                    // The legacy manager uses auto_start to authenticate during
                    // scope activation. Phase 1 persists desired_enabled, but
                    // establishment remains an explicit phase-2 operation.
                    auto_start: false,
                    reconnect: rule.reconnect,
                    created_at: rule.created_at,
                    updated_at: rule.updated_at,
                })
            })
            .collect::<io::Result<Vec<_>>>()?;
        StoredProfilesV1::from_profiles(&self.scope_id, profiles).map(|mut legacy| {
            legacy.profiles_revision = self.rules_revision;
            legacy
        })
    }
}

impl StoredConnectionProfile {
    fn identity(&self) -> io::Result<SshConnectionIdentity> {
        canonical_connection_identity(&self.to_model()?)
            .map_err(|_| invalid_data("invalid_connection_identity"))
    }

    fn from_model(profile: SshConnectionProfile) -> Self {
        Self {
            id: profile.id,
            scope_id: profile.scope_id,
            name: profile.name,
            ssh_host: profile.ssh_host,
            ssh_port: profile.ssh_port,
            ssh_user: profile.ssh_user,
            auth: StoredAuth::from_auth(profile.auth),
            created_at: profile.created_at,
            updated_at: profile.updated_at,
        }
    }

    fn to_model(&self) -> io::Result<SshConnectionProfile> {
        Ok(SshConnectionProfile {
            id: self.id.clone(),
            scope_id: self.scope_id.clone(),
            name: self.name.clone(),
            ssh_host: self.ssh_host.clone(),
            ssh_port: self.ssh_port,
            ssh_user: self.ssh_user.clone(),
            auth: self.auth.to_auth(),
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

impl StoredForwardRule {
    fn from_model(rule: SshForwardRule) -> Self {
        Self {
            id: rule.id,
            scope_id: rule.scope_id,
            connection_profile_id: rule.connection_profile_id,
            name: rule.name,
            local_port: rule.local_port,
            target_host: rule.target_host,
            target_port: rule.target_port,
            desired_enabled: rule.desired_enabled,
            reconnect: rule.reconnect,
            created_at: rule.created_at,
            updated_at: rule.updated_at,
        }
    }

    fn to_model(&self) -> io::Result<SshForwardRule> {
        Ok(SshForwardRule {
            id: self.id.clone(),
            scope_id: self.scope_id.clone(),
            connection_profile_id: self.connection_profile_id.clone(),
            name: self.name.clone(),
            local_port: self.local_port,
            target_host: self.target_host,
            target_port: self.target_port,
            desired_enabled: self.desired_enabled,
            reconnect: self.reconnect,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

/// Convert the old combined profiles in a deterministic order. The first
/// profile for an identity owns the connection name and timestamps; every old
/// profile remains a rule with its original stable ID.
pub(crate) fn migrate_v1(source: StoredProfilesV1) -> io::Result<StoredScopeConfigV2> {
    let scope_id = source.scope_id.clone();
    source.validate(&scope_id)?;
    let mut profiles = source.profiles.clone();
    profiles.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then_with(|| left.id.cmp(&right.id))
    });

    let mut connection_ids: BTreeMap<SshConnectionIdentity, String> = BTreeMap::new();
    let mut connections = Vec::new();
    let mut rules = Vec::with_capacity(profiles.len());
    for stored in profiles {
        let profile = stored.to_profile()?;
        let connection = SshConnectionProfile {
            id: Uuid::new_v4().to_string(),
            scope_id: profile.scope_id.clone(),
            name: profile.name.clone(),
            ssh_host: profile.ssh_host.clone(),
            ssh_port: profile.ssh_port,
            ssh_user: profile.ssh_user.clone(),
            auth: profile.auth.clone(),
            created_at: profile.created_at,
            updated_at: profile.updated_at,
        };
        let identity = canonical_connection_identity(&connection)
            .map_err(|_| invalid_data("invalid_connection_identity"))?;
        let connection_id = if let Some(existing) = connection_ids.get(&identity) {
            existing.clone()
        } else {
            let id = connection.id.clone();
            connection_ids.insert(identity, id.clone());
            connections.push(StoredConnectionProfile::from_model(connection));
            id
        };
        rules.push(StoredForwardRule::from_model(SshForwardRule {
            id: profile.id,
            scope_id: profile.scope_id,
            connection_profile_id: connection_id,
            name: profile.name,
            local_port: profile.local_port,
            target_host: profile.target_host,
            target_port: profile.target_port,
            desired_enabled: profile.auto_start,
            reconnect: profile.reconnect,
            created_at: profile.created_at,
            updated_at: profile.updated_at,
        }));
    }

    let config = StoredScopeConfigV2 {
        schema_version: V2_SCHEMA_VERSION,
        scope_id,
        connections_revision: WireCounter::ZERO,
        rules_revision: source.profiles_revision,
        connections,
        rules,
    };
    config.validate(&config.scope_id)?;
    Ok(config)
}

pub(crate) fn schema_version(bytes: &[u8]) -> io::Result<u8> {
    let text = std::str::from_utf8(bytes).map_err(|_| invalid_data("store_not_utf8"))?;
    let value: Value = toml::from_str(text).map_err(|_| invalid_data("invalid_store_toml"))?;
    value
        .get("schema_version")
        .and_then(Value::as_integer)
        .and_then(|version| u8::try_from(version).ok())
        .ok_or_else(|| invalid_data("invalid_store_header"))
}

pub(crate) fn rollback_metadata(scope_id: &str, bytes: &[u8]) -> io::Result<V1RollbackMetadata> {
    let metadata = V1RollbackMetadata {
        schema_version: V1_SCHEMA_VERSION,
        scope_id: scope_id.into(),
        sha256: sha256(bytes),
        byte_length: bytes.len() as u64,
    };
    metadata.validate(scope_id)?;
    Ok(metadata)
}

impl V1RollbackMetadata {
    pub(crate) fn validate(&self, scope_id: &str) -> io::Result<()> {
        validate_header(
            self.schema_version,
            V1_SCHEMA_VERSION,
            &self.scope_id,
            scope_id,
        )?;
        if self.byte_length > 1024 * 1024
            || self.sha256.len() != 64
            || !self.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(invalid_data("invalid_rollback_metadata"));
        }
        Ok(())
    }
}

pub(crate) fn sha256(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(bytes);
    format!("{:x}", digest.finalize())
}

fn validate_header(
    version: u8,
    expected_version: u8,
    embedded: &str,
    expected: &str,
) -> io::Result<()> {
    if version == expected_version && embedded == expected {
        validate_uuid_v4(embedded).map_err(|_| invalid_data("invalid_scope_id"))
    } else {
        Err(invalid_data("invalid_store_header"))
    }
}

fn invalid_data(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

#[cfg(test)]
mod tests {
    use super::{migrate_v1, StoredProfilesV1};
    use crate::ssh_forward::model::UtcTimestamp;
    use crate::ssh_forward::profile::{
        LoopbackHost, ReconnectPolicy, SshForwardAuth, SshForwardProfile,
    };

    const SCOPE: &str = "c1f5890a-55d7-46ca-949b-0d63972f0a68";

    fn profile(id: &str, local_port: u16, name: &str) -> SshForwardProfile {
        SshForwardProfile {
            id: id.into(),
            scope_id: SCOPE.into(),
            name: name.into(),
            ssh_host: "bastion.example".into(),
            ssh_port: 22,
            ssh_user: "operator".into(),
            auth: SshForwardAuth::Agent,
            local_port,
            target_host: LoopbackHost,
            target_port: 5432,
            auto_start: true,
            reconnect: ReconnectPolicy {
                enabled: true,
                max_attempts: 5,
            },
            created_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
            updated_at: UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap(),
        }
    }

    #[test]
    fn migration_deduplicates_exact_connection_identity_and_preserves_rules() {
        let source = StoredProfilesV1::from_profiles(
            SCOPE,
            vec![
                profile("e1634e77-b0b5-4b21-bd2f-462c9e3b7a96", 15432, "metrics"),
                profile(
                    "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0",
                    15433,
                    "metrics-readonly",
                ),
            ],
        )
        .unwrap();
        let migrated = migrate_v1(source).unwrap();
        assert_eq!(migrated.connections.len(), 1);
        assert_eq!(migrated.rules.len(), 2);
        assert_eq!(migrated.rules[0].id, "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96");
        assert_eq!(migrated.rules[1].id, "f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0");
        assert_eq!(
            migrated.rules[0].connection_profile_id,
            migrated.rules[1].connection_profile_id
        );
        assert!(migrated.rules[0].desired_enabled);
    }

    #[test]
    fn legacy_compatibility_view_does_not_auto_start_v2_rules() {
        let source = StoredProfilesV1::from_profiles(
            SCOPE,
            vec![profile(
                "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96",
                15432,
                "metrics",
            )],
        )
        .unwrap();
        let migrated = migrate_v1(source).unwrap();
        assert!(migrated.rules[0].desired_enabled);

        let legacy = migrated.to_legacy_profiles().unwrap();
        assert_eq!(legacy.profiles.len(), 1);
        assert!(!legacy.profiles[0].auto_start);
    }

    #[test]
    fn migration_rejects_duplicate_binds_before_allocation() {
        let source = StoredProfilesV1::from_profiles(
            SCOPE,
            vec![
                profile("e1634e77-b0b5-4b21-bd2f-462c9e3b7a96", 15432, "one"),
                profile("f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0", 15432, "two"),
            ],
        );
        assert!(source.is_err());
    }

    #[test]
    fn migration_keeps_endpoint_user_auth_and_port_identities_separate() {
        let mut different_user = profile("e1634e77-b0b5-4b21-bd2f-462c9e3b7a96", 15432, "user");
        different_user.ssh_user = "other".into();
        let mut different_port = profile("f2e3d6a0-0ac7-4b6b-b6b4-b4f9e7d2c1a0", 15433, "port");
        different_port.ssh_port = 2222;
        let mut different_key = profile("a3b4c5d6-e7f8-49a0-b1c2-d3e4f5a6b7c8", 15434, "key");
        different_key.auth = SshForwardAuth::Key {
            key_id: "workstation".into(),
        };
        let source = StoredProfilesV1::from_profiles(
            SCOPE,
            vec![
                profile("b4c5d6e7-f8a9-4b0c-8123-e4f5a6b7c8d9", 15435, "base"),
                different_user,
                different_port,
                different_key,
            ],
        )
        .unwrap();
        let migrated = migrate_v1(source).unwrap();
        assert_eq!(migrated.connections.len(), 4);
    }
}
