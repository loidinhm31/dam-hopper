use crate::workflow::enums::*;
use crate::workflow::model::{
    ItemOverviewNode, ItemProgress, ProjectSummary, WorkflowItem, WorkflowOverview, WorkflowSession,
};
use crate::workflow::store::error::WorkflowStoreError;
use rusqlite::Connection;
use std::collections::HashMap;

/// Aggregates a full workflow overview for the current workspace.
pub fn get_overview(
    conn: &Connection,
    workspace_id: &str,
    now_ms: u64,
    max_projects: usize,
    max_items: usize,
    max_sessions: usize,
) -> Result<WorkflowOverview, WorkflowStoreError> {
    let max_projects = max_projects.min(crate::workflow::MAX_OVERVIEW_PROJECTS);
    let max_items = max_items.min(crate::workflow::MAX_OVERVIEW_ITEMS);
    let max_sessions = max_sessions.min(crate::workflow::MAX_OVERVIEW_SESSIONS);

    // 1. Fetch items
    let all_items = super::item::list_items(conn, workspace_id, None, None, max_items + 1)?;
    let items_truncated = all_items.len() > max_items;
    let items: Vec<WorkflowItem> = all_items.into_iter().take(max_items).collect();

    // 2. Fetch running sessions
    let running_sessions =
        super::session::list_active_sessions(conn, workspace_id, None, max_sessions)?;

    // 3. Fetch recent events (up to 20 for overview)
    let recent_events = super::event::list_events_keyset(conn, workspace_id, None, None, 20)?;

    // 4. Group items by parent_id
    let mut children_by_parent: HashMap<String, Vec<WorkflowItem>> = HashMap::new();
    let mut root_plans = Vec::new();
    let mut standalone_tasks = Vec::new();

    for item in &items {
        if let Some(pid) = &item.parent_id {
            children_by_parent
                .entry(pid.clone())
                .or_default()
                .push(item.clone());
        } else {
            match item.kind {
                ItemKind::Plan => root_plans.push(item.clone()),
                ItemKind::Task => standalone_tasks.push(item.clone()),
                ItemKind::Phase => {
                    // Phase without parent is invalid hierarchy, treat as orphan plan-level
                    root_plans.push(item.clone());
                }
            }
        }
    }

    // Sort root lists
    root_plans.sort_by(|a, b| {
        a.sort_order
            .cmp(&b.sort_order)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });
    standalone_tasks.sort_by(|a, b| {
        a.sort_order
            .cmp(&b.sort_order)
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });

    // 5. Index running sessions by item_id
    let mut sessions_by_item: HashMap<String, Vec<WorkflowSession>> = HashMap::new();
    for session in &running_sessions {
        if let Some(item_id) = &session.item_id {
            sessions_by_item
                .entry(item_id.clone())
                .or_default()
                .push(session.clone());
        }
    }

    // Helper to build node tree and compute factual task counts
    fn build_node(
        conn: &Connection,
        workspace_id: &str,
        item: WorkflowItem,
        children_map: &HashMap<String, Vec<WorkflowItem>>,
        sessions_map: &HashMap<String, Vec<WorkflowSession>>,
    ) -> Result<ItemOverviewNode, WorkflowStoreError> {
        let notes = super::note::list_notes_for_item(conn, &item.id, workspace_id, false)?;
        let active_sessions = sessions_map.get(&item.id).cloned().unwrap_or_default();

        let raw_children = children_map.get(&item.id).cloned().unwrap_or_default();
        let mut child_nodes = Vec::new();

        for child in raw_children {
            child_nodes.push(build_node(
                conn,
                workspace_id,
                child,
                children_map,
                sessions_map,
            )?);
        }

        // Sort children
        child_nodes.sort_by(|a, b| {
            a.item
                .sort_order
                .cmp(&b.item.sort_order)
                .then_with(|| b.item.updated_at.cmp(&a.item.updated_at))
        });

        // Compute factual progress
        let progress = match item.kind {
            ItemKind::Task => None,
            ItemKind::Phase => {
                let mut total = 0u32;
                let mut completed = 0u32;
                for child in &child_nodes {
                    if child.item.kind == ItemKind::Task {
                        total += 1;
                        if child.item.status == ItemStatus::Done {
                            completed += 1;
                        }
                    }
                }
                if total > 0 {
                    Some(ItemProgress {
                        total_tracked_tasks: total,
                        completed_tracked_tasks: completed,
                    })
                } else {
                    None
                }
            }
            ItemKind::Plan => {
                let mut total = 0u32;
                let mut completed = 0u32;
                for child in &child_nodes {
                    if child.item.kind == ItemKind::Task {
                        total += 1;
                        if child.item.status == ItemStatus::Done {
                            completed += 1;
                        }
                    } else if child.item.kind == ItemKind::Phase {
                        for grand in &child.children {
                            if grand.item.kind == ItemKind::Task {
                                total += 1;
                                if grand.item.status == ItemStatus::Done {
                                    completed += 1;
                                }
                            }
                        }
                    }
                }
                if total > 0 {
                    Some(ItemProgress {
                        total_tracked_tasks: total,
                        completed_tracked_tasks: completed,
                    })
                } else {
                    None
                }
            }
        };

        Ok(ItemOverviewNode {
            item,
            progress,
            notes,
            active_sessions,
            children: child_nodes,
        })
    }

    let mut plan_nodes = Vec::new();
    for plan in root_plans {
        plan_nodes.push(build_node(
            conn,
            workspace_id,
            plan,
            &children_by_parent,
            &sessions_by_item,
        )?);
    }

    let mut standalone_nodes = Vec::new();
    for task in standalone_tasks {
        standalone_nodes.push(build_node(
            conn,
            workspace_id,
            task,
            &children_by_parent,
            &sessions_by_item,
        )?);
    }

    // 6. Build project summaries
    let mut project_map: HashMap<String, ProjectSummary> = HashMap::new();

    for item in &items {
        let entry = project_map
            .entry(item.project_name.clone())
            .or_insert_with(|| ProjectSummary {
                project_name: item.project_name.clone(),
                worktree_path: item.worktree_path.clone(),
                plan_count: 0,
                task_count: 0,
                running_session_count: 0,
                last_activity_at: None,
            });

        match item.kind {
            ItemKind::Plan => entry.plan_count += 1,
            ItemKind::Task => entry.task_count += 1,
            ItemKind::Phase => {}
        }

        entry.last_activity_at = Some(
            entry
                .last_activity_at
                .map_or(item.updated_at, |curr| curr.max(item.updated_at)),
        );
    }

    for session in &running_sessions {
        let entry = project_map
            .entry(session.project_name.clone())
            .or_insert_with(|| ProjectSummary {
                project_name: session.project_name.clone(),
                worktree_path: session.worktree_path.clone(),
                plan_count: 0,
                task_count: 0,
                running_session_count: 0,
                last_activity_at: None,
            });

        entry.running_session_count += 1;
        entry.last_activity_at = Some(
            entry
                .last_activity_at
                .map_or(session.updated_at, |curr| curr.max(session.updated_at)),
        );
    }

    let mut projects: Vec<ProjectSummary> = project_map.into_values().collect();
    let projects_truncated = projects.len() > max_projects;
    projects.sort_by(|a, b| {
        b.last_activity_at
            .cmp(&a.last_activity_at)
            .then_with(|| a.project_name.cmp(&b.project_name))
    });
    projects.truncate(max_projects);

    Ok(WorkflowOverview {
        workspace_id: workspace_id.to_string(),
        server_time_ms: now_ms,
        projects,
        plans: plan_nodes,
        standalone_tasks: standalone_nodes,
        running_sessions,
        recent_events,
        truncated: items_truncated || projects_truncated,
    })
}
