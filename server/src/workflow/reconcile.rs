use std::collections::HashMap;

use rusqlite::params;
use tracing::info;

use crate::workflow::enums::{ResourceLinkType, ResourceObservedState};
use crate::workflow::store::session::list_all_links_by_type;
use crate::workflow::store::{WorkflowStore, WorkflowStoreError};

/// Reconciles persisted terminal links against the restored live PTY sessions on startup.
///
/// Rules:
/// - Restored live terminals regain `ResourceObservedState::Attached` and update `incarnation`.
/// - Terminals not live/restored become `ResourceObservedState::Detached` with `suggested_end_time = Some(now)`.
/// - Work session status (`running`, `ended`, `abandoned`) and manual timestamps are NEVER modified.
/// - Clean restart with identical live state emits no duplicate events and avoids needless updates.
pub fn reconcile_startup_terminal_links(
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
        attached = attached_count,
        detached = detached_count,
        "Reconciled workflow terminal resource links with live PTY sessions"
    );
    Ok((attached_count, detached_count))
}
