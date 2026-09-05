//! DamHopper Linux release manager executable.

use clap::Parser;
use dam_hopper_server::linux_release::{
    ALL_SERVICE_UNITS, Cli, Commands, HostConfig, Layout, RoleCommands, acquire_release,
    current_euid, execute_activation_with_args, execute_manual_rollback, execute_recovery,
    load_host_config, load_or_init_manager_state, save_host_config, stage_release_bundle,
    verify_api_service_account, verify_privileges,
};
use std::process::ExitCode;

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
            if let Some(user) = &args.service_user {
                if let Err(e) = verify_api_service_account(user) {
                    eprintln!("invalid service user: {e}");
                    return ExitCode::from(1);
                }
                let mut host_cfg = load_host_config(&layout.host_config_path())
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| {
                        HostConfig::new(
                            args.role
                                .unwrap_or(dam_hopper_server::linux_release::TargetRole::Both),
                            args.allow_web_origins.clone(),
                        )
                        .unwrap()
                    });
                host_cfg.service_user = Some(user.clone());
                let _ = save_host_config(&layout.host_config_path(), &host_cfg);
            }
            println!(
                "Installing release bundle from '{}'...",
                args.bundle.display()
            );
            match stage_release_bundle(
                &layout,
                &args.bundle,
                args.role,
                &args.allow_web_origins,
                args.verify_attestation,
                false,
                args.reinstall,
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
                if let Some(user) = &args.service_user {
                    if let Err(e) = verify_api_service_account(user) {
                        eprintln!("invalid service user: {e}");
                        return ExitCode::from(1);
                    }
                    let mut host_cfg = load_host_config(&layout.host_config_path())
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| {
                            HostConfig::new(args.role, args.allow_web_origins.clone()).unwrap()
                        });
                    host_cfg.service_user = Some(user.clone());
                    let _ = save_host_config(&layout.host_config_path(), &host_cfg);
                }
                println!(
                    "Switching deployment role to '{}' using bundle '{}'...",
                    args.role,
                    args.bundle.display()
                );
                match stage_release_bundle(
                    &layout,
                    &args.bundle,
                    Some(args.role),
                    &args.allow_web_origins,
                    args.verify_attestation,
                    true,
                    args.reinstall,
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
            if args.json {
                let status_val = serde_json::json!({
                    "hostConfig": host_config,
                    "state": mgr_state,
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
                if let Some(ref active) = mgr_state.active {
                    println!("  Tag: {}", active.tag);
                    println!("  Role: {}", active.role);
                    println!("  Committed At: {}", active.committed_at);
                } else {
                    println!("  (none)");
                }
                println!("Previous Release:");
                if let Some(ref previous) = mgr_state.previous {
                    println!("  Tag: {}", previous.tag);
                    println!("  Role: {}", previous.role);
                } else {
                    println!("  (none)");
                }
                println!("Pending Candidate:");
                if let Some(ref candidate) = mgr_state.pending {
                    println!("  Tag: {}", candidate.tag);
                    println!("  Role: {}", candidate.role);
                    println!("  Staged At: {}", candidate.staged_at);
                } else {
                    println!("  (none)");
                }
                if let Some(ref failure) = mgr_state.latest_failure {
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
                dam_hopper_server::linux_release::SCHEMA_VERSION
            );
            ExitCode::SUCCESS
        }
    }
}
