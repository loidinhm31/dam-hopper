pub mod activity;
pub mod buffer;
pub mod event_sink;
pub mod fleet_state;
pub mod manager;
mod output_control_parser;
pub mod session;
pub mod shell_integration;
pub mod shell_lifecycle;

#[cfg(test)]
mod tests;

pub use event_sink::{BroadcastEventSink, EventSink, NoopEventSink};
pub use manager::{PtyCreateOpts, PtySessionManager, PtyTargetContext, SessionDetail};
pub use session::SessionMeta;
pub use fleet_state::{
    HandoffClaim, HandoffClaimError, PtyFleetSnapshot, PtyFleetState, PtyFleetWatcher,
};
pub use activity::{
    parse_proc_stat, ActivityIncompleteReason, ParsedProcStat, ProcessIdentity,
    PtyActivitySnapshot, PtyActivityWatcher, RootActivityRecord, RootQualification,
    TerminalIdentity, MAX_LIVE_ROOTS_LIMIT, SATURATED_COUNTER_SENTINEL,
};
