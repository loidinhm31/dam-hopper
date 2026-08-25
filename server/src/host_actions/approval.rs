use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use uuid::Uuid;

use super::types::{
    ActionIntentRequest, ActionPreview, HostAction, HostActionError, IntentChallenge,
};

pub(super) const CHALLENGE_TTL: Duration = Duration::from_secs(120);
pub(super) const APPROVAL_TTL: Duration = Duration::from_secs(60);

#[derive(Clone)]
pub(crate) struct ApprovedIntent {
    pub id: String,
    pub actor: String,
    pub action: HostAction,
    pub sample_id: String,
    pub alert_id: Option<String>,
}

struct PendingIntent {
    approved: ApprovedIntent,
    challenge_nonce: String,
    challenge_expires: Instant,
    canonical_digest: [u8; 32],
    approval_hash: Option<[u8; 32]>,
    approval_expires: Option<Instant>,
}

#[derive(Default)]
pub(super) struct ApprovalStore {
    intents: HashMap<String, PendingIntent>,
}

impl ApprovalStore {
    pub fn create(
        &mut self,
        actor: String,
        request: ActionIntentRequest,
        now_ms: u64,
    ) -> Result<IntentChallenge, HostActionError> {
        self.reap_expired();
        if self.intents.len() >= 256
            || self
                .intents
                .values()
                .filter(|item| item.approved.actor == actor)
                .count()
                >= 32
        {
            return Err(HostActionError::IntentLimit);
        }
        let id = Uuid::new_v4().to_string();
        let nonce = random_hex();
        let expires_at = now_ms.saturating_add(CHALLENGE_TTL.as_millis() as u64);
        let action = request.action;
        let approved = ApprovedIntent {
            id: id.clone(),
            actor,
            action: action.clone(),
            sample_id: request.sample_id,
            alert_id: request.alert_id,
        };
        let canonical_digest = canonical_digest(&approved, &nonce, expires_at);
        self.intents.insert(
            id.clone(),
            PendingIntent {
                approved,
                challenge_nonce: nonce.clone(),
                challenge_expires: Instant::now() + CHALLENGE_TTL,
                canonical_digest,
                approval_hash: None,
                approval_expires: None,
            },
        );
        Ok(IntentChallenge {
            intent_id: id,
            challenge_nonce: nonce,
            expires_at,
            preview: ActionPreview {
                warning: matches!(action, HostAction::DropCleanCaches).then(|| {
                    "Drops clean caches globally after helper-side sync; cooldown applies.".into()
                }),
                action,
            },
        })
    }

    pub fn approve(
        &mut self,
        actor: &str,
        intent_id: &str,
        challenge_nonce: &str,
        now_ms: u64,
    ) -> Result<(String, u64), HostActionError> {
        self.reap_expired();
        let intent = self
            .intents
            .get_mut(intent_id)
            .ok_or(HostActionError::IntentExpired)?;
        if intent.approved.actor != actor
            || intent.challenge_expires <= Instant::now()
            || !constant_time_eq(
                intent.challenge_nonce.as_bytes(),
                challenge_nonce.as_bytes(),
            )
        {
            return Err(HostActionError::InvalidApproval);
        }
        let token = random_hex();
        intent.approval_hash = Some(token_hash(&token, &intent.canonical_digest));
        intent.approval_expires = Some(Instant::now() + APPROVAL_TTL);
        Ok((
            token,
            now_ms.saturating_add(APPROVAL_TTL.as_millis() as u64),
        ))
    }

    pub fn consume(
        &mut self,
        actor: &str,
        intent_id: &str,
        token: &str,
    ) -> Result<ApprovedIntent, HostActionError> {
        self.reap_expired();
        let valid = self
            .intents
            .get(intent_id)
            .ok_or(HostActionError::IntentExpired)?;
        let accepted = valid.approved.actor == actor
            && valid
                .approval_expires
                .is_some_and(|expiry| expiry > Instant::now())
            && valid.approval_hash.is_some_and(|hash| {
                constant_time_eq(&hash, &token_hash(token, &valid.canonical_digest))
            });
        if !accepted {
            return Err(HostActionError::InvalidApproval);
        }
        Ok(self
            .intents
            .remove(intent_id)
            .expect("validated intent disappeared")
            .approved)
    }

    fn reap_expired(&mut self) {
        let now = Instant::now();
        self.intents.retain(|_, item| {
            item.challenge_expires > now && item.approval_expires.is_none_or(|expiry| expiry > now)
        });
    }

    #[cfg(test)]
    pub fn expire_all_for_tests(&mut self) {
        for intent in self.intents.values_mut() {
            intent.challenge_expires = Instant::now() - Duration::from_secs(1);
            intent.approval_expires = Some(Instant::now() - Duration::from_secs(1));
        }
    }
}

fn random_hex() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub(super) fn token_hash(value: &str, digest: &[u8; 32]) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(value.as_bytes());
    hash.update(digest);
    hash.finalize().into()
}

fn canonical_digest(intent: &ApprovedIntent, nonce: &str, expires_at: u64) -> [u8; 32] {
    let action =
        serde_json::to_vec(&intent.action).expect("host action serialization is infallible");
    let mut hash = Sha256::new();
    for part in [
        intent.actor.as_bytes(),
        &action,
        intent.sample_id.as_bytes(),
        intent.alert_id.as_deref().unwrap_or("").as_bytes(),
        intent.id.as_bytes(),
        nonce.as_bytes(),
        &expires_at.to_le_bytes(),
    ] {
        hash.update((part.len() as u64).to_le_bytes());
        hash.update(part);
    }
    hash.finalize().into()
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len() && left.ct_eq(right).into()
}
