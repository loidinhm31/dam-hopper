#![cfg(target_os = "linux")]

use dam_hopper_server::semantic::tool_profile::{
    compute_file_sha256, PinnedDigests, SemanticToolProfile, ToolIntegrityStatus,
};
use std::fs::{self, File};
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

struct MockToolchainFixture {
    _temp_dir: TempDir,
    root: PathBuf,
}

impl MockToolchainFixture {
    fn new() -> Self {
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

        // Create executable node binary (mock script or binary)
        let node_path = engine_dir.join("node");
        let mut node_file = File::create(&node_path).expect("create node");
        node_file
            .write_all(b"mock-node-binary-content")
            .expect("write node");
        fs::set_permissions(&node_path, fs::Permissions::from_mode(0o755)).expect("set node 0755");

        // Create tsls cli.mjs
        let cli_path = tsls_pkg_dir.join("cli.mjs");
        let mut cli_file = File::create(&cli_path).expect("create cli.mjs");
        cli_file.write_all(b"// mock tsls cli").expect("write cli");
        fs::set_permissions(&cli_path, fs::Permissions::from_mode(0o644)).expect("set cli 0644");

        // Create tsserver.js
        let tsserver_path = ts_pkg_dir.join("tsserver.js");
        let mut tsserver_file = File::create(&tsserver_path).expect("create tsserver.js");
        tsserver_file
            .write_all(b"// mock tsserver")
            .expect("write tsserver");
        fs::set_permissions(&tsserver_path, fs::Permissions::from_mode(0o644))
            .expect("set tsserver 0644");

        // Create tsls package.json
        let pkg_json_path = tsls_dir.join("package.json");
        let mut pkg_file = File::create(&pkg_json_path).expect("create package.json");
        pkg_file
            .write_all(b"{\"name\":\"tsls-bundle\"}")
            .expect("write package.json");
        fs::set_permissions(&pkg_json_path, fs::Permissions::from_mode(0o644))
            .expect("set package.json 0644");

        Self {
            _temp_dir: temp_dir,
            root,
        }
    }

    fn digests(&self) -> PinnedDigests {
        let node_path = self.root.join("lib/semantic-engine/node");
        let cli_path = self
            .root
            .join("lib/semantic-engine/tsls/node_modules/typescript-language-server/lib/cli.mjs");
        let tsserver_path = self
            .root
            .join("lib/semantic-engine/tsls/node_modules/typescript/lib/tsserver.js");
        let pkg_path = self.root.join("lib/semantic-engine/tsls/package.json");

        PinnedDigests {
            node_sha256: compute_file_sha256(&node_path).expect("hash node"),
            tsls_entrypoint_sha256: Some(compute_file_sha256(&cli_path).expect("hash cli")),
            tsserver_sha256: Some(compute_file_sha256(&tsserver_path).expect("hash tsserver")),
            package_json_sha256: Some(compute_file_sha256(&pkg_path).expect("hash pkg")),
        }
    }

    fn profile(&self) -> SemanticToolProfile {
        SemanticToolProfile::from_release_root_with_digests(&self.root, self.digests())
    }
}

#[test]
fn test_valid_toolchain_passive_integrity() {
    let fixture = MockToolchainFixture::new();
    let profile = fixture.profile();

    let status = profile.verify_integrity();
    assert_eq!(status, ToolIntegrityStatus::Valid);

    // Verify creating launch spec succeeds
    let cwd = fixture.root.clone();
    let home = fixture.root.clone();
    let spec = profile
        .create_launch_spec(&cwd, &home)
        .expect("create launch spec");

    assert_eq!(spec.executable, profile.node_path());
    assert_eq!(spec.entrypoint, profile.tsls_entrypoint());
    assert_eq!(spec.tsserver_path.as_deref(), Some(profile.tsserver_path()));
    assert_eq!(spec.extra_args, vec!["--stdio"]);
    assert_eq!(spec.v8_max_old_space_mb, 256);
}

#[test]
fn test_missing_node_binary_fails_integrity() {
    let fixture = MockToolchainFixture::new();
    let profile = fixture.profile();
    fs::remove_file(profile.node_path()).expect("remove node");

    let status = profile.verify_integrity();
    assert!(
        matches!(status, ToolIntegrityStatus::Missing { component, .. } if component == "node_binary")
    );
}

#[test]
fn test_non_executable_node_binary_fails_integrity() {
    let fixture = MockToolchainFixture::new();
    let profile = fixture.profile();
    fs::set_permissions(profile.node_path(), fs::Permissions::from_mode(0o644)).expect("set 0644");

    let status = profile.verify_integrity();
    assert!(matches!(
        status,
        ToolIntegrityStatus::PermissionDenied { .. }
    ));
}

#[test]
fn test_group_writable_file_fails_integrity() {
    let fixture = MockToolchainFixture::new();
    let profile = fixture.profile();
    fs::set_permissions(
        profile.package_json_path(),
        fs::Permissions::from_mode(0o666),
    )
    .expect("set 0666");

    let status = profile.verify_integrity();
    assert!(matches!(
        status,
        ToolIntegrityStatus::PermissionDenied { .. }
    ));
}

#[test]
fn test_missing_tsls_entrypoint_fails_integrity() {
    let fixture = MockToolchainFixture::new();
    let profile = fixture.profile();
    fs::remove_file(profile.tsls_entrypoint()).expect("remove cli.mjs");

    let status = profile.verify_integrity();
    assert!(
        matches!(status, ToolIntegrityStatus::Missing { component, .. } if component == "tsls_entrypoint")
    );
}

#[test]
fn test_missing_tsserver_fails_integrity() {
    let fixture = MockToolchainFixture::new();
    let profile = fixture.profile();
    fs::remove_file(profile.tsserver_path()).expect("remove tsserver.js");

    let status = profile.verify_integrity();
    assert!(
        matches!(status, ToolIntegrityStatus::Missing { component, .. } if component == "tsserver_entrypoint")
    );
}

#[test]
fn test_missing_package_json_fails_integrity() {
    let fixture = MockToolchainFixture::new();
    let profile = fixture.profile();
    fs::remove_file(profile.package_json_path()).expect("remove package.json");

    let status = profile.verify_integrity();
    assert!(
        matches!(status, ToolIntegrityStatus::Missing { component, .. } if component == "package_json")
    );
}

#[test]
fn test_symlinks_prohibited_in_release_payload() {
    let fixture = MockToolchainFixture::new();
    let outside_temp = TempDir::new().expect("create outside temp dir");
    let outside_node = outside_temp.path().join("other-node");
    File::create(&outside_node).expect("create outside node");

    let profile = fixture.profile();
    fs::remove_file(profile.node_path()).expect("remove internal node");
    std::os::unix::fs::symlink(&outside_node, profile.node_path()).expect("symlink node");

    let status = profile.verify_integrity();
    assert!(matches!(
        status,
        ToolIntegrityStatus::InvalidFileType { reason, .. } if reason.contains("Symlinks are prohibited")
    ));
}

#[test]
fn test_digest_verification_tamper_detection() {
    let fixture = MockToolchainFixture::new();
    let mut digests = fixture.digests();
    digests.node_sha256 =
        "0000000000000000000000000000000000000000000000000000000000000000".to_string();

    let profile = SemanticToolProfile::from_release_root_with_digests(&fixture.root, digests);

    let status = profile.verify_integrity();
    assert!(matches!(
        status,
        ToolIntegrityStatus::DigestMismatch { expected, .. } if expected.starts_with("0000000")
    ));
}

#[test]
fn test_discover_does_not_inspect_environment_variables() {
    std::env::set_var(
        "DAM_HOPPER_SEMANTIC_ENGINE_ROOT",
        "/tmp/attacker-controlled-engine-root",
    );
    let discovered = SemanticToolProfile::discover();
    assert_ne!(
        discovered.release_root(),
        Path::new("/tmp/attacker-controlled-engine-root")
    );
    std::env::remove_var("DAM_HOPPER_SEMANTIC_ENGINE_ROOT");
}

#[test]
fn test_supported_languages_and_extensions() {
    for lang in &[
        "typescript",
        "typescriptreact",
        "javascript",
        "javascriptreact",
    ] {
        assert!(SemanticToolProfile::is_language_supported(lang));
    }
    for ext in &["ts", "tsx", "js", "jsx"] {
        assert!(SemanticToolProfile::is_file_supported(Path::new(&format!(
            "app.{ext}"
        ))));
    }

    // Explicitly reject Rust and Java
    assert!(!SemanticToolProfile::is_language_supported("rust"));
    assert!(!SemanticToolProfile::is_language_supported("java"));
    assert!(!SemanticToolProfile::is_file_supported(Path::new(
        "main.rs"
    )));
    assert!(!SemanticToolProfile::is_file_supported(Path::new(
        "App.java"
    )));
}
