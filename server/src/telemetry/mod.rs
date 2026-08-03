pub mod codex_otlp;
pub mod command_classifier;
pub mod privacy;
pub mod queries;
pub mod retention;
pub mod runtime;
pub mod sink;
pub mod store;
pub mod types;
pub mod worker;

pub use command_classifier::{
    normalize_command, CommandClassifier, NormalizedCommand, COMMAND_HMAC_DOMAIN,
    TERMINAL_HMAC_DOMAIN,
};
pub use privacy::{hmac_key_path, load_or_create_hmac_key, TelemetryHmacKey, TelemetryKeyRing};
pub use runtime::{TelemetryRuntime, TelemetryRuntimeStatus};
pub use sink::{ChannelTelemetrySink, NoopTelemetrySink, TelemetryCmd, TelemetrySink};
pub use store::TelemetryStore;
pub use types::*;
