//! Semantic-navigation domain contracts and the server-owned runtime.
//!
//! These types intentionally contain no process management, filesystem paths,
//! or LSP JSON-RPC transport. Later phases compose the validated contracts.

pub mod bundle;
pub mod bundle_manifest;
pub mod codec;
pub mod metrics;
pub mod navigation_response;
pub mod protocol;
pub mod registry;
pub mod session;
pub mod supervisor;
pub mod trust;
pub mod trust_store;
