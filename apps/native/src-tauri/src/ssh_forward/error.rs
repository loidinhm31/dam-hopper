//! Redacted, stable error codes for the native SSH-forwarding boundary.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum SshForwardErrorCode {
    CounterExhausted,
    InvalidCounter,
    InvalidTimestamp,
    InvalidProfile,
    IdentityCorrupt,
    StaleClient,
    ScopeActive,
    StorageUnavailable,
}
