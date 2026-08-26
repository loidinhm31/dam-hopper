use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;

use crate::state::AppState;

/// GET /api/system/metrics — host CPU, memory, disk, and thermal usage.
pub async fn get_metrics(State(state): State<AppState>) -> Json<crate::system::HostMetrics> {
    Json(state.host_resource_monitor.legacy_metrics().await)
}

/// GET /api/system/resources/v1/snapshot — authoritative cached deep snapshot.
pub async fn get_snapshot(
    State(state): State<AppState>,
) -> Json<crate::system::HostResourceSnapshotV1> {
    Json(state.host_resource_monitor.snapshot().await)
}

#[derive(Debug, Deserialize)]
pub struct AlertQuery {
    pub limit: Option<usize>,
}

/// GET /api/system/resources/v1/alerts — bounded incident history, newest first.
pub async fn get_alerts(
    State(state): State<AppState>,
    Query(query): Query<AlertQuery>,
) -> Json<Vec<crate::system::alerts::HostResourceAlertIncident>> {
    Json(
        state
            .host_resource_monitor
            .alerts(query.limit.unwrap_or(50))
            .await,
    )
}
