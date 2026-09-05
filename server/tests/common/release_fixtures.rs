#![allow(dead_code)]

//! Test fixtures and archive builders for Linux release testing.

use dam_hopper_server::linux_release::*;
use flate2::write::GzEncoder;
use flate2::Compression;
use sha2::{Digest, Sha256};
use tar::{Builder, Header};

pub fn build_archive(entries: &[(&str, bool, &[u8], u32)]) -> Vec<u8> {
    let mut enc = GzEncoder::new(Vec::new(), Compression::default());
    {
        let mut tar = Builder::new(&mut enc);
        for &(path, is_dir, content, mode) in entries {
            let mut header = Header::new_gnu();
            header.set_mode(mode);
            if is_dir {
                header.set_entry_type(tar::EntryType::Directory);
                header.set_size(0);
                tar.append_data(&mut header, path, &[][..]).unwrap();
            } else {
                header.set_entry_type(tar::EntryType::Regular);
                header.set_size(content.len() as u64);
                tar.append_data(&mut header, path, content).unwrap();
            }
        }
        tar.finish().unwrap();
    }
    enc.finish().unwrap()
}

pub fn create_test_manifest_and_archive() -> (ReleaseManifest, Vec<u8>) {
    let f1_data = b"manager binary content";
    let f2_data = b"server binary content";
    let f3_data = b"web binary content";
    let f4_data = include_bytes!("../../../deploy/systemd/dam-hopper-api.service.in");
    let f5_data = include_bytes!("../../../deploy/systemd/dam-hopper-web.service.in");
    let f6_data = include_bytes!("../../../deploy/systemd/dam-hopper-recovery.service.in");
    let f7_data = include_bytes!("../../../deploy/sysusers.d/dam-hopper-web.conf");
    let f8_data = b"<!doctype html><html>web</html>";
    let f9_data = b"MIT License";

    let entries = vec![
        ("bin/dam-hopper-manager", false, &f1_data[..], 0o755),
        ("bin/dam-hopper-server", false, &f2_data[..], 0o755),
        ("bin/dam-hopper-web", false, &f3_data[..], 0o755),
        ("systemd/dam-hopper-api.service", false, &f4_data[..], 0o644),
        ("systemd/dam-hopper-web.service", false, &f5_data[..], 0o644),
        ("systemd/dam-hopper-recovery.service", false, &f6_data[..], 0o644),
        ("sysusers.d/dam-hopper-web.conf", false, &f7_data[..], 0o644),
        ("web", true, &[][..], 0o755),
        ("web/index.html", false, &f8_data[..], 0o644),
        ("LICENSE", false, &f9_data[..], 0o644),
    ];

    let archive_bytes = build_archive(&entries);
    let archive_sha = hex::encode(Sha256::digest(&archive_bytes));

    let inventory = vec![
        InventoryEntry {
            path: "bin/dam-hopper-manager".to_string(),
            kind: EntryKind::File,
            roles: vec![ReleaseRole::Common],
            mode: 0o755,
            size: Some(f1_data.len() as u64),
            sha256: Some(hex::encode(Sha256::digest(f1_data))),
        },
        InventoryEntry {
            path: "bin/dam-hopper-server".to_string(),
            kind: EntryKind::File,
            roles: vec![ReleaseRole::Server],
            mode: 0o755,
            size: Some(f2_data.len() as u64),
            sha256: Some(hex::encode(Sha256::digest(f2_data))),
        },
        InventoryEntry {
            path: "bin/dam-hopper-web".to_string(),
            kind: EntryKind::File,
            roles: vec![ReleaseRole::Web],
            mode: 0o755,
            size: Some(f3_data.len() as u64),
            sha256: Some(hex::encode(Sha256::digest(f3_data))),
        },
        InventoryEntry {
            path: "systemd/dam-hopper-api.service".to_string(),
            kind: EntryKind::File,
            roles: vec![ReleaseRole::Server],
            mode: 0o644,
            size: Some(f4_data.len() as u64),
            sha256: Some(hex::encode(Sha256::digest(f4_data))),
        },
        InventoryEntry {
            path: "systemd/dam-hopper-web.service".to_string(),
            kind: EntryKind::File,
            roles: vec![ReleaseRole::Web],
            mode: 0o644,
            size: Some(f5_data.len() as u64),
            sha256: Some(hex::encode(Sha256::digest(f5_data))),
        },
        InventoryEntry {
            path: "systemd/dam-hopper-recovery.service".to_string(),
            kind: EntryKind::File,
            roles: vec![ReleaseRole::Common],
            mode: 0o644,
            size: Some(f6_data.len() as u64),
            sha256: Some(hex::encode(Sha256::digest(f6_data))),
        },
        InventoryEntry {
            path: "sysusers.d/dam-hopper-web.conf".to_string(),
            kind: EntryKind::File,
            roles: vec![ReleaseRole::Web],
            mode: 0o644,
            size: Some(f7_data.len() as u64),
            sha256: Some(hex::encode(Sha256::digest(f7_data))),
        },
        InventoryEntry {
            path: "web".to_string(),
            kind: EntryKind::Dir,
            roles: vec![ReleaseRole::Web],
            mode: 0o755,
            size: None,
            sha256: None,
        },
        InventoryEntry {
            path: "web/index.html".to_string(),
            kind: EntryKind::File,
            roles: vec![ReleaseRole::Web],
            mode: 0o644,
            size: Some(f8_data.len() as u64),
            sha256: Some(hex::encode(Sha256::digest(f8_data))),
        },
        InventoryEntry {
            path: "LICENSE".to_string(),
            kind: EntryKind::File,
            roles: vec![ReleaseRole::Common],
            mode: 0o644,
            size: Some(f9_data.len() as u64),
            sha256: Some(hex::encode(Sha256::digest(f9_data))),
        },
    ];

    let manifest = ReleaseManifest {
        schema_version: SCHEMA_VERSION,
        release: ReleaseMeta {
            tag: "v0.2.0".to_string(),
            version: "0.2.0".to_string(),
            commit_sha: "0123456789abcdef0123456789abcdef01234567".to_string(),
        },
        profile: ProfileMeta {
            id: PROFILE_ID.to_string(),
            os_id: PROFILE_OS_ID.to_string(),
            os_version: PROFILE_OS_VERSION.to_string(),
            arch: PROFILE_ARCH.to_string(),
            target: PROFILE_TARGET.to_string(),
            glibc_min: PROFILE_GLIBC_MIN.to_string(),
            systemd_min: PROFILE_SYSTEMD_MIN,
        },
        archive: ArchiveMeta {
            name: expected_archive_name("v0.2.0"),
            size: archive_bytes.len() as u64,
            sha256: archive_sha,
        },
        components: ComponentsMeta {
            cli: ComponentVersion {
                version: "0.2.0".to_string(),
            },
            api: ComponentVersion {
                version: "0.2.0".to_string(),
            },
            web_host: ComponentVersion {
                version: "0.2.0".to_string(),
            },
            web_assets: ComponentVersion {
                version: "0.2.0".to_string(),
            },
        },
        inventory,
        services: ServicesMeta {
            api: ServiceContract {
                unit_name: API_SERVICE_UNIT.to_string(),
                identity: API_SERVICE_IDENTITY.to_string(),
                bind_host: API_SERVICE_BIND_HOST.to_string(),
                port: API_SERVICE_PORT,
                health_path: API_SERVICE_HEALTH_PATH.to_string(),
            },
            web: ServiceContract {
                unit_name: WEB_SERVICE_UNIT.to_string(),
                identity: WEB_SERVICE_IDENTITY.to_string(),
                bind_host: WEB_SERVICE_BIND_HOST.to_string(),
                port: WEB_SERVICE_PORT,
                health_path: WEB_SERVICE_HEALTH_PATH.to_string(),
            },
        },
        rollback: RollbackMeta {
            previous_release_compatible: ROLLBACK_PREVIOUS_COMPATIBLE,
            state_compatibility: ROLLBACK_STATE_COMPATIBILITY.to_string(),
        },
    };

    (manifest, archive_bytes)
}
