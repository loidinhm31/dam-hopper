use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
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

static CF_URL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"https://[a-z0-9-]+\.trycloudflare\.com\b").unwrap());

/// Constructs subprocess arguments for an ephemeral quick tunnel.
///
/// - `--no-autoupdate`: prevents unexpected background updater activity.
/// - `--config ""`: isolates subprocess from host/global config discovery (e.g. `/etc/cloudflared/config.yml`).
/// - `--http-host-header localhost`: rewrites the forwarded Host header so dev servers with
///   DNS rebinding protection (e.g. Vite 6 `server.allowedHosts`) accept proxied requests.
/// - `--url http://127.0.0.1:{port}`: targets the locally exposed port over loopback.
pub fn cloudflared_tunnel_args(port: u16) -> Vec<String> {
    vec![
        "--no-autoupdate".to_string(),
        "--config".to_string(),
        "".to_string(),
        "tunnel".to_string(),
        "--http-host-header".to_string(),
        "localhost".to_string(),
        "--url".to_string(),
        format!("http://127.0.0.1:{port}"),
    ]
}
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

            let args = cloudflared_tunnel_args(port);
            let mut child = Command::new(bin)
                .args(&args)
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
            let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
            let terminal_reached = Arc::new(AtomicBool::new(false));

            // Inner: read stderr, extract URL within 30s, then drain remaining stderr until EOF/abort.
            let event_tx_inner = event_tx.clone();
            let terminal_for_reader = Arc::clone(&terminal_reached);
            let reader_handle = tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();

                let url_search = async {
                    while let Ok(Some(line)) = lines.next_line().await {
                        if let Some(m) = CF_URL_RE.find(&line) {
                            if !terminal_for_reader.load(Ordering::Acquire) {
                                let _ = event_tx_inner
                                    .send(TunnelDriverEvent::UrlReady(m.as_str().to_owned()))
                                    .await;
                            }
                            return true;
                        }
                    }
                    false
                };

                match timeout(Duration::from_secs(30), url_search).await {
                    Ok(true) => {
                        // URL found — drain remaining stderr to avoid buffer pressure until process exits or is aborted.
                        while let Ok(Some(_)) = lines.next_line().await {}
                    }
                    Ok(false) => {
                        // EOF reached before URL found (process exited early or closed stderr).
                        // child.wait() supervisor is the single authority for process exit events.
                    }
                    Err(_) => {
                        if !terminal_for_reader.load(Ordering::Acquire) {
                            let _ = event_tx_inner
                                .send(TunnelDriverEvent::Failed(
                                    "cloudflared URL not found within 30s".into(),
                                ))
                                .await;
                        }
                        while let Ok(Some(_)) = lines.next_line().await {}
                    }
                }
            });

            // Outer: supervisor task. child.wait() is the single authority for process exit notifications.
            let terminal_for_reaper = Arc::clone(&terminal_reached);
            tokio::spawn(async move {
                tokio::select! {
                    _ = &mut stop_rx => {
                        terminal_for_reaper.store(true, Ordering::Release);
                        reader_handle.abort();
                        graceful_kill(&mut child, pid).await;
                    }
                    _ = child.wait() => {
                        terminal_for_reaper.store(true, Ordering::Release);
                        reader_handle.abort();
                        let _ = event_tx.send(TunnelDriverEvent::Exited).await;
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
