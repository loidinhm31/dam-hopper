use std::sync::Arc;

use dam_hopper_server::{
    pty::BroadcastEventSink,
    tunnel::{CloudflaredDriver, TunnelSessionManager},
};

pub fn make_tunnel_manager(event_sink: &BroadcastEventSink) -> TunnelSessionManager {
    TunnelSessionManager::new(Arc::new(event_sink.clone()), Arc::new(CloudflaredDriver))
}
