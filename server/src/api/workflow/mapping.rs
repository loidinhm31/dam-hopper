use chrono::{DateTime, TimeZone, Utc};

use super::dto::*;
use crate::workflow::model::*;
use crate::workspace_target::ResolvedProjectTarget;

pub fn now_ms() -> u64 {
    Utc::now().timestamp_millis().max(0) as u64
}

pub fn timestamp(ms: u64) -> String {
    Utc.timestamp_millis_opt(ms as i64)
        .single()
        .unwrap_or_else(Utc::now)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn parse_timestamp(v: &str) -> Result<u64, ()> {
    let dt = DateTime::parse_from_rfc3339(v).map_err(|_| ())?;
    u64::try_from(dt.timestamp_millis()).map_err(|_| ())
}

pub fn target_path(r: &ResolvedProjectTarget) -> Option<String> {
    (!r.is_root()).then(|| r.target_path().to_string_lossy().into_owned())
}

pub fn target(project: String, worktree_path: Option<String>) -> TargetDto {
    TargetDto {
        project,
        worktree_path,
    }
}

pub fn item(v: WorkflowItem) -> ItemDto {
    ItemDto {
        id: v.id,
        target: target(v.project_name, v.worktree_path),
        parent_id: v.parent_id,
        kind: v.kind,
        title: v.title,
        summary: v.summary,
        status: v.status,
        sort_order: v.sort_order,
        source: v.source,
        created_at: timestamp(v.created_at),
        updated_at: timestamp(v.updated_at),
        completed_at: v.completed_at.map(timestamp),
    }
}

pub fn session(v: WorkflowSession) -> SessionDto {
    SessionDto {
        id: v.id,
        target: target(v.project_name, v.worktree_path),
        item_id: v.item_id,
        status: v.status,
        started_at: timestamp(v.started_at),
        ended_at: v.ended_at.map(timestamp),
        source: v.source,
        created_at: timestamp(v.created_at),
        updated_at: timestamp(v.updated_at),
    }
}

pub fn note(v: WorkflowNote) -> NoteDto {
    NoteDto {
        id: v.id,
        item_id: v.item_id,
        session_id: v.session_id,
        body: v.body,
        source: v.source,
        created_at: timestamp(v.created_at),
        updated_at: timestamp(v.updated_at),
        deleted_at: v.deleted_at.map(timestamp),
    }
}

pub fn link(v: WorkflowResourceLink) -> LinkDto {
    LinkDto {
        id: v.id,
        session_id: v.session_id,
        resource_type: v.resource_type,
        external_id: v.external_id,
        incarnation: v.incarnation,
        harness_label: v.harness_label,
        run_id: v.run_id,
        observed_state: v.observed_state,
        suggested_end_time: v.suggested_end_time.map(timestamp),
        first_seen_at: timestamp(v.first_seen_at),
        last_seen_at: timestamp(v.last_seen_at),
        link_source: v.link_source,
        created_at: timestamp(v.created_at),
        updated_at: timestamp(v.updated_at),
    }
}

pub fn event(v: WorkflowEvent) -> EventDto {
    EventDto {
        id: v.id,
        event_type: v.event_type,
        source: v.source,
        target: v.project_name.map(|p| target(p, v.worktree_path)),
        item_id: v.item_id,
        session_id: v.session_id,
        occurred_at: timestamp(v.occurred_at),
        recorded_at: timestamp(v.recorded_at),
    }
}

pub fn item_node(n: ItemOverviewNode) -> ItemOverviewNodeDto {
    ItemOverviewNodeDto {
        item: item(n.item),
        progress: n.progress.map(|p| ItemProgressDto {
            total_tracked_tasks: p.total_tracked_tasks,
            completed_tracked_tasks: p.completed_tracked_tasks,
        }),
        notes: n.notes.into_iter().map(note).collect(),
        active_sessions: n.active_sessions.into_iter().map(session).collect(),
        children: n.children.into_iter().map(item_node).collect(),
    }
}

pub fn overview(v: WorkflowOverview, id: String, name: String, now: u64) -> OverviewDto {
    let plans = v.plans.into_iter().map(item_node).collect();
    let standalone_tasks = v.standalone_tasks.into_iter().map(item_node).collect();
    let projects = v
        .projects
        .into_iter()
        .map(|p| {
            let project = p.project_name.clone();
            ProjectDto {
                project: project.clone(),
                target: Some(target(project, p.worktree_path)),
                plan_count: p.plan_count,
                task_count: p.task_count,
                running_session_count: p.running_session_count,
                last_activity_at: p.last_activity_at.map(timestamp),
            }
        })
        .collect();

    OverviewDto {
        workspace: WorkspaceDto { id, name },
        server_time: timestamp(now),
        projects,
        plans,
        standalone_tasks,
        running_sessions: v.running_sessions.into_iter().map(session).collect(),
        recent_events: v.recent_events.into_iter().map(event).collect(),
        truncated: v.truncated,
    }
}
