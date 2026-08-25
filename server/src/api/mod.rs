pub mod agent_import;
pub mod agent_memory;
pub mod agent_store;
pub mod auth;
pub mod browser_debug;
pub mod commands;
pub mod config;
pub mod diagnostics;
pub mod error;
pub mod fs;
pub mod fs_image;
pub mod fs_video;
pub mod git;
pub mod git_diff;
pub mod host_actions;
mod http_byte_range;
pub mod media_session;
mod media_stream_headers;
mod media_stream_response;
pub mod port_forward;
pub mod router;
pub mod settings;
pub mod ssh;
pub mod system;
pub mod terminal;
pub mod tunnel;
pub mod usage;
pub mod usage_sessions;
// Keep the pre-extraction modules available for compatibility with existing
// module-local tests; the routes use the shared media adapters above.
#[allow(dead_code)]
mod video_stream_headers;
#[allow(dead_code)]
mod video_stream_response;
pub mod workspace;
pub mod ws;
pub mod ws_protocol;

#[cfg(test)]
mod tests;

pub use router::{build_router, build_router_with_origins};
