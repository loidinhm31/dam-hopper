#![allow(dead_code)]

#[cfg(target_os = "linux")]
pub mod format2_fixtures;
#[cfg(target_os = "linux")]
pub mod release_fixtures;

use std::sync::Arc;

use dam_hopper_server::{
    pty::BroadcastEventSink,
    tunnel::{CloudflaredDriver, TunnelSessionManager},
};

pub fn make_tunnel_manager(event_sink: &BroadcastEventSink) -> TunnelSessionManager {
    TunnelSessionManager::new(Arc::new(event_sink.clone()), Arc::new(CloudflaredDriver))
}

#[cfg(windows)]
pub fn read_stdin_command() -> &'static str {
    ""
}

#[cfg(not(windows))]
pub fn read_stdin_command() -> &'static str {
    "cat"
}

#[cfg(windows)]
pub fn hold_command(seconds: u64) -> String {
    format!("ping 127.0.0.1 -n {} >NUL", seconds.saturating_add(1))
}

#[cfg(not(windows))]
pub fn hold_command(seconds: u64) -> String {
    format!("sleep {seconds}")
}

pub fn test_temp_cwd() -> String {
    std::env::temp_dir().display().to_string()
}
