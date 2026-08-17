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
        ActivateScopeInput, ApproveConnectionHostInput, ConnectionLifecycleInput,
        CreateConnectionInput, CreateRuleInput, DeleteConnectionInput, DeleteRuleInput,
        ForgetCredentialInput, LoadConnectionKeyInput, LoadConnectionPasswordInput,
        OpenClientInput, OpenClientResult, PurgeScopeInput, PurgeScopeResult, ScopeContextInput,
        SetRuleEnabledInput, SshForwardScopeActivation, SshForwardSnapshot, SshKeyInventory,
        UpdateConnectionInput, UpdateRuleInput,
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
pub(crate) async fn ssh_forward_create_connection(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: CreateConnectionInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.create_connection(&input).await
}

#[command]
pub(crate) async fn ssh_forward_update_connection(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: UpdateConnectionInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.update_connection(&input).await
}

#[command]
pub(crate) async fn ssh_forward_delete_connection(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: DeleteConnectionInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.delete_connection(&input).await
}

#[command]
pub(crate) async fn ssh_forward_create_rule(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: CreateRuleInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.create_rule(&input).await
}

#[command]
pub(crate) async fn ssh_forward_update_rule(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: UpdateRuleInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.update_rule(&input).await
}

#[command]
pub(crate) async fn ssh_forward_delete_rule(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: DeleteRuleInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.delete_rule(&input).await
}

#[command]
pub(crate) async fn ssh_forward_connect(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: ConnectionLifecycleInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.connect(&input).await
}

#[command]
pub(crate) async fn ssh_forward_disconnect(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: ConnectionLifecycleInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.disconnect(&input).await
}

#[command]
pub(crate) async fn ssh_forward_set_rule_enabled(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: SetRuleEnabledInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.set_rule_enabled_v2(&input).await
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
pub(crate) async fn ssh_forward_load_key(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: LoadConnectionKeyInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.load_connection_key(&input).await
}

#[command]
pub(crate) async fn ssh_forward_load_password(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: LoadConnectionPasswordInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.load_connection_password(&input).await
}

#[command]
pub(crate) async fn ssh_forward_forget_credential(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: ForgetCredentialInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.forget_credential(&input).await
}

#[command]
pub(crate) async fn ssh_forward_approve_host(
    webview: Webview,
    state: State<'_, Arc<SshForwardManager>>,
    input: ApproveConnectionHostInput,
) -> Result<SshForwardSnapshot, SshForwardCommandError> {
    ensure_desktop_main(&webview)?;
    state.approve_connection_host(&input).await
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
        "ssh_forward_create_connection",
        "ssh_forward_update_connection",
        "ssh_forward_delete_connection",
        "ssh_forward_create_rule",
        "ssh_forward_update_rule",
        "ssh_forward_delete_rule",
        "ssh_forward_connect",
        "ssh_forward_disconnect",
        "ssh_forward_set_rule_enabled",
        "ssh_forward_list_keys",
        "ssh_forward_load_key",
        "ssh_forward_load_password",
        "ssh_forward_forget_credential",
        "ssh_forward_approve_host",
        "ssh_forward_purge_scope",
    ];

    #[test]
    fn handler_surface_matches_the_canonical_command_list() {
        assert_eq!(COMMANDS, EXPECTED_COMMANDS);
    }
}
