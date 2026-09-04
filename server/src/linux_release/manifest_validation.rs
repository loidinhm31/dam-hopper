//! Cross-field invariant validation for release manifests.

use super::constants::*;
use super::error::ReleaseError;
use super::inventory::validate_inventory;
use super::manifest::ReleaseManifest;
use super::version::*;

/// Verify all cross-field contract invariants for a decoded release manifest.
pub fn validate_manifest_invariants(m: &ReleaseManifest) -> Result<(), ReleaseError> {
    if m.schema_version != SCHEMA_VERSION {
        return Err(ReleaseError::InvalidSchemaVersion {
            expected: SCHEMA_VERSION,
            got: m.schema_version,
        });
    }

    validate_version(&m.release.version)?;
    validate_release_tag(&m.release.tag, &m.release.version)?;
    validate_commit_sha(&m.release.commit_sha)?;

    validate_profile(m)?;
    validate_archive(m)?;
    validate_components(m)?;
    validate_services(m)?;
    validate_rollback(m)?;

    validate_inventory(&m.inventory)?;

    Ok(())
}

fn validate_profile(m: &ReleaseManifest) -> Result<(), ReleaseError> {
    let p = &m.profile;
    let id_valid = p.id == PROFILE_ID || p.id == LEGACY_PROFILE_ID;
    if !id_valid {
        return Err(ReleaseError::ProfileMismatch {
            field: "id",
            expected: format!("{PROFILE_ID} or {LEGACY_PROFILE_ID}"),
            got: p.id.clone(),
        });
    }

    let os_id_valid = p.os_id == PROFILE_OS_ID || p.os_id == "fedora";
    if !os_id_valid {
        return Err(ReleaseError::ProfileMismatch {
            field: "osId",
            expected: format!("{PROFILE_OS_ID} or fedora"),
            got: p.os_id.clone(),
        });
    }

    let os_ver_valid = p.os_version == PROFILE_OS_VERSION || p.os_version == "44";
    if !os_ver_valid {
        return Err(ReleaseError::ProfileMismatch {
            field: "osVersion",
            expected: format!("{PROFILE_OS_VERSION} or 44"),
            got: p.os_version.clone(),
        });
    }

    let checks = [
        ("arch", p.arch.as_str(), PROFILE_ARCH),
        ("target", p.target.as_str(), PROFILE_TARGET),
        ("glibcMin", p.glibc_min.as_str(), PROFILE_GLIBC_MIN),
    ];
    for (field, got, expected) in checks {
        if got != expected {
            return Err(ReleaseError::ProfileMismatch {
                field,
                expected: expected.to_string(),
                got: got.to_string(),
            });
        }
    }
    if p.systemd_min < PROFILE_SYSTEMD_MIN {
        return Err(ReleaseError::SystemdVersionTooLow {
            expected: PROFILE_SYSTEMD_MIN,
            got: p.systemd_min,
        });
    }
    Ok(())
}

fn validate_archive(m: &ReleaseManifest) -> Result<(), ReleaseError> {
    let expected_name = expected_archive_name(&m.release.tag);
    let legacy_name = format!("dam-hopper-{}-{LEGACY_PROFILE_ID}.tar.gz", m.release.tag);
    if m.archive.name != expected_name && m.archive.name != legacy_name {
        return Err(ReleaseError::ArchiveNameMismatch {
            expected: expected_name,
            got: m.archive.name.clone(),
        });
    }
    if m.archive.size == 0 {
        return Err(ReleaseError::InvalidArchiveSize);
    }
    validate_sha256_hex(&m.archive.sha256)?;
    Ok(())
}

fn validate_components(m: &ReleaseManifest) -> Result<(), ReleaseError> {
    let ver = &m.release.version;
    let comps = [
        ("cli", &m.components.cli.version),
        ("api", &m.components.api.version),
        ("webHost", &m.components.web_host.version),
        ("webAssets", &m.components.web_assets.version),
    ];
    for (component, comp_ver) in comps {
        if comp_ver != ver {
            return Err(ReleaseError::ComponentVersionMismatch {
                component,
                expected: ver.clone(),
                got: comp_ver.clone(),
            });
        }
    }
    Ok(())
}

fn validate_services(m: &ReleaseManifest) -> Result<(), ReleaseError> {
    let api = &m.services.api;
    if api.unit_name != API_SERVICE_UNIT {
        return Err(ReleaseError::ServiceContractMismatch {
            service: "api",
            field: "unitName",
            expected: API_SERVICE_UNIT.to_string(),
            got: api.unit_name.clone(),
        });
    }
    if api.identity != API_SERVICE_IDENTITY {
        return Err(ReleaseError::ServiceContractMismatch {
            service: "api",
            field: "identity",
            expected: API_SERVICE_IDENTITY.to_string(),
            got: api.identity.clone(),
        });
    }
    if api.bind_host != API_SERVICE_BIND_HOST {
        return Err(ReleaseError::ServiceContractMismatch {
            service: "api",
            field: "bindHost",
            expected: API_SERVICE_BIND_HOST.to_string(),
            got: api.bind_host.clone(),
        });
    }
    if api.port != API_SERVICE_PORT {
        return Err(ReleaseError::ServicePortMismatch {
            service: "api",
            expected: API_SERVICE_PORT,
            got: api.port,
        });
    }
    if api.health_path != API_SERVICE_HEALTH_PATH {
        return Err(ReleaseError::ServiceContractMismatch {
            service: "api",
            field: "healthPath",
            expected: API_SERVICE_HEALTH_PATH.to_string(),
            got: api.health_path.clone(),
        });
    }

    let web = &m.services.web;
    if web.unit_name != WEB_SERVICE_UNIT {
        return Err(ReleaseError::ServiceContractMismatch {
            service: "web",
            field: "unitName",
            expected: WEB_SERVICE_UNIT.to_string(),
            got: web.unit_name.clone(),
        });
    }
    if web.identity != WEB_SERVICE_IDENTITY {
        return Err(ReleaseError::ServiceContractMismatch {
            service: "web",
            field: "identity",
            expected: WEB_SERVICE_IDENTITY.to_string(),
            got: web.identity.clone(),
        });
    }
    if web.bind_host != WEB_SERVICE_BIND_HOST {
        return Err(ReleaseError::ServiceContractMismatch {
            service: "web",
            field: "bindHost",
            expected: WEB_SERVICE_BIND_HOST.to_string(),
            got: web.bind_host.clone(),
        });
    }
    if web.port != WEB_SERVICE_PORT {
        return Err(ReleaseError::ServicePortMismatch {
            service: "web",
            expected: WEB_SERVICE_PORT,
            got: web.port,
        });
    }
    if web.health_path != WEB_SERVICE_HEALTH_PATH {
        return Err(ReleaseError::ServiceContractMismatch {
            service: "web",
            field: "healthPath",
            expected: WEB_SERVICE_HEALTH_PATH.to_string(),
            got: web.health_path.clone(),
        });
    }
    Ok(())
}

fn validate_rollback(m: &ReleaseManifest) -> Result<(), ReleaseError> {
    if m.rollback.previous_release_compatible != ROLLBACK_PREVIOUS_COMPATIBLE {
        return Err(ReleaseError::RollbackMismatch {
            field: "previousReleaseCompatible",
            expected: ROLLBACK_PREVIOUS_COMPATIBLE.to_string(),
            got: m.rollback.previous_release_compatible.to_string(),
        });
    }
    if m.rollback.state_compatibility != ROLLBACK_STATE_COMPATIBILITY {
        return Err(ReleaseError::RollbackMismatch {
            field: "stateCompatibility",
            expected: ROLLBACK_STATE_COMPATIBILITY.to_string(),
            got: m.rollback.state_compatibility.clone(),
        });
    }
    Ok(())
}
