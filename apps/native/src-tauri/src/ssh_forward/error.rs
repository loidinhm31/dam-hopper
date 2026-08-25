//! Redacted, stable error codes for the native SSH-forwarding boundary.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum SshForwardErrorCode {
    InvalidArgument,
    UnsupportedPlatform,
    IpcUnavailable,
    DesktopInstanceMismatch,
    ManagerSessionMismatch,
    ClientEpochStale,
    ActivationSuperseded,
    ScopeNotActive,
    ScopeGenerationConflict,
    ScopeActive,
    ScopePurgeFailed,
    ProfilesRevisionConflict,
    ConnectionsRevisionConflict,
    RulesRevisionConflict,
    TrustRevisionConflict,
    GenerationConflict,
    CounterExhausted,
    ProfileNotFound,
    ProfileActive,
    ProfileLimit,
    ActiveForwardLimit,
    AutoStartSkippedLimit,
    ConnectionRequired,
    ConnectionLimit,
    ConnectionNotEstablished,
    StaleConnectionGeneration,
    RuleLimit,
    StaleRuleGeneration,
    PortConflict,
    ChannelLimit,
    KeyNotFound,
    KeyUnsafe,
    KeyEncryptedUseAgent,
    KeyPassphraseInvalid,
    AgentUnavailable,
    HostKeyApprovalRequired,
    HostKeyChanged,
    HostKeyAlgorithmChanged,
    HostKeyAlgorithmUnsupported,
    HostKeyChallengeNotFound,
    HostKeyChallengeExpired,
    SshConnectTimeout,
    SshConnectFailed,
    AuthFailed,
    AuthRequired,
    CredentialVaultUnavailable,
    CredentialVaultCorrupt,
    CredentialExpired,
    CredentialRejected,
    CredentialDeleteFailed,
    CredentialCleanupPending,
    CredentialNotSaved,
    LocalPortInUse,
    BindFailed,
    ChannelOpenTimeout,
    TargetConnectFailed,
    TargetNotAllowed,
    ShutdownTimeout,
    ShutdownInProgress,
    StoreCorrupt,
    StoreIo,
    Internal,

    // Phase 02 wire compatibility. New command paths map these to the fixed
    // public table above, but the DTO fixture still accepts their old names.
    InvalidCounter,
    InvalidTimestamp,
    InvalidProfile,
    IdentityCorrupt,
    StaleClient,
    StorageUnavailable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SshForwardCommandError {
    pub(crate) code: SshForwardErrorCode,
    pub(crate) message: String,
    pub(crate) retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) scope_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) connection_profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) rule_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) current_profiles_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) current_connections_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) current_rules_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) current_trust_revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) current_scope_generation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) current_generation: Option<String>,
}

impl SshForwardErrorCode {
    pub(crate) fn fixed(self) -> (&'static str, bool) {
        use SshForwardErrorCode::*;
        match self {
            InvalidArgument => ("Invalid SSH forwarding request.", false),
            UnsupportedPlatform => ("SSH forwarding requires the desktop app.", false),
            IpcUnavailable => ("Native SSH forwarding is temporarily unavailable.", true),
            DesktopInstanceMismatch => (
                "This request belongs to another desktop installation.",
                false,
            ),
            ManagerSessionMismatch => (
                "The native runtime restarted; reload forwarding state.",
                true,
            ),
            ClientEpochStale => ("A newer desktop view owns forwarding control.", true),
            ActivationSuperseded => (
                "A newer server-profile activation replaced this request.",
                true,
            ),
            ScopeNotActive => ("The requested server-profile scope is not active.", true),
            ScopeGenerationConflict => (
                "The server-profile scope changed; reload forwarding state.",
                true,
            ),
            ScopeActive => ("Stop and deactivate this scope before purging it.", false),
            ScopePurgeFailed => ("The inactive forwarding scope could not be removed.", true),
            ProfilesRevisionConflict => (
                "Forward profiles changed; review the latest version and retry.",
                true,
            ),
            ConnectionsRevisionConflict => (
                "SSH connections changed; review the latest version and retry.",
                true,
            ),
            RulesRevisionConflict => (
                "Forwarding rules changed; review the latest version and retry.",
                true,
            ),
            TrustRevisionConflict => ("Trusted host records changed; review and retry.", true),
            GenerationConflict => ("Forward runtime changed; reload its latest state.", true),
            CounterExhausted => (
                "A native forwarding counter is exhausted; reset requires maintenance.",
                false,
            ),
            ProfileNotFound => ("The forward profile no longer exists.", false),
            ProfileActive => ("Stop the forward before editing or deleting it.", false),
            ProfileLimit => (
                "This server profile already has the maximum number of forwards.",
                false,
            ),
            ActiveForwardLimit => ("Stop another forward before starting this one.", true),
            AutoStartSkippedLimit => (
                "Auto-start was skipped because the active-forward limit was reached.",
                true,
            ),
            ConnectionRequired => (
                "Connect the parent SSH connection to start this forward.",
                false,
            ),
            ConnectionLimit => ("The active connection limit has been reached.", true),
            ConnectionNotEstablished => ("The SSH connection is not established.", true),
            StaleConnectionGeneration => {
                ("The SSH connection changed; reload its latest state.", true)
            }
            RuleLimit => ("The active forwarding-rule limit has been reached.", true),
            StaleRuleGeneration => (
                "The forwarding rule changed; reload its latest state.",
                true,
            ),
            PortConflict => ("The desktop loopback port is already reserved.", true),
            ChannelLimit => ("The connection channel limit has been reached.", true),
            KeyNotFound => (
                "The selected key is no longer in the safe key inventory.",
                false,
            ),
            KeyUnsafe => (
                "The selected key file does not meet native safety checks.",
                false,
            ),
            KeyEncryptedUseAgent => (
                "Enter the passphrase for this encrypted SSH key to continue.",
                false,
            ),
            KeyPassphraseInvalid => ("The passphrase did not unlock the selected SSH key.", false),
            AgentUnavailable => (
                "Enter the SSH username and password, or load a local SSH identity, before retrying.",
                false,
            ),
            HostKeyApprovalRequired => (
                "Verify and approve the SSH host fingerprint before starting again.",
                false,
            ),
            HostKeyChanged => (
                "SSH host identity changed. Connection blocked; use stopped-app trust repair.",
                false,
            ),
            HostKeyAlgorithmChanged => (
                "SSH host-key algorithm changed. Connection blocked; use stopped-app trust repair.",
                false,
            ),
            HostKeyAlgorithmUnsupported => (
                "The SSH server offered an unsupported host-key algorithm.",
                false,
            ),
            HostKeyChallengeNotFound => (
                "The host-key approval request is no longer current; start again.",
                true,
            ),
            HostKeyChallengeExpired => (
                "The host-key approval expired; start again to request a new fingerprint.",
                true,
            ),
            SshConnectTimeout => ("The SSH connection timed out.", true),
            SshConnectFailed => ("The SSH server could not be reached.", true),
            AuthFailed => ("SSH authentication failed for the selected method.", false),
            AuthRequired => ("Enter SSH credentials before connecting.", false),
            CredentialVaultUnavailable => (
                "Saved SSH credentials are temporarily unavailable; enter them again.",
                true,
            ),
            CredentialVaultCorrupt => (
                "Saved SSH credentials are invalid; enter them again.",
                false,
            ),
            CredentialExpired => ("Saved SSH credentials expired; enter them again.", false),
            CredentialRejected => (
                "Saved SSH credentials were rejected; replace them before retrying.",
                false,
            ),
            CredentialDeleteFailed => (
                "Saved SSH credentials could not be removed; retry the Forget action.",
                true,
            ),
            CredentialCleanupPending => (
                "Saved SSH credential cleanup is incomplete; retry the profile operation.",
                true,
            ),
            CredentialNotSaved => (
                "The SSH connection is established, but the credential was not saved.",
                true,
            ),
            LocalPortInUse => ("The desktop loopback port is already in use.", true),
            BindFailed => ("The desktop loopback listener could not start.", true),
            ChannelOpenTimeout => ("The remote target channel timed out.", true),
            TargetConnectFailed => ("The remote loopback target refused the connection.", true),
            TargetNotAllowed => ("Only remote 127.0.0.1 is allowed.", false),
            ShutdownTimeout => (
                "Native forwarding exceeded its shutdown grace period.",
                true,
            ),
            ShutdownInProgress => ("The desktop app is shutting down.", false),
            StoreCorrupt => (
                "Native forwarding storage is invalid and requires maintenance.",
                false,
            ),
            StoreIo => (
                "Native forwarding storage is temporarily unavailable.",
                true,
            ),
            Internal => ("Native SSH forwarding failed safely.", false),
            InvalidCounter | InvalidTimestamp | InvalidProfile | IdentityCorrupt | StaleClient
            | StorageUnavailable => ("Invalid SSH forwarding request.", false),
        }
    }

    pub(crate) fn command_error(self) -> SshForwardCommandError {
        let (message, retryable) = self.fixed();
        SshForwardCommandError {
            code: self,
            message: message.into(),
            retryable,
            scope_id: None,
            profile_id: None,
            connection_profile_id: None,
            rule_id: None,
            current_profiles_revision: None,
            current_connections_revision: None,
            current_rules_revision: None,
            current_trust_revision: None,
            current_scope_generation: None,
            current_generation: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SshForwardErrorCode;

    #[test]
    fn public_error_table_has_fixed_redacted_messages_and_retryability() {
        let changed = SshForwardErrorCode::HostKeyChanged;
        assert_eq!(
            changed.fixed(),
            (
                "SSH host identity changed. Connection blocked; use stopped-app trust repair.",
                false
            )
        );
        assert_eq!(
            SshForwardErrorCode::IpcUnavailable.fixed(),
            ("Native SSH forwarding is temporarily unavailable.", true)
        );
        let encoded = serde_json::to_value(SshForwardErrorCode::TargetNotAllowed).unwrap();
        assert_eq!(encoded, "TARGET_NOT_ALLOWED");
        let mut command = SshForwardErrorCode::TrustRevisionConflict.command_error();
        command.current_trust_revision = Some("10".into());
        assert_eq!(
            command.message,
            "Trusted host records changed; review and retry."
        );
        assert!(command.retryable);
        assert!(serde_json::to_string(&command)
            .unwrap()
            .contains("currentTrustRevision"));
    }

    #[test]
    fn every_public_error_has_a_stable_command_contract() {
        use SshForwardErrorCode::*;

        let codes = [
            InvalidArgument,
            UnsupportedPlatform,
            IpcUnavailable,
            DesktopInstanceMismatch,
            ManagerSessionMismatch,
            ClientEpochStale,
            ActivationSuperseded,
            ScopeNotActive,
            ScopeGenerationConflict,
            ScopeActive,
            ScopePurgeFailed,
            ProfilesRevisionConflict,
            ConnectionsRevisionConflict,
            RulesRevisionConflict,
            TrustRevisionConflict,
            GenerationConflict,
            CounterExhausted,
            ProfileNotFound,
            ProfileActive,
            ProfileLimit,
            ActiveForwardLimit,
            AutoStartSkippedLimit,
            ConnectionRequired,
            ConnectionLimit,
            ConnectionNotEstablished,
            StaleConnectionGeneration,
            RuleLimit,
            StaleRuleGeneration,
            PortConflict,
            ChannelLimit,
            KeyNotFound,
            KeyUnsafe,
            KeyEncryptedUseAgent,
            KeyPassphraseInvalid,
            AgentUnavailable,
            HostKeyApprovalRequired,
            HostKeyChanged,
            HostKeyAlgorithmChanged,
            HostKeyAlgorithmUnsupported,
            HostKeyChallengeNotFound,
            HostKeyChallengeExpired,
            SshConnectTimeout,
            SshConnectFailed,
            AuthFailed,
            AuthRequired,
            CredentialVaultUnavailable,
            CredentialVaultCorrupt,
            CredentialExpired,
            CredentialRejected,
            CredentialDeleteFailed,
            CredentialCleanupPending,
            CredentialNotSaved,
            LocalPortInUse,
            BindFailed,
            ChannelOpenTimeout,
            TargetConnectFailed,
            TargetNotAllowed,
            ShutdownTimeout,
            ShutdownInProgress,
            StoreCorrupt,
            StoreIo,
            Internal,
            InvalidCounter,
            InvalidTimestamp,
            InvalidProfile,
            IdentityCorrupt,
            StaleClient,
            StorageUnavailable,
        ];

        for code in codes {
            let (message, _) = code.fixed();
            assert!(!message.is_empty());
            assert_eq!(code.command_error().code, code);
        }
    }
}
