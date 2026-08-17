//! Narrow `russh` adapter: agent auth, strict host-key callback, and direct TCP.

use std::{
    fmt,
    future::Future,
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc, Mutex as StdMutex,
    },
    time::Duration,
};

#[cfg(test)]
use std::sync::{Mutex, OnceLock};

use russh::AgentAuthError;
use russh::{
    client::{self, Handle, Handler},
    keys::{
        agent::client::{AgentClient, AgentStream},
        ssh_key::PublicKey,
        PrivateKey, PrivateKeyWithHashAlg,
    },
    Channel,
};
use tokio::{
    io::{copy_bidirectional, AsyncRead, AsyncWrite},
    net::TcpStream,
    sync::Mutex as TokioMutex,
    time::{timeout, Instant as TokioInstant},
};

use super::{
    credentials::CredentialError,
    error::SshForwardErrorCode,
    known_hosts::{inspect_trust, OfferedHostKey, SshEndpoint, TrustDecision},
    profile::SshForwardAuth,
    store::StoredTrust,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const CHANNEL_OPEN_TIMEOUT: Duration = Duration::from_secs(10);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);
// russh 0.62 closes when `alive_timeouts > keepalive_max`, so 2 yields
// closure on the third unanswered probe required by the Phase 03 contract.
const KEEPALIVE_MAX: usize = 2;
const SESSION_OPEN: u8 = 0;
const SESSION_CLOSING: u8 = 1;
const SESSION_CLOSED: u8 = 2;

#[cfg(test)]
pub(crate) const TEST_PRIVATE_KEY_ID: &str = "phase04-test-key";

#[cfg(test)]
static TEST_PRIVATE_KEY: OnceLock<Mutex<Option<Vec<u8>>>> = OnceLock::new();

#[cfg(test)]
pub(crate) fn install_test_private_key(bytes: Vec<u8>) {
    *TEST_PRIVATE_KEY
        .get_or_init(|| Mutex::new(None))
        .lock()
        .expect("test private key mutex poisoned") = Some(bytes);
}

#[cfg(test)]
fn test_private_key() -> Option<Vec<u8>> {
    TEST_PRIVATE_KEY
        .get_or_init(|| Mutex::new(None))
        .lock()
        .expect("test private key mutex poisoned")
        .clone()
}

pub(crate) const MAX_CHANNELS: usize = 64;

type DynamicAgent = AgentClient<Box<dyn AgentStream + Send + Unpin + 'static>>;

#[derive(Debug)]
pub(crate) enum SshTransportError {
    HostKeyRejected(OfferedHostKey),
    HostKeyChanged(OfferedHostKey),
    HostKeyAlgorithmChanged(OfferedHostKey),
    HostKeyAlgorithmUnsupported(OfferedHostKey),
    ConnectTimeout,
    Connect,
    Authentication,
    Credential(SshForwardErrorCode),
    Agent(CredentialError),
    ChannelOpen,
    ChannelOpenTimeout,
    TargetNotAllowed,
    SessionClosed,
    ShutdownTimeout,
    Russh(russh::Error),
}

impl fmt::Display for SshTransportError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::HostKeyRejected(_) => "host_key_rejected",
            Self::HostKeyChanged(_) => "host_key_changed",
            Self::HostKeyAlgorithmChanged(_) => "host_key_algorithm_changed",
            Self::HostKeyAlgorithmUnsupported(_) => "host_key_algorithm_unsupported",
            Self::ConnectTimeout => "ssh_connect_timeout",
            Self::Connect => "ssh_connect_failed",
            Self::Authentication => "auth_failed",
            Self::Credential(_) => "credential_error",
            Self::Agent(error) => return write!(formatter, "{error}"),
            Self::ChannelOpen => "channel_open_failed",
            Self::ChannelOpenTimeout => "channel_open_timeout",
            Self::TargetNotAllowed => "target_not_allowed",
            Self::SessionClosed => "session_closed",
            Self::ShutdownTimeout => "shutdown_timeout",
            Self::Russh(_) => "russh_error",
        })
    }
}

impl From<russh::Error> for SshTransportError {
    fn from(error: russh::Error) -> Self {
        Self::Russh(error)
    }
}

impl From<AgentAuthError> for SshTransportError {
    fn from(_: AgentAuthError) -> Self {
        Self::Authentication
    }
}

impl SshTransportError {
    pub(crate) fn is_terminal_auth(&self) -> bool {
        match self {
            Self::Authentication | Self::Agent(_) => true,
            Self::Credential(code) => matches!(
                code,
                SshForwardErrorCode::AuthFailed
                    | SshForwardErrorCode::AuthRequired
                    | SshForwardErrorCode::CredentialExpired
                    | SshForwardErrorCode::CredentialRejected
                    | SshForwardErrorCode::CredentialDeleteFailed
                    | SshForwardErrorCode::CredentialNotSaved
                    | SshForwardErrorCode::CredentialVaultCorrupt
                    | SshForwardErrorCode::KeyNotFound
                    | SshForwardErrorCode::KeyUnsafe
                    | SshForwardErrorCode::KeyEncryptedUseAgent
                    | SshForwardErrorCode::KeyPassphraseInvalid
                    | SshForwardErrorCode::AgentUnavailable
            ),
            _ => false,
        }
    }

    pub(crate) fn error_code(&self) -> SshForwardErrorCode {
        match self {
            Self::HostKeyRejected(_) => SshForwardErrorCode::HostKeyApprovalRequired,
            Self::HostKeyChanged(_) => SshForwardErrorCode::HostKeyChanged,
            Self::HostKeyAlgorithmChanged(_) => SshForwardErrorCode::HostKeyAlgorithmChanged,
            Self::HostKeyAlgorithmUnsupported(_) => {
                SshForwardErrorCode::HostKeyAlgorithmUnsupported
            }
            Self::ConnectTimeout => SshForwardErrorCode::SshConnectTimeout,
            Self::Connect | Self::Russh(_) => SshForwardErrorCode::SshConnectFailed,
            Self::Authentication => SshForwardErrorCode::AuthFailed,
            Self::Credential(code) => *code,
            Self::Agent(CredentialError::AgentUnavailable) => SshForwardErrorCode::AgentUnavailable,
            Self::Agent(CredentialError::KeyNotFound) => SshForwardErrorCode::KeyNotFound,
            Self::Agent(CredentialError::KeyUnsafe) => SshForwardErrorCode::KeyUnsafe,
            Self::Agent(CredentialError::KeyEncrypted) => SshForwardErrorCode::KeyEncryptedUseAgent,
            Self::Agent(CredentialError::InvalidPassphrase) => {
                SshForwardErrorCode::KeyPassphraseInvalid
            }
            Self::Agent(CredentialError::InvalidInventory) => SshForwardErrorCode::KeyUnsafe,
            Self::ChannelOpen => SshForwardErrorCode::TargetConnectFailed,
            Self::ChannelOpenTimeout => SshForwardErrorCode::ChannelOpenTimeout,
            Self::TargetNotAllowed => SshForwardErrorCode::TargetNotAllowed,
            Self::SessionClosed => SshForwardErrorCode::ConnectionNotEstablished,
            Self::ShutdownTimeout => SshForwardErrorCode::ShutdownTimeout,
        }
    }
}

#[derive(Clone)]
struct RusshHandler {
    endpoint: SshEndpoint,
    trust: StoredTrust,
    accepted_host_key: Arc<StdMutex<Option<OfferedHostKey>>>,
}

impl Handler for RusshHandler {
    type Error = SshTransportError;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let offered = OfferedHostKey::from_russh(server_public_key)
            .map_err(|_| SshTransportError::Connect)?;
        match inspect_trust(&self.trust, &self.endpoint, &offered) {
            TrustDecision::Trusted => {
                *self
                    .accepted_host_key
                    .lock()
                    .map_err(|_| SshTransportError::Connect)? = Some(offered);
                Ok(true)
            }
            TrustDecision::Unknown => Err(SshTransportError::HostKeyRejected(offered)),
            TrustDecision::ChangedKey => Err(SshTransportError::HostKeyChanged(offered)),
            TrustDecision::ChangedAlgorithm => {
                Err(SshTransportError::HostKeyAlgorithmChanged(offered))
            }
            TrustDecision::UnsupportedAlgorithm => {
                Err(SshTransportError::HostKeyAlgorithmUnsupported(offered))
            }
        }
    }
}

pub(crate) struct SshTransport {
    handle: Handle<RusshHandler>,
    accepted_host_key: Arc<StdMutex<Option<OfferedHostKey>>>,
}

impl SshTransport {
    pub(crate) fn handshake_deadline() -> TokioInstant {
        TokioInstant::now() + CONNECT_TIMEOUT
    }

    /// Establishes the SSH transport only. `russh` invokes the host-key
    /// callback during this operation, before the returned handle can auth.
    pub(crate) async fn connect(
        endpoint: &SshEndpoint,
        trust: &StoredTrust,
    ) -> Result<Self, SshTransportError> {
        Self::connect_until(endpoint, trust, Self::handshake_deadline()).await
    }

    pub(crate) async fn connect_until(
        endpoint: &SshEndpoint,
        trust: &StoredTrust,
        deadline: TokioInstant,
    ) -> Result<Self, SshTransportError> {
        let accepted_host_key = Arc::new(StdMutex::new(None));
        let handler = RusshHandler {
            endpoint: endpoint.clone(),
            trust: trust.clone(),
            accepted_host_key: Arc::clone(&accepted_host_key),
        };
        let config = client::Config {
            keepalive_interval: Some(KEEPALIVE_INTERVAL),
            keepalive_max: KEEPALIVE_MAX,
            ..Default::default()
        };
        with_deadline_at(deadline, async {
            let handle = client::connect(
                Arc::new(config),
                (endpoint.host.as_str(), endpoint.port),
                handler,
            )
            .await?;
            Ok(Self {
                handle,
                accepted_host_key,
            })
        })
        .await
    }

    pub(crate) async fn authenticate(
        self,
        user: &str,
        auth: &SshForwardAuth,
        fallback_key: Option<Arc<PrivateKey>>,
        password: Option<(&str, &str)>,
        key_passphrase: Option<&str>,
    ) -> Result<SshSession, SshTransportError> {
        self.authenticate_until(
            user,
            auth,
            fallback_key,
            password,
            key_passphrase,
            Self::handshake_deadline(),
        )
        .await
    }

    pub(crate) async fn authenticate_until(
        self,
        user: &str,
        auth: &SshForwardAuth,
        fallback_key: Option<Arc<PrivateKey>>,
        password: Option<(&str, &str)>,
        key_passphrase: Option<&str>,
        deadline: TokioInstant,
    ) -> Result<SshSession, SshTransportError> {
        with_deadline_at(
            deadline,
            self.authenticate_inner(user, auth, fallback_key, password, key_passphrase),
        )
        .await
    }

    async fn authenticate_inner(
        mut self,
        user: &str,
        auth: &SshForwardAuth,
        fallback_key: Option<Arc<PrivateKey>>,
        password: Option<(&str, &str)>,
        key_passphrase: Option<&str>,
    ) -> Result<SshSession, SshTransportError> {
        if let Some((password_user, password)) = password {
            let result = self
                .handle
                .authenticate_password(password_user, password)
                .await?;
            if !result.success() {
                return Err(SshTransportError::Authentication);
            }
        } else {
            match auth {
                SshForwardAuth::Agent => {
                    let mut authenticated = false;
                    let mut agent_failure = None;
                    if let Ok(mut agent) = connect_agent().await {
                        match agent.request_identities().await {
                            Ok(identities) => {
                                if identities.is_empty() {
                                    agent_failure = Some(CredentialError::AgentUnavailable);
                                }
                                for identity in identities
                                    .into_iter()
                                    .filter(|identity| {
                                        crate::ssh_forward::known_hosts::is_supported_algorithm(
                                            identity.public_key().algorithm().as_ref(),
                                        )
                                    })
                                    .take(crate::ssh_forward::credentials::max_agent_identities())
                                {
                                    let public_key = identity.public_key().into_owned();
                                    if let Ok(result) = self
                                        .handle
                                        .authenticate_publickey_with(
                                            user, public_key, None, &mut agent,
                                        )
                                        .await
                                    {
                                        if result.success() {
                                            authenticated = true;
                                            break;
                                        }
                                    }
                                }
                            }
                            Err(_) => {
                                agent_failure = Some(CredentialError::AgentUnavailable);
                            }
                        }
                    } else {
                        agent_failure = Some(CredentialError::AgentUnavailable);
                    }
                    if !authenticated {
                        if let Some(key) = fallback_key {
                            let result = self
                                .handle
                                .authenticate_publickey(user, PrivateKeyWithHashAlg::new(key, None))
                                .await?;
                            if result.success() {
                                authenticated = true;
                            }
                        } else if let Some(error) = agent_failure {
                            return Err(SshTransportError::Agent(error));
                        }
                    }
                    if !authenticated {
                        return Err(SshTransportError::Authentication);
                    }
                }
                SshForwardAuth::Key { key_id } => {
                    let key = if let Some(key) = fallback_key {
                        key
                    } else {
                        #[cfg(test)]
                        let key = if key_id == TEST_PRIVATE_KEY_ID {
                            let bytes = test_private_key()
                                .ok_or(SshTransportError::Agent(CredentialError::KeyNotFound))?;
                            PrivateKey::from_openssh(&bytes)
                                .map_err(|_| SshTransportError::Agent(CredentialError::KeyUnsafe))?
                        } else {
                            crate::ssh_forward::credentials::load_safe_key(key_id, key_passphrase)
                                .map(|loaded| loaded.key)
                                .map_err(SshTransportError::Agent)?
                        };
                        #[cfg(not(test))]
                        let key =
                            crate::ssh_forward::credentials::load_safe_key(key_id, key_passphrase)
                                .map(|loaded| loaded.key)
                                .map_err(SshTransportError::Agent)?;
                        Arc::new(key)
                    };
                    if key.is_encrypted() {
                        return Err(SshTransportError::Agent(CredentialError::KeyEncrypted));
                    }
                    let result = self
                        .handle
                        .authenticate_publickey(user, PrivateKeyWithHashAlg::new(key, None))
                        .await?;
                    if !result.success() {
                        return Err(SshTransportError::Authentication);
                    }
                }
            }
        }
        Ok(SshSession {
            handle: self.handle,
            accepted_host_key: self.accepted_host_key,
            state: AtomicU8::new(SESSION_OPEN),
            close_gate: TokioMutex::new(()),
        })
    }
}

pub(crate) struct SshSession {
    handle: Handle<RusshHandler>,
    accepted_host_key: Arc<StdMutex<Option<OfferedHostKey>>>,
    state: AtomicU8,
    close_gate: TokioMutex<()>,
}

impl SshSession {
    pub(crate) async fn connect(
        endpoint: &SshEndpoint,
        user: &str,
        auth: &SshForwardAuth,
        trust: &StoredTrust,
        fallback_key: Option<Arc<PrivateKey>>,
        password: Option<(&str, &str)>,
    ) -> Result<Self, SshTransportError> {
        let deadline = SshTransport::handshake_deadline();
        SshTransport::connect_until(endpoint, trust, deadline)
            .await?
            .authenticate_until(user, auth, fallback_key, password, None, deadline)
            .await
    }

    pub(crate) async fn open_direct_tcpip(
        &self,
        target_host: &str,
        target_port: u16,
        local_port: u16,
    ) -> Result<Channel<client::Msg>, SshTransportError> {
        if self.state.load(Ordering::Acquire) != SESSION_OPEN {
            return Err(SshTransportError::SessionClosed);
        }
        if target_host != "127.0.0.1" || target_port == 0 || local_port == 0 {
            return Err(SshTransportError::TargetNotAllowed);
        }
        timeout(
            CHANNEL_OPEN_TIMEOUT,
            self.handle.channel_open_direct_tcpip(
                target_host,
                u32::from(target_port),
                "127.0.0.1",
                u32::from(local_port),
            ),
        )
        .await
        .map_err(|_| SshTransportError::ChannelOpenTimeout)?
        .map_err(|_| SshTransportError::ChannelOpen)
    }

    pub(crate) async fn send_keepalive(&self) -> Result<(), SshTransportError> {
        if self.state.load(Ordering::Acquire) != SESSION_OPEN {
            return Err(SshTransportError::SessionClosed);
        }
        self.handle.send_keepalive(true).await.map_err(Into::into)
    }

    /// Close through a shared reference so children can hold `Arc<SshSession>`.
    /// The async gate makes parent shutdown idempotent while allowing a later
    /// caller to retry if russh reports a failed disconnect.
    pub(crate) async fn close(&self) -> Result<(), SshTransportError> {
        let _close_gate = self.close_gate.lock().await;
        if self.state.load(Ordering::Acquire) == SESSION_CLOSED {
            return Ok(());
        }
        self.state.store(SESSION_CLOSING, Ordering::Release);
        let result = timeout(
            SHUTDOWN_TIMEOUT,
            self.handle
                .disconnect(russh::Disconnect::ByApplication, "closing", ""),
        )
        .await
        .map_err(|_| SshTransportError::ShutdownTimeout)?
        .map_err(Into::into);
        self.state.store(
            if result.is_ok() {
                SESSION_CLOSED
            } else {
                SESSION_OPEN
            },
            Ordering::Release,
        );
        result
    }

    pub(crate) fn verified_host_key(&self) -> Option<OfferedHostKey> {
        self.accepted_host_key
            .lock()
            .ok()
            .and_then(|key| key.clone())
    }
}

#[derive(Clone, Default)]
pub(crate) struct ChannelLimiter {
    active: Arc<std::sync::atomic::AtomicUsize>,
}

impl ChannelLimiter {
    pub(crate) fn try_acquire(&self) -> Option<ChannelPermit> {
        let mut current = self.active.load(std::sync::atomic::Ordering::Relaxed);
        loop {
            if current >= MAX_CHANNELS {
                return None;
            }
            match self.active.compare_exchange_weak(
                current,
                current + 1,
                std::sync::atomic::Ordering::AcqRel,
                std::sync::atomic::Ordering::Relaxed,
            ) {
                Ok(_) => {
                    return Some(ChannelPermit {
                        active: Arc::clone(&self.active),
                    })
                }
                Err(next) => current = next,
            }
        }
    }

    pub(crate) fn active(&self) -> usize {
        self.active.load(std::sync::atomic::Ordering::Acquire)
    }
}

pub(crate) struct ChannelPermit {
    active: Arc<std::sync::atomic::AtomicUsize>,
}

impl Drop for ChannelPermit {
    fn drop(&mut self) {
        self.active
            .fetch_sub(1, std::sync::atomic::Ordering::AcqRel);
    }
}

pub(crate) async fn forward_socket(
    mut local: TcpStream,
    channel: Channel<client::Msg>,
    _permit: ChannelPermit,
) -> Result<(), SshTransportError> {
    let mut remote = channel.into_stream();
    copy_bidirectional(&mut local, &mut remote)
        .await
        .map(|_| ())
        .map_err(|_| SshTransportError::ChannelOpen)
}

async fn with_deadline<F, T>(deadline: Duration, future: F) -> Result<T, SshTransportError>
where
    F: Future<Output = Result<T, SshTransportError>>,
{
    timeout(deadline, future)
        .await
        .map_err(|_| SshTransportError::ConnectTimeout)?
}

async fn with_deadline_at<F, T>(deadline: TokioInstant, future: F) -> Result<T, SshTransportError>
where
    F: Future<Output = Result<T, SshTransportError>>,
{
    timeout(
        deadline.saturating_duration_since(TokioInstant::now()),
        future,
    )
    .await
    .map_err(|_| SshTransportError::ConnectTimeout)?
}

async fn connect_agent() -> Result<DynamicAgent, CredentialError> {
    let agent = AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent")
        .await
        .map_err(|_| CredentialError::AgentUnavailable)?;
    Ok(agent.dynamic())
}

#[allow(dead_code)]
fn _stream_bounds<T: AsyncRead + AsyncWrite + Unpin + Send + 'static>(_: T) {}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{with_deadline, ChannelLimiter, SshTransportError, MAX_CHANNELS};
    use crate::ssh_forward::error::SshForwardErrorCode;

    #[test]
    fn channel_limit_is_strict_and_released_on_drop() {
        let limiter = ChannelLimiter::default();
        let permits = (0..MAX_CHANNELS)
            .map(|_| limiter.try_acquire().unwrap())
            .collect::<Vec<_>>();
        assert!(limiter.try_acquire().is_none());
        drop(permits);
        assert_eq!(limiter.active(), 0);
        assert!(limiter.try_acquire().is_some());
    }

    #[tokio::test]
    async fn connect_and_auth_share_one_deadline() {
        let started = Instant::now();
        let result = with_deadline(Duration::from_millis(20), async {
            tokio::time::sleep(Duration::from_millis(30)).await;
            tokio::time::sleep(Duration::from_millis(30)).await;
            Ok::<(), SshTransportError>(())
        })
        .await;

        assert!(matches!(result, Err(SshTransportError::ConnectTimeout)));
        assert!(started.elapsed() < Duration::from_millis(100));
    }

    #[test]
    fn authentication_failures_do_not_enter_transport_retry() {
        assert!(SshTransportError::Authentication.is_terminal_auth());
        assert!(SshTransportError::Agent(
            crate::ssh_forward::credentials::CredentialError::InvalidPassphrase
        )
        .is_terminal_auth());
        assert!(
            SshTransportError::Credential(SshForwardErrorCode::CredentialExpired)
                .is_terminal_auth()
        );
        assert!(
            !SshTransportError::Credential(SshForwardErrorCode::CredentialVaultUnavailable)
                .is_terminal_auth()
        );
    }
}
