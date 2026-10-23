#![cfg(target_os = "linux")]

use std::fs::{self, File};
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use tempfile::TempDir;

use dam_hopper_server::semantic::tool_profile::{
    compute_file_sha256, PinnedDigests, SemanticToolProfile,
};

pub fn resolve_node_bin() -> PathBuf {
    if let Ok(p) = std::env::var("NODE_BIN") {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return pb;
        }
    }
    if let Ok(out) = std::process::Command::new("which").arg("node").output() {
        let p = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
        if p.is_file() {
            return p;
        }
    }
    let out = std::process::Command::new("which")
        .arg("node")
        .output()
        .expect("Failed to locate node");
    PathBuf::from(String::from_utf8_lossy(&out.stdout).trim())
}

pub fn fixture_server_script() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir.join("tests/fixtures/lsp-test-server.mjs")
}

pub struct TestToolchain {
    pub temp_dir: TempDir,
    pub root: PathBuf,
}

impl TestToolchain {
    pub fn new() -> Self {
        let temp_dir = TempDir::new().expect("create temp dir");
        let root = temp_dir.path().to_path_buf();

        let engine_dir = root.join("lib").join("semantic-engine");
        let tsls_dir = engine_dir.join("tsls");
        let tsls_pkg_dir = tsls_dir
            .join("node_modules")
            .join("typescript-language-server")
            .join("lib");
        let ts_pkg_dir = tsls_dir.join("node_modules").join("typescript").join("lib");

        fs::create_dir_all(&engine_dir).expect("create engine dir");
        fs::create_dir_all(&tsls_pkg_dir).expect("create tsls pkg dir");
        fs::create_dir_all(&ts_pkg_dir).expect("create ts pkg dir");

        // Create executable node wrapper
        let real_node = resolve_node_bin();
        let node_path = engine_dir.join("node");
        let wrapper_content = format!("#!/bin/sh\nexec {} \"$@\"\n", real_node.display());
        {
            let mut node_file = File::create(&node_path).expect("create node wrapper");
            node_file
                .write_all(wrapper_content.as_bytes())
                .expect("write node wrapper");
            node_file.sync_all().expect("sync node wrapper");
        }
        fs::set_permissions(&node_path, fs::Permissions::from_mode(0o755)).expect("set node 0755");

        // Copy lsp-test-server.mjs as cli.mjs
        let fixture_path = fixture_server_script();
        let cli_path = tsls_pkg_dir.join("cli.mjs");
        fs::copy(&fixture_path, &cli_path).expect("copy cli.mjs");
        fs::set_permissions(&cli_path, fs::Permissions::from_mode(0o644)).expect("set cli 0644");

        // Create tsserver.js
        let tsserver_path = ts_pkg_dir.join("tsserver.js");
        {
            let mut tsserver_file = File::create(&tsserver_path).expect("create tsserver.js");
            tsserver_file
                .write_all(b"// mock tsserver")
                .expect("write tsserver");
            tsserver_file.sync_all().expect("sync tsserver");
        }
        fs::set_permissions(&tsserver_path, fs::Permissions::from_mode(0o644))
            .expect("set tsserver 0644");

        // Create tsls package.json
        let pkg_json_path = tsls_dir.join("package.json");
        {
            let mut pkg_file = File::create(&pkg_json_path).expect("create package.json");
            pkg_file
                .write_all(b"{\"name\":\"tsls-bundle\"}")
                .expect("write package.json");
            pkg_file.sync_all().expect("sync package.json");
        }
        fs::set_permissions(&pkg_json_path, fs::Permissions::from_mode(0o644))
            .expect("set package.json 0644");

        Self { temp_dir, root }
    }

    pub fn tool_profile(&self) -> SemanticToolProfile {
        let node_path = self.root.join("lib/semantic-engine/node");
        let cli_path = self
            .root
            .join("lib/semantic-engine/tsls/node_modules/typescript-language-server/lib/cli.mjs");
        let tsserver_path = self
            .root
            .join("lib/semantic-engine/tsls/node_modules/typescript/lib/tsserver.js");
        let pkg_path = self.root.join("lib/semantic-engine/tsls/package.json");

        let digests = PinnedDigests {
            node_sha256: compute_file_sha256(&node_path).expect("hash node"),
            tsls_entrypoint_sha256: Some(compute_file_sha256(&cli_path).expect("hash cli")),
            tsserver_sha256: Some(compute_file_sha256(&tsserver_path).expect("hash tsserver")),
            package_json_sha256: Some(compute_file_sha256(&pkg_path).expect("hash pkg")),
        };

        SemanticToolProfile::from_release_root_with_digests(&self.root, digests)
    }
}
