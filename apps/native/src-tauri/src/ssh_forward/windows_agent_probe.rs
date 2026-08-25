//! Explicit Windows OpenSSH agent gate.
//!
//! Run with a generated temporary Ed25519 identity loaded into the Windows
//! OpenSSH agent. It is ignored by default so ordinary unit tests never depend
//! on a developer's agent state.

use std::ffi::OsString;

use russh::keys::agent::client::AgentClient;

#[tokio::test(flavor = "current_thread")]
#[ignore = "requires a Windows OpenSSH agent loaded with a temporary test key"]
async fn named_pipe_agent_lists_and_signs() {
    let pipe = std::env::var_os("DAM_HOPPER_SSH_AGENT_PIPE")
        .unwrap_or_else(|| OsString::from(r"\\.\pipe\openssh-ssh-agent"));
    let mut agent = AgentClient::connect_named_pipe(pipe)
        .await
        .expect("Windows OpenSSH agent named pipe must be reachable");
    let identities = agent
        .request_identities()
        .await
        .expect("agent identity request must succeed");
    let identity = identities
        .first()
        .expect("agent must contain the generated test identity");
    let signature = agent
        .sign_request(identity, None, b"dam-hopper-agent-gate".to_vec())
        .await
        .expect("agent signing must succeed");
    assert!(!signature.is_empty());
}
