use axum::{extract::State, Json};

use crate::state::AppState;

/// GET /api/system/metrics — host CPU, memory, and workspace disk usage.
pub async fn get_metrics(State(state): State<AppState>) -> Json<crate::system::HostMetrics> {
    let workspace_root = state.workspace_dir.read().await.clone();
    Json(state.host_metrics.sample(&workspace_root))
}
