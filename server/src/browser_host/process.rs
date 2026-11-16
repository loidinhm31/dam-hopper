use std::fmt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::time::{sleep, timeout, Instant};
use tracing::{info, warn};

#[cfg(target_os = "linux")]
mod death_watcher;

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
    /// A prior browser tree is still alive but its ownership cannot be verified.
    OwnershipAmbiguous(String),
    /// A verified prior browser tree survived TERM and KILL.
    PriorTreeSurvived(String),
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
            Self::NonLoopbackEndpoint(ep) => {
                write!(f, "browser debug endpoint is not loopback: {ep}")
            }
            Self::SandboxUnavailable(err) => {
                write!(f, "browser sandbox cannot be initialized: {err}")
            }
            Self::TerminationFailed(err) => {
                write!(f, "failed to terminate browser process group: {err}")
            }
            Self::ContainmentUnavailable(err) => write!(f, "containment unavailable: {err}"),
            Self::ContainmentUnproven(pgid) => {
                write!(f, "containment unproven for process group {pgid}")
            }
            Self::OwnershipAmbiguous(msg) => {
                write!(f, "prior browser tree ownership unverified: {msg}")
            }
            Self::PriorTreeSurvived(msg) => {
                write!(f, "prior browser tree survived termination: {msg}")
            }
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
    /// Ownership token exported (`LAUNCH_TOKEN_ENV`) to the browser and every descendant.
    /// `None` generates a fresh token; callers persist it BEFORE launching so a crash between
    /// spawn and the identity write still leaves a verifiable marker.
    pub launch_token: Option<String>,
    #[doc(hidden)]
    pub _test_mock_watcher_pre_exec_fail: bool,
    /// Forces the death watcher's arming step to fail after its pre-exec setup succeeded.
    #[doc(hidden)]
    pub _test_mock_watcher_arming_fail: bool,
    /// Makes the watcher behave as on a kernel without `PIDFD_SIGNAL_PROCESS_GROUP` (< 6.9),
    /// where launch must fail closed.
    #[doc(hidden)]
    pub _test_force_watcher_group_signal_unsupported: bool,
}

impl BrowserLaunchConfig {
    pub fn new(user_data_dir: PathBuf) -> Self {
        Self {
            executable_path: None,
            user_data_dir,
            headless: true,
            additional_args: Vec::new(),
            _test_mock_watcher_pre_exec_fail: false,
            _test_mock_watcher_arming_fail: false,
            _test_force_watcher_group_signal_unsupported: false,
            launch_token: None,
        }
    }
}

/// Discover browser executable exclusively from explicit configuration or DAM_HOPPER_BROWSER_EXECUTABLE.
/// Per architecture-contracts.md §2, automatic PATH and standard-location discovery is disabled.
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

    Err(ProcessError::ExecutableNotFound(
        "explicit browser executable path required via configuration or DAM_HOPPER_BROWSER_EXECUTABLE; automatic PATH discovery is disabled per security architecture contracts".to_string(),
    ))
}

/// Validate that a string is a canonical 36-character lowercase hyphenated UUID (RFC 4122/9562).
pub fn is_canonical_uuid(s: &str) -> bool {
    if s.len() != 36 {
        return false;
    }
    let b = s.as_bytes();
    if b[8] != b'-' || b[13] != b'-' || b[18] != b'-' || b[23] != b'-' {
        return false;
    }
    for (i, &byte) in b.iter().enumerate() {
        if i == 8 || i == 13 || i == 18 || i == 23 {
            continue;
        }
        if !byte.is_ascii_hexdigit() || (byte.is_ascii_alphabetic() && !byte.is_ascii_lowercase()) {
            return false;
        }
    }
    uuid::Uuid::try_parse(s).is_ok()
}

/// Validate DevTools endpoint path: must be exactly `/devtools/browser/<canonical UUID>` without extra segments or queries.
pub fn validate_browser_path(path: &str) -> Result<(), ProcessError> {
    const PREFIX: &str = "/devtools/browser/";
    if !path.starts_with(PREFIX) {
        return Err(ProcessError::InvalidEndpoint(
            "devtools path missing expected prefix".to_string(),
        ));
    }
    let id_part = &path[PREFIX.len()..];
    if id_part.contains('/') {
        return Err(ProcessError::InvalidEndpoint(
            "devtools path contains forbidden extra segments".to_string(),
        ));
    }
    if id_part.contains('?') || id_part.contains('#') {
        return Err(ProcessError::InvalidEndpoint(
            "devtools path contains forbidden query or fragment".to_string(),
        ));
    }
    if !is_canonical_uuid(id_part) {
        return Err(ProcessError::InvalidEndpoint(
            "devtools path identifier is not a canonical 36-char lowercase UUID".to_string(),
        ));
    }
    Ok(())
}

/// Ensure browser endpoint connects strictly to loopback interface and matches DevTools URL schema.
pub fn validate_loopback_endpoint(ws_url: &str) -> Result<(), ProcessError> {
    let parsed = url::Url::parse(ws_url)
        .map_err(|_| ProcessError::InvalidEndpoint("failed to parse WebSocket URL".to_string()))?;

    if parsed.scheme() != "ws" {
        return Err(ProcessError::InvalidEndpoint(
            "invalid scheme, expected 'ws'".to_string(),
        ));
    }

    match parsed.host() {
        Some(url::Host::Domain("localhost")) => {}
        Some(url::Host::Ipv4(ip)) if ip.is_loopback() => {}
        Some(url::Host::Ipv6(ip)) if ip.is_loopback() => {}
        Some(_) => {
            return Err(ProcessError::NonLoopbackEndpoint(
                "endpoint host is not a loopback address".to_string(),
            ))
        }
        None => {
            return Err(ProcessError::InvalidEndpoint(
                "missing host in DevTools URL".to_string(),
            ))
        }
    }

    match parsed.port() {
        Some(port) if port > 0 => {}
        Some(_) => {
            return Err(ProcessError::InvalidEndpoint(
                "port cannot be 0".to_string(),
            ))
        }
        None => {
            return Err(ProcessError::InvalidEndpoint(
                "missing port in DevTools URL".to_string(),
            ))
        }
    }

    validate_browser_path(parsed.path())?;

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(ProcessError::InvalidEndpoint(
            "credentials in DevTools URL are forbidden".to_string(),
        ));
    }
    if parsed.query().is_some() {
        return Err(ProcessError::InvalidEndpoint(
            "query parameters in DevTools URL are forbidden".to_string(),
        ));
    }
    if parsed.fragment().is_some() {
        return Err(ProcessError::InvalidEndpoint(
            "fragment in DevTools URL is forbidden".to_string(),
        ));
    }

    Ok(())
}

pub struct BrowserProcess {
    child: Option<Child>,
    pid: u32,
    #[cfg(unix)]
    pgid: i32,
    #[cfg(unix)]
    watcher: Option<PidHandle>,
    #[cfg(unix)]
    leader: Option<PidHandle>,
    #[cfg(unix)]
    supervisor_pipe: Option<std::fs::File>,
    ws_endpoint: String,
    user_data_dir: PathBuf,
    identity: ContainmentIdentity,
}

impl BrowserProcess {
    /// Launch supervised browser instance
    pub async fn launch(config: BrowserLaunchConfig) -> Result<Self, ProcessError> {
        // Validate arguments against strict allowlist before attempting launch
        for arg in &config.additional_args {
            if !is_allowlisted_arg(arg) {
                return Err(ProcessError::LaunchFailed(format!(
                    "disallowed argument: {arg}"
                )));
            }
        }

        let exec_path = find_browser_executable(config.executable_path.as_deref())?;

        // Ensure user-data-dir exists with restricted permissions (0o700)
        std::fs::create_dir_all(&config.user_data_dir).map_err(|e| {
            ProcessError::LaunchFailed(format!("failed to create user-data-dir: {e}"))
        })?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(
                &config.user_data_dir,
                std::fs::Permissions::from_mode(0o700),
            )
            .map_err(|e| {
                ProcessError::LaunchFailed(format!(
                    "failed to set restricted permissions (0700) on user-data-dir: {e}"
                ))
            })?;
        }

        // Clean up any stale DevToolsActivePort from previous runs (fail closed on permission/IO error)
        let stale_port_file = config.user_data_dir.join("DevToolsActivePort");
        if let Err(e) = std::fs::remove_file(&stale_port_file) {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(ProcessError::LaunchFailed(format!(
                    "failed to remove stale DevToolsActivePort file: {e}"
                )));
            }
        }

        let mut cmd = Command::new(&exec_path);

        // Core allowlisted flags per architecture-contracts §2:
        // explicit executable, --headless=new, restricted managed user-data-dir, --remote-debugging-port=0.
        // Copied background-throttling/IPC/hang-monitor/keychain overrides REMOVED.
        // Default sandbox, TLS verification, and web security remain strictly ACTIVE.
        cmd.arg("--remote-debugging-port=0")
            .arg(format!(
                "--user-data-dir={}",
                config.user_data_dir.display()
            ))
            .arg("--no-first-run")
            .arg("--no-default-browser-check")
            .arg("--disable-blink-features=AutomationControlled")
            .arg("--autoplay-policy=no-user-gesture-required");
        if config.headless {
            cmd.arg("--headless=new");
        }
        for arg in &config.additional_args {
            cmd.arg(arg);
        }

        let launch_token = config
            .launch_token
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string());
        cmd.env(LAUNCH_TOKEN_ENV, &launch_token);

        cmd.arg("about:blank");

        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::null());
        cmd.stderr(Stdio::piped());

        // Process containment setup:
        // An anonymous death-pipe is created before spawn.
        // In pre_exec, the child process atomically forks a supervisor watcher grandchild
        // BEFORE executing Chrome. The watcher (`death_watcher`, raw syscalls, no exec) holds a
        // pidfd on the leader and sets its own PGID. When the supervisor process exits for ANY
        // reason (including SIGKILL), the kernel closes pipe_write, causing the watcher to see
        // EOF and signal Chrome's process group with SIGTERM then SIGKILL through pidfd-bound
        // identities only (never a bare pid/pgid number), and exit.
        // This eliminates any race window between Chrome spawn and watcher readiness.
        // The death-pipe write end is the kill switch of the supervisor watcher and lives across
        // the async startup wait below: it is RAII-owned (`OwnedFd`) so that cancelling this
        // future (e.g. the manager's outer startup timeout) closes it instead of leaking it.
        // Both ends are created O_CLOEXEC atomically so a concurrent spawn elsewhere in the
        // process can never inherit them (an inherited write end would stop the watcher from
        // ever seeing EOF).
        #[cfg(unix)]
        let (pipe_read, pipe_write, ready_read, ready_write) = {
            use std::os::unix::io::{FromRawFd, OwnedFd};
            let mut death_fds = [0i32; 2];
            let res = unsafe { libc::pipe2(death_fds.as_mut_ptr(), libc::O_CLOEXEC) };
            if res != 0 {
                return Err(ProcessError::LaunchFailed(format!(
                    "failed to create supervisor containment pipe: {}",
                    std::io::Error::last_os_error()
                )));
            }
            // SAFETY: the descriptor was just created by pipe2 and is owned exclusively here.
            let death_write = unsafe { OwnedFd::from_raw_fd(death_fds[1]) };

            let mut ready_fds = [0i32; 2];
            let res = unsafe { libc::pipe2(ready_fds.as_mut_ptr(), libc::O_CLOEXEC) };
            if res != 0 {
                unsafe {
                    libc::close(death_fds[0]);
                }
                return Err(ProcessError::LaunchFailed(format!(
                    "failed to create supervisor watcher readiness pipe: {}",
                    std::io::Error::last_os_error()
                )));
            }
            (death_fds[0], death_write, ready_fds[0], ready_fds[1])
        };

        #[cfg(unix)]
        {
            #[cfg(target_os = "linux")]
            {
                let parent_pid = std::process::id() as libc::pid_t;
                let death_r = pipe_read;
                let ready_w = ready_write;
                let death_w = {
                    use std::os::unix::io::AsRawFd;
                    pipe_write.as_raw_fd()
                };
                let mock_pre_fail = config._test_mock_watcher_pre_exec_fail;
                let mock_arming_fail = config._test_mock_watcher_arming_fail;
                let force_group_signal_unsupported =
                    config._test_force_watcher_group_signal_unsupported;
                unsafe {
                    cmd.pre_exec(move || {
                        // 1. Establish distinct process group for Chrome
                        if libc::setpgid(0, 0) != 0 {
                            return Err(std::io::Error::last_os_error());
                        }
                        let pgid = libc::getpid();

                        // 2. Set PDEATHSIG on Chrome leader and close getppid race
                        if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) != 0 {
                            return Err(std::io::Error::last_os_error());
                        }
                        if libc::getppid() != parent_pid {
                            libc::_exit(1);
                        }

                        // 3. The leader pins itself: a pidfd on its own pid is identity-safe by
                        // construction and survives the fork into the watcher.
                        let leader_pidfd = death_watcher::open_pidfd(pgid);
                        if leader_pidfd < 0 {
                            return Err(std::io::Error::last_os_error());
                        }

                        // 4. Atomically spawn supervisor watcher BEFORE Chrome can execute or fork descendants
                        let watcher_pid = libc::fork();
                        if watcher_pid < 0 {
                            let err = std::io::Error::last_os_error();
                            libc::close(leader_pidfd);
                            return Err(err);
                        }
                        if watcher_pid == 0 {
                            death_watcher::run(death_watcher::Params {
                                leader_pidfd,
                                death_read: death_r,
                                death_write: death_w,
                                ready_write: ready_w,
                                mock_pre_exec_fail: mock_pre_fail,
                                mock_arming_fail,
                                force_group_signal_unsupported,
                            });
                        }
                        // In child (Chrome): close the watcher's descriptors before execve(chrome)
                        libc::close(leader_pidfd);
                        libc::close(death_r);
                        libc::close(ready_w);
                        Ok(())
                    });
                }
            }
            #[cfg(not(target_os = "linux"))]
            {
                cmd.process_group(0);
            }
        }
        #[cfg(not(unix))]
        {
            return Err(ProcessError::ContainmentUnavailable(
                "Windows Job Object containment requires windows-sys features Win32_System_JobObjects, Win32_System_Threading, and Win32_Security (slice C dependency ownership); failing closed with ContainmentUnavailable per security architecture contracts".to_string(),
            ));
        }

        let mut child = cmd.spawn().map_err(|e| {
            #[cfg(unix)]
            unsafe {
                libc::close(pipe_read);
                libc::close(ready_read);
                libc::close(ready_write);
            }
            ProcessError::LaunchFailed(e.to_string())
        })?;

        #[cfg(unix)]
        unsafe {
            libc::close(pipe_read);
            libc::close(ready_write);
        }

        let pid = match child.id() {
            Some(p) => p,
            None => {
                #[cfg(unix)]
                unsafe {
                    libc::close(ready_read);
                }
                return Err(ProcessError::LaunchFailed("child missing pid".to_string()));
            }
        };

        #[cfg(unix)]
        let pgid = pid as i32;
        #[cfg(unix)]
        let mut pg_guard = ProcessGroupGuard {
            identity: ContainmentIdentity::capture(pid, Some(pgid), Some(launch_token.clone())),
            user_data_dir: config.user_data_dir.clone(),
            armed: true,
        };

        // Verify supervisor watcher readiness using bounded poll on the CLOEXEC readiness pipe:
        // the watcher writes its pid once its setup (own group, descriptor table, leader pidfd)
        // is done, then closes the pipe: EOF (0 further bytes) proves arming succeeded. Any
        // further byte is the errno of a failed arming step; a timeout means startup stalled.
        #[cfg(unix)]
        let watcher_pid = {
            let mut pfd = libc::pollfd {
                fd: ready_read,
                events: libc::POLLIN | libc::POLLHUP,
                revents: 0,
            };
            let poll_res = unsafe { libc::poll(&mut pfd, 1, 2000) };
            if poll_res <= 0 {
                unsafe {
                    libc::close(ready_read);
                }
                return Err(ProcessError::LaunchFailed(
                    "supervisor watcher startup timed out".to_string(),
                ));
            }

            let mut pid_buf = [0u8; 4];
            let n = unsafe { libc::read(ready_read, pid_buf.as_mut_ptr() as *mut libc::c_void, 4) };
            if n != 4 {
                unsafe {
                    libc::close(ready_read);
                }
                return Err(ProcessError::LaunchFailed(
                    "supervisor watcher pre-exec setup failed".to_string(),
                ));
            }
            let wpid = u32::from_ne_bytes(pid_buf) as i32;

            // Read trailing byte if arming failed; on success the watcher closed ready_w (EOF, n_extra == 0)
            let mut err_byte = [0u8; 1];
            let n_extra =
                unsafe { libc::read(ready_read, err_byte.as_mut_ptr() as *mut libc::c_void, 1) };
            unsafe {
                libc::close(ready_read);
            }
            if n_extra > 0 {
                return Err(ProcessError::LaunchFailed(format!(
                    "supervisor watcher arming failed with errno {}{}",
                    err_byte[0],
                    if i32::from(err_byte[0]) == libc::EINVAL {
                        " (Linux 6.9+ with pidfd process-group signalling is required)"
                    } else {
                        ""
                    }
                )));
            }

            // Verify watcher liveness and independent PGID
            unsafe {
                if libc::kill(wpid, 0) != 0 || libc::getpgid(wpid) != wpid {
                    return Err(ProcessError::LaunchFailed(
                        "supervisor watcher liveness or process group verification failed"
                            .to_string(),
                    ));
                }
            }
            wpid
        };
        // Pin leader and watcher now, while both numbers provably name our processes: the
        // leader is our unreaped child, the watcher is the leader's child (verified once the
        // handle is held). All later signalling goes through these handles.
        #[cfg(unix)]
        let (leader, watcher) = match PidHandle::open_child_of(
            pid as i32,
            std::process::id() as i32,
        )
        .and_then(|leader| {
            PidHandle::open_child_of(watcher_pid, pid as i32).map(|watcher| (leader, watcher))
        }) {
            Ok(pair) => pair,
            Err(e) => return Err(e),
        };
        let stderr = child.stderr.take().ok_or_else(|| {
            ProcessError::LaunchFailed("missing stderr pipe".to_string())
        })?;

        let deadline = Duration::from_secs(STARTUP_TIMEOUT_SECS);
        let user_data_dir = config.user_data_dir.clone();

        let (ws_endpoint, mut stderr) =
            match timeout(deadline, discover_ws_endpoint(stderr, &user_data_dir)).await {
                Ok(Ok(pair)) => pair,
                Ok(Err(e)) => return Err(e),
                Err(_) => {
                    return Err(ProcessError::StartupTimeout(deadline));
                }
            };

        // Drain remaining stderr to sink so Chrome never blocks or encounters EPIPE
        tokio::spawn(async move {
            let mut sink = tokio::io::sink();
            let _ = tokio::io::copy(&mut stderr, &mut sink).await;
        });

        // Validate loopback and strict canonical UUID path
        validate_loopback_endpoint(&ws_endpoint)?;

        info!(
            pid,
            "supervised browser launched on loopback DevTools endpoint"
        );

        #[cfg(unix)]
        {
            pg_guard.armed = false;
        }

        #[cfg(unix)]
        let supervisor_pipe = Some(std::fs::File::from(pipe_write));

        #[cfg(unix)]
        let identity_pgid = Some(pgid);
        #[cfg(not(unix))]
        let identity_pgid = None;
        let identity = ContainmentIdentity::capture(pid, identity_pgid, Some(launch_token.clone()));

        Ok(Self {
            child: Some(child),
            pid,
            #[cfg(unix)]
            pgid,
            #[cfg(unix)]
            watcher: Some(watcher),
            #[cfg(unix)]
            leader: Some(leader),
            #[cfg(unix)]
            supervisor_pipe,
            ws_endpoint,
            user_data_dir: config.user_data_dir,
            identity,
        })
    }

    pub fn ws_endpoint(&self) -> &str {
        &self.ws_endpoint
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }
    #[cfg(unix)]
    pub fn pgid(&self) -> i32 {
        self.pgid
    }

    /// Persistable containment identity of this launch (pid, pgid, start time, boot id, token).
    pub fn identity(&self) -> ContainmentIdentity {
        self.identity.clone()
    }

    pub fn user_data_dir(&self) -> &Path {
        &self.user_data_dir
    }
    /// Signals the leader through its launch-time handle (valid even after the leader was
    /// reaped) and every group member through a freshly verified inventory.
    #[cfg(unix)]
    async fn signal_group(&self, sig: nix::sys::signal::Signal) -> Result<(), ProcessError> {
        if let Some(leader) = self.leader.as_ref() {
            leader.signal(sig as i32)?;
        }
        #[cfg(target_os = "linux")]
        signal_verified_tree(&self.identity, &self.user_data_dir, sig).await?;
        #[cfg(not(target_os = "linux"))]
        {
            // No pidfd: members beyond the leader cannot be verified; the unreaped leader
            // keeps the group number reserved, so the group signal below stays ours.
            match nix::sys::signal::killpg(nix::unistd::Pid::from_raw(self.pgid), sig) {
                Ok(()) | Err(nix::errno::Errno::ESRCH) => {}
                Err(e) => return Err(ProcessError::Signal(e as i32)),
            }
        }
        Ok(())
    }

    pub fn try_is_alive(&mut self) -> bool {
        if let Some(child) = self.child.as_mut() {
            match child.try_wait() {
                Ok(None) => true,
                Ok(Some(_)) => false,
                Err(_) => false,
            }
        } else {
            false
        }
    }

    /// Terminate browser and wait for all descendants in the process group to exit.
    pub async fn terminate(&mut self) -> Result<(), ProcessError> {
        if self.child.is_none() {
            return Ok(());
        }

        info!(pid = self.pid, "terminating browser process group");

        #[cfg(unix)]
        {
            use nix::sys::signal::Signal;

            // The watcher is signalled through its pinned handle, never a recorded number.
            if let Some(watcher) = self.watcher.take() {
                let _ = watcher.signal(Signal::SIGKILL as i32);
            }
            self.supervisor_pipe = None;
            // Step 2: SIGTERM to the leader handle and to every verified group member.
            if let Err(e) = self.signal_group(Signal::SIGTERM).await {
                warn!(error = %e, "SIGTERM to browser group was not fully delivered");
            }

            // Step 3: Grace period (up to 3s)
            let grace = Instant::now() + Duration::from_secs(SHUTDOWN_GRACE_PERIOD_SECS);
            while Instant::now() < grace && live_members_blocking(self.pgid).await? > 0 {
                sleep(Duration::from_millis(50)).await;
            }

            // Steps 4-5: SIGKILL on every fresh verified inventory until the group is proven
            // empty within the 2s proof deadline (a member forked mid-teardown is caught).
            let proof_deadline = Instant::now() + Duration::from_secs(2);
            loop {
                self.signal_group(Signal::SIGKILL).await?;
                if live_members_blocking(self.pgid).await? == 0 {
                    break;
                }
                if Instant::now() >= proof_deadline {
                    return Err(ProcessError::ContainmentUnproven(self.pgid));
                }
                sleep(Duration::from_millis(50)).await;
            }

            // Step 5b: a descendant that left the process group is still ours (launch token);
            // none may survive the termination either.
            reap_prior_tree(
                &self.identity,
                &self.user_data_dir,
                ReapTimings {
                    settle: Duration::ZERO,
                    term_grace: Duration::from_secs(1),
                    proof: Duration::from_secs(2),
                },
            )
            .await?;

            // Step 6: Reap leader child LAST after descendants exit
            if let Some(child) = self.child.as_mut() {
                child
                    .wait()
                    .await
                    .map_err(|e| ProcessError::Reap(e.to_string()))?;
            }
        }

        #[cfg(not(unix))]
        {
            return Err(ProcessError::ContainmentUnavailable(
                "Windows Job Object containment requires windows-sys features Win32_System_JobObjects, Win32_System_Threading, and Win32_Security (slice C dependency ownership); failing closed with ContainmentUnavailable per security architecture contracts".to_string(),
            ));
        }

        self.child = None;
        Ok(())
    }
}

#[cfg(target_os = "linux")]
pub fn live_members(pgid: i32) -> Result<usize, ProcessError> {
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
pub fn live_members(pgid: i32) -> Result<usize, ProcessError> {
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
                use nix::sys::signal::Signal;
                // Last resort without an async context: pinned handles only. The leader first,
                // then a fresh verified inventory of the rest; never a bare pid or group number.
                if let Some(leader) = self.leader.as_ref() {
                    let _ = leader.signal(Signal::SIGKILL as i32);
                }
                #[cfg(target_os = "linux")]
                if let Ok(TreeState::Owned(tree)) =
                    inspect_prior_tree(&self.identity, &self.user_data_dir)
                {
                    let _ = signal_tree(&tree, Signal::SIGKILL);
                }
                if let Some(watcher) = self.watcher.take() {
                    let _ = watcher.signal(Signal::SIGKILL as i32);
                }
                self.supervisor_pipe = None;
            }
        }
    }
}

/// Kills a half-launched browser tree if `launch` bails out. The leader is still our unreaped
/// child at that point (its number cannot be recycled); the rest of the tree is signalled
/// through the same verified-identity path as [`BrowserProcess`]'s drop, never a bare group
/// number.
#[cfg(unix)]
struct ProcessGroupGuard {
    identity: ContainmentIdentity,
    user_data_dir: PathBuf,
    armed: bool,
}

#[cfg(unix)]
impl Drop for ProcessGroupGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        #[cfg(target_os = "linux")]
        {
            use nix::sys::signal::Signal;
            if let Some(pid) = self.identity.pid {
                if let Ok(leader) = PidHandle::open_child_of(pid as i32, std::process::id() as i32)
                {
                    let _ = leader.signal(Signal::SIGKILL as i32);
                }
            }
            if let Ok(TreeState::Owned(tree)) =
                inspect_prior_tree(&self.identity, &self.user_data_dir)
            {
                let _ = signal_tree(&tree, Signal::SIGKILL);
            }
        }
        #[cfg(not(target_os = "linux"))]
        if let Some(pgid) = self.identity.pgid {
            // No pidfd: the unreaped child leader keeps the group number reserved.
            let _ = nix::sys::signal::killpg(
                nix::unistd::Pid::from_raw(pgid),
                nix::sys::signal::Signal::SIGKILL,
            );
        }
    }
}

fn is_allowlisted_arg(arg: &str) -> bool {
    // Explicit forbidden patterns per architecture contract §2
    if arg.starts_with("--remote-debugging")
        || arg.starts_with("--remote-allow-origins")
        || arg.starts_with("--user-data-dir")
        || arg.starts_with("--load-extension")
        || arg.contains("no-sandbox")
        || arg.contains("disable-web-security")
        || arg.contains("ignore-certificate-errors")
        || arg.contains("disable-site-isolation")
        || arg.contains("password-store")
        || arg.contains("use-mock-keychain")
        || arg.contains("disable-hang-monitor")
        || arg.contains("disable-ipc-flooding")
        || arg.contains("disable-renderer-backgrounding")
        || arg.contains("disable-backgrounding-occluded")
        || arg.contains("disable-background-timer-throttling")
    {
        return false;
    }

    if arg == "--disable-blink-features=AutomationControlled"
        || arg == "--autoplay-policy=no-user-gesture-required"
    {
        return true;
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
                        return Err(ProcessError::InvalidEndpoint(
                            "port file exceeded 512 bytes".to_string(),
                        ));
                    }
                    let lines: Vec<&str> = content.lines().collect();
                    if lines.len() >= 2 {
                        let port: u16 = lines[0].trim().parse().map_err(|_| {
                            ProcessError::InvalidEndpoint(
                                "invalid numeric port in DevToolsActivePort".to_string(),
                            )
                        })?;
                        let browser_path = lines[1].trim();

                        match validate_browser_path(browser_path) {
                            Ok(()) => {
                                let url = format!("ws://127.0.0.1:{port}{browser_path}");
                                validate_loopback_endpoint(&url)?;
                                port_file_endpoint = Some(url);
                            }
                            Err(e) => {
                                // If the port file has completed writing, fail closed immediately
                                if content.ends_with('\n') || browser_path.len() >= 36 {
                                    return Err(e);
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
            let pf_url = url::Url::parse(pf).map_err(|_| {
                ProcessError::InvalidEndpoint("failed to parse port file endpoint URL".to_string())
            })?;
            let se_url = url::Url::parse(se).map_err(|_| {
                ProcessError::InvalidEndpoint("failed to parse stderr endpoint URL".to_string())
            })?;

            if pf_url.port() != se_url.port() || pf_url.path() != se_url.path() {
                return Err(ProcessError::InvalidEndpoint(
                    "endpoint corroboration failed: stderr endpoint does not match DevToolsActivePort".to_string(),
                ));
            }
            return Ok((pf.clone(), stderr));
        }

        // If at least one endpoint is discovered, wait up to 300ms for companion to corroborate.
        // Once 300ms have elapsed (or stderr is EOF), settle on the valid endpoint.
        if let Some(first_seen) = first_endpoint_discovered_at {
            if first_seen.elapsed() >= Duration::from_millis(300) || stderr_eof {
                let endpoint = port_file_endpoint
                    .as_ref()
                    .or(stderr_endpoint.as_ref())
                    .unwrap();
                return Ok((endpoint.clone(), stderr));
            }
        } else if port_file_endpoint.is_some() || stderr_endpoint.is_some() {
            first_endpoint_discovered_at = Some(Instant::now());
        }
    }
}

/// Environment variable carrying the per-launch ownership token to every descendant.
pub const LAUNCH_TOKEN_ENV: &str = "DAM_HOPPER_BROWSER_LAUNCH_TOKEN";

/// Persisted identity of one launched browser tree. A bare PID/PGID is never trusted: the
/// kernel start time (`/proc/<pid>/stat` field 22) plus boot id distinguish a reused number,
/// and the launch token marks every descendant through its environment.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContainmentIdentity {
    #[serde(
        default,
        rename = "processPid",
        skip_serializing_if = "Option::is_none"
    )]
    pub pid: Option<u32>,
    #[serde(
        default,
        rename = "processPgid",
        skip_serializing_if = "Option::is_none"
    )]
    pub pgid: Option<i32>,
    #[serde(
        default,
        rename = "processStartTicks",
        skip_serializing_if = "Option::is_none"
    )]
    pub start_ticks: Option<u64>,
    #[serde(
        default,
        rename = "processBootId",
        skip_serializing_if = "Option::is_none"
    )]
    pub boot_id: Option<String>,
    #[serde(
        default,
        rename = "processLaunchToken",
        skip_serializing_if = "Option::is_none"
    )]
    pub launch_token: Option<String>,
}

impl ContainmentIdentity {
    /// True when nothing is recorded that could name a surviving process.
    pub fn is_empty(&self) -> bool {
        self.pid.is_none() && self.pgid.is_none() && self.launch_token.is_none()
    }

    /// Identity of a live launch, captured while the leader is still a child of this process.
    pub fn capture(pid: u32, pgid: Option<i32>, launch_token: Option<String>) -> Self {
        Self {
            pid: Some(pid),
            pgid,
            start_ticks: process_start_ticks(pid as i32),
            boot_id: current_boot_id(),
            launch_token,
        }
    }

    /// Durable pre-launch intent: only the token exists yet, but every process the coming
    /// launch creates will carry it.
    pub fn launch_intent(launch_token: String) -> Self {
        Self {
            boot_id: current_boot_id(),
            launch_token: Some(launch_token),
            ..Self::default()
        }
    }
}

#[cfg(target_os = "linux")]
fn current_boot_id() -> Option<String> {
    std::fs::read_to_string("/proc/sys/kernel/random/boot_id")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(not(target_os = "linux"))]
fn current_boot_id() -> Option<String> {
    None
}

#[cfg(target_os = "linux")]
fn process_start_ticks(pid: i32) -> Option<u64> {
    procfs::process::Process::new(pid)
        .ok()?
        .stat()
        .ok()
        .map(|stat| stat.starttime)
}

#[cfg(not(target_os = "linux"))]
fn process_start_ticks(_pid: i32) -> Option<u64> {
    None
}

/// Verdict on a persisted prior browser tree.
#[derive(Debug)]
pub enum TreeState {
    /// No process of the tree exists.
    Absent,
    /// Live processes whose ownership is verified; safe to signal.
    Owned(OwnedTree),
    /// Live processes exist but cannot be proven to be the prior tree: never signalled.
    Ambiguous(String),
}

/// Verified live members of a prior tree.
#[derive(Debug, Default)]
pub struct OwnedTree {
    /// Process group whose every live member was verified ours at inventory time.
    group: Option<i32>,
    /// Every verified-ours live process (group members and marked descendants outside the
    /// group) as `(pid, start_ticks)`; each is signalled only through a pinned handle that
    /// re-checks the start time, never through a bare pid or group number.
    members: Vec<(i32, u64)>,
}

impl OwnedTree {
    fn describe(&self) -> String {
        format!(
            "process group {:?} and {} verified member(s)",
            self.group,
            self.members.len()
        )
    }
}

#[cfg(target_os = "linux")]
struct ProcView {
    pid: i32,
    pgrp: i32,
    start_ticks: u64,
    zombie: bool,
    /// Carries the launch token or the exact managed `--user-data-dir=` argument.
    marked: bool,
}

#[cfg(target_os = "linux")]
fn scan_processes(
    token: Option<&str>,
    user_data_dir: &Path,
) -> Result<Vec<ProcView>, ProcessError> {
    use std::ffi::OsStr;

    let user_data_arg = format!("--user-data-dir={}", user_data_dir.display());
    let procs = procfs::process::all_processes()
        .map_err(|e| ProcessError::TerminationFailed(e.to_string()))?;
    let mut views = Vec::new();
    for entry in procs {
        let proc = match entry {
            Ok(proc) => proc,
            Err(procfs::ProcError::NotFound(_)) => continue,
            Err(e) => {
                return Err(ProcessError::TerminationFailed(format!(
                    "failed to inspect procfs during prior-tree check: {e}"
                )))
            }
        };
        let stat = match proc.stat() {
            Ok(stat) => stat,
            Err(procfs::ProcError::NotFound(_)) => continue,
            Err(e) => {
                return Err(ProcessError::TerminationFailed(format!(
                    "failed to stat process during prior-tree check: {e}"
                )))
            }
        };
        let zombie = matches!(stat.state, 'Z' | 'X');
        let mut marked = false;
        if !zombie {
            if let (Some(token), Ok(env)) = (token, proc.environ()) {
                marked = env
                    .get(OsStr::new(LAUNCH_TOKEN_ENV))
                    .is_some_and(|value| value == OsStr::new(token));
            }
            if !marked {
                if let Ok(cmdline) = proc.cmdline() {
                    marked = cmdline.contains(&user_data_arg);
                }
            }
        }
        views.push(ProcView {
            pid: stat.pid,
            pgrp: stat.pgrp,
            start_ticks: stat.starttime,
            zombie,
            marked,
        });
    }
    Ok(views)
}

/// Classifies the processes that remain of a persisted prior tree.
///
/// A pid/pgid alone is never an identity. The kernel keeps a pid number reserved while any
/// process is a member of that group, so: a live leader with a different start time proves the
/// old group is empty; a leader with the recorded start time proves the group is ours; with no
/// leader every live member must carry the launch token or the managed `--user-data-dir`.
/// Anything else is `Ambiguous` and is never signalled.
#[cfg(target_os = "linux")]
pub fn inspect_prior_tree(
    identity: &ContainmentIdentity,
    user_data_dir: &Path,
) -> Result<TreeState, ProcessError> {
    if identity.is_empty() {
        return Ok(TreeState::Absent);
    }
    if let (Some(saved), Some(now)) = (identity.boot_id.as_deref(), current_boot_id()) {
        if saved != now {
            // Every process of a previous boot is gone.
            return Ok(TreeState::Absent);
        }
    }
    if let Some(pgid) = identity.pgid {
        if pgid <= 1 {
            return Ok(TreeState::Ambiguous(format!(
                "invalid non-positive PGID {pgid}"
            )));
        }
    }

    let procs = scan_processes(identity.launch_token.as_deref(), user_data_dir)?;
    let mut tree = OwnedTree::default();
    if let Some(pgid) = identity.pgid {
        let live_group: Vec<&ProcView> = procs
            .iter()
            .filter(|p| !p.zombie && p.pgrp == pgid)
            .collect();
        if !live_group.is_empty() {
            let leader = procs.iter().find(|p| p.pid == pgid);
            match (leader, identity.start_ticks) {
                (Some(leader), Some(ticks)) if leader.start_ticks == ticks => {
                    tree.group = Some(pgid);
                }
                // The leader number belongs to a different process: the recorded group was
                // empty (its number would otherwise still be reserved).
                (Some(_), Some(_)) => {}
                _ => {
                    if live_group.iter().all(|p| p.marked) {
                        tree.group = Some(pgid);
                    } else {
                        return Ok(TreeState::Ambiguous(format!(
                            "process group {pgid} has {} live member(s) whose identity cannot be verified",
                            live_group.iter().filter(|p| !p.marked).count()
                        )));
                    }
                }
            }
            if tree.group.is_some() {
                tree.members
                    .extend(live_group.iter().map(|p| (p.pid, p.start_ticks)));
            }
        }
    }
    for p in procs.iter().filter(|p| !p.zombie && p.marked) {
        if tree.group.is_some() && Some(p.pgrp) == tree.group {
            continue;
        }
        tree.members.push((p.pid, p.start_ticks));
    }
    if tree.members.is_empty() {
        Ok(TreeState::Absent)
    } else {
        Ok(TreeState::Owned(tree))
    }
}

#[cfg(all(unix, not(target_os = "linux")))]
pub fn inspect_prior_tree(
    identity: &ContainmentIdentity,
    _user_data_dir: &Path,
) -> Result<TreeState, ProcessError> {
    use nix::sys::signal::killpg;
    use nix::unistd::Pid;
    match identity.pgid {
        None => Ok(TreeState::Absent),
        Some(pgid) if pgid <= 1 => Ok(TreeState::Ambiguous(format!(
            "invalid non-positive PGID {pgid}"
        ))),
        Some(pgid) => match killpg(Pid::from_raw(pgid), None) {
            Err(nix::errno::Errno::ESRCH) => Ok(TreeState::Absent),
            Ok(()) | Err(nix::errno::Errno::EPERM) => Ok(TreeState::Ambiguous(format!(
                "process group {pgid} is alive and ownership cannot be verified on this platform"
            ))),
            Err(e) => Err(ProcessError::Signal(e as i32)),
        },
    }
}

#[cfg(not(unix))]
pub fn inspect_prior_tree(
    _identity: &ContainmentIdentity,
    _user_data_dir: &Path,
) -> Result<TreeState, ProcessError> {
    Err(ProcessError::ContainmentUnavailable(
        "prior browser tree inspection is unavailable on this platform".to_string(),
    ))
}

/// Pinned handle on one process: signals reach the process object it was opened on, never a
/// pid number that was later recycled.
///
/// Linux uses a pidfd. The identity (start time or verified parent) is checked **after** the
/// pidfd is held and the handle is only issued while the pinned process has not exited, so the
/// number read from `/proc` provably named the pinned process. Other unix targets have no
/// pidfd; their handle is a bare pid used solely for children this process has not yet reaped.
#[cfg(unix)]
pub(crate) struct PidHandle {
    #[cfg(target_os = "linux")]
    fd: std::os::fd::OwnedFd,
    #[cfg(not(target_os = "linux"))]
    pid: i32,
}

#[cfg(target_os = "linux")]
impl PidHandle {
    fn pidfd_open(pid: i32) -> Result<Option<std::os::fd::OwnedFd>, ProcessError> {
        use std::os::fd::FromRawFd;
        let raw =
            unsafe { libc::syscall(libc::SYS_pidfd_open, pid as libc::c_long, 0 as libc::c_long) };
        if raw < 0 {
            return match std::io::Error::last_os_error().raw_os_error() {
                Some(libc::ESRCH) => Ok(None),
                Some(code) => Err(ProcessError::Signal(code)),
                None => Err(ProcessError::Signal(0)),
            };
        }
        Ok(Some(unsafe {
            std::os::fd::OwnedFd::from_raw_fd(raw as std::os::fd::RawFd)
        }))
    }

    /// True once the pinned process has terminated (a pidfd turns readable on exit).
    fn has_exited(&self) -> bool {
        use std::os::fd::AsRawFd;
        let mut pfd = libc::pollfd {
            fd: self.fd.as_raw_fd(),
            events: libc::POLLIN,
            revents: 0,
        };
        let ready = unsafe { libc::poll(&mut pfd, 1, 0) };
        ready != 0
    }

    /// Handle on the process observed at `start_ticks`; `None` when it is gone or when the
    /// number now belongs to a different process.
    fn open(pid: i32, start_ticks: u64) -> Result<Option<Self>, ProcessError> {
        let Some(fd) = Self::pidfd_open(pid)? else {
            return Ok(None);
        };
        let handle = Self { fd };
        // Identity is read with the handle held, then the pinned process must still be live:
        // a live pinned process keeps its number reserved, so `/proc/<pid>` named it.
        let verified = process_start_ticks(pid) == Some(start_ticks) && !handle.has_exited();
        Ok(verified.then_some(handle))
    }

    /// Handle on a process this supervisor just created: verified by its parent, checked
    /// with the handle held (a live pinned process cannot change parent number unobserved).
    fn open_child_of(pid: i32, parent: i32) -> Result<Self, ProcessError> {
        let fd = Self::pidfd_open(pid)?.ok_or_else(|| {
            ProcessError::LaunchFailed(format!("process {pid} vanished before it could be pinned"))
        })?;
        let handle = Self { fd };
        let parent_ok = procfs::process::Process::new(pid)
            .ok()
            .and_then(|p| p.stat().ok())
            .is_some_and(|stat| stat.ppid == parent);
        if !parent_ok || handle.has_exited() {
            return Err(ProcessError::LaunchFailed(format!(
                "process {pid} is not the expected child of {parent}"
            )));
        }
        Ok(handle)
    }

    fn signal(&self, sig: i32) -> Result<(), ProcessError> {
        use std::os::fd::AsRawFd;
        let ret = unsafe {
            libc::syscall(
                libc::SYS_pidfd_send_signal,
                self.fd.as_raw_fd() as libc::c_long,
                sig as libc::c_long,
                0 as libc::c_long,
                0 as libc::c_long,
            )
        };
        if ret < 0 {
            return match std::io::Error::last_os_error().raw_os_error() {
                Some(libc::ESRCH) => Ok(()),
                Some(code) => Err(ProcessError::Signal(code)),
                None => Err(ProcessError::Signal(0)),
            };
        }
        Ok(())
    }
}

#[cfg(all(unix, not(target_os = "linux")))]
impl PidHandle {
    fn open_child_of(pid: i32, _parent: i32) -> Result<Self, ProcessError> {
        Ok(Self { pid })
    }

    fn signal(&self, sig: i32) -> Result<(), ProcessError> {
        match nix::sys::signal::kill(
            nix::unistd::Pid::from_raw(self.pid),
            nix::sys::signal::Signal::try_from(sig).ok(),
        ) {
            Ok(()) | Err(nix::errno::Errno::ESRCH) => Ok(()),
            Err(e) => Err(ProcessError::Signal(e as i32)),
        }
    }
}

/// Signals every verified member through its own pinned handle. A member that exited or whose
/// number was recycled since inspection is skipped, never signalled.
#[cfg(target_os = "linux")]
fn signal_tree(tree: &OwnedTree, sig: nix::sys::signal::Signal) -> Result<(), ProcessError> {
    for (pid, ticks) in &tree.members {
        if let Some(handle) = PidHandle::open(*pid, *ticks)? {
            handle.signal(sig as i32)?;
        }
    }
    Ok(())
}

/// Verified signalling needs pidfds; other unix targets never obtain an `Owned` tree.
#[cfg(all(unix, not(target_os = "linux")))]
fn signal_tree(_tree: &OwnedTree, _sig: nix::sys::signal::Signal) -> Result<(), ProcessError> {
    Err(ProcessError::ContainmentUnavailable(
        "verified process signalling requires Linux pidfd".to_string(),
    ))
}

/// Blocking inventory moved off the Tokio workers; the identity is cloned into the task.
#[cfg(unix)]
async fn inspect_blocking(
    identity: &ContainmentIdentity,
    user_data_dir: &Path,
) -> Result<TreeState, ProcessError> {
    let identity = identity.clone();
    let dir = user_data_dir.to_path_buf();
    tokio::task::spawn_blocking(move || inspect_prior_tree(&identity, &dir))
        .await
        .map_err(|e| ProcessError::TerminationFailed(format!("process inventory task: {e}")))?
}

/// Live (non-zombie) member count of `pgid`, with the `/proc` scan off the Tokio workers.
#[cfg(unix)]
async fn live_members_blocking(pgid: i32) -> Result<usize, ProcessError> {
    tokio::task::spawn_blocking(move || live_members(pgid))
        .await
        .map_err(|e| ProcessError::TerminationFailed(format!("process inventory task: {e}")))?
}

/// Re-inventories and signals the verified tree once. `Absent` is success; a tree whose
/// ownership cannot be verified is never signalled.
#[cfg(unix)]
async fn signal_verified_tree(
    identity: &ContainmentIdentity,
    user_data_dir: &Path,
    sig: nix::sys::signal::Signal,
) -> Result<(), ProcessError> {
    match inspect_blocking(identity, user_data_dir).await? {
        TreeState::Absent => Ok(()),
        TreeState::Ambiguous(reason) => Err(ProcessError::OwnershipAmbiguous(reason)),
        TreeState::Owned(tree) => signal_tree(&tree, sig),
    }
}

/// Bounds of [`reap_prior_tree`].
#[derive(Debug, Clone, Copy)]
pub struct ReapTimings {
    /// Wait for a prior tree to vanish by itself (its death watcher is mid TERM-to-KILL).
    pub settle: Duration,
    /// Wait after SIGTERM before SIGKILL.
    pub term_grace: Duration,
    /// Wait after SIGKILL for the absence proof.
    pub proof: Duration,
}

#[cfg(unix)]
async fn poll_until_absent(
    identity: &ContainmentIdentity,
    user_data_dir: &Path,
    window: Duration,
) -> Result<TreeState, ProcessError> {
    let deadline = Instant::now() + window;
    loop {
        let state = inspect_blocking(identity, user_data_dir).await?;
        if matches!(state, TreeState::Absent) || Instant::now() >= deadline {
            return Ok(state);
        }
        sleep(Duration::from_millis(50)).await;
    }
}

/// Proves the persisted prior browser tree absent, killing it only when ownership is verified.
///
/// Returns `Ok` solely on a positive absence proof. A tree that stays alive after `settle` is
/// terminated (TERM then KILL) iff every live member is verified ours; unverifiable members
/// yield `OwnershipAmbiguous` and are never signalled. Every signal goes through a pinned
/// per-process handle; KILL repeats on a fresh inventory until the proof window closes so a
/// descendant forked after the first inventory is still caught.
#[cfg(unix)]
pub async fn reap_prior_tree(
    identity: &ContainmentIdentity,
    user_data_dir: &Path,
    timings: ReapTimings,
) -> Result<(), ProcessError> {
    use nix::sys::signal::Signal;

    let tree = match poll_until_absent(identity, user_data_dir, timings.settle).await? {
        TreeState::Absent => return Ok(()),
        TreeState::Ambiguous(reason) => return Err(ProcessError::OwnershipAmbiguous(reason)),
        TreeState::Owned(tree) => tree,
    };
    warn!(tree = %tree.describe(), "prior browser tree survived its supervisor; terminating verified owner");
    signal_tree(&tree, Signal::SIGTERM)?;

    let tree = match poll_until_absent(identity, user_data_dir, timings.term_grace).await? {
        TreeState::Absent => return Ok(()),
        TreeState::Ambiguous(reason) => return Err(ProcessError::OwnershipAmbiguous(reason)),
        TreeState::Owned(tree) => tree,
    };
    signal_tree(&tree, Signal::SIGKILL)?;

    let proof_deadline = Instant::now() + timings.proof;
    loop {
        match inspect_blocking(identity, user_data_dir).await? {
            TreeState::Absent => return Ok(()),
            TreeState::Ambiguous(reason) => return Err(ProcessError::OwnershipAmbiguous(reason)),
            TreeState::Owned(tree) => {
                if Instant::now() >= proof_deadline {
                    return Err(ProcessError::PriorTreeSurvived(tree.describe()));
                }
                signal_tree(&tree, Signal::SIGKILL)?;
            }
        }
        sleep(Duration::from_millis(50)).await;
    }
}

#[cfg(not(unix))]
pub async fn reap_prior_tree(
    _identity: &ContainmentIdentity,
    _user_data_dir: &Path,
    _timings: ReapTimings,
) -> Result<(), ProcessError> {
    Err(ProcessError::ContainmentUnavailable(
        "prior browser tree reconciliation is unavailable on this platform".to_string(),
    ))
}

#[cfg(all(test, target_os = "linux"))]
mod verified_signal_tests {
    use super::*;
    use nix::sys::signal::Signal;

    fn spawn_sleeper(token: Option<&str>) -> std::process::Child {
        let mut cmd = std::process::Command::new("sleep");
        cmd.arg("60").stdin(Stdio::null());
        if let Some(token) = token {
            cmd.env(LAUNCH_TOKEN_ENV, token);
        }
        cmd.spawn().expect("spawn sleeper")
    }

    fn alive(child: &mut std::process::Child) -> bool {
        matches!(child.try_wait(), Ok(None))
    }

    fn destroy(mut child: std::process::Child) {
        let _ = child.kill();
        let _ = child.wait();
    }

    /// Models PID reuse after inspection: the inventory recorded start time T for number P, but
    /// P now names an unrelated live process with a different start time.
    #[test]
    fn recycled_number_after_inspection_is_never_signalled() {
        let mut bystander = spawn_sleeper(None);
        let pid = bystander.id() as i32;
        let real_ticks = process_start_ticks(pid).expect("start ticks");

        assert!(
            PidHandle::open(pid, real_ticks + 1).unwrap().is_none(),
            "different start time must not yield a handle"
        );
        let tree = OwnedTree {
            group: Some(pid),
            members: vec![(pid, real_ticks + 1)],
        };
        signal_tree(&tree, Signal::SIGKILL).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        assert!(alive(&mut bystander), "unrelated process was signalled");
        destroy(bystander);
    }

    /// The inventoried member exits between inspection and signalling while an unrelated
    /// process runs: the stale entry is skipped and the bystander survives.
    #[test]
    fn member_exiting_between_inspection_and_signal_is_skipped() {
        let token = format!("verified-signal-{}", std::process::id());
        let mut member = spawn_sleeper(Some(&token));
        let mut bystander = spawn_sleeper(None);
        let identity = ContainmentIdentity::launch_intent(token);
        let dir = tempfile::tempdir().unwrap();

        let tree = match inspect_prior_tree(&identity, dir.path()).unwrap() {
            TreeState::Owned(tree) => tree,
            other => panic!("expected an owned tree, got {other:?}"),
        };
        assert!(tree.members.iter().any(|(p, _)| *p == member.id() as i32));

        // Barrier point: the member is gone before the signal is sent.
        member.kill().unwrap();
        member.wait().unwrap();
        signal_tree(&tree, Signal::SIGKILL).unwrap();

        std::thread::sleep(Duration::from_millis(100));
        assert!(alive(&mut bystander), "unrelated process was signalled");
        destroy(bystander);
    }

    /// A pinned handle keeps naming the process it was opened on after that process was
    /// reaped, so a later signal is a no-op instead of hitting a recycled number.
    #[test]
    fn pinned_child_handle_survives_reap_without_signalling_anything_else() {
        let mut child = spawn_sleeper(None);
        let handle =
            PidHandle::open_child_of(child.id() as i32, std::process::id() as i32).unwrap();
        let mut bystander = spawn_sleeper(None);

        child.kill().unwrap();
        child.wait().unwrap();
        handle.signal(Signal::SIGKILL as i32).unwrap();

        std::thread::sleep(Duration::from_millis(100));
        assert!(alive(&mut bystander));
        destroy(bystander);
    }

    #[test]
    fn pinning_a_process_with_the_wrong_parent_is_refused() {
        let child = spawn_sleeper(None);
        let result = PidHandle::open_child_of(child.id() as i32, std::process::id() as i32 + 1);
        assert!(result.is_err());
        destroy(child);
    }
}
