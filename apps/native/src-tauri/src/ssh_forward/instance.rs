//! Memory-only manager and client identity allocation.

use serde::{de::Error as _, Deserialize, Deserializer, Serialize};
use uuid::Uuid;

use super::{error::SshForwardErrorCode, model::WireCounter, profile::validate_uuid_v4};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DesktopClientContext {
    pub(crate) desktop_instance_id: String,
    pub(crate) manager_session_id: String,
    pub(crate) client_epoch: WireCounter,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DesktopClientContextWire {
    desktop_instance_id: String,
    manager_session_id: String,
    client_epoch: WireCounter,
}

impl<'de> Deserialize<'de> for DesktopClientContext {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = DesktopClientContextWire::deserialize(deserializer)?;
        validate_uuid_v4(&value.desktop_instance_id)
            .and_then(|_| validate_uuid_v4(&value.manager_session_id))
            .map_err(|_| D::Error::custom("invalid_desktop_client_context"))?;
        Ok(Self {
            desktop_instance_id: value.desktop_instance_id,
            manager_session_id: value.manager_session_id,
            client_epoch: value.client_epoch,
        })
    }
}

pub(crate) struct ClientEpochIssuer {
    desktop_instance_id: String,
    manager_session_id: String,
    next_client_epoch: WireCounter,
}

impl ClientEpochIssuer {
    pub(crate) fn new(desktop_instance_id: String) -> Result<Self, SshForwardErrorCode> {
        validate_uuid_v4(&desktop_instance_id).map_err(|_| SshForwardErrorCode::IdentityCorrupt)?;
        Ok(Self {
            desktop_instance_id,
            manager_session_id: Uuid::new_v4().to_string(),
            next_client_epoch: WireCounter::ZERO,
        })
    }

    pub(crate) fn open_client(&mut self) -> Result<DesktopClientContext, SshForwardErrorCode> {
        self.next_client_epoch = self
            .next_client_epoch
            .increment()
            .map_err(|_| SshForwardErrorCode::CounterExhausted)?;
        Ok(DesktopClientContext {
            desktop_instance_id: self.desktop_instance_id.clone(),
            manager_session_id: self.manager_session_id.clone(),
            client_epoch: self.next_client_epoch,
        })
    }

    pub(crate) fn desktop_instance_id(&self) -> &str {
        &self.desktop_instance_id
    }

    pub(crate) fn manager_session_id(&self) -> &str {
        &self.manager_session_id
    }
}

#[cfg(test)]
mod tests {
    use super::ClientEpochIssuer;

    const DESKTOP_ID: &str = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";

    #[test]
    fn newer_client_epochs_win_without_lexical_comparison() {
        let mut issuer = ClientEpochIssuer::new(DESKTOP_ID.into()).unwrap();
        let mut last = issuer.open_client().unwrap();
        for _ in 0..99 {
            last = issuer.open_client().unwrap();
        }
        assert_eq!(last.client_epoch.to_string(), "100");
    }

    #[test]
    fn malformed_persisted_identity_fails_closed() {
        assert!(ClientEpochIssuer::new("not-a-uuid".into()).is_err());
    }

    #[test]
    fn manager_sessions_are_unique_and_client_epochs_start_at_one() {
        let mut first = ClientEpochIssuer::new(DESKTOP_ID.into()).unwrap();
        let mut second = ClientEpochIssuer::new(DESKTOP_ID.into()).unwrap();
        let first_client = first.open_client().unwrap();
        let second_client = second.open_client().unwrap();

        assert_ne!(
            first_client.manager_session_id,
            second_client.manager_session_id
        );
        assert_eq!(first_client.client_epoch.to_string(), "1");
        assert_eq!(second_client.client_epoch.to_string(), "1");
    }

    #[test]
    fn desktop_client_context_rejects_non_v4_identity_fields() {
        assert!(serde_json::from_str::<super::DesktopClientContext>(
            r#"{"desktopInstanceId":"invalid","managerSessionId":"e1634e77-b0b5-4b21-bd2f-462c9e3b7a96","clientEpoch":"1"}"#
        )
        .is_err());
    }
}
