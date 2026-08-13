//! Fixed, release-owned semantic descriptors.

use std::sync::Arc;

use super::bundle::{BundleCommandSpec, BundleResolver, BundleTarget, VerifiedBundle};
use super::protocol::{
    DescriptorAvailabilityReason, DescriptorAvailabilityState, SemanticDescriptorAvailability,
    SemanticLanguage,
};
use super::trust::{InitializationPolicy, SemanticTrust};

pub const RUST_ANALYZER_DESCRIPTOR: &str = "rust-analyzer";
pub const TYPESCRIPT_LANGUAGE_SERVER_DESCRIPTOR: &str = "typescript-language-server";
pub const JAVASCRIPT_LANGUAGE_SERVER_DESCRIPTOR: &str = "javascript-language-server";
pub const JAVA_LANGUAGE_SERVER_DESCRIPTOR: &str = "eclipse-jdt-ls";
const NATIVE_RUNTIME_ID: &str = "native";
const NODE_RUNTIME_ID: &str = "node";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SemanticDescriptor {
    pub descriptor_id: &'static str,
    pub language: SemanticLanguage,
    pub runtime_id: &'static str,
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
        let resolver = resolver
            .with_command_spec(RUST_ANALYZER_DESCRIPTOR, fixed_rust_command())
            .with_command_spec(TYPESCRIPT_LANGUAGE_SERVER_DESCRIPTOR, fixed_node_command())
            .with_command_spec(JAVASCRIPT_LANGUAGE_SERVER_DESCRIPTOR, fixed_node_command());
        Self {
            resolver: Arc::new(resolver),
            descriptors: Arc::from([
                SemanticDescriptor {
                    descriptor_id: RUST_ANALYZER_DESCRIPTOR,
                    language: SemanticLanguage::Rust,
                    runtime_id: NATIVE_RUNTIME_ID,
                    enabled: true,
                },
                SemanticDescriptor {
                    descriptor_id: TYPESCRIPT_LANGUAGE_SERVER_DESCRIPTOR,
                    language: SemanticLanguage::Typescript,
                    runtime_id: NODE_RUNTIME_ID,
                    enabled: true,
                },
                SemanticDescriptor {
                    descriptor_id: JAVASCRIPT_LANGUAGE_SERVER_DESCRIPTOR,
                    language: SemanticLanguage::Javascript,
                    runtime_id: NODE_RUNTIME_ID,
                    enabled: true,
                },
                SemanticDescriptor {
                    descriptor_id: JAVA_LANGUAGE_SERVER_DESCRIPTOR,
                    language: SemanticLanguage::Java,
                    runtime_id: NATIVE_RUNTIME_ID,
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
        let Some(target) = BundleTarget::current() else {
            return SemanticDescriptorAvailability {
                descriptor_id: descriptor.descriptor_id.into(),
                language,
                state: DescriptorAvailabilityState::UnsupportedCapability,
                reason: Some(DescriptorAvailabilityReason::CapabilityUnsupported),
            };
        };
        let availability = self.resolver.availability(descriptor.descriptor_id, target);
        let identity_matches = self
            .resolver
            .descriptor_identity(descriptor.descriptor_id, target)
            .is_some_and(|(language, runtime_id)| {
                language == descriptor.language && runtime_id == descriptor.runtime_id
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
        let target = BundleTarget::current().ok_or(RegistryError::UnsupportedCapability)?;
        let bundle = self
            .resolver
            .resolve(descriptor.descriptor_id, target)
            .map_err(RegistryError::Bundle)?;
        if bundle.descriptor_id() != descriptor.descriptor_id
            || bundle.language() != descriptor.language
            || bundle.runtime_id() != descriptor.runtime_id
        {
            return Err(RegistryError::DescriptorMismatch);
        }
        Ok(bundle)
    }

    pub fn descriptor_fingerprint(&self, language: SemanticLanguage) -> Option<String> {
        let descriptor = self.descriptor(language)?;
        let target = BundleTarget::current()?;
        self.resolver
            .descriptor_fingerprint(descriptor.descriptor_id, target)
    }
}

fn fixed_rust_command() -> BundleCommandSpec {
    BundleCommandSpec::new("payload/rust-analyzer", Vec::new())
        .expect("fixed Rust Analyzer command is valid")
}

fn fixed_node_command() -> BundleCommandSpec {
    match BundleCommandSpec::new(
        "payload/node/bin/node",
        vec![
            "payload/typescript-language-server/lib/cli.mjs".into(),
            "--stdio".into(),
        ],
    )
    .map(|spec| {
        spec.with_typescript_server_path(
            "payload/typescript-language-server/node_modules/typescript/lib/tsserver.js",
        )
    }) {
        Ok(spec) => spec,
        Err(_) => unreachable!("fixed Node language-server command is valid"),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::semantic::bundle_manifest::{BundleArtifact, BundleDescriptor, BundleManifest};

    #[test]
    fn javascript_and_typescript_have_distinct_logical_descriptors() {
        let registry = SemanticRegistry::new(BundleResolver::new(
            tempfile::tempdir().unwrap().path(),
            BundleManifest {
                descriptors: vec![],
            },
        ));
        let typescript = registry.descriptor(SemanticLanguage::Typescript).unwrap();
        let javascript = registry.descriptor(SemanticLanguage::Javascript).unwrap();
        assert_ne!(typescript.descriptor_id, javascript.descriptor_id);
        assert_eq!(typescript.runtime_id, javascript.runtime_id);
        assert_eq!(typescript.runtime_id, NODE_RUNTIME_ID);
    }

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    #[test]
    fn node_descriptors_use_fixed_entrypoint_and_stdio_arguments() {
        use sha2::Digest;
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let payload = dir.path().join("payload");
        let node = payload.join("node/bin/node");
        std::fs::create_dir_all(node.parent().unwrap()).unwrap();
        std::fs::copy("/bin/sh", &node).unwrap();
        let lsp_module = payload.join("typescript-language-server/lib/cli.mjs");
        std::fs::create_dir_all(lsp_module.parent().unwrap()).unwrap();
        std::fs::write(&lsp_module, "export {};\n").unwrap();
        let tsserver =
            payload.join("typescript-language-server/node_modules/typescript/lib/tsserver.js");
        std::fs::create_dir_all(tsserver.parent().unwrap()).unwrap();
        std::fs::write(&tsserver, "module.exports = {};\n").unwrap();
        std::fs::set_permissions(&node, std::fs::Permissions::from_mode(0o700)).unwrap();
        let project = dir.path().join("project");
        std::fs::create_dir(&project).unwrap();
        std::fs::write(
            project.join("typescript-language-server"),
            "#!/bin/sh\nprintf 'PROJECT_SCRIPT_EXECUTED'\n",
        )
        .unwrap();
        let digest = hex::encode(sha2::Sha256::digest(std::fs::read(&node).unwrap()));
        let target = BundleTarget::current().expect("supported test target");
        let descriptor = |id: &str, language| BundleDescriptor {
            descriptor_id: id.into(),
            runtime_id: "node".into(),
            language,
            version: "1.0.0".into(),
            target,
            artifact: BundleArtifact {
                sha256: digest.clone(),
                license_id: "MIT".into(),
                sbom_component: "node-typescript-language-server".into(),
                compressed_size_bytes: 1,
                uncompressed_size_bytes: 2 * 1024 * 1024,
                payload_tree_sha256: super::super::bundle::hash_payload_tree(&payload).unwrap(),
            },
        };
        let resolver = BundleResolver::new(
            dir.path(),
            BundleManifest {
                descriptors: vec![
                    descriptor(
                        TYPESCRIPT_LANGUAGE_SERVER_DESCRIPTOR,
                        SemanticLanguage::Typescript,
                    ),
                    descriptor(
                        JAVASCRIPT_LANGUAGE_SERVER_DESCRIPTOR,
                        SemanticLanguage::Javascript,
                    ),
                ],
            },
        );
        let direct = resolver
            .clone()
            .with_command_spec(TYPESCRIPT_LANGUAGE_SERVER_DESCRIPTOR, fixed_node_command())
            .resolve(TYPESCRIPT_LANGUAGE_SERVER_DESCRIPTOR, target);
        assert!(direct.is_ok());
        let registry = SemanticRegistry::new(resolver);
        for language in [SemanticLanguage::Typescript, SemanticLanguage::Javascript] {
            let bundle = registry.resolve(language).unwrap();
            assert_eq!(bundle.program(), node);
            assert_eq!(
                bundle.args(),
                &[
                    lsp_module.to_string_lossy().into_owned(),
                    "--stdio".to_string(),
                ]
            );
            assert_eq!(bundle.typescript_server_path(), Some(tsserver.as_path()));
            assert!(std::path::Path::new(&bundle.args()[0]).is_absolute());
            assert!(!bundle.program().starts_with(&project));
        }
    }

    #[test]
    fn java_remains_disabled_even_when_registered() {
        let registry = SemanticRegistry::new(BundleResolver::new(
            tempfile::tempdir().unwrap().path(),
            BundleManifest {
                descriptors: vec![],
            },
        ));
        assert_eq!(
            registry.availability(SemanticLanguage::Java).state,
            DescriptorAvailabilityState::UnsupportedCapability
        );
    }
}
