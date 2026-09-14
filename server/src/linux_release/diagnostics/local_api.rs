use std::future::Future;
use std::path::Path;
use std::time::Duration;
use reqwest::redirect::Policy;
use serde_json::Value;

use super::model::{
    Applicability, CollectionStatus, Historicity, SourceCoverage, SourceEnvelope,
    TypedCollectionError, COMMAND_DEADLINE_SECONDS, MAX_API_BODY_BYTES,
};

pub const LOCAL_API_STATUS_URL: &str = "http://127.0.0.1:4801/api/system/idle-suspend/v1/status";

#[derive(Debug, thiserror::Error)]
pub enum LocalApiError {
    #[error("token file missing: {0}")]
    TokenMissing(String),
    #[error("token file unreadable: {0}")]
    TokenUnreadable(String),
    #[error("authentication required (status {0})")]
    AuthRequired(u16),
    #[error("endpoint unavailable: {0}")]
    Unavailable(String),
    #[error("response exceeded maximum size {0} bytes")]
    OversizedBody(usize),
    #[error("malformed response json: {0}")]
    MalformedJson(String),
}

/// Abstract local API client trait for deterministic testing.
pub trait LocalIdleStatusClient: Send + Sync {
    fn fetch_status(
        &self,
        token_path: &Path,
    ) -> impl Future<Output = Result<(Value, usize), LocalApiError>> + Send;
}

/// Production implementation querying local HTTP endpoint.
#[derive(Debug, Default, Clone)]
pub struct ProductionLocalIdleStatusClient;

impl LocalIdleStatusClient for ProductionLocalIdleStatusClient {
    async fn fetch_status(
        &self,
        token_path: &Path,
    ) -> Result<(Value, usize), LocalApiError> {
        let token = match std::fs::read_to_string(token_path) {
            Ok(t) => {
                let trimmed = t.trim().to_string();
                if trimmed.is_empty() {
                    return Err(LocalApiError::TokenMissing("token file is empty".to_string()));
                }
                trimmed
            }
            Err(e) => {
                if e.kind() == std::io::ErrorKind::NotFound {
                    return Err(LocalApiError::TokenMissing("token file not found".to_string()));
                } else if e.kind() == std::io::ErrorKind::PermissionDenied {
                    return Err(LocalApiError::TokenUnreadable("permission denied reading token file".to_string()));
                } else {
                    return Err(LocalApiError::TokenUnreadable(e.to_string()));
                }
            }
        };

        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .timeout(Duration::from_secs(COMMAND_DEADLINE_SECONDS))
            .build()
            .map_err(|e| LocalApiError::Unavailable(e.to_string()))?;

        let request = client
            .get(LOCAL_API_STATUS_URL)
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/json");

        // Token dropped from memory immediately
        drop(token);

        let response = request
            .send()
            .await
            .map_err(|e| LocalApiError::Unavailable(e.to_string()))?;

        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(LocalApiError::AuthRequired(status.as_u16()));
        }

        if !status.is_success() {
            return Err(LocalApiError::Unavailable(format!("unexpected HTTP status: {status}")));
        }

        let mut body_bytes = Vec::new();
        let mut stream = response.bytes_stream();
        use futures_util::StreamExt;

        while let Some(chunk_res) = stream.next().await {
            let chunk = chunk_res.map_err(|e| LocalApiError::Unavailable(e.to_string()))?;
            if body_bytes.len() + chunk.len() > MAX_API_BODY_BYTES {
                return Err(LocalApiError::OversizedBody(body_bytes.len() + chunk.len()));
            }
            body_bytes.extend_from_slice(&chunk);
        }

        let byte_count = body_bytes.len();
        let val: Value = serde_json::from_slice(&body_bytes)
            .map_err(|e| LocalApiError::MalformedJson(e.to_string()))?;

        Ok((val, byte_count))
    }
}

/// Query local API idle status and wrap into a typed `SourceEnvelope`.
pub async fn query_local_idle_status<C: LocalIdleStatusClient>(
    client: &C,
    token_path: &Path,
    applicability: Applicability,
    coverage: SourceCoverage,
) -> SourceEnvelope<Option<Value>> {
    if applicability == Applicability::NotApplicable {
        return SourceEnvelope::empty(
            CollectionStatus::NotApplicable,
            Historicity::Latest,
            Applicability::NotApplicable,
            false,
            coverage,
        );
    }

    match client.fetch_status(token_path).await {
        Ok((val, byte_count)) => SourceEnvelope {
            collection_status: CollectionStatus::Available,
            historicity: Historicity::Latest,
            applicability: Applicability::Applicable,
            required_for_historical_completeness: false,
            record_count: 1,
            byte_count,
            malformed_count: 0,
            truncated: false,
            retention_limited: false,
            rotation_suspected: false,
            drop_suspected: false,
            coverage,
            errors: Vec::new(),
            records: Some(val),
        },
        Err(err) => {
            let (status, code, message) = match err {
                LocalApiError::TokenMissing(msg) => (CollectionStatus::AuthRequired, "tokenMissing", msg),
                LocalApiError::TokenUnreadable(msg) => (CollectionStatus::PermissionDenied, "tokenUnreadable", msg),
                LocalApiError::AuthRequired(_) => (CollectionStatus::AuthRequired, "authRequired", "API credentials refused or missing".to_string()),
                LocalApiError::Unavailable(msg) => (CollectionStatus::Missing, "endpointUnavailable", msg),
                LocalApiError::OversizedBody(_) => (CollectionStatus::Truncated, "bodyOversized", "API status body exceeded limit".to_string()),
                LocalApiError::MalformedJson(msg) => (CollectionStatus::Malformed, "malformedJson", msg),
            };

            SourceEnvelope {
                collection_status: status,
                historicity: Historicity::Latest,
                applicability: Applicability::Applicable,
                required_for_historical_completeness: false,
                record_count: 0,
                byte_count: 0,
                malformed_count: if status == CollectionStatus::Malformed { 1 } else { 0 },
                truncated: status == CollectionStatus::Truncated,
                retention_limited: false,
                rotation_suspected: false,
                drop_suspected: false,
                coverage,
                errors: vec![TypedCollectionError::new("idleStatus", code, message)],
                records: None,
            }
        }
    }
}
