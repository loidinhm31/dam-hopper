use std::path::{Path, PathBuf};

use crate::config::{
    IdleSuspendCapabilitySelection, IdleSuspendConfig, MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
    MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS, MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
    MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
};

/// Immutable policy captured at server startup.
///
/// Ensures workspace switches, reloads, or full-config updates cannot enable,
/// disable, or re-enroll the idle-suspend capability on a running server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartupIdleSuspendPolicy {
    /// Whether idle suspend was enabled at server startup.
    pub enabled: bool,
    /// Canonical filesystem path to the startup registry configuration file.
    pub canonical_registry_path: PathBuf,
    /// Helper enrollment identifier captured at startup.
    pub enrollment_reference: Option<String>,
    /// Capability selection captured at startup.
    pub capability_selection: IdleSuspendCapabilitySelection,
}

impl StartupIdleSuspendPolicy {
    pub fn from_config(config_path: &Path, config: &IdleSuspendConfig) -> Self {
        let canonical_path = config_path
            .canonicalize()
            .unwrap_or_else(|_| config_path.to_path_buf());
        Self {
            enabled: config.enabled,
            canonical_registry_path: canonical_path,
            enrollment_reference: config.enrollment_reference.clone(),
            capability_selection: config.capability_selection,
        }
    }

    /// Whether idle suspend policy is enabled at startup.
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }
}

/// Mutable runtime timing configuration with status revision tracking.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuntimeIdleSuspendTiming {
    pub quiet_period_seconds: u64,
    pub wake_after_seconds: u64,
    pub status_revision: u64,
}

impl RuntimeIdleSuspendTiming {
    pub fn new(quiet_period_seconds: u64, wake_after_seconds: u64) -> Result<Self, String> {
        validate_timing_pair(quiet_period_seconds, wake_after_seconds)?;
        Ok(Self {
            quiet_period_seconds,
            wake_after_seconds,
            status_revision: 1,
        })
    }

    pub fn from_config(config: &IdleSuspendConfig) -> Result<Self, String> {
        Self::new(config.quiet_period_seconds, config.wake_after_seconds)
    }

    pub fn apply_update(&mut self, quiet_period_seconds: u64, wake_after_seconds: u64) -> Result<bool, String> {
        validate_timing_pair(quiet_period_seconds, wake_after_seconds)?;
        if self.quiet_period_seconds == quiet_period_seconds
            && self.wake_after_seconds == wake_after_seconds
        {
            return Ok(false);
        }
        self.quiet_period_seconds = quiet_period_seconds;
        self.wake_after_seconds = wake_after_seconds;
        self.status_revision = self.status_revision.saturating_add(1);
        Ok(true)
    }
}

/// Validate that quiet_period_seconds and wake_after_seconds fall within approved bounds.
pub fn validate_timing_pair(
    quiet_period_seconds: u64,
    wake_after_seconds: u64,
) -> Result<(), String> {
    if !(MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS..=MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS)
        .contains(&quiet_period_seconds)
    {
        return Err(format!(
            "quietPeriodSeconds must be between {} and {}",
            MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS
        ));
    }
    if !(MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS..=MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS)
        .contains(&wake_after_seconds)
    {
        return Err(format!(
            "wakeAfterSeconds must be between {} and {}",
            MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS, MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS
        ));
    }
    Ok(())
}
