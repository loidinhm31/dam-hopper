use super::{
    store::{TelemetryStore, TelemetryStoreError},
    TelemetryCmd,
};

/// Roll up detail older than the configured UTC retention window, then remove it.
pub fn purge_expired(
    store: &TelemetryStore,
    now_utc_ms: i64,
    detail_retention_days: u16,
) -> Result<(), TelemetryStoreError> {
    store.write_batch(vec![TelemetryCmd::Purge {
        now_utc_ms,
        detail_retention_days,
        aggregate_retention_days: None,
    }])?;
    store.checkpoint()
}
