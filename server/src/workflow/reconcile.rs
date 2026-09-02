use std::collections::HashMap;
use std::time::Instant;

use rusqlite::params;
use tracing::info;

use crate::diagnostics::DiagnosticStore;
use crate::workflow::enums::{ResourceLinkType, ResourceObservedState};
use crate::workflow::store::session::list_all_links_by_type;
use crate::workflow::store::{WorkflowStore, WorkflowStoreError};

const MAX_DIAGNOSTIC_DURATION_MS: u128 = 60_000;
const MAX_DIAGNOSTIC_COUNT: usize = 1_000;

fn record_reconciliation(
    diagnostics: &DiagnosticStore,
    result: &Result<(usize, usize), WorkflowStoreError>,
    started: Instant,
) {
    let (result_label, availability) = match result {
        Ok(_) => ("ok", "available"),
        Err(_) => ("error", "unavailable"),
    };
    let (attached, detached) = result.as_ref().ok().copied().unwrap_or_default();
    diagnostics.record_terminal_event(
        "workflow",
        "workflow.reconciliation",
        std::collections::BTreeMap::from([
            ("operation".to_string(), "reconciliation".to_string()),
            ("result".to_string(), result_label.to_string()),
            (
                "duration_ms".to_string(),
                started.elapsed().as_millis().min(MAX_DIAGNOSTIC_DURATION_MS).to_string(),
            ),
            (
                "row_count".to_string(),
                attached
                    .saturating_add(detached)
                    .min(MAX_DIAGNOSTIC_COUNT)
                    .to_string(),
            ),
            ("event_count".to_string(), "0".to_string()),
            (
                "count".to_string(),
                attached
                    .saturating_add(detached)
                    .min(MAX_DIAGNOSTIC_COUNT)
                    .to_string(),
            ),
            (
                "attached_count".to_string(),
                attached.min(MAX_DIAGNOSTIC_COUNT).to_string(),
            ),
            (
                "detached_count".to_string(),
                detached.min(MAX_DIAGNOSTIC_COUNT).to_string(),
            ),
            ("store_availability".to_string(), availability.to_string()),
        ]),
    );
}

/// Reconciles persisted terminal links against the restored live PTY sessions on startup.
///
/// - Restored live terminals regain `ResourceObservedState::Attached` and update `incarnation`.
/// - Terminals not live/restored become `ResourceObservedState::Detached` with `suggested_end_time = Some(now)`.
/// - Work session status and manual timestamps are never modified.
/// - Identical live state emits no duplicate events and avoids needless updates.
pub fn reconcile_startup_terminal_links(
    store: &WorkflowStore,
    live_terminals: &[(String, u64)],
    now: u64,
) -> Result<(usize, usize), WorkflowStoreError> {
    reconcile_startup_terminal_links_internal(store, live_terminals, now, None)
}

/// Reconciles persisted terminal links and emits fixed-cardinality diagnostics.
pub fn reconcile_startup_terminal_links_with_diagnostics(
    store: &WorkflowStore,
    live_terminals: &[(String, u64)],
    now: u64,
    diagnostics: DiagnosticStore,
) -> Result<(usize, usize), WorkflowStoreError> {
    reconcile_startup_terminal_links_internal(store, live_terminals, now, Some(diagnostics))
}

fn reconcile_startup_terminal_links_internal(
    store: &WorkflowStore,
    live_terminals: &[(String, u64)],
    now: u64,
    diagnostics: Option<DiagnosticStore>,
) -> Result<(usize, usize), WorkflowStoreError> {
    let started = Instant::now();
    let result = reconcile_startup_terminal_links_inner(store, live_terminals, now);
    if let Some(diagnostics) = diagnostics.as_ref() {
        record_reconciliation(diagnostics, &result, started);
    }
    result
}

fn reconcile_startup_terminal_links_inner(
    store: &WorkflowStore,
    live_terminals: &[(String, u64)],
    now: u64,
) -> Result<(usize, usize), WorkflowStoreError> {
    let mut conn = store.lock()?;
    let tx = conn.transaction()?;

    let links = list_all_links_by_type(&tx, ResourceLinkType::Terminal)?;
    let live_map: HashMap<&str, u64> = live_terminals
        .iter()
        .map(|(id, inc)| (id.as_str(), *inc))
        .collect();

    let mut attached_count = 0;
    let mut detached_count = 0;

    for link in links {
        if let Some(&live_inc) = live_map.get(link.external_id.as_str()) {
            // Terminal is alive on server startup
            if link.observed_state != ResourceObservedState::Attached
                || link.incarnation != Some(live_inc)
            {
                tx.execute(
                    "UPDATE workflow_resource_links
                     SET observed_state = ?1, incarnation = ?2, suggested_end_time = NULL, last_seen_at = ?3, updated_at = ?3
                     WHERE id = ?4",
                    params![
                        ResourceObservedState::Attached.as_str(),
                        live_inc,
                        now,
                        link.id,
                    ],
                )?;
                attached_count += 1;
            }
        } else {
            // Terminal is dead or not restored
            if link.observed_state == ResourceObservedState::Attached
                || link.observed_state == ResourceObservedState::Stale
            {
                tx.execute(
                    "UPDATE workflow_resource_links
                     SET observed_state = ?1, suggested_end_time = ?2, last_seen_at = ?3, updated_at = ?3
                     WHERE id = ?4",
                    params![
                        ResourceObservedState::Detached.as_str(),
                        now,
                        now,
                        link.id,
                    ],
                )?;
                detached_count += 1;
            }
        }
    }

    tx.commit()?;
    info!(
        attached = attached_count.min(MAX_DIAGNOSTIC_COUNT),
        detached = detached_count.min(MAX_DIAGNOSTIC_COUNT),
        "Reconciled workflow terminal resource links with live PTY sessions"
    );
    Ok((attached_count, detached_count))
}
