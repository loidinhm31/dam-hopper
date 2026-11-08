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
    #[doc(hidden)]
    pub _test_mock_watcher_pre_exec_fail: bool,
    #[doc(hidden)]
    pub _test_mock_watcher_exec_fail: bool,
}

impl BrowserLaunchConfig {
    pub fn new(user_data_dir: PathBuf) -> Self {
        Self {
            executable_path: None,
            user_data_dir,
            headless: true,
            additional_args: Vec::new(),
            _test_mock_watcher_pre_exec_fail: false,
            _test_mock_watcher_exec_fail: false,
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
    let parsed = url::Url::parse(ws_url).map_err(|_| {
        ProcessError::InvalidEndpoint("failed to parse WebSocket URL".to_string())
    })?;

    if parsed.scheme() != "ws" {
        return Err(ProcessError::InvalidEndpoint(
            "invalid scheme, expected 'ws'".to_string(),
        ));
    }

    match parsed.host() {
        Some(url::Host::Domain("localhost")) => {}
        Some(url::Host::Ipv4(ip)) if ip.is_loopback() => {}
        Some(url::Host::Ipv6(ip)) if ip.is_loopback() => {}
        Some(_) => return Err(ProcessError::NonLoopbackEndpoint(
            "endpoint host is not a loopback address".to_string(),
        )),
        None => return Err(ProcessError::InvalidEndpoint("missing host in DevTools URL".to_string())),
    }

    match parsed.port() {
        Some(port) if port > 0 => {}
        Some(_) => return Err(ProcessError::InvalidEndpoint("port cannot be 0".to_string())),
        None => return Err(ProcessError::InvalidEndpoint("missing port in DevTools URL".to_string())),
    }

    validate_browser_path(parsed.path())?;

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

pub struct BrowserProcess {
    child: Option<Child>,
    pid: u32,
    #[cfg(unix)]
    pgid: i32,
    #[cfg(unix)]
    watcher_pid: Option<i32>,
    #[cfg(unix)]
    supervisor_pipe: Option<std::fs::File>,
    ws_endpoint: String,
    user_data_dir: PathBuf,
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
            std::fs::set_permissions(&config.user_data_dir, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| ProcessError::LaunchFailed(format!(
                    "failed to set restricted permissions (0700) on user-data-dir: {e}"
                )))?;
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
            .arg(format!("--user-data-dir={}", config.user_data_dir.display()))
            .arg("--no-first-run")
            .arg("--no-default-browser-check");

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

        // Process containment setup:
        // An anonymous death-pipe is created before spawn.
        // In pre_exec, the child process atomically forks a supervisor watcher grandchild
        // BEFORE executing Chrome. The grandchild inherits the pipe read end and sets its own PGID.
        // When the supervisor process exits for ANY reason (including SIGKILL), the kernel closes
        // pipe_write, causing the watcher to receive EOF, signal Chrome's process group with
        // SIGTERM then SIGKILL, and exit.
        // This eliminates any race window between Chrome spawn and watcher readiness.
        #[cfg(unix)]
        let (pipe_read, pipe_write, ready_read, ready_write) = {
            let mut death_fds = [0i32; 2];
            let res = unsafe { libc::pipe(death_fds.as_mut_ptr()) };
            if res != 0 {
                return Err(ProcessError::LaunchFailed(format!(
                    "failed to create supervisor containment pipe: {}",
                    std::io::Error::last_os_error()
                )));
            }
            unsafe {
                let flags = libc::fcntl(death_fds[1], libc::F_GETFD);
                if flags >= 0 {
                    libc::fcntl(death_fds[1], libc::F_SETFD, flags | libc::FD_CLOEXEC);
                }
            }

            let mut ready_fds = [0i32; 2];
            let res = unsafe { libc::pipe2(ready_fds.as_mut_ptr(), libc::O_CLOEXEC) };
            if res != 0 {
                unsafe {
                    libc::close(death_fds[0]);
                    libc::close(death_fds[1]);
                }
                return Err(ProcessError::LaunchFailed(format!(
                    "failed to create supervisor watcher readiness pipe: {}",
                    std::io::Error::last_os_error()
                )));
            }
            (death_fds[0], death_fds[1], ready_fds[0], ready_fds[1])
        };

        #[cfg(unix)]
        {
            #[cfg(target_os = "linux")]
            {
                let parent_pid = std::process::id() as libc::pid_t;
                let death_r = pipe_read;
                let ready_w = ready_write;
                let mock_pre_fail = config._test_mock_watcher_pre_exec_fail;
                let mock_exec_fail = config._test_mock_watcher_exec_fail;
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

                        // 3. Atomically spawn supervisor watcher BEFORE Chrome can execute or fork descendants
                        let watcher_pid = libc::fork();
                        if watcher_pid < 0 {
                            return Err(std::io::Error::last_os_error());
                        }

                        if watcher_pid == 0 {
                            // In grandchild watcher process:
                            if mock_pre_fail {
                                libc::_exit(127);
                            }

                            // Move watcher to its own independent process group
                            if libc::setpgid(0, 0) != 0 {
                                libc::_exit(127);
                            }

                            // Wire death_r to stdin (fd 0)
                            if death_r != 0 {
                                if libc::dup2(death_r, 0) < 0 {
                                    libc::_exit(127);
                                }
                                libc::close(death_r);
                            }

                            // Redirect stdout and stderr to /dev/null
                            let devnull = libc::open(b"/dev/null\0".as_ptr() as *const libc::c_char, libc::O_WRONLY);
                            if devnull >= 0 {
                                if libc::dup2(devnull, 1) < 0 || libc::dup2(devnull, 2) < 0 {
                                    libc::_exit(127);
                                }
                                if devnull > 2 {
                                    libc::close(devnull);
                                }
                            }

                            // Format pgid into stack buffer without heap allocation
                            let mut pgid_buf = [0u8; 16];
                            let mut val = pgid;
                            let mut idx = 15;
                            if val == 0 {
                                pgid_buf[14] = b'0';
                                idx = 14;
                            } else {
                                while val > 0 && idx > 0 {
                                    idx -= 1;
                                    pgid_buf[idx] = b'0' + (val % 10) as u8;
                                    val /= 10;
                                }
                            }
                            let pgid_ptr = pgid_buf.as_ptr().add(idx) as *const libc::c_char;
                            let sh_path = if mock_exec_fail {
                                b"/nonexistent/dam_hopper_sh\0".as_ptr() as *const libc::c_char
                            } else {
                                b"/bin/sh\0".as_ptr() as *const libc::c_char
                            };

                            static C_ARG: &[u8] = b"-c\0";
                            static SH_NAME: &[u8] = b"sh\0";
                            static SCRIPT: &[u8] = b"exec <&0; cat >/dev/null; kill -s TERM -- -$1 2>/dev/null || kill -TERM -$1 2>/dev/null || true; sleep 0.5; kill -s KILL -- -$1 2>/dev/null || kill -KILL -$1 2>/dev/null || true\0";

                            let args = [
                                sh_path,
                                C_ARG.as_ptr() as *const libc::c_char,
                                SCRIPT.as_ptr() as *const libc::c_char,
                                SH_NAME.as_ptr() as *const libc::c_char,
                                pgid_ptr,
                                std::ptr::null(),
                            ];

                            // Write watcher PID (4 bytes) to ready_w before execve to prove pre-exec setup succeeded
                            let my_pid = libc::getpid();
                            let pid_bytes = (my_pid as u32).to_ne_bytes();
                            if libc::write(ready_w, pid_bytes.as_ptr() as *const libc::c_void, 4) != 4 {
                                libc::_exit(127);
                            }

                            // Standard CLOEXEC-pipe pattern:
                            // ready_w has FD_CLOEXEC. On successful execve, kernel closes ready_w -> parent sees EOF.
                            // If execve fails, we write errno to ready_w and _exit(127).
                            libc::execve(sh_path, args.as_ptr(), std::ptr::null());
                            let errno = std::io::Error::last_os_error().raw_os_error().unwrap_or(127) as u8;
                            let err_buf = [if errno == 0 { 127 } else { errno }];
                            let _ = libc::write(ready_w, err_buf.as_ptr() as *const libc::c_void, 1);
                            libc::_exit(127);
                        }
                        // In child (Chrome): close death_r and ready_w before execve(chrome)
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
                libc::close(pipe_write);
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
                    libc::close(pipe_write);
                    libc::close(ready_read);
                }
                return Err(ProcessError::LaunchFailed("child missing pid".to_string()));
            }
        };

        #[cfg(unix)]
        let pgid = pid as i32;
        #[cfg(unix)]
        let mut pg_guard = ProcessGroupGuard { pgid, armed: true };

        // Verify supervisor watcher readiness handshake before proceeding
        // Verify supervisor watcher readiness using bounded poll on CLOEXEC pipe:
        // EOF (0 bytes read) proves /bin/sh execve succeeded and closed ready_w.
        // Any byte read indicates execve failure; timeout indicates watcher startup stalled.
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
                    libc::close(pipe_write);
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
                    libc::close(pipe_write);
                    libc::close(ready_read);
                }
                return Err(ProcessError::LaunchFailed(
                    "supervisor watcher pre-exec setup failed".to_string(),
                ));
            }
            let wpid = u32::from_ne_bytes(pid_buf) as i32;

            // Read trailing byte if execve failed; on success, ready_w was closed by kernel (EOF, n_extra == 0)
            let mut err_byte = [0u8; 1];
            let n_extra = unsafe { libc::read(ready_read, err_byte.as_mut_ptr() as *mut libc::c_void, 1) };
            unsafe {
                libc::close(ready_read);
            }
            if n_extra > 0 {
                unsafe {
                    libc::close(pipe_write);
                }
                return Err(ProcessError::LaunchFailed(format!(
                    "supervisor watcher execve failed with errno {}",
                    err_byte[0]
                )));
            }

            // Verify watcher liveness and independent PGID
            unsafe {
                if libc::kill(wpid, 0) != 0 || libc::getpgid(wpid) != wpid {
                    libc::close(pipe_write);
                    return Err(ProcessError::LaunchFailed(
                        "supervisor watcher liveness or process group verification failed".to_string(),
                    ));
                }
            }
            wpid
        };
        let stderr = child.stderr.take().ok_or_else(|| {
            #[cfg(unix)]
            unsafe {
                libc::close(pipe_write);
            }
            ProcessError::LaunchFailed("missing stderr pipe".to_string())
        })?;

        let deadline = Duration::from_secs(STARTUP_TIMEOUT_SECS);
        let user_data_dir = config.user_data_dir.clone();

        let (ws_endpoint, mut stderr) = match timeout(deadline, discover_ws_endpoint(stderr, &user_data_dir)).await {
            Ok(Ok(pair)) => pair,
            Ok(Err(e)) => {
                #[cfg(unix)]
                unsafe {
                    libc::close(pipe_write);
                }
                return Err(e);
            }
            Err(_) => {
                #[cfg(unix)]
                unsafe {
                    libc::close(pipe_write);
                }
                return Err(ProcessError::StartupTimeout(deadline));
            }
        };

        // Drain remaining stderr to sink so Chrome never blocks or encounters EPIPE
        tokio::spawn(async move {
            let mut sink = tokio::io::sink();
            let _ = tokio::io::copy(&mut stderr, &mut sink).await;
        });

        // Validate loopback and strict canonical UUID path
        if let Err(e) = validate_loopback_endpoint(&ws_endpoint) {
            #[cfg(unix)]
            unsafe {
                libc::close(pipe_write);
            }
            return Err(e);
        }

        info!(pid, "supervised browser launched on loopback DevTools endpoint");

        #[cfg(unix)]
        {
            pg_guard.armed = false;
        }

        #[cfg(unix)]
        let supervisor_pipe = unsafe {
            use std::os::unix::io::FromRawFd;
            Some(std::fs::File::from_raw_fd(pipe_write))
        };

        Ok(Self {
            child: Some(child),
            pid,
            #[cfg(unix)]
            pgid,
            #[cfg(unix)]
            watcher_pid: Some(watcher_pid),
            #[cfg(unix)]
            supervisor_pipe,
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

            if let Some(wpid) = self.watcher_pid.take() {
                let _ = nix::sys::signal::kill(Pid::from_raw(wpid), nix::sys::signal::Signal::SIGKILL);
            }
            self.supervisor_pipe = None;
            // Step 2: Send SIGTERM to entire process group
            let _ = nix::sys::signal::killpg(pg, nix::sys::signal::Signal::SIGTERM);

            // Step 3: Grace period (up to 3s)
            let grace = Instant::now() + Duration::from_secs(SHUTDOWN_GRACE_PERIOD_SECS);
            while Instant::now() < grace && live_members(self.pgid)? > 0 {
                sleep(Duration::from_millis(50)).await;
            }

            // Step 4: Send SIGKILL to the process group
            match nix::sys::signal::killpg(pg, nix::sys::signal::Signal::SIGKILL) {
                Ok(()) | Err(nix::errno::Errno::ESRCH) => {}
                Err(e) => return Err(ProcessError::Signal(e as i32)),
            }

            // Step 5: Prove group emptiness within 2s proof deadline
            let proof_deadline = Instant::now() + Duration::from_secs(2);
            while live_members(self.pgid)? > 0 {
                if Instant::now() >= proof_deadline {
                    return Err(ProcessError::ContainmentUnproven(self.pgid));
                }
                sleep(Duration::from_millis(50)).await;
            }

            // Step 6: Reap leader child LAST after descendants exit
            if let Some(child) = self.child.as_mut() {
                child.wait().await.map_err(|e| ProcessError::Reap(e.to_string()))?;
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
                use nix::sys::signal::{killpg, Signal};
                use nix::unistd::Pid;
                let _ = killpg(Pid::from_raw(self.pgid), Signal::SIGKILL);
                if let Some(wpid) = self.watcher_pid.take() {
                    let _ = nix::sys::signal::kill(Pid::from_raw(wpid), Signal::SIGKILL);
                }
                self.supervisor_pipe = None;
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
                            ProcessError::InvalidEndpoint("invalid numeric port in DevToolsActivePort".to_string())
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
                let endpoint = port_file_endpoint.as_ref().or(stderr_endpoint.as_ref()).unwrap();
                return Ok((endpoint.clone(), stderr));
            }
        } else if port_file_endpoint.is_some() || stderr_endpoint.is_some() {
            first_endpoint_discovered_at = Some(Instant::now());
        }
    }
}
