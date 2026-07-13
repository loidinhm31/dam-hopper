use axum::{extract::State, Json};

use crate::state::AppState;

/// GET /api/system/metrics — host CPU, memory, and workspace disk usage.
pub async fn get_metrics(State(state): State<AppState>) -> Json<crate::system::HostMetrics> {
    let config_dir = state.config_dir().await;
    Json(state.host_metrics.sample(&config_dir))
}
