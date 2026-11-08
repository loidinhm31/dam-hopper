use std::fmt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::time::{sleep, timeout, Instant};
use tracing::info;

pub const STARTUP_TIMEOUT_SECS: u64 = 15;
pub const MAX_STDERR_CAPTURE_BYTES: usize = 65_536; // 64 KiB
pub const SHUTDOWN_GRACE_PERIOD_SECS: u64 = 3;

#[derive(Debug)]
pub enum ProcessError {
    ExecutableNotFound(String),
    LaunchFailed(String),
    StartupTimeout(Duration),
    InvalidEndpoint(String),
    NonLoopbackEndpoint(String),
    SandboxUnavailable(String),
    TerminationFailed(String),
    ContainmentUnavailable(String),
    ContainmentUnproven(i32),
    Signal(i32),
    Reap(String),
    StderrOverflow,
    Io(std::io::Error),
}

impl fmt::Display for ProcessError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ExecutableNotFound(path) => write!(f, "browser executable not found: {path}"),
            Self::LaunchFailed(err) => write!(f, "failed to launch browser process: {err}"),
            Self::StartupTimeout(d) => write!(f, "browser failed to emit debug port within {d:?}"),
            Self::InvalidEndpoint(ep) => write!(f, "invalid browser debug endpoint: {ep}"),
            Self::NonLoopbackEndpoint(ep) => write!(f, "browser debug endpoint is not loopback: {ep}"),
            Self::SandboxUnavailable(err) => write!(f, "browser sandbox cannot be initialized: {err}"),
            Self::TerminationFailed(err) => write!(f, "failed to terminate browser process group: {err}"),
            Self::ContainmentUnavailable(err) => write!(f, "containment unavailable: {err}"),
            Self::ContainmentUnproven(pgid) => write!(f, "containment unproven for process group {pgid}"),
            Self::Signal(code) => write!(f, "process signal error (errno {code})"),
            Self::Reap(err) => write!(f, "process reap error: {err}"),
            Self::StderrOverflow => write!(f, "stderr output exceeded 64KiB without valid port"),
            Self::Io(err) => write!(f, "I/O error: {err}"),
        }
    }
}

impl std::error::Error for ProcessError {}

impl From<std::io::Error> for ProcessError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

#[derive(Debug, Clone)]
pub struct BrowserLaunchConfig {
    pub executable_path: Option<PathBuf>,
    pub user_data_dir: PathBuf,
    pub headless: bool,
    pub additional_args: Vec<String>,
}

impl BrowserLaunchConfig {
    pub fn new(user_data_dir: PathBuf) -> Self {
        Self {
            executable_path: None,
            user_data_dir,
            headless: true,
            additional_args: Vec::new(),
        }
    }
}

/// Discover browser executable from DAM_HOPPER_BROWSER_EXECUTABLE or standard system paths
pub fn find_browser_executable(configured: Option<&Path>) -> Result<PathBuf, ProcessError> {
    if let Some(path) = configured {
        if path.is_file() {
            return Ok(path.to_path_buf());
        }
        return Err(ProcessError::ExecutableNotFound(path.display().to_string()));
    }

    if let Ok(env_path) = std::env::var("DAM_HOPPER_BROWSER_EXECUTABLE") {
        let p = PathBuf::from(env_path);
        if p.is_file() {
            return Ok(p);
        }
        return Err(ProcessError::ExecutableNotFound(p.display().to_string()));
    }

    let candidates: &[&str] = &[
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ];

    for candidate in candidates {
        let path = Path::new(candidate);
        if path.is_file() {
            return Ok(path.to_path_buf());
        }
        if let Some(paths) = std::env::var_os("PATH") {
            for dir in std::env::split_paths(&paths) {
                let full_path = dir.join(candidate);
                if full_path.is_file() {
                    return Ok(full_path);
                }
            }
        }
    }

    Err(ProcessError::ExecutableNotFound(
        "no Chrome or Chromium executable found in standard locations or PATH".to_string(),
    ))
}

pub struct BrowserProcess {
    child: Option<Child>,
    pid: u32,
    #[cfg(unix)]
    pgid: i32,
    ws_endpoint: String,
    user_data_dir: PathBuf,
}

impl BrowserProcess {
    /// Launch supervised browser instance
    pub async fn launch(config: BrowserLaunchConfig) -> Result<Self, ProcessError> {
        // Validate arguments against allowlist before attempting discovery
        for arg in &config.additional_args {
            if !is_allowlisted_arg(arg) {
                return Err(ProcessError::LaunchFailed(format!(
                    "disallowed argument: {arg}"
                )));
            }
        }

        let exec_path = find_browser_executable(config.executable_path.as_deref())?;
        // Ensure user-data-dir exists with restricted permissions
        std::fs::create_dir_all(&config.user_data_dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&config.user_data_dir, std::fs::Permissions::from_mode(0o700));
        }
        // Clean up any stale DevToolsActivePort from previous runs
        let _ = std::fs::remove_file(config.user_data_dir.join("DevToolsActivePort"));

        let mut cmd = Command::new(&exec_path);

        // Core allowlisted flags - SANDBOX REMAINS ON, WEB SECURITY REMAINS ON
        cmd.arg("--remote-debugging-port=0")
            .arg(format!("--user-data-dir={}", config.user_data_dir.display()))
            .arg("--no-first-run")
            .arg("--no-default-browser-check")
            .arg("--disable-background-networking")
            .arg("--disable-backgrounding-occluded-windows")
            .arg("--disable-breakpad")
            .arg("--disable-client-side-phishing-detection")
            .arg("--disable-component-update")
            .arg("--disable-default-apps")
            .arg("--disable-extensions")
            .arg("--disable-features=Translate,BackForwardCache,AcceptCHFrame")
            .arg("--disable-hang-monitor")
            .arg("--disable-ipc-flooding-protection")
            .arg("--disable-popup-blocking")
            .arg("--disable-prompt-on-repost")
            .arg("--disable-renderer-backgrounding")
            .arg("--disable-sync")
            .arg("--force-color-profile=srgb")
            .arg("--metrics-recording-only")
            .arg("--use-mock-keychain");

        if config.headless {
            cmd.arg("--headless=new");
        }
        for arg in &config.additional_args {
            cmd.arg(arg);
        }

        cmd.arg("about:blank");

        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::piped());

        // Configure process containment
        #[cfg(unix)]
        {
            cmd.process_group(0);
            #[cfg(target_os = "linux")]
            unsafe {
                cmd.pre_exec(|| {
                    let _ = libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
                    Ok(())
                });
            }
        }
        #[cfg(not(unix))]
        {
            return Err(ProcessError::ContainmentUnavailable(
                "Windows Job Object containment not implemented; launch rejected in strict containment mode".to_string()
            ));
        }

        let mut child = cmd.spawn().map_err(|e| ProcessError::LaunchFailed(e.to_string()))?;
        let pid = child.id().ok_or_else(|| ProcessError::LaunchFailed("child missing pid".to_string()))?;
        #[cfg(unix)]
        let pgid = pid as i32;
        #[cfg(unix)]
        let mut pg_guard = ProcessGroupGuard { pgid, armed: true };

        let stderr = child.stderr.take().ok_or_else(|| ProcessError::LaunchFailed("missing stderr pipe".to_string()))?;

        let deadline = Duration::from_secs(STARTUP_TIMEOUT_SECS);
        let user_data_dir = config.user_data_dir.clone();

        let (ws_endpoint, mut stderr) = match timeout(deadline, discover_ws_endpoint(stderr, &user_data_dir)).await {
            Ok(Ok(pair)) => pair,
            Ok(Err(e)) => return Err(e),
            Err(_) => return Err(ProcessError::StartupTimeout(deadline)),
        };

        // Drain remaining stderr to sink so Chrome never blocks or encounters EPIPE
        tokio::spawn(async move {
            let mut sink = tokio::io::sink();
            let _ = tokio::io::copy(&mut stderr, &mut sink).await;
        });

        // Validate loopback
        validate_loopback_endpoint(&ws_endpoint)?;

        info!(pid, "supervised browser launched on loopback DevTools endpoint");

        #[cfg(unix)]
        {
            pg_guard.armed = false;
        }

        Ok(Self {
            child: Some(child),
            pid,
            #[cfg(unix)]
            pgid,
            ws_endpoint,
            user_data_dir: config.user_data_dir,
        })
    }
    pub fn ws_endpoint(&self) -> &str {
        &self.ws_endpoint
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn user_data_dir(&self) -> &Path {
        &self.user_data_dir
    }

    /// Terminate browser and wait for all descendants in the process group to exit.
    pub async fn terminate(&mut self) -> Result<(), ProcessError> {
        if self.child.is_none() {
            return Ok(());
        }

        info!(pid = self.pid, "terminating browser process group");

        #[cfg(unix)]
        {
            use nix::unistd::Pid;

            let pg = Pid::from_raw(self.pgid);

            // Step 1: Send SIGTERM to entire process group
            let _ = nix::sys::signal::killpg(pg, nix::sys::signal::Signal::SIGTERM);

            // Step 2: Grace period (up to 3s)
            let grace = Instant::now() + Duration::from_secs(SHUTDOWN_GRACE_PERIOD_SECS);
            while Instant::now() < grace && live_members(self.pgid)? > 0 {
                sleep(Duration::from_millis(50)).await;
            }

            // Step 3: Send SIGKILL to the process group
            match nix::sys::signal::killpg(pg, nix::sys::signal::Signal::SIGKILL) {
                Ok(()) | Err(nix::errno::Errno::ESRCH) => {}
                Err(e) => return Err(ProcessError::Signal(e as i32)),
            }

            // Step 4: Prove group emptiness within 2s proof deadline
            let proof_deadline = Instant::now() + Duration::from_secs(2);
            while live_members(self.pgid)? > 0 {
                if Instant::now() >= proof_deadline {
                    return Err(ProcessError::ContainmentUnproven(self.pgid));
                }
                sleep(Duration::from_millis(50)).await;
            }

            // Step 5: Reap leader child LAST after descendants exit
            if let Some(child) = self.child.as_mut() {
                child.wait().await.map_err(|e| ProcessError::Reap(e.to_string()))?;
            }
        }

        #[cfg(not(unix))]
        {
            return Err(ProcessError::ContainmentUnavailable(
                "Windows Job Object containment not implemented".to_string(),
            ));
        }
        self.child = None;
        Ok(())
    }
}

#[cfg(target_os = "linux")]
fn live_members(pgid: i32) -> Result<usize, ProcessError> {
    use nix::sys::signal::killpg;
    use nix::unistd::Pid;

    // Kernel-authoritative signal check: if ESRCH, the kernel guarantees zero processes exist in the pgid
    match killpg(Pid::from_raw(pgid), None) {
        Err(nix::errno::Errno::ESRCH) => return Ok(0),
        Err(e) if e != nix::errno::Errno::EPERM => return Err(ProcessError::Signal(e as i32)),
        _ => {}
    }

    let procs = procfs::process::all_processes()
        .map_err(|e| ProcessError::TerminationFailed(e.to_string()))?;

    let mut count = 0;
    for p in procs {
        match p {
            Ok(proc) => match proc.stat() {
                Ok(stat) => {
                    if stat.pgrp == pgid && stat.state != 'Z' {
                        count += 1;
                    }
                }
                Err(procfs::ProcError::NotFound(_)) => {}
                Err(e) => {
                    return Err(ProcessError::TerminationFailed(format!(
                        "failed to stat process during containment check: {e}"
                    )));
                }
            },
            Err(procfs::ProcError::NotFound(_)) => {}
            Err(e) => {
                return Err(ProcessError::TerminationFailed(format!(
                    "failed to inspect procfs during containment check: {e}"
                )));
            }
        }
    }
    Ok(count)
}

#[cfg(all(unix, not(target_os = "linux")))]
fn live_members(pgid: i32) -> Result<usize, ProcessError> {
    use nix::sys::signal::killpg;
    use nix::unistd::Pid;
    match killpg(Pid::from_raw(pgid), None) {
        Ok(()) => Ok(1),
        Err(nix::errno::Errno::ESRCH) => Ok(0),
        Err(e) => Err(ProcessError::Signal(e as i32)),
    }
}

impl Drop for BrowserProcess {
    fn drop(&mut self) {
        if self.child.is_some() {
            #[cfg(unix)]
            {
                use nix::sys::signal::{killpg, Signal};
                use nix::unistd::Pid;
                let _ = killpg(Pid::from_raw(self.pgid), Signal::SIGKILL);
            }
        }
    }
}
#[cfg(unix)]
struct ProcessGroupGuard {
    pgid: i32,
    armed: bool,
}

#[cfg(unix)]
impl Drop for ProcessGroupGuard {
    fn drop(&mut self) {
        if self.armed {
            use nix::sys::signal::{killpg, Signal};
            use nix::unistd::Pid;
            let _ = killpg(Pid::from_raw(self.pgid), Signal::SIGKILL);
        }
    }
}

fn is_allowlisted_arg(arg: &str) -> bool {
    if arg.starts_with("--remote-debugging")
        || arg.starts_with("--remote-allow-origins")
        || arg.starts_with("--user-data-dir")
        || arg.starts_with("--load-extension")
        || arg.contains("no-sandbox")
        || arg.contains("disable-web-security")
        || arg.contains("ignore-certificate-errors")
        || arg.contains("disable-site-isolation")
    {
        return false;
    }

    const SAFE_PREFIXES: &[&str] = &[
        "--window-size=",
        "--user-agent=",
        "--lang=",
        "--force-device-scale-factor=",
        "--default-background-color=",
    ];
    SAFE_PREFIXES.iter().any(|prefix| arg.starts_with(prefix))
}

/// Discover WebSocket debugger URL from either DevToolsActivePort file or stderr logs,
/// reading stderr in incremental chunks without unbounded line allocations, and
/// corroborating stderr endpoint against DevToolsActivePort when both are present.
pub async fn discover_ws_endpoint<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
    mut stderr: R,
    user_data_dir: &Path,
) -> Result<(String, R), ProcessError> {
    let port_file = user_data_dir.join("DevToolsActivePort");

    let mut captured_bytes: Vec<u8> = Vec::with_capacity(4096);
    let mut total_bytes_read = 0;
    let mut stderr_eof = false;

    let mut stderr_endpoint: Option<String> = None;
    let mut port_file_endpoint: Option<String> = None;
    let mut first_endpoint_discovered_at: Option<Instant> = None;

    let poll_interval = Duration::from_millis(50);
    let start = Instant::now();
    let deadline = start + Duration::from_secs(STARTUP_TIMEOUT_SECS);
    let mut chunk = [0u8; 1024];
    loop {
        // 1. Check if DevToolsActivePort exists (strictly bounded to 512 bytes)
        if port_file_endpoint.is_none() && port_file.is_file() {
            if let Ok(file) = std::fs::File::open(&port_file) {
                use std::io::Read;
                let mut content = String::new();
                let mut limited = file.take(513);
                if limited.read_to_string(&mut content).is_ok() {
                    if content.len() > 512 {
                        return Err(ProcessError::InvalidEndpoint("port file exceeded 512 bytes".to_string()));
                    }
                    let lines: Vec<&str> = content.lines().collect();
                    if lines.len() >= 2 {
                        let port: u16 = lines[0].trim().parse().map_err(|_| {
                            ProcessError::InvalidEndpoint(format!("invalid port in DevToolsActivePort: {}", lines[0]))
                        })?;
                        let browser_path = lines[1].trim();
                        let devtools_prefix = "/devtools/browser/";
                        if browser_path.starts_with(devtools_prefix)
                            && browser_path.len() > devtools_prefix.len()
                            && browser_path.len() <= 128
                        {
                            let id_part = &browser_path[devtools_prefix.len()..];
                            if !id_part.is_empty() && id_part.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
                                let url = format!("ws://127.0.0.1:{port}{browser_path}");
                                if validate_loopback_endpoint(&url).is_ok() {
                                    port_file_endpoint = Some(url);
                                }
                            }
                        }
                    }
                }
            }
        }

        // 2. Incremental chunk-based read from stderr
        tokio::select! {
            read_res = stderr.read(&mut chunk), if !stderr_eof && stderr_endpoint.is_none() => {
                match read_res {
                    Ok(0) => {
                        stderr_eof = true;
                    }
                    Ok(n) => {
                        total_bytes_read += n;
                        if total_bytes_read > MAX_STDERR_CAPTURE_BYTES {
                            return Err(ProcessError::StderrOverflow);
                        }
                        captured_bytes.extend_from_slice(&chunk[..n]);

                        // Look for ws:// in captured bytes, ensuring token is fully delimited
                        let text = String::from_utf8_lossy(&captured_bytes);
                        if let Some(idx) = text.find("ws://") {
                            let sub = &text[idx..];
                            let maybe_end = sub.find(|c: char| c.is_whitespace() || c == '\r' || c == '\n');
                            if let Some(end_idx) = maybe_end {
                                let ep = sub[..end_idx].trim().to_string();
                                if validate_loopback_endpoint(&ep).is_ok() {
                                    stderr_endpoint = Some(ep);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        return Err(ProcessError::LaunchFailed(format!("stderr read error: {e}")));
                    }
                }

                // Check token again on EOF if endpoint is not terminated by a newline
                if stderr_eof && stderr_endpoint.is_none() {
                    let text = String::from_utf8_lossy(&captured_bytes);
                    if let Some(idx) = text.find("ws://") {
                        let sub = &text[idx..];
                        let end_idx = sub.find(|c: char| c.is_whitespace() || c == '\r' || c == '\n').unwrap_or(sub.len());
                        let ep = sub[..end_idx].trim().to_string();
                        if validate_loopback_endpoint(&ep).is_ok() {
                            stderr_endpoint = Some(ep);
                        }
                    }
                }
            }
            _ = tokio::time::sleep_until(deadline) => {
                return Err(ProcessError::StartupTimeout(Duration::from_secs(STARTUP_TIMEOUT_SECS)));
            }
            _ = sleep(poll_interval) => {}
        }

        // 3. Corroboration and settlement:
        // Both sources present: must strictly corroborate port and path
        if let (Some(pf), Some(se)) = (&port_file_endpoint, &stderr_endpoint) {
            let pf_url = url::Url::parse(pf).map_err(|e| ProcessError::InvalidEndpoint(e.to_string()))?;
            let se_url = url::Url::parse(se).map_err(|e| ProcessError::InvalidEndpoint(e.to_string()))?;

            if pf_url.port() != se_url.port() || pf_url.path() != se_url.path() {
                return Err(ProcessError::InvalidEndpoint(format!(
                    "endpoint corroboration failed: stderr ({se}) does not match DevToolsActivePort ({pf})"
                )));
            }
            return Ok((pf.clone(), stderr));
        }

        // If at least one endpoint is discovered, wait up to 300ms for companion to corroborate.
        // Once 300ms have elapsed (or stderr is EOF), settle on the valid endpoint.
        if let Some(first_seen) = first_endpoint_discovered_at {
            if first_seen.elapsed() >= Duration::from_millis(300) || stderr_eof {
                let endpoint = port_file_endpoint.as_ref().or(stderr_endpoint.as_ref()).unwrap();
                return Ok((endpoint.clone(), stderr));
            }
        } else if port_file_endpoint.is_some() || stderr_endpoint.is_some() {
            first_endpoint_discovered_at = Some(Instant::now());
        }
    }
}
/// Ensure browser endpoint connects strictly to loopback interface and matches DevTools URL schema
pub fn validate_loopback_endpoint(ws_url: &str) -> Result<(), ProcessError> {
    let parsed = url::Url::parse(ws_url).map_err(|e| ProcessError::InvalidEndpoint(e.to_string()))?;

    if parsed.scheme() != "ws" {
        return Err(ProcessError::InvalidEndpoint(format!(
            "invalid scheme '{}', expected 'ws'",
            parsed.scheme()
        )));
    }

    match parsed.host() {
        Some(url::Host::Domain("localhost")) => {}
        Some(url::Host::Ipv4(ip)) if ip.is_loopback() => {}
        Some(url::Host::Ipv6(ip)) if ip.is_loopback() => {}
        Some(host) => return Err(ProcessError::NonLoopbackEndpoint(format!("host {host} is not a loopback address"))),
        None => return Err(ProcessError::InvalidEndpoint("missing host".to_string())),
    }

    match parsed.port() {
        Some(port) if port > 0 => {}
        Some(_) => return Err(ProcessError::InvalidEndpoint("port cannot be 0".to_string())),
        None => return Err(ProcessError::InvalidEndpoint("missing port in DevTools URL".to_string())),
    }

    let path = parsed.path();
    if !path.starts_with("/devtools/browser/")
        || path.len() <= "/devtools/browser/".len()
        || path.len() > 128
    {
        return Err(ProcessError::InvalidEndpoint(format!(
            "invalid devtools path '{path}', expected '/devtools/browser/UUID'"
        )));
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(ProcessError::InvalidEndpoint("credentials in DevTools URL are forbidden".to_string()));
    }
    if parsed.query().is_some() {
        return Err(ProcessError::InvalidEndpoint("query parameters in DevTools URL are forbidden".to_string()));
    }
    if parsed.fragment().is_some() {
        return Err(ProcessError::InvalidEndpoint("fragment in DevTools URL is forbidden".to_string()));
    }

    Ok(())
}
