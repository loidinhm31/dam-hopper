//! Integration tests for production idle-suspend diagnostics fault matrix,
//! redaction corpus, bounds enforcement, role awareness, and atomic output.

#[path = "idle_suspend_diagnostics/fakes.rs"]
mod fakes;

#[path = "idle_suspend_diagnostics/fault_matrix.rs"]
mod fault_matrix;

#[path = "idle_suspend_diagnostics/redaction.rs"]
mod redaction;

#[path = "idle_suspend_diagnostics/bounds.rs"]
mod bounds;

#[path = "idle_suspend_diagnostics/roles.rs"]
mod roles;

#[path = "idle_suspend_diagnostics/output.rs"]
mod output;
