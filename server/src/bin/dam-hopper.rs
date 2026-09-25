//! DamHopper Linux release manager executable.

#[cfg(target_os = "linux")]
use clap::Parser;
#[cfg(target_os = "linux")]
use dam_hopper_server::linux_release::{
    acquire_release, current_euid, execute_activation_with_args, execute_manual_rollback,
    execute_recovery, load_host_config, load_or_init_manager_state, save_host_config,
    stage_release_bundle_with_options, verify_api_service_account,
    verify_plugin_owner_account, verify_privileges, Cli, CollectorAdapters, Commands, HostConfig,
    Layout, ReleaseError, RoleCommands, TargetRole, ALL_SERVICE_UNITS, DEFAULT_API_SERVICE_USER,
    run_diagnose,
};
#[cfg(target_os = "linux")]
use std::process::ExitCode;

#[cfg(target_os = "linux")]
#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    let euid = current_euid();

    if let Err(e) = verify_privileges(&cli.command, euid) {
        eprintln!("error: {e}");
        return ExitCode::from(1);
    }

    let layout = Layout::new();

    match cli.command {
        Commands::Fetch(args) => {
            println!("Fetching release into '{}'...", args.output.display());
            match acquire_release(&args).await {
                Ok(record) => {
                    println!("Successfully acquired release tag '{}'", record.tag);
                    println!("  Archive SHA-256: {}", record.archive_sha256);
                    println!("  Manifest SHA-256: {}", record.manifest_sha256);
                    if record.attestation_verified {
                        println!("  GitHub attestation verified: yes");
                    }
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("fetch failed: {e}");
                    ExitCode::from(1)
                }
            }
        }
        Commands::Install(args) => {
            if let Err(e) = dam_hopper_server::linux_release::verify_host_platform() {
                eprintln!("host platform verification failed: {e}");
                return ExitCode::from(1);
            }
            let effective_api_user = args
                .service_user
                .as_deref()
                .unwrap_or(DEFAULT_API_SERVICE_USER);
            if let Some(owner) = &args.plugin_owner_user {
                if let Err(e) = verify_plugin_owner_account(owner, Some(effective_api_user)) {
                    eprintln!("invalid plugin owner user: {e}");
                    return ExitCode::from(1);
                }
            }
            if let Some(user) = &args.service_user {
                if let Err(e) = verify_api_service_account(user) {
                    eprintln!("invalid service user: {e}");
                    return ExitCode::from(1);
                }
                let role = args.role.unwrap_or(TargetRole::Both);
                if let Err(e) =
                    persist_service_user_selection(&layout, role, &args.allow_web_origins, user)
                {
                    eprintln!("failed to persist service user: {e}");
                    return ExitCode::from(1);
                }
            }
            println!(
                "Installing release bundle from '{}'...",
                args.bundle.display()
            );
            match stage_release_bundle_with_options(
                &layout,
                &args.bundle,
                args.role,
                &args.allow_web_origins,
                args.verify_attestation,
                false,
                args.reinstall,
                args.plugin_owner_user,
                &args.plugin_admin_subjects,
            ) {
                Ok(pending) => {
                    println!("Successfully staged candidate release '{}'", pending.tag);
                    println!("  Role: {}", pending.role);
                    println!("  Path: {}", pending.release_path);
                    println!("To activate and start services, run: sudo dam-hopper start");
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("install failed: {e}");
                    ExitCode::from(1)
                }
            }
        }
        Commands::Role { command } => match command {
            RoleCommands::Set(args) => {
                if let Err(e) = dam_hopper_server::linux_release::verify_host_platform() {
                    eprintln!("host platform verification failed: {e}");
                    return ExitCode::from(1);
                }
                let effective_api_user = args
                    .service_user
                    .as_deref()
                    .unwrap_or(DEFAULT_API_SERVICE_USER);
                if let Some(owner) = &args.plugin_owner_user {
                    if let Err(e) = verify_plugin_owner_account(owner, Some(effective_api_user)) {
                        eprintln!("invalid plugin owner user: {e}");
                        return ExitCode::from(1);
                    }
                }
                if let Some(user) = &args.service_user {
                    if let Err(e) = verify_api_service_account(user) {
                        eprintln!("invalid service user: {e}");
                        return ExitCode::from(1);
                    }
                    if let Err(e) = persist_service_user_selection(
                        &layout,
                        args.role,
                        &args.allow_web_origins,
                        user,
                    ) {
                        eprintln!("failed to persist service user: {e}");
                        return ExitCode::from(1);
                    }
                }
                println!(
                    "Switching deployment role to '{}' using bundle '{}'...",
                    args.role,
                    args.bundle.display()
                );
                match stage_release_bundle_with_options(
                    &layout,
                    &args.bundle,
                    Some(args.role),
                    &args.allow_web_origins,
                    args.verify_attestation,
                    true,
                    args.reinstall,
                    args.plugin_owner_user,
                    &args.plugin_admin_subjects,
                ) {
                    Ok(pending) => {
                        println!("Successfully staged candidate role view '{}'", pending.role);
                        println!("  Path: {}", pending.release_path);
                        println!("To activate and start services, run: sudo dam-hopper start");
                        ExitCode::SUCCESS
                    }
                    Err(e) => {
                        eprintln!("role set failed: {e}");
                        ExitCode::from(1)
                    }
                }
            }
        },
        Commands::Start(args) => {
            if let Err(e) = dam_hopper_server::linux_release::verify_host_platform() {
                eprintln!("host platform verification failed: {e}");
                return ExitCode::from(1);
            }
            match execute_activation_with_args(&layout, &args).await {
                Ok(()) => {
                    println!("Services successfully activated and verified.");
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("error: activation failed: {e}");
                    ExitCode::from(1)
                }
            }
        }
        Commands::Stop(args) => {
            if let Err(e) = dam_hopper_server::linux_release::verify_host_platform() {
                eprintln!("host platform verification failed: {e}");
                return ExitCode::from(1);
            }
            println!("Stopping DamHopper services...");
            for &unit in ALL_SERVICE_UNITS {
                if let Ok(true) = dam_hopper_server::linux_release::systemctl_is_active(unit) {
                    if let Err(e) = dam_hopper_server::linux_release::systemctl_stop(unit) {
                        eprintln!("warning: failed to stop {unit}: {e}");
                    } else {
                        println!("  Stopped {unit}");
                    }
                }
            }
            let _ = dam_hopper_server::linux_release::terminate_stray_listeners(&[
                dam_hopper_server::linux_release::API_SERVICE_PORT,
                dam_hopper_server::linux_release::WEB_SERVICE_PORT,
            ]);
            if args.clean {
                println!("Cleaning active release state and symlinks...");
                let _ = std::fs::remove_file(layout.current_link());
                if let Ok(mut state) = dam_hopper_server::linux_release::load_or_init_manager_state(
                    &layout.manager_state_path(),
                ) {
                    if let Some(active) = state.active.take() {
                        let _ = std::fs::remove_dir_all(&active.release_path);
                    }
                    state.pending = None;
                    let _ = dam_hopper_server::linux_release::save_manager_state(
                        &layout.manager_state_path(),
                        &mut state,
                    );
                }
                println!("Cleaned release state for rebuild.");
            }
            println!("Services stopped successfully.");
            ExitCode::SUCCESS
        }
        Commands::Status(args) => {
            let host_config = match load_host_config(&layout.host_config_path()) {
                Ok(config) => config,
                Err(e) => {
                    eprintln!("error: failed to read host configuration: {e}");
                    return ExitCode::from(1);
                }
            };
            let mgr_state = match load_or_init_manager_state(&layout.manager_state_path()) {
                Ok(state) => state,
                Err(e) => {
                    eprintln!("error: failed to read manager state: {e}");
                    return ExitCode::from(1);
                }
            };
            let services = dam_hopper_server::linux_release::collect_all_services_status();
            if args.json {
                let status_val = serde_json::json!({
                    "hostConfig": host_config,
                    "state": mgr_state,
                    "services": services,
                });
                println!("{status_val}");
            } else {
                println!("Host Configuration:");
                if let Some(config) = host_config {
                    println!("  Role: {}", config.role);
                    println!("  Allowed Web Origins: {:?}", config.allowed_web_origins);
                } else {
                    println!("  (not configured)");
                }
                println!("Active Release:");
                if let Some(active) = &mgr_state.active {
                    println!("  Tag: {}", active.tag);
                    println!("  Role: {}", active.role);
                    println!("  Committed At: {}", active.committed_at);
                } else {
                    println!("  (none)");
                }
                println!("Services:");
                println!("  Server:");
                for svc in services.iter().filter(|s| s.role == "server") {
                    let mut details = if svc.active {
                        "active".to_string()
                    } else {
                        "inactive".to_string()
                    };
                    if let Some(pid) = svc.pid {
                        details.push_str(&format!(" (pid: {pid}"));
                        if let Some(uid) = svc.uid {
                            details.push_str(&format!(", uid: {uid}"));
                        }
                        details.push(')');
                    }
                    println!("    {}: {details}", svc.unit_name);
                }
                println!("  Web:");
                for svc in services.iter().filter(|s| s.role == "web") {
                    let mut details = if svc.active {
                        "active".to_string()
                    } else {
                        "inactive".to_string()
                    };
                    if let Some(pid) = svc.pid {
                        details.push_str(&format!(" (pid: {pid}"));
                        if let Some(uid) = svc.uid {
                            details.push_str(&format!(", uid: {uid}"));
                        }
                        details.push(')');
                    }
                    println!("    {}: {details}", svc.unit_name);
                }
                println!("  Recovery:");
                for svc in services.iter().filter(|s| s.role == "recovery") {
                    let mut details = if svc.active {
                        "active".to_string()
                    } else {
                        "inactive".to_string()
                    };
                    if let Some(pid) = svc.pid {
                        details.push_str(&format!(" (pid: {pid}"));
                        if let Some(uid) = svc.uid {
                            details.push_str(&format!(", uid: {uid}"));
                        }
                        details.push(')');
                    }
                    println!("    {}: {details}", svc.unit_name);
                }
                println!("Previous Release:");
                if let Some(previous) = &mgr_state.previous {
                    println!("  Tag: {}", previous.tag);
                    println!("  Role: {}", previous.role);
                } else {
                    println!("  (none)");
                }
                println!("Pending Candidate:");
                if let Some(candidate) = &mgr_state.pending {
                    println!("  Tag: {}", candidate.tag);
                    println!("  Role: {}", candidate.role);
                    println!("  Staged At: {}", candidate.staged_at);
                } else {
                    println!("  (none)");
                }
                if let Some(failure) = &mgr_state.latest_failure {
                    println!("Latest Failure:");
                    println!("  Phase: {}", failure.phase);
                    println!("  Error: {}", failure.sanitized_error);
                }
            }
            ExitCode::SUCCESS
        }
        Commands::Rollback(_) => {
            if let Err(e) = dam_hopper_server::linux_release::verify_host_platform() {
                eprintln!("host platform verification failed: {e}");
                return ExitCode::from(1);
            }
            match execute_manual_rollback(&layout).await {
                Ok(()) => {
                    println!("Rollback completed and verified successfully.");
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("error: rollback failed: {e}");
                    ExitCode::from(1)
                }
            }
        }
        Commands::Recover(args) => {
            if let Err(e) = dam_hopper_server::linux_release::verify_host_platform() {
                eprintln!("host platform verification failed: {e}");
                return ExitCode::from(1);
            }
            match execute_recovery(&layout, args.boot).await {
                Ok(()) => {
                    println!("Recovery reconciliation completed successfully.");
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("error: recovery reconciliation failed: {e}");
                    ExitCode::from(1)
                }
            }
        }
        Commands::Validate(args) => {
            println!(
                "Validating release manifest '{}'...",
                args.manifest.display()
            );
            match dam_hopper_server::linux_release::validate_manifest_and_archive(
                &args.manifest,
                args.archive.as_deref(),
            ) {
                Ok(manifest) => {
                    println!(
                        "✓ Manifest '{}' is valid for release {}.",
                        args.manifest.display(),
                        manifest.release.tag
                    );
                    if let Some(archive) = args.archive {
                        println!(
                            "✓ Archive '{}' matches manifest inventory.",
                            archive.display()
                        );
                    }
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("error: validation failed: {e}");
                    ExitCode::from(1)
                }
            }
        }
        Commands::Version => {
            println!("dam-hopper {}", env!("CARGO_PKG_VERSION"));
            println!("profile: {}", dam_hopper_server::linux_release::PROFILE_ID);
            println!(
                "schema: {}",
                dam_hopper_server::linux_release::RELEASE_MANIFEST_SCHEMA_VERSION
            );
            ExitCode::SUCCESS
        }
        Commands::Diagnose(_args) => {
            let adapters = CollectorAdapters::default();
            run_diagnose(&layout, &adapters).await
        }
        Commands::ProvisionApiRuntime => {
            match dam_hopper_server::linux_release::provision_installed_api_runtime(&layout) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("error: API runtime provisioning failed: {e}");
                    ExitCode::from(1)
                }
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn persist_service_user_selection(
    layout: &Layout,
    role: TargetRole,
    allow_web_origins: &[String],
    user: &str,
) -> Result<(), ReleaseError> {
    let mut host_config = load_host_config(&layout.host_config_path())?
        .unwrap_or(HostConfig::new(role, allow_web_origins.to_vec())?);
    host_config.service_user = Some(user.trim().to_string());
    save_host_config(&layout.host_config_path(), &host_config)
}

#[cfg(windows)]
fn main() -> std::process::ExitCode {
    eprintln!("dam-hopper release management is only supported on Linux with systemd.");
    std::process::ExitCode::from(1)
}
