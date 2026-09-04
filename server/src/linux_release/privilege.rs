//! Process privilege validation and EUID checks for release commands.

use super::cli::Commands;
use super::error::ReleaseError;

/// Query current effective user ID (EUID).
pub fn current_euid() -> u32 {
    unsafe { libc::geteuid() }
}

/// Verify privilege requirements for a given command.
///
/// - `fetch` must run as unprivileged user (EUID != 0).
/// - `install`, `role set`, `start`, `rollback`, `recover` must run as root (EUID == 0).
/// - `status` and `version` can run under any privilege.
pub fn verify_privileges(command: &Commands, euid: u32) -> Result<(), ReleaseError> {
    match command {
        Commands::Fetch(_) => {
            if euid == 0 {
                return Err(ReleaseError::UserPrivilegeRequired {
                    operation: "fetch",
                    actual_euid: euid,
                });
            }
        }
        Commands::Install(_) => {
            if euid != 0 {
                return Err(ReleaseError::PrivilegeRequired {
                    operation: "install",
                    expected_euid: 0,
                    actual_euid: euid,
                });
            }
        }
        Commands::Role { .. } => {
            if euid != 0 {
                return Err(ReleaseError::PrivilegeRequired {
                    operation: "role set",
                    expected_euid: 0,
                    actual_euid: euid,
                });
            }
        }
        Commands::Start(_) => {
            if euid != 0 {
                return Err(ReleaseError::PrivilegeRequired {
                    operation: "start",
                    expected_euid: 0,
                    actual_euid: euid,
                });
            }
        }
        Commands::Stop(_) => {
            if euid != 0 {
                return Err(ReleaseError::PrivilegeRequired {
                    operation: "stop",
                    expected_euid: 0,
                    actual_euid: euid,
                });
            }
        }
        Commands::Rollback(_) => {
            if euid != 0 {
                return Err(ReleaseError::PrivilegeRequired {
                    operation: "rollback",
                    expected_euid: 0,
                    actual_euid: euid,
                });
            }
        }
        Commands::Recover(_) => {
            if euid != 0 {
                return Err(ReleaseError::PrivilegeRequired {
                    operation: "recover",
                    expected_euid: 0,
                    actual_euid: euid,
                });
            }
        }
        Commands::Status(_) | Commands::Version | Commands::Validate(_) => {}
    }
    Ok(())
}
