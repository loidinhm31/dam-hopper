//! Command-line interface definition and argument parsing.

use super::inventory::TargetRole;
use clap::{Args, Parser, Subcommand};
use std::path::PathBuf;

/// DamHopper Linux release manager CLI.
#[derive(Debug, Parser, Clone, PartialEq, Eq)]
#[command(
    name = "dam-hopper",
    about = "DamHopper Linux release manager",
    version
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

/// Available subcommands for the release manager.
#[derive(Debug, Subcommand, Clone, PartialEq, Eq)]
pub enum Commands {
    /// Fetch immutable release assets from GitHub into a local directory.
    Fetch(FetchArgs),

    /// Install a staged release bundle for a selected or recorded host role.
    Install(InstallArgs),

    /// Manage the configured host deployment role.
    Role {
        #[command(subcommand)]
        command: RoleCommands,
    },

    /// Activate pending candidate release and start configured role units.
    Start(StartArgs),

    /// Stop running DamHopper systemd services.
    Stop(StopArgs),

    /// Query current installation, role, version, and unit status.
    Status(StatusArgs),

    /// Roll back to the previously active release version.
    Rollback(RollbackArgs),

    /// Recover active units after crash or unexpected failure.
    Recover(RecoverArgs),

    /// Validate a release manifest and optional archive bundle against contract invariants.
    Validate(ValidateArgs),

    /// Print detailed version information.
    Version,
}

/// Arguments for `fetch` subcommand.
#[derive(Debug, Args, Clone, PartialEq, Eq)]
pub struct FetchArgs {
    /// Exact release version tag to fetch (e.g. v0.2.0).
    #[arg(long, conflicts_with = "latest")]
    pub version: Option<String>,

    /// Resolve and fetch the latest stable release.
    #[arg(long, conflicts_with = "version")]
    pub latest: bool,

    /// Destination directory for downloaded release bundle.
    #[arg(long, required = true)]
    pub output: PathBuf,

    /// Optionally verify GitHub attestations using `gh` CLI if available.
    #[arg(long)]
    pub verify_attestation: bool,
}

/// Arguments for `install` subcommand.
#[derive(Debug, Args, Clone, PartialEq, Eq)]
pub struct InstallArgs {
    /// Path to the directory containing downloaded release bundle.
    #[arg(long, required = true)]
    pub bundle: PathBuf,

    /// Deployment role (server, web, both). Required for fresh install.
    #[arg(long)]
    pub role: Option<TargetRole>,

    /// Allowed web origin for CORS (may be specified multiple times).
    #[arg(long = "allow-web-origin")]
    pub allow_web_origins: Vec<String>,

    /// Optionally verify GitHub attestations using `gh` CLI if available.
    #[arg(long)]
    pub verify_attestation: bool,
    /// Dedicated system user to run dam-hopper-api (cannot be root).
    #[arg(long = "service-user", alias = "user")]
    pub service_user: Option<String>,

    /// Stop and overwrite existing active or previous release destination for rebuilds.
    #[arg(long)]
    pub reinstall: bool,
}

/// Role management commands.
#[derive(Debug, Subcommand, Clone, PartialEq, Eq)]
pub enum RoleCommands {
    /// Change host deployment role.
    Set(RoleSetArgs),
}

/// Arguments for `role set` subcommand.
#[derive(Debug, Args, Clone, PartialEq, Eq)]
pub struct RoleSetArgs {
    /// New target role to deploy.
    #[arg(value_name = "ROLE", required = true)]
    pub role: TargetRole,

    /// Path to release bundle to project for this role.
    #[arg(long, required = true)]
    pub bundle: PathBuf,

    /// Allowed web origin for CORS (may be specified multiple times).
    #[arg(long = "allow-web-origin")]
    pub allow_web_origins: Vec<String>,

    /// Optionally verify GitHub attestations using `gh` CLI if available.
    #[arg(long)]
    pub verify_attestation: bool,

    /// Dedicated system user to run dam-hopper-api (cannot be root).
    #[arg(long = "service-user", alias = "user")]
    pub service_user: Option<String>,

    /// Stop and overwrite existing active or previous release destination for rebuilds.
    #[arg(long)]
    pub reinstall: bool,
}

/// Arguments for `start` subcommand.
#[derive(Debug, Args, Clone, PartialEq, Eq, Default)]
pub struct StartArgs {
    /// Dedicated system user to run dam-hopper-api (cannot be root).
    #[arg(long = "service-user", alias = "user")]
    pub service_user: Option<String>,

    /// Fail if interactive confirmation is required in non-interactive mode.
    #[arg(long = "non-interactive")]
    pub non_interactive: bool,
}

/// Arguments for `stop` subcommand.
#[derive(Debug, Args, Clone, PartialEq, Eq, Default)]
pub struct StopArgs {
    /// Also clean active release state, symlinks, and release directory for rebuilds.
    #[arg(long)]
    pub clean: bool,
}
#[derive(Debug, Args, Clone, PartialEq, Eq, Default)]
pub struct StatusArgs {
    /// Output machine-readable JSON status.
    #[arg(long)]
    pub json: bool,
}

/// Arguments for `rollback` subcommand.
#[derive(Debug, Args, Clone, PartialEq, Eq, Default)]
pub struct RollbackArgs {}

/// Arguments for `recover` subcommand.
#[derive(Debug, Args, Clone, PartialEq, Eq, Default)]
pub struct RecoverArgs {
    /// Run boot-time reconciliation one-shot before application units start.
    #[arg(long)]
    pub boot: bool,
}

/// Arguments for `validate` subcommand.
#[derive(Debug, Args, Clone, PartialEq, Eq)]
pub struct ValidateArgs {
    /// Path to release-manifest.json to validate.
    #[arg(long, required = true)]
    pub manifest: PathBuf,

    /// Optional path to release archive tar.gz to validate against manifest inventory.
    #[arg(long)]
    pub archive: Option<PathBuf>,
}
