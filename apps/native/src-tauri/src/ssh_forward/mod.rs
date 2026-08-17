//! Phase 01 desktop-only seam for the SSH forwarding ACL and window boundary.
//!
//! Forwarding commands are intentionally added in a later phase after the
//! dependency and native storage gates pass. Keeping this seam separate lets
//! those commands reuse one label check without granting browser or mobile
//! callers a fallback implementation.

#[cfg(windows)]
#[allow(dead_code)]
mod credential_lease;
#[cfg(windows)]
#[allow(dead_code)]
mod credential_vault;
#[cfg(windows)]
#[allow(dead_code)]
pub(crate) mod credentials;
#[allow(dead_code)]
pub(crate) mod error;
#[allow(dead_code)]
pub(crate) mod instance;
#[cfg(windows)]
#[allow(dead_code)]
pub(crate) mod known_hosts;
#[allow(dead_code)]
pub(crate) mod model;
#[allow(dead_code)]
pub(crate) mod profile;
#[allow(dead_code)]
pub(crate) mod scope_retention;
#[cfg(windows)]
#[allow(dead_code)]
pub(crate) mod ssh_client;
#[cfg(windows)]
#[allow(dead_code)]
pub(crate) mod trust_repair;

#[cfg(windows)]
pub(crate) mod commands;
#[cfg(windows)]
pub(crate) mod connection_runtime;
#[cfg(windows)]
pub(crate) mod manager;
#[cfg(windows)]
#[allow(dead_code)]
pub(crate) mod store;

#[cfg(windows)]
#[allow(dead_code)]
mod store_schema;

#[cfg(windows)]
#[allow(dead_code)]
mod windows_storage_probe;

#[cfg(test)]
const PERMISSION_MANIFEST: &str = include_str!("../../permissions/ssh-forward.toml");
#[cfg(test)]
const CAPABILITY_MANIFEST: &str = include_str!("../../capabilities/ssh-forward.json");

/// Reject every webview except the main desktop application window.
pub(crate) fn ensure_main_window(label: &str) -> Result<(), &'static str> {
    if label == "main" {
        Ok(())
    } else {
        Err("ssh_forward_main_window_required")
    }
}

#[cfg(test)]
mod tests {
    use super::{ensure_main_window, CAPABILITY_MANIFEST, PERMISSION_MANIFEST};

    const COMMANDS: &[&str] = include!("command_names.in.rs");

    fn permission_commands(manifest: &str) -> Vec<&str> {
        manifest
            .lines()
            .map(str::trim)
            .filter_map(|line| line.strip_prefix('"'))
            .filter_map(|line| line.strip_suffix("\","))
            .collect()
    }

    #[test]
    fn permission_manifest_allows_exactly_the_eighteen_commands() {
        assert_eq!(permission_commands(PERMISSION_MANIFEST), COMMANDS);
    }

    #[test]
    fn capability_is_desktop_main_window_only() {
        let capability: serde_json::Value = serde_json::from_str(CAPABILITY_MANIFEST).unwrap();
        assert_eq!(capability["identifier"], "ssh-forward-main");
        assert_eq!(capability["windows"], serde_json::json!(["main"]));
        assert_eq!(capability["platforms"], serde_json::json!(["windows"]));
        assert_eq!(
            capability["permissions"],
            serde_json::json!(["ssh-forward"])
        );
    }

    #[test]
    fn command_boundary_requires_main_window_label() {
        assert!(ensure_main_window("main").is_ok());
        assert_eq!(
            ensure_main_window("browser-debug").unwrap_err(),
            "ssh_forward_main_window_required"
        );
    }

    #[test]
    fn mobile_has_no_ssh_forward_module() {
        const {
            assert!(cfg!(desktop));
            assert!(!cfg!(mobile));
        }
    }
}

#[cfg(all(test, windows))]
mod windows_agent_probe;

#[cfg(all(test, windows))]
mod windows_atomic_probe;
