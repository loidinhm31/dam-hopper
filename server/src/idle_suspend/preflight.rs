use std::path::{Path, PathBuf};

/// Structured representation of an active system sleep inhibitor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveInhibitor {
    pub who: String,
    pub why: String,
    pub mode: String,
}

impl ActiveInhibitor {
    pub fn new(who: impl Into<String>, why: impl Into<String>, mode: impl Into<String>) -> Self {
        Self {
            who: who.into(),
            why: why.into(),
            mode: mode.into(),
        }
    }

    pub fn format_description(&self) -> String {
        format!("{} ({}) [mode={}]", self.who, self.why, self.mode)
    }
}

/// Errors surfaced during preflight host capability checks.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PreflightError {
    #[error("Host does not support required suspend state: {0}")]
    UnsupportedSuspend(String),
    #[error("Host lacks required RTC wakealarm device: {0}")]
    UnsupportedRtc(String),
    #[error("Sleep is blocked by active inhibitor: {0}")]
    Inhibited(String, Option<String>, Option<String>),
    #[error("RTC wakealarm is already in use: {0}")]
    RtcAlarmBusy(String),
    #[error("Preflight probe error: {0}")]
    ProbeError(String),
}

/// Trait abstracting discovery of active sleep inhibitors on the host.
pub trait InhibitorProvider: Send + Sync {
    /// Retrieve active inhibitors that apply to sleep or suspend.
    fn check_sleep_inhibitor(&self) -> Result<Option<ActiveInhibitor>, String>;
}

/// Provider that runs `systemd-inhibit --list --no-legend` on Linux systemd hosts.
#[derive(Debug, Default)]
pub struct SystemdInhibitCliProvider;

impl InhibitorProvider for SystemdInhibitCliProvider {
    fn check_sleep_inhibitor(&self) -> Result<Option<ActiveInhibitor>, String> {
        let output = std::process::Command::new("systemd-inhibit")
            .args(["--list", "--no-legend"])
            .output();

        let output = match output {
            Ok(o) => o,
            Err(e) => {
                // If systemd-inhibit command is not found or not executable, report probe error
                return Err(format!("Failed to execute systemd-inhibit: {e}"));
            }
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("systemd-inhibit failed: {}", stderr.trim()));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        // Each row format: WHO UID PID WHAT WHY MODE
        // Example:
        // root 0 1234 sleep in-flight backup block
        for line in stdout.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            // Expected columns: WHO, UID, PID, WHAT, WHY..., MODE
            if parts.len() >= 5 {
                // Find if any column contains "sleep" in WHAT
                // Often systemd-inhibit columns are: WHO, UID, PID, WHAT, WHY (may be multiple words), MODE
                // Or: WHAT, WHO, WHY, MODE, UID, PID depending on systemd version
                let line_lower = line.to_lowercase();
                if line_lower.contains("sleep") {
                    let who = parts[0].to_string();
                    let mode = parts.last().unwrap_or(&"block").to_string();
                    let why = if parts.len() > 4 {
                        parts[3..parts.len() - 1].join(" ")
                    } else {
                        "system sleep inhibited".to_string()
                    };
                    return Ok(Some(ActiveInhibitor::new(who, why, mode)));
                }
            }
        }

        Ok(None)
    }
}

/// Fake inhibitor provider for deterministic testing.
#[derive(Debug, Clone, Default)]
pub struct FakeInhibitorProvider {
    pub inhibitor: Option<ActiveInhibitor>,
    pub error: Option<String>,
}

impl InhibitorProvider for FakeInhibitorProvider {
    fn check_sleep_inhibitor(&self) -> Result<Option<ActiveInhibitor>, String> {
        if let Some(err) = &self.error {
            return Err(err.clone());
        }
        Ok(self.inhibitor.clone())
    }
}

/// Trait defining the preflight checks required before attempting host suspend.
pub trait PreflightChecker: Send + Sync {
    /// Check whether Linux suspend state (mem/freeze) is supported.
    fn check_suspend_state(&self) -> Result<(), PreflightError>;
    /// Check whether RTC wakealarm device exists and is usable.
    fn check_rtc_wakealarm(&self) -> Result<(), PreflightError>;
    /// Check whether active sleep inhibitors prevent suspend.
    fn check_sleep_inhibitors(&self) -> Result<(), PreflightError>;

    /// Run all preflight checks and report the first failure or inhibitor.
    fn run_all(&self) -> Result<(), PreflightError> {
        self.check_suspend_state()?;
        self.check_rtc_wakealarm()?;
        self.check_sleep_inhibitors()?;
        Ok(())
    }
}

/// Production preflight checker that examines real sysfs nodes and systemd inhibitors.
pub struct SysfsPreflightChecker {
    pub power_state_path: PathBuf,
    pub rtc_wakealarm_path: PathBuf,
    pub expected_mode: String,
    pub inhibitor_provider: Box<dyn InhibitorProvider>,
}

impl SysfsPreflightChecker {
    pub fn new() -> Self {
        Self {
            power_state_path: PathBuf::from("/sys/power/state"),
            rtc_wakealarm_path: PathBuf::from("/sys/class/rtc/rtc0/wakealarm"),
            expected_mode: "mem".to_string(),
            inhibitor_provider: Box::new(SystemdInhibitCliProvider),
        }
    }

    pub fn with_paths(
        power_state: impl AsRef<Path>,
        rtc_wakealarm: impl AsRef<Path>,
        expected_mode: impl Into<String>,
        inhibitor_provider: Box<dyn InhibitorProvider>,
    ) -> Self {
        Self {
            power_state_path: power_state.as_ref().to_path_buf(),
            rtc_wakealarm_path: rtc_wakealarm.as_ref().to_path_buf(),
            expected_mode: expected_mode.into(),
            inhibitor_provider,
        }
    }
}

impl Default for SysfsPreflightChecker {
    fn default() -> Self {
        Self::new()
    }
}

impl PreflightChecker for SysfsPreflightChecker {
    fn check_suspend_state(&self) -> Result<(), PreflightError> {
        if !self.power_state_path.exists() {
            return Err(PreflightError::UnsupportedSuspend(format!(
                "Power state file not found at {}",
                self.power_state_path.display()
            )));
        }
        let content = std::fs::read_to_string(&self.power_state_path).map_err(|e| {
            PreflightError::ProbeError(format!(
                "Failed to read {}: {}",
                self.power_state_path.display(),
                e
            ))
        })?;
        let supported_modes: Vec<&str> = content.split_whitespace().collect();
        if !supported_modes.contains(&self.expected_mode.as_str()) {
            return Err(PreflightError::UnsupportedSuspend(format!(
                "Configured mode '{}' not in available modes: {:?}",
                self.expected_mode, supported_modes
            )));
        }
        Ok(())
    }

    fn check_rtc_wakealarm(&self) -> Result<(), PreflightError> {
        if !self.rtc_wakealarm_path.exists() {
            return Err(PreflightError::UnsupportedRtc(format!(
                "RTC wakealarm device not found at {}",
                self.rtc_wakealarm_path.display()
            )));
        }
        let content = std::fs::read_to_string(&self.rtc_wakealarm_path).map_err(|e| {
            PreflightError::ProbeError(format!(
                "Failed to read RTC wakealarm at {}: {}",
                self.rtc_wakealarm_path.display(),
                e
            ))
        })?;
        let trimmed = content.trim();
        if !trimmed.is_empty() && trimmed != "0" {
            return Err(PreflightError::RtcAlarmBusy(format!(
                "Non-empty RTC wakealarm detected at {} ('{}')",
                self.rtc_wakealarm_path.display(),
                trimmed
            )));
        }
        Ok(())
    }

    fn check_sleep_inhibitors(&self) -> Result<(), PreflightError> {
        match self.inhibitor_provider.check_sleep_inhibitor() {
            Ok(Some(inhibitor)) => Err(PreflightError::Inhibited(
                inhibitor.format_description(),
                Some(inhibitor.who),
                Some(inhibitor.why),
            )),
            Ok(None) => Ok(()),
            Err(e) => Err(PreflightError::ProbeError(e)),
        }
    }
}

/// Fake preflight checker for deterministic unit/integration testing.
#[derive(Debug, Clone)]
pub struct FakePreflightChecker {
    pub suspend_ok: bool,
    pub rtc_ok: bool,
    pub rtc_busy: Option<String>,
    pub active_inhibitor: Option<ActiveInhibitor>,
    pub probe_error: Option<String>,
}

impl FakePreflightChecker {
    pub fn new_passing() -> Self {
        Self {
            suspend_ok: true,
            rtc_ok: true,
            rtc_busy: None,
            active_inhibitor: None,
            probe_error: None,
        }
    }
}

impl Default for FakePreflightChecker {
    fn default() -> Self {
        Self::new_passing()
    }
}

impl PreflightChecker for FakePreflightChecker {
    fn check_suspend_state(&self) -> Result<(), PreflightError> {
        if let Some(err) = &self.probe_error {
            return Err(PreflightError::ProbeError(err.clone()));
        }
        if !self.suspend_ok {
            return Err(PreflightError::UnsupportedSuspend(
                "Simulated lack of suspend mode".to_string(),
            ));
        }
        Ok(())
    }

    fn check_rtc_wakealarm(&self) -> Result<(), PreflightError> {
        if let Some(err) = &self.probe_error {
            return Err(PreflightError::ProbeError(err.clone()));
        }
        if !self.rtc_ok {
            return Err(PreflightError::UnsupportedRtc(
                "Simulated lack of RTC alarm".to_string(),
            ));
        }
        if let Some(busy) = &self.rtc_busy {
            return Err(PreflightError::RtcAlarmBusy(busy.clone()));
        }
        Ok(())
    }

    fn check_sleep_inhibitors(&self) -> Result<(), PreflightError> {
        if let Some(err) = &self.probe_error {
            return Err(PreflightError::ProbeError(err.clone()));
        }
        if let Some(inh) = &self.active_inhibitor {
            return Err(PreflightError::Inhibited(
                inh.format_description(),
                Some(inh.who.clone()),
                Some(inh.why.clone()),
            ));
        }
        Ok(())
    }
}
