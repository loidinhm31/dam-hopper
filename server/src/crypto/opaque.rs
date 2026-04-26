use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use hkdf::Hkdf;
use opaque_ke::{
    CipherSuite, CredentialFinalization, CredentialRequest, RegistrationRequest,
    RegistrationUpload, ServerLogin, ServerLoginParameters, ServerRegistration, ServerSetup,
};
use rand::rngs::OsRng;
use sha2::Sha256;
use tokio::sync::RwLock;
use zeroize::Zeroizing;

// ---------------------------------------------------------------------------
// CipherSuite — must match @serenity-kit/opaque defaults (Ristretto255 + TripleDH)
// Identity KSF: no key stretching (fast, suitable for encrypt-in-transit model).
// ---------------------------------------------------------------------------

pub struct DamHopperOpaqueSuite;

impl CipherSuite for DamHopperOpaqueSuite {
    type OprfCs = opaque_ke::Ristretto255;
    type KeyExchange = opaque_ke::TripleDh<opaque_ke::Ristretto255, sha2::Sha512>;
    type Ksf = opaque_ke::ksf::Identity;
}

// ---------------------------------------------------------------------------
// Shared state types (used in AppState + per-connection handlers)
// ---------------------------------------------------------------------------

/// In-memory OPAQUE registration store: identifier → ServerRegistration.
/// Lost on server restart — acceptable for encrypt-in-transit model.
pub type OpaqueRegistrations =
    Arc<RwLock<HashMap<String, ServerRegistration<DamHopperOpaqueSuite>>>>;

// ---------------------------------------------------------------------------
// ServerSetup persistence (long-term server keypair)
// ---------------------------------------------------------------------------

fn server_setup_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from(".config"))
        .join("dam-hopper")
        .join("opaque-server-setup")
}

/// Load ServerSetup from disk or generate and persist a new one (0o600).
pub fn load_or_create_server_setup() -> anyhow::Result<ServerSetup<DamHopperOpaqueSuite>> {
    let path = server_setup_path();

    if path.exists() {
        let bytes = std::fs::read(&path)?;
        return ServerSetup::<DamHopperOpaqueSuite>::deserialize(&bytes)
            .map_err(|e| anyhow::anyhow!("Failed to deserialize OPAQUE ServerSetup: {e}"));
    }

    let mut rng = OsRng;
    let setup = ServerSetup::<DamHopperOpaqueSuite>::new(&mut rng);
    let bytes = setup.serialize();

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    write_secret_file(&path, &bytes)?;
    tracing::info!(path = %path.display(), "Generated new OPAQUE ServerSetup");
    Ok(setup)
}

#[cfg(unix)]
fn write_secret_file(path: &std::path::Path, data: &[u8]) -> anyhow::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(data)?;
    Ok(())
}

#[cfg(not(unix))]
fn write_secret_file(path: &std::path::Path, data: &[u8]) -> anyhow::Result<()> {
    std::fs::write(path, data)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Registration handlers (stateless on server side — no state between start/finish)
// ---------------------------------------------------------------------------

/// Phase 1 of registration: receive RegistrationRequest bytes, return RegistrationResponse bytes.
pub fn handle_register_start(
    setup: &ServerSetup<DamHopperOpaqueSuite>,
    identifier: &str,
    request_bytes: &[u8],
) -> Result<Vec<u8>, String> {
    let request = RegistrationRequest::<DamHopperOpaqueSuite>::deserialize(request_bytes)
        .map_err(|e| format!("invalid RegistrationRequest: {e}"))?;

    let result =
        ServerRegistration::<DamHopperOpaqueSuite>::start(setup, request, identifier.as_bytes())
            .map_err(|e| format!("register_start failed: {e}"))?;

    Ok(result.message.serialize().to_vec())
}

/// Phase 2 of registration: receive RegistrationUpload bytes, return stored credential.
/// Infallible once the upload is deserialized — if deserialization fails, returns Err.
pub fn handle_register_finish(
    upload_bytes: &[u8],
) -> Result<ServerRegistration<DamHopperOpaqueSuite>, String> {
    let upload = RegistrationUpload::<DamHopperOpaqueSuite>::deserialize(upload_bytes)
        .map_err(|e| format!("invalid RegistrationUpload: {e}"))?;

    Ok(ServerRegistration::finish(upload))
}

// ---------------------------------------------------------------------------
// Login handlers (server must store intermediate ServerLogin state)
// ---------------------------------------------------------------------------

/// Phase 1 of login: receive CredentialRequest bytes, return (login state, CredentialResponse bytes).
/// Caller stores ServerLogin in per-connection HashMap keyed by session_id.
pub fn handle_login_start(
    setup: &ServerSetup<DamHopperOpaqueSuite>,
    identifier: &str,
    registration: Option<ServerRegistration<DamHopperOpaqueSuite>>,
    request_bytes: &[u8],
) -> Result<(ServerLogin<DamHopperOpaqueSuite>, Vec<u8>), String> {
    let mut rng = OsRng;
    let request = CredentialRequest::<DamHopperOpaqueSuite>::deserialize(request_bytes)
        .map_err(|e| format!("invalid CredentialRequest: {e}"))?;

    let result = ServerLogin::<DamHopperOpaqueSuite>::start(
        &mut rng,
        setup,
        registration,
        request,
        identifier.as_bytes(),
        ServerLoginParameters::default(),
    )
    .map_err(|e| format!("login_start failed: {e}"))?;

    Ok((result.state, result.message.serialize().to_vec()))
}

/// Phase 2 of login: receive CredentialFinalization bytes, derive 32-byte AES key.
/// Returns first 32 bytes of OPAQUE session_key (same on both client and server).
pub fn handle_login_finish(
    login_state: ServerLogin<DamHopperOpaqueSuite>,
    finalization_bytes: &[u8],
) -> Result<Zeroizing<Vec<u8>>, String> {
    let finalization = CredentialFinalization::<DamHopperOpaqueSuite>::deserialize(finalization_bytes)
        .map_err(|e| format!("invalid CredentialFinalization: {e}"))?;

    let result = login_state
        .finish(finalization, ServerLoginParameters::default())
        .map_err(|e| format!("login_finish failed: {e}"))?;

    // Derive a domain-separated AES-256-GCM key from the OPAQUE session_key via HKDF.
    // session_key is shared between client and server (same PRF output on both sides).
    // HKDF domain-separates this key from any other potential session_key use.
    let key_bytes: &[u8] = result.session_key.as_ref();
    let hkdf = Hkdf::<Sha256>::new(None, key_bytes);
    let mut aes_key = Zeroizing::new(vec![0u8; 32]);
    hkdf.expand(b"dam-hopper-aes-256-gcm-v1", &mut aes_key)
        .map_err(|_| "HKDF expand failed (output length invalid)".to_string())?;
    Ok(aes_key)
}

// ---------------------------------------------------------------------------
// Identifier validation
// ---------------------------------------------------------------------------

/// Alphanumeric + hyphens + underscores, max 128 chars.
pub fn validate_identifier(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_identifier_ok() {
        assert!(validate_identifier("alice-123"));
        assert!(validate_identifier("user_abc"));
        assert!(validate_identifier("a"));
    }

    #[test]
    fn test_validate_identifier_reject() {
        assert!(!validate_identifier(""));
        assert!(!validate_identifier("a b"));
        assert!(!validate_identifier(&"x".repeat(129)));
        assert!(!validate_identifier("user/path"));
    }
}
