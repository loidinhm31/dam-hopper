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
        self.var_lib_dir
            .join(format!("pending-units-{tx_id}"))
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
}
