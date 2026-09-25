//! Filesystem layout paths for the Linux release deployment.
//!
//! Encapsulates canonical `/opt`, `/etc`, `/var/lib`, and `/run/lock` paths,
//! supporting an arbitrary root prefix for isolated testing without mutating
//! host filesystems.

use std::path::{Path, PathBuf};

/// Directory and file layout for release management.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    pub opt_dir: PathBuf,
    pub etc_dir: PathBuf,
    pub var_lib_dir: PathBuf,
    pub run_lock_dir: PathBuf,
    pub systemd_unit_dir: PathBuf,
}

impl Default for Layout {
    fn default() -> Self {
        Self::new()
    }
}

impl Layout {
    /// Canonical system layout rooted at `/`.
    pub fn new() -> Self {
        Self {
            opt_dir: PathBuf::from("/opt/dam-hopper"),
            etc_dir: PathBuf::from("/etc/dam-hopper"),
            var_lib_dir: PathBuf::from("/var/lib/dam-hopper-manager"),
            run_lock_dir: PathBuf::from("/run/lock/dam-hopper"),
            systemd_unit_dir: PathBuf::from("/etc/systemd/system"),
        }
    }

    /// Layout scoped under a custom root directory (for isolated testing).
    pub fn with_root<P: AsRef<Path>>(root: P) -> Self {
        let root = root.as_ref();
        Self {
            opt_dir: root.join("opt/dam-hopper"),
            etc_dir: root.join("etc/dam-hopper"),
            var_lib_dir: root.join("var/lib/dam-hopper-manager"),
            run_lock_dir: root.join("run/lock/dam-hopper"),
            systemd_unit_dir: root.join("etc/systemd/system"),
        }
    }
    /// Trusted filesystem root used for descriptor-relative runtime provisioning.
    ///
    /// `Layout` deliberately keeps the historical public path fields; deriving the
    /// root from the fixed `/opt/dam-hopper` path keeps existing struct literals
    /// source-compatible while still allowing `with_root` test layouts.
    pub fn trusted_root(&self) -> PathBuf {
        self.opt_dir
            .parent()
            .and_then(Path::parent)
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("/"))
    }

    /// API-owned state directory (`/var/lib/dam-hopper`).
    pub fn api_state_dir(&self) -> PathBuf {
        self.trusted_root().join("var/lib/dam-hopper")
    }

    /// API-owned configuration directory (`/var/lib/dam-hopper/.config/dam-hopper`).
    pub fn api_config_dir(&self) -> PathBuf {
        self.api_state_dir().join(".config/dam-hopper")
    }

    /// Fixed root-owned configuration anchor (`/etc/dam-hopper`).
    pub fn api_etc_dir(&self) -> PathBuf {
        self.trusted_root().join("etc/dam-hopper")
    }

    /// Canonical API daemon configuration file (`/var/lib/dam-hopper/dam-hopper.toml`).
    pub fn api_daemon_config_path(&self) -> PathBuf {
        self.api_state_dir().join("dam-hopper.toml")
    }

    /// Legacy migration-only API daemon configuration file (`/etc/dam-hopper/dam-hopper.toml`).
    ///
    /// Checked strictly for one-time legacy migration; never a generic config authority.
    pub fn legacy_api_daemon_config_path(&self) -> PathBuf {
        self.api_etc_dir().join("dam-hopper.toml")
    }

    /// Provisioned API audit file (`/var/lib/dam-hopper/idle-suspend-audit.jsonl`).
    pub fn api_audit_path(&self) -> PathBuf {
        self.api_state_dir().join("idle-suspend-audit.jsonl")
    }

    /// Root-only staging directory for in-flight transactions:
    /// `/opt/dam-hopper/.staging`
    pub fn staging_dir(&self) -> PathBuf {
        self.opt_dir.join(".staging")
    }

    /// Root-only transaction directory for a specific transaction id.
    pub fn transaction_staging_dir(&self, tx_id: &str) -> PathBuf {
        self.staging_dir().join(tx_id)
    }

    /// Directory holding immutable unpacked release views:
    /// `/opt/dam-hopper/releases`
    pub fn releases_dir(&self) -> PathBuf {
        self.opt_dir.join("releases")
    }

    /// Concrete release view for a specific tag and role:
    /// `/opt/dam-hopper/releases/<tag>/<role>`
    pub fn release_role_dir(&self, tag: &str, role: &str) -> PathBuf {
        self.releases_dir().join(tag).join(role)
    }

    /// Symlink pointing to the currently active release view:
    /// `/opt/dam-hopper/current`
    pub fn current_link(&self) -> PathBuf {
        self.opt_dir.join("current")
    }

    /// Host configuration file:
    /// `/etc/dam-hopper/host.toml`
    pub fn host_config_path(&self) -> PathBuf {
        self.etc_dir.join("host.toml")
    }

    /// Machine-local server environment file:
    /// `/etc/dam-hopper/server.env`
    pub fn server_env_path(&self) -> PathBuf {
        self.etc_dir.join("server.env")
    }

    /// Machine-local web environment file:
    /// `/etc/dam-hopper/web.env`
    pub fn web_env_path(&self) -> PathBuf {
        self.etc_dir.join("web.env")
    }

    /// Authoritative state envelope for release management:
    /// `/var/lib/dam-hopper-manager/state.json`
    pub fn manager_state_path(&self) -> PathBuf {
        self.var_lib_dir.join("state.json")
    }

    /// Durable metadata for currently active release:
    /// `/var/lib/dam-hopper-manager/active.json`
    pub fn active_state_path(&self) -> PathBuf {
        self.var_lib_dir.join("active.json")
    }

    /// Durable metadata for pending candidate release:
    /// `/var/lib/dam-hopper/pending.json`
    pub fn pending_state_path(&self) -> PathBuf {
        self.var_lib_dir.join("pending.json")
    }

    /// Durable metadata for previously active release (rollback target):
    /// `/var/lib/dam-hopper/rollback.json`
    pub fn rollback_state_path(&self) -> PathBuf {
        self.var_lib_dir.join("rollback.json")
    }

    /// Nonblocking deployment lock path:
    /// `/run/lock/dam-hopper/deploy.lock`
    pub fn deploy_lock_path(&self) -> PathBuf {
        self.run_lock_dir.join("deploy.lock")
    }

    /// Directory holding candidate rendered systemd units:
    /// `/var/lib/dam-hopper/pending-units`
    pub fn pending_units_dir(&self) -> PathBuf {
        self.var_lib_dir.join("pending-units")
    }

    /// Transaction-scoped directory holding candidate rendered systemd units.
    pub fn transaction_pending_units_dir(&self, tx_id: &str) -> PathBuf {
        self.var_lib_dir.join(format!("pending-units-{tx_id}"))
    }

    /// Transaction-scoped candidate public host configuration.
    pub fn transaction_pending_host_config_json_path(&self, tx_id: &str) -> PathBuf {
        self.var_lib_dir
            .join(format!("pending-host-config-{tx_id}.json"))
    }

    /// Public host configuration JSON file:
    /// `/etc/dam-hopper/host-config.json`
    pub fn host_config_json_path(&self) -> PathBuf {
        self.etc_dir.join("host-config.json")
    }

    /// Candidate host configuration JSON file before activation:
    /// `/var/lib/dam-hopper/pending-host-config.json`
    pub fn pending_host_config_json_path(&self) -> PathBuf {
        self.var_lib_dir.join("pending-host-config.json")
    }

    /// Directory for system identity configuration:
    /// `/etc/dam-hopper/sysusers.d`
    pub fn sysusers_dir(&self) -> PathBuf {
        self.etc_dir.join("sysusers.d")
    }

    /// Web service system identity configuration file:
    /// `/etc/dam-hopper/sysusers.d/dam-hopper-web.conf`
    pub fn sysusers_conf_path(&self) -> PathBuf {
        self.sysusers_dir().join("dam-hopper-web.conf")
    }

    /// Directory for tmpfiles configuration:
    /// `/etc/dam-hopper/tmpfiles.d`
    pub fn tmpfiles_dir(&self) -> PathBuf {
        self.etc_dir.join("tmpfiles.d")
    }

    /// Plugin runner tmpfiles configuration file:
    /// `/etc/dam-hopper/tmpfiles.d/dam-hopper-plugin-runner.conf`
    pub fn runner_tmpfiles_conf_path(&self) -> PathBuf {
        self.tmpfiles_dir().join(super::constants::RUNNER_TMPFILES_CONF)
    }

    /// Dedicated durable state directory for the owner plugin runner:
    /// `/var/lib/dam-hopper-plugin-runner`
    pub fn runner_state_dir(&self) -> PathBuf {
        self.trusted_root().join("var/lib/dam-hopper-plugin-runner")
    }

    /// Canonical socket path for plugin runner:
    /// `/run/dam-hopper/plugin-runner.sock`
    pub fn runner_socket_path(&self) -> PathBuf {
        self.trusted_root().join("run/dam-hopper/plugin-runner.sock")
    }

    /// Root bundle output directory:
    /// `/var/lib/dam-hopper-manager/diagnostics`
    pub fn diagnostics_dir(&self) -> PathBuf {
        self.var_lib_dir.join("diagnostics")
    }

    /// Server semantic events file:
    /// `/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl`
    pub fn server_events_path(&self) -> PathBuf {
        self.api_config_dir().join("diagnostics/idle-suspend-events-v1.jsonl")
    }

    /// Backend diagnostics log:
    /// `/var/lib/dam-hopper/.config/dam-hopper/diagnostics/backend-log.jsonl`
    pub fn backend_diagnostics_path(&self) -> PathBuf {
        self.api_config_dir().join("diagnostics/backend-log.jsonl")
    }

    /// Helper audit log:
    /// `/var/log/dam-hopper/idle-suspend-helper.jsonl`
    pub fn helper_audit_path(&self) -> PathBuf {
        self.trusted_root().join("var/log/dam-hopper/idle-suspend-helper.jsonl")
    }

    /// API authentication token:
    /// `/var/lib/dam-hopper/.config/dam-hopper/server-token`
    pub fn api_token_path(&self) -> PathBuf {
        self.api_config_dir().join("server-token")
    }

    /// Server enrolled PID file:
    /// `/run/dam-hopper/server.pid`
    pub fn server_pid_path(&self) -> PathBuf {
        self.trusted_root().join("run/dam-hopper/server.pid")
    }

    /// Helper UNIX domain socket:
    /// `/run/dam-hopper/idle-suspend.sock`
    pub fn helper_socket_path(&self) -> PathBuf {
        self.trusted_root().join("run/dam-hopper/idle-suspend.sock")
    }

    /// RTC wakealarm sysfs path:
    /// `/sys/class/rtc/rtc0/wakealarm`
    pub fn rtc_wakealarm_path(&self) -> PathBuf {
        self.trusted_root().join("sys/class/rtc/rtc0/wakealarm")
    }

    /// RTC device directory:
    /// `/sys/class/rtc/rtc0`
    pub fn rtc_device_dir(&self) -> PathBuf {
        self.trusted_root().join("sys/class/rtc/rtc0")
    }

    /// Linux power state sysfs path:
    /// `/sys/power/state`
    pub fn power_state_path(&self) -> PathBuf {
        self.trusted_root().join("sys/power/state")
    }

    /// Kernel boot id path:
    /// `/proc/sys/kernel/random/boot_id`
    pub fn boot_id_path(&self) -> PathBuf {
        self.trusted_root().join("proc/sys/kernel/random/boot_id")
    }
}

/// Resolve safe user-scoped diagnostics directory for non-root executions.
///
/// Priority:
/// 1. `$XDG_STATE_HOME/dam-hopper/diagnostics` if `$XDG_STATE_HOME` is set and non-empty.
/// 2. `$HOME/.local/state/dam-hopper/diagnostics` if `$HOME` is set and non-empty.
/// 3. None (no `/tmp` fallback).
pub fn resolve_user_diagnostics_dir() -> Option<PathBuf> {
    resolve_user_diagnostics_dir_with(|k| std::env::var_os(k).map(PathBuf::from))
}

/// Seamed variant of `resolve_user_diagnostics_dir` for deterministic testing.
pub fn resolve_user_diagnostics_dir_with<F>(get_env: F) -> Option<PathBuf>
where
    F: Fn(&str) -> Option<PathBuf>,
{
    if let Some(state_home) = get_env("XDG_STATE_HOME") {
        if state_home.is_absolute() && !state_home.as_os_str().is_empty() {
            return Some(state_home.join("dam-hopper").join("diagnostics"));
        }
    }
    if let Some(home) = get_env("HOME") {
        if home.is_absolute() && !home.as_os_str().is_empty() {
            return Some(home.join(".local/state/dam-hopper/diagnostics"));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_canonical_and_legacy_paths_default_root() {
        let layout = Layout::new();
        assert_eq!(
            layout.api_daemon_config_path(),
            PathBuf::from("/var/lib/dam-hopper/dam-hopper.toml")
        );
        assert_eq!(
            layout.legacy_api_daemon_config_path(),
            PathBuf::from("/etc/dam-hopper/dam-hopper.toml")
        );
        assert_eq!(
            layout.api_audit_path(),
            PathBuf::from("/var/lib/dam-hopper/idle-suspend-audit.jsonl")
        );
    }

    #[test]
    fn test_canonical_and_legacy_paths_with_root() {
        let layout = Layout::with_root("/custom/root");
        assert_eq!(
            layout.api_daemon_config_path(),
            PathBuf::from("/custom/root/var/lib/dam-hopper/dam-hopper.toml")
        );
        assert_eq!(
            layout.legacy_api_daemon_config_path(),
            PathBuf::from("/custom/root/etc/dam-hopper/dam-hopper.toml")
        );
        assert_eq!(
            layout.api_audit_path(),
            PathBuf::from("/custom/root/var/lib/dam-hopper/idle-suspend-audit.jsonl")
        );
    }
}
