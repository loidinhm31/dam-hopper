//! Release service status inspection and reporting.

use super::constants::{
    API_SERVICE_UNIT, HELPER_SERVICE_UNIT, RECOVERY_SERVICE_UNIT, RUNNER_SERVICE_UNIT,
    WEB_SERVICE_UNIT,
};
use super::process::inspect_service_process;
use super::systemd::systemctl_is_active;
use serde::{Deserialize, Serialize};

/// Status and process evidence for a managed systemd service unit.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub unit_name: String,
    pub role: String,
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<u32>,
}

/// Inspect the status and main process of a single systemd unit.
pub fn inspect_unit_status(unit_name: &str, role: &str) -> ServiceStatus {
    let active = systemctl_is_active(unit_name).unwrap_or(false);
    let process = inspect_service_process(unit_name).ok().flatten();
    let pid = process.as_ref().map(|p| p.pid);
    let uid = process.as_ref().map(|p| p.uid);

    ServiceStatus {
        unit_name: unit_name.to_string(),
        role: role.to_string(),
        active,
        pid,
        uid,
    }
}

/// Collect status information for all managed release services.
pub fn collect_all_services_status() -> Vec<ServiceStatus> {
    vec![
        inspect_unit_status(API_SERVICE_UNIT, "server"),
        inspect_unit_status(HELPER_SERVICE_UNIT, "server"),
        inspect_unit_status(RUNNER_SERVICE_UNIT, "server"),
        inspect_unit_status(WEB_SERVICE_UNIT, "web"),
        inspect_unit_status(RECOVERY_SERVICE_UNIT, "recovery"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_collect_all_services_status_structure() {
        let statuses = collect_all_services_status();
        assert_eq!(statuses.len(), 5);
        assert!(statuses
            .iter()
            .any(|s| s.unit_name == API_SERVICE_UNIT && s.role == "server"));
        assert!(statuses
            .iter()
            .any(|s| s.unit_name == HELPER_SERVICE_UNIT && s.role == "server"));
        assert!(statuses
            .iter()
            .any(|s| s.unit_name == RUNNER_SERVICE_UNIT && s.role == "server"));
        assert!(statuses
            .iter()
            .any(|s| s.unit_name == WEB_SERVICE_UNIT && s.role == "web"));
        assert!(statuses
            .iter()
            .any(|s| s.unit_name == RECOVERY_SERVICE_UNIT && s.role == "recovery"));
    }
}
