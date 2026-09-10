use std::collections::{HashMap, HashSet};
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use crate::idle_suspend::activity::{
    ActivityUnavailable, ActivityUnavailableReason, BlockingProcessEvidence, FailureContext,
    MonitoredTerminalEvidence, NetworkNamespaceIdentity, OwnedSocketInode, OwnedSocketSet,
    ProcessChange, ProcessSample, MAX_CMDLINE_BYTES_LIMIT, MAX_MANAGED_ROOTS_LIMIT,
    MAX_OWNED_SOCKETS_LIMIT, MAX_PROCESS_FDS_LIMIT, MAX_RELEVANT_PROCESSES_LIMIT,
    MAX_SAFE_EXECUTABLE_IDENTITY_BYTES, MAX_SCANNED_PROCESSES_LIMIT,
};
use crate::idle_suspend::policy::{AgentExecutableEntry, AgentExecutableSet};
use crate::pty::activity::{
    parse_proc_stat, ProcessIdentity, ProcessStat, PtyActivitySnapshot, RootQualification,
    TerminalIdentity, SATURATED_COUNTER_SENTINEL,
};

/// Generic entrypoint basenames that cannot satisfy a basename matcher.
///
/// Per Requirement 10: generic entrypoints require an exact configured absolute path.
pub(crate) const GENERIC_ENTRYPOINT_BASENAMES: &[&str] =
    &["cli.js", "index.js", "main.py", "__main__.py"];

// ---------------------------------------------------------------------------
// Process source abstraction
// ---------------------------------------------------------------------------

/// Synchronous, deadline-aware process inspection seam.
pub(crate) trait ProcessSource {
    /// Enumerate all numeric PIDs currently in procfs.
    fn list_pids(&self) -> Result<Vec<u32>, ActivityUnavailable>;

    /// Read and parse /proc/<pid>/stat.
    fn read_stat(&self, pid: u32) -> Result<ProcessStat, ActivityUnavailable>;

    /// Read target of /proc/<pid>/exe.
    fn read_exe(&self, pid: u32) -> Result<PathBuf, ActivityUnavailable>;

    /// Read device and inode of /proc/<pid>/exe target for image tracking.
    fn read_exe_metadata(&self, pid: u32) -> Result<(u64, u64), ActivityUnavailable>;

    /// Read bounded /proc/<pid>/cmdline tokens.
    fn read_cmdline(&self, pid: u32) -> Result<Vec<String>, ActivityUnavailable>;

    /// Read /proc/<pid>/cwd target.
    fn read_cwd(&self, pid: u32) -> Result<PathBuf, ActivityUnavailable>;

    /// Read network namespace identity (dev, ino) of /proc/<pid>/ns/net.
    fn read_netns(&self, pid: u32) -> Result<NetworkNamespaceIdentity, ActivityUnavailable>;

    /// Read network namespace identity (dev, ino) of the observing thread.
    fn read_thread_netns(&self) -> Result<NetworkNamespaceIdentity, ActivityUnavailable>;

    /// Enumerate file descriptor numbers under /proc/<pid>/fd.
    fn list_fds(&self, pid: u32) -> Result<Vec<u32>, ActivityUnavailable>;

    /// Read target of /proc/<pid>/fd/<fd> and parse decimal inode if socket:[inode].
    fn read_fd_socket(&self, pid: u32, fd: u32) -> Result<Option<u64>, ActivityUnavailable>;
}

// ---------------------------------------------------------------------------
// Linux production procfs source
// ---------------------------------------------------------------------------

/// Production procfs implementation accessing `/proc`.
#[derive(Debug, Clone, Default)]
pub(crate) struct LinuxProcSource {
    proc_root: PathBuf,
}

impl LinuxProcSource {
    pub(crate) fn new() -> Self {
        Self {
            proc_root: PathBuf::from("/proc"),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_root(proc_root: PathBuf) -> Self {
        Self { proc_root }
    }
}

impl ProcessSource for LinuxProcSource {
    fn list_pids(&self) -> Result<Vec<u32>, ActivityUnavailable> {
        let read_dir = fs::read_dir(&self.proc_root).map_err(|e| {
            tracing::debug!("Failed to read proc root {}: {e}", self.proc_root.display());
            ActivityUnavailable::new(ActivityUnavailableReason::ProcAccess)
        })?;

        let mut pids = Vec::new();
        for entry_res in read_dir {
            let entry = entry_res.map_err(|e| {
                tracing::debug!("Error iterating proc directory: {e}");
                ActivityUnavailable::new(ActivityUnavailableReason::ProcAccess)
            })?;

            if let Some(name_str) = entry.file_name().to_str() {
                if let Ok(pid) = name_str.parse::<u32>() {
                    pids.push(pid);
                    if pids.len() > MAX_SCANNED_PROCESSES_LIMIT {
                        return Err(ActivityUnavailable::new(ActivityUnavailableReason::ScanLimit));
                    }
                }
            }
        }
        Ok(pids)
    }

    fn read_stat(&self, pid: u32) -> Result<ProcessStat, ActivityUnavailable> {
        let stat_path = self.proc_root.join(pid.to_string()).join("stat");
        let contents = match fs::read_to_string(&stat_path) {
            Ok(c) => c,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
            Err(e) => {
                tracing::debug!("Failed to read stat {}: {e}", stat_path.display());
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
        };

        parse_proc_stat(&contents).map_err(|err| {
            tracing::debug!("Failed to parse stat {}: {err}", stat_path.display());
            ActivityUnavailable::new(ActivityUnavailableReason::ProcAccess)
        })
    }

    fn read_exe(&self, pid: u32) -> Result<PathBuf, ActivityUnavailable> {
        let exe_path = self.proc_root.join(pid.to_string()).join("exe");
        let target = match fs::read_link(&exe_path) {
            Ok(p) => p,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
            Err(e) => {
                tracing::debug!("Failed to readlink {}: {e}", exe_path.display());
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
        };

        // Requirement 8: A " (deleted)" executable target or non-normalizable target is uncertain.
        let target_str = target.to_string_lossy();
        if target_str.ends_with(" (deleted)") {
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::IdentityUncertain,
            ));
        }

        Ok(target)
    }

    fn read_exe_metadata(&self, pid: u32) -> Result<(u64, u64), ActivityUnavailable> {
        let exe_path = self.proc_root.join(pid.to_string()).join("exe");
        let meta = match fs::metadata(&exe_path) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
            Err(e) => {
                tracing::debug!("Failed to read metadata {}: {e}", exe_path.display());
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
        };
        Ok((meta.dev(), meta.ino()))
    }

    fn read_cmdline(&self, pid: u32) -> Result<Vec<String>, ActivityUnavailable> {
        let cmdline_path = self.proc_root.join(pid.to_string()).join("cmdline");
        use std::io::Read;
        let mut file = match fs::File::open(&cmdline_path) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
            Err(e) => {
                tracing::debug!("Failed to open cmdline {}: {e}", cmdline_path.display());
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
        };

        // Read at most MAX_CMDLINE_BYTES_LIMIT + 1
        let mut buf = Vec::with_capacity(MAX_CMDLINE_BYTES_LIMIT + 1);
        let mut take = (&mut file).take((MAX_CMDLINE_BYTES_LIMIT + 1) as u64);
        if let Err(e) = take.read_to_end(&mut buf) {
            if e.kind() == std::io::ErrorKind::NotFound {
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::ProcAccess,
            ));
        }

        if buf.len() > MAX_CMDLINE_BYTES_LIMIT {
            return Err(ActivityUnavailable::new(ActivityUnavailableReason::ScanLimit));
        }

        if buf.is_empty() {
            return Ok(Vec::new());
        }

        // Must split by NUL bytes
        let mut tokens = Vec::new();
        for chunk in buf.split(|&b| b == 0) {
            if chunk.is_empty() {
                continue;
            }
            let s = std::str::from_utf8(chunk).map_err(|_| {
                ActivityUnavailable::new(ActivityUnavailableReason::IdentityUncertain)
            })?;
            tokens.push(s.to_string());
        }

        Ok(tokens)
    }

    fn read_cwd(&self, pid: u32) -> Result<PathBuf, ActivityUnavailable> {
        let cwd_path = self.proc_root.join(pid.to_string()).join("cwd");
        match fs::read_link(&cwd_path) {
            Ok(p) => Ok(p),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(
                ActivityUnavailable::retryable(ActivityUnavailableReason::ProcAccess),
            ),
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::ProcAccess,
                ))
            }
            Err(e) => {
                tracing::debug!("Failed to readlink cwd {}: {e}", cwd_path.display());
                Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::ProcAccess,
                ))
            }
        }
    }

    fn read_netns(&self, pid: u32) -> Result<NetworkNamespaceIdentity, ActivityUnavailable> {
        let netns_path = self
            .proc_root
            .join(pid.to_string())
            .join("ns")
            .join("net");
        let meta = match fs::metadata(&netns_path) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
            Err(e) => {
                tracing::debug!("Failed to read netns metadata {}: {e}", netns_path.display());
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
        };
        Ok(NetworkNamespaceIdentity {
            device: meta.dev(),
            inode: meta.ino(),
        })
    }

    fn read_thread_netns(&self) -> Result<NetworkNamespaceIdentity, ActivityUnavailable> {
        // Try /proc/thread-self/ns/net, fallback to /proc/self/ns/net
        let thread_path = self.proc_root.join("thread-self").join("ns").join("net");
        let path = if thread_path.exists() {
            thread_path
        } else {
            self.proc_root.join("self").join("ns").join("net")
        };

        let meta = fs::metadata(&path).map_err(|e| {
            tracing::debug!("Failed to read thread netns metadata {}: {e}", path.display());
            ActivityUnavailable::new(ActivityUnavailableReason::ProcAccess)
        })?;
        Ok(NetworkNamespaceIdentity {
            device: meta.dev(),
            inode: meta.ino(),
        })
    }

    fn list_fds(&self, pid: u32) -> Result<Vec<u32>, ActivityUnavailable> {
        let fd_dir = self.proc_root.join(pid.to_string()).join("fd");
        let read_dir = match fs::read_dir(&fd_dir) {
            Ok(rd) => rd,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
            Err(e) => {
                tracing::debug!("Failed to read fd dir {}: {e}", fd_dir.display());
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
        };

        let mut fds = Vec::new();
        for entry_res in read_dir {
            let entry = match entry_res {
                Ok(e) => e,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    return Err(ActivityUnavailable::retryable(
                        ActivityUnavailableReason::ProcAccess,
                    ));
                }
                Err(e) => {
                    tracing::debug!("Error iterating fd dir: {e}");
                    return Err(ActivityUnavailable::new(
                        ActivityUnavailableReason::ProcAccess,
                    ));
                }
            };

            if let Some(name_str) = entry.file_name().to_str() {
                if let Ok(fd) = name_str.parse::<u32>() {
                    fds.push(fd);
                    if fds.len() > MAX_PROCESS_FDS_LIMIT {
                        return Err(ActivityUnavailable::new(ActivityUnavailableReason::ScanLimit));
                    }
                }
            }
        }
        Ok(fds)
    }

    fn read_fd_socket(&self, pid: u32, fd: u32) -> Result<Option<u64>, ActivityUnavailable> {
        let fd_link = self
            .proc_root
            .join(pid.to_string())
            .join("fd")
            .join(fd.to_string());
        let target = match fs::read_link(&fd_link) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // FD closed concurrently -> retryable close race
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
            Err(e) => {
                tracing::debug!("Failed to readlink fd {}: {e}", fd_link.display());
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::ProcAccess,
                ));
            }
        };

        let s = target.to_string_lossy();
        if let Some(inode_str) = s.strip_prefix("socket:[").and_then(|rem| rem.strip_suffix(']')) {
            let inode: u64 = inode_str.parse().map_err(|_| {
                ActivityUnavailable::new(ActivityUnavailableReason::SocketDiagnostics)
            })?;
            if inode == 0 {
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::SocketDiagnostics,
                ));
            }
            Ok(Some(inode))
        } else {
            Ok(None)
        }
    }
}

// ---------------------------------------------------------------------------
// Lexical path normalization & safe identity derivation
// ---------------------------------------------------------------------------

/// Lexically normalize a path without following symlinks.
pub(crate) fn normalize_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(p) => out.push(p.as_os_str()),
            Component::RootDir => out.push(Component::RootDir.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(c) => out.push(c),
        }
    }
    out
}

/// Derive safe executable identity string according to Requirement 23.
///
/// Bounded to at most 256 bytes, valid UTF-8, no control characters.
pub(crate) fn validate_safe_executable_identity(raw: &str) -> Option<String> {
    if raw.is_empty() || raw.len() > MAX_SAFE_EXECUTABLE_IDENTITY_BYTES {
        return None;
    }
    if raw.chars().any(|c| c.is_control()) {
        return None;
    }
    Some(raw.to_string())
}

// ---------------------------------------------------------------------------
// Finite interpreter command-line grammar
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum InterpreterParseResult {
    /// Deterministically located entrypoint script or executable path token.
    Entrypoint(String),
    /// Known nonmatching form (e.g. bash interactive shell, bash -c wrapper).
    Nonmatching,
    /// Unclassifiable or ambiguous command structure requiring identityUncertain.
    Unclassifiable,
}

/// Parse `node` / `nodejs` command line according to the finite grammar table.
pub(crate) fn parse_node_args(args: &[String]) -> InterpreterParseResult {
    let mut i = 0;
    while i < args.len() {
        let token = &args[i];
        if token == "--" {
            // Options end, next token is entrypoint
            if i + 1 < args.len() {
                return InterpreterParseResult::Entrypoint(args[i + 1].clone());
            } else {
                return InterpreterParseResult::Unclassifiable;
            }
        }

        // Check unclassifiable forms
        if token == "-e"
            || token == "--eval"
            || token == "-p"
            || token == "--print"
            || token.starts_with("-e=")
            || token.starts_with("--eval=")
            || token.starts_with("-p=")
            || token.starts_with("--print=")
        {
            return InterpreterParseResult::Unclassifiable;
        }

        // Valueless flags
        if token == "--enable-source-maps"
            || token == "--no-deprecation"
            || token == "--no-warnings"
            || token == "--trace-deprecation"
            || token == "--trace-warnings"
            || token == "--preserve-symlinks"
            || token == "--preserve-symlinks-main"
        {
            i += 1;
            continue;
        }

        // Value flags: separate or --name=value
        if token == "-r"
            || token == "--require"
            || token == "--import"
            || token == "--loader"
            || token == "--experimental-loader"
            || token == "--conditions"
        {
            if i + 1 < args.len() {
                i += 2;
                continue;
            } else {
                return InterpreterParseResult::Unclassifiable;
            }
        }
        if token.starts_with("-r=")
            || token.starts_with("--require=")
            || token.starts_with("--import=")
            || token.starts_with("--loader=")
            || token.starts_with("--experimental-loader=")
            || token.starts_with("--conditions=")
        {
            i += 1;
            continue;
        }

        // Inspector flags: standalone or --name=value
        if token == "--inspect"
            || token == "--inspect-brk"
            || token == "--inspect-wait"
            || token.starts_with("--inspect=")
            || token.starts_with("--inspect-brk=")
            || token.starts_with("--inspect-wait=")
        {
            i += 1;
            continue;
        }

        if token.starts_with('-') {
            // Unknown flag -> unclassifiable
            return InterpreterParseResult::Unclassifiable;
        }

        // First non-flag token is entrypoint
        return InterpreterParseResult::Entrypoint(token.clone());
    }

    InterpreterParseResult::Unclassifiable
}

/// Parse `bun` command line according to the finite grammar table.
pub(crate) fn parse_bun_args(args: &[String]) -> InterpreterParseResult {
    if args.is_empty() {
        return InterpreterParseResult::Unclassifiable;
    }
    if args[0] == "run" {
        if args.len() < 2 {
            return InterpreterParseResult::Unclassifiable;
        }
        let next = &args[1];
        if next.contains('/') || next.ends_with(".js") || next.ends_with(".ts") || next.ends_with(".jsx") || next.ends_with(".tsx") {
            return InterpreterParseResult::Entrypoint(next.clone());
        } else {
            // Bare `bun run <package-script>` -> unclassifiable
            return InterpreterParseResult::Unclassifiable;
        }
    }

    let mut i = 0;
    while i < args.len() {
        let token = &args[i];
        if token == "--" {
            if i + 1 < args.len() {
                return InterpreterParseResult::Entrypoint(args[i + 1].clone());
            } else {
                return InterpreterParseResult::Unclassifiable;
            }
        }

        // Unclassifiable subcommands or eval forms
        if token == "-e"
            || token == "--eval"
            || token == "-p"
            || token == "--print"
            || token == "x"
            || token == "bunx"
            || token == "test"
            || token == "install"
            || token == "add"
            || token == "remove"
            || token == "update"
        {
            return InterpreterParseResult::Unclassifiable;
        }

        // Valueless flags
        if token == "--silent" || token == "--bun" || token == "--smol" {
            i += 1;
            continue;
        }

        // Value flags: separate or =value
        if token == "--cwd" || token == "--config" {
            if i + 1 < args.len() {
                i += 2;
                continue;
            } else {
                return InterpreterParseResult::Unclassifiable;
            }
        }
        if token.starts_with("--cwd=") || token.starts_with("--config=") {
            i += 1;
            continue;
        }

        if token.starts_with('-') {
            return InterpreterParseResult::Unclassifiable;
        }

        return InterpreterParseResult::Entrypoint(token.clone());
    }

    InterpreterParseResult::Unclassifiable
}

/// Parse `python` / `python3` command line according to the finite grammar table.
pub(crate) fn parse_python_args(args: &[String]) -> InterpreterParseResult {
    let mut i = 0;
    while i < args.len() {
        let token = &args[i];
        if token == "--" {
            if i + 1 < args.len() {
                return InterpreterParseResult::Entrypoint(args[i + 1].clone());
            } else {
                return InterpreterParseResult::Unclassifiable;
            }
        }

        // Unclassifiable forms: -c, -m, stdin -
        if token == "-c"
            || token == "-m"
            || token == "-"
            || token.starts_with("-c")
            || token.starts_with("-m")
        {
            return InterpreterParseResult::Unclassifiable;
        }

        // Valueless flags
        if token == "-B"
            || token == "-E"
            || token == "-I"
            || token == "-O"
            || token == "-OO"
            || token == "-P"
            || token == "-q"
            || token == "-s"
            || token == "-S"
            || token == "-u"
            || token == "-v"
        {
            i += 1;
            continue;
        }

        // Value flags in joined or separate form: -W and -X
        if token == "-W" || token == "-X" {
            if i + 1 < args.len() {
                i += 2;
                continue;
            } else {
                return InterpreterParseResult::Unclassifiable;
            }
        }
        if token.starts_with("-W") || token.starts_with("-X") {
            i += 1;
            continue;
        }

        if token.starts_with('-') {
            return InterpreterParseResult::Unclassifiable;
        }

        return InterpreterParseResult::Entrypoint(token.clone());
    }

    InterpreterParseResult::Unclassifiable
}

/// Parse shell command line (`sh`, `bash`, `dash`, `zsh`, `ksh`) according to the finite grammar table.
pub(crate) fn parse_shell_args(args: &[String]) -> InterpreterParseResult {
    let mut i = 0;
    while i < args.len() {
        let token = &args[i];
        if token == "--" {
            if i + 1 < args.len() {
                return InterpreterParseResult::Entrypoint(args[i + 1].clone());
            } else {
                // Ordinary shell without entrypoint
                return InterpreterParseResult::Nonmatching;
            }
        }

        // Flag group containing 'c' -> known command-string wrapper (Requirement 11)
        if token.starts_with('-') && !token.starts_with("--") {
            let flags = &token[1..];
            if flags.contains('c') {
                return InterpreterParseResult::Nonmatching;
            }
            if flags.contains('s') {
                return InterpreterParseResult::Nonmatching;
            }

            // Must be combined from allowed valueless flags: e, f, i, l, n, u, v, x
            // or -o option
            if token == "-o" {
                if i + 1 < args.len() {
                    i += 2;
                    continue;
                } else {
                    return InterpreterParseResult::Unclassifiable;
                }
            }
            if token.starts_with("-o") {
                i += 1;
                continue;
            }

            let valid_flags = flags.chars().all(|c| matches!(c, 'e' | 'f' | 'i' | 'l' | 'n' | 'u' | 'v' | 'x'));
            if valid_flags {
                i += 1;
                continue;
            }

            // Unknown shell flag -> unclassifiable
            return InterpreterParseResult::Unclassifiable;
        }

        if token.starts_with('-') {
            return InterpreterParseResult::Unclassifiable;
        }

        // First remaining path token is script entrypoint
        return InterpreterParseResult::Entrypoint(token.clone());
    }

    // No entrypoint means an ordinary interactive shell
    InterpreterParseResult::Nonmatching
}

/// Classify interpreter executable and extract script entrypoint if present.
pub(crate) fn classify_interpreter_command(
    exe_basename: &str,
    cmdline: &[String],
) -> Option<InterpreterParseResult> {
    if cmdline.is_empty() {
        return None;
    }
    let args = &cmdline[1..];

    if exe_basename == "node" || exe_basename == "nodejs" {
        Some(parse_node_args(args))
    } else if exe_basename == "bun" {
        Some(parse_bun_args(args))
    } else if exe_basename == "python"
        || exe_basename == "python3"
        || (exe_basename.starts_with("python3.")
            && exe_basename[8..].chars().all(|c| c.is_ascii_digit()))
    {
        Some(parse_python_args(args))
    } else if matches!(exe_basename, "sh" | "bash" | "dash" | "zsh" | "ksh") {
        Some(parse_shell_args(args))
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Process matching
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AgentMatchOutcome {
    Matched {
        safe_executable_identity: Option<String>,
        entrypoint_token: Option<String>,
    },
    NotMatched,
    Uncertain {
        reason: ActivityUnavailableReason,
        retryable: bool,
    },
}

/// Helper checking if an executable basename is a supported interpreter under the finite grammar.
pub(crate) fn is_supported_interpreter(exe_basename: &str) -> bool {
    matches!(
        exe_basename,
        "node" | "nodejs" | "bun" | "python" | "python3" | "sh" | "bash" | "dash" | "zsh" | "ksh"
    ) || (exe_basename.starts_with("python3.")
        && exe_basename[8..].chars().all(|c| c.is_ascii_digit()))
}

/// Match a candidate process against the compiled agent executable set.
pub(crate) fn match_candidate_process<S: ProcessSource>(
    source: &S,
    pid: u32,
    agents: &AgentExecutableSet,
) -> AgentMatchOutcome {
    let exe = match source.read_exe(pid) {
        Ok(e) => e,
        Err(err) => {
            return AgentMatchOutcome::Uncertain {
                reason: err.reason,
                retryable: err.retryable_close_race,
            }
        }
    };

    let exe_basename = match exe.file_name().and_then(|s| s.to_str()) {
        Some(b) => b,
        None => {
            return AgentMatchOutcome::Uncertain {
                reason: ActivityUnavailableReason::IdentityUncertain,
                retryable: false,
            }
        }
    };

    let norm_exe = normalize_path(&exe);

    // 1. Direct native match against configured rules
    for rule in agents.iter() {
        match rule {
            AgentExecutableEntry::Basename(b) => {
                if exe_basename == b.as_str() {
                    let safe = validate_safe_executable_identity(exe_basename);
                    return AgentMatchOutcome::Matched {
                        safe_executable_identity: safe,
                        entrypoint_token: None,
                    };
                }
            }
            AgentExecutableEntry::AbsolutePath(p) => {
                let norm_rule = normalize_path(p);
                if norm_exe == norm_rule {
                    let safe = validate_safe_executable_identity(
                        p.to_str().unwrap_or(exe_basename),
                    );
                    return AgentMatchOutcome::Matched {
                        safe_executable_identity: safe,
                        entrypoint_token: None,
                    };
                }
            }
        }
    }

    // 2. Early interpreter check: if not a known interpreter, do not read cmdline
    if !is_supported_interpreter(exe_basename) {
        return AgentMatchOutcome::NotMatched;
    }

    // 3. Interpreter matching
    let cmdline = match source.read_cmdline(pid) {
        Ok(c) => c,
        Err(err) => {
            return AgentMatchOutcome::Uncertain {
                reason: err.reason,
                retryable: err.retryable_close_race,
            }
        }
    };

    if let Some(parse_res) = classify_interpreter_command(exe_basename, &cmdline) {
        match parse_res {
            InterpreterParseResult::Unclassifiable => {
                return AgentMatchOutcome::Uncertain {
                    reason: ActivityUnavailableReason::IdentityUncertain,
                    retryable: false,
                };
            }
            InterpreterParseResult::Nonmatching => {
                return AgentMatchOutcome::NotMatched;
            }
            InterpreterParseResult::Entrypoint(entrypoint) => {
                let entry_path = Path::new(&entrypoint);
                let entry_basename = match entry_path.file_name().and_then(|s| s.to_str()) {
                    Some(b) => b,
                    None => {
                        return AgentMatchOutcome::Uncertain {
                            reason: ActivityUnavailableReason::IdentityUncertain,
                            retryable: false,
                        }
                    }
                };

                let is_generic = GENERIC_ENTRYPOINT_BASENAMES.contains(&entry_basename);

                // Evaluate Basename rules first (no cwd read required)
                for rule in agents.iter() {
                    if let AgentExecutableEntry::Basename(b) = rule {
                        if !is_generic && entry_basename == b.as_str() {
                            let safe = validate_safe_executable_identity(entry_basename);
                            return AgentMatchOutcome::Matched {
                                safe_executable_identity: safe,
                                entrypoint_token: Some(entrypoint),
                            };
                        }
                    }
                }

                // Only resolve cwd if an AbsolutePath rule exists
                let has_abs_rules = agents.iter().any(|r| matches!(r, AgentExecutableEntry::AbsolutePath(_)));
                if has_abs_rules {
                    let norm_abs_entrypoint = if entry_path.is_absolute() {
                        normalize_path(entry_path)
                    } else {
                        let cwd = match source.read_cwd(pid) {
                            Ok(c) => c,
                            Err(err) => {
                                return AgentMatchOutcome::Uncertain {
                                    reason: err.reason,
                                    retryable: err.retryable_close_race,
                                }
                            }
                        };
                        normalize_path(&cwd.join(entry_path))
                    };

                    for rule in agents.iter() {
                        if let AgentExecutableEntry::AbsolutePath(p) = rule {
                            let norm_rule = normalize_path(p);
                            if norm_abs_entrypoint == norm_rule {
                                let safe = validate_safe_executable_identity(
                                    p.to_str().unwrap_or(entry_basename),
                                );
                                return AgentMatchOutcome::Matched {
                                    safe_executable_identity: safe,
                                    entrypoint_token: Some(entrypoint),
                                };
                            }
                        }
                    }
                }
            }
        }
    }

    AgentMatchOutcome::NotMatched
}

// ---------------------------------------------------------------------------
// Internal state tracking
// ---------------------------------------------------------------------------

/// Minimal private key tracking process image without raw argv.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct ProcessImageKey {
    pub(crate) exe_dev: u64,
    pub(crate) exe_ino: u64,
    pub(crate) entrypoint_token: Option<String>,
}

/// Retained attribution entry carrying terminal identity and raw-output counter handle.
#[derive(Clone)]
pub(crate) struct RetainedAttribution {
    pub(crate) identity: ProcessIdentity,
    pub(crate) terminal: TerminalIdentity,
    pub(crate) output_sequence: Arc<AtomicU64>,
    pub(crate) image_key: ProcessImageKey,
    pub(crate) is_matched_agent: bool,
    pub(crate) safe_executable_identity: Option<String>,
}

/// State committed across discovery samples.
#[derive(Clone, Default)]
pub(crate) struct ProcessDiscoveryState {
    pub(crate) baseline_established: bool,
    pub(crate) retained: HashMap<ProcessIdentity, RetainedAttribution>,
    pub(crate) recognized_agent_count: usize,
}

// ---------------------------------------------------------------------------
// ProcessDiscovery coordinator
// ---------------------------------------------------------------------------

/// Stateful process discovery engine.
pub(crate) struct ProcessDiscovery<S = LinuxProcSource> {
    source: S,
    committed: ProcessDiscoveryState,
}

impl ProcessDiscovery<LinuxProcSource> {
    pub(crate) fn new() -> Self {
        Self {
            source: LinuxProcSource::new(),
            committed: ProcessDiscoveryState::default(),
        }
    }
}

impl<S: ProcessSource> ProcessDiscovery<S> {
    pub(crate) fn with_source(source: S) -> Self {
        Self {
            source,
            committed: ProcessDiscoveryState::default(),
        }
    }

    /// Mark comparison baseline invalid while preserving retained identity/terminal/output state.
    pub(crate) fn invalidate(&mut self) {
        self.committed.baseline_established = false;
    }

    /// Prepare a candidate discovery sample without mutating committed state.
    pub(crate) fn prepare_sample(
        &self,
        pty: &PtyActivitySnapshot,
        agents: &AgentExecutableSet,
        deadline: Instant,
    ) -> Result<PreparedProcessSample, ActivityUnavailable> {
        let check_deadline = || -> Result<(), ActivityUnavailable> {
            if Instant::now() >= deadline {
                Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::ScanTimeout,
                ))
            } else {
                Ok(())
            }
        };

        check_deadline()?;

        // 1. Snapshot qualification checks (Requirement 1)
        if !pty.is_complete() {
            let reason = match &pty.incomplete_reason {
                Some(crate::pty::activity::ActivityIncompleteReason::ScanLimitExceeded { .. }) => {
                    ActivityUnavailableReason::ScanLimit
                }
                Some(crate::pty::activity::ActivityIncompleteReason::CounterSaturated { .. }) => {
                    ActivityUnavailableReason::CounterOverflow
                }
                Some(crate::pty::activity::ActivityIncompleteReason::RevisionSaturated) => {
                    ActivityUnavailableReason::CounterOverflow
                }
                Some(crate::pty::activity::ActivityIncompleteReason::RootUnqualified { .. }) => {
                    ActivityUnavailableReason::IdentityUncertain
                }
                None => ActivityUnavailableReason::IdentityUncertain,
            };
            return Err(ActivityUnavailable::new(reason));
        }

        if pty.roots.len() > MAX_MANAGED_ROOTS_LIMIT {
            return Err(ActivityUnavailable::new(ActivityUnavailableReason::ScanLimit));
        }

        // Validate unique terminals and qualified roots
        let mut qualified_roots = Vec::with_capacity(pty.roots.len());
        let mut seen_terminals = HashSet::new();
        let mut seen_root_pids = HashMap::new();

        for root in &pty.roots {
            if !seen_terminals.insert(root.terminal.clone()) {
                // Duplicate terminal identity
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::IdentityUncertain,
                ));
            }

            let proc_id = match root.qualification {
                RootQualification::Qualified { identity } => identity,
                _ => {
                    return Err(ActivityUnavailable::new(
                        ActivityUnavailableReason::IdentityUncertain,
                    ))
                }
            };

            if let Some(existing_term) = seen_root_pids.insert(proc_id.pid, root.terminal.clone()) {
                if existing_term != root.terminal {
                    return Err(ActivityUnavailable::new(
                        ActivityUnavailableReason::IdentityUncertain,
                    ));
                }
            }

            qualified_roots.push((root.terminal.clone(), proc_id, root.raw_output_sequence.clone()));
        }

        // 2. Read raw sequence values for all live-root handles AND all retained handles BEFORE procfs work (Requirement 14)
        let mut terminal_handles: HashMap<TerminalIdentity, (Arc<AtomicU64>, u64)> = HashMap::new();
        for (term, _pid, handle) in &qualified_roots {
            let seq = handle.load(Ordering::Relaxed);
            if seq == SATURATED_COUNTER_SENTINEL {
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::CounterOverflow,
                ));
            }
            terminal_handles.insert(term.clone(), (handle.clone(), seq));
        }

        for retained in self.committed.retained.values() {
            if !terminal_handles.contains_key(&retained.terminal) {
                let seq = retained.output_sequence.load(Ordering::Relaxed);
                if seq == SATURATED_COUNTER_SENTINEL {
                    return Err(ActivityUnavailable::new(
                        ActivityUnavailableReason::CounterOverflow,
                    ));
                }
                terminal_handles.insert(retained.terminal.clone(), (retained.output_sequence.clone(), seq));
            }
        }

        check_deadline()?;

        // 3. Network namespace of observing thread
        let thread_netns = self.source.read_thread_netns()?;

        // 4. Scan /proc once per pass and build stat table + adjacency (Requirement 2)
        let pids = self.source.list_pids()?;
        let mut all_stats: HashMap<u32, ProcessStat> = HashMap::with_capacity(pids.len());
        let mut pid_to_identity: HashMap<u32, ProcessIdentity> = HashMap::with_capacity(pids.len());
        let mut ppid_to_children: HashMap<u32, Vec<u32>> = HashMap::new();

        for (count, pid) in pids.iter().enumerate() {
            if count % 128 == 0 {
                check_deadline()?;
            }
            match self.source.read_stat(*pid) {
                Ok(stat) => {
                    let identity = ProcessIdentity {
                        pid: stat.pid,
                        start_ticks: stat.start_ticks,
                    };
                    ppid_to_children.entry(stat.ppid).or_default().push(stat.pid);
                    pid_to_identity.insert(stat.pid, identity);
                    all_stats.insert(stat.pid, stat);
                }
                Err(err) if err.retryable_close_race => {
                    // Process exited during scan; ignore non-managed background process
                    continue;
                }
                Err(err) => return Err(err),
            }
        }

        check_deadline()?;

        // 5. Validate every qualified root by full ProcessIdentity (Requirement 4)
        for (_term, root_id, _handle) in &qualified_roots {
            match pid_to_identity.get(&root_id.pid) {
                Some(current_id) if current_id == root_id => {
                    // Validated root present with same start ticks
                }
                _ => {
                    // Root disappeared or reused: retryable race
                    return Err(ActivityUnavailable::retryable(
                        ActivityUnavailableReason::IdentityUncertain,
                    ));
                }
            }
        }

        // 6. Retain alive identities from committed state (Requirement 14)
        let mut next_retained: HashMap<ProcessIdentity, RetainedAttribution> = HashMap::new();
        for (retained_id, retained_attr) in &self.committed.retained {
            if let Some(current_id) = pid_to_identity.get(&retained_id.pid) {
                if current_id == retained_id {
                    let stat = &all_stats[&retained_id.pid];
                    // Zombie/dead retired (Requirement 14)
                    if stat.state != 'Z' && stat.state != 'X' {
                        next_retained.insert(*retained_id, retained_attr.clone());
                    }
                }
            }
        }

        check_deadline()?;

        // 7. Map reachable processes under managed roots and validate no multi-root ambiguity (Requirement 5)
        let mut current_attribution: HashMap<ProcessIdentity, TerminalIdentity> = HashMap::new();

        for (term, root_id, _handle) in &qualified_roots {
            let mut stack = vec![root_id.pid];
            while let Some(curr_pid) = stack.pop() {
                check_deadline()?;
                if let Some(curr_id) = pid_to_identity.get(&curr_pid) {
                    if let Some(existing_term) = current_attribution.insert(*curr_id, term.clone()) {
                        if existing_term != *term {
                            // Multiple root reachability conflict
                            return Err(ActivityUnavailable::new(
                                ActivityUnavailableReason::IdentityUncertain,
                            ));
                        }
                    }
                    if let Some(children) = ppid_to_children.get(&curr_pid) {
                        for child_pid in children {
                            stack.push(*child_pid);
                        }
                    }
                }
            }
        }

        // Also merge retained running processes and trace their new descendants
        for (retained_id, retained_attr) in &next_retained {
            if let Some(existing_term) = current_attribution.get(retained_id) {
                if *existing_term != retained_attr.terminal {
                    return Err(ActivityUnavailable::new(
                        ActivityUnavailableReason::IdentityUncertain,
                    ));
                }
            } else {
                current_attribution.insert(*retained_id, retained_attr.terminal.clone());
            }

            // Trace descendants of retained processes
            let mut stack = vec![retained_id.pid];
            while let Some(curr_pid) = stack.pop() {
                if let Some(children) = ppid_to_children.get(&curr_pid) {
                    for child_pid in children {
                        if let Some(child_id) = pid_to_identity.get(child_pid) {
                            if let Some(existing_term) = current_attribution.insert(*child_id, retained_attr.terminal.clone()) {
                                if existing_term != retained_attr.terminal {
                                    return Err(ActivityUnavailable::new(
                                        ActivityUnavailableReason::IdentityUncertain,
                                    ));
                                }
                            }
                            stack.push(*child_pid);
                        }
                    }
                }
            }
        }

        check_deadline()?;

        // 8. Match reachable processes against agent set (Requirement 7-12)
        let mut recognized_agents: HashSet<ProcessIdentity> = HashSet::new();
        let mut agent_match_info: HashMap<ProcessIdentity, (Option<String>, Option<String>)> = HashMap::new();

        // Sort reachable processes by PID for deterministic evaluation
        let mut candidate_ids: Vec<ProcessIdentity> = current_attribution.keys().copied().collect();
        candidate_ids.sort_by_key(|id| (id.pid, id.start_ticks));

        for id in &candidate_ids {
            check_deadline()?;

            // Read start ticks before inspection
            let stat_before = match self.source.read_stat(id.pid) {
                Ok(s) => s,
                Err(err) if err.retryable_close_race => {
                    return Err(ActivityUnavailable::retryable(
                        ActivityUnavailableReason::IdentityUncertain,
                    ));
                }
                Err(err) => return Err(err),
            };
            if stat_before.start_ticks != id.start_ticks {
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::IdentityUncertain,
                ));
            }

            let match_res = match_candidate_process(&self.source, id.pid, agents);

            // Read start ticks after inspection
            let stat_after = match self.source.read_stat(id.pid) {
                Ok(s) => s,
                Err(err) if err.retryable_close_race => {
                    return Err(ActivityUnavailable::retryable(
                        ActivityUnavailableReason::IdentityUncertain,
                    ));
                }
                Err(err) => return Err(err),
            };
            if stat_after.start_ticks != id.start_ticks {
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::IdentityUncertain,
                ));
            }

            match match_res {
                AgentMatchOutcome::Matched {
                    safe_executable_identity,
                    entrypoint_token,
                } => {
                    recognized_agents.insert(*id);
                    agent_match_info.insert(*id, (safe_executable_identity, entrypoint_token));
                }
                AgentMatchOutcome::NotMatched => {}
                AgentMatchOutcome::Uncertain { reason, retryable } => {
                    let context = FailureContext::single_process(*id, None);
                    return Err(if retryable {
                        ActivityUnavailable::retryable_with_context(reason, context)
                    } else {
                        ActivityUnavailable::with_context(reason, context)
                    });
                }
            }
        }

        check_deadline()?;

        // 9. Compute descendant closure of recognized agents (Requirement 13)
        let mut relevant_processes: HashSet<ProcessIdentity> = HashSet::new();
        for agent_id in &recognized_agents {
            let mut stack = vec![agent_id.pid];
            while let Some(curr_pid) = stack.pop() {
                check_deadline()?;
                if let Some(curr_id) = pid_to_identity.get(&curr_pid) {
                    if relevant_processes.insert(*curr_id) {
                        if relevant_processes.len() > MAX_RELEVANT_PROCESSES_LIMIT {
                            return Err(ActivityUnavailable::new(ActivityUnavailableReason::ScanLimit));
                        }
                        if let Some(children) = ppid_to_children.get(&curr_pid) {
                            for child_pid in children {
                                stack.push(*child_pid);
                            }
                        }
                    }
                }
            }
        }

        // Also include any retained relevant processes that are still alive
        for (retained_id, retained_attr) in &next_retained {
            if relevant_processes.contains(retained_id) {
                continue;
            }
            if retained_attr.is_matched_agent {
                recognized_agents.insert(*retained_id);
                let mut stack = vec![retained_id.pid];
                while let Some(curr_pid) = stack.pop() {
                    check_deadline()?;
                    if let Some(curr_id) = pid_to_identity.get(&curr_pid) {
                        if relevant_processes.insert(*curr_id) {
                            if relevant_processes.len() > MAX_RELEVANT_PROCESSES_LIMIT {
                                return Err(ActivityUnavailable::new(ActivityUnavailableReason::ScanLimit));
                            }
                            if let Some(children) = ppid_to_children.get(&curr_pid) {
                                for child_pid in children {
                                    stack.push(*child_pid);
                                }
                            }
                        }
                    }
                }
            } else {
                relevant_processes.insert(*retained_id);
                if relevant_processes.len() > MAX_RELEVANT_PROCESSES_LIMIT {
                    return Err(ActivityUnavailable::new(ActivityUnavailableReason::ScanLimit));
                }
            }
        }

        check_deadline()?;

        // 10. For valid zero-agent result: return empty OwnedSocketSet without scanning FDs (Requirement 20)
        let mut sorted_relevant: Vec<ProcessIdentity> = relevant_processes.into_iter().collect();
        sorted_relevant.sort_by_key(|id| (id.pid, id.start_ticks));

        let mut owned_sockets_map: HashMap<u64, Vec<ProcessIdentity>> = HashMap::new();
        let mut process_evidence: Vec<BlockingProcessEvidence> = Vec::with_capacity(sorted_relevant.len());
        let mut next_retained_map: HashMap<ProcessIdentity, RetainedAttribution> = HashMap::new();

        for proc_id in &sorted_relevant {
            check_deadline()?;

            // Verify identity pre-read
            let pre_stat = match self.source.read_stat(proc_id.pid) {
                Ok(s) => s,
                Err(err) if err.retryable_close_race => {
                    return Err(ActivityUnavailable::retryable(
                        ActivityUnavailableReason::IdentityUncertain,
                    ));
                }
                Err(err) => return Err(err),
            };
            if pre_stat.start_ticks != proc_id.start_ticks {
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::IdentityUncertain,
                ));
            }

            // Verify network namespace (Requirement 19)
            let netns = match self.source.read_netns(proc_id.pid) {
                Ok(ns) => ns,
                Err(err) => {
                    return Err(ActivityUnavailable::with_context(
                        err.reason,
                        FailureContext::single_process(*proc_id, None),
                    ));
                }
            };
            if netns != thread_netns {
                let safe_identity = agent_match_info.get(proc_id).and_then(|(safe, _)| safe.clone());
                return Err(ActivityUnavailable::with_context(
                    ActivityUnavailableReason::NamespaceMismatch,
                    FailureContext::single_process(*proc_id, safe_identity),
                ));
            }

            // Read executable metadata for image key
            let (exe_dev, exe_ino) = match self.source.read_exe_metadata(proc_id.pid) {
                Ok(meta) => meta,
                Err(err) if err.retryable_close_race => {
                    return Err(ActivityUnavailable::retryable(
                        ActivityUnavailableReason::IdentityUncertain,
                    ));
                }
                Err(err) => return Err(err),
            };

            let (safe_identity, entrypoint_token) = if let Some(info) = agent_match_info.get(proc_id) {
                info.clone()
            } else if let Some(retained) = next_retained.get(proc_id) {
                (retained.safe_executable_identity.clone(), retained.image_key.entrypoint_token.clone())
            } else {
                (None, None)
            };

            let image_key = ProcessImageKey {
                exe_dev,
                exe_ino,
                entrypoint_token,
            };

            let is_matched_agent = recognized_agents.contains(proc_id);

            let terminal = current_attribution.get(proc_id).cloned().ok_or_else(|| {
                ActivityUnavailable::new(ActivityUnavailableReason::IdentityUncertain)
            })?;

            let output_sequence = terminal_handles.get(&terminal).map(|(arc, _)| arc.clone()).ok_or_else(|| {
                ActivityUnavailable::new(ActivityUnavailableReason::IdentityUncertain)
            })?;

            next_retained_map.insert(
                *proc_id,
                RetainedAttribution {
                    identity: *proc_id,
                    terminal,
                    output_sequence,
                    image_key,
                    is_matched_agent,
                    safe_executable_identity: safe_identity.clone(),
                },
            );

            process_evidence.push(BlockingProcessEvidence {
                process: *proc_id,
                safe_executable_identity: safe_identity,
            });

            // Enumerate FDs for socket links (Requirement 17)
            let fds = self.source.list_fds(proc_id.pid)?;
            for fd in fds {
                match self.source.read_fd_socket(proc_id.pid, fd) {
                    Ok(Some(inode)) => {
                        owned_sockets_map.entry(inode).or_default().push(*proc_id);
                        if owned_sockets_map.len() > MAX_OWNED_SOCKETS_LIMIT {
                            return Err(ActivityUnavailable::new(ActivityUnavailableReason::ScanLimit));
                        }
                    }
                    Ok(None) => {}
                    Err(err) if err.retryable_close_race => {
                        return Err(err);
                    }
                    Err(err) => return Err(err),
                }
            }

            // Verify identity post-read
            let post_stat = match self.source.read_stat(proc_id.pid) {
                Ok(s) => s,
                Err(err) if err.retryable_close_race => {
                    return Err(ActivityUnavailable::retryable(
                        ActivityUnavailableReason::IdentityUncertain,
                    ));
                }
                Err(err) => return Err(err),
            };
            if post_stat.start_ticks != proc_id.start_ticks {
                return Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::IdentityUncertain,
                ));
            }
        }

        check_deadline()?;

        // 11. Deduplicate owned sockets and assign deterministic representative owner (Requirement 17)
        let mut owned_socket_inodes = Vec::with_capacity(owned_sockets_map.len());
        for (inode, mut owners) in owned_sockets_map {
            owners.sort_by_key(|id| (id.pid, id.start_ticks));
            let representative_owner = owners[0];
            let has_additional_owners = owners.len() > 1;
            owned_socket_inodes.push(OwnedSocketInode {
                inode,
                representative_owner,
                has_additional_owners,
            });
        }
        owned_socket_inodes.sort_by_key(|osi| osi.inode);

        let owned_sockets = OwnedSocketSet {
            namespace: thread_netns,
            inodes: owned_socket_inodes,
        };

        // 12. Monitored terminal evidence (Requirement 14)
        let mut monitored_terminals_map: HashMap<TerminalIdentity, (Arc<AtomicU64>, u64)> = HashMap::new();
        for retained in next_retained_map.values() {
            if !monitored_terminals_map.contains_key(&retained.terminal) {
                if let Some((handle, start_seq)) = terminal_handles.get(&retained.terminal) {
                    monitored_terminals_map.insert(retained.terminal.clone(), (handle.clone(), *start_seq));
                }
            }
        }

        let mut monitored_terminals: Vec<MonitoredTerminalEvidence> = monitored_terminals_map
            .into_iter()
            .map(|(terminal, (output_sequence, sample_start_sequence))| MonitoredTerminalEvidence {
                terminal,
                output_sequence,
                sample_start_sequence,
            })
            .collect();
        monitored_terminals.sort_by(|a, b| {
            a.terminal
                .session_id
                .cmp(&b.terminal.session_id)
                .then(a.terminal.incarnation.cmp(&b.terminal.incarnation))
        });

        // 13. Determine process change (Requirement 16)
        let change = if !self.committed.baseline_established {
            ProcessChange::BaselineEstablished
        } else {
            let mut changed = false;

            if recognized_agents.len() != self.committed.recognized_agent_count {
                changed = true;
            } else if next_retained_map.len() != self.committed.retained.len() {
                changed = true;
            } else {
                for (id, curr_attr) in &next_retained_map {
                    if let Some(prev_attr) = self.committed.retained.get(id) {
                        if curr_attr.terminal != prev_attr.terminal
                            || curr_attr.is_matched_agent != prev_attr.is_matched_agent
                            || curr_attr.image_key != prev_attr.image_key
                        {
                            changed = true;
                            break;
                        }
                    } else {
                        changed = true;
                        break;
                    }
                }
            }

            if changed {
                ProcessChange::Activity
            } else {
                ProcessChange::Unchanged
            }
        };

        let sample = ProcessSample {
            recognized_agent_count: recognized_agents.len(),
            monitored_terminals,
            owned_sockets,
            process_evidence,
            change,
        };

        let next_state = ProcessDiscoveryState {
            baseline_established: true,
            retained: next_retained_map,
            recognized_agent_count: recognized_agents.len(),
        };

        Ok(PreparedProcessSample { sample, next_state })
    }

    /// Commit a prepared discovery sample infallibly to advance retained state.
    pub(crate) fn commit_sample(&mut self, prepared: PreparedProcessSample) -> ProcessSample {
        self.committed = prepared.next_state;
        prepared.sample
    }
}

/// Prepared candidate discovery sample.
pub(crate) struct PreparedProcessSample {
    pub(crate) sample: ProcessSample,
    pub(crate) next_state: ProcessDiscoveryState,
}

impl PreparedProcessSample {
    pub(crate) fn sample(&self) -> &ProcessSample {
        &self.sample
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;
    use std::sync::Arc;
    use std::time::Duration;
    use crate::pty::fleet_state::PtyFleetSnapshot;
    use crate::pty::activity::RootActivityRecord;

    // -----------------------------------------------------------------------
    // Grammar tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_node_grammar_valid_and_unclassifiable() {
        // Valid standard flags
        let args = vec![
            "--enable-source-maps".to_string(),
            "--require".to_string(),
            "./preload.js".to_string(),
            "dist/index.js".to_string(),
        ];
        assert_eq!(
            parse_node_args(&args),
            InterpreterParseResult::Entrypoint("dist/index.js".to_string())
        );

        // Inspector flag with value
        let args_inspect = vec![
            "--inspect=127.0.0.1:9229".to_string(),
            "server.js".to_string(),
        ];
        assert_eq!(
            parse_node_args(&args_inspect),
            InterpreterParseResult::Entrypoint("server.js".to_string())
        );

        // End of options --
        let args_dashes = vec![
            "--".to_string(),
            "--weird-name.js".to_string(),
        ];
        assert_eq!(
            parse_node_args(&args_dashes),
            InterpreterParseResult::Entrypoint("--weird-name.js".to_string())
        );

        // Eval forms -> unclassifiable
        let args_eval = vec!["-e".to_string(), "console.log('hi')".to_string()];
        assert_eq!(parse_node_args(&args_eval), InterpreterParseResult::Unclassifiable);

        let args_print = vec!["--print".to_string(), "1+1".to_string()];
        assert_eq!(parse_node_args(&args_print), InterpreterParseResult::Unclassifiable);

        // Unknown flag -> unclassifiable
        let args_unknown = vec!["--custom-flag".to_string(), "index.js".to_string()];
        assert_eq!(parse_node_args(&args_unknown), InterpreterParseResult::Unclassifiable);

        // Missing value for --require
        let args_missing = vec!["--require".to_string()];
        assert_eq!(parse_node_args(&args_missing), InterpreterParseResult::Unclassifiable);
    }

    #[test]
    fn test_bun_grammar_valid_and_unclassifiable() {
        let args_run_path = vec!["run".to_string(), "./agent.ts".to_string()];
        assert_eq!(
            parse_bun_args(&args_run_path),
            InterpreterParseResult::Entrypoint("./agent.ts".to_string())
        );

        // Bare bun run <package-script> -> unclassifiable
        let args_run_bare = vec!["run".to_string(), "dev".to_string()];
        assert_eq!(parse_bun_args(&args_run_bare), InterpreterParseResult::Unclassifiable);

        // Direct script with flags
        let args_direct = vec!["--silent".to_string(), "runner.js".to_string()];
        assert_eq!(
            parse_bun_args(&args_direct),
            InterpreterParseResult::Entrypoint("runner.js".to_string())
        );

        // Package manager subcommands -> unclassifiable
        let args_test = vec!["test".to_string()];
        assert_eq!(parse_bun_args(&args_test), InterpreterParseResult::Unclassifiable);
        let args_install = vec!["install".to_string()];
        assert_eq!(parse_bun_args(&args_install), InterpreterParseResult::Unclassifiable);
    }

    #[test]
    fn test_python_grammar_valid_and_unclassifiable() {
        let args_valid = vec![
            "-B".to_string(),
            "-W".to_string(),
            "ignore".to_string(),
            "-X".to_string(),
            "dev".to_string(),
            "agent.py".to_string(),
        ];
        assert_eq!(
            parse_python_args(&args_valid),
            InterpreterParseResult::Entrypoint("agent.py".to_string())
        );

        // -c form -> unclassifiable
        let args_c = vec!["-c".to_string(), "import sys; print(1)".to_string()];
        assert_eq!(parse_python_args(&args_c), InterpreterParseResult::Unclassifiable);

        // -m module -> unclassifiable
        let args_m = vec!["-m".to_string(), "http.server".to_string()];
        assert_eq!(parse_python_args(&args_m), InterpreterParseResult::Unclassifiable);

        // stdin -> unclassifiable
        let args_stdin = vec!["-".to_string()];
        assert_eq!(parse_python_args(&args_stdin), InterpreterParseResult::Unclassifiable);
    }

    #[test]
    fn test_shell_grammar_valid_and_command_string_wrapper() {
        // Normal script with allowed flags
        let args_script = vec!["-e".to_string(), "-u".to_string(), "./build.sh".to_string()];
        assert_eq!(
            parse_shell_args(&args_script),
            InterpreterParseResult::Entrypoint("./build.sh".to_string())
        );

        // bash -c 'codex' is a known command-string wrapper (Requirement 11) -> Nonmatching
        let args_wrapper = vec!["-c".to_string(), "codex".to_string()];
        assert_eq!(parse_shell_args(&args_wrapper), InterpreterParseResult::Nonmatching);

        let args_combined_c = vec!["-xc".to_string(), "codex".to_string()];
        assert_eq!(parse_shell_args(&args_combined_c), InterpreterParseResult::Nonmatching);

        // Stdin -s -> Nonmatching
        let args_s = vec!["-s".to_string()];
        assert_eq!(parse_shell_args(&args_s), InterpreterParseResult::Nonmatching);

        // Interactive shell with no entrypoint -> Nonmatching
        let args_interactive = vec!["-i".to_string()];
        assert_eq!(parse_shell_args(&args_interactive), InterpreterParseResult::Nonmatching);
        assert_eq!(parse_shell_args(&[]), InterpreterParseResult::Nonmatching);

        // Unknown flag -> unclassifiable
        let args_unknown = vec!["-z".to_string(), "script.sh".to_string()];
        assert_eq!(parse_shell_args(&args_unknown), InterpreterParseResult::Unclassifiable);
    }

    #[test]
    fn test_generic_entrypoint_basename_rejected() {
        let source = MockProcessSource::new();
        let pid = 100;

        let mut src = source;
        src.set_proc(
            pid,
            1,
            PathBuf::from("/usr/bin/node"),
            vec!["node".to_string(), "cli.js".to_string()],
            PathBuf::from("/workspace"),
            (1, 1),
            1000,
        );

        // Basename rule "cli.js" must be rejected per Requirement 10
        let agents_basename = AgentExecutableSet::from_strings(&["cli.js".to_string()]).unwrap();
        let match_basename = match_candidate_process(&src, pid, &agents_basename);
        assert_eq!(match_basename, AgentMatchOutcome::NotMatched);

        // Configured absolute path rule "/workspace/cli.js" matches
        let agents_abs = AgentExecutableSet::from_strings(&["/workspace/cli.js".to_string()]).unwrap();
        let match_abs = match_candidate_process(&src, pid, &agents_abs);
        assert!(matches!(match_abs, AgentMatchOutcome::Matched { .. }));
    }

    // -----------------------------------------------------------------------
    // MockProcessSource
    // -----------------------------------------------------------------------

    #[derive(Default, Clone)]
    struct MockProcessSource {
        pids: Vec<u32>,
        stats: HashMap<u32, ProcessStat>,
        exes: HashMap<u32, PathBuf>,
        exe_metas: HashMap<u32, (u64, u64)>,
        cmdlines: HashMap<u32, Vec<String>>,
        cwds: HashMap<u32, PathBuf>,
        netns: HashMap<u32, NetworkNamespaceIdentity>,
        thread_netns: NetworkNamespaceIdentity,
        fds: HashMap<u32, Vec<u32>>,
        sockets: HashMap<(u32, u32), Option<u64>>,
        deleted_exes: HashSet<u32>,
        tick_shift_on_second_read: HashSet<u32>,
        read_stat_counts: std::sync::Arc<std::sync::Mutex<HashMap<u32, usize>>>,
    }

    impl MockProcessSource {
        fn new() -> Self {
            Self {
                thread_netns: NetworkNamespaceIdentity { device: 10, inode: 100 },
                ..Default::default()
            }
        }

        fn set_proc(
            &mut self,
            pid: u32,
            ppid: u32,
            exe: PathBuf,
            cmdline: Vec<String>,
            cwd: PathBuf,
            exe_meta: (u64, u64),
            start_ticks: u64,
        ) {
            if !self.pids.contains(&pid) {
                self.pids.push(pid);
            }
            let comm = exe.file_name().and_then(|s| s.to_str()).unwrap_or("proc").to_string();
            self.stats.insert(
                pid,
                ProcessStat {
                    pid,
                    comm,
                    state: 'S',
                    ppid,
                    start_ticks,
                },
            );
            self.exes.insert(pid, exe);
            self.exe_metas.insert(pid, exe_meta);
            self.cmdlines.insert(pid, cmdline);
            self.cwds.insert(pid, cwd);
            self.netns.insert(pid, self.thread_netns);
            self.fds.insert(pid, Vec::new());
        }

        fn add_socket(&mut self, pid: u32, fd: u32, inode: u64) {
            self.fds.entry(pid).or_default().push(fd);
            self.sockets.insert((pid, fd), Some(inode));
        }
    }

    impl ProcessSource for MockProcessSource {
        fn list_pids(&self) -> Result<Vec<u32>, ActivityUnavailable> {
            if self.pids.len() > MAX_SCANNED_PROCESSES_LIMIT {
                return Err(ActivityUnavailable::new(ActivityUnavailableReason::ScanLimit));
            }
            Ok(self.pids.clone())
        }

        fn read_stat(&self, pid: u32) -> Result<ProcessStat, ActivityUnavailable> {
            let mut stat = self.stats.get(&pid).cloned().ok_or_else(|| {
                ActivityUnavailable::retryable(ActivityUnavailableReason::ProcAccess)
            })?;

            let mut counts = self.read_stat_counts.lock().unwrap();
            let count = counts.entry(pid).or_insert(0);
            *count += 1;

            if *count > 1 && self.tick_shift_on_second_read.contains(&pid) {
                stat.start_ticks += 100;
            }

            Ok(stat)
        }

        fn read_exe(&self, pid: u32) -> Result<PathBuf, ActivityUnavailable> {
            if self.deleted_exes.contains(&pid) {
                return Err(ActivityUnavailable::new(ActivityUnavailableReason::IdentityUncertain));
            }
            self.exes.get(&pid).cloned().ok_or_else(|| {
                ActivityUnavailable::retryable(ActivityUnavailableReason::ProcAccess)
            })
        }

        fn read_exe_metadata(&self, pid: u32) -> Result<(u64, u64), ActivityUnavailable> {
            self.exe_metas.get(&pid).copied().ok_or_else(|| {
                ActivityUnavailable::retryable(ActivityUnavailableReason::ProcAccess)
            })
        }

        fn read_cmdline(&self, pid: u32) -> Result<Vec<String>, ActivityUnavailable> {
            self.cmdlines.get(&pid).cloned().ok_or_else(|| {
                ActivityUnavailable::retryable(ActivityUnavailableReason::ProcAccess)
            })
        }

        fn read_cwd(&self, pid: u32) -> Result<PathBuf, ActivityUnavailable> {
            self.cwds.get(&pid).cloned().ok_or_else(|| {
                ActivityUnavailable::retryable(ActivityUnavailableReason::ProcAccess)
            })
        }

        fn read_netns(&self, pid: u32) -> Result<NetworkNamespaceIdentity, ActivityUnavailable> {
            self.netns.get(&pid).copied().ok_or_else(|| {
                ActivityUnavailable::retryable(ActivityUnavailableReason::ProcAccess)
            })
        }

        fn read_thread_netns(&self) -> Result<NetworkNamespaceIdentity, ActivityUnavailable> {
            Ok(self.thread_netns)
        }

        fn list_fds(&self, pid: u32) -> Result<Vec<u32>, ActivityUnavailable> {
            let fds = self.fds.get(&pid).cloned().unwrap_or_default();
            if fds.len() > MAX_PROCESS_FDS_LIMIT {
                return Err(ActivityUnavailable::new(ActivityUnavailableReason::ScanLimit));
            }
            Ok(fds)
        }

        fn read_fd_socket(&self, pid: u32, fd: u32) -> Result<Option<u64>, ActivityUnavailable> {
            Ok(self.sockets.get(&(pid, fd)).copied().flatten())
        }
    }

    fn make_test_pty_snapshot(roots: Vec<(TerminalIdentity, ProcessIdentity, Arc<AtomicU64>)>) -> PtyActivitySnapshot {
        let records: Vec<RootActivityRecord> = roots
            .into_iter()
            .map(|(terminal, identity, raw_output_sequence)| RootActivityRecord {
                terminal,
                qualification: RootQualification::Qualified { identity },
                raw_output_sequence,
            })
            .collect();
        PtyActivitySnapshot {
            fleet: PtyFleetSnapshot {
                generation: 1,
                live_count: records.len(),
                creating_count: 0,
                restart_pending_count: 0,
                disposing: false,
                closing: false,
                handoff_active: false,
            },
            input_revision: 1,
            last_input_at: None,
            roots: records,
            captured_at: Instant::now(),
            incomplete_reason: None,
        }
    }

    #[test]
    fn test_valid_zero_agent_pass() {
        let mut src = MockProcessSource::new();
        let term = TerminalIdentity { session_id: "term-1".to_string(), incarnation: 1 };
        let root_id = ProcessIdentity { pid: 10, start_ticks: 1000 };

        // Root process is an interactive bash shell
        src.set_proc(
            10,
            1,
            PathBuf::from("/bin/bash"),
            vec!["bash".to_string(), "-i".to_string()],
            PathBuf::from("/home/user"),
            (1, 10),
            1000,
        );

        let discovery = ProcessDiscovery::with_source(src);
        let agents = AgentExecutableSet::from_strings(&["codex".to_string()]).unwrap();
        let pty = make_test_pty_snapshot(vec![(term, root_id, Arc::new(AtomicU64::new(0)))]);

        let deadline = Instant::now() + Duration::from_secs(1);
        let prepared = discovery.prepare_sample(&pty, &agents, deadline).expect("prepare should succeed");
        let sample = prepared.sample();

        // Valid zero-agent pass produces 0 recognized agents and empty owned sockets
        assert_eq!(sample.recognized_agent_count, 0);
        assert!(sample.owned_sockets.is_empty());
        assert_eq!(sample.change, ProcessChange::BaselineEstablished);
    }

    #[test]
    fn test_matched_agent_and_descendants_relevant() {
        let mut src = MockProcessSource::new();
        let term = TerminalIdentity { session_id: "term-1".to_string(), incarnation: 1 };
        let root_id = ProcessIdentity { pid: 10, start_ticks: 1000 };

        // Root process: bash (PID 10)
        src.set_proc(10, 1, PathBuf::from("/bin/bash"), vec!["bash".to_string()], PathBuf::from("/home"), (1, 10), 1000);

        // Child process: codex (PID 20, ppid 10) -> matches agent rule
        src.set_proc(20, 10, PathBuf::from("/usr/local/bin/codex"), vec!["codex".to_string()], PathBuf::from("/home"), (1, 20), 2000);

        // Descendant process: worker (PID 30, ppid 20) -> relevant
        src.set_proc(30, 20, PathBuf::from("/usr/bin/node"), vec!["node".to_string(), "worker.js".to_string()], PathBuf::from("/home"), (1, 30), 3000);
        src.add_socket(30, 4, 12345);

        // Nested descendant: helper (PID 40, ppid 30) -> also shares socket 12345
        src.set_proc(40, 30, PathBuf::from("/usr/bin/helper"), vec!["helper".to_string()], PathBuf::from("/home"), (1, 40), 4000);
        src.add_socket(40, 5, 12345);

        let mut discovery = ProcessDiscovery::with_source(src);
        let agents = AgentExecutableSet::from_strings(&["codex".to_string()]).unwrap();
        let pty = make_test_pty_snapshot(vec![(term.clone(), root_id, Arc::new(AtomicU64::new(5)))]);

        let deadline = Instant::now() + Duration::from_secs(1);
        let prepared = discovery.prepare_sample(&pty, &agents, deadline).expect("prepare should succeed");
        let sample = prepared.sample();

        assert_eq!(sample.recognized_agent_count, 1);
        assert_eq!(sample.owned_sockets.len(), 1);
        let socket = &sample.owned_sockets.inodes[0];
        assert_eq!(socket.inode, 12345);
        // Representative owner is the lowest PID (30)
        assert_eq!(socket.representative_owner.pid, 30);
        assert!(socket.has_additional_owners);

        // Relevant processes: codex (20), worker (30), helper (40)
        assert_eq!(sample.process_evidence.len(), 3);
        assert_eq!(sample.change, ProcessChange::BaselineEstablished);

        // Commit sample
        let committed_sample = discovery.commit_sample(prepared);
        assert_eq!(committed_sample.recognized_agent_count, 1);

        // Next pass with no changes emits ProcessChange::Unchanged
        let prepared2 = discovery.prepare_sample(&pty, &agents, deadline).expect("prepare 2 should succeed");
        assert_eq!(prepared2.sample().change, ProcessChange::Unchanged);
    }

    #[test]
    fn test_retained_attribution_across_root_removal_and_reparenting() {
        let mut src = MockProcessSource::new();
        let term = TerminalIdentity { session_id: "term-1".to_string(), incarnation: 1 };
        let root_id = ProcessIdentity { pid: 10, start_ticks: 1000 };
        let counter = Arc::new(AtomicU64::new(10));

        // Pass 1: root bash (10) -> child codex (20)
        src.set_proc(10, 1, PathBuf::from("/bin/bash"), vec!["bash".to_string()], PathBuf::from("/home"), (1, 10), 1000);
        src.set_proc(20, 10, PathBuf::from("/usr/bin/codex"), vec!["codex".to_string()], PathBuf::from("/home"), (1, 20), 2000);

        let mut discovery = ProcessDiscovery::with_source(src.clone());
        let agents = AgentExecutableSet::from_strings(&["codex".to_string()]).unwrap();
        let pty1 = make_test_pty_snapshot(vec![(term.clone(), root_id, counter.clone())]);

        let deadline = Instant::now() + Duration::from_secs(1);
        let prep1 = discovery.prepare_sample(&pty1, &agents, deadline).unwrap();
        discovery.commit_sample(prep1);

        // Pass 2: Root process 10 exited! Session removed from pty snapshot (empty roots).
        // Codex (20) reparented to systemd/init (ppid = 1).
        let mut src2 = src.clone();
        src2.pids.retain(|&p| p != 10);
        src2.stats.remove(&10);
        // Codex now has ppid 1
        if let Some(s) = src2.stats.get_mut(&20) {
            s.ppid = 1;
        }

        let pty2 = make_test_pty_snapshot(vec![]); // root removed from live fleet
        let discovery2 = ProcessDiscovery {
            source: src2.clone(),
            committed: discovery.committed.clone(),
        };

        let prep2 = discovery2.prepare_sample(&pty2, &agents, deadline).expect("prepare 2 should succeed with retained lineage");
        let sample2 = prep2.sample();

        // Codex is still recognized and monitored through its retained terminal evidence!
        assert_eq!(sample2.recognized_agent_count, 1);
        assert_eq!(sample2.monitored_terminal_count(), 1);
        assert_eq!(sample2.monitored_terminals[0].terminal, term);
        assert_eq!(sample2.monitored_terminals[0].sample_start_sequence, 10);

        // Pass 3: Codex (20) exits. Pass 3 revalidates and retires codex cleanly.
        let mut src3 = src2.clone();
        src3.pids.retain(|&p| p != 20);
        src3.stats.remove(&20);

        let discovery3 = ProcessDiscovery {
            source: src3,
            committed: prep2.next_state,
        };

        let prep3 = discovery3.prepare_sample(&pty2, &agents, deadline).expect("prepare 3 should succeed");
        assert_eq!(prep3.sample().recognized_agent_count, 0);
        assert_eq!(prep3.sample().monitored_terminal_count(), 0);
    }

    #[test]
    fn test_multi_root_ambiguity_fails() {
        let mut src = MockProcessSource::new();
        let term1 = TerminalIdentity { session_id: "term-1".to_string(), incarnation: 1 };
        let term2 = TerminalIdentity { session_id: "term-2".to_string(), incarnation: 1 };
        let root1 = ProcessIdentity { pid: 10, start_ticks: 1000 };
        let root2 = ProcessIdentity { pid: 20, start_ticks: 2000 };

        src.set_proc(10, 1, PathBuf::from("/bin/bash"), vec!["bash".to_string()], PathBuf::from("/home"), (1, 10), 1000);
        src.set_proc(20, 1, PathBuf::from("/bin/bash"), vec!["bash".to_string()], PathBuf::from("/home"), (1, 20), 2000);

        // Process 30 claimed under both root1 and root2 -> ambiguity
        src.set_proc(30, 10, PathBuf::from("/usr/bin/codex"), vec!["codex".to_string()], PathBuf::from("/home"), (1, 30), 3000);

        let discovery = ProcessDiscovery::with_source(src);
        let agents = AgentExecutableSet::from_strings(&["codex".to_string()]).unwrap();
        let pty = make_test_pty_snapshot(vec![
            (term1, root1, Arc::new(AtomicU64::new(0))),
            (term2, root2, Arc::new(AtomicU64::new(0))),
        ]);

        // If a process is directly child of root1, it's fine.
        // But what if another process has ppid pointing to both? Or if root2 somehow has same child:
        // In Linux ppid is unique, but if duplicate root PID with different terminal was given:
        let mut pty_conflict = pty.clone();
        pty_conflict.roots[1].qualification = RootQualification::Qualified { identity: root1 }; // duplicate PID 10 with different terminal!

        let deadline = Instant::now() + Duration::from_secs(1);
        let res = discovery.prepare_sample(&pty_conflict, &agents, deadline);
        assert!(matches!(res, Err(ActivityUnavailable { reason: ActivityUnavailableReason::IdentityUncertain, .. })));
    }

    #[test]
    fn test_namespace_mismatch_fails() {
        let mut src = MockProcessSource::new();
        let term = TerminalIdentity { session_id: "term-1".to_string(), incarnation: 1 };
        let root_id = ProcessIdentity { pid: 10, start_ticks: 1000 };

        src.set_proc(10, 1, PathBuf::from("/bin/bash"), vec!["bash".to_string()], PathBuf::from("/home"), (1, 10), 1000);
        src.set_proc(20, 10, PathBuf::from("/usr/bin/codex"), vec!["codex".to_string()], PathBuf::from("/home"), (1, 20), 2000);

        // Put codex in different network namespace
        src.netns.insert(20, NetworkNamespaceIdentity { device: 99, inode: 999 });

        let discovery = ProcessDiscovery::with_source(src);
        let agents = AgentExecutableSet::from_strings(&["codex".to_string()]).unwrap();
        let pty = make_test_pty_snapshot(vec![(term, root_id, Arc::new(AtomicU64::new(0)))]);

        let deadline = Instant::now() + Duration::from_secs(1);
        let res = discovery.prepare_sample(&pty, &agents, deadline);
        assert!(matches!(
            res,
            Err(ActivityUnavailable {
                reason: ActivityUnavailableReason::NamespaceMismatch,
                context,
                ..
            }) if context.processes.iter().any(|p| p.process.pid == 20)
        ));
    }

    #[test]
    fn test_identity_race_retryable() {
        let mut src = MockProcessSource::new();
        let term = TerminalIdentity { session_id: "term-1".to_string(), incarnation: 1 };
        let root_id = ProcessIdentity { pid: 10, start_ticks: 1000 };

        src.set_proc(10, 1, PathBuf::from("/bin/bash"), vec!["bash".to_string()], PathBuf::from("/home"), (1, 10), 1000);
        src.set_proc(20, 10, PathBuf::from("/usr/bin/codex"), vec!["codex".to_string()], PathBuf::from("/home"), (1, 20), 2000);

        // Start ticks for PID 20 changes on subsequent read (PID reuse)
        src.tick_shift_on_second_read.insert(20);

        let discovery = ProcessDiscovery::with_source(src);
        let agents = AgentExecutableSet::from_strings(&["codex".to_string()]).unwrap();
        let pty = make_test_pty_snapshot(vec![(term, root_id, Arc::new(AtomicU64::new(0)))]);

        let deadline = Instant::now() + Duration::from_secs(1);
        let res = discovery.prepare_sample(&pty, &agents, deadline);
        assert!(matches!(
            res,
            Err(ActivityUnavailable {
                reason: ActivityUnavailableReason::IdentityUncertain,
                retryable_close_race: true,
                ..
            })
        ));
    }

    #[test]
    fn test_deleted_executable_uncertain() {
        let mut src = MockProcessSource::new();
        let term = TerminalIdentity { session_id: "term-1".to_string(), incarnation: 1 };
        let root_id = ProcessIdentity { pid: 10, start_ticks: 1000 };

        src.set_proc(10, 1, PathBuf::from("/bin/bash"), vec!["bash".to_string()], PathBuf::from("/home"), (1, 10), 1000);
        src.set_proc(20, 10, PathBuf::from("/usr/bin/codex"), vec!["codex".to_string()], PathBuf::from("/home"), (1, 20), 2000);
        src.deleted_exes.insert(20);

        let discovery = ProcessDiscovery::with_source(src);
        let agents = AgentExecutableSet::from_strings(&["codex".to_string()]).unwrap();
        let pty = make_test_pty_snapshot(vec![(term, root_id, Arc::new(AtomicU64::new(0)))]);

        let deadline = Instant::now() + Duration::from_secs(1);
        let res = discovery.prepare_sample(&pty, &agents, deadline);
        assert!(matches!(res, Err(ActivityUnavailable { reason: ActivityUnavailableReason::IdentityUncertain, .. })));
    }

    #[test]
    fn test_counter_saturation_overflow() {
        let mut src = MockProcessSource::new();
        let term = TerminalIdentity { session_id: "term-1".to_string(), incarnation: 1 };
        let root_id = ProcessIdentity { pid: 10, start_ticks: 1000 };

        src.set_proc(10, 1, PathBuf::from("/bin/bash"), vec!["bash".to_string()], PathBuf::from("/home"), (1, 10), 1000);

        let discovery = ProcessDiscovery::with_source(src);
        let agents = AgentExecutableSet::from_strings(&["codex".to_string()]).unwrap();
        // Saturated counter u64::MAX
        let pty = make_test_pty_snapshot(vec![(term, root_id, Arc::new(AtomicU64::new(u64::MAX)))]);

        let deadline = Instant::now() + Duration::from_secs(1);
        let res = discovery.prepare_sample(&pty, &agents, deadline);
        assert!(matches!(res, Err(ActivityUnavailable { reason: ActivityUnavailableReason::CounterOverflow, .. })));
    }

    #[test]
    fn test_deadline_scan_timeout() {
        let mut src = MockProcessSource::new();
        let term = TerminalIdentity { session_id: "term-1".to_string(), incarnation: 1 };
        let root_id = ProcessIdentity { pid: 10, start_ticks: 1000 };
        src.set_proc(10, 1, PathBuf::from("/bin/bash"), vec!["bash".to_string()], PathBuf::from("/home"), (1, 10), 1000);

        let discovery = ProcessDiscovery::with_source(src);
        let agents = AgentExecutableSet::from_strings(&["codex".to_string()]).unwrap();
        let pty = make_test_pty_snapshot(vec![(term, root_id, Arc::new(AtomicU64::new(0)))]);

        // Deadline in the past
        let past_deadline = Instant::now() - Duration::from_millis(10);
        let res = discovery.prepare_sample(&pty, &agents, past_deadline);
        assert!(matches!(res, Err(ActivityUnavailable { reason: ActivityUnavailableReason::ScanTimeout, .. })));
    }

    #[test]
    fn test_exact_limits_qualify_and_overflow_fails() {
        let agents = AgentExecutableSet::from_strings(&["codex".to_string()]).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);

        // 1. Root limit: 256 qualifies, 257 fails
        let mut roots_256 = Vec::new();
        for i in 1..=256 {
            let term = TerminalIdentity { session_id: format!("term-{i}"), incarnation: 1 };
            let root_id = ProcessIdentity { pid: i as u32, start_ticks: 1000 + i as u64 };
            roots_256.push((term, root_id, Arc::new(AtomicU64::new(0))));
        }
        let pty_256 = make_test_pty_snapshot(roots_256.clone());

        let mut src_256 = MockProcessSource::new();
        for i in 1..=256 {
            src_256.set_proc(
                i as u32,
                0,
                PathBuf::from("/bin/bash"),
                vec!["bash".to_string()],
                PathBuf::from("/home"),
                (1, i as u64),
                1000 + i as u64,
            );
        }
        let disc_256 = ProcessDiscovery::with_source(src_256);
        let res_256 = disc_256.prepare_sample(&pty_256, &agents, deadline);
        assert!(res_256.is_ok(), "256 roots should qualify");

        // 257th root fails with ScanLimit
        let mut roots_257 = roots_256;
        let term_257 = TerminalIdentity { session_id: "term-257".to_string(), incarnation: 1 };
        let root_id_257 = ProcessIdentity { pid: 257, start_ticks: 1257 };
        roots_257.push((term_257, root_id_257, Arc::new(AtomicU64::new(0))));
        let pty_257 = make_test_pty_snapshot(roots_257);
        let res_257 = disc_256.prepare_sample(&pty_257, &agents, deadline);
        assert!(matches!(res_257, Err(ActivityUnavailable { reason: ActivityUnavailableReason::ScanLimit, .. })));

        // 2. Scanned processes limit: 8192 qualifies, 8193 fails
        let mut src_8192 = MockProcessSource::new();
        let term = TerminalIdentity { session_id: "term-1".to_string(), incarnation: 1 };
        let root_id = ProcessIdentity { pid: 1, start_ticks: 1000 };
        src_8192.set_proc(1, 0, PathBuf::from("/bin/bash"), vec!["bash".to_string()], PathBuf::from("/home"), (1, 1), 1000);
        for p in 2..=8192 {
            src_8192.set_proc(p, 0, PathBuf::from("/bin/other"), vec!["other".to_string()], PathBuf::from("/home"), (1, p as u64), 1000);
        }
        let pty_1 = make_test_pty_snapshot(vec![(term.clone(), root_id, Arc::new(AtomicU64::new(0)))]);
        let disc_8192 = ProcessDiscovery::with_source(src_8192.clone());
        let res_8192 = disc_8192.prepare_sample(&pty_1, &agents, deadline);
        assert!(res_8192.is_ok(), "8192 processes should qualify");

        // 8193 fails
        let mut src_8193 = src_8192;
        src_8193.set_proc(8193, 0, PathBuf::from("/bin/other"), vec!["other".to_string()], PathBuf::from("/home"), (1, 8193), 1000);
        let disc_8193 = ProcessDiscovery::with_source(src_8193);
        let res_8193 = disc_8193.prepare_sample(&pty_1, &agents, deadline);
        assert!(matches!(res_8193, Err(ActivityUnavailable { reason: ActivityUnavailableReason::ScanLimit, .. })));
    }

    #[test]
    fn test_early_interpreter_check_skips_cmdline() {
        let mut src = MockProcessSource::new();
        let pid = 50;
        // Non-interpreter tool (e.g. /bin/cat)
        src.set_proc(
            pid,
            1,
            PathBuf::from("/bin/cat"),
            vec!["cat".to_string(), "file.txt".to_string()],
            PathBuf::from("/home"),
            (1, 50),
            1000,
        );
        // Remove cmdline from mock source so that if read_cmdline were called, it would fail
        src.cmdlines.remove(&pid);

        let agents = AgentExecutableSet::from_strings(&["codex".to_string()]).unwrap();
        let outcome = match_candidate_process(&src, pid, &agents);
        // Must return NotMatched without attempting read_cmdline
        assert_eq!(outcome, AgentMatchOutcome::NotMatched);
    }

    #[test]
    fn test_lazy_cwd_read_skips_unneeded_cwd() {
        let mut src = MockProcessSource::new();
        let pid = 60;
        // Interpreted script: node ./runner.js
        src.set_proc(
            pid,
            1,
            PathBuf::from("/usr/bin/node"),
            vec!["node".to_string(), "./runner.js".to_string()],
            PathBuf::from("/home"),
            (1, 60),
            1000,
        );
        // Remove cwd from mock source so that if read_cwd were called, it would fail
        src.cwds.remove(&pid);

        // Basename rule matches runner.js without needing cwd resolution
        let agents = AgentExecutableSet::from_strings(&["runner.js".to_string()]).unwrap();
        let outcome = match_candidate_process(&src, pid, &agents);
        assert!(matches!(outcome, AgentMatchOutcome::Matched { .. }));
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn test_harmless_real_process_tree_on_linux() {
        use std::process::Command;

        // Spawn a harmless fixture child process: `sh -c 'sleep 5'`
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("sleep 5")
            .spawn()
            .expect("should spawn fixture child");

        let pid = child.id();
        let proc_source = LinuxProcSource::new();

        // Verify LinuxProcSource reads real stat and start ticks > 0
        let stat = proc_source.read_stat(pid).expect("read_stat on real child should succeed");
        assert_eq!(stat.pid, pid);
        assert!(stat.start_ticks > 0);

        // Verify netns
        let netns = proc_source.read_netns(pid).expect("read_netns on real child should succeed");
        let thread_netns = proc_source.read_thread_netns().expect("read_thread_netns should succeed");
        assert_eq!(netns, thread_netns);

        // Clean up: terminate and reap fixture child
        let _ = child.kill();
        let _ = child.wait();
    }
}
