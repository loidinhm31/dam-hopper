pub mod buffer;
pub mod event_sink;
pub mod manager;
mod output_control_parser;
mod output_redactor;
pub mod session;
pub mod shell_integration;
pub mod shell_lifecycle;

#[cfg(test)]
mod output_redactor_tests;
#[cfg(test)]
mod tests;

pub use event_sink::{BroadcastEventSink, EventSink, NoopEventSink};
pub use manager::{PtyCreateOpts, PtySessionManager, SessionDetail};
pub use session::SessionMeta;
