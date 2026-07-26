use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Query, State},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    config::{write_config, TelemetryCollectorConfig},
    error::AppError,
    state::AppState,
    telemetry::{
        queries::{
            add_tokens, add_usage, aggregate_command_dimensions, aggregate_command_rollups,
            aggregate_commands, aggregate_detail_metrics, aggregate_token_correlation,
            aggregate_token_rollups, aggregate_tokens, aggregate_usage_series, health_value,
            DetailUsageMetrics, TokenAggregate, UsageAggregate, UsageDimension,
            UsageDimensionAggregate, UsageTimeBucket,
        },
        CaptureQuality, CodexModel, SafeIdentifier, ShellKind, TelemetryCmd, TelemetryStore,
        UsageQuery, TELEMETRY_SCHEMA_VERSION,
    },
};

use super::error::ApiError;

const HOUR_MS: i64 = 3_600_000;
const DAY_MS: i64 = 86_400_000;
const MAX_HOURLY_RANGE_MS: i64 = 90 * DAY_MS;
const MAX_DAILY_RANGE_MS: i64 = 5 * 365 * DAY_MS;
const DELETE_CONFIRMATION: &str = "delete-usage-data";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryParams {
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub window: Option<String>,
    pub bucket: Option<String>,
    pub project: Option<String>,
    pub shell: Option<String>,
    pub capture_quality: Option<String>,
    pub category: Option<String>,
    pub agent: Option<String>,
    pub model: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SummaryResponse {
    range: UsageRange,
    terminal: UsageAggregate,
    codex: Option<TokenAggregate>,
    time_series: Vec<UsageTimeBucket>,
    categories: Vec<UsageDimensionAggregate>,
    projects: Vec<UsageDimensionAggregate>,
    detail_metrics: Option<DetailUsageMetrics>,
    coverage: Coverage,
    health: Health,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageRange {
    from: i64,
    to: i64,
    bucket: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Coverage {
    detail_only: bool,
    capture_quality_filter: Option<String>,
    codex_correlation: Option<crate::telemetry::queries::CorrelationCoverage>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Health {
    available: bool,
    paused: bool,
    writer_errors: u64,
    rejected_events: u64,
    sampled_at: i64,
    collector: crate::telemetry::codex_otlp::CollectorHealthSnapshot,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsResponse {
    enabled: bool,
    paused: bool,
    detail_retention_days: u16,
    aggregate_retention_days: Option<u32>,
    excluded_projects: Vec<String>,
    collector: TelemetryCollectorConfig,
    collector_setup: CollectorSetup,
    runtime: crate::telemetry::TelemetryRuntimeStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CollectorSetup {
    endpoint: String,
    authorization: String,
    restart_required: bool,
    managed_config: bool,
    server_restart_required: bool,
    baseline_fixture_version: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub enabled: Option<bool>,
    pub paused: Option<bool>,
    pub detail_retention_days: Option<u16>,
    pub aggregate_retention_days: Option<Option<u32>>,
    pub excluded_projects: Option<Vec<String>>,
    pub collector: Option<TelemetryCollectorConfig>,
}

#[derive(Deserialize)]
pub struct DeleteRequest {
    confirmation: String,
    from: Option<i64>,
    to: Option<i64>,
}

pub async fn summary(
    State(state): State<AppState>,
    Query(params): Query<SummaryParams>,
) -> Result<impl IntoResponse, ApiError> {
    let _coordination = state.telemetry_coordinator.lock().await;
    let (query, range) = parse_query(&state, params).await?;
    let telemetry = state
        .telemetry
        .read()
        .expect("telemetry state lock poisoned")
        .clone();
    let Some(store) = telemetry.store else {
        return Err(unavailable());
    };
    let detail_retention_days = state
        .config
        .read()
        .await
        .server
        .telemetry
        .detail_retention_days;
    let boundary = detail_boundary(now_ms(), detail_retention_days);
    if range.from < boundary
        && (range.bucket != "day"
            || range.from.rem_euclid(DAY_MS) != 0
            || query.capture_quality.is_some())
    {
        return Err(invalid());
    }
    let mut detail_query = query.clone();
    detail_query.from_utc_ms = Some(detail_query.from_utc_ms.unwrap_or(boundary).max(boundary));
    let terminal = add_usage(
        aggregate_commands(&store, &detail_query).map_err(store_error)?,
        aggregate_command_rollups(&store, &query, boundary).map_err(store_error)?,
    );
    let codex_available = query.project.is_none()
        && query.shell.is_none()
        && query.capture_quality.is_none()
        && query.category.is_none();
    let codex = if !codex_available {
        None
    } else {
        add_tokens(
            aggregate_tokens(&store, &detail_query).map_err(store_error)?,
            aggregate_token_rollups(&store, &query, boundary).map_err(store_error)?,
        )
    };
    let detail_only = range.from >= boundary;
    let bucket_ms = if range.bucket == "hour" {
        HOUR_MS
    } else {
        DAY_MS
    };
    let time_series = fill_usage_series(
        aggregate_usage_series(&store, &detail_query, &query, boundary, bucket_ms)
            .map_err(store_error)?,
        range.from,
        range.to,
        bucket_ms,
    );
    let time_series = if codex_available {
        time_series
    } else {
        time_series
            .into_iter()
            .map(|mut point| {
                point.codex = None;
                point
            })
            .collect()
    };
    let categories = aggregate_command_dimensions(
        &store,
        &detail_query,
        &query,
        boundary,
        UsageDimension::Category,
    )
    .map_err(store_error)?;
    let projects = aggregate_command_dimensions(
        &store,
        &detail_query,
        &query,
        boundary,
        UsageDimension::Project,
    )
    .map_err(store_error)?;
    let detail_metrics = detail_only
        .then(|| aggregate_detail_metrics(&store, &detail_query))
        .transpose()
        .map_err(store_error)?;
    // Daily rollups intentionally omit correlation detail. Null is more honest
    // than suggesting historical usage was exclusively unattributed.
    let codex_correlation = if detail_only && codex.is_some() {
        aggregate_token_correlation(&store, &detail_query).map_err(store_error)?
    } else {
        None
    };
    let mut collector = state.telemetry_runtime.status().collector;
    collector.duplicate = health_value(&store, "collector_duplicates").map_err(store_error)?;
    let health = Health {
        available: true,
        paused: !telemetry.control.is_enabled(),
        writer_errors: health_value(&store, "writer_errors").map_err(store_error)?,
        rejected_events: telemetry.control.rejected_count(),
        sampled_at: now_ms(),
        collector,
    };
    Ok(Json(SummaryResponse {
        range,
        terminal,
        codex,
        time_series,
        categories,
        projects,
        detail_metrics,
        coverage: Coverage {
            detail_only,
            capture_quality_filter: query.capture_quality.map(quality_name).map(str::to_string),
            codex_correlation,
        },
        health,
    }))
}

pub async fn health(State(state): State<AppState>) -> Result<impl IntoResponse, ApiError> {
    let _coordination = state.telemetry_coordinator.lock().await;
    let telemetry = state
        .telemetry
        .read()
        .expect("telemetry state lock poisoned")
        .clone();
    let writer_errors = telemetry
        .store
        .as_ref()
        .map(|store| health_value(store, "writer_errors"))
        .transpose()
        .map_err(store_error)?
        .unwrap_or(0);
    let mut collector = state.telemetry_runtime.status().collector;
    collector.duplicate = telemetry
        .store
        .as_ref()
        .map(|store| health_value(store, "collector_duplicates"))
        .transpose()
        .map_err(store_error)?
        .unwrap_or(0);
    Ok(Json(Health {
        available: telemetry.store.is_some(),
        paused: !telemetry.control.is_enabled(),
        writer_errors,
        rejected_events: telemetry.control.rejected_count(),
        sampled_at: now_ms(),
        collector,
    }))
}

pub async fn get_settings(State(state): State<AppState>) -> impl IntoResponse {
    let _coordination = state.telemetry_coordinator.lock().await;
    let telemetry = state.config.read().await.server.telemetry.clone();
    Json(settings_response(
        telemetry,
        state.telemetry_runtime.status(),
    ))
}

pub async fn update_settings(
    State(state): State<AppState>,
    Json(patch): Json<SettingsPatch>,
) -> Result<impl IntoResponse, ApiError> {
    let _coordination = state.telemetry_coordinator.lock().await;
    let mut config = state.config.read().await.clone();
    {
        let telemetry = &mut config.server.telemetry;
        if let Some(enabled) = patch.enabled {
            telemetry.enabled = enabled;
        }
        if let Some(paused) = patch.paused {
            telemetry.paused = paused;
        }
        if let Some(days) = patch.detail_retention_days {
            telemetry.detail_retention_days = days;
        }
        if let Some(days) = patch.aggregate_retention_days {
            telemetry.aggregate_retention_days = days;
        }
        if let Some(projects) = patch.excluded_projects {
            telemetry.excluded_projects = projects;
        }
        if let Some(collector) = patch.collector {
            telemetry.collector = collector;
        }
        telemetry.validate().map_err(|_| invalid())?;
    }

    let previous = state.config.read().await.clone();
    state
        .telemetry_runtime
        .apply_config(&previous.server.telemetry, &config.server.telemetry)
        .await
        .map_err(runtime_error)?;
    // The runtime transition succeeds before configuration is published. If the
    // atomic disk write fails, restore the previous live state before replying.
    if let Err(error) = write_config(&config.config_path, &config) {
        state
            .telemetry_runtime
            .restore_config(&previous.server.telemetry, &config.server.telemetry)
            .await;
        return Err(ApiError::from_app(error));
    }
    *state.config.write().await = config.clone();
    Ok(Json(settings_response(
        config.server.telemetry,
        state.telemetry_runtime.status(),
    )))
}

pub async fn delete_all(
    State(state): State<AppState>,
    Json(body): Json<DeleteRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let _coordination = state.telemetry_coordinator.lock().await;
    let DeleteRequest {
        confirmation,
        from,
        to,
    } = body;
    if confirmation != DELETE_CONFIRMATION {
        return Err(invalid());
    }
    let range = parse_delete_range(from, to)?;
    let telemetry = state
        .telemetry
        .read()
        .expect("telemetry state lock poisoned")
        .clone();
    let store = match telemetry.store.as_ref() {
        Some(store) => store.clone(),
        None => {
            let path = telemetry_path(&state.config.read().await.server.telemetry.db_path);
            std::sync::Arc::new(TelemetryStore::open(&path).map_err(store_error)?)
        }
    };
    // Pause first, then wait for a worker-ordered deletion barrier. The queued
    // commands before this request are flushed before deletion; new capture is
    // rejected until the final persisted pause state is read below.
    let paused = state.config.read().await.server.telemetry.paused;
    let deletion_telemetry = telemetry.clone();
    let deletion_store = store.clone();
    tokio::task::spawn_blocking(move || {
        deletion_telemetry.control.with_exclusive_admission(|| {
            deletion_telemetry.control.set_enabled(false);
            execute_delete(&deletion_telemetry, &deletion_store, range).and_then(|_| {
                if range.is_none() {
                    deletion_telemetry
                        .hmac_keys
                        .as_ref()
                        .map_or(Ok(()), |keys| {
                            keys.rotate_after_delete().map_err(Into::into)
                        })
                } else {
                    Ok(())
                }
            })
        })
    })
    .await
    .map_err(|_| unavailable())?
    .map_err(store_error)?;
    telemetry.control.set_enabled(!paused);
    Ok(Json(serde_json::json!({ "deleted": true })))
}

fn settings_response(
    telemetry: crate::config::TelemetryConfig,
    runtime: crate::telemetry::TelemetryRuntimeStatus,
) -> SettingsResponse {
    let endpoint = format!(
        "http://{}:{}/v1/logs",
        telemetry.collector.host, telemetry.collector.port
    );
    SettingsResponse {
        enabled: telemetry.enabled,
        paused: telemetry.paused,
        detail_retention_days: telemetry.detail_retention_days,
        aggregate_retention_days: telemetry.aggregate_retention_days,
        excluded_projects: telemetry.excluded_projects,
        collector: telemetry.collector,
        runtime,
        collector_setup: CollectorSetup {
            endpoint,
            authorization: "Bearer <DAM_HOPPER_OTLP_TOKEN>".to_string(),
            restart_required: true,
            managed_config: false,
            server_restart_required: false,
            baseline_fixture_version: "0.145.0".to_string(),
        },
    }
}

async fn parse_query(
    state: &AppState,
    params: SummaryParams,
) -> Result<(UsageQuery, UsageRange), ApiError> {
    let now = now_ms();
    let (from, to) = match (params.from, params.to, params.window.as_deref()) {
        (Some(from), Some(to), _) => (from, to),
        (None, None, Some("7d")) => (now - 7 * DAY_MS, now),
        (None, None, Some("30d")) => (now - 30 * DAY_MS, now),
        (None, None, Some("24h") | None) => (now - DAY_MS, now),
        _ => return Err(invalid()),
    };
    let bucket = params.bucket.unwrap_or_else(|| {
        if to - from > 7 * DAY_MS {
            "day".to_string()
        } else {
            "hour".to_string()
        }
    });
    let max_range = match bucket.as_str() {
        "hour" => MAX_HOURLY_RANGE_MS,
        "day" => MAX_DAILY_RANGE_MS,
        _ => return Err(invalid()),
    };
    if from < 0
        || to <= from
        || to - from > max_range
        || (to - from) / if bucket == "hour" { HOUR_MS } else { DAY_MS } > 1_000
    {
        return Err(invalid());
    }
    let project = bounded(params.project)?;
    if let Some(project) = &project {
        let exists = state
            .config
            .read()
            .await
            .projects
            .iter()
            .any(|item| item.name == project.as_str());
        if !exists {
            return Err(invalid());
        }
    }
    let shell = parse_enum(params.shell, |value| match value {
        "bash" => Some(ShellKind::Bash),
        "zsh" => Some(ShellKind::Zsh),
        "fish" => Some(ShellKind::Fish),
        _ => None,
    })?;
    let capture_quality = parse_enum(params.capture_quality, |value| match value {
        "rich" => Some(CaptureQuality::Rich),
        "partial" => Some(CaptureQuality::Partial),
        "unavailable" => Some(CaptureQuality::Unavailable),
        _ => None,
    })?;
    let model = match params.model {
        Some(value) => Some(CodexModel::new(value).map_err(|_| invalid())?),
        None => None,
    };
    let agent = bounded(params.agent)?;
    if agent
        .as_ref()
        .is_some_and(|value| value.as_str() != "codex")
    {
        return Err(invalid());
    }
    Ok((
        UsageQuery {
            schema_version: TELEMETRY_SCHEMA_VERSION,
            from_utc_ms: Some(from),
            to_utc_ms: Some(to),
            project,
            shell,
            capture_quality,
            category: bounded(params.category)?,
            agent,
            model,
        },
        UsageRange { from, to, bucket },
    ))
}

fn bounded(value: Option<String>) -> Result<Option<SafeIdentifier>, ApiError> {
    value
        .map(|value| SafeIdentifier::new(value).map_err(|_| invalid()))
        .transpose()
}
fn parse_enum<T>(
    value: Option<String>,
    parser: impl FnOnce(&str) -> Option<T>,
) -> Result<Option<T>, ApiError> {
    value
        .map(|value| parser(&value).ok_or_else(invalid))
        .transpose()
}
fn quality_name(value: CaptureQuality) -> &'static str {
    match value {
        CaptureQuality::Rich => "rich",
        CaptureQuality::Partial => "partial",
        CaptureQuality::Unavailable => "unavailable",
    }
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
fn detail_boundary(now: i64, retention_days: u16) -> i64 {
    let raw = now.saturating_sub(i64::from(retention_days) * DAY_MS);
    raw - raw.rem_euclid(DAY_MS)
}

fn fill_usage_series(
    points: Vec<UsageTimeBucket>,
    from: i64,
    to: i64,
    bucket_ms: i64,
) -> Vec<UsageTimeBucket> {
    let mut points = points.into_iter().peekable();
    let mut start = from - from.rem_euclid(bucket_ms);
    let mut filled = Vec::new();
    while start < to {
        if points
            .peek()
            .is_some_and(|point| point.start_utc_ms == start)
        {
            filled.push(points.next().expect("peeked usage series point"));
        } else {
            filled.push(UsageTimeBucket {
                start_utc_ms: start,
                ..UsageTimeBucket::default()
            });
        }
        start = start.saturating_add(bucket_ms);
    }
    filled
}
fn parse_delete_range(from: Option<i64>, to: Option<i64>) -> Result<Option<(i64, i64)>, ApiError> {
    match (from, to) {
        (None, None) => Ok(None),
        (Some(from), Some(to))
            if from >= 0
                && to > from
                && to - from <= MAX_DAILY_RANGE_MS
                && from.rem_euclid(DAY_MS) == 0
                && to.rem_euclid(DAY_MS) == 0 =>
        {
            Ok(Some((from, to)))
        }
        _ => Err(invalid()),
    }
}
fn execute_delete(
    telemetry: &crate::telemetry::worker::TelemetryHandle,
    store: &TelemetryStore,
    range: Option<(i64, i64)>,
) -> Result<(), crate::telemetry::store::TelemetryStoreError> {
    let (from, to) = range.map_or((None, None), |(from, to)| (Some(from), Some(to)));
    if let Some(sender) = &telemetry.command_tx {
        let (completion_tx, completion_rx) = std::sync::mpsc::sync_channel(1);
        sender
            .send(TelemetryCmd::Delete {
                from_utc_ms: from,
                to_utc_ms: to,
                completion: completion_tx,
            })
            .map_err(|_| {
                crate::telemetry::store::TelemetryStoreError::Io(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "telemetry worker unavailable",
                ))
            })?;
        return completion_rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .map_err(|_| {
                crate::telemetry::store::TelemetryStoreError::Io(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "telemetry deletion timed out",
                ))
            })?
            .map_err(|error| {
                crate::telemetry::store::TelemetryStoreError::Io(std::io::Error::other(error))
            });
    }
    store
        .delete_range(from, to)
        .and_then(|_| store.checkpoint())
}
fn telemetry_path(value: &str) -> std::path::PathBuf {
    value
        .strip_prefix("~/")
        .map(|suffix| {
            dirs::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join(suffix)
        })
        .unwrap_or_else(|| std::path::PathBuf::from(value))
}
fn invalid() -> ApiError {
    ApiError::from_app(AppError::InvalidInput("Invalid usage request".to_string()))
}
fn unavailable() -> ApiError {
    ApiError::from_app(AppError::Unavailable(
        "Usage analytics unavailable".to_string(),
    ))
}
fn store_error(_: crate::telemetry::store::TelemetryStoreError) -> ApiError {
    ApiError::from_app(AppError::Unavailable(
        "Usage analytics unavailable".to_string(),
    ))
}
fn runtime_error(_: String) -> ApiError {
    ApiError::from_app(AppError::Unavailable(
        "Usage analytics setup could not be applied".to_string(),
    ))
}
