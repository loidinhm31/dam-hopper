//! Tests for release manager CLI grammar, argument validation, and privilege enforcement.

use clap::Parser;
use dam_hopper_server::linux_release::*;
use std::path::PathBuf;

#[test]
fn test_cli_fetch_version_success() {
    let args = [
        "dam-hopper",
        "fetch",
        "--version",
        "v0.2.0",
        "--output",
        "/tmp/out",
    ];
    let cli = Cli::try_parse_from(args).expect("valid fetch command");
    match cli.command {
        Commands::Fetch(fetch) => {
            assert_eq!(fetch.version, Some("v0.2.0".to_string()));
            assert!(!fetch.latest);
            assert_eq!(fetch.output, PathBuf::from("/tmp/out"));
            assert!(!fetch.verify_attestation);
        }
        _ => panic!("expected Fetch command"),
    }
}

#[test]
fn test_cli_fetch_latest_success() {
    let args = [
        "dam-hopper",
        "fetch",
        "--latest",
        "--output",
        "/tmp/out",
        "--verify-attestation",
    ];
    let cli = Cli::try_parse_from(args).expect("valid fetch latest command");
    match cli.command {
        Commands::Fetch(fetch) => {
            assert_eq!(fetch.version, None);
            assert!(fetch.latest);
            assert_eq!(fetch.output, PathBuf::from("/tmp/out"));
            assert!(fetch.verify_attestation);
        }
        _ => panic!("expected Fetch command"),
    }
}

#[test]
fn test_cli_fetch_version_and_latest_conflict() {
    let args = [
        "dam-hopper",
        "fetch",
        "--version",
        "v0.2.0",
        "--latest",
        "--output",
        "/tmp/out",
    ];
    let err = Cli::try_parse_from(args).expect_err("mutually exclusive flags must fail");
    assert!(err.to_string().contains("cannot be used with"));
}
#[test]
fn test_cli_install_grammar() {
    let args = [
        "dam-hopper",
        "install",
        "--bundle",
        "/tmp/bundle",
        "--role",
        "both",
        "--allow-web-origin",
        "http://localhost:4802",
        "--allow-web-origin",
        "https://app.example.com",
    ];
    let cli = Cli::try_parse_from(args).expect("valid install command");
    match cli.command {
        Commands::Install(install) => {
            assert_eq!(install.bundle, PathBuf::from("/tmp/bundle"));
            assert_eq!(install.role, Some(TargetRole::Both));
            assert_eq!(
                install.allow_web_origins,
                vec!["http://localhost:4802", "https://app.example.com"]
            );
            assert!(!install.verify_attestation);
        }
        _ => panic!("expected Install command"),
    }
}

#[test]
fn test_cli_role_set_grammar() {
    let args = [
        "dam-hopper",
        "role",
        "set",
        "web",
        "--bundle",
        "/tmp/bundle",
        "--allow-web-origin",
        "http://localhost:4802",
    ];
    let cli = Cli::try_parse_from(args).expect("valid role set command");
    match cli.command {
        Commands::Role {
            command: RoleCommands::Set(role_set),
        } => {
            assert_eq!(role_set.role, TargetRole::Web);
            assert_eq!(role_set.bundle, PathBuf::from("/tmp/bundle"));
            assert_eq!(role_set.allow_web_origins, vec!["http://localhost:4802"]);
        }
        _ => panic!("expected Role Set command"),
    }
}

#[test]
fn test_cli_start_status_rollback_grammar() {
    let cli = Cli::try_parse_from(["dam-hopper", "start"]).expect("start command");
    assert!(matches!(cli.command, Commands::Start(_)));

    let cli = Cli::try_parse_from(["dam-hopper", "status", "--json"]).expect("status command");
    match cli.command {
        Commands::Status(status) => assert!(status.json),
        _ => panic!("expected Status command"),
    }

    let cli = Cli::try_parse_from(["dam-hopper", "rollback"]).expect("rollback command");
    assert!(matches!(cli.command, Commands::Rollback(_)));

    let cli = Cli::try_parse_from(["dam-hopper", "recover"]).expect("recover command");
    assert!(matches!(cli.command, Commands::Recover(_)));

    let cli = Cli::try_parse_from(["dam-hopper", "version"]).expect("version command");
    assert!(matches!(cli.command, Commands::Version));
}

#[test]
fn test_privilege_enforcement_matrix() {
    let fetch_cmd = Commands::Fetch(FetchArgs {
        version: Some("v0.2.0".to_string()),
        latest: false,
        output: PathBuf::from("/tmp"),
        verify_attestation: false,
    });
    // fetch must NOT run as root (EUID 0)
    assert!(matches!(
        verify_privileges(&fetch_cmd, 0),
        Err(ReleaseError::UserPrivilegeRequired { .. })
    ));
    // fetch CAN run as unprivileged user (EUID 1000)
    assert!(verify_privileges(&fetch_cmd, 1000).is_ok());

    let install_cmd = Commands::Install(InstallArgs {
        bundle: PathBuf::from("/tmp"),
        role: Some(TargetRole::Both),
        allow_web_origins: vec![],
        verify_attestation: false,
    });
    // install must run as root
    assert!(matches!(
        verify_privileges(&install_cmd, 1000),
        Err(ReleaseError::PrivilegeRequired {
            operation: "install",
            expected_euid: 0,
            actual_euid: 1000
        })
    ));
    assert!(verify_privileges(&install_cmd, 0).is_ok());

    let role_set_cmd = Commands::Role {
        command: RoleCommands::Set(RoleSetArgs {
            role: TargetRole::Server,
            bundle: PathBuf::from("/tmp"),
            allow_web_origins: vec![],
            verify_attestation: false,
        }),
    };
    assert!(verify_privileges(&role_set_cmd, 1000).is_err());
    assert!(verify_privileges(&role_set_cmd, 0).is_ok());

    let start_cmd = Commands::Start(Default::default());
    assert!(verify_privileges(&start_cmd, 1000).is_err());
    assert!(verify_privileges(&start_cmd, 0).is_ok());

    let rollback_cmd = Commands::Rollback(Default::default());
    assert!(verify_privileges(&rollback_cmd, 1000).is_err());
    assert!(verify_privileges(&rollback_cmd, 0).is_ok());

    let status_cmd = Commands::Status(Default::default());
    assert!(verify_privileges(&status_cmd, 1000).is_ok());
    assert!(verify_privileges(&status_cmd, 0).is_ok());

    let version_cmd = Commands::Version;
    assert!(verify_privileges(&version_cmd, 1000).is_ok());
    assert!(verify_privileges(&version_cmd, 0).is_ok());
}
