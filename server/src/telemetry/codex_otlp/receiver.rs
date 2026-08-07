use std::{io, net::SocketAddr, path::PathBuf, sync::Arc};

use axum::{
    body::Bytes,
    extract::State,
    http::{header::AUTHORIZATION, header::CONTENT_TYPE, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::post,
    Router,
};
use subtle::ConstantTimeEq;
use tokio::sync::watch;

use crate::{
    config::TelemetryCollectorConfig,
    telemetry::{
        worker::{TelemetryEnqueue, TelemetryHandle},
        TelemetryKeyRing,
    },
};

use super::{
    decoder::{decode_response_completed, TokenCoverage},
    health::CollectorHealth,
    normalizer::{normalize, NormalizationDropReason},
    secret::{default_secret_path, load_or_create_secret},
};

const MAX_REQUEST_BYTES: usize = 1024 * 1024;
pub struct CollectorHandle {
    shutdown: watch::Sender<bool>,
    task: tokio::task::JoinHandle<()>,
    #[cfg(test)]
    address: SocketAddr,
}

impl CollectorHandle {
    pub async fn stop(self) {
        let _ = self.shutdown.send(true);
        let _ = self.task.await;
    }

    #[cfg(test)]
    pub(crate) fn address(&self) -> SocketAddr {
        self.address
    }
}

#[derive(Clone)]
struct ReceiverState {
    secret: Arc<String>,
    keys: Arc<TelemetryKeyRing>,
    telemetry: TelemetryHandle,
    health: CollectorHealth,
}

pub async fn start_collector(
    config: &TelemetryCollectorConfig,
    telemetry: &TelemetryHandle,
    health: CollectorHealth,
) -> io::Result<CollectorHandle> {
    start_collector_at(config, telemetry, health, default_secret_path()?).await
}

pub(crate) async fn start_collector_at(
    config: &TelemetryCollectorConfig,
    telemetry: &TelemetryHandle,
    health: CollectorHealth,
    secret_path: PathBuf,
) -> io::Result<CollectorHandle> {
    if !config.enabled {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "collector is disabled",
        ));
    }
    let host: std::net::IpAddr = config
        .host
        .parse()
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "collector host is invalid"))?;
    if !host.is_loopback() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "collector host is not loopback",
        ));
    }
    if telemetry.command_tx.is_none() {
        return Err(io::Error::new(
            io::ErrorKind::NotConnected,
            "telemetry worker unavailable",
        ));
    }
    let keys = telemetry
        .hmac_keys
        .clone()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotConnected, "telemetry key unavailable"))?;
    let listener = tokio::net::TcpListener::bind(SocketAddr::new(host, config.port)).await?;
    #[cfg(test)]
    let address = listener.local_addr()?;
    let secret = Arc::new(load_or_create_secret(secret_path)?);
    let receiver_state = ReceiverState {
        secret,
        keys,
        telemetry: telemetry.clone(),
        health: health.clone(),
    };
    let app = Router::new()
        .route("/v1/logs", post(receive))
        .layer(axum::extract::DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(receiver_state);
    let (shutdown, mut shutdown_rx) = watch::channel(false);
    health.running(true);
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.changed().await;
            })
            .await;
        health.running(false);
    });
    Ok(CollectorHandle {
        shutdown,
        task,
        #[cfg(test)]
        address,
    })
}

async fn receive(
    State(state): State<ReceiverState>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    if !authorized(&headers, &state.secret) {
        state.health.rejected();
        return StatusCode::UNAUTHORIZED;
    }
    if !is_protobuf(&headers) {
        state.health.rejected();
        return StatusCode::UNSUPPORTED_MEDIA_TYPE;
    }
    let decoded = match decode_response_completed(&body) {
        Ok(events) => events,
        Err(_) => {
            state.health.malformed();
            return StatusCode::BAD_REQUEST;
        }
    };
    let now = chrono::Utc::now().timestamp_millis();
    let mut queued_any = false;
    for decoded in decoded {
        record_compatibility_health(&state.health, &decoded);
        let event = match normalize(decoded, &state.keys, now) {
            Ok(event) => event,
            Err(NormalizationDropReason::InvalidTimestamp) => {
                state.health.dropped_invalid_timestamp();
                state.health.dropped();
                continue;
            }
        };
        match state.telemetry.try_record_codex_usage(event) {
            // A 202 means the record crossed the bounded receiver-to-worker
            // handoff. SQLite dedupe makes an exporter retry safe if a later
            // record in this request cannot enter that queue.
            TelemetryEnqueue::Queued => {
                state.health.queued();
                queued_any = true;
            }
            // Pausing is an explicit local control, so acknowledge the
            // intentionally discarded record without prompting retries.
            TelemetryEnqueue::Paused => {
                state.health.dropped_paused();
                state.health.dropped();
            }
            // A full/disconnected handoff has not accepted this event. Return
            // a retryable status rather than silently turning it into loss.
            TelemetryEnqueue::Dropped => {
                state.health.dropped_queue_full();
                state.health.dropped();
                if queued_any {
                    state.health.accepted(now);
                }
                return StatusCode::SERVICE_UNAVAILABLE;
            }
            TelemetryEnqueue::Unavailable => {
                state.health.dropped_worker_unavailable();
                state.health.dropped();
                if queued_any {
                    state.health.accepted(now);
                }
                return StatusCode::SERVICE_UNAVAILABLE;
            }
        }
    }
    if queued_any {
        state.health.accepted(now);
    }
    StatusCode::ACCEPTED
}

fn record_compatibility_health(
    health: &CollectorHealth,
    decoded: &super::decoder::DecodedCodexUsage,
) {
    if decoded.unverified_version {
        health.unverified_version();
    }
    match decoded.token_coverage {
        TokenCoverage::Full => {}
        TokenCoverage::Partial => health.core_schema_drift(),
        TokenCoverage::Unavailable => {
            health.core_schema_drift();
            health.unavailable_token_coverage();
        }
    }
}

fn authorized(headers: &HeaderMap, secret: &str) -> bool {
    let Some(value) = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let Some(value) = value.strip_prefix("Bearer ") else {
        return false;
    };
    value.as_bytes().ct_eq(secret.as_bytes()).into()
}

fn is_protobuf(headers: &HeaderMap) -> bool {
    headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.split(';').next() == Some("application/x-protobuf"))
}
