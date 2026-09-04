//! Systemd unit policy verification for API and Web services.

use super::error::ReleaseError;
use super::unit::UnitRenderContext;
use super::unit_parser::ParsedUnit;

/// Validate rendered API unit strictly matches the Phase 04 contract.
pub fn validate_api_unit_policy(
    unit: &ParsedUnit,
    ctx: &UnitRenderContext,
) -> Result<(), ReleaseError> {
    let name = "dam-hopper-api.service";

    if unit.has_coupling("web") {
        return Err(ReleaseError::UnitPolicyViolation {
            unit: name.into(),
            reason: "API unit must never have coupling dependencies to web unit".into(),
        });
    }

    if ctx.api_user == "root" {
        return Err(ReleaseError::UnitPolicyViolation {
            unit: name.into(),
            reason: "API unit must not run as root".into(),
        });
    }

    assert_eq_prop(unit, name, "Service", "Type", "exec")?;
    assert_eq_prop(unit, name, "Service", "User", &ctx.api_user)?;
    assert_eq_prop(unit, name, "Service", "Group", &ctx.api_group)?;
    assert_eq_prop(unit, name, "Service", "WorkingDirectory", &ctx.api_home)?;
    assert_eq_prop(unit, name, "Service", "Restart", "on-failure")?;
    assert_eq_prop(unit, name, "Service", "KillSignal", "SIGTERM")?;
    assert_eq_prop(unit, name, "Service", "KillMode", "mixed")?;
    assert_eq_prop(unit, name, "Service", "TimeoutStopSec", "20s")?;
    assert_eq_prop(unit, name, "Service", "UMask", "0077")?;
    assert_eq_prop(unit, name, "Service", "NoNewPrivileges", "false")?;
    assert_eq_prop(unit, name, "Service", "SyslogIdentifier", "dam-hopper-api")?;

    let env_entries = unit.get_all_values("Service", "Environment");
    let exp_home = format!("HOME={}", ctx.api_home);
    let required_envs = [
        exp_home.as_str(),
        "XDG_CONFIG_HOME=/etc/dam-hopper",
        "RUST_LOG=info",
        "RUST_ENV=production",
    ];
    for req in required_envs {
        if !env_entries.contains(&req) {
            return Err(ReleaseError::UnitPolicyViolation {
                unit: name.into(),
                reason: format!("missing required Environment entry: '{req}'"),
            });
        }
    }

    let expected_origins_env = format!("DAM_HOPPER_CORS_ORIGINS={}", ctx.api_origins.join(","));
    if !env_entries.contains(&expected_origins_env.as_str()) {
        return Err(ReleaseError::UnitPolicyViolation {
            unit: name.into(),
            reason: format!("missing or mismatched Environment entry: '{expected_origins_env}'"),
        });
    }

    let expected_exec = format!(
        "{}/bin/dam-hopper-server --config /etc/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801",
        ctx.release_root.display()
    );
    assert_eq_prop(unit, name, "Service", "ExecStart", &expected_exec)?;

    assert_eq_prop(unit, name, "Install", "WantedBy", "multi-user.target")?;
    Ok(())
}

/// Validate rendered Web unit strictly matches the Phase 04 isolation contract.
pub fn validate_web_unit_policy(
    unit: &ParsedUnit,
    ctx: &UnitRenderContext,
) -> Result<(), ReleaseError> {
    let name = "dam-hopper-web.service";

    if unit.has_coupling("api") {
        return Err(ReleaseError::UnitPolicyViolation {
            unit: name.into(),
            reason: "Web unit must never have coupling dependencies to API unit".into(),
        });
    }

    for entries in unit.sections.values() {
        if entries
            .iter()
            .any(|(k, _)| k == "EnvironmentFile" || k == "ReadWritePaths")
        {
            return Err(ReleaseError::UnitPolicyViolation {
                unit: name.into(),
                reason: "Web unit must not load EnvironmentFile or define ReadWritePaths".into(),
            });
        }
    }

    assert_eq_prop(unit, name, "Service", "Type", "exec")?;
    assert_eq_prop(unit, name, "Service", "User", "dam-hopper-web")?;
    assert_eq_prop(unit, name, "Service", "Group", "dam-hopper-web")?;
    assert_eq_prop(unit, name, "Service", "Restart", "on-failure")?;
    assert_eq_prop(unit, name, "Service", "KillSignal", "SIGTERM")?;
    assert_eq_prop(unit, name, "Service", "KillMode", "mixed")?;
    assert_eq_prop(unit, name, "Service", "TimeoutStopSec", "10s")?;
    assert_eq_prop(unit, name, "Service", "UMask", "0077")?;
    assert_eq_prop(unit, name, "Service", "NoNewPrivileges", "true")?;
    assert_eq_prop(unit, name, "Service", "ProtectSystem", "strict")?;
    assert_eq_prop(unit, name, "Service", "ProtectHome", "true")?;
    assert_eq_prop(unit, name, "Service", "PrivateTmp", "true")?;
    assert_eq_prop(unit, name, "Service", "PrivateDevices", "true")?;
    assert_eq_prop(unit, name, "Service", "SyslogIdentifier", "dam-hopper-web")?;

    let expected_exec = format!(
        "{}/bin/dam-hopper-web --root {}/web --host 0.0.0.0 --port 4802 --runtime-config {} --release-version {}",
        ctx.release_root.display(),
        ctx.release_root.display(),
        ctx.public_config.display(),
        ctx.release_version
    );
    assert_eq_prop(unit, name, "Service", "ExecStart", &expected_exec)?;

    let read_only_paths = unit.get_all_values("Service", "ReadOnlyPaths");
    let exp_root = ctx.release_root.display().to_string();
    let exp_cfg = ctx.public_config.display().to_string();
    if !read_only_paths.contains(&exp_root.as_str()) || !read_only_paths.contains(&exp_cfg.as_str()) {
        return Err(ReleaseError::UnitPolicyViolation {
            unit: name.into(),
            reason: format!("ReadOnlyPaths must include '{exp_root}' and '{exp_cfg}'"),
        });
    }

    assert_eq_prop(unit, name, "Install", "WantedBy", "multi-user.target")?;
    Ok(())
}

fn assert_eq_prop(
    unit: &ParsedUnit,
    unit_name: &str,
    section: &str,
    key: &str,
    expected: &str,
) -> Result<(), ReleaseError> {
    match unit.get_value(section, key) {
        Some(actual) if actual == expected => Ok(()),
        Some(actual) => Err(ReleaseError::UnitPolicyViolation {
            unit: unit_name.into(),
            reason: format!("[{section}] {key} expected '{expected}', got '{actual}'"),
        }),
        None => Err(ReleaseError::UnitPolicyViolation {
            unit: unit_name.into(),
            reason: format!("[{section}] missing required property '{key}'"),
        }),
    }
}
