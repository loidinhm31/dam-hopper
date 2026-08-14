//! Wire scalar contracts shared by native commands and the desktop adapter.

use std::fmt;

use serde::{de, Deserialize, Deserializer, Serialize, Serializer};
use time::{format_description, OffsetDateTime, PrimitiveDateTime, UtcOffset};

use super::{
    error::SshForwardErrorCode,
    instance::DesktopClientContext,
    profile::{LoopbackHost, SshForwardProfile},
    scope_retention::KnownScopesInput,
};

const MAX_WIRE_COUNTER_DIGITS: usize = 20;
const UTC_MILLIS_FORMAT: &str =
    "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z";

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
    pub(crate) scope_id: String,
    pub(crate) scope_generation: WireCounter,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ActivateScopeInput {
    pub(crate) context: DesktopClientContext,
    pub(crate) activation_token: WireCounter,
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
    pub(crate) profile_id: String,
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
pub(crate) struct SshForwardSnapshot {
    pub(crate) context: DesktopClientContext,
    pub(crate) scope_id: String,
    pub(crate) activation_token: WireCounter,
    pub(crate) scope_generation: WireCounter,
    pub(crate) profiles_revision: WireCounter,
    pub(crate) trust_revision: WireCounter,
    pub(crate) profiles: Vec<SshForwardProfile>,
    pub(crate) runtimes: Vec<SshForwardRuntime>,
    pub(crate) host_key_challenges: Vec<HostKeyChallenge>,
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
    pub(crate) profiles_revision: WireCounter,
    pub(crate) trust_revision: WireCounter,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) generation: Option<WireCounter>,
    pub(crate) reason: SshForwardEventReason,
}

#[cfg(test)]
mod tests {
    use serde::{de::DeserializeOwned, Serialize};

    use super::{
        HostKeyChallenge, OpenClientResult, SshForwardEventHint, SshForwardRuntime,
        SshForwardScopeActivation, SshForwardSnapshot, SshKeyInventory, UtcTimestamp, WireCounter,
        WireScalarError,
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
