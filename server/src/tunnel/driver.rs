use std::future::Future;
use std::pin::Pin;

use tokio::sync::oneshot;

use super::error::TunnelError;

pub struct DriverHandle {
    pub pid: Option<u32>,
    /// Send `()` to initiate graceful shutdown of the child process.
    pub stop_tx: Option<oneshot::Sender<()>>,
}

pub enum TunnelDriverEvent {
    UrlReady(String),
    Failed(String),
    Exited,
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Abstraction over tunnel implementations (cloudflared, devtunnels, etc.)
/// Uses BoxFuture for dyn-compatibility with `Arc<dyn TunnelDriver>`.
pub trait TunnelDriver: Send + Sync {
    fn name(&self) -> &'static str;
    fn start(
        &self,
        port: u16,
        label: &str,
        event_tx: tokio::sync::mpsc::Sender<TunnelDriverEvent>,
    ) -> BoxFuture<'_, Result<DriverHandle, TunnelError>>;
}
