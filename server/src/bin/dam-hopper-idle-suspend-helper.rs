#[cfg(target_os = "linux")]
use clap::Parser;
#[cfg(target_os = "linux")]
use std::path::PathBuf;
#[cfg(target_os = "linux")]
use std::sync::Arc;
#[cfg(target_os = "linux")]
use tracing::{error, info, warn};
#[cfg(target_os = "linux")]
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[cfg(target_os = "linux")]
use dam_hopper_server::idle_suspend::{
    audit::HelperAudit,
    backend::SystemdLogindBackend,
    helper_server::HelperServer,
    peer_auth::{EnrolledPeerPolicy, PeerCredentials},
    preflight::SysfsPreflightChecker,
};
#[cfg(target_os = "linux")]
#[derive(Debug, Parser)]
#[command(
    name = "dam-hopper-idle-suspend-helper",
    version,
    about = "DamHopper privileged systemd helper for fail-closed RTC wake and host suspend"
)]
struct Cli {
    /// Unix domain socket path for helper IPC
    #[arg(
        long,
        default_value = "/run/dam-hopper/idle-suspend.sock",
        env = "DAM_HOPPER_IDLE_SUSPEND_SOCKET"
    )]
    socket: PathBuf,

    /// Audit log JSONL path
    #[arg(
        long,
        default_value = "/var/log/dam-hopper/idle-suspend-helper.jsonl",
        env = "DAM_HOPPER_IDLE_SUSPEND_AUDIT_FILE"
    )]
    audit_file: PathBuf,

    /// Enrolled server UID to accept connections from
    #[arg(long, env = "DAM_HOPPER_IDLE_SUSPEND_ENROLLED_UID")]
    enrolled_uid: Option<u32>,

    /// Path to server PID file for MainPID verification
    #[arg(long, env = "DAM_HOPPER_IDLE_SUSPEND_ENROLLED_PID_FILE")]
    enrolled_pid_file: Option<PathBuf>,

    /// Enrolled server MainPID
    #[arg(long, env = "DAM_HOPPER_IDLE_SUSPEND_ENROLLED_PID")]
    enrolled_pid: Option<u32>,
}

#[cfg(target_os = "linux")]
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with(fmt::layer())
        .init();

    let cli = Cli::parse();

    info!(
        socket = %cli.socket.display(),
        audit_file = %cli.audit_file.display(),
        enrolled_uid = ?cli.enrolled_uid,
        enrolled_pid = ?cli.enrolled_pid,
        enrolled_pid_file = ?cli.enrolled_pid_file,
        "Starting DamHopper idle-suspend helper daemon"
    );

    let policy = EnrolledPeerPolicy {
        expected_uid: cli.enrolled_uid,
        expected_pid: cli.enrolled_pid,
        pid_file_path: cli.enrolled_pid_file,
    };

    let preflight = Arc::new(SysfsPreflightChecker::new());
    let backend = Arc::new(SystemdLogindBackend::new());
    let audit = Arc::new(HelperAudit::new(&cli.audit_file, 10_000)?);
    info!(
        boot_id = %audit.identity().boot_id,
        instance_id = %audit.identity().producer_instance_id,
        "Helper audit initialized with v2 producer identity"
    );
    let server = Arc::new(HelperServer::new(policy, preflight, backend, audit, 1024));

    // Ensure parent directory for socket exists
    if let Some(parent) = cli.socket.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }

    // Clean up stale socket if it exists
    if cli.socket.exists() {
        let _ = std::fs::remove_file(&cli.socket);
    }

    let listener = tokio::net::UnixListener::bind(&cli.socket)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o660);
        let _ = std::fs::set_permissions(&cli.socket, perms);
    }

    info!(socket = %cli.socket.display(), "Helper listener bound successfully");

    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    let mut sigint = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?;

    loop {
        tokio::select! {
            accept_res = listener.accept() => {
                match accept_res {
                    Ok((mut stream, _addr)) => {
                        let srv = Arc::clone(&server);
                        tokio::spawn(async move {
                            #[cfg(target_os = "linux")]
                            let cred = match PeerCredentials::from_unix_stream(&stream) {
                                Ok(c) => c,
                                Err(e) => {
                                    warn!("Failed to retrieve peer credentials from socket: {e}");
                                    return;
                                }
                            };
                            #[cfg(not(target_os = "linux"))]
                            let cred = PeerCredentials::new(0, 0, 0);

                            if let Err(e) = srv.handle_connection(&mut stream, cred).await {
                                warn!("Helper connection error: {e}");
                            }
                        });
                    }
                    Err(e) => {
                        error!("Failed to accept socket connection: {e}");
                    }
                }
            }
            _ = sigterm.recv() => {
                info!("Received SIGTERM, shutting down helper daemon");
                break;
            }
            _ = sigint.recv() => {
                info!("Received SIGINT, shutting down helper daemon");
                break;
            }
        }
    }

    // Cleanup socket on exit
    if cli.socket.exists() {
        let _ = std::fs::remove_file(&cli.socket);
    }

    info!("DamHopper idle-suspend helper stopped cleanly");
    Ok(())
}

#[cfg(windows)]
fn main() {
    eprintln!("dam-hopper-idle-suspend-helper is only supported on Linux with systemd.");
    std::process::exit(1);
}
