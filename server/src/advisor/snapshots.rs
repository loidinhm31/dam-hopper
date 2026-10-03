use std::collections::HashMap;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use crate::advisor::error::AdvisorError;
use crate::advisor::types::*;

pub const SNAPSHOT_TTL_MS: u64 = 5 * 60 * 1000; // 5 minutes
pub const MAX_SNAPSHOTS_PER_USER: usize = 2;
pub const MAX_PAGE_BYTES: usize = 1024 * 1024; // 1 MiB

type HmacSha256 = Hmac<Sha256>;

pub fn current_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn compute_query_hash(query: &HistoryQueryDto) -> String {
    let serialized = serde_json::to_string(query).unwrap_or_else(|_| "{}".to_string());
    let mut hasher = Sha256::new();
    hasher.update(serialized.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    hash[..16].to_string()
}

pub fn encode_cursor(
    secret: &[u8],
    snapshot_id: &str,
    query: &HistoryQueryDto,
    offset: usize,
) -> String {
    let query_hash = compute_query_hash(query);
    let payload = format!("{snapshot_id}:{query_hash}:{offset}");
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC can take any key size");
    mac.update(payload.as_bytes());
    let sig = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());

    let token = serde_json::json!({
        "s": snapshot_id,
        "q": query_hash,
        "o": offset,
        "sig": sig,
    });
    let token_str = serde_json::to_string(&token).unwrap_or_default();
    URL_SAFE_NO_PAD.encode(token_str.as_bytes())
}

pub fn decode_cursor(
    secret: &[u8],
    snapshot_id: &str,
    query: &HistoryQueryDto,
    cursor_str: &str,
) -> Result<usize, AdvisorError> {
    if cursor_str.is_empty() || cursor_str.len() > 256 {
        return Err(AdvisorError::CursorInvalid(
            "Cursor must be a non-empty string <= 256 characters".to_string(),
        ));
    }

    let decoded_bytes = URL_SAFE_NO_PAD
        .decode(cursor_str.as_bytes())
        .map_err(|_| AdvisorError::CursorInvalid("Malformed cursor token".to_string()))?;

    let parsed: serde_json::Value = serde_json::from_slice(&decoded_bytes)
        .map_err(|_| AdvisorError::CursorInvalid("Malformed cursor token".to_string()))?;

    let s = parsed.get("s").and_then(|v| v.as_str()).unwrap_or("");
    if s != snapshot_id {
        return Err(AdvisorError::CursorInvalid(
            "Cursor snapshot_id mismatch".to_string(),
        ));
    }

    let expected_query_hash = compute_query_hash(query);
    let q = parsed.get("q").and_then(|v| v.as_str()).unwrap_or("");
    if q != expected_query_hash {
        return Err(AdvisorError::CursorInvalid(
            "Cursor query scope mismatch".to_string(),
        ));
    }

    let offset = parsed
        .get("o")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| AdvisorError::CursorInvalid("Invalid offset in cursor".to_string()))?
        as usize;

    let sig = parsed.get("sig").and_then(|v| v.as_str()).unwrap_or("");
    let payload = format!("{s}:{q}:{offset}");
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC can take any key size");
    mac.update(payload.as_bytes());
    let expected_sig = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());

    if sig.as_bytes().ct_eq(expected_sig.as_bytes()).unwrap_u8() != 1 {
        return Err(AdvisorError::CursorInvalid(
            "Cursor signature verification failed".to_string(),
        ));
    }

    Ok(offset)
}

pub fn paginate_entries(
    secret: &[u8],
    snapshot: &HistorySnapshot,
    query: &HistoryQueryDto,
    cursor_str: Option<&str>,
    limit: Option<usize>,
) -> Result<HistoryPageResultDto, AdvisorError> {
    let clamped_limit = limit.unwrap_or(100).clamp(1, 500);

    let offset = match cursor_str {
        Some(c) => decode_cursor(secret, &snapshot.snapshot_id, query, c)?,
        None => 0,
    };

    let mut filtered: Vec<&HistoryRowDto> = snapshot
        .rows
        .iter()
        .filter(|r| {
            if let Some(target_pid) = &query.project_id {
                let pid_matches = r.project_id.eq_ignore_ascii_case(target_pid);
                let label_matches = snapshot
                    .inventory
                    .entries
                    .iter()
                    .any(|e| {
                        e.project_id.eq_ignore_ascii_case(&r.project_id)
                            && e.label
                                .as_deref()
                                .map(|l| l.eq_ignore_ascii_case(target_pid))
                                .unwrap_or(false)
                    });
                if !pid_matches && !label_matches {
                    return false;
                }
            }
            if let Some(target_tid) = &query.task_run_id {
                if !r.task_run_id.eq_ignore_ascii_case(target_tid) {
                    return false;
                }
            }
            if let Some(f) = &query.filters {
                if let Some(statuses) = &f.statuses {
                    if !statuses.is_empty() && !statuses.iter().any(|s| s == &r.status) {
                        return false;
                    }
                }
                if let Some(outcome_states) = &f.outcome_states {
                    if !outcome_states.is_empty()
                        && !outcome_states.iter().any(|s| s == &r.outcome_state)
                    {
                        return false;
                    }
                }
                if let Some(outcome_results) = &f.outcome_results {
                    if !outcome_results.is_empty() {
                        match &r.outcome_result {
                            Some(res) => {
                                if !outcome_results.iter().any(|o| o == res) {
                                    return false;
                                }
                            }
                            None => return false,
                        }
                    }
                }
                if let Some(backends) = &f.backends {
                    if !backends.is_empty() && !backends.iter().any(|b| b == &r.route.backend) {
                        return false;
                    }
                }
                if let Some(models) = &f.models {
                    if !models.is_empty() && !models.iter().any(|m| m == &r.route.model) {
                        return false;
                    }
                }
                if let Some(efforts) = &f.efforts {
                    if !efforts.is_empty() && !efforts.iter().any(|e| e == &r.route.effort) {
                        return false;
                    }
                }
                if let Some(prompts) = &f.prompt_identities {
                    if !prompts.is_empty() && !prompts.iter().any(|p| p == &r.prompt_identity) {
                        return false;
                    }
                }
                if let Some(builds) = &f.build_identities {
                    if !builds.is_empty() && !builds.iter().any(|b| b == &r.build_identity) {
                        return false;
                    }
                }
                if let Some(from) = f.started_at_from {
                    if r.started_at < from {
                        return false;
                    }
                }
                if let Some(to) = f.started_at_to {
                    if r.started_at > to {
                        return false;
                    }
                }
            }
            true
        })
        .collect();

    filtered.sort_by(|a, b| {
        b.started_at
            .cmp(&a.started_at)
            .then_with(|| a.project_id.cmp(&b.project_id))
            .then_with(|| a.task_run_id.cmp(&b.task_run_id))
            .then_with(|| a.consultation_id.cmp(&b.consultation_id))
    });

    let slice_start = offset.min(filtered.len());
    let slice_end = (offset + clamped_limit).min(filtered.len());
    let mut paged: Vec<HistoryRowDto> = filtered[slice_start..slice_end]
        .iter()
        .map(|&r| r.clone())
        .collect();

    while !paged.is_empty() {
        let bytes_len = serde_json::to_vec(&paged).map(|b| b.len()).unwrap_or(0);
        if bytes_len <= MAX_PAGE_BYTES {
            break;
        }
        paged.pop();
    }

    let next_offset = offset + paged.len();
    let next_cursor = if next_offset < filtered.len() {
        Some(encode_cursor(
            secret,
            &snapshot.snapshot_id,
            query,
            next_offset,
        ))
    } else {
        None
    };

    let returned_bytes = serde_json::to_vec(&paged).map(|b| b.len()).unwrap_or(0);

    Ok(HistoryPageResultDto {
        state: snapshot.state.clone(),
        snapshot_id: snapshot.snapshot_id.clone(),
        entries: paged,
        next_cursor,
        returned_bytes,
    })
}

pub struct SnapshotCache {
    snapshots: HashMap<String, HistorySnapshot>,
    user_snapshots: HashMap<String, Vec<String>>,
    secret: Vec<u8>,
}

impl SnapshotCache {
    pub fn new(secret: Vec<u8>) -> Self {
        let secret = if secret.is_empty() {
            let mut key = vec![0u8; 32];
            rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut key);
            key
        } else {
            secret
        };
        Self {
            snapshots: HashMap::new(),
            user_snapshots: HashMap::new(),
            secret,
        }
    }

    pub fn secret(&self) -> &[u8] {
        &self.secret
    }

    pub fn prune_expired(&mut self) {
        let now = current_time_ms();
        let mut expired_ids = Vec::new();
        for (id, snap) in &self.snapshots {
            if now.saturating_sub(snap.last_accessed_at) > SNAPSHOT_TTL_MS {
                expired_ids.push(id.clone());
            }
        }
        for id in expired_ids {
            self.remove_snapshot(&id);
        }
    }

    pub fn store_snapshot(&mut self, snapshot: HistorySnapshot) {
        self.prune_expired();
        let owner = snapshot.owner_subject.clone();
        let snapshot_id = snapshot.snapshot_id.clone();

        let user_list = self.user_snapshots.entry(owner.clone()).or_default();
        if user_list.len() >= MAX_SNAPSHOTS_PER_USER {
            let oldest_id = user_list.remove(0);
            self.snapshots.remove(&oldest_id);
        }
        user_list.push(snapshot_id.clone());
        self.snapshots.insert(snapshot_id, snapshot);
    }

    pub fn get_snapshot(
        &mut self,
        snapshot_id: &str,
        subject: &str,
    ) -> Result<&mut HistorySnapshot, AdvisorError> {
        self.prune_expired();
        let now = current_time_ms();
        let expired = match self.snapshots.get(snapshot_id) {
            None => return Err(AdvisorError::SnapshotNotFound(snapshot_id.to_string())),
            Some(snap) if snap.owner_subject != subject => {
                return Err(AdvisorError::SnapshotUserMismatch);
            }
            Some(snap) => now.saturating_sub(snap.last_accessed_at) > SNAPSHOT_TTL_MS,
        };

        if expired {
            self.remove_snapshot(snapshot_id);
            return Err(AdvisorError::SnapshotNotFound(snapshot_id.to_string()));
        }

        let snapshot = self.snapshots.get_mut(snapshot_id).expect("checked above");
        snapshot.last_accessed_at = now;
        Ok(snapshot)
    }

    pub fn remove_snapshot(&mut self, snapshot_id: &str) {
        if let Some(snap) = self.snapshots.remove(snapshot_id) {
            if let Some(list) = self.user_snapshots.get_mut(&snap.owner_subject) {
                list.retain(|id| id != snapshot_id);
            }
        }
    }

    pub fn clear_all(&mut self) {
        self.snapshots.clear();
        self.user_snapshots.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cursor_roundtrip_and_tamper_detection() {
        let secret = b"test-secret-key-1234567890123456";
        let query = HistoryQueryDto {
            project_id: Some("fd402c49f00afafeaaff0ee1e4fa3240d2ade14f74a454f8d709b85cc1d70998".to_string()),
            task_run_id: None,
            filters: None,
        };
        let cursor = encode_cursor(secret, "snap-01", &query, 5);
        assert!(!cursor.is_empty() && cursor.len() <= 256);

        let decoded = decode_cursor(secret, "snap-01", &query, &cursor).unwrap();
        assert_eq!(decoded, 5);

        // Snapshot mismatch
        let err_snap = decode_cursor(secret, "snap-02", &query, &cursor).unwrap_err();
        assert!(err_snap.to_string().contains("snapshot_id mismatch"));

        // Query mismatch
        let mut diff_query = query.clone();
        diff_query.project_id = Some("13aea919e60e23089352d6284e556087ee1441c73b9ac30c076010741051bd0c".to_string());
        let err_query = decode_cursor(secret, "snap-01", &diff_query, &cursor).unwrap_err();
        assert!(err_query.to_string().contains("query scope mismatch"));

        // Secret mismatch
        let wrong_secret = b"wrong-secret-key-123456789012345";
        let err_secret = decode_cursor(wrong_secret, "snap-01", &query, &cursor).unwrap_err();
        assert!(err_secret.to_string().contains("signature verification failed"));
    }

    #[test]
    fn test_snapshot_cache_limits_and_isolation() {
        let mut cache = SnapshotCache::new(b"secret".to_vec());
        let snap1 = HistorySnapshot {
            snapshot_id: "s1".to_string(),
            owner_subject: "alice".to_string(),
            state: "fresh".to_string(),
            observed_at: current_time_ms(),
            last_accessed_at: current_time_ms(),
            scan: HistoryScanSummaryDto {
                status: "complete".to_string(),
                projects_discovered: 0,
                tasks_discovered: 0,
                consultations_discovered: 0,
                accepted_records: 0,
                invalid_records: 0,
                bytes_discovered: 0,
                bytes_read: 0,
                diagnostics: vec![],
                suppressed_diagnostics: 0,
                limit_hit: false,
            },
            rows: vec![],
            raw_records: HashMap::new(),
            normalized_records: vec![],
            inventory: ProjectInventoryDto {
                entries: vec![],
                total_projects: 0,
                unfiltered_total_records: 0,
            },
        };

        let mut snap2 = snap1.clone();
        snap2.snapshot_id = "s2".to_string();
        let mut snap3 = snap1.clone();
        snap3.snapshot_id = "s3".to_string();

        cache.store_snapshot(snap1);
        cache.store_snapshot(snap2);
        // Alice has 2 snapshots: s1, s2
        assert!(cache.get_snapshot("s1", "alice").is_ok());

        // User isolation: Bob cannot access Alice's snapshot
        let bob_err = cache.get_snapshot("s1", "bob").unwrap_err();
        assert!(matches!(bob_err, AdvisorError::SnapshotUserMismatch));

        // Adding 3rd snapshot evicts oldest (s1)
        cache.store_snapshot(snap3);
        assert!(cache.get_snapshot("s1", "alice").is_err());
        assert!(cache.get_snapshot("s2", "alice").is_ok());
        assert!(cache.get_snapshot("s3", "alice").is_ok());

        // Clear all
        cache.clear_all();
        assert!(cache.get_snapshot("s2", "alice").is_err());
    }
}
