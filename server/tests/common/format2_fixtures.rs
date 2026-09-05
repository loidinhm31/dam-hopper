//! Test fixture helper for generating verified format-2 legacy installations.

use dam_hopper_server::linux_release::legacy_format2::LEGACY_FORMAT2_UNIT;
use dam_hopper_server::linux_release::Layout;
use sha2::{Digest, Sha256};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use tempfile::TempDir;

pub struct Format2Fixture {
    pub _temp_dir: TempDir,
    pub layout: Layout,
    pub binary_hash: String,
    pub unit_hash: String,
    pub nonce: String,
}

pub fn create_format2_fixture() -> Format2Fixture {
    let temp_dir = TempDir::new().unwrap();
    let root = temp_dir.path();
    let opt_dir = root.join("opt").join("dam-hopper");
    let etc_dir = root.join("etc");
    let systemd_dir = etc_dir.join("systemd").join("system");
    let var_lib_dir = root.join("var").join("lib").join("dam-hopper-manager");
    let run_lock_dir = root.join("run").join("lock");

    fs::create_dir_all(&opt_dir).unwrap();
    fs::set_permissions(&opt_dir, fs::Permissions::from_mode(0o755)).unwrap();

    fs::create_dir_all(&systemd_dir).unwrap();
    let wants_dir = systemd_dir.join("multi-user.target.wants");
    fs::create_dir_all(&wants_dir).unwrap();
    fs::create_dir_all(&var_lib_dir).unwrap();
    fs::create_dir_all(&run_lock_dir).unwrap();

    // 1. Bin dir and binary
    let bin_dir = opt_dir.join("bin");
    fs::create_dir_all(&bin_dir).unwrap();
    fs::set_permissions(&bin_dir, fs::Permissions::from_mode(0o755)).unwrap();
    let bin_path = bin_dir.join("dam-hopper-server");
    let bin_bytes = b"dam-hopper-server-binary-mock";
    fs::write(&bin_path, bin_bytes).unwrap();
    fs::set_permissions(&bin_path, fs::Permissions::from_mode(0o755)).unwrap();
    let binary_hash = hex::encode(Sha256::digest(bin_bytes));

    // 2. Unit file
    let unit_path = systemd_dir.join(LEGACY_FORMAT2_UNIT);
    let unit_content = "\
[Unit]
Description=DamHopper server (system service, loidinh runtime)
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=loidinh
Group=loidinh
WorkingDirectory=/home/loidinh
Environment=HOME=/home/loidinh
Environment=XDG_CONFIG_HOME=/home/loidinh/.config
Environment=RUST_LOG=info
Environment=RUST_ENV=production
EnvironmentFile=/home/loidinh/.config/dam-hopper/server.env
EnvironmentFile=/home/loidinh/.config/dam-hopper/server-safety.env
ExecStart=/opt/dam-hopper/bin/dam-hopper-server --config /home/loidinh/.config/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801
Restart=on-failure
RestartSec=5s
KillSignal=SIGTERM
KillMode=mixed
TimeoutStopSec=20s
UMask=0077
NoNewPrivileges=false
StandardOutput=journal
StandardError=journal
SyslogIdentifier=dam-hopper

[Install]
WantedBy=multi-user.target
";
    fs::write(&unit_path, unit_content).unwrap();
    fs::set_permissions(&unit_path, fs::Permissions::from_mode(0o644)).unwrap();
    let unit_hash = hex::encode(Sha256::digest(unit_content.as_bytes()));

    // Wants link
    let wants_link = wants_dir.join(LEGACY_FORMAT2_UNIT);
    std::os::unix::fs::symlink(&unit_path, &wants_link).unwrap();

    // 3. Marker dir
    let marker_dir = opt_dir.join(".systemd-fresh-install");
    fs::create_dir_all(&marker_dir).unwrap();
    fs::set_permissions(&marker_dir, fs::Permissions::from_mode(0o700)).unwrap();

    let nonce = "0123456789abcdef0123456789abcdef".to_string();
    let manifest_content = format!(
        "binary_sha256={binary_hash}\nformat=2\nnonce={nonce}\nunit_sha256={unit_hash}\n"
    );
    let manifest_path = marker_dir.join("manifest");
    fs::write(&manifest_path, manifest_content).unwrap();
    fs::set_permissions(&manifest_path, fs::Permissions::from_mode(0o600)).unwrap();

    let nonce_path = marker_dir.join("nonce");
    fs::write(&nonce_path, &nonce).unwrap();
    fs::set_permissions(&nonce_path, fs::Permissions::from_mode(0o600)).unwrap();

    let layout = Layout {
        opt_dir,
        etc_dir,
        var_lib_dir,
        run_lock_dir,
        systemd_unit_dir: systemd_dir,
    };

    Format2Fixture {
        _temp_dir: temp_dir,
        layout,
        binary_hash,
        unit_hash,
        nonce,
    }
}
