//! Wire scalar contracts shared by native commands and the desktop adapter.

use std::fmt;

use serde::{de, Deserialize, Deserializer, Serialize, Serializer};
use time::{format_description, OffsetDateTime, PrimitiveDateTime, UtcOffset};

#[cfg(windows)]
use zeroize::Zeroizing;

use super::{
    error::SshForwardErrorCode,
    instance::DesktopClientContext,
    profile::{
        validate_uuid_v4, LoopbackHost, SshConnectionProfile, SshForwardProfile, SshForwardRule,
    },
    scope_retention::KnownScopesInput,
};

const MAX_WIRE_COUNTER_DIGITS: usize = 20;
const UTC_MILLIS_FORMAT: &str =
    "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z";
#[cfg(windows)]
const MAX_PASSPHRASE_BYTES: usize = 4096;
#[cfg(windows)]
const MAX_PASSWORD_BYTES: usize = 4096;
#[cfg(windows)]
const MAX_USERNAME_SCALARS: usize = 64;
const MAX_CREDENTIAL_ATTEMPT_ID_BYTES: usize = 128;

#[cfg(windows)]
fn default_remember_for_days() -> u16 {
    0
}

#[cfg(windows)]
fn deserialize_remember_for_days<'de, D>(deserializer: D) -> Result<u16, D::Error>
where
    D: Deserializer<'de>,
{
    let value = u16::deserialize(deserializer)?;
    if value == 0 || value == 30 {
        Ok(value)
    } else {
        Err(de::Error::custom("remember_for_days_invalid"))
    }
}

fn valid_credential_attempt_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_CREDENTIAL_ATTEMPT_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn deserialize_uuid_v4<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    validate_uuid_v4(&value).map_err(|_| de::Error::custom("uuid_invalid"))?;
    Ok(value)
}

fn deserialize_optional_uuid_v4<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<String>::deserialize(deserializer)?;
    if value
        .as_deref()
        .is_some_and(|value| validate_uuid_v4(value).is_err())
    {
        return Err(de::Error::custom("uuid_invalid"));
    }
    Ok(value)
}

fn deserialize_credential_attempt_id<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    if !valid_credential_attempt_id(&value) {
        return Err(de::Error::custom("credential_attempt_id_invalid"));
    }
    Ok(value)
}

fn deserialize_optional_credential_attempt_id<'de, D>(
    deserializer: D,
) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<String>::deserialize(deserializer)?;
    if value
        .as_deref()
        .is_some_and(|attempt_id| !valid_credential_attempt_id(attempt_id))
    {
        return Err(de::Error::custom("credential_attempt_id_invalid"));
    }
    Ok(value)
}

#[cfg(windows)]
fn deserialize_bounded_passphrase<'de, D>(deserializer: D) -> Result<Zeroizing<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    if value.len() > MAX_PASSPHRASE_BYTES {
        return Err(de::Error::custom("passphrase_too_long"));
    }
    Ok(Zeroizing::new(value))
}

#[cfg(windows)]
fn deserialize_bounded_password<'de, D>(deserializer: D) -> Result<Zeroizing<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    if value.is_empty() || value.len() > MAX_PASSWORD_BYTES {
        return Err(de::Error::custom("password_invalid"));
    }
    Ok(Zeroizing::new(value))
}

#[cfg(windows)]
fn deserialize_bounded_username<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = String::deserialize(deserializer)?;
    if value.trim().is_empty()
        || value.chars().count() > MAX_USERNAME_SCALARS
        || value.chars().any(char::is_control)
    {
        return Err(de::Error::custom("username_invalid"));
    }
    Ok(value)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub(crate) struct WireCounter(u64);

impl WireCounter {
    pub(crate) const ZERO: Self = Self(0);

    pub(crate) fn parse(value: &str) -> Result<Self, WireScalarError> {
        if value.is_empty()
            || value.len() > MAX_WIRE_COUNTER_DIGITS
            || (!value.as_bytes().iter().all(u8::is_ascii_digit))
            || (value.len() > 1 && value.starts_with('0'))
        {
            return Err(WireScalarError::InvalidCounter);
        }
        value
            .parse()
            .map(Self)
            .map_err(|_| WireScalarError::InvalidCounter)
    }

    pub(crate) fn increment(self) -> Result<Self, WireScalarError> {
        self.0
            .checked_add(1)
            .map(Self)
            .ok_or(WireScalarError::CounterExhausted)
    }

    pub(crate) fn value(self) -> u64 {
        self.0
    }
}

/// Shared revision base for the v2 connection and forwarding-rule
/// collections. Commands are added in a later phase; keeping this DTO here
/// prevents each IPC surface from inventing a different revision shape.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SshForwardCollectionRevisions {
    pub(crate) connections_revision: WireCounter,
    pub(crate) rules_revision: WireCounter,
}

impl fmt::Display for WireCounter {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl Serialize for WireCounter {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for WireCounter {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).map_err(de::Error::custom)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub(crate) struct UtcTimestamp(OffsetDateTime);

impl UtcTimestamp {
    pub(crate) fn now() -> Self {
        Self(OffsetDateTime::now_utc())
    }

    pub(crate) fn parse(value: &str) -> Result<Self, WireScalarError> {
        if !is_utc_millis_shape(value) {
            return Err(WireScalarError::InvalidTimestamp);
        }
        let format = format_description::parse(UTC_MILLIS_FORMAT)
            .map_err(|_| WireScalarError::InvalidTimestamp)?;
        PrimitiveDateTime::parse(value, &format)
            .map(|timestamp| Self(timestamp.assume_utc()))
            .map_err(|_| WireScalarError::InvalidTimestamp)
    }

    pub(crate) fn format(self) -> Result<String, WireScalarError> {
        let format = format_description::parse(UTC_MILLIS_FORMAT)
            .map_err(|_| WireScalarError::InvalidTimestamp)?;
        self.0
            .to_offset(UtcOffset::UTC)
            .format(&format)
            .map_err(|_| WireScalarError::InvalidTimestamp)
    }

    pub(crate) fn checked_add_days(self, days: i64) -> Result<Self, WireScalarError> {
        self.0
            .checked_add(time::Duration::days(days))
            .map(Self)
            .ok_or(WireScalarError::InvalidTimestamp)
    }

    pub(crate) fn checked_add_seconds(self, seconds: i64) -> Result<Self, WireScalarError> {
        self.0
            .checked_add(time::Duration::seconds(seconds))
            .map(Self)
            .ok_or(WireScalarError::InvalidTimestamp)
    }
}

fn is_utc_millis_shape(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 24
        && value.is_ascii()
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            10 => *byte == b'T',
            13 | 16 => *byte == b':',
            19 => *byte == b'.',
            23 => *byte == b'Z',
            _ => byte.is_ascii_digit(),
        })
}

impl Serialize for UtcTimestamp {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.format().map_err(serde::ser::Error::custom)?)
    }
}

impl<'de> Deserialize<'de> for UtcTimestamp {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).map_err(de::Error::custom)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WireScalarError {
    InvalidCounter,
    CounterExhausted,
    InvalidTimestamp,
}

impl fmt::Display for WireScalarError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidCounter => "invalid_counter",
            Self::CounterExhausted => "counter_exhausted",
            Self::InvalidTimestamp => "invalid_timestamp",
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OpenClientResult {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token_floor: WireCounter,
    pub(crate) active_scope_id: Option<String>,
    pub(crate) scope_generation: WireCounter,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OpenClientInput {
    pub(crate) known_scopes: KnownScopesInput,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ScopeContextInput {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) scope_id: String,
    pub(crate) scope_generation: WireCounter,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConnectionMutationInput {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) scope_id: String,
    pub(crate) scope_generation: WireCounter,
    pub(crate) expected_connections_revision: WireCounter,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateConnectionInput {
    #[serde(flatten)]
    pub(crate) request: ConnectionMutationInput,
    pub(crate) connection: SshConnectionProfile,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateConnectionInput {
    #[serde(flatten)]
    pub(crate) request: ConnectionMutationInput,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) connection_profile_id: String,
    pub(crate) expected_generation: WireCounter,
    pub(crate) connection: SshConnectionProfile,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeleteConnectionInput {
    #[serde(flatten)]
    pub(crate) request: ConnectionMutationInput,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) connection_profile_id: String,
    pub(crate) expected_generation: WireCounter,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RuleMutationInput {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) scope_id: String,
    pub(crate) scope_generation: WireCounter,
    pub(crate) expected_rules_revision: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) connection_profile_id: String,
    pub(crate) expected_connection_generation: WireCounter,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateRuleInput {
    #[serde(flatten)]
    pub(crate) request: RuleMutationInput,
    pub(crate) rule: SshForwardRule,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateRuleInput {
    #[serde(flatten)]
    pub(crate) request: RuleMutationInput,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) rule_id: String,
    pub(crate) expected_rule_generation: WireCounter,
    pub(crate) rule: SshForwardRule,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeleteRuleInput {
    #[serde(flatten)]
    pub(crate) request: RuleMutationInput,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) rule_id: String,
    pub(crate) expected_rule_generation: WireCounter,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConnectionLifecycleInput {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) scope_id: String,
    pub(crate) scope_generation: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) connection_profile_id: String,
    pub(crate) expected_generation: WireCounter,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_credential_attempt_id"
    )]
    pub(crate) credential_attempt_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SetRuleEnabledInput {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) scope_id: String,
    pub(crate) scope_generation: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) connection_profile_id: String,
    pub(crate) expected_connection_generation: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) rule_id: String,
    pub(crate) expected_rule_generation: WireCounter,
    pub(crate) enabled: bool,
}

#[cfg(windows)]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LoadConnectionKeyInput {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) scope_id: String,
    pub(crate) scope_generation: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) connection_profile_id: String,
    pub(crate) expected_generation: WireCounter,
    pub(crate) key_id: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_credential_attempt_id"
    )]
    pub(crate) credential_attempt_id: Option<String>,
    #[serde(
        default = "default_remember_for_days",
        deserialize_with = "deserialize_remember_for_days"
    )]
    pub(crate) remember_for_days: u16,
    #[serde(deserialize_with = "deserialize_bounded_passphrase")]
    pub(crate) passphrase: Zeroizing<String>,
}

#[cfg(windows)]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LoadConnectionPasswordInput {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) scope_id: String,
    pub(crate) scope_generation: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) connection_profile_id: String,
    pub(crate) expected_generation: WireCounter,
    #[serde(deserialize_with = "deserialize_credential_attempt_id")]
    pub(crate) credential_attempt_id: String,
    #[serde(deserialize_with = "deserialize_bounded_username")]
    pub(crate) username: String,
    #[serde(deserialize_with = "deserialize_bounded_password")]
    pub(crate) password: Zeroizing<String>,
    #[serde(
        default = "default_remember_for_days",
        deserialize_with = "deserialize_remember_for_days"
    )]
    pub(crate) remember_for_days: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ApproveConnectionHostInput {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) scope_id: String,
    pub(crate) scope_generation: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) connection_profile_id: String,
    pub(crate) expected_generation: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) challenge_id: String,
    pub(crate) algorithm: String,
    pub(crate) fingerprint: String,
    pub(crate) expected_trust_revision: WireCounter,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ForgetCredentialInput {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) scope_id: String,
    pub(crate) scope_generation: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) connection_profile_id: String,
    pub(crate) expected_generation: WireCounter,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ActivateScopeInput {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
    #[serde(deserialize_with = "deserialize_optional_uuid_v4")]
    pub(crate) scope_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProfileMutationInput {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
    pub(crate) scope_id: String,
    pub(crate) scope_generation: WireCounter,
    pub(crate) expected_profiles_revision: WireCounter,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateProfileInput {
    #[serde(flatten)]
    pub(crate) request: ProfileMutationInput,
    pub(crate) profile: SshForwardProfile,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateProfileInput {
    #[serde(flatten)]
    pub(crate) request: ProfileMutationInput,
    pub(crate) profile_id: String,
    pub(crate) expected_generation: WireCounter,
    pub(crate) profile: SshForwardProfile,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeleteProfileInput {
    #[serde(flatten)]
    pub(crate) request: ProfileMutationInput,
    pub(crate) profile_id: String,
    pub(crate) expected_generation: WireCounter,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProfileLifecycleInput {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
    pub(crate) scope_id: String,
    pub(crate) scope_generation: WireCounter,
    pub(crate) profile_id: String,
    pub(crate) expected_generation: WireCounter,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_credential_attempt_id"
    )]
    pub(crate) credential_attempt_id: Option<String>,
}

#[cfg(windows)]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LoadKeyInput {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
    pub(crate) scope_id: String,
    pub(crate) scope_generation: WireCounter,
    pub(crate) profile_id: String,
    pub(crate) key_id: String,
    #[serde(
        default,
        deserialize_with = "deserialize_optional_credential_attempt_id"
    )]
    pub(crate) credential_attempt_id: Option<String>,
    #[serde(
        default = "default_remember_for_days",
        deserialize_with = "deserialize_remember_for_days"
    )]
    pub(crate) remember_for_days: u16,
    #[serde(deserialize_with = "deserialize_bounded_passphrase")]
    pub(crate) passphrase: Zeroizing<String>,
}

#[cfg(windows)]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LoadPasswordInput {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
    pub(crate) scope_id: String,
    pub(crate) scope_generation: WireCounter,
    pub(crate) profile_id: String,
    #[serde(deserialize_with = "deserialize_credential_attempt_id")]
    pub(crate) credential_attempt_id: String,
    #[serde(deserialize_with = "deserialize_bounded_username")]
    pub(crate) username: String,
    #[serde(deserialize_with = "deserialize_bounded_password")]
    pub(crate) password: Zeroizing<String>,
    #[serde(
        default = "default_remember_for_days",
        deserialize_with = "deserialize_remember_for_days"
    )]
    pub(crate) remember_for_days: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ApproveHostInput {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
    pub(crate) scope_id: String,
    pub(crate) scope_generation: WireCounter,
    pub(crate) profile_id: String,
    pub(crate) expected_generation: WireCounter,
    pub(crate) challenge_id: String,
    pub(crate) algorithm: String,
    pub(crate) fingerprint: String,
    pub(crate) expected_trust_revision: WireCounter,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PurgeScopeInput {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
    #[serde(deserialize_with = "deserialize_uuid_v4")]
    pub(crate) scope_id: String,
    pub(crate) known_scopes: KnownScopesInput,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PurgeScopeResult {
    pub(crate) scope_id: String,
    pub(crate) purged: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SshForwardState {
    Stopped,
    Starting,
    Running,
    Reconnecting,
    Stopping,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AutoStartDisposition {
    NotRequested,
    Queued,
    Started,
    SkippedActiveLimit,
}

/// Memory-only lifecycle state for an authenticated connection. It is kept
/// separate from the legacy per-rule state until the v2 command surface is
/// published in the next phase.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SshConnectionState {
    Disconnected,
    Authenticating,
    Established,
    Reconnecting,
    Disconnecting,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SshForwardRuleState {
    Off,
    Opening,
    On,
    Closing,
    Failed,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SshForwardCredentialStatus {
    None,
    Saved,
    Rejected,
    Expired,
    Unavailable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SshForwardCredentialState {
    pub(crate) connection_profile_id: String,
    pub(crate) status: SshForwardCredentialStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) expires_at: Option<UtcTimestamp>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SshConnectionRuntime {
    pub(crate) connection_profile_id: String,
    pub(crate) generation: WireCounter,
    pub(crate) state: SshConnectionState,
    pub(crate) retry_attempt: u8,
    pub(crate) active_channels: u16,
    pub(crate) state_changed_at: UtcTimestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) started_at: Option<UtcTimestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error_code: Option<SshForwardErrorCode>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SshForwardRuleRuntime {
    pub(crate) rule_id: String,
    pub(crate) connection_profile_id: String,
    pub(crate) connection_generation: WireCounter,
    pub(crate) generation: WireCounter,
    pub(crate) state: SshForwardRuleState,
    pub(crate) bind_host: LoopbackHost,
    pub(crate) local_port: u16,
    pub(crate) active_channels: u16,
    pub(crate) state_changed_at: UtcTimestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) started_at: Option<UtcTimestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error_code: Option<SshForwardErrorCode>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SshForwardRuntime {
    pub(crate) profile_id: String,
    pub(crate) generation: WireCounter,
    pub(crate) state: SshForwardState,
    pub(crate) bind_host: LoopbackHost,
    pub(crate) local_port: u16,
    pub(crate) retry_attempt: u8,
    pub(crate) active_channels: u16,
    pub(crate) auto_start_disposition: AutoStartDisposition,
    pub(crate) state_changed_at: UtcTimestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) started_at: Option<UtcTimestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error_code: Option<SshForwardErrorCode>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HostKeyChallenge {
    pub(crate) challenge_id: String,
    pub(crate) connection_profile_id: String,
    pub(crate) scope_id: String,
    pub(crate) generation: WireCounter,
    pub(crate) ssh_host: String,
    pub(crate) ssh_port: u16,
    pub(crate) algorithm: String,
    pub(crate) fingerprint: String,
    pub(crate) expires_at: UtcTimestamp,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SshForwardTrustRepairMetadata {
    pub(crate) trust_path: String,
    pub(crate) executable_path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SshForwardSnapshot {
    pub(crate) context: DesktopClientContext,
    pub(crate) scope_id: String,
    pub(crate) activation_token: WireCounter,
    pub(crate) scope_generation: WireCounter,
    pub(crate) connections_revision: WireCounter,
    pub(crate) rules_revision: WireCounter,
    pub(crate) profiles_revision: WireCounter,
    pub(crate) trust_revision: WireCounter,
    pub(crate) connections: Vec<SshConnectionProfile>,
    pub(crate) rules: Vec<SshForwardRule>,
    pub(crate) connection_runtimes: Vec<SshConnectionRuntime>,
    pub(crate) rule_runtimes: Vec<SshForwardRuleRuntime>,
    pub(crate) credential_states: Vec<SshForwardCredentialState>,
    pub(crate) profiles: Vec<SshForwardProfile>,
    pub(crate) runtimes: Vec<SshForwardRuntime>,
    pub(crate) host_key_challenges: Vec<HostKeyChallenge>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) trust_repair: Option<SshForwardTrustRepairMetadata>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SshForwardScopeActivation {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
    pub(crate) scope_id: Option<String>,
    pub(crate) scope_generation: WireCounter,
    pub(crate) snapshot: Option<SshForwardSnapshot>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SshKeyInventoryItem {
    pub(crate) key_id: String,
    pub(crate) label: String,
    pub(crate) algorithm: String,
    pub(crate) fingerprint: String,
    pub(crate) encrypted: bool,
    pub(crate) source: SshKeyInventorySource,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SshKeyInventorySource {
    Agent,
    Local,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SshKeyInventory {
    pub(crate) context: DesktopClientContext,
    pub(crate) scope_id: String,
    pub(crate) scope_generation: WireCounter,
    pub(crate) keys: Vec<SshKeyInventoryItem>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::enum_variant_names)]
pub(crate) enum SshForwardEventReason {
    ProfilesChanged,
    ConnectionsChanged,
    RulesChanged,
    RuntimeChanged,
    TrustChanged,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SshForwardEventHint {
    pub(crate) desktop_instance_id: String,
    pub(crate) manager_session_id: String,
    pub(crate) client_epoch: WireCounter,
    pub(crate) activation_token: WireCounter,
    pub(crate) scope_id: String,
    pub(crate) scope_generation: WireCounter,
    pub(crate) connections_revision: WireCounter,
    pub(crate) rules_revision: WireCounter,
    pub(crate) profiles_revision: WireCounter,
    pub(crate) trust_revision: WireCounter,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) generation: Option<WireCounter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) connection_profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) rule_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) connection_generation: Option<WireCounter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) rule_generation: Option<WireCounter>,
    pub(crate) reason: SshForwardEventReason,
}

#[cfg(test)]
mod tests {
    use serde::{de::DeserializeOwned, Serialize};

    use super::{
        HostKeyChallenge, OpenClientResult, SshConnectionRuntime, SshForwardCredentialState,
        SshForwardEventHint, SshForwardRuleRuntime, SshForwardRuntime, SshForwardScopeActivation,
        SshForwardSnapshot, SshKeyInventory, UtcTimestamp, WireCounter, WireScalarError,
    };
    use crate::ssh_forward::{
        instance::DesktopClientContext,
        profile::{SshForwardAuth, SshForwardProfile},
    };

    const SHARED_FIXTURES: &str =
        include_str!("../../../../../packages/shared/src/ssh-forward-contract-fixtures.json");

    #[test]
    fn counters_are_canonical_json_strings() {
        let counter = WireCounter::parse("99").unwrap().increment().unwrap();
        assert_eq!(counter.value(), 100);
        assert_eq!(serde_json::to_string(&counter).unwrap(), "\"100\"");
        assert_eq!(
            serde_json::from_str::<WireCounter>("\"10\"")
                .unwrap()
                .value(),
            10
        );
    }

    #[test]
    fn counter_order_is_numeric_across_decimal_boundaries() {
        let nine = WireCounter::parse("9").unwrap();
        let ten = WireCounter::parse("10").unwrap();
        let ninety_nine = WireCounter::parse("99").unwrap();
        let one_hundred = WireCounter::parse("100").unwrap();

        assert!(nine < ten);
        assert!(ninety_nine < one_hundred);
        assert!(ten.to_string() < nine.to_string());
    }

    #[test]
    fn counters_reject_noncanonical_and_overflow_inputs() {
        for value in [
            "",
            "00",
            "01",
            "-1",
            "+1",
            " 1",
            "1 ",
            "1.0",
            "1e3",
            "18446744073709551616",
        ] {
            assert_eq!(
                WireCounter::parse(value),
                Err(WireScalarError::InvalidCounter)
            );
        }
        assert!(serde_json::from_str::<WireCounter>("1").is_err());
        assert_eq!(
            WireCounter::parse(&u64::MAX.to_string())
                .unwrap()
                .increment(),
            Err(WireScalarError::CounterExhausted)
        );
    }

    #[test]
    fn timestamps_are_exact_utc_milliseconds() {
        let timestamp = UtcTimestamp::parse("2026-08-10T12:34:56.789Z").unwrap();
        assert_eq!(timestamp.format().unwrap(), "2026-08-10T12:34:56.789Z");
        assert_eq!(
            serde_json::to_string(&timestamp).unwrap(),
            "\"2026-08-10T12:34:56.789Z\""
        );
        for value in [
            "2026-08-10T12:34:56Z",
            "2026-08-10T12:34:56.78Z",
            "+2026-08-10T12:34:56.789Z",
            "-0001-08-10T12:34:56.789Z",
            "2026-08-10T12:34:56.789+00:00",
            "2026-02-30T12:34:56.789Z",
        ] {
            assert_eq!(
                UtcTimestamp::parse(value),
                Err(WireScalarError::InvalidTimestamp)
            );
        }
    }

    #[test]
    fn shared_json_fixtures_match_rust_wire_scalars() {
        let fixtures: serde_json::Value = serde_json::from_str(SHARED_FIXTURES).unwrap();
        for value in fixtures["wireCounters"].as_array().unwrap() {
            assert!(WireCounter::parse(value.as_str().unwrap()).is_ok());
        }
        for value in fixtures["invalidWireCounters"].as_array().unwrap() {
            assert!(WireCounter::parse(value.as_str().unwrap()).is_err());
        }
        for value in fixtures["timestamps"].as_array().unwrap() {
            assert!(UtcTimestamp::parse(value.as_str().unwrap()).is_ok());
        }
        for value in fixtures["invalidTimestamps"].as_array().unwrap() {
            assert!(UtcTimestamp::parse(value.as_str().unwrap()).is_err());
        }
    }

    #[test]
    fn shared_dto_fixtures_match_optional_field_serialization() {
        let fixtures: serde_json::Value = serde_json::from_str(SHARED_FIXTURES).unwrap();
        let runtime: SshForwardRuntime =
            serde_json::from_value(fixtures["dtoSamples"]["runtimeWithoutOptionals"].clone())
                .unwrap();
        let encoded = serde_json::to_value(runtime).unwrap();
        assert!(!encoded.as_object().unwrap().contains_key("startedAt"));
        assert!(!encoded.as_object().unwrap().contains_key("errorCode"));

        let hint: SshForwardEventHint =
            serde_json::from_value(fixtures["dtoSamples"]["eventHintWithoutOptionals"].clone())
                .unwrap();
        let encoded = serde_json::to_value(hint).unwrap();
        assert!(!encoded.as_object().unwrap().contains_key("profileId"));
        assert!(!encoded.as_object().unwrap().contains_key("generation"));
    }

    #[test]
    fn shared_dto_fixtures_cover_all_native_wire_shapes() {
        let fixtures: serde_json::Value = serde_json::from_str(SHARED_FIXTURES).unwrap();
        let samples = &fixtures["dtoSamples"];
        assert_fixture_roundtrip::<DesktopClientContext>(samples, "desktopClientContext");
        assert_fixture_roundtrip::<OpenClientResult>(samples, "openClientResult");
        assert_fixture_roundtrip::<SshForwardProfile>(samples, "sshForwardProfile");
        assert_fixture_roundtrip::<SshForwardAuth>(samples, "sshForwardKeyAuth");
        assert_fixture_roundtrip::<super::SshConnectionProfile>(samples, "sshConnectionProfile");
        assert_fixture_roundtrip::<super::SshForwardRule>(samples, "sshForwardRule");
        assert_fixture_roundtrip::<SshConnectionRuntime>(samples, "connectionRuntime");
        assert_fixture_roundtrip::<SshForwardRuleRuntime>(samples, "ruleRuntime");
        assert_fixture_roundtrip::<SshForwardCredentialState>(samples, "credentialState");
        assert_fixture_roundtrip::<SshForwardRuntime>(samples, "runtimeWithOptionals");
        assert_fixture_roundtrip::<HostKeyChallenge>(samples, "hostKeyChallenge");
        assert_fixture_roundtrip::<SshForwardSnapshot>(samples, "sshForwardSnapshot");
        assert_fixture_roundtrip::<SshForwardScopeActivation>(samples, "scopeActivation");
        assert_fixture_roundtrip::<SshKeyInventory>(samples, "keyInventory");
        assert_fixture_roundtrip::<SshForwardEventHint>(samples, "eventHintWithoutOptionals");
        assert_fixture_roundtrip::<SshForwardEventHint>(samples, "eventHintWithOptionals");
    }

    fn assert_fixture_roundtrip<T>(samples: &serde_json::Value, name: &str)
    where
        T: DeserializeOwned + Serialize,
    {
        let value: T = serde_json::from_value(samples[name].clone()).unwrap();
        assert_eq!(serde_json::to_value(value).unwrap(), samples[name]);
    }
}
