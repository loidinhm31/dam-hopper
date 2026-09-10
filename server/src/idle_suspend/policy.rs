use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::config::{
    default_idle_suspend_agent_executables, validate_agent_executables,
    IdleSuspendAutomaticPolicy, IdleSuspendCapabilitySelection, IdleSuspendConfig,
    MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
    MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentExecutableEntry {
    Basename(String),
    AbsolutePath(PathBuf),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentExecutableSet {
    raw: Vec<String>,
    entries: Vec<AgentExecutableEntry>,
}

impl Default for AgentExecutableSet {
    fn default() -> Self {
        Self::from_strings(&default_idle_suspend_agent_executables())
            .expect("default agent executables must be valid")
    }
}

impl AgentExecutableSet {
    pub fn from_strings(strings: &[String]) -> Result<Self, String> {
        validate_agent_executables(strings)?;
        let entries = strings
            .iter()
            .map(|s| {
                if s.starts_with('/') {
                    AgentExecutableEntry::AbsolutePath(PathBuf::from(s))
                } else {
                    AgentExecutableEntry::Basename(s.clone())
                }
            })
            .collect();
        Ok(Self {
            raw: strings.to_vec(),
            entries,
        })
    }

    pub fn raw(&self) -> &[String] {
        &self.raw
    }

    pub fn entries(&self) -> &[AgentExecutableEntry] {
        &self.entries
    }

    pub fn iter(&self) -> std::slice::Iter<'_, AgentExecutableEntry> {
        self.entries.iter()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }
}

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
    /// Automatic suspend policy captured at startup.
    pub automatic_policy: IdleSuspendAutomaticPolicy,
    /// Compiled agent executables matcher set captured at startup.
    pub agent_executables: Arc<AgentExecutableSet>,
}

impl StartupIdleSuspendPolicy {
    pub fn from_config(config_path: &Path, config: &IdleSuspendConfig) -> Self {
        let canonical_path = config_path
            .canonicalize()
            .unwrap_or_else(|_| config_path.to_path_buf());
        let agent_executables = match AgentExecutableSet::from_strings(&config.agent_executables) {
            Ok(set) => set,
            Err(err) => {
                tracing::warn!(
                    "Invalid agent_executables in idle_suspend config: {err}; falling back to default agent set"
                );
                AgentExecutableSet::default()
            }
        };
        Self {
            enabled: config.enabled,
            canonical_registry_path: canonical_path,
            enrollment_reference: config.enrollment_reference.clone(),
            capability_selection: config.capability_selection,
            automatic_policy: config.automatic_policy,
            agent_executables: Arc::new(agent_executables),
        }
    }

    /// Overlay the immutable startup policy and mutable runtime timing onto a configuration.
    pub fn apply_to_config(
        &self,
        config: &mut crate::config::DamHopperConfig,
        timing: &RuntimeIdleSuspendTiming,
    ) {
        config.server.idle_suspend.enabled = self.enabled;
        config.server.idle_suspend.enrollment_reference = self.enrollment_reference.clone();
        config.server.idle_suspend.capability_selection = self.capability_selection;
        config.server.idle_suspend.automatic_policy = self.automatic_policy;
        config.server.idle_suspend.agent_executables = self.agent_executables.raw().to_vec();
        config.server.idle_suspend.quiet_period_seconds = timing.quiet_period_seconds;
        config.server.idle_suspend.wake_after_seconds = timing.wake_after_seconds;
    }

    /// The automatic idle-suspend policy selected at startup.
    pub fn automatic_policy(&self) -> IdleSuspendAutomaticPolicy {
        self.automatic_policy
    }

    /// Whether agent-activity automatic suspend policy is active.
    pub fn is_agent_activity_policy(&self) -> bool {
        self.automatic_policy == IdleSuspendAutomaticPolicy::AgentActivity
    }

    /// Borrow the compiled agent executables matcher set.
    pub fn agent_executables(&self) -> &AgentExecutableSet {
        &self.agent_executables
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
