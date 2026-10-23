use super::resources::V8_MAX_OLD_SPACE_MB;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use thiserror::Error;
use tokio::process::Command;

#[derive(Debug, Error)]
pub enum LaunchError {
    #[error("Executable path must be absolute: {0}")]
    NonAbsoluteExecutable(PathBuf),

    #[error("Executable not found or not a file: {0}")]
    ExecutableNotFound(PathBuf),

    #[error("Entrypoint script must be absolute: {0}")]
    NonAbsoluteEntrypoint(PathBuf),

    #[error("Entrypoint script not found: {0}")]
    EntrypointNotFound(PathBuf),

    #[error("Working directory does not exist: {0}")]
    InvalidCwd(PathBuf),
}

/// Immutable bundled launch specification for TSLS / semantic child processes.
/// Strict invariants:
/// - Absolute executable path only, direct spawn without shell or PATH lookup.
/// - Sanitized environment with stripped loader/Node options.
/// - Process group isolation (POSIX setpgid).
#[doc(hidden)]
#[derive(Clone, Debug)]
pub struct BundledLaunchSpec {
    pub executable: PathBuf,
    pub entrypoint: PathBuf,
    pub extra_args: Vec<String>,
    pub cwd: PathBuf,
    pub home_dir: PathBuf,
    pub tsserver_path: Option<PathBuf>,
    pub v8_max_old_space_mb: usize,
    pub cgroup_procs_path: Option<PathBuf>,
}

impl BundledLaunchSpec {
    #[doc(hidden)]
    pub fn new(
        executable: impl AsRef<Path>,
        entrypoint: impl AsRef<Path>,
        cwd: impl AsRef<Path>,
        home_dir: impl AsRef<Path>,
    ) -> Result<Self, LaunchError> {
        let exe = executable.as_ref().to_path_buf();
        if !exe.is_absolute() {
            return Err(LaunchError::NonAbsoluteExecutable(exe));
        }
        if !exe.is_file() {
            return Err(LaunchError::ExecutableNotFound(exe));
        }

        let entry = entrypoint.as_ref().to_path_buf();
        if !entry.is_absolute() {
            return Err(LaunchError::NonAbsoluteEntrypoint(entry));
        }
        if !entry.is_file() {
            return Err(LaunchError::EntrypointNotFound(entry));
        }

        let cwd_buf = cwd.as_ref().to_path_buf();
        if !cwd_buf.is_dir() {
            return Err(LaunchError::InvalidCwd(cwd_buf));
        }

        Ok(Self {
            executable: exe,
            entrypoint: entry,
            extra_args: vec!["--stdio".to_string()],
            cwd: cwd_buf,
            home_dir: home_dir.as_ref().to_path_buf(),
            tsserver_path: None,
            v8_max_old_space_mb: V8_MAX_OLD_SPACE_MB,
            cgroup_procs_path: None,
        })
    }

    #[doc(hidden)]
    pub fn with_tsserver_path(mut self, path: impl AsRef<Path>) -> Self {
        self.tsserver_path = Some(path.as_ref().to_path_buf());
        self
    }

    #[doc(hidden)]
    pub fn with_extra_args(mut self, args: Vec<String>) -> Self {
        self.extra_args = args;
        self
    }

    #[doc(hidden)]
    pub fn with_cgroup_procs_path(mut self, path: impl AsRef<Path>) -> Self {
        self.cgroup_procs_path = Some(path.as_ref().to_path_buf());
        self
    }

    /// Constructs the configured `tokio::process::Command` ready for spawning.
    #[doc(hidden)]
    pub fn build_command(&self) -> Command {
        let mut cmd = Command::new(&self.executable);

        // Fixed arguments: heap cap first, then entrypoint script
        cmd.arg(format!("--max-old-space-size={}", self.v8_max_old_space_mb));
        cmd.arg(&self.entrypoint);

        for arg in &self.extra_args {
            cmd.arg(arg);
        }

        if let Some(tsserver) = &self.tsserver_path {
            cmd.arg(format!("--tsserver-path={}", tsserver.display()));
        }
        cmd.current_dir(&self.cwd);

        // Sanitize environment: clear all inherited variables
        cmd.env_clear();

        // Minimal allowlisted environment
        cmd.env("PATH", "/usr/bin:/bin");
        cmd.env("HOME", &self.home_dir);
        cmd.env("NODE_ENV", "production");

        // Stdio piping
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Process group isolation on Unix
        #[cfg(unix)]
        cmd.process_group(0);

        // Pre-exec attachment to dedicated child cgroup if configured
        #[cfg(unix)]
        if let Some(cgroup_procs) = &self.cgroup_procs_path {
            let procs_file = cgroup_procs.clone();
            unsafe {
                cmd.pre_exec(move || {
                    let pid = libc::getpid();
                    let mut f = std::fs::OpenOptions::new().write(true).open(&procs_file)?;
                    use std::io::Write;
                    f.write_all(format!("{pid}\n").as_bytes())?;
                    Ok(())
                });
            }
        }

        // Emergency fallback guard
        cmd.kill_on_drop(true);

        cmd
    }
}
