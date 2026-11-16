use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use axum::http::StatusCode;
use axum::response::Response;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Utc};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

use super::auth::BrowserAdmission;
use super::cdp_gateway::{CdpGatewayManager, CdpGatewayPermit};
use crate::api::browser_host::browser_error_response;

pub const DEVTOOLS_LEASE_TTL: Duration = Duration::from_secs(300);
pub const MAX_LEASES_PER_PRINCIPAL: usize = 8;
pub const MAX_LEASES_GLOBAL: usize = 32;
pub const MAX_DEVTOOLS_CONNECTIONS: usize = 4;

static GLOBAL_DEVTOOLS_LEASES: LazyLock<DevToolsLeaseManager> =
    LazyLock::new(DevToolsLeaseManager::default);
static GLOBAL_DEVTOOLS_GATEWAY: LazyLock<CdpGatewayManager> =
    LazyLock::new(|| CdpGatewayManager::new(MAX_DEVTOOLS_CONNECTIONS));

pub fn global_devtools_leases() -> &'static DevToolsLeaseManager { &GLOBAL_DEVTOOLS_LEASES }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevToolsLeaseResponse {
    pub token: String,
    pub expires_at_unix_ms: i64,
    pub browser_session_id: String,
    pub browser_incarnation: String,
    pub profile_epoch: String,
}

#[derive(Debug, Clone)]
pub struct DevToolsLease {
    pub admission: BrowserAdmission,
    pub browser_session_id: String,
    pub native_target_id: String,
    pub browser_incarnation: String,
    pub profile_epoch: u64,
    pub expires_at: Instant,
    pub ws_active: bool,
    pub cancel: CancellationToken,
}

#[derive(Default)]
pub struct DevToolsLeaseManager {
    leases: RwLock<HashMap<[u8; 32], DevToolsLease>>,
}

fn hash_token(token: &str) -> [u8; 32] { Sha256::digest(token.as_bytes()).into() }

fn clipped_expiry(now: Instant, deadline: Option<DateTime<Utc>>) -> Option<(Instant, i64)> {
    let utc_now = Utc::now();
    let max_ttl = match deadline {
        Some(dl) => (dl - utc_now).to_std().ok().filter(|d| !d.is_zero())?,
        None => DEVTOOLS_LEASE_TTL,
    };
    let ttl = DEVTOOLS_LEASE_TTL.min(max_ttl);
    Some((now + ttl, utc_now.timestamp_millis() + ttl.as_millis() as i64))
}

fn retain_and_cancel<F: Fn(&DevToolsLease) -> bool>(map: &mut HashMap<[u8; 32], DevToolsLease>, keep: F) {
    map.retain(|_, lease| { let alive = keep(lease); if !alive { lease.cancel.cancel(); } alive });
}

fn prune_expired(map: &mut HashMap<[u8; 32], DevToolsLease>, now: Instant) {
    let utc_now = Utc::now();
    retain_and_cancel(map, |l| l.expires_at > now && l.admission.effective_deadline.is_none_or(|dl| utc_now < dl));
}

impl DevToolsLeaseManager {

    /// Mints a target-scoped DevTools capability token, storing only its SHA-256 hash.
    pub async fn mint(
        &self,
        admission: &BrowserAdmission,
        session_id: &str,
        target_id: &str,
        incarnation: &str,
        profile_epoch: u64,
    ) -> Result<DevToolsLeaseResponse, Response> {
        let now = Instant::now();
        let Some((expires_at, expires_at_unix_ms)) = clipped_expiry(now, admission.effective_deadline) else {
            return Err(browser_error_response(StatusCode::UNAUTHORIZED, "sessionExpired", "auth session deadline reached"));
        };
        let mut map = self.leases.write().await;
        prune_expired(&mut map, now);
        if map.len() >= MAX_LEASES_GLOBAL
            || map.values().filter(|l| l.admission.principal == admission.principal).count() >= MAX_LEASES_PER_PRINCIPAL
        {
            return Err(browser_error_response(StatusCode::TOO_MANY_REQUESTS, "tooManyDevToolsLeases", "DevTools lease capacity reached"));
        }
        let mut raw = [0u8; 32];
        OsRng.fill_bytes(&mut raw);
        let token = URL_SAFE_NO_PAD.encode(raw);
        map.insert(hash_token(&token), DevToolsLease {
            admission: admission.clone(),
            browser_session_id: session_id.to_string(),
            native_target_id: target_id.to_string(),
            browser_incarnation: incarnation.to_string(),
            profile_epoch,
            expires_at,
            ws_active: false,
            cancel: CancellationToken::new(),
        });
        Ok(DevToolsLeaseResponse {
            token,
            expires_at_unix_ms,
            browser_session_id: session_id.to_string(),
            browser_incarnation: incarnation.to_string(),
            profile_epoch: profile_epoch.to_string(),
        })
    }

    pub async fn resolve_and_refresh_asset(&self, token: &str) -> Option<DevToolsLease> {
        let now = Instant::now();
        let mut map = self.leases.write().await;
        prune_expired(&mut map, now);
        let lease = map.get_mut(&hash_token(token))?;
        lease.expires_at = clipped_expiry(now, lease.admission.effective_deadline)?.0;
        Some(lease.clone())
    }

    pub async fn claim_ws(&self, token: &str) -> Result<([u8; 32], DevToolsLease, CdpGatewayPermit), StatusCode> {
        let now = Instant::now();
        let hash = hash_token(token);
        let mut map = self.leases.write().await;
        prune_expired(&mut map, now);
        let lease = map.get_mut(&hash).ok_or(StatusCode::UNAUTHORIZED)?;
        if lease.ws_active {
            return Err(StatusCode::CONFLICT);
        }
        let next_exp = clipped_expiry(now, lease.admission.effective_deadline)
            .ok_or(StatusCode::UNAUTHORIZED)?
            .0;
        let permit = GLOBAL_DEVTOOLS_GATEWAY.try_acquire_with_limit(MAX_DEVTOOLS_CONNECTIONS)?;
        lease.expires_at = next_exp;
        lease.ws_active = true;
        Ok((hash, lease.clone(), permit))
    }

    pub async fn refresh_ws(&self, hash: &[u8; 32]) -> bool {
        let now = Instant::now();
        let mut map = self.leases.write().await;
        let Some(lease) = map.get_mut(hash) else { return false; };
        let Some((next_exp, _)) = clipped_expiry(now, lease.admission.effective_deadline) else {
            lease.cancel.cancel();
            map.remove(hash);
            return false;
        };
        lease.expires_at = next_exp;
        true
    }

    pub async fn revoke_by_token(&self, principal: &str, session_id: &str, token: &str) -> bool {
        let hash = hash_token(token);
        let mut map = self.leases.write().await;
        if map.get(&hash).is_some_and(|l| l.admission.principal == principal && l.browser_session_id == session_id) {
            if let Some(lease) = map.remove(&hash) { lease.cancel.cancel(); }
            return true;
        }
        false
    }

    pub async fn revoke_by_hash(&self, hash: &[u8; 32]) {
        if let Some(lease) = self.leases.write().await.remove(hash) { lease.cancel.cancel(); }
    }

    pub async fn revoke_by_browser_session(&self, session_id: &str) {
        retain_and_cancel(&mut *self.leases.write().await, |l| l.browser_session_id != session_id);
    }

    pub async fn revoke_by_auth_session(&self, principal: &str, auth_session_id: &str) {
        retain_and_cancel(&mut *self.leases.write().await, |l| {
            !(l.admission.principal == principal && l.admission.session_id.as_deref() == Some(auth_session_id))
        });
    }

    pub async fn revoke_all_for_principal(&self, principal: &str) {
        retain_and_cancel(&mut *self.leases.write().await, |l| l.admission.principal != principal);
    }
}
