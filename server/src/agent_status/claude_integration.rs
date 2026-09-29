use std::path::{Path, PathBuf};
use serde_json::json;

use crate::agent_status::integration::{
    atomic_write_file, parse_launcher_metadata, read_bounded_safe_file, render_launcher_script,
    resolve_stable_binary_path, sha256_hex, validate_safe_dir, validate_safe_file,
    IntegrationError, ManagedHookManifest, ManagedInstallationStatus, ManagedReadinessStatus,
    NativeIntegrationStatusReport, MANAGED_ADAPTER_VERSION, MANAGED_LAUNCHER_SUBPATH,
    MANAGED_MANIFEST_SUBPATH, MAX_CONFIG_FILE_BYTES,
};
use crate::agent_status::types::AgentKind;

/// Canonical events managed by DamHopper for Claude Code.
pub const CLAUDE_MANAGED_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "PostToolUseFailure",
    "PreCompact",
    "PostCompact",
    "Notification",
    "Stop",
    "StopFailure",
    "SessionEnd",
];

/// Check the status of the managed Claude Code integration.
pub fn check_claude_status(agent_dir: &Path) -> Result<NativeIntegrationStatusReport, IntegrationError> {
    validate_safe_dir(agent_dir)?;

    let launcher_path = agent_dir.join(MANAGED_LAUNCHER_SUBPATH);
    let manifest_path = agent_dir.join(MANAGED_MANIFEST_SUBPATH);
    let settings_path = agent_dir.join("settings.json");

    let launcher_exists = validate_safe_file(&launcher_path)?;
    let manifest_exists = validate_safe_file(&manifest_path)?;

    let current_bin = resolve_stable_binary_path().ok();
    let bundled_launcher_content = current_bin
        .as_ref()
        .map(|bin| render_launcher_script(AgentKind::Claude, bin));
    let bundled_hash = bundled_launcher_content
        .as_ref()
        .map(|c| sha256_hex(c))
        .unwrap_or_default();

    // 1. If neither launcher nor manifest exists, check for lingering registrations
    if !launcher_exists && !manifest_exists {
        let has_registered_hooks = check_claude_hooks_registered(&settings_path, &launcher_path)?;
        if has_registered_hooks {
            return Ok(NativeIntegrationStatusReport {
                agent_kind: AgentKind::Claude,
                status: ManagedInstallationStatus::Modified,
                readiness: ManagedReadinessStatus::Unverified,
                target_path: launcher_path.clone(),
                launcher_path,
                manifest_path,
                config_path: Some(settings_path),
                version: None,
                bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
                content_hash: None,
                bundled_hash,
                details: Some("Hook registrations exist in settings.json but launcher executable is missing".to_string()),
            });
        }

        return Ok(NativeIntegrationStatusReport {
            agent_kind: AgentKind::Claude,
            status: ManagedInstallationStatus::Absent,
            readiness: ManagedReadinessStatus::Unverified,
            target_path: launcher_path.clone(),
            launcher_path,
            manifest_path,
            config_path: Some(settings_path),
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
                    agent_kind: AgentKind::Claude,
                    status: ManagedInstallationStatus::Modified,
                    readiness: ManagedReadinessStatus::Unverified,
                    target_path: launcher_path.clone(),
                    launcher_path,
                    manifest_path,
                    config_path: Some(settings_path),
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
            agent_kind: AgentKind::Claude,
            status: ManagedInstallationStatus::Outdated,
            readiness: ManagedReadinessStatus::RestartRequired,
            target_path: launcher_path.clone(),
            launcher_path,
            manifest_path,
            config_path: Some(settings_path),
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
                agent_kind: AgentKind::Claude,
                status: ManagedInstallationStatus::Modified,
                readiness: ManagedReadinessStatus::Unverified,
                target_path: launcher_path.clone(),
                launcher_path,
                manifest_path,
                config_path: Some(settings_path),
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
            agent_kind: AgentKind::Claude,
            status: ManagedInstallationStatus::Outdated,
            readiness: ManagedReadinessStatus::UnsupportedVersion,
            target_path: launcher_path.clone(),
            launcher_path,
            manifest_path,
            config_path: Some(settings_path),
            version: parsed_ver,
            bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
            content_hash: Some(actual_launcher_hash),
            bundled_hash,
            details: Some("Configured dam-hopper-server binary path no longer exists".to_string()),
        });
    }

    // Check hook registration in settings.json
    let all_registered = check_all_claude_hooks_registered(&settings_path, &launcher_path)?;
    if !all_registered {
        return Ok(NativeIntegrationStatusReport {
            agent_kind: AgentKind::Claude,
            status: ManagedInstallationStatus::Outdated,
            readiness: ManagedReadinessStatus::RestartRequired,
            target_path: launcher_path.clone(),
            launcher_path,
            manifest_path,
            config_path: Some(settings_path),
            version: parsed_ver,
            bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
            content_hash: Some(actual_launcher_hash),
            bundled_hash,
            details: Some("Not all required Claude hook events are registered in settings.json".to_string()),
        });
    }

    // Check policy disabled in settings.json if it exists
    if settings_path.is_file() {
        if let Ok(raw) = read_bounded_safe_file(&settings_path, MAX_CONFIG_FILE_BYTES) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
                if val.get("disableAllHooks").and_then(|v| v.as_bool()) == Some(true) {
                    return Ok(NativeIntegrationStatusReport {
                        agent_kind: AgentKind::Claude,
                        status: ManagedInstallationStatus::Current,
                        readiness: ManagedReadinessStatus::PolicyDisabled,
                        target_path: launcher_path.clone(),
                        launcher_path,
                        manifest_path,
                        config_path: Some(settings_path),
                        version: parsed_ver,
                        bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
                        content_hash: Some(actual_launcher_hash),
                        bundled_hash,
                        details: Some("Claude hooks are disabled by effective policy (disableAllHooks: true)".to_string()),
                    });
                }
                if val.get("allowManagedHooksOnly").and_then(|v| v.as_bool()) == Some(true) {
                    return Ok(NativeIntegrationStatusReport {
                        agent_kind: AgentKind::Claude,
                        status: ManagedInstallationStatus::Current,
                        readiness: ManagedReadinessStatus::PolicyDisabled,
                        target_path: launcher_path.clone(),
                        launcher_path,
                        manifest_path,
                        config_path: Some(settings_path),
                        version: parsed_ver,
                        bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
                        content_hash: Some(actual_launcher_hash),
                        bundled_hash,
                        details: Some("Only managed hooks permitted by policy (allowManagedHooksOnly: true)".to_string()),
                    });
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
                    agent_kind: AgentKind::Claude,
                    status: ManagedInstallationStatus::Current,
                    readiness: ManagedReadinessStatus::PermissionDenied,
                    target_path: launcher_path.clone(),
                    launcher_path,
                    manifest_path,
                    config_path: Some(settings_path),
                    version: parsed_ver,
                    bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
                    content_hash: Some(actual_launcher_hash),
                    bundled_hash,
                    details: Some("Launcher script is missing executable permissions".to_string()),
                });
            }
        }
    }

    // Installed and current; readiness is Unverified until live qualified reporting occurs
    Ok(NativeIntegrationStatusReport {
        agent_kind: AgentKind::Claude,
        status: ManagedInstallationStatus::Current,
        readiness: ManagedReadinessStatus::Unverified,
        target_path: launcher_path.clone(),
        launcher_path,
        manifest_path,
        config_path: Some(settings_path),
        version: parsed_ver,
        bundled_version: MANAGED_ADAPTER_VERSION.to_string(),
        content_hash: Some(actual_launcher_hash),
        bundled_hash,
        details: None,
    })
}

/// Atomically install or upgrade the managed Claude Code hooks integration.
pub fn install_claude(agent_dir: &Path) -> Result<NativeIntegrationStatusReport, IntegrationError> {
    validate_safe_dir(agent_dir)?;

    let status = check_claude_status(agent_dir)?;
    if status.status == ManagedInstallationStatus::Current {
        return Ok(status);
    }
    if status.status == ManagedInstallationStatus::Modified {
        return Err(IntegrationError::RefusingOverwriteModified(status.launcher_path));
    }

    let binary_path = resolve_stable_binary_path()?;
    let launcher_path = agent_dir.join(MANAGED_LAUNCHER_SUBPATH);
    let manifest_path = agent_dir.join(MANAGED_MANIFEST_SUBPATH);
    let settings_path = agent_dir.join("settings.json");

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

    if !settings_path.exists() {
        created_files.push(settings_path.to_string_lossy().into_owned());
    }

    // 1. Stage launcher script
    let launcher_content = render_launcher_script(AgentKind::Claude, &binary_path);
    let launcher_hash = sha256_hex(&launcher_content);
    atomic_write_file(&launcher_path, launcher_content.as_bytes(), Some(0o755))?;

    // 2. Stage manifest
    let manifest = ManagedHookManifest {
        manifest_version: 1,
        agent_kind: AgentKind::Claude,
        adapter_version: MANAGED_ADAPTER_VERSION.to_string(),
        binary_path: binary_path.to_string_lossy().into_owned(),
        launcher_path: launcher_path.to_string_lossy().into_owned(),
        launcher_hash: launcher_hash.clone(),
        config_path: settings_path.to_string_lossy().into_owned(),
        config_format: "settings_json".to_string(),
        owned_hook_events: CLAUDE_MANAGED_EVENTS.iter().map(|s| s.to_string()).collect(),
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

    // 3. Register hooks in settings.json
    let reg_result = register_claude_hooks(&settings_path, &launcher_path);
    if let Err(e) = reg_result {
        // Recover partial install state: remove staged launcher and manifest if fresh install
        let _ = std::fs::remove_file(&launcher_path);
        let _ = std::fs::remove_file(&manifest_path);
        return Err(e);
    }

    check_claude_status(agent_dir)
}

/// Atomically uninstall the managed Claude Code hooks integration.
pub fn uninstall_claude(agent_dir: &Path) -> Result<NativeIntegrationStatusReport, IntegrationError> {
    validate_safe_dir(agent_dir)?;

    let launcher_path = agent_dir.join(MANAGED_LAUNCHER_SUBPATH);
    let manifest_path = agent_dir.join(MANAGED_MANIFEST_SUBPATH);
    let settings_path = agent_dir.join("settings.json");

    let launcher_exists = validate_safe_file(&launcher_path)?;
    let manifest_exists = validate_safe_file(&manifest_path)?;

    if !launcher_exists && !manifest_exists {
        // Remove any dangling registrations
        if settings_path.is_file() {
            let _ = deregister_claude_hooks(&settings_path, &launcher_path);
        }
        return check_claude_status(agent_dir);
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

    // Step A: Deregister hooks from settings.json first
    let mut config_became_empty = false;
    if settings_path.is_file() {
        config_became_empty = deregister_claude_hooks(&settings_path, &launcher_path)?;
    }

    // If settings.json was created by us and has no other keys left, remove it
    if config_became_empty {
        if let Some(m) = &manifest {
            if m.created_files.contains(&settings_path.to_string_lossy().into_owned()) {
                let _ = std::fs::remove_file(&settings_path);
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
                let _ = std::fs::remove_dir(&dir_path);
            }
        }
    }

    check_claude_status(agent_dir)
}

// ── Internal Helpers for settings.json ────────────────────────────────────────

fn check_claude_hooks_registered(
    settings_path: &Path,
    launcher_path: &Path,
) -> Result<bool, IntegrationError> {
    if !settings_path.is_file() {
        return Ok(false);
    }
    let launcher_str = launcher_path.to_string_lossy();
    let content = read_bounded_safe_file(settings_path, MAX_CONFIG_FILE_BYTES)?;
    let val: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| IntegrationError::ConfigurationError(format!("Malformed settings.json: {e}")))?;

    let hooks_obj = match val.get("hooks").and_then(|h| h.as_object()) {
        Some(o) => o,
        None => return Ok(false),
    };

    for (_, matchers_val) in hooks_obj.iter() {
        if let Some(matchers) = matchers_val.as_array() {
            for matcher in matchers {
                if let Some(hooks_arr) = matcher.get("hooks").and_then(|h| h.as_array()) {
                    for hook in hooks_arr {
                        if let Some(cmd) = hook.get("command").and_then(|c| c.as_str()) {
                            if cmd == launcher_str.as_ref() {
                                return Ok(true);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(false)
}

fn check_all_claude_hooks_registered(
    settings_path: &Path,
    launcher_path: &Path,
) -> Result<bool, IntegrationError> {
    if !settings_path.is_file() {
        return Ok(false);
    }
    let launcher_str = launcher_path.to_string_lossy();
    let content = read_bounded_safe_file(settings_path, MAX_CONFIG_FILE_BYTES)?;
    let val: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| IntegrationError::ConfigurationError(format!("Malformed settings.json: {e}")))?;

    let hooks_obj = match val.get("hooks").and_then(|h| h.as_object()) {
        Some(o) => o,
        None => return Ok(false),
    };

    for event in CLAUDE_MANAGED_EVENTS {
        let matchers = match hooks_obj.get(*event).and_then(|m| m.as_array()) {
            Some(m) => m,
            None => return Ok(false),
        };

        let found = matchers.iter().any(|matcher| {
            matcher.get("hooks").and_then(|h| h.as_array()).map(|hooks| {
                hooks.iter().any(|hook| {
                    hook.get("command").and_then(|c| c.as_str()) == Some(launcher_str.as_ref())
                })
            }).unwrap_or(false)
        });

        if !found {
            return Ok(false);
        }
    }

    Ok(true)
}

fn register_claude_hooks(
    settings_path: &Path,
    launcher_path: &Path,
) -> Result<(), IntegrationError> {
    let launcher_str = launcher_path.to_string_lossy().into_owned();
    let mut root: serde_json::Value = if settings_path.is_file() {
        let raw = read_bounded_safe_file(settings_path, MAX_CONFIG_FILE_BYTES)?;
        serde_json::from_str(&raw)
            .map_err(|e| IntegrationError::ConfigurationError(format!("Invalid settings.json: {e}")))?
    } else {
        json!({})
    };

    if !root.is_object() {
        root = json!({});
    }

    if root.get("hooks").is_none() || !root["hooks"].is_object() {
        root["hooks"] = json!({});
    }

    let hooks_map = root["hooks"].as_object_mut().unwrap();

    for event in CLAUDE_MANAGED_EVENTS {
        let matchers = hooks_map
            .entry(*event)
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or_else(|| {
                IntegrationError::ConfigurationError(format!(
                    "Expected array for hooks.{event} in settings.json"
                ))
            })?;

        // Check if launcher is already registered in any matcher
        let already_registered = matchers.iter().any(|matcher| {
            matcher.get("hooks").and_then(|h| h.as_array()).map(|hooks| {
                hooks.iter().any(|hook| {
                    hook.get("command").and_then(|c| c.as_str()) == Some(&launcher_str)
                })
            }).unwrap_or(false)
        });

        if !already_registered {
            // Append a dedicated matcher entry for DamHopper
            matchers.push(json!({
                "matcher": "",
                "hooks": [
                    {
                        "type": "command",
                        "command": launcher_str.clone(),
                    }
                ]
            }));
        }
    }

    let serialized = serde_json::to_vec_pretty(&root)
        .map_err(|e| IntegrationError::ConfigurationError(e.to_string()))?;
    atomic_write_file(settings_path, &serialized, None)?;
    Ok(())
}

fn deregister_claude_hooks(
    settings_path: &Path,
    launcher_path: &Path,
) -> Result<bool, IntegrationError> {
    let launcher_str = launcher_path.to_string_lossy();
    let raw = read_bounded_safe_file(settings_path, MAX_CONFIG_FILE_BYTES)?;
    let mut root: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| IntegrationError::ConfigurationError(format!("Invalid settings.json: {e}")))?;

    let hooks_map = match root.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        Some(m) => m,
        None => return Ok(false),
    };

    let mut events_to_remove = Vec::new();

    for (event, matchers_val) in hooks_map.iter_mut() {
        if let Some(matchers) = matchers_val.as_array_mut() {
            for matcher in matchers.iter_mut() {
                if let Some(hooks) = matcher.get_mut("hooks").and_then(|h| h.as_array_mut()) {
                    hooks.retain(|hook| {
                        hook.get("command")
                            .and_then(|c| c.as_str())
                            .map(|cmd| cmd != launcher_str.as_ref())
                            .unwrap_or(true)
                    });
                }
            }
            // Remove matchers that have empty hooks
            matchers.retain(|matcher| {
                matcher
                    .get("hooks")
                    .and_then(|h| h.as_array())
                    .map(|h| !h.is_empty())
                    .unwrap_or(true)
            });

            if matchers.is_empty() && CLAUDE_MANAGED_EVENTS.contains(&event.as_str()) {
                events_to_remove.push(event.clone());
            }
        }
    }

    for event in events_to_remove {
        hooks_map.remove(&event);
    }

    let hooks_empty = hooks_map.is_empty();
    if hooks_empty {
        root.as_object_mut().unwrap().remove("hooks");
    }

    let root_empty = root.as_object().map(|o| o.is_empty()).unwrap_or(false);

    let serialized = serde_json::to_vec_pretty(&root)
        .map_err(|e| IntegrationError::ConfigurationError(e.to_string()))?;
    atomic_write_file(settings_path, &serialized, None)?;

    Ok(root_empty)
}
