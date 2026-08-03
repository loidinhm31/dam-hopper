pub mod buffer;
pub mod event_sink;
pub mod manager;
mod output_control_parser;
pub mod session;
pub mod shell_integration;
pub mod shell_lifecycle;

#[cfg(test)]
mod tests;

pub use event_sink::{BroadcastEventSink, EventSink, NoopEventSink};
pub use manager::{PtyCreateOpts, PtySessionManager, SessionDetail};
pub use session::SessionMeta;
