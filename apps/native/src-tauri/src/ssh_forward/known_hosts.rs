//! Endpoint-first SSH host trust and short-lived approval challenges.

use std::{collections::HashMap, fmt};

use base64::{
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD},
    Engine as _,
};
use uuid::Uuid;

use super::{
    error::SshForwardErrorCode,
    model::{HostKeyChallenge, UtcTimestamp, WireCounter},
    profile::{canonicalize_ssh_host, validate_uuid_v4},
    store::{StoredTrust, TrustedHost},
};

const CHALLENGE_TTL_SECONDS: i64 = 5 * 60;
const MAX_PUBLIC_KEY_BYTES: usize = 16 * 1024;
const SUPPORTED_ALGORITHMS: [&str; 4] = [
    "ssh-ed25519",
    "ecdsa-sha2-nistp256",
    "ecdsa-sha2-nistp384",
    "ecdsa-sha2-nistp521",
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SshEndpoint {
    pub(crate) host: String,
    pub(crate) port: u16,
}

impl SshEndpoint {
    pub(crate) fn new(host: &str, port: u16) -> Result<Self, SshForwardErrorCode> {
        if port == 0 {
            return Err(SshForwardErrorCode::InvalidArgument);
        }
        Ok(Self {
            host: canonicalize_ssh_host(host).map_err(|_| SshForwardErrorCode::InvalidArgument)?,
            port,
        })
    }
}

#[derive(Clone, Eq, PartialEq)]
pub(crate) struct OfferedHostKey {
    pub(crate) algorithm: String,
    pub(crate) fingerprint: String,
    pub(crate) public_key: Vec<u8>,
}

impl fmt::Debug for OfferedHostKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OfferedHostKey")
            .field("algorithm", &self.algorithm)
            .field("fingerprint", &self.fingerprint)
            .field("public_key_len", &self.public_key.len())
            .finish()
    }
}

impl OfferedHostKey {
    pub(crate) fn new(
        algorithm: String,
        fingerprint: String,
        public_key: Vec<u8>,
    ) -> Result<Self, SshForwardErrorCode> {
        if !is_supported_algorithm(&algorithm)
            || !is_canonical_fingerprint(&fingerprint)
            || public_key.is_empty()
            || public_key.len() > MAX_PUBLIC_KEY_BYTES
        {
            return Err(SshForwardErrorCode::InvalidArgument);
        }
        let parsed = russh::keys::parse_public_key_base64(&STANDARD.encode(&public_key))
            .map_err(|_| SshForwardErrorCode::InvalidArgument)?;
        if parsed.algorithm().to_string() != algorithm
            || parsed.fingerprint(russh::keys::HashAlg::Sha256).to_string() != fingerprint
        {
            return Err(SshForwardErrorCode::InvalidArgument);
        }
        Ok(Self {
            algorithm,
            fingerprint,
            public_key,
        })
    }

    pub(crate) fn from_russh(
        public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<Self, SshForwardErrorCode> {
        let public_key_bytes = public_key
            .to_bytes()
            .map_err(|_| SshForwardErrorCode::Internal)?;
        let fingerprint = public_key
            .fingerprint(russh::keys::HashAlg::Sha256)
            .to_string();
        if !is_canonical_fingerprint(&fingerprint)
            || public_key_bytes.is_empty()
            || public_key_bytes.len() > MAX_PUBLIC_KEY_BYTES
        {
            return Err(SshForwardErrorCode::Internal);
        }
        Ok(Self {
            algorithm: public_key.algorithm().to_string(),
            fingerprint,
            public_key: public_key_bytes,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TrustDecision {
    Trusted,
    Unknown,
    ChangedKey,
    ChangedAlgorithm,
    UnsupportedAlgorithm,
}

impl TrustDecision {
    pub(crate) fn error_code(self) -> Option<SshForwardErrorCode> {
        match self {
            Self::Trusted => None,
            Self::Unknown => Some(SshForwardErrorCode::HostKeyApprovalRequired),
            Self::ChangedKey => Some(SshForwardErrorCode::HostKeyChanged),
            Self::ChangedAlgorithm => Some(SshForwardErrorCode::HostKeyAlgorithmChanged),
            Self::UnsupportedAlgorithm => Some(SshForwardErrorCode::HostKeyAlgorithmUnsupported),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ChallengeContext {
    pub(crate) client_epoch: WireCounter,
    pub(crate) activation_token: WireCounter,
    pub(crate) scope_generation: WireCounter,
    pub(crate) generation: WireCounter,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct HostKeyApproval {
    pub(crate) challenge_id: String,
    pub(crate) algorithm: String,
    pub(crate) fingerprint: String,
    pub(crate) expected_generation: WireCounter,
    pub(crate) expected_trust_revision: WireCounter,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ApprovedHostKey {
    pub(crate) record: TrustedHost,
    pub(crate) trust_revision: WireCounter,
}

#[derive(Clone, Debug)]
struct ChallengeRecord {
    challenge: HostKeyChallenge,
    context: ChallengeContext,
    desktop_instance_id: String,
    manager_session_id: String,
    trust_revision: WireCounter,
    public_key: Vec<u8>,
}

#[derive(Default)]
pub(crate) struct HostKeyChallengeBook {
    challenges: HashMap<String, ChallengeRecord>,
}

pub(crate) fn is_supported_algorithm(algorithm: &str) -> bool {
    SUPPORTED_ALGORITHMS.contains(&algorithm)
}

pub(crate) fn inspect_trust(
    trust: &StoredTrust,
    endpoint: &SshEndpoint,
    offered: &OfferedHostKey,
) -> TrustDecision {
    if !is_supported_algorithm(&offered.algorithm) {
        return TrustDecision::UnsupportedAlgorithm;
    }
    let mut endpoint_exists = false;
    for record in trust.endpoint_records(&endpoint.host, endpoint.port) {
        endpoint_exists = true;
        if record.algorithm() != offered.algorithm {
            continue;
        }
        let same_fingerprint = record.fingerprint() == offered.fingerprint;
        let same_key = record
            .public_key_bytes()
            .ok()
            .flatten()
            .is_some_and(|stored| stored == offered.public_key);
        return if same_fingerprint && same_key {
            TrustDecision::Trusted
        } else {
            TrustDecision::ChangedKey
        };
    }
    if endpoint_exists {
        TrustDecision::ChangedAlgorithm
    } else {
        TrustDecision::Unknown
    }
}

impl HostKeyChallengeBook {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn issue_or_repeat(
        &mut self,
        now: UtcTimestamp,
        context: ChallengeContext,
        scope_id: &str,
        desktop_instance_id: &str,
        manager_session_id: &str,
        profile_id: &str,
        endpoint: &SshEndpoint,
        offered: &OfferedHostKey,
        trust_revision: WireCounter,
    ) -> Result<HostKeyChallenge, SshForwardErrorCode> {
        validate_uuid_v4(profile_id).map_err(|_| SshForwardErrorCode::InvalidArgument)?;
        validate_uuid_v4(scope_id).map_err(|_| SshForwardErrorCode::InvalidArgument)?;
        self.expire(now);
        if let Some(existing) = self.challenges.values().find(|record| {
            record.challenge.profile_id == profile_id
                && record.challenge.scope_id == scope_id
                && record.challenge.generation == context.generation
                && record.challenge.ssh_host == endpoint.host
                && record.challenge.ssh_port == endpoint.port
                && record.challenge.algorithm == offered.algorithm
                && record.challenge.fingerprint == offered.fingerprint
                && record.context == context
                && record.desktop_instance_id == desktop_instance_id
                && record.manager_session_id == manager_session_id
                && record.trust_revision == trust_revision
                && record.public_key == offered.public_key
        }) {
            return Ok(existing.challenge.clone());
        }

        let expires_at = now
            .checked_add_seconds(CHALLENGE_TTL_SECONDS)
            .map_err(|_| SshForwardErrorCode::Internal)?;
        let challenge = HostKeyChallenge {
            challenge_id: Uuid::new_v4().to_string(),
            profile_id: profile_id.into(),
            scope_id: scope_id.into(),
            generation: context.generation,
            ssh_host: endpoint.host.clone(),
            ssh_port: endpoint.port,
            algorithm: offered.algorithm.clone(),
            fingerprint: offered.fingerprint.clone(),
            expires_at,
        };
        self.challenges.insert(
            challenge.challenge_id.clone(),
            ChallengeRecord {
                challenge: challenge.clone(),
                context,
                desktop_instance_id: desktop_instance_id.into(),
                manager_session_id: manager_session_id.into(),
                trust_revision,
                public_key: offered.public_key.clone(),
            },
        );
        Ok(challenge)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn approve(
        &mut self,
        now: UtcTimestamp,
        approval: &HostKeyApproval,
        context: ChallengeContext,
        scope_id: &str,
        desktop_instance_id: &str,
        manager_session_id: &str,
        profile_id: &str,
    ) -> Result<ApprovedHostKey, SshForwardErrorCode> {
        if self
            .challenges
            .get(&approval.challenge_id)
            .is_some_and(|record| record.challenge.expires_at <= now)
        {
            self.challenges.remove(&approval.challenge_id);
            return Err(SshForwardErrorCode::HostKeyChallengeExpired);
        }
        self.expire(now);
        let pending = self
            .challenges
            .get(&approval.challenge_id)
            .ok_or(SshForwardErrorCode::HostKeyChallengeNotFound)?;
        if pending.desktop_instance_id != desktop_instance_id {
            return Err(SshForwardErrorCode::DesktopInstanceMismatch);
        }
        if pending.manager_session_id != manager_session_id {
            return Err(SshForwardErrorCode::ManagerSessionMismatch);
        }
        if pending.challenge.profile_id != profile_id {
            return Err(SshForwardErrorCode::HostKeyChallengeNotFound);
        }
        if pending.challenge.scope_id != scope_id {
            return Err(SshForwardErrorCode::ScopeGenerationConflict);
        }
        if pending.context.client_epoch != context.client_epoch {
            return Err(SshForwardErrorCode::ClientEpochStale);
        }
        if pending.context.activation_token != context.activation_token {
            return Err(SshForwardErrorCode::ActivationSuperseded);
        }
        if pending.context.scope_generation != context.scope_generation {
            return Err(SshForwardErrorCode::ScopeGenerationConflict);
        }
        if pending.context.generation != context.generation {
            return Err(SshForwardErrorCode::GenerationConflict);
        }
        if pending.challenge.generation != approval.expected_generation {
            return Err(SshForwardErrorCode::HostKeyChallengeNotFound);
        }
        if pending.trust_revision != approval.expected_trust_revision {
            return Err(SshForwardErrorCode::TrustRevisionConflict);
        }
        if pending.challenge.algorithm != approval.algorithm
            || pending.challenge.fingerprint != approval.fingerprint
        {
            return Err(SshForwardErrorCode::HostKeyChallengeNotFound);
        }
        let record = self
            .challenges
            .remove(&approval.challenge_id)
            .ok_or(SshForwardErrorCode::HostKeyChallengeNotFound)?;
        Ok(ApprovedHostKey {
            record: TrustedHost::new(
                record.challenge.ssh_host,
                record.challenge.ssh_port,
                record.challenge.algorithm,
                record.challenge.fingerprint,
                Some(STANDARD_NO_PAD.encode(record.public_key)),
            ),
            trust_revision: record.trust_revision,
        })
    }

    pub(crate) fn clear_profile(&mut self, profile_id: &str) {
        self.challenges
            .retain(|_, record| record.challenge.profile_id != profile_id);
    }

    pub(crate) fn expire(&mut self, now: UtcTimestamp) {
        self.challenges
            .retain(|_, record| record.challenge.expires_at > now);
    }

    pub(crate) fn len(&self) -> usize {
        self.challenges.len()
    }
}

fn is_canonical_fingerprint(value: &str) -> bool {
    let Some(encoded) = value.strip_prefix("SHA256:") else {
        return false;
    };
    if encoded.len() != 43
        || !encoded
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/'))
    {
        return false;
    }
    STANDARD_NO_PAD
        .decode(encoded)
        .is_ok_and(|decoded| STANDARD_NO_PAD.encode(decoded) == encoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROFILE: &str = "e1634e77-b0b5-4b21-bd2f-462c9e3b7a96";
    const SCOPE: &str = "c1f5890a-55d7-46ca-949b-0d63972f0a68";
    fn offered(byte: u8) -> OfferedHostKey {
        let public_key = public_key_bytes(byte);
        let parsed = russh::keys::parse_public_key_base64(&STANDARD.encode(&public_key)).unwrap();
        OfferedHostKey::new(
            "ssh-ed25519".into(),
            parsed.fingerprint(russh::keys::HashAlg::Sha256).to_string(),
            public_key,
        )
        .unwrap()
    }

    fn public_key_bytes(byte: u8) -> Vec<u8> {
        let algorithm = b"ssh-ed25519";
        let mut public_key = Vec::with_capacity(4 + algorithm.len() + 4 + 32);
        public_key.extend_from_slice(&(algorithm.len() as u32).to_be_bytes());
        public_key.extend_from_slice(algorithm);
        public_key.extend_from_slice(&32u32.to_be_bytes());
        public_key.extend(std::iter::repeat_n(byte, 32));
        public_key
    }

    fn fingerprint(byte: u8) -> String {
        let parsed =
            russh::keys::parse_public_key_base64(&STANDARD.encode(public_key_bytes(byte))).unwrap();
        parsed.fingerprint(russh::keys::HashAlg::Sha256).to_string()
    }

    fn context() -> ChallengeContext {
        ChallengeContext {
            client_epoch: WireCounter::parse("10").unwrap(),
            activation_token: WireCounter::parse("11").unwrap(),
            scope_generation: WireCounter::parse("12").unwrap(),
            generation: WireCounter::parse("13").unwrap(),
        }
    }

    #[test]
    fn endpoint_first_matching_distinguishes_key_and_algorithm_changes() {
        let mut trust = StoredTrust::empty(SCOPE);
        trust.entries.push(TrustedHost::new(
            "example.com".into(),
            22,
            "ssh-ed25519".into(),
            fingerprint(1),
            Some(STANDARD_NO_PAD.encode(public_key_bytes(1))),
        ));
        let endpoint = SshEndpoint::new("EXAMPLE.COM.", 22).unwrap();
        assert_eq!(
            inspect_trust(&trust, &endpoint, &offered(1)),
            TrustDecision::Trusted
        );
        assert_eq!(
            inspect_trust(&trust, &endpoint, &offered(2)),
            TrustDecision::ChangedKey
        );
        let other = OfferedHostKey {
            algorithm: "ecdsa-sha2-nistp256".into(),
            fingerprint: fingerprint(1),
            public_key: public_key_bytes(1),
        };
        assert_eq!(
            inspect_trust(&trust, &endpoint, &other),
            TrustDecision::ChangedAlgorithm
        );
    }

    #[test]
    fn challenge_repeats_approval_is_exact_and_stop_clears() {
        let now = UtcTimestamp::parse("2026-08-11T00:00:00.000Z").unwrap();
        let endpoint = SshEndpoint::new("Example.COM.", 22).unwrap();
        let key = offered(1);
        let mut book = HostKeyChallengeBook::default();
        let first = book
            .issue_or_repeat(
                now,
                context(),
                SCOPE,
                "desktop",
                "manager",
                PROFILE,
                &endpoint,
                &key,
                WireCounter::ZERO,
            )
            .unwrap();
        let repeated = book
            .issue_or_repeat(
                now,
                context(),
                SCOPE,
                "desktop",
                "manager",
                PROFILE,
                &endpoint,
                &key,
                WireCounter::ZERO,
            )
            .unwrap();
        assert_eq!(first, repeated);
        assert_eq!(book.len(), 1);
        let invalid = book.approve(
            now,
            &HostKeyApproval {
                challenge_id: first.challenge_id.clone(),
                algorithm: key.algorithm.clone(),
                fingerprint: "SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB".into(),
                expected_generation: context().generation,
                expected_trust_revision: WireCounter::ZERO,
            },
            context(),
            SCOPE,
            "desktop",
            "manager",
            PROFILE,
        );
        assert_eq!(
            invalid.unwrap_err(),
            SshForwardErrorCode::HostKeyChallengeNotFound
        );
        assert_eq!(book.len(), 1);
        let mut stale_context = context();
        stale_context.client_epoch = WireCounter::parse("14").unwrap();
        let stale = book.approve(
            now,
            &HostKeyApproval {
                challenge_id: first.challenge_id.clone(),
                algorithm: key.algorithm.clone(),
                fingerprint: key.fingerprint.clone(),
                expected_generation: context().generation,
                expected_trust_revision: WireCounter::ZERO,
            },
            stale_context,
            SCOPE,
            "desktop",
            "manager",
            PROFILE,
        );
        assert_eq!(stale.unwrap_err(), SshForwardErrorCode::ClientEpochStale);
        assert_eq!(book.len(), 1);
        let cross_scope = book.approve(
            now,
            &HostKeyApproval {
                challenge_id: first.challenge_id.clone(),
                algorithm: key.algorithm.clone(),
                fingerprint: key.fingerprint.clone(),
                expected_generation: context().generation,
                expected_trust_revision: WireCounter::ZERO,
            },
            context(),
            "b2f5890a-55d7-46ca-949b-0d63972f0a68",
            "desktop",
            "manager",
            PROFILE,
        );
        assert_eq!(
            cross_scope.unwrap_err(),
            SshForwardErrorCode::ScopeGenerationConflict
        );
        assert_eq!(book.len(), 1);
        let approved = book
            .approve(
                now,
                &HostKeyApproval {
                    challenge_id: first.challenge_id,
                    algorithm: key.algorithm,
                    fingerprint: key.fingerprint,
                    expected_generation: context().generation,
                    expected_trust_revision: WireCounter::ZERO,
                },
                context(),
                SCOPE,
                "desktop",
                "manager",
                PROFILE,
            )
            .unwrap();
        assert_eq!(
            approved.record.public_key_bytes().unwrap().unwrap(),
            public_key_bytes(1)
        );
        assert_eq!(book.len(), 0);
    }

    #[test]
    fn expiry_and_stop_prevent_stale_approval() {
        let now = UtcTimestamp::parse("2026-08-11T00:00:00.000Z").unwrap();
        let endpoint = SshEndpoint::new("example.com", 22).unwrap();
        let mut book = HostKeyChallengeBook::default();
        let challenge = book
            .issue_or_repeat(
                now,
                context(),
                SCOPE,
                "desktop",
                "manager",
                PROFILE,
                &endpoint,
                &offered(1),
                WireCounter::ZERO,
            )
            .unwrap();
        book.clear_profile(PROFILE);
        assert_eq!(book.len(), 0);
        assert_eq!(
            book.approve(
                now,
                &HostKeyApproval {
                    challenge_id: challenge.challenge_id,
                    algorithm: "ssh-ed25519".into(),
                    fingerprint: fingerprint(1),
                    expected_generation: context().generation,
                    expected_trust_revision: WireCounter::ZERO,
                },
                context(),
                SCOPE,
                "desktop",
                "manager",
                PROFILE,
            )
            .unwrap_err(),
            SshForwardErrorCode::HostKeyChallengeNotFound
        );
    }

    #[test]
    fn expired_approval_reports_expiry_before_eviction() {
        let now = UtcTimestamp::parse("2026-08-11T00:00:00.000Z").unwrap();
        let endpoint = SshEndpoint::new("example.com", 22).unwrap();
        let key = offered(1);
        let mut book = HostKeyChallengeBook::default();
        let challenge = book
            .issue_or_repeat(
                now,
                context(),
                SCOPE,
                "desktop",
                "manager",
                PROFILE,
                &endpoint,
                &key,
                WireCounter::ZERO,
            )
            .unwrap();
        let expiration = now.checked_add_seconds(CHALLENGE_TTL_SECONDS).unwrap();
        let result = book.approve(
            expiration,
            &HostKeyApproval {
                challenge_id: challenge.challenge_id,
                algorithm: key.algorithm,
                fingerprint: key.fingerprint,
                expected_generation: context().generation,
                expected_trust_revision: WireCounter::ZERO,
            },
            context(),
            SCOPE,
            "desktop",
            "manager",
            PROFILE,
        );
        assert_eq!(
            result.unwrap_err(),
            SshForwardErrorCode::HostKeyChallengeExpired
        );
        assert_eq!(book.len(), 0);
    }
}
