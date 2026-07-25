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
            add_tokens, add_usage, aggregate_command_rollups, aggregate_commands,
            aggregate_token_rollups, aggregate_tokens, health_value, TokenAggregate,
            UsageAggregate,
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Health {
    available: bool,
    paused: bool,
    writer_errors: u64,
    rejected_events: u64,
    sampled_at: i64,
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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
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
    let codex = if query.project.is_some()
        || query.shell.is_some()
        || query.capture_quality.is_some()
        || query.category.is_some()
    {
        None
    } else {
        add_tokens(
            aggregate_tokens(&store, &detail_query).map_err(store_error)?,
            aggregate_token_rollups(&store, &query, boundary).map_err(store_error)?,
        )
    };
    let detail_only = range.from >= boundary;
    let health = Health {
        available: true,
        paused: !telemetry.control.is_enabled(),
        writer_errors: health_value(&store, "writer_errors").map_err(store_error)?,
        rejected_events: telemetry.control.rejected_count(),
        sampled_at: now_ms(),
    };
    Ok(Json(SummaryResponse {
        range,
        terminal,
        codex,
        coverage: Coverage {
            detail_only,
            capture_quality_filter: query.capture_quality.map(quality_name).map(str::to_string),
        },
        health,
    }))
}

pub async fn health(State(state): State<AppState>) -> Result<impl IntoResponse, ApiError> {
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
    Ok(Json(Health {
        available: telemetry.store.is_some(),
        paused: !telemetry.control.is_enabled(),
        writer_errors,
        rejected_events: telemetry.control.rejected_count(),
        sampled_at: now_ms(),
    }))
}

pub async fn get_settings(State(state): State<AppState>) -> impl IntoResponse {
    let telemetry = state.config.read().await.server.telemetry.clone();
    Json(settings_response(telemetry))
}

pub async fn update_settings(
    State(state): State<AppState>,
    Json(patch): Json<SettingsPatch>,
) -> Result<impl IntoResponse, ApiError> {
    let mut config = state.config.read().await.clone();
    {
        let telemetry = &mut config.server.telemetry;
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

    let runtime = state
        .telemetry
        .read()
        .expect("telemetry state lock poisoned")
        .clone();
    if patch.detail_retention_days.is_some() || patch.aggregate_retention_days.is_some() {
        apply_retention(&runtime, &config.server.telemetry).map_err(store_error)?;
    }
    // Publish the new retention boundary only after its synchronous rollup has
    // completed, so no summary can observe a detail/rollup gap.
    write_config(&config.config_path, &config).map_err(ApiError::from_app)?;
    runtime.control.set_enabled(!config.server.telemetry.paused);
    runtime
        .control
        .set_excluded_projects(config.server.telemetry.excluded_projects.clone());
    *state.config.write().await = config.clone();
    Ok(Json(settings_response(config.server.telemetry)))
}

pub async fn delete_all(
    State(state): State<AppState>,
    Json(body): Json<DeleteRequest>,
) -> Result<impl IntoResponse, ApiError> {
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
    telemetry
        .control
        .with_exclusive_admission(|| {
            telemetry.control.set_enabled(false);
            execute_delete(&telemetry, &store, range)
        })
        .map_err(store_error)?;
    let paused = state.config.read().await.server.telemetry.paused;
    telemetry.control.set_enabled(!paused);
    Ok(Json(serde_json::json!({ "deleted": true })))
}

fn settings_response(telemetry: crate::config::TelemetryConfig) -> SettingsResponse {
    SettingsResponse {
        enabled: telemetry.enabled,
        paused: telemetry.paused,
        detail_retention_days: telemetry.detail_retention_days,
        aggregate_retention_days: telemetry.aggregate_retention_days,
        excluded_projects: telemetry.excluded_projects,
        collector: telemetry.collector,
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
fn apply_retention(
    telemetry: &crate::telemetry::worker::TelemetryHandle,
    config: &crate::config::TelemetryConfig,
) -> Result<(), crate::telemetry::store::TelemetryStoreError> {
    let now = now_ms();
    if let Some(sender) = &telemetry.command_tx {
        let (completion_tx, completion_rx) = std::sync::mpsc::sync_channel(1);
        let command = TelemetryCmd::ApplyRetention {
            now_utc_ms: now,
            detail_retention_days: config.detail_retention_days,
            aggregate_retention_days: config.aggregate_retention_days,
            completion: completion_tx,
        };
        sender.send(command).map_err(|_| {
            crate::telemetry::store::TelemetryStoreError::Io(std::io::Error::new(
                std::io::ErrorKind::WouldBlock,
                "telemetry worker unavailable",
            ))
        })?;
        return completion_rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .map_err(|_| {
                crate::telemetry::store::TelemetryStoreError::Io(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "telemetry retention timed out",
                ))
            })?
            .map_err(|error| {
                crate::telemetry::store::TelemetryStoreError::Io(std::io::Error::other(error))
            });
    } else if let Some(store) = &telemetry.store {
        store.write_batch(vec![TelemetryCmd::Purge {
            now_utc_ms: now,
            detail_retention_days: config.detail_retention_days,
            aggregate_retention_days: config.aggregate_retention_days,
        }])?;
    }
    Ok(())
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
