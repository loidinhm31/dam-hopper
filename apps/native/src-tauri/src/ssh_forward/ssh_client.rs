//! Narrow `russh` adapter: agent auth, strict host-key callback, and direct TCP.

use std::{fmt, future::Future, sync::Arc, time::Duration};

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
    time::timeout,
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
    Agent(CredentialError),
    ChannelOpen,
    ChannelOpenTimeout,
    TargetNotAllowed,
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
            Self::Agent(error) => return write!(formatter, "{error}"),
            Self::ChannelOpen => "channel_open_failed",
            Self::ChannelOpenTimeout => "channel_open_timeout",
            Self::TargetNotAllowed => "target_not_allowed",
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
            Self::Agent(CredentialError::AgentUnavailable) => SshForwardErrorCode::AgentUnavailable,
            Self::Agent(CredentialError::KeyNotFound) => SshForwardErrorCode::KeyNotFound,
            Self::Agent(CredentialError::KeyUnsafe) => SshForwardErrorCode::KeyUnsafe,
            Self::Agent(CredentialError::KeyEncrypted) => SshForwardErrorCode::KeyEncryptedUseAgent,
            Self::Agent(CredentialError::InvalidInventory) => SshForwardErrorCode::KeyUnsafe,
            Self::ChannelOpen => SshForwardErrorCode::TargetConnectFailed,
            Self::ChannelOpenTimeout => SshForwardErrorCode::ChannelOpenTimeout,
            Self::TargetNotAllowed => SshForwardErrorCode::TargetNotAllowed,
            Self::ShutdownTimeout => SshForwardErrorCode::ShutdownTimeout,
        }
    }
}

#[derive(Clone)]
struct RusshHandler {
    endpoint: SshEndpoint,
    trust: StoredTrust,
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
            TrustDecision::Trusted => Ok(true),
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

pub(crate) struct SshSession {
    handle: Handle<RusshHandler>,
}

impl SshSession {
    pub(crate) async fn connect(
        endpoint: &SshEndpoint,
        user: &str,
        auth: &SshForwardAuth,
        trust: &StoredTrust,
    ) -> Result<Self, SshTransportError> {
        let handler = RusshHandler {
            endpoint: endpoint.clone(),
            trust: trust.clone(),
        };
        let config = client::Config {
            keepalive_interval: Some(KEEPALIVE_INTERVAL),
            keepalive_max: KEEPALIVE_MAX,
            ..Default::default()
        };
        let session = with_deadline(CONNECT_TIMEOUT, async {
            let mut handle = client::connect(
                Arc::new(config),
                (endpoint.host.as_str(), endpoint.port),
                handler,
            )
            .await?;
            match auth {
                SshForwardAuth::Agent => {
                    let mut agent = connect_agent().await.map_err(SshTransportError::Agent)?;
                    let identities = agent
                        .request_identities()
                        .await
                        .map_err(|_| SshTransportError::Agent(CredentialError::AgentUnavailable))?;
                    if identities.is_empty() {
                        return Err(SshTransportError::Agent(CredentialError::AgentUnavailable));
                    }
                    let mut authenticated = false;
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
                        let result = handle
                            .authenticate_publickey_with(user, public_key, None, &mut agent)
                            .await?;
                        if result.success() {
                            authenticated = true;
                            break;
                        }
                    }
                    if !authenticated {
                        return Err(SshTransportError::Authentication);
                    }
                }
                SshForwardAuth::Key { key_id } => {
                    #[cfg(test)]
                    let bytes = if key_id == TEST_PRIVATE_KEY_ID {
                        test_private_key()
                            .ok_or(SshTransportError::Agent(CredentialError::KeyNotFound))?
                    } else {
                        crate::ssh_forward::credentials::load_safe_key(key_id)
                            .map_err(SshTransportError::Agent)?
                    };
                    #[cfg(not(test))]
                    let bytes = crate::ssh_forward::credentials::load_safe_key(key_id)
                        .map_err(SshTransportError::Agent)?;
                    let key = PrivateKey::from_openssh(&bytes)
                        .map_err(|_| SshTransportError::Agent(CredentialError::KeyUnsafe))?;
                    if key.is_encrypted() {
                        return Err(SshTransportError::Agent(CredentialError::KeyEncrypted));
                    }
                    let result = handle
                        .authenticate_publickey(
                            user,
                            PrivateKeyWithHashAlg::new(Arc::new(key), None),
                        )
                        .await?;
                    if !result.success() {
                        return Err(SshTransportError::Authentication);
                    }
                }
            }
            Ok::<Self, SshTransportError>(Self { handle })
        })
        .await?;
        Ok(session)
    }

    pub(crate) async fn open_direct_tcpip(
        &self,
        target_host: &str,
        target_port: u16,
        local_port: u16,
    ) -> Result<Channel<client::Msg>, SshTransportError> {
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
        self.handle.send_keepalive(true).await.map_err(Into::into)
    }

    pub(crate) async fn close(self) -> Result<(), SshTransportError> {
        timeout(
            SHUTDOWN_TIMEOUT,
            self.handle
                .disconnect(russh::Disconnect::ByApplication, "closing", ""),
        )
        .await
        .map_err(|_| SshTransportError::ShutdownTimeout)?
        .map_err(Into::into)
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
}
