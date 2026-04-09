/// Structured audit log for every filesystem mutation.
///
/// Output target: `audit.fs`. Sink (file rotation, SIEM forwarding) is deferred.
/// Consumers can filter via `RUST_LOG=audit.fs=info` or a subscriber filter.
#[macro_export]
macro_rules! audit_fs {
    ($op:expr, $project:expr, $path:expr, $ok:expr) => {
        tracing::info!(
            target: "audit.fs",
            op = $op,
            project = $project,
            path = ?$path,
            ok = $ok,
        );
    };
}
