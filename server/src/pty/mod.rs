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
