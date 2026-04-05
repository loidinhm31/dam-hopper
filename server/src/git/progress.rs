use tokio::sync::broadcast;

use crate::git::types::{GitProgressEvent, GitProgressPhase};

pub type ProgressSender = broadcast::Sender<GitProgressEvent>;
pub type ProgressReceiver = broadcast::Receiver<GitProgressEvent>;

/// Default broadcast capacity — git progress events are low-throughput.
const CHANNEL_CAPACITY: usize = 64;

pub fn create_progress_channel() -> ProgressSender {
    let (tx, _) = broadcast::channel(CHANNEL_CAPACITY);
    tx
}

pub fn emit(
    tx: &Option<ProgressSender>,
    project_name: impl Into<String>,
    operation: impl Into<String>,
    phase: GitProgressPhase,
    message: impl Into<String>,
    percent: Option<u8>,
) {
    if let Some(sender) = tx {
        // Ignore send errors — no active receivers is expected (they come and go)
        let _ = sender.send(GitProgressEvent {
            project_name: project_name.into(),
            operation: operation.into(),
            phase,
            message: message.into(),
            percent,
        });
    }
}

pub fn emit_started(tx: &Option<ProgressSender>, project_name: &str, operation: &str, msg: &str) {
    emit(tx, project_name, operation, GitProgressPhase::Started, msg, None);
}

pub fn emit_progress(
    tx: &Option<ProgressSender>,
    project_name: &str,
    operation: &str,
    msg: &str,
    percent: Option<u8>,
) {
    emit(tx, project_name, operation, GitProgressPhase::Progress, msg, percent);
}

pub fn emit_completed(tx: &Option<ProgressSender>, project_name: &str, operation: &str, msg: &str) {
    emit(tx, project_name, operation, GitProgressPhase::Completed, msg, None);
}

pub fn emit_failed(tx: &Option<ProgressSender>, project_name: &str, operation: &str, msg: &str) {
    emit(tx, project_name, operation, GitProgressPhase::Failed, msg, None);
}
