pub mod collector;
pub mod correlation;
pub mod file_sources;
pub mod model;
pub mod redaction;

#[cfg(test)]
pub mod tests;

pub use collector::{assemble_bundle, evaluate_historical_completeness};
pub use correlation::analyze_correlations;
pub use file_sources::{
    read_backend_diagnostics, read_helper_audit, read_server_audit, read_server_events,
    scan_bounded_jsonl_file, FileScanResult, RawLineRecord,
};
pub use model::*;
pub use redaction::*;
