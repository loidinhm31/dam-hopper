#![cfg(target_os = "linux")]

use std::fs::{self, File};
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

use dam_hopper_server::semantic::tool_profile::{
    compute_file_sha256, PinnedDigests, SemanticToolProfile, ToolIntegrityStatus,
    PINNED_NODE_SHA256, PINNED_PACKAGE_JSON_SHA256, PINNED_TSLS_ENTRYPOINT_SHA256,
    PINNED_TSSERVER_IMPL_SHA256, PINNED_TSSERVER_SHA256, PINNED_TYPESCRIPT_JS_SHA256,
};

const KNOWN_PINNED_NODE_PATHS: &[&str] = &[
    "/home/loidinh/.nvm/versions/node/v24.16.0/bin/node",
    "/opt/dam-hopper/lib/semantic-engine/node",
];

const KNOWN_PINNED_NODE_MODULES_DIRS: &[&str] = &[
    "/tmp/dam-hopper-spike-tuple/node_modules",
    "/opt/dam-hopper/lib/semantic-engine/tsls/node_modules",
];

/// Resolves the pinned Linux x64 Node.js v24.16.0 binary strictly by SHA-256 verification.
pub fn resolve_pinned_node_bin() -> Result<PathBuf, String> {
    for candidate in KNOWN_PINNED_NODE_PATHS {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            if let Ok(actual) = compute_file_sha256(&path) {
                if actual.eq_ignore_ascii_case(PINNED_NODE_SHA256) {
                    return Ok(path);
                }
            }
        }
    }
    Err(format!(
        "Pinned Node.js v24.16.0 matching SHA-256 {} not found in {:?}",
        PINNED_NODE_SHA256, KNOWN_PINNED_NODE_PATHS
    ))
}

pub fn resolve_node_bin() -> PathBuf {
    resolve_pinned_node_bin().expect("Pinned Node v24.16.0 binary is required for semantic tests")
}

pub fn fixture_server_script() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/lsp-test-server.mjs")
}

pub fn link_or_copy_regular_file(src: &Path, dst: &Path, mode: u32) -> Result<(), String> {
    let real_src = fs::canonicalize(src).map_err(|e| format!("canonicalize {:?}: {e}", src))?;
    // Qualification deliberately tampers with staged payloads. Never alias the
    // source inode: a hardlink would corrupt the verified tool cache or checkout.
    fs::copy(&real_src, dst).map_err(|e| format!("copy {:?} -> {:?}: {e}", real_src, dst))?;
    fs::set_permissions(dst, fs::Permissions::from_mode(mode))
        .map_err(|e| format!("chmod {:?}: {e}", dst))
}

fn copy_dir_dereferenced(src_dir: &Path, dst_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dst_dir).map_err(|e| format!("mkdir {:?}: {e}", dst_dir))?;
    fs::set_permissions(dst_dir, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    let mut entries: Vec<_> = fs::read_dir(src_dir)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == ".bin" || name_str.ends_with(".tsbuildinfo") {
            continue;
        }
        let real_path = fs::canonicalize(entry.path()).map_err(|e| e.to_string())?;
        let dst_path = dst_dir.join(&name);
        if real_path.is_dir() {
            copy_dir_dereferenced(&real_path, &dst_path)?;
        } else if real_path.is_file() {
            link_or_copy_regular_file(&real_path, &dst_path, 0o644)?;
        }
    }
    Ok(())
}

/// Deterministic fault/protocol test fixture using real pinned Node ELF directly (`lsp-test-server.mjs`).
/// `is_packaged_tuple_verified()` is `false` so it never masquerades as packaged tuple qualification.
pub struct TestToolchain {
    pub temp_dir: TempDir,
    pub root: PathBuf,
}

impl TestToolchain {
    pub fn new() -> Self {
        let temp_dir = TempDir::new().expect("create temp dir");
        let root = temp_dir.path().to_path_buf();
        let engine_dir = root.join("lib/semantic-engine");
        let tsls_dir = engine_dir.join("tsls");
        let tsls_pkg_dir = tsls_dir.join("node_modules/typescript-language-server/lib");
        let ts_pkg_dir = tsls_dir.join("node_modules/typescript/lib");
        fs::create_dir_all(&tsls_pkg_dir).expect("create tsls pkg dir");
        fs::create_dir_all(&ts_pkg_dir).expect("create ts pkg dir");

        link_or_copy_regular_file(&resolve_node_bin(), &engine_dir.join("node"), 0o755)
            .expect("stage real node binary");
        let cli_path = tsls_pkg_dir.join("cli.mjs");
        fs::copy(fixture_server_script(), &cli_path).expect("copy cli.mjs");
        fs::set_permissions(&cli_path, fs::Permissions::from_mode(0o644)).expect("set cli 0644");

        let tsserver_path = ts_pkg_dir.join("tsserver.js");
        File::create(&tsserver_path)
            .and_then(|mut f| f.write_all(b"// test fixture tsserver stub"))
            .expect("write tsserver");
        fs::set_permissions(&tsserver_path, fs::Permissions::from_mode(0o644)).expect("0644");

        let pkg_json_path = tsls_dir.join("package.json");
        File::create(&pkg_json_path)
            .and_then(|mut f| f.write_all(b"{\"name\":\"tsls-test-fixture\"}"))
            .expect("write package.json");
        fs::set_permissions(&pkg_json_path, fs::Permissions::from_mode(0o644)).expect("0644");

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

/// Real offline packaged tuple fixture (`Node 24.16.0` + `TypeScript 5.9.3` + `TSLS 6.0.2`).
pub struct PackagedToolchain {
    pub temp_dir: TempDir,
    pub root: PathBuf,
}

fn sha_matches(path: &Path, expected: &str) -> bool {
    compute_file_sha256(path).ok().as_deref() == Some(expected)
}

impl PackagedToolchain {
    pub fn try_new() -> Result<Self, String> {
        let node_bin = resolve_pinned_node_bin()?;
        let node_modules_dir = KNOWN_PINNED_NODE_MODULES_DIRS
            .iter()
            .map(PathBuf::from)
            .find(|dir| {
                sha_matches(
                    &dir.join("typescript-language-server/lib/cli.mjs"),
                    PINNED_TSLS_ENTRYPOINT_SHA256,
                ) && sha_matches(
                    &dir.join("typescript/lib/tsserver.js"),
                    PINNED_TSSERVER_SHA256,
                ) && sha_matches(
                    &dir.join("typescript/lib/_tsserver.js"),
                    PINNED_TSSERVER_IMPL_SHA256,
                ) && sha_matches(
                    &dir.join("typescript/lib/typescript.js"),
                    PINNED_TYPESCRIPT_JS_SHA256,
                )
            })
            .ok_or_else(|| "Pinned TS 5.9.3 + TSLS 6.0.2 node_modules not found".to_string())?;

        let temp_dir = TempDir::new().map_err(|e| format!("tempdir: {e}"))?;
        let root = temp_dir.path().to_path_buf();
        let engine_dir = root.join("lib/semantic-engine");
        let tsls_dir = engine_dir.join("tsls");
        let target_nm = tsls_dir.join("node_modules");
        fs::create_dir_all(&target_nm).map_err(|e| format!("mkdir: {e}"))?;

        let release_sem_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repo root")
            .join("deploy/release/semantic-engine");
        link_or_copy_regular_file(&node_bin, &engine_dir.join("node"), 0o755)?;
        for meta in [
            "package.json",
            "pnpm-lock.yaml",
            "LICENSES.txt",
            "provenance.json",
        ] {
            link_or_copy_regular_file(&release_sem_dir.join(meta), &tsls_dir.join(meta), 0o644)?;
        }
        for pkg in ["typescript", "typescript-language-server"] {
            copy_dir_dereferenced(&node_modules_dir.join(pkg), &target_nm.join(pkg))?;
        }
        for d in [&root, &root.join("lib"), &engine_dir, &tsls_dir, &target_nm] {
            fs::set_permissions(d, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
        }
        let profile = SemanticToolProfile::from_release_root(&root);
        let status = profile.verify_packaged_tuple_integrity();
        if status != ToolIntegrityStatus::Valid {
            return Err(format!(
                "PackagedToolchain integrity check failed: {:?}",
                status
            ));
        }
        if !sha_matches(profile.package_json_path(), PINNED_PACKAGE_JSON_SHA256) {
            return Err("PackagedToolchain package.json digest mismatch".to_string());
        }
        Ok(Self { temp_dir, root })
    }

    pub fn new() -> Self {
        Self::try_new().expect("PackagedToolchain requires verified offline Node 24.16.0 + TS 5.9.3 + TSLS 6.0.2 tuple")
    }

    pub fn tool_profile(&self) -> SemanticToolProfile {
        let profile = SemanticToolProfile::from_release_root(&self.root);
        assert!(profile.is_packaged_tuple_verified());
        profile
    }
}
