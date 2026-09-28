use axum::{extract::State, response::Json};

use crate::agent_status::AgentStatusSnapshotV1;
use crate::state::AppState;

/// Get current public agent status snapshot across all terminals.
pub async fn get_snapshot(State(state): State<AppState>) -> Json<AgentStatusSnapshotV1> {
    Json(state.agent_status.snapshot())
}
