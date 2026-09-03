//! Integration tests for archive validation, role projection, and attack rejection.

mod common;

use common::release_fixtures::{build_archive, create_test_manifest_and_archive};
use dam_hopper_server::linux_release::*;
use flate2::write::GzEncoder;
use flate2::Compression;
use tar::Builder;
use tempfile::tempdir;

#[test]
fn test_archive_inspection_success() {
    let (manifest, archive_bytes) = create_test_manifest_and_archive();
    inspect_and_validate_archive(&archive_bytes[..], &manifest)
        .expect("valid archive matches manifest");
}

#[test]
fn test_archive_role_projection() {
    let (manifest, archive_bytes) = create_test_manifest_and_archive();
    let dir = tempdir().unwrap();

    let server_dir = dir.path().join("server");
    extract_role_projection(
        &archive_bytes[..],
        &manifest,
        TargetRole::Server,
        &server_dir,
    )
    .unwrap();
    assert!(server_dir.join("bin/dam-hopper-server").exists());
    assert!(server_dir.join("bin/dam-hopper-manager").exists());
    assert!(server_dir.join("LICENSE").exists());
    assert!(!server_dir.join("bin/dam-hopper-web").exists());
    assert!(!server_dir.join("web").exists());

    let web_dir = dir.path().join("web");
    extract_role_projection(&archive_bytes[..], &manifest, TargetRole::Web, &web_dir).unwrap();
    assert!(web_dir.join("bin/dam-hopper-web").exists());
    assert!(web_dir.join("bin/dam-hopper-manager").exists());
    assert!(web_dir.join("web/index.html").exists());
    assert!(!web_dir.join("bin/dam-hopper-server").exists());
    assert!(!web_dir.join("systemd/dam-hopper-api.service").exists());

    let both_dir = dir.path().join("both");
    extract_role_projection(&archive_bytes[..], &manifest, TargetRole::Both, &both_dir).unwrap();
    assert!(both_dir.join("bin/dam-hopper-server").exists());
    assert!(both_dir.join("bin/dam-hopper-web").exists());
    assert!(both_dir.join("web/index.html").exists());
}

#[test]
fn test_archive_tampering_and_attack_rejection() {
    let (manifest, _) = create_test_manifest_and_archive();

    // 1. Content digest altered
    let bad_bytes = build_archive(&[("bin/dam-hopper-manager", false, b"TAMPERED CONTENT", 0o755)]);
    assert!(matches!(
        inspect_and_validate_archive(&bad_bytes[..], &manifest),
        Err(ReleaseError::ArchiveEntryInvalid { .. })
            | Err(ReleaseError::ArchiveDigestMismatch { .. })
    ));

    // 2. Traversal path
    let mut enc = GzEncoder::new(Vec::new(), Compression::default());
    {
        let mut tar = Builder::new(&mut enc);
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Regular);
        header.set_size(4);
        header.set_mode(0o644);
        let path_bytes = b"../outside.txt";
        header.as_mut_bytes()[..path_bytes.len()].copy_from_slice(path_bytes);
        header.set_cksum();
        tar.append(&header, &b"evil"[..]).unwrap();
        tar.finish().unwrap();
    }
    let traversal_bytes = enc.finish().unwrap();
    assert!(matches!(
        inspect_and_validate_archive(&traversal_bytes[..], &manifest),
        Err(ReleaseError::InvalidInventoryPath(_)) | Err(ReleaseError::ArchiveEntryTraversal(_))
    ));
    // 3. Symlink entry
    let mut enc = GzEncoder::new(Vec::new(), Compression::default());
    {
        let mut tar = Builder::new(&mut enc);
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_mode(0o755);
        header.set_size(0);
        header.set_link_name("target").unwrap();
        tar.append_data(&mut header, "bin/dam-hopper-manager", &[][..])
            .unwrap();
    }
    let symlink_archive = enc.finish().unwrap();
    assert!(matches!(
        inspect_and_validate_archive(&symlink_archive[..], &manifest),
        Err(ReleaseError::ArchiveEntryNotRegularFileOrDir { .. })
    ));
}
