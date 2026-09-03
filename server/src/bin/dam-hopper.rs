//! DamHopper Linux release manager executable.

use clap::Parser;
use dam_hopper_server::linux_release::{
    acquire_release, current_euid, load_host_config, load_pending_state, stage_release_bundle,
    verify_privileges, Cli, Commands, Layout, RoleCommands,
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
        Commands::Start(_) => {
            println!("start command will activate candidate in Phase 05");
            ExitCode::SUCCESS
        }
        Commands::Status(args) => {
            let host_config = load_host_config(&layout.host_config_path()).ok().flatten();
            let pending = load_pending_state(&layout.pending_state_path())
                .ok()
                .flatten();
            if args.json {
                let status_val = serde_json::json!({
                    "hostConfig": host_config,
                    "pending": pending,
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
                println!("Pending Candidate:");
                if let Some(p) = pending {
                    println!("  Tag: {}", p.tag);
                    println!("  Role: {}", p.role);
                    println!("  Staged At: {}", p.staged_at);
                } else {
                    println!("  (none)");
                }
            }
            ExitCode::SUCCESS
        }
        Commands::Rollback(_) => {
            println!("rollback command will be available in Phase 05");
            ExitCode::SUCCESS
        }
        Commands::Recover(_) => {
            println!("recover command will be available in Phase 05");
            ExitCode::SUCCESS
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
