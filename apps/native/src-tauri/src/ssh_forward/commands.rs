//! The exact desktop-only Tauri command boundary for native forwarding.

#![allow(
    clippy::result_large_err,
    reason = "Tauri serializes the fixed redacted command error as the IPC contract."
)]

use std::sync::Arc;

use tauri::{command, State, Webview};

use super::{
    ensure_main_window,
    error::SshForwardCommandError,
    manager::SshForwardManager,
    model::{
        ActivateScopeInput, ApproveHostInput, CreateProfileInput, DeleteProfileInput,
        OpenClientInput, OpenClientResult, ProfileLifecycleInput, PurgeScopeInput,
        PurgeScopeResult, ScopeContextInput, SshForwardScopeActivation, SshForwardSnapshot,
        SshKeyInventory, UpdateProfileInput,
    },
};

fn ensure_desktop_main(webview: &Webview) -> Result<(), SshForwardCommandError> {
    ensure_main_window(webview.label())
        .map_err(|_| super::error::SshForwardErrorCode::DesktopInstanceMismatch.command_error())
}

#[command]
pub(crate) async fn ssh_forward_open_client(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: OpenClientInput,
) -> Result<OpenClientResult, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.open_client(input.known_scopes).await
}

#[command]
pub(crate) async fn ssh_forward_activate_scope(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: ActivateScopeInput,
) -> Result<SshForwardScopeActivation, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state
        .activate_scope(&input.context, input.activation_token, input.scope_id)
        .await
}

#[command]
pub(crate) async fn ssh_forward_snapshot(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: ScopeContextInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.snapshot(&input).await
}

#[command]
pub(crate) async fn ssh_forward_create_profile(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: CreateProfileInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.create_profile(&input).await
}

#[command]
pub(crate) async fn ssh_forward_update_profile(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: UpdateProfileInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.update_profile(&input).await
}

#[command]
pub(crate) async fn ssh_forward_delete_profile(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: DeleteProfileInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.delete_profile(&input).await
}

#[command]
pub(crate) async fn ssh_forward_start(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: ProfileLifecycleInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.start(&input).await
}

#[command]
pub(crate) async fn ssh_forward_stop(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: ProfileLifecycleInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.stop(&input).await
}

#[command]
pub(crate) async fn ssh_forward_restart(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: ProfileLifecycleInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.restart(&input).await
}

#[command]
pub(crate) async fn ssh_forward_list_keys(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: ScopeContextInput,
) -> Result<SshKeyInventory, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state
        .list_keys(
            &input.context,
            input.activation_token,
            &input.scope_id,
            input.scope_generation,
        )
        .await
}

#[command]
pub(crate) async fn ssh_forward_approve_host(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: ApproveHostInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.approve_host(&input).await
}

#[command]
pub(crate) async fn ssh_forward_purge_scope(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: PurgeScopeInput,
) -> Result<PurgeScopeResult, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.purge_scope(&input).await
}

#[cfg(test)]
mod tests {
    const COMMANDS: &[&str] = include!("command_names.in.rs");

    const EXPECTED_COMMANDS: &[&str] = &[
        "ssh_forward_open_client",
        "ssh_forward_activate_scope",
        "ssh_forward_snapshot",
        "ssh_forward_create_profile",
        "ssh_forward_update_profile",
        "ssh_forward_delete_profile",
        "ssh_forward_start",
        "ssh_forward_stop",
        "ssh_forward_restart",
        "ssh_forward_list_keys",
        "ssh_forward_approve_host",
        "ssh_forward_purge_scope",
    ];

    #[test]
    fn handler_surface_matches_the_canonical_command_list() {
        assert_eq!(COMMANDS, EXPECTED_COMMANDS);
    }
}
