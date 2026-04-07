use std::path::PathBuf;

use notify::EventKind;
use notify_debouncer_full::DebouncedEvent;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FsEventKind {
    Created,
    Modified,
    Removed,
    Renamed,
}

/// Normalized filesystem event. `from` is populated only for Renamed.
#[derive(Debug, Clone, Serialize)]
pub struct FsEvent {
    pub kind: FsEventKind,
    /// Absolute path (destination for renames).
    pub path: PathBuf,
    /// Rename source. `None` for all other kinds.
    pub from: Option<PathBuf>,
}

/// Converts a batch of debounced notify events into normalized `FsEvent` vec.
///
/// Correlates rename pairs: DebouncedEvent with EventKind::Rename(RenameMode::Both)
/// carries [from, to] paths. Orphan From/To events are treated as Remove/Create.
pub fn normalize(events: Vec<DebouncedEvent>) -> Vec<FsEvent> {
    let mut out = Vec::with_capacity(events.len());

    for ev in events {
        match ev.event.kind {
            EventKind::Create(_) => {
                for path in ev.event.paths {
                    out.push(FsEvent { kind: FsEventKind::Created, path, from: None });
                }
            }
            EventKind::Modify(notify::event::ModifyKind::Name(
                notify::event::RenameMode::Both,
            )) => {
                let mut paths = ev.event.paths.into_iter();
                let from = paths.next();
                let to = paths.next();
                if let (Some(from), Some(to)) = (from, to) {
                    out.push(FsEvent {
                        kind: FsEventKind::Renamed,
                        path: to,
                        from: Some(from),
                    });
                }
            }
            EventKind::Modify(notify::event::ModifyKind::Name(
                notify::event::RenameMode::From,
            )) => {
                for path in ev.event.paths {
                    out.push(FsEvent { kind: FsEventKind::Removed, path, from: None });
                }
            }
            EventKind::Modify(notify::event::ModifyKind::Name(
                notify::event::RenameMode::To,
            )) => {
                for path in ev.event.paths {
                    out.push(FsEvent { kind: FsEventKind::Created, path, from: None });
                }
            }
            EventKind::Modify(_) => {
                for path in ev.event.paths {
                    out.push(FsEvent { kind: FsEventKind::Modified, path, from: None });
                }
            }
            EventKind::Remove(_) => {
                for path in ev.event.paths {
                    out.push(FsEvent { kind: FsEventKind::Removed, path, from: None });
                }
            }
            // Access / Other events — ignored
            _ => {}
        }
    }

    out
}
