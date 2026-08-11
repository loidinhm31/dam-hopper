use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::protocol::{validate_opaque_id, MAX_SEQUENCE};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SemanticTrust {
    Restricted,
    Trusted,
    Revoked,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InitializationPolicy {
    /// Server-owned, minimal initialization; never runs project-selected commands.
    Restricted,
    /// Server-owned trusted initialization; still accepts no browser/project options.
    Trusted,
}

impl SemanticTrust {
    pub const fn initialization_policy(self) -> InitializationPolicy {
        match self {
            Self::Trusted => InitializationPolicy::Trusted,
            Self::Restricted | Self::Revoked => InitializationPolicy::Restricted,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InitializationPolicyOptions {
    pub allow_build_scripts: bool,
    pub allow_workspace_plugins: bool,
    pub allow_build_tooling: bool,
}

impl InitializationPolicy {
    pub const fn options(self) -> InitializationPolicyOptions {
        match self {
            Self::Restricted => InitializationPolicyOptions {
                allow_build_scripts: false,
                allow_workspace_plugins: false,
                allow_build_tooling: false,
            },
            Self::Trusted => InitializationPolicyOptions {
                allow_build_scripts: false,
                // Trusted mode only permits reviewed server-owned deltas. It
                // never enables project-controlled plugin loading.
                allow_workspace_plugins: false,
                allow_build_tooling: false,
            },
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticTrustState {
    pub project_id: String,
    pub trust: SemanticTrust,
    pub can_transition: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transition_reason: Option<TrustTransitionReason>,
    pub policy_revision: u64,
}

impl SemanticTrustState {
    pub fn validate(&self) -> Result<(), TrustError> {
        validate_opaque_id(&self.project_id, "project_id")
            .map_err(|_| TrustError::InvalidTrustState)?;
        if self.policy_revision > MAX_SEQUENCE {
            return Err(TrustError::InvalidTrustState);
        }
        Ok(())
    }
}

/// Public challenge DTO. It has no consumption state and is safe to serialize.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticTrustChallenge {
    pub project_id: String,
    pub challenge: String,
    pub policy_revision: u64,
    pub expires_at: u64,
}

impl SemanticTrustChallenge {
    pub fn validate(&self) -> Result<(), TrustError> {
        validate_transition_input(&self.project_id, &self.challenge)?;
        if self.policy_revision > MAX_SEQUENCE || self.expires_at > MAX_SEQUENCE {
            return Err(TrustError::InvalidChallenge);
        }
        Ok(())
    }
}

/// In-memory, non-cloneable one-time state owned by the authenticated project store.
#[derive(Debug)]
pub struct TrustConfirmationChallenge {
    challenge: SemanticTrustChallenge,
    consumed: bool,
}

impl TrustConfirmationChallenge {
    pub(crate) fn issue(
        project_id: String,
        challenge: String,
        policy_revision: u64,
        expires_at: u64,
    ) -> Result<Self, TrustError> {
        let challenge = SemanticTrustChallenge {
            project_id,
            challenge,
            policy_revision,
            expires_at,
        };
        challenge.validate()?;
        Ok(Self {
            challenge,
            consumed: false,
        })
    }

    pub(crate) fn is_expired(&self, now_ms: u64) -> bool {
        now_ms >= self.challenge.expires_at
    }

    pub fn public_challenge(&self) -> SemanticTrustChallenge {
        self.challenge.clone()
    }

    /// The owning authenticated-project store calls this while holding its lock.
    pub(crate) fn consume(
        &mut self,
        request: &SemanticTrustTransitionRequest,
        current_policy_revision: u64,
        now_ms: u64,
    ) -> Result<RequestedTrust, TrustError> {
        request.validate()?;
        if self.consumed {
            return Err(TrustError::ChallengeAlreadyConsumed);
        }
        if self.is_expired(now_ms) {
            return Err(TrustError::ChallengeExpired);
        }
        if request.project_id != self.challenge.project_id {
            return Err(TrustError::ProjectMismatch);
        }
        if self.challenge.policy_revision != current_policy_revision {
            return Err(TrustError::PolicyRevisionMismatch);
        }
        if !constant_time_eq(&request.confirmation, &self.challenge.challenge) {
            return Err(TrustError::ConfirmationMismatch);
        }
        self.consumed = true;
        Ok(request.desired_trust)
    }
}

pub use super::trust_store::{ProjectTrustStore, TrustRecord, TrustStoreError};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TrustTransitionReason {
    PolicyLocked,
    ConfirmationRequired,
    PolicyRevisionChanged,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticTrustTransitionRequest {
    pub project_id: String,
    pub desired_trust: RequestedTrust,
    pub confirmation: String,
}

impl SemanticTrustTransitionRequest {
    pub fn validate(&self) -> Result<(), TrustError> {
        validate_transition_input(&self.project_id, &self.confirmation)
    }
}

fn validate_transition_input(project_id: &str, confirmation: &str) -> Result<(), TrustError> {
    if validate_opaque_id(project_id, "project_id").is_err()
        || confirmation.trim().is_empty()
        || confirmation.len() > 512
        || confirmation.contains('\0')
    {
        return Err(TrustError::InvalidTransitionInput);
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestedTrust {
    Restricted,
    Trusted,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum TrustError {
    #[error("trust transition input is invalid")]
    InvalidTransitionInput,
    #[error("trust state is invalid")]
    InvalidTrustState,
    #[error("trust challenge is invalid")]
    InvalidChallenge,
    #[error("trust confirmation has already been consumed")]
    ChallengeAlreadyConsumed,
    #[error("trust confirmation has expired")]
    ChallengeExpired,
    #[error("trust confirmation project does not match")]
    ProjectMismatch,
    #[error("trust policy revision is stale")]
    PolicyRevisionMismatch,
    #[error("trust confirmation does not match")]
    ConfirmationMismatch,
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    use subtle::ConstantTimeEq;

    left.as_bytes().ct_eq(right.as_bytes()).into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transition_has_no_policy_or_runtime_escape_hatch() {
        let raw = r#"{"projectId":"project","desiredTrust":"trusted","confirmation":"one-time","initializationOptions":{}}"#;
        assert!(serde_json::from_str::<SemanticTrustTransitionRequest>(raw).is_err());
    }

    #[test]
    fn revoked_trust_falls_back_to_restricted_policy() {
        assert_eq!(
            SemanticTrust::Revoked.initialization_policy(),
            InitializationPolicy::Restricted
        );
    }

    fn challenge() -> TrustConfirmationChallenge {
        TrustConfirmationChallenge::issue("project".into(), "one-time".into(), 3, 100).unwrap()
    }

    fn request() -> SemanticTrustTransitionRequest {
        SemanticTrustTransitionRequest {
            project_id: "project".into(),
            desired_trust: RequestedTrust::Trusted,
            confirmation: "one-time".into(),
        }
    }

    #[test]
    fn challenge_is_project_bound_revision_checked_and_single_use() {
        let mut challenge = challenge();
        assert_eq!(
            challenge.consume(&request(), 2, 1),
            Err(TrustError::PolicyRevisionMismatch)
        );
        assert_eq!(
            challenge.consume(&request(), 3, 1),
            Ok(RequestedTrust::Trusted)
        );
        assert_eq!(
            challenge.consume(&request(), 3, 1),
            Err(TrustError::ChallengeAlreadyConsumed)
        );
    }

    #[test]
    fn challenge_rejects_expiry_and_project_replay() {
        let mut expired = challenge();
        assert_eq!(
            expired.consume(&request(), 3, 100),
            Err(TrustError::ChallengeExpired)
        );
        let mut wrong_project = challenge();
        let request = SemanticTrustTransitionRequest {
            project_id: "other".into(),
            ..request()
        };
        assert_eq!(
            wrong_project.consume(&request, 3, 1),
            Err(TrustError::ProjectMismatch)
        );
    }

    #[test]
    fn challenge_consumption_state_cannot_round_trip_through_serde() {
        let challenge = challenge();
        let _ = challenge;
        let public = SemanticTrustChallenge {
            project_id: "project".into(),
            challenge: "one-time".into(),
            policy_revision: 3,
            expires_at: 100,
        };
        assert!(serde_json::to_string(&public).is_ok());
    }

    #[test]
    fn transition_rejects_path_like_project_ids() {
        let request = SemanticTrustTransitionRequest {
            project_id: "file:/project".into(),
            ..request()
        };
        assert_eq!(request.validate(), Err(TrustError::InvalidTransitionInput));
    }

    #[test]
    fn transition_rejects_nul_in_confirmation_tokens() {
        let request = SemanticTrustTransitionRequest {
            confirmation: "one\0time".into(),
            ..request()
        };
        assert_eq!(request.validate(), Err(TrustError::InvalidTransitionInput));
    }

    #[test]
    fn trust_state_and_challenge_reject_unsafe_revisions() {
        let state = SemanticTrustState {
            project_id: "project".into(),
            trust: SemanticTrust::Restricted,
            can_transition: false,
            transition_reason: None,
            policy_revision: MAX_SEQUENCE + 1,
        };
        assert_eq!(state.validate(), Err(TrustError::InvalidTrustState));
        let challenge = SemanticTrustChallenge {
            project_id: "project".into(),
            challenge: "one-time".into(),
            policy_revision: 1,
            expires_at: MAX_SEQUENCE + 1,
        };
        assert_eq!(challenge.validate(), Err(TrustError::InvalidChallenge));
    }
}
