//! Phase 1 semantic-navigation domain contracts.
//!
//! These types intentionally contain no process management, filesystem paths,
//! or LSP JSON-RPC transport. Later phases compose the validated contracts.

pub mod bundle_manifest;
pub mod navigation_response;
pub mod protocol;
pub mod trust;
