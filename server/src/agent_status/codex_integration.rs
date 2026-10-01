use std::path::{Path, PathBuf};
use serde_json::json;
use toml_edit::{Array, DocumentMut, InlineTable, Item, Value};

use crate::agent_status::integration::{
    atomic_write_file, parse_launcher_metadata, read_bounded_safe_file, render_launcher_script,
    resolve_stable_binary_path, sha256_hex, validate_safe_dir, validate_safe_file,
    IntegrationError, ManagedHookManifest, ManagedInstallationStatus, ManagedReadinessStatus,
    NativeIntegrationStatusReport, MANAGED_ADAPTER_VERSION, MANAGED_LAUNCHER_SUBPATH,
    MANAGED_MANIFEST_SUBPATH, MAX_CONFIG_FILE_BYTES,
};
use crate::agent_status::types::AgentKind;

/// Canonical events managed by DamHopper for Codex CLI.
pub const CODEX_MANAGED_EVENTS: &[&str] = crate::agent_status::codex_hooks::CODEX_QUALIFIED_EVENTS;

/// Resolve the preferred config path for Codex in the given agent directory.
/// Prefers `config.toml` if it already contains an inline `[hooks]` section and `hooks.json` does not exist.
/// Otherwise, defaults to `hooks.json`.
pub fn resolve_codex_config_target(agent_dir: &Path) -> (PathBuf, &'static str) {
    let hooks_json = agent_dir.join("hooks.json");
    let config_toml = agent_dir.join("config.toml");

    if !hooks_json.exists() && config_toml.is_file() {
        if let Ok(content) = read_bounded_safe_file(&config_toml, MAX_CONFIG_FILE_BYTES) {
            if let Ok(doc) = content.parse::<DocumentMut>() {
                if doc.get("hooks").and_then(|h| h.as_table()).is_some() {
                    return (config_toml, "config_toml");
                }
            }
        }
    }

    (hooks_json, "hooks_json")
}

/// Check the status of the managed Codex integration.
pub fn check_codex_status(agent_dir: &Path) -> Result<NativeIntegrationStatusReport, IntegrationError> {
    validate_safe_dir(agent_dir)?;

    let launcher_path = agent_dir.join(MANAGED_LAUNCHER_SUBPATH);
    let manifest_path = agent_dir.join(MANAGED_MANIFEST_SUBPATH);
    let (config_path, config_format) = resolve_codex_config_target(agent_dir);

    let launcher_exists = validate_safe_file(&launcher_path)?;
    let manifest_exists = validate_safe_file(&manifest_path)?;

    let current_bin = resolve_stable_binary_path().ok();
    let bundled_launcher_content = current_bin
        .as_ref()
        .map(|bin| render_launcher_script(AgentKind::Codex, bin));
    let bundled_hash = bundled_launcher_content
        .as_ref()
        .map(|c| sha256_hex(c))
        .unwrap_or_default();

    // 1. If neither launcher nor manifest exists, check for lingering registrations
    if !launcher_exists && !manifest_exists {
        let has_registered_hooks = check_hooks_registered(&config_path, config_format, &launcher_path)?;
        if has_registered_hooks {
            return Ok(NativeIntegrationStatusReport {
                agent_kind: AgentKind::Codex,
                status: ManagedInstallationStatus::Modified,
                readiness: ManagedReadinessStatus::Unverified,
                target_path: launcher_path.clone(),
                launcher_path,
                manifest_path,
                config_path: Some(config_path),
                version: None,
                bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
                content_hash: None,
                bundled_hash,
                details: Some("Hook registrations exist in config but launcher executable is missing".to_string()),
            });
        }

        return Ok(NativeIntegrationStatusReport {
            agent_kind: AgentKind::Codex,
            status: ManagedInstallationStatus::Absent,
            readiness: ManagedReadinessStatus::Unverified,
            target_path: launcher_path.clone(),
            launcher_path,
            manifest_path,
            config_path: Some(config_path),
            version: None,
            bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
            content_hash: None,
            bundled_hash,
            details: None,
        });
    }

    // 2. Read and validate manifest if present
    let manifest: Option<ManagedHookManifest> = if manifest_exists {
        let raw = read_bounded_safe_file(&manifest_path, MAX_CONFIG_FILE_BYTES)?;
        match serde_json::from_str::<ManagedHookManifest>(&raw) {
            Ok(m) => Some(m),
            Err(e) => {
                return Ok(NativeIntegrationStatusReport {
                    agent_kind: AgentKind::Codex,
                    status: ManagedInstallationStatus::Modified,
                    readiness: ManagedReadinessStatus::Unverified,
                    target_path: launcher_path.clone(),
                    launcher_path,
                    manifest_path,
                    config_path: Some(config_path),
                    version: None,
                    bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
                    content_hash: None,
                    bundled_hash,
                    details: Some(format!("Ownership manifest is corrupted: {e}")),
                });
            }
        }
    } else {
        None
    };

    // 3. Inspect launcher content and hash
    if !launcher_exists {
        return Ok(NativeIntegrationStatusReport {
            agent_kind: AgentKind::Codex,
            status: ManagedInstallationStatus::Outdated,
            readiness: ManagedReadinessStatus::RestartRequired,
            target_path: launcher_path.clone(),
            launcher_path,
            manifest_path,
            config_path: Some(config_path),
            version: manifest.as_ref().map(|m| m.adapter_version.clone()),
            bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
            content_hash: None,
            bundled_hash,
            details: Some("Manifest exists but launcher executable is absent".to_string()),
        });
    }
    let launcher_content = read_bounded_safe_file(&launcher_path, MAX_CONFIG_FILE_BYTES)?;
    let actual_launcher_hash = sha256_hex(&launcher_content);
    let (parsed_ver, parsed_bin) = parse_launcher_metadata(&launcher_content);

    // If manifest exists, verify launcher hash matches recorded hash
    if let Some(m) = &manifest {
        if actual_launcher_hash != m.launcher_hash {
            return Ok(NativeIntegrationStatusReport {
                agent_kind: AgentKind::Codex,
                status: ManagedInstallationStatus::Modified,
                readiness: ManagedReadinessStatus::Unverified,
                target_path: launcher_path.clone(),
                launcher_path,
                manifest_path,
                config_path: Some(config_path),
                version: parsed_ver,
                bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
                content_hash: Some(actual_launcher_hash),
                bundled_hash,
                details: Some("Launcher script content was modified locally".to_string()),
            });
        }
    }

    // Verify binary path still points to valid executable
    let binary_valid = if let Some(bin_str) = &parsed_bin {
        let p = PathBuf::from(bin_str);
        p.is_file()
    } else {
        false
    };

    if !binary_valid {
        return Ok(NativeIntegrationStatusReport {
            agent_kind: AgentKind::Codex,
            status: ManagedInstallationStatus::Outdated,
            readiness: ManagedReadinessStatus::UnsupportedVersion,
            target_path: launcher_path.clone(),
            launcher_path,
            manifest_path,
            config_path: Some(config_path),
            version: parsed_ver,
            bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
            content_hash: Some(actual_launcher_hash),
            bundled_hash,
            details: Some("Configured dam-hopper-server binary path no longer exists".to_string()),
        });
    }

    // Check hook registration in config
    let all_registered = check_all_hooks_registered(&config_path, config_format, &launcher_path)?;
    if !all_registered {
        return Ok(NativeIntegrationStatusReport {
            agent_kind: AgentKind::Codex,
            status: ManagedInstallationStatus::Outdated,
            readiness: ManagedReadinessStatus::RestartRequired,
            target_path: launcher_path.clone(),
            launcher_path,
            manifest_path,
            config_path: Some(config_path),
            version: parsed_ver,
            bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
            content_hash: Some(actual_launcher_hash),
            bundled_hash,
            details: Some("Not all required Codex hook events are registered in config".to_string()),
        });
    }

    // Check policy disabled in config.toml if it exists
    let config_toml_path = agent_dir.join("config.toml");
    if config_toml_path.is_file() {
        if let Ok(toml_str) = read_bounded_safe_file(&config_toml_path, MAX_CONFIG_FILE_BYTES) {
            if let Ok(table) = toml_str.parse::<toml::Table>() {
                if let Some(features) = table.get("features").and_then(|f| f.as_table()) {
                    if let Some(hooks_flag) = features.get("hooks").and_then(|h| h.as_bool()) {
                        if !hooks_flag {
                            return Ok(NativeIntegrationStatusReport {
                                agent_kind: AgentKind::Codex,
                                status: ManagedInstallationStatus::Current,
                                readiness: ManagedReadinessStatus::PolicyDisabled,
                                target_path: launcher_path.clone(),
                                launcher_path,
                                manifest_path,
                                config_path: Some(config_path),
                                version: parsed_ver,
                                bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
                                content_hash: Some(actual_launcher_hash),
                                bundled_hash,
                                details: Some("Codex hooks feature is explicitly disabled in config.toml ([features] hooks = false)".to_string()),
                            });
                        }
                    }
                }
            }
        }
    }

    // Check execution permissions on launcher
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&launcher_path) {
            if meta.permissions().mode() & 0o111 == 0 {
                return Ok(NativeIntegrationStatusReport {
                    agent_kind: AgentKind::Codex,
                    status: ManagedInstallationStatus::Current,
                    readiness: ManagedReadinessStatus::PermissionDenied,
                    target_path: launcher_path.clone(),
                    launcher_path,
                    manifest_path,
                    config_path: Some(config_path),
                    version: parsed_ver,
                    bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
                    content_hash: Some(actual_launcher_hash),
                    bundled_hash,
                    details: Some("Launcher script is missing executable permissions".to_string()),
                });
            }
        }
    }

    // Installed and current; Codex native review in `/hooks` is required before invocation
    Ok(NativeIntegrationStatusReport {
        agent_kind: AgentKind::Codex,
        status: ManagedInstallationStatus::Current,
        readiness: ManagedReadinessStatus::TrustRequired,
        target_path: launcher_path.clone(),
        launcher_path,
        manifest_path,
        config_path: Some(config_path),
        version: parsed_ver,
        bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
        content_hash: Some(actual_launcher_hash),
        bundled_hash,
        details: None,
    })
}

/// Atomically install or upgrade the managed Codex hooks integration.
pub fn install_codex(agent_dir: &Path) -> Result<NativeIntegrationStatusReport, IntegrationError> {
    validate_safe_dir(agent_dir)?;

    let status = check_codex_status(agent_dir)?;
    if status.status == ManagedInstallationStatus::Current {
        return Ok(status);
    }
    if status.status == ManagedInstallationStatus::Modified {
        return Err(IntegrationError::RefusingOverwriteModified(status.launcher_path));
    }

    let binary_path = resolve_stable_binary_path()?;
    let launcher_path = agent_dir.join(MANAGED_LAUNCHER_SUBPATH);
    let manifest_path = agent_dir.join(MANAGED_MANIFEST_SUBPATH);
    let (config_path, config_format) = resolve_codex_config_target(agent_dir);

    let hooks_dir = launcher_path
        .parent()
        .ok_or_else(|| IntegrationError::InvalidAgentDirectory(agent_dir.to_path_buf()))?;

    let mut created_directories = Vec::new();
    let mut created_files = Vec::new();

    if !hooks_dir.exists() {
        std::fs::create_dir_all(hooks_dir)?;
        created_directories.push(hooks_dir.to_string_lossy().into_owned());
    }
    validate_safe_dir(hooks_dir)?;

    if !config_path.exists() {
        created_files.push(config_path.to_string_lossy().into_owned());
    }

    // 1. Stage launcher script
    let launcher_content = render_launcher_script(AgentKind::Codex, &binary_path);
    let launcher_hash = sha256_hex(&launcher_content);
    atomic_write_file(&launcher_path, launcher_content.as_bytes(), Some(0o755))?;

    // 2. Stage manifest
    let manifest = ManagedHookManifest {
        manifest_version: 1,
        agent_kind: AgentKind::Codex,
        adapter_version: MANAGED_ADAPTER_VERSION.to_string(),
        binary_path: binary_path.to_string_lossy().into_owned(),
        launcher_path: launcher_path.to_string_lossy().into_owned(),
        launcher_hash: launcher_hash.clone(),
        config_path: config_path.to_string_lossy().into_owned(),
        config_format: config_format.to_string(),
        owned_hook_events: CODEX_MANAGED_EVENTS.iter().map(|s| s.to_string()).collect(),
        created_directories,
        created_files,
        last_updated_ms: Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
        ),
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| IntegrationError::ConfigurationError(e.to_string()))?;
    atomic_write_file(&manifest_path, &manifest_bytes, Some(0o600))?;

    // 3. Register hooks in native configuration
    let reg_result = if config_format == "config_toml" {
        register_hooks_in_config_toml(&config_path, &launcher_path)
    } else {
        register_hooks_in_hooks_json(&config_path, &launcher_path)
    };

    if let Err(e) = reg_result {
        // Recover partial install state: remove staged launcher and manifest if fresh install
        let _ = std::fs::remove_file(&launcher_path);
        let _ = std::fs::remove_file(&manifest_path);
        return Err(e);
    }

    check_codex_status(agent_dir)
}

/// Atomically uninstall the managed Codex hooks integration.
pub fn uninstall_codex(agent_dir: &Path) -> Result<NativeIntegrationStatusReport, IntegrationError> {
    validate_safe_dir(agent_dir)?;

    let launcher_path = agent_dir.join(MANAGED_LAUNCHER_SUBPATH);
    let manifest_path = agent_dir.join(MANAGED_MANIFEST_SUBPATH);
    let (config_path, config_format) = resolve_codex_config_target(agent_dir);

    let launcher_exists = validate_safe_file(&launcher_path)?;
    let manifest_exists = validate_safe_file(&manifest_path)?;

    if !launcher_exists && !manifest_exists {
        // Remove any dangling registrations
        if config_path.is_file() {
            if config_format == "config_toml" {
                let _ = deregister_hooks_in_config_toml(&config_path, &launcher_path);
            } else {
                let _ = deregister_hooks_in_hooks_json(&config_path, &launcher_path);
            }
        }
        return check_codex_status(agent_dir);
    }

    // Read manifest if present
    let manifest: Option<ManagedHookManifest> = if manifest_exists {
        let raw = read_bounded_safe_file(&manifest_path, MAX_CONFIG_FILE_BYTES)?;
        serde_json::from_str(&raw).ok()
    } else {
        None
    };

    // Safety check: refuse deleting locally modified launcher
    if launcher_exists {
        let content = read_bounded_safe_file(&launcher_path, MAX_CONFIG_FILE_BYTES)?;
        let hash = sha256_hex(&content);
        if let Some(m) = &manifest {
            if hash != m.launcher_hash {
                return Err(IntegrationError::RefusingDeleteModified(launcher_path));
            }
        } else if !content.contains("dam-hopper-managed-version") {
            return Err(IntegrationError::RefusingDeleteModified(launcher_path));
        }
    }

    // Step A: Deregister hooks from native config first
    let mut config_became_empty = false;
    if config_path.is_file() {
        if config_format == "config_toml" {
            deregister_hooks_in_config_toml(&config_path, &launcher_path)?;
        } else {
            config_became_empty = deregister_hooks_in_hooks_json(&config_path, &launcher_path)?;
        }
    }

    // If config was created by us and is now empty, remove it
    if config_became_empty {
        if let Some(m) = &manifest {
            if m.created_files.contains(&config_path.to_string_lossy().into_owned()) {
                let _ = std::fs::remove_file(&config_path);
            }
        }
    }

    // Step B: Remove launcher script
    if launcher_exists {
        std::fs::remove_file(&launcher_path)?;
    }

    // Step C: Remove manifest
    if manifest_exists {
        std::fs::remove_file(&manifest_path)?;
    }

    // Step D: Remove created empty directories
    if let Some(m) = &manifest {
        for dir_str in &m.created_directories {
            let dir_path = PathBuf::from(dir_str);
            if dir_path.is_dir() {
                // remove_dir succeeds only if empty
                let _ = std::fs::remove_dir(&dir_path);
            }
        }
    }

    check_codex_status(agent_dir)
}

// ── Internal Helpers for hooks.json ───────────────────────────────────────────

fn check_hooks_registered(
    config_path: &Path,
    config_format: &str,
    launcher_path: &Path,
) -> Result<bool, IntegrationError> {
    if !config_path.is_file() {
        return Ok(false);
    }
    let launcher_str = launcher_path.to_string_lossy();

    if config_format == "config_toml" {
        let content = read_bounded_safe_file(config_path, MAX_CONFIG_FILE_BYTES)?;
        let doc = content
            .parse::<DocumentMut>()
            .map_err(|e| IntegrationError::ConfigurationError(format!("Malformed TOML: {e}")))?;
        if let Some(hooks_table) = doc.get("hooks").and_then(|h| h.as_table()) {
            for (_, item) in hooks_table.iter() {
                if let Some(arr) = item.as_array() {
                    for val in arr.iter() {
                        if let Some(tbl) = val.as_inline_table() {
                            if let Some(cmd) = tbl.get("command").and_then(|c| c.as_str()) {
                                if cmd == launcher_str.as_ref() {
                                    return Ok(true);
                                }
                            }
                            if let Some(hooks_arr) = tbl.get("hooks").and_then(|h| h.as_array()) {
                                for h in hooks_arr.iter() {
                                    if let Some(h_tbl) = h.as_inline_table() {
                                        if let Some(cmd) = h_tbl.get("command").and_then(|c| c.as_str()) {
                                            if cmd == launcher_str.as_ref() {
                                                return Ok(true);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    } else {
        let content = read_bounded_safe_file(config_path, MAX_CONFIG_FILE_BYTES)?;
        let val: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| IntegrationError::ConfigurationError(format!("Malformed JSON: {e}")))?;
        let hooks_obj = match val.get("hooks").and_then(|h| h.as_object()) {
            Some(o) => o,
            None => match val.as_object() {
                Some(o) => o,
                None => return Ok(false),
            },
        };
        for (_, entry) in hooks_obj.iter() {
            if let Some(arr) = entry.as_array() {
                for item in arr {
                    if let Some(cmd) = item.get("command").and_then(|c| c.as_str()) {
                        if cmd == launcher_str.as_ref() {
                            return Ok(true);
                        }
                    }
                    if let Some(hooks) = item.get("hooks").and_then(|h| h.as_array()) {
                        for h in hooks {
                            if let Some(cmd) = h.get("command").and_then(|c| c.as_str()) {
                                if cmd == launcher_str.as_ref() {
                                    return Ok(true);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(false)
}

fn check_all_hooks_registered(
    config_path: &Path,
    config_format: &str,
    launcher_path: &Path,
) -> Result<bool, IntegrationError> {
    if !config_path.is_file() {
        return Ok(false);
    }
    let launcher_str = launcher_path.to_string_lossy();

    if config_format == "config_toml" {
        let content = read_bounded_safe_file(config_path, MAX_CONFIG_FILE_BYTES)?;
        let doc = content
            .parse::<DocumentMut>()
            .map_err(|e| IntegrationError::ConfigurationError(format!("Malformed TOML: {e}")))?;
        let hooks_table = match doc.get("hooks").and_then(|h| h.as_table()) {
            Some(t) => t,
            None => return Ok(false),
        };
        for event in CODEX_MANAGED_EVENTS {
            let registered = hooks_table.get(*event).and_then(|item| item.as_array()).map(|arr| {
                arr.iter().any(|v| {
                    if let Some(tbl) = v.as_inline_table() {
                        if let Some(cmd) = tbl.get("command").and_then(|c| c.as_str()) {
                            if cmd == launcher_str.as_ref() {
                                return true;
                            }
                        }
                        if let Some(hooks_arr) = tbl.get("hooks").and_then(|h| h.as_array()) {
                            return hooks_arr.iter().any(|h| {
                                h.as_inline_table()
                                    .and_then(|t| t.get("command"))
                                    .and_then(|c| c.as_str())
                                    == Some(launcher_str.as_ref())
                            });
                        }
                    }
                    false
                })
            }).unwrap_or(false);
            if !registered {
                return Ok(false);
            }
        }
    } else {
        let content = read_bounded_safe_file(config_path, MAX_CONFIG_FILE_BYTES)?;
        let val: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| IntegrationError::ConfigurationError(format!("Malformed JSON: {e}")))?;
        let hooks_obj = match val.get("hooks").and_then(|h| h.as_object()) {
            Some(o) => o,
            None => match val.as_object() {
                Some(o) => o,
                None => return Ok(false),
            },
        };
        for event in CODEX_MANAGED_EVENTS {
            let registered = hooks_obj.get(*event).and_then(|entry| entry.as_array()).map(|arr| {
                arr.iter().any(|item| {
                    if let Some(cmd) = item.get("command").and_then(|c| c.as_str()) {
                        if cmd == launcher_str.as_ref() {
                            return true;
                        }
                    }
                    if let Some(hooks) = item.get("hooks").and_then(|h| h.as_array()) {
                        hooks.iter().any(|h| {
                            h.get("command").and_then(|c| c.as_str()) == Some(launcher_str.as_ref())
                        })
                    } else {
                        false
                    }
                })
            }).unwrap_or(false);
            if !registered {
                return Ok(false);
            }
        }
    }

    Ok(true)
}

fn register_hooks_in_hooks_json(
    config_path: &Path,
    launcher_path: &Path,
) -> Result<(), IntegrationError> {
    let launcher_str = launcher_path.to_string_lossy().into_owned();
    let mut root: serde_json::Value = if config_path.is_file() {
        let raw = read_bounded_safe_file(config_path, MAX_CONFIG_FILE_BYTES)?;
        serde_json::from_str(&raw)
            .map_err(|e| IntegrationError::ConfigurationError(format!("Invalid hooks.json: {e}")))?
    } else {
        json!({ "hooks": {} })
    };

    if !root.is_object() {
        root = json!({ "hooks": {} });
    }

    let use_nested_hooks = root.get("hooks").is_some() || !root.as_object().map(|o| o.is_empty()).unwrap_or(true);
    let hooks_map = if use_nested_hooks {
        if root.get("hooks").is_none() {
            root["hooks"] = json!({});
        }
        root.get_mut("hooks").unwrap().as_object_mut().unwrap()
    } else {
        root.as_object_mut().unwrap()
    };

    for event in CODEX_MANAGED_EVENTS {
        let arr = hooks_map
            .entry(*event)
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or_else(|| {
                IntegrationError::ConfigurationError(format!(
                    "Expected array for event '{event}' in hooks.json"
                ))
            })?;

        // Clean up any legacy flat entries
        arr.retain(|item| {
            item.get("command").and_then(|c| c.as_str()) != Some(&launcher_str)
        });

        let exists = arr.iter().any(|item| {
            if let Some(hooks) = item.get("hooks").and_then(|h| h.as_array()) {
                hooks.iter().any(|h| {
                    h.get("command").and_then(|c| c.as_str()) == Some(&launcher_str)
                })
            } else {
                false
            }
        });
        if !exists {
            arr.push(json!({
                "hooks": [
                    {
                        "type": "command",
                        "command": launcher_str
                    }
                ]
            }));
        }
    }
    let serialized = serde_json::to_vec_pretty(&root)
        .map_err(|e| IntegrationError::ConfigurationError(e.to_string()))?;
    atomic_write_file(config_path, &serialized, None)?;
    Ok(())
}

fn deregister_hooks_in_hooks_json(
    config_path: &Path,
    launcher_path: &Path,
) -> Result<bool, IntegrationError> {
    let launcher_str = launcher_path.to_string_lossy();
    let raw = read_bounded_safe_file(config_path, MAX_CONFIG_FILE_BYTES)?;
    let mut root: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| IntegrationError::ConfigurationError(format!("Invalid hooks.json: {e}")))?;

    let is_nested = root.get("hooks").and_then(|h| h.as_object()).is_some();
    let hooks_map = if is_nested {
        root.get_mut("hooks").unwrap().as_object_mut().unwrap()
    } else if let Some(obj) = root.as_object_mut() {
        obj
    } else {
        return Ok(false);
    };

    let mut keys_to_remove = Vec::new();

    for (event, val) in hooks_map.iter_mut() {
        if let Some(arr) = val.as_array_mut() {
            // 1. Remove legacy flat entries
            arr.retain(|item| {
                item.get("command")
                    .and_then(|c| c.as_str())
                    .map(|cmd| cmd != launcher_str.as_ref())
                    .unwrap_or(true)
            });
            // 2. Remove matching hook handlers from inside MatcherGroups
            for group in arr.iter_mut() {
                if let Some(hooks) = group.get_mut("hooks").and_then(|h| h.as_array_mut()) {
                    hooks.retain(|h| {
                        h.get("command")
                            .and_then(|c| c.as_str())
                            .map(|cmd| cmd != launcher_str.as_ref())
                            .unwrap_or(true)
                    });
                }
            }
            // 3. Remove MatcherGroups whose hooks array is now empty
            arr.retain(|group| {
                if let Some(hooks) = group.get("hooks").and_then(|h| h.as_array()) {
                    !hooks.is_empty()
                } else {
                    true
                }
            });
            if arr.is_empty() && CODEX_MANAGED_EVENTS.contains(&event.as_str()) {
                keys_to_remove.push(event.clone());
            }
        }
    }

    for key in keys_to_remove {
        hooks_map.remove(&key);
    }

    let is_empty = if is_nested {
        hooks_map.is_empty()
    } else {
        root.as_object().map(|o| o.is_empty()).unwrap_or(false)
    };

    if is_empty && is_nested {
        root.as_object_mut().unwrap().remove("hooks");
    }

    let serialized = serde_json::to_vec_pretty(&root)
        .map_err(|e| IntegrationError::ConfigurationError(e.to_string()))?;
    atomic_write_file(config_path, &serialized, None)?;

    Ok(is_empty)
}

// ── Internal Helpers for config.toml ──────────────────────────────────────────

fn register_hooks_in_config_toml(
    config_path: &Path,
    launcher_path: &Path,
) -> Result<(), IntegrationError> {
    let launcher_str = launcher_path.to_string_lossy().into_owned();
    let content = if config_path.is_file() {
        read_bounded_safe_file(config_path, MAX_CONFIG_FILE_BYTES)?
    } else {
        String::new()
    };

    let mut doc = content
        .parse::<DocumentMut>()
        .map_err(|e| IntegrationError::ConfigurationError(format!("Malformed config.toml: {e}")))?;

    if doc.get("hooks").is_none() {
        doc["hooks"] = Item::Table(toml_edit::Table::new());
    }

    let hooks_table = doc["hooks"].as_table_mut().ok_or_else(|| {
        IntegrationError::ConfigurationError("[hooks] in config.toml is not a table".to_string())
    })?;

    for event in CODEX_MANAGED_EVENTS {
        if hooks_table.get(*event).is_none() {
            hooks_table[*event] = Item::Value(Value::Array(Array::new()));
        }
        let arr = hooks_table[*event].as_array_mut().ok_or_else(|| {
            IntegrationError::ConfigurationError(format!(
                "[hooks.{event}] in config.toml is not an array"
            ))
        })?;

        // Clean up any legacy flat entries
        let mut idx = 0;
        while idx < arr.len() {
            let is_legacy = arr.get(idx).and_then(|v| {
                v.as_inline_table()
                    .and_then(|t| t.get("command"))
                    .and_then(|c| c.as_str())
                    .map(|cmd| cmd == launcher_str.as_str())
            }).unwrap_or(false);
            if is_legacy {
                arr.remove(idx);
            } else {
                idx += 1;
            }
        }

        let exists = arr.iter().any(|val| {
            if let Some(tbl) = val.as_inline_table() {
                if let Some(hooks_arr) = tbl.get("hooks").and_then(|h| h.as_array()) {
                    hooks_arr.iter().any(|h| {
                        h.as_inline_table()
                            .and_then(|t| t.get("command"))
                            .and_then(|c| c.as_str())
                            == Some(launcher_str.as_str())
                    })
                } else {
                    false
                }
            } else {
                false
            }
        });

        if !exists {
            let mut handler = InlineTable::new();
            handler.insert("type", "command".into());
            handler.insert("command", launcher_str.clone().into());
            let mut handler_arr = Array::new();
            handler_arr.push(Value::InlineTable(handler));

            let mut group = InlineTable::new();
            group.insert("hooks", Value::Array(handler_arr));
            arr.push(Value::InlineTable(group));
        }
    }
    let serialized = doc.to_string();
    atomic_write_file(config_path, serialized.as_bytes(), None)?;
    Ok(())
}

fn deregister_hooks_in_config_toml(
    config_path: &Path,
    launcher_path: &Path,
) -> Result<(), IntegrationError> {
    let launcher_str = launcher_path.to_string_lossy();
    let content = read_bounded_safe_file(config_path, MAX_CONFIG_FILE_BYTES)?;
    let mut doc = content
        .parse::<DocumentMut>()
        .map_err(|e| IntegrationError::ConfigurationError(format!("Malformed config.toml: {e}")))?;

    let hooks_table = match doc.get_mut("hooks").and_then(|h| h.as_table_mut()) {
        Some(t) => t,
        None => return Ok(()),
    };

    let mut keys_to_remove = Vec::new();

    for (key, val) in hooks_table.iter_mut() {
        if let Some(arr) = val.as_array_mut() {
            let mut i = 0;
            while i < arr.len() {
                let mut should_remove_group = false;
                if let Some(tbl) = arr.get_mut(i).and_then(|v| v.as_inline_table_mut()) {
                    if tbl.get("command").and_then(|c| c.as_str()) == Some(launcher_str.as_ref()) {
                        should_remove_group = true;
                    } else if let Some(hooks_arr) = tbl.get_mut("hooks").and_then(|h| h.as_array_mut()) {
                        let mut j = 0;
                        while j < hooks_arr.len() {
                            let match_cmd = hooks_arr.get(j).and_then(|h| {
                                h.as_inline_table()
                                    .and_then(|t| t.get("command"))
                                    .and_then(|c| c.as_str())
                                    .map(|cmd| cmd == launcher_str.as_ref())
                            }).unwrap_or(false);
                            if match_cmd {
                                hooks_arr.remove(j);
                            } else {
                                j += 1;
                            }
                        }
                        if hooks_arr.is_empty() {
                            should_remove_group = true;
                        }
                    }
                }
                if should_remove_group {
                    arr.remove(i);
                } else {
                    i += 1;
                }
            }
            let key_str = key.get();
            if arr.is_empty() && CODEX_MANAGED_EVENTS.contains(&key_str) {
                keys_to_remove.push(key_str.to_string());
            }
        }
    }

    for key in keys_to_remove {
        hooks_table.remove(&key);
    }

    let serialized = doc.to_string();
    atomic_write_file(config_path, serialized.as_bytes(), None)?;
    Ok(())
}
