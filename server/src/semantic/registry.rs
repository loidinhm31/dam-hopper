//! Fixed, release-owned semantic descriptors.

use std::sync::Arc;

use super::bundle::{BundleResolver, BundleTarget, VerifiedBundle};
use super::protocol::{
    DescriptorAvailabilityReason, DescriptorAvailabilityState, SemanticDescriptorAvailability,
    SemanticLanguage,
};
use super::trust::{InitializationPolicy, SemanticTrust};

pub const RUST_ANALYZER_DESCRIPTOR: &str = "rust-analyzer";
pub const TYPESCRIPT_LANGUAGE_SERVER_DESCRIPTOR: &str = "typescript-language-server";
pub const JAVA_LANGUAGE_SERVER_DESCRIPTOR: &str = "eclipse-jdt-ls";
const NATIVE_RUNTIME_ID: &str = "native";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SemanticDescriptor {
    pub descriptor_id: &'static str,
    pub language: SemanticLanguage,
    pub enabled: bool,
}

impl SemanticDescriptor {
    pub const fn restricted_policy(&self) -> InitializationPolicy {
        InitializationPolicy::Restricted
    }

    pub const fn policy_for(&self, trust: SemanticTrust) -> InitializationPolicy {
        match trust {
            SemanticTrust::Trusted => InitializationPolicy::Trusted,
            SemanticTrust::Restricted | SemanticTrust::Revoked => self.restricted_policy(),
        }
    }
}

#[derive(Clone)]
pub struct SemanticRegistry {
    resolver: Arc<BundleResolver>,
    descriptors: Arc<[SemanticDescriptor]>,
}

impl SemanticRegistry {
    pub fn new(resolver: BundleResolver) -> Self {
        Self {
            resolver: Arc::new(resolver),
            descriptors: Arc::from([
                SemanticDescriptor {
                    descriptor_id: RUST_ANALYZER_DESCRIPTOR,
                    language: SemanticLanguage::Rust,
                    enabled: true,
                },
                SemanticDescriptor {
                    descriptor_id: TYPESCRIPT_LANGUAGE_SERVER_DESCRIPTOR,
                    language: SemanticLanguage::Typescript,
                    enabled: true,
                },
                SemanticDescriptor {
                    descriptor_id: TYPESCRIPT_LANGUAGE_SERVER_DESCRIPTOR,
                    language: SemanticLanguage::Javascript,
                    enabled: true,
                },
                SemanticDescriptor {
                    descriptor_id: JAVA_LANGUAGE_SERVER_DESCRIPTOR,
                    language: SemanticLanguage::Java,
                    enabled: false,
                },
            ]),
        }
    }

    pub fn descriptor(&self, language: SemanticLanguage) -> Option<&SemanticDescriptor> {
        self.descriptors
            .iter()
            .find(|descriptor| descriptor.language == language)
    }

    pub fn availability(&self, language: SemanticLanguage) -> SemanticDescriptorAvailability {
        let Some(descriptor) = self.descriptor(language) else {
            return SemanticDescriptorAvailability {
                descriptor_id: "unsupported".into(),
                language,
                state: DescriptorAvailabilityState::UnsupportedCapability,
                reason: Some(DescriptorAvailabilityReason::CapabilityUnsupported),
            };
        };
        if !descriptor.enabled {
            return SemanticDescriptorAvailability {
                descriptor_id: descriptor.descriptor_id.into(),
                language,
                state: DescriptorAvailabilityState::UnsupportedCapability,
                reason: Some(DescriptorAvailabilityReason::CapabilityUnsupported),
            };
        }
        let availability = self
            .resolver
            .availability(descriptor.descriptor_id, BundleTarget::current());
        let identity_matches = self
            .resolver
            .descriptor_identity(descriptor.descriptor_id, BundleTarget::current())
            .is_some_and(|(language, runtime_id)| {
                language == descriptor.language && runtime_id == NATIVE_RUNTIME_ID
            });
        let (state, reason) = match (availability.state, identity_matches) {
            (super::bundle_manifest::PublicBundleState::Ready, false) => (
                DescriptorAvailabilityState::BundleInvalid,
                Some(DescriptorAvailabilityReason::ReleaseManifestInvalid),
            ),
            (super::bundle_manifest::PublicBundleState::Ready, true) => {
                (DescriptorAvailabilityState::Ready, None)
            }
            (super::bundle_manifest::PublicBundleState::BundleUnavailable, _) => (
                DescriptorAvailabilityState::BundleUnavailable,
                Some(DescriptorAvailabilityReason::ReleaseManifestMissing),
            ),
            (super::bundle_manifest::PublicBundleState::BundleInvalid, _) => (
                DescriptorAvailabilityState::BundleInvalid,
                Some(DescriptorAvailabilityReason::ReleaseManifestInvalid),
            ),
        };
        SemanticDescriptorAvailability {
            descriptor_id: descriptor.descriptor_id.into(),
            language,
            state,
            reason,
        }
    }

    pub fn resolve(&self, language: SemanticLanguage) -> Result<VerifiedBundle, RegistryError> {
        let descriptor = self
            .descriptor(language)
            .ok_or(RegistryError::UnsupportedCapability)?;
        if !descriptor.enabled {
            return Err(RegistryError::UnsupportedCapability);
        }
        let bundle = self
            .resolver
            .resolve(descriptor.descriptor_id, BundleTarget::current())
            .map_err(RegistryError::Bundle)?;
        if bundle.descriptor_id() != descriptor.descriptor_id
            || bundle.language() != descriptor.language
            || bundle.runtime_id() != NATIVE_RUNTIME_ID
        {
            return Err(RegistryError::DescriptorMismatch);
        }
        Ok(bundle)
    }

    pub fn descriptor_fingerprint(&self, language: SemanticLanguage) -> Option<String> {
        let descriptor = self.descriptor(language)?;
        self.resolver
            .descriptor_fingerprint(descriptor.descriptor_id, BundleTarget::current())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
    #[error("semantic capability is unsupported")]
    UnsupportedCapability,
    #[error(transparent)]
    Bundle(#[from] super::bundle::BundleError),
    #[error("signed bundle descriptor does not match the server-owned registry")]
    DescriptorMismatch,
}
