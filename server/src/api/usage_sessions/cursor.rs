use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    error::AppError,
    telemetry::{
        privacy::HmacDigest,
        queries::{AgentRunCursor, AgentRunListQuery},
        AgentRunSummary, CodexModel,
    },
};

use super::{unavailable, ApiError};

const DAY_MS: i64 = 86_400_000;
const DEFAULT_RANGE_MS: i64 = 30 * DAY_MS;
const MAX_RANGE_MS: i64 = 5 * 365 * DAY_MS;
const DEFAULT_PAGE_SIZE: usize = 25;
const MAX_PAGE_SIZE: usize = 100;
const MAX_CURSOR_LEN: usize = 512;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SessionListParams {
    from: Option<i64>,
    to: Option<i64>,
    model: Option<String>,
    terminal: Option<String>,
    limit: Option<usize>,
    cursor: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CursorPayload {
    ended_at_utc_ms: i64,
    id: HmacDigest,
    from: i64,
    to: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CursorScope {
    model: Option<String>,
    terminal: Option<String>,
}

pub(super) fn parse_list_query(
    params: SessionListParams,
    now: i64,
) -> Result<(AgentRunListQuery, Option<String>, bool), ApiError> {
    let (from, to, explicit_range) = match (params.from, params.to) {
        (Some(from), Some(to)) => (from, to, true),
        (None, None) => (now.saturating_sub(DEFAULT_RANGE_MS), now, false),
        _ => return Err(invalid()),
    };
    if from < 0 || to <= from || to - from > MAX_RANGE_MS {
        return Err(invalid());
    }
    let limit = params.limit.unwrap_or(DEFAULT_PAGE_SIZE);
    if !(1..=MAX_PAGE_SIZE).contains(&limit) {
        return Err(invalid());
    }
    let model = params
        .model
        .map(CodexModel::new)
        .transpose()
        .map_err(|_| invalid())?;
    let terminal = params.terminal.map(parse_digest).transpose()?;
    Ok((
        AgentRunListQuery {
            from_utc_ms: from,
            to_utc_ms: to,
            model,
            terminal,
            cursor: None,
            limit,
        },
        params.cursor,
        explicit_range,
    ))
}

pub(super) fn decode_cursor(
    cursor: String,
    query: &AgentRunListQuery,
    explicit_range: bool,
    secret: &str,
) -> Result<(AgentRunCursor, i64, i64), ApiError> {
    if cursor.is_empty() || cursor.len() > MAX_CURSOR_LEN {
        return Err(invalid());
    }
    let bytes = URL_SAFE_NO_PAD.decode(cursor).map_err(|_| invalid())?;
    if bytes.len() <= 12 {
        return Err(invalid());
    }
    let (nonce, ciphertext) = bytes.split_at(12);
    let plaintext = cursor_cipher(secret)
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: &cursor_scope(query),
            },
        )
        .map_err(|_| invalid())?;
    let payload: CursorPayload = serde_json::from_slice(&plaintext).map_err(|_| invalid())?;
    if payload.ended_at_utc_ms < 0
        || payload.from < 0
        || payload.to <= payload.from
        || payload.to - payload.from > MAX_RANGE_MS
        || (explicit_range && (query.from_utc_ms != payload.from || query.to_utc_ms != payload.to))
    {
        return Err(invalid());
    }
    Ok((
        AgentRunCursor {
            ended_at_utc_ms: payload.ended_at_utc_ms,
            run_id: payload.id,
        },
        payload.from,
        payload.to,
    ))
}

pub(super) fn encode_cursor(
    root: &AgentRunSummary,
    query: &AgentRunListQuery,
    secret: &str,
) -> Result<String, ApiError> {
    let payload = CursorPayload {
        ended_at_utc_ms: root.ended_at_utc_ms.ok_or_else(invalid)?,
        id: root.run_id.clone(),
        from: query.from_utc_ms,
        to: query.to_utc_ms,
    };
    let plaintext = serde_json::to_vec(&payload).map_err(|_| unavailable())?;
    let mut nonce = [0_u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let ciphertext = cursor_cipher(secret)
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: &cursor_scope(query),
            },
        )
        .map_err(|_| unavailable())?;
    let mut encoded = nonce.to_vec();
    encoded.extend(ciphertext);
    Ok(URL_SAFE_NO_PAD.encode(encoded))
}

pub(super) fn parse_digest(value: String) -> Result<HmacDigest, ApiError> {
    value.try_into().map_err(|_| invalid())
}

fn cursor_scope(query: &AgentRunListQuery) -> Vec<u8> {
    serde_json::to_vec(&CursorScope {
        model: query.model.clone().map(String::from),
        terminal: query.terminal.clone().map(String::from),
    })
    .expect("cursor scope is serializable")
}

fn cursor_cipher(secret: &str) -> Aes256Gcm {
    let digest = Sha256::digest(format!("dam-hopper:usage-cursor:v1:{secret}").as_bytes());
    Aes256Gcm::new_from_slice(&digest).expect("SHA-256 produces an AES-256 key")
}

fn invalid() -> ApiError {
    ApiError::from_app(AppError::InvalidInput(
        "Invalid usage session request".to_string(),
    ))
}
