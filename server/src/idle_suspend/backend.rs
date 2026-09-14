use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
/// Trait defining execution of the fixed RTC-wake programming and host suspend.
pub trait SuspendActionBackend: Send + Sync {
    /// Program the hardware RTC wakealarm for `wake_after_seconds` into the future,
    /// or clear any existing alarm if `wake_after_seconds` is `None` (indefinite sleep).
    fn program_rtc_wake(&self, wake_after_seconds: Option<u64>) -> Result<(), String>;
    /// Trigger host suspend via systemd logind, blocking until host resumes. Returns elapsed seconds.
    fn trigger_suspend(&self) -> Result<u64, String>;
}

/// Production execution backend using direct sysfs RTC wakealarm write + systemctl suspend.
pub struct SystemdLogindBackend {
    pub rtc_wakealarm_path: PathBuf,
    pub systemctl_path: PathBuf,
}

impl SystemdLogindBackend {
    pub fn new() -> Self {
        Self {
            rtc_wakealarm_path: PathBuf::from("/sys/class/rtc/rtc0/wakealarm"),
            systemctl_path: Self::resolve_systemctl_path(),
        }
    }

    pub fn with_paths(rtc_wakealarm: impl AsRef<Path>, systemctl: impl AsRef<Path>) -> Self {
        Self {
            rtc_wakealarm_path: rtc_wakealarm.as_ref().to_path_buf(),
            systemctl_path: systemctl.as_ref().to_path_buf(),
        }
    }

    fn resolve_systemctl_path() -> PathBuf {
        let candidates = ["/usr/bin/systemctl", "/bin/systemctl"];
        for c in candidates {
            let p = Path::new(c);
            if p.exists() {
                return p.to_path_buf();
            }
        }
        PathBuf::from("/usr/bin/systemctl")
    }

    /// Read current RTC hardware clock epoch.
    ///
    /// The Linux kernel sysfs RTC device exposes `since_epoch` (e.g. `/sys/class/rtc/rtc0/since_epoch`)
    /// which reflects the RTC device's hardware timebase. When the host RTC is configured in local
    /// timezone (`timedatectl` showing "RTC in local TZ: yes"), RTC epoch differs from system UTC
    /// epoch by the timezone offset. Programming `wakealarm` requires timestamps in the RTC device's
    /// timebase; otherwise the kernel rejects alarms that appear in the past relative to the RTC.
    ///
    /// If `since_epoch` is absent (e.g. in test fixtures), falls back to system wall clock.
    pub fn read_rtc_now_epoch(&self) -> Result<u64, String> {
        if let Some(parent) = self.rtc_wakealarm_path.parent() {
            let since_epoch_path = parent.join("since_epoch");
            if since_epoch_path.exists() {
                let content = std::fs::read_to_string(&since_epoch_path).map_err(|e| {
                    format!(
                        "Failed reading RTC since_epoch from {}: {}",
                        since_epoch_path.display(),
                        e
                    )
                })?;
                let trimmed = content.trim();
                return trimmed.parse::<u64>().map_err(|e| {
                    format!(
                        "Failed parsing RTC since_epoch '{}' from {}: {}",
                        trimmed,
                        since_epoch_path.display(),
                        e
                    )
                });
            }
        }

        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .map_err(|e| format!("System clock error: {e}"))
    }
}

impl Default for SystemdLogindBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl SuspendActionBackend for SystemdLogindBackend {
    fn program_rtc_wake(&self, wake_after_seconds: Option<u64>) -> Result<(), String> {
        // 1. Clear any prior alarm by writing 0\n and strictly verify the write
        std::fs::write(&self.rtc_wakealarm_path, "0\n").map_err(|e| {
            format!(
                "Failed clearing RTC wakealarm at {}: {}",
                self.rtc_wakealarm_path.display(),
                e
            )
        })?;

        // 2. Read back to verify clear operation
        let cleared_content = std::fs::read_to_string(&self.rtc_wakealarm_path).map_err(|e| {
            format!(
                "Failed reading back cleared RTC wakealarm from {}: {}",
                self.rtc_wakealarm_path.display(),
                e
            )
        })?;
        let trimmed_clear = cleared_content.trim();
        if !trimmed_clear.is_empty() && trimmed_clear != "0" {
            return Err(format!(
                "RTC wakealarm clear verification failed at {}: readback was '{}'",
                self.rtc_wakealarm_path.display(),
                trimmed_clear
            ));
        }

        // 3. For timed mode (Some), calculate target epoch, write, and verify readback
        if let Some(seconds) = wake_after_seconds {
            let now_epoch = self.read_rtc_now_epoch()?;

            let target_epoch = now_epoch
                .checked_add(seconds)
                .ok_or_else(|| "Target wake epoch timestamp overflowed".to_string())?;

            let target_str = format!("{}\n", target_epoch);
            std::fs::write(&self.rtc_wakealarm_path, &target_str).map_err(|e| {
                format!(
                    "Failed writing target alarm {} to {}: {}",
                    target_epoch,
                    self.rtc_wakealarm_path.display(),
                    e
                )
            })?;

            let readback_content = std::fs::read_to_string(&self.rtc_wakealarm_path).map_err(|e| {
                format!(
                    "Failed reading back programmed RTC wakealarm from {}: {}",
                    self.rtc_wakealarm_path.display(),
                    e
                )
            })?;
            let readback_trimmed = readback_content.trim();
            let readback_epoch = readback_trimmed.parse::<u64>().map_err(|e| {
                format!(
                    "Failed parsing readback RTC wakealarm '{}' from {}: {}",
                    readback_trimmed,
                    self.rtc_wakealarm_path.display(),
                    e
                )
            })?;
            if readback_epoch != target_epoch {
                return Err(format!(
                    "RTC wakealarm readback mismatch at {}: expected {}, got {}",
                    self.rtc_wakealarm_path.display(),
                    target_epoch,
                    readback_epoch
                ));
            }
        }

        Ok(())
    }

    fn trigger_suspend(&self) -> Result<u64, String> {
        let start = Instant::now();

        let output = std::process::Command::new(&self.systemctl_path)
            .arg("suspend")
            .output()
            .map_err(|e| {
                format!(
                    "Failed to spawn {} suspend: {}",
                    self.systemctl_path.display(),
                    e
                )
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!(
                "systemctl suspend failed with status {}: {}",
                output.status,
                stderr.trim()
            ));
        }

        let elapsed = start.elapsed().as_secs();
        Ok(elapsed)
    }
}

/// Fake action backend for deterministic unit/integration testing.
#[derive(Debug, Default)]
pub struct FakeActionBackend {
    pub programmed_wake: Mutex<Option<Option<u64>>>,
    pub suspend_called: Mutex<bool>,
    pub fail_rtc: Mutex<Option<String>>,
    pub fail_suspend: Mutex<Option<String>>,
    pub simulated_elapsed_seconds: Mutex<u64>,
}

impl FakeActionBackend {
    pub fn new() -> Self {
        Self {
            programmed_wake: Mutex::new(None),
            suspend_called: Mutex::new(false),
            fail_rtc: Mutex::new(None),
            fail_suspend: Mutex::new(None),
            simulated_elapsed_seconds: Mutex::new(600),
        }
    }

    pub fn with_elapsed(elapsed: u64) -> Self {
        let s = Self::new();
        *s.simulated_elapsed_seconds.lock().unwrap() = elapsed;
        s
    }

    pub fn set_fail_rtc(&self, err: Option<String>) {
        *self.fail_rtc.lock().unwrap() = err;
    }

    pub fn set_fail_suspend(&self, err: Option<String>) {
        *self.fail_suspend.lock().unwrap() = err;
    }

    pub fn is_not_called(&self) -> bool {
        self.programmed_wake.lock().unwrap().is_none()
    }

    pub fn is_clear_only(&self) -> bool {
        matches!(*self.programmed_wake.lock().unwrap(), Some(None))
    }

    pub fn timed_wake_seconds(&self) -> Option<u64> {
        match *self.programmed_wake.lock().unwrap() {
            Some(Some(secs)) => Some(secs),
            _ => None,
        }
    }
}

impl SuspendActionBackend for FakeActionBackend {
    fn program_rtc_wake(&self, wake_after_seconds: Option<u64>) -> Result<(), String> {
        if let Some(err) = self.fail_rtc.lock().unwrap().as_ref() {
            return Err(err.clone());
        }
        *self.programmed_wake.lock().unwrap() = Some(wake_after_seconds);
        Ok(())
    }

    fn trigger_suspend(&self) -> Result<u64, String> {
        if let Some(err) = self.fail_suspend.lock().unwrap().as_ref() {
            return Err(err.clone());
        }
        *self.suspend_called.lock().unwrap() = true;
        let elapsed = *self.simulated_elapsed_seconds.lock().unwrap();
        Ok(elapsed)
    }
}
