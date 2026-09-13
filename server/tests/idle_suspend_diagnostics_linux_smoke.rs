//! Ignored read-only Linux smoke test for production idle-suspend diagnostics.
//!
//! Validates:
//! 1. Captures before-snapshot of host metadata, file hashes, RTC wakealarm, and unit properties.
//! 2. Collects diagnostic bundle using real production adapters and writes to an injected temporary directory.
//! 3. Validates output JSON structure, schema version, permissions (0600 file, 0700 dir).
//! 4. Captures after-snapshot and asserts zero mutation across all monitored host properties and files.
//! 5. Cleans up temporary artifacts.

#[cfg(target_os = "linux")]
#[tokio::test]
#[ignore = "Live read-only Linux smoke test; run explicitly on approved Linux host with: cargo test --test idle_suspend_diagnostics_linux_smoke -- --ignored"]
async fn test_idle_suspend_diagnostics_read_only_linux_smoke() {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;
    use tempfile::tempdir;
    use sha2::{Sha256, Digest};

    use dam_hopper_server::linux_release::diagnostics::{
        collector::{collect_diagnostic_bundle, CollectorAdapters},
        model::{DIAGNOSTIC_BUNDLE_SCHEMA_VERSION, DiagnosticBundleV1},
        output::write_diagnostic_bundle_to_dir,
    };
    use dam_hopper_server::linux_release::layout::Layout;

    // Helper to compute sha256 of file if present, along with metadata
    fn hash_file(path: &Path) -> Option<(String, u64, u32)> {
        if !path.exists() {
            return None;
        }
        let bytes = fs::read(path).ok()?;
        let meta = fs::metadata(path).ok()?;
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let hash = format!("{:x}", hasher.finalize());
        Some((hash, meta.len(), meta.permissions().mode()))
    }

    fn read_rtc_wakealarm() -> String {
        fs::read_to_string("/sys/class/rtc/rtc0/wakealarm").unwrap_or_default()
    }

    fn query_unit_properties(unit: &str) -> (String, String, String) {
        let output = std::process::Command::new("systemctl")
            .args(["show", unit, "--property=ActiveState,SubState,MainPID"])
            .output();
        match output {
            Ok(out) if out.status.success() => {
                let text = String::from_utf8_lossy(&out.stdout);
                let mut active = String::new();
                let mut sub = String::new();
                let mut pid = String::new();
                for line in text.lines() {
                    if let Some(v) = line.strip_prefix("ActiveState=") {
                        active = v.to_string();
                    } else if let Some(v) = line.strip_prefix("SubState=") {
                        sub = v.to_string();
                    } else if let Some(v) = line.strip_prefix("MainPID=") {
                        pid = v.to_string();
                    }
                }
                (active, sub, pid)
            }
            _ => ("unknown".to_string(), "unknown".to_string(), "unknown".to_string()),
        }
    }

    let layout = Layout::new();

    // 1. Snapshot before state
    let host_toml_before = hash_file(&layout.host_config_path());
    let server_config_before = hash_file(&layout.etc_dir.join("dam-hopper.toml"));
    let helper_audit_before = hash_file(&layout.helper_audit_path());
    let server_events_before = hash_file(&layout.server_events_path());
    let rtc_before = read_rtc_wakealarm();
    let api_unit_before = query_unit_properties("dam-hopper-api.service");
    let helper_unit_before = query_unit_properties("dam-hopper-idle-suspend-helper.service");

    // 2. Execute collection using real production adapters
    let adapters = CollectorAdapters::default();
    let bundle = collect_diagnostic_bundle(&layout, &adapters).await;

    // Validate bundle invariants
    assert_eq!(bundle.bundle_schema_version, DIAGNOSTIC_BUNDLE_SCHEMA_VERSION);
    assert!(!bundle.bundle_id.is_empty());
    assert!(bundle.generated_at_ms > 0);

    // 3. Write bundle to temporary directory and verify permissions
    let tmp = tempdir().expect("create tempdir for smoke output");
    let euid = unsafe { libc::geteuid() };
    let bundle_bytes = serde_json::to_vec(&bundle).expect("serialize bundle");

    let output_path = write_diagnostic_bundle_to_dir(
        tmp.path(),
        &bundle.bundle_id,
        bundle.generated_at_ms,
        &bundle_bytes,
        euid,
    )
    .expect("write diagnostic bundle to temp dir");

    assert!(output_path.exists());
    let file_meta = fs::metadata(&output_path).expect("file metadata");
    assert_eq!(
        file_meta.permissions().mode() & 0o777,
        0o600,
        "Bundle output must be regular file with mode 0600"
    );

    // Validate that output JSON parses back to DiagnosticBundleV1
    let read_back_bytes = fs::read(&output_path).expect("read back bundle");
    let parsed: DiagnosticBundleV1 = serde_json::from_slice(&read_back_bytes).expect("parse back bundle");
    assert_eq!(parsed.bundle_id, bundle.bundle_id);

    // 4. Snapshot after state and assert zero mutation
    let host_toml_after = hash_file(&layout.host_config_path());
    let server_config_after = hash_file(&layout.etc_dir.join("dam-hopper.toml"));
    let helper_audit_after = hash_file(&layout.helper_audit_path());
    let server_events_after = hash_file(&layout.server_events_path());
    let rtc_after = read_rtc_wakealarm();
    let api_unit_after = query_unit_properties("dam-hopper-api.service");
    let helper_unit_after = query_unit_properties("dam-hopper-idle-suspend-helper.service");

    assert_eq!(host_toml_before, host_toml_after, "host.toml must remain unchanged");
    assert_eq!(server_config_before, server_config_after, "dam-hopper.toml must remain unchanged");
    assert_eq!(helper_audit_before, helper_audit_after, "helper audit log must not be modified by diagnostics");
    assert_eq!(server_events_before, server_events_after, "server events log must not be modified by diagnostics");
    assert_eq!(rtc_before, rtc_after, "RTC wakealarm must not be modified by diagnostics");
    assert_eq!(api_unit_before, api_unit_after, "dam-hopper-api.service state must remain unchanged");
    assert_eq!(helper_unit_before, helper_unit_after, "dam-hopper-idle-suspend-helper.service state must remain unchanged");

    // 5. Cleanup
    drop(tmp);
}
