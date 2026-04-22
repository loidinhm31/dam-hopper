use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};
use tokio::time::timeout;

use super::{
    driver::{BoxFuture, DriverHandle, TunnelDriver, TunnelDriverEvent},
    error::TunnelError,
    installer::TunnelInstaller,
};

static CF_URL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"https://[a-z0-9-]+\.trycloudflare\.com\b").unwrap()
});

pub struct CloudflaredDriver;

impl TunnelDriver for CloudflaredDriver {
    fn name(&self) -> &'static str {
        "cloudflared"
    }

    fn start(
        &self,
        port: u16,
        _label: &str,
        event_tx: mpsc::Sender<TunnelDriverEvent>,
    ) -> BoxFuture<'_, Result<DriverHandle, TunnelError>> {
        Box::pin(async move {
            let bin = TunnelInstaller::resolve().await?;

            let mut child = Command::new(bin)
                .args(["tunnel", "--url", &format!("http://127.0.0.1:{port}")])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .map_err(|e| TunnelError::SpawnFailed(e.to_string()))?;

            let pid = child.id();
            let stderr = child
                .stderr
                .take()
                .ok_or_else(|| TunnelError::SpawnFailed("stderr handle unavailable".into()))?;
            let (stop_tx, stop_rx) = oneshot::channel::<()>();

            // Inner: read stderr, find URL within 30s, then drain until EOF.
            let event_tx_inner = event_tx.clone();
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();

                // Clone for the timeout branch which runs after the async block is dropped.
                let event_tx_timeout = event_tx_inner.clone();

                let url_search = async {
                    while let Ok(Some(line)) = lines.next_line().await {
                        if let Some(m) = CF_URL_RE.find(&line) {
                            let _ = event_tx_inner
                                .send(TunnelDriverEvent::UrlReady(m.as_str().to_owned()))
                                .await;
                            return true;
                        }
                    }
                    false
                };

                match timeout(Duration::from_secs(30), url_search).await {
                    Ok(true) => {
                        // URL found — drain remaining stderr to avoid buffer pressure
                        while let Ok(Some(_)) = lines.next_line().await {}
                    }
                    Ok(false) => {
                        let _ = event_tx_inner.send(TunnelDriverEvent::Exited).await;
                    }
                    Err(_) => {
                        let _ = event_tx_timeout
                            .send(TunnelDriverEvent::Failed(
                                "cloudflared URL not found within 30s".into(),
                            ))
                            .await;
                        // Drain remaining stderr
                        while let Ok(Some(_)) = lines.next_line().await {}
                    }
                }
            });

            // Outer: wait for stop signal, then gracefully reap child.
            tokio::spawn(async move {
                tokio::select! {
                    _ = stop_rx => {
                        graceful_kill(&mut child, pid).await;
                    }
                    _ = child.wait() => {
                        // Child exited naturally; stderr task detects EOF and sends Exited.
                    }
                }
            });

            Ok(DriverHandle {
                pid,
                stop_tx: Some(stop_tx),
            })
        })
    }
}

async fn graceful_kill(child: &mut tokio::process::Child, pid: Option<u32>) {
    #[cfg(unix)]
    if let Some(p) = pid {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;
        let _ = kill(Pid::from_raw(p as i32), Signal::SIGTERM);
        let _ = timeout(Duration::from_secs(2), child.wait()).await;
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}
