//! Durable forwarding-profile wire contract and input validation.

use std::{fmt, net::Ipv4Addr};

use serde::{de, Deserialize, Deserializer, Serialize, Serializer};
use uuid::Uuid;

use super::model::UtcTimestamp;

const LOOPBACK_HOST: &str = "127.0.0.1";
const MAX_PROFILE_SCALARS: usize = 64;
const MAX_SSH_HOST: usize = 253;
const MAX_KEY_ID: usize = 128;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct LoopbackHost;

impl Serialize for LoopbackHost {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(LOOPBACK_HOST)
    }
}

impl<'de> Deserialize<'de> for LoopbackHost {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value == LOOPBACK_HOST {
            Ok(Self)
        } else {
            Err(de::Error::custom("loopback_host_required"))
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SshForwardProfile {
    pub(crate) id: String,
    pub(crate) scope_id: String,
    pub(crate) name: String,
    pub(crate) ssh_host: String,
    pub(crate) ssh_port: u16,
    pub(crate) ssh_user: String,
    pub(crate) auth: SshForwardAuth,
    pub(crate) local_port: u16,
    pub(crate) target_host: LoopbackHost,
    pub(crate) target_port: u16,
    pub(crate) auto_start: bool,
    pub(crate) reconnect: ReconnectPolicy,
    pub(crate) created_at: UtcTimestamp,
    pub(crate) updated_at: UtcTimestamp,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SshForwardProfileWire {
    id: String,
    scope_id: String,
    name: String,
    ssh_host: String,
    ssh_port: u16,
    ssh_user: String,
    auth: SshForwardAuth,
    local_port: u16,
    target_host: LoopbackHost,
    target_port: u16,
    auto_start: bool,
    reconnect: ReconnectPolicy,
    created_at: UtcTimestamp,
    updated_at: UtcTimestamp,
}

impl<'de> Deserialize<'de> for SshForwardProfile {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = SshForwardProfileWire::deserialize(deserializer)?;
        let profile = Self {
            id: wire.id,
            scope_id: wire.scope_id,
            name: wire.name,
            ssh_host: wire.ssh_host,
            ssh_port: wire.ssh_port,
            ssh_user: wire.ssh_user,
            auth: wire.auth,
            local_port: wire.local_port,
            target_host: wire.target_host,
            target_port: wire.target_port,
            auto_start: wire.auto_start,
            reconnect: wire.reconnect,
            created_at: wire.created_at,
            updated_at: wire.updated_at,
        };
        profile.validate().map_err(de::Error::custom)?;
        Ok(profile)
    }
}

impl SshForwardProfile {
    pub(crate) fn validate(&self) -> Result<(), ProfileValidationError> {
        validate_uuid_v4(&self.id)?;
        validate_uuid_v4(&self.scope_id)?;
        validate_scalar(&self.name, MAX_PROFILE_SCALARS)?;
        validate_canonical_ssh_host(&self.ssh_host)?;
        validate_scalar(&self.ssh_user, MAX_PROFILE_SCALARS)?;
        validate_port(self.ssh_port)?;
        validate_port(self.local_port)?;
        validate_port(self.target_port)?;
        self.auth.validate()?;
        self.reconnect.validate()
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "mode", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum SshForwardAuth {
    Agent,
    Key {
        #[serde(rename = "keyId")]
        key_id: String,
    },
}

impl SshForwardAuth {
    fn validate(&self) -> Result<(), ProfileValidationError> {
        if let Self::Key { key_id } = self {
            validate_safe_ascii(key_id, MAX_KEY_ID)?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReconnectPolicy {
    pub(crate) enabled: bool,
    pub(crate) max_attempts: u8,
}

impl ReconnectPolicy {
    fn validate(&self) -> Result<(), ProfileValidationError> {
        if self.max_attempts <= 5 {
            Ok(())
        } else {
            Err(ProfileValidationError::InvalidReconnectPolicy)
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[allow(clippy::enum_variant_names)]
pub(crate) enum ProfileValidationError {
    InvalidUuid,
    InvalidScalar,
    InvalidSshHost,
    InvalidPort,
    InvalidReconnectPolicy,
}

impl fmt::Display for ProfileValidationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidUuid => "invalid_uuid",
            Self::InvalidScalar => "invalid_scalar",
            Self::InvalidSshHost => "invalid_ssh_host",
            Self::InvalidPort => "invalid_port",
            Self::InvalidReconnectPolicy => "invalid_reconnect_policy",
        })
    }
}

pub(crate) fn validate_uuid_v4(value: &str) -> Result<(), ProfileValidationError> {
    if Uuid::parse_str(value).is_ok_and(|id| {
        id.get_variant() == uuid::Variant::RFC4122
            && id.get_version() == Some(uuid::Version::Random)
            && id.to_string() == value
    }) {
        Ok(())
    } else {
        Err(ProfileValidationError::InvalidUuid)
    }
}

fn validate_scalar(value: &str, limit: usize) -> Result<(), ProfileValidationError> {
    if value.is_empty() || value.chars().count() > limit || value.chars().any(char::is_control) {
        Err(ProfileValidationError::InvalidScalar)
    } else {
        Ok(())
    }
}

fn validate_safe_ascii(value: &str, limit: usize) -> Result<(), ProfileValidationError> {
    if value.is_empty()
        || value.len() > limit
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        Err(ProfileValidationError::InvalidScalar)
    } else {
        Ok(())
    }
}

pub(crate) fn validate_canonical_ssh_host(value: &str) -> Result<(), ProfileValidationError> {
    if value.is_empty() || value.len() > MAX_SSH_HOST {
        return Err(ProfileValidationError::InvalidSshHost);
    }
    if let Ok(ip) = value.parse::<Ipv4Addr>() {
        return (ip.to_string() == value)
            .then_some(())
            .ok_or(ProfileValidationError::InvalidSshHost);
    }
    if value
        .bytes()
        .all(|byte| byte.is_ascii_digit() || byte == b'.')
        || value != value.to_ascii_lowercase()
        || value.ends_with('.')
        || value.split('.').any(|label| {
            label.is_empty()
                || label.len() > 63
                || !label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                || label.starts_with('-')
                || label.ends_with('-')
        })
    {
        Err(ProfileValidationError::InvalidSshHost)
    } else {
        Ok(())
    }
}

fn validate_port(port: u16) -> Result<(), ProfileValidationError> {
    if port == 0 {
        Err(ProfileValidationError::InvalidPort)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{LoopbackHost, ReconnectPolicy, SshForwardAuth, SshForwardProfile};
    use crate::ssh_forward::model::UtcTimestamp;

    fn profile() -> SshForwardProfile {
        SshForwardProfile {
            id: "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96".into(),
            scope_id: "c1f5890a-55d7-46ca-949b-0d63972f0a68".into(),
            name: "metrics".into(),
            ssh_host: "bastion.example".into(),
            ssh_port: 22,
            ssh_user: "operator".into(),
            auth: SshForwardAuth::Agent,
            local_port: 15432,
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
    fn profile_serializes_camel_case_and_fixed_loopback() {
        let encoded = serde_json::to_value(profile()).unwrap();
        assert_eq!(encoded["targetHost"], "127.0.0.1");
        assert_eq!(encoded["createdAt"], "2026-08-10T12:34:56.789Z");
    }

    #[test]
    fn profile_rejects_invalid_values_and_unknown_fields() {
        let valid = profile();
        assert!(valid.validate().is_ok());
        let mut invalid = valid.clone();
        invalid.target_port = 0;
        assert!(invalid.validate().is_err());
        let mut encoded = serde_json::to_value(valid).unwrap();
        encoded["targetHost"] = serde_json::json!("localhost");
        assert!(serde_json::from_value::<SshForwardProfile>(encoded).is_err());
        let mut unknown = serde_json::to_value(profile()).unwrap();
        unknown["password"] = serde_json::json!("never");
        assert!(serde_json::from_value::<SshForwardProfile>(unknown).is_err());
        let mut malformed = serde_json::to_value(profile()).unwrap();
        malformed["id"] = serde_json::json!("00000000-0000-4000-0000-000000000000");
        assert!(serde_json::from_value::<SshForwardProfile>(malformed).is_err());
        let mut noncanonical = serde_json::to_value(profile()).unwrap();
        noncanonical["sshHost"] = serde_json::json!("Bastion.example.");
        assert!(serde_json::from_value::<SshForwardProfile>(noncanonical).is_err());
        let mut ambiguous_ipv4 = serde_json::to_value(profile()).unwrap();
        ambiguous_ipv4["sshHost"] = serde_json::json!("127.0.0.01");
        assert!(serde_json::from_value::<SshForwardProfile>(ambiguous_ipv4).is_err());
        let mut invalid_deserialized = serde_json::to_value(profile()).unwrap();
        invalid_deserialized["targetPort"] = serde_json::json!(0);
        assert!(serde_json::from_value::<SshForwardProfile>(invalid_deserialized).is_err());
    }

    #[test]
    fn key_auth_uses_camel_case_and_rejects_snake_case() {
        let auth = SshForwardAuth::Key {
            key_id: "workstation".into(),
        };
        assert_eq!(
            serde_json::to_value(&auth).unwrap(),
            serde_json::json!({"mode": "key", "keyId": "workstation"})
        );
        assert!(serde_json::from_value::<SshForwardAuth>(serde_json::json!({
            "mode": "key",
            "key_id": "workstation"
        }))
        .is_err());
    }
}
