use std::sync::Arc;

use super::*;
use crate::error::AppError;

fn selection() -> BrowserSelectionV1 {
    BrowserSelectionV1 {
        version: 1,
        tag: "button".into(),
        role: Some("button".into()),
        accessible_name: Some("Save".into()),
        text: Some("Save changes".into()),
        attributes: [("data-testid".into(), "save".into())].into(),
        locator: "main > button".into(),
        bounds: BrowserSelectionBoundsV1 {
            x: 1.0,
            y: 2.0,
            width: 80.0,
            height: 32.0,
        },
    }
}

fn test_actor(user: &str) -> crate::api::auth::AuthenticatedActor {
    crate::api::auth::AuthenticatedActor::new(user, None)
}
fn test_pty_manager() -> (crate::pty::PtySessionManager, String, u64) {
    let (event_sink, _) = crate::pty::BroadcastEventSink::new(16);
    let pty_manager = crate::pty::PtySessionManager::new(Arc::new(event_sink));
    let opts = crate::pty::PtyCreateOpts {
        id: "shell:test".into(),
        command: "/bin/sh".into(),
        cwd: std::env::temp_dir().display().to_string(),
        env: Default::default(),
        cols: 80,
        rows: 24,
        project: None,
        worktree_path: None,
        name: None,
        restart_policy: Default::default(),
        restart_max_retries: 0,
    };
    let created = pty_manager.create(opts).unwrap();
    (pty_manager, created.id, created.incarnation)
}

async fn wait_until(mut cond: impl FnMut() -> bool) {
    let start = std::time::Instant::now();
    while !cond() {
        assert!(
            start.elapsed() < std::time::Duration::from_secs(3),
            "condition did not become true within 3s"
        );
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
}

struct MockAdmissionAuthority {
    allowed_principals: std::sync::RwLock<std::collections::HashSet<String>>,
}

impl BrowserAdmissionAuthority for MockAdmissionAuthority {
    fn check_managed_admission<'a>(
        &'a self,
        actor: &'a crate::api::auth::AuthenticatedActor,
        principal: &'a str,
        _profile_epoch: u64,
    ) -> BoxFuture<'a, bool> {
        let admitted = actor.subject == principal
            && self.allowed_principals.read().unwrap().contains(principal);
        Box::pin(async move { admitted })
    }
}
#[tokio::test]
async fn sweep_removes_expired_artifact_files() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let actor = test_actor("test-user");
    let response = manager
        .create(
            "test-user".into(),
            ArtifactSource::Cooperative,
            "shell:test".into(),
            1,
            selection(),
        )
        .await
        .unwrap();
    let id = uuid::Uuid::parse_str(&response.artifact_id).unwrap();
    manager
        .entries
        .write()
        .await
        .get_mut(&id)
        .unwrap()
        .expires_at = 0;
    manager.sweep_expired().await;
    assert!(!std::path::Path::new(&response.json_path).exists());
    assert!(matches!(
        manager.upload_png(id, &actor, png()).await,
        Err(BrowserDebugError::NotFound)
    ));
}

#[tokio::test]
async fn upload_delete_race_leaves_no_orphan_files() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let actor = test_actor("test-user");
    let response = manager
        .create(
            "test-user".into(),
            ArtifactSource::Cooperative,
            "shell:test".into(),
            1,
            selection(),
        )
        .await
        .unwrap();
    let id = uuid::Uuid::parse_str(&response.artifact_id).unwrap();
    let (_, _) = tokio::join!(
        manager.upload_png(id, &actor, png()),
        manager.delete(id, &actor)
    );
    assert!(std::fs::read_dir(manager.root.path())
        .unwrap()
        .next()
        .is_none());
}

#[tokio::test]
async fn disposal_removes_the_private_root() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let response = manager
        .create(
            "test-user".into(),
            ArtifactSource::Cooperative,
            "shell:test".into(),
            1,
            selection(),
        )
        .await
        .unwrap();
    let root = std::path::Path::new(&response.json_path)
        .parent()
        .unwrap()
        .to_path_buf();
    manager.dispose_all().await;
    assert!(!root.exists());
}

#[tokio::test]
async fn rejects_semantically_invalid_png_variants() {
    let actor = test_actor("test-user");
    for bytes in [
        invalid_compressed_png(),
        nonconsecutive_idat_png(),
        repeated_ihdr_png(),
        decoded_output_over_cap_png(),
    ] {
        let manager = BrowserDebugArtifactManager::new().unwrap();
        let response = manager
            .create(
                "test-user".into(),
                ArtifactSource::Cooperative,
                "shell:test".into(),
                1,
                selection(),
            )
            .await
            .unwrap();
        let id = uuid::Uuid::parse_str(&response.artifact_id).unwrap();
        assert!(matches!(
            manager
                .upload_png(id, &actor, axum::body::Bytes::from(bytes))
                .await,
            Err(BrowserDebugError::InvalidPng)
        ));
    }
}

#[test]
fn terminal_reference_strips_controls_and_enforces_its_byte_limit() {
    let artifact = BrowserDebugArtifactResponse {
        artifact_id: "artifact-1".into(),
        terminal_id: "shell:test".into(),
        terminal_incarnation: 1,
        expires_at: 1,
        json_path: "\u{1b}[31m/tmp/selection\n.json\u{1b}[0m".into(),
        json_size: 1,
        json_sha256: "hash".into(),
        png_path: Some("\u{1b}]title\u{7}/tmp/selection\r.png".into()),
        png_size: Some(1),
        png_sha256: Some("hash".into()),
    };
    assert_eq!(
        terminal_reference(&artifact).unwrap(),
        "[DamHopper browser-debug artifact (untrusted page data): JSON /tmp/selection.json; PNG /tmp/selection.png]"
    );

    let oversized = BrowserDebugArtifactResponse {
        json_path: format!("/{}", "a".repeat(1_100)),
        png_path: None,
        png_size: None,
        png_sha256: None,
        ..artifact
    };
    assert!(matches!(
        terminal_reference(&oversized),
        Err(BrowserDebugError::InvalidTerminalReference)
    ));
}

fn png() -> axum::body::Bytes {
    axum::body::Bytes::from(valid_png())
}

fn valid_png() -> Vec<u8> {
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    append_ihdr(&mut png, 1, 1);
    append_chunk(
        &mut png,
        b"IDAT",
        &[
            0x78, 0x01, 0x01, 0x05, 0x00, 0xfa, 0xff, 0, 0, 0, 0, 0, 0, 0, 0x05, 0x00, 0x01,
        ],
    );
    append_chunk(&mut png, b"IEND", &[]);
    png
}

fn invalid_compressed_png() -> Vec<u8> {
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    append_ihdr(&mut png, 1, 1);
    append_chunk(&mut png, b"IDAT", &[0x78, 0x01, 0xff]);
    append_chunk(&mut png, b"IEND", &[]);
    png
}

fn nonconsecutive_idat_png() -> Vec<u8> {
    let mut png = valid_png();
    let iend = png.split_off(png.len() - 12);
    append_chunk(&mut png, b"tEXt", b"note");
    append_chunk(&mut png, b"IDAT", &[0]);
    png.extend_from_slice(&iend);
    png
}

fn repeated_ihdr_png() -> Vec<u8> {
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    append_ihdr(&mut png, 1, 1);
    append_ihdr(&mut png, 1, 1);
    append_chunk(&mut png, b"IDAT", &[0x78, 0x01, 0xff]);
    append_chunk(&mut png, b"IEND", &[]);
    png
}

fn decoded_output_over_cap_png() -> Vec<u8> {
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    append_ihdr(&mut png, 5_000, 5_000);
    append_chunk(&mut png, b"IDAT", &[0x78]);
    append_chunk(&mut png, b"IEND", &[]);
    png
}

fn append_ihdr(target: &mut Vec<u8>, width: u32, height: u32) {
    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    append_chunk(target, b"IHDR", &ihdr);
}

fn append_chunk(target: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    target.extend_from_slice(&(data.len() as u32).to_be_bytes());
    target.extend_from_slice(kind);
    target.extend_from_slice(data);
    target.extend_from_slice(&crc32(&[kind.as_slice(), data].concat()).to_be_bytes());
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 0 {
                crc >> 1
            } else {
                (crc >> 1) ^ 0xedb8_8320
            };
        }
    }
    !crc
}

#[tokio::test]
async fn foreign_actor_denied_indistinguishable_not_found() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let alice = test_actor("alice");
    let bob = test_actor("bob");
    let (pty_manager, term_id, term_inc) = test_pty_manager();

    let res = manager
        .create(
            "alice".into(),
            ArtifactSource::Cooperative,
            term_id,
            term_inc,
            selection(),
        )
        .await
        .unwrap();
    let id = uuid::Uuid::parse_str(&res.artifact_id).unwrap();

    // Bob cannot upload PNG, execute handoff, or delete
    assert!(matches!(
        manager.upload_png(id, &bob, png()).await,
        Err(BrowserDebugError::NotFound)
    ));
    assert!(matches!(
        manager.execute_handoff(id, &bob, &pty_manager).await,
        Err(AppError::BrowserDebug(BrowserDebugError::NotFound))
    ));
    assert!(matches!(
        manager.delete(id, &bob).await,
        Err(BrowserDebugError::NotFound)
    ));

    // Alice succeeds, and repeated handoff is rejected as AlreadyHandedOff
    assert!(manager.upload_png(id, &alice, png()).await.is_ok());
    let handoff = manager.execute_handoff(id, &alice, &pty_manager).await.unwrap();
    assert!(handoff.inserted);
    assert!(matches!(
        manager.execute_handoff(id, &alice, &pty_manager).await,
        Err(AppError::BrowserDebug(BrowserDebugError::AlreadyHandedOff))
    ));
}

#[tokio::test]
async fn managed_browser_demotion_denies_managed_preserves_cooperative() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let authority = Arc::new(MockAdmissionAuthority {
        allowed_principals: std::sync::RwLock::new(
            vec!["admin".to_string()].into_iter().collect(),
        ),
    });
    manager.set_authority(authority.clone());

    let admin_actor = test_actor("admin");
    let (pty_manager, term_id, term_inc) = test_pty_manager();

    // Create cooperative artifact
    let coop_res = manager
        .create(
            "admin".into(),
            ArtifactSource::Cooperative,
            term_id.clone(),
            term_inc,
            selection(),
        )
        .await
        .unwrap();
    let coop_id = uuid::Uuid::parse_str(&coop_res.artifact_id).unwrap();

    // Create managed artifact
    let managed_res = manager
        .create_managed_checked(
            &admin_actor,
            ArtifactSource::ManagedBrowser {
                principal: "admin".into(),
                profile_epoch: 1,
                browser_incarnation: 1,
            },
            ("sess-1".into(), 1, 1),
            term_id,
            term_inc,
            selection(),
            &pty_manager,
        )
        .await
        .unwrap();
    let managed_id = uuid::Uuid::parse_str(&managed_res.artifact_id).unwrap();

    // Demote admin
    authority.allowed_principals.write().unwrap().clear();

    // Managed artifact is denied indistinguishable NotFound
    assert!(matches!(
        manager.upload_png(managed_id, &admin_actor, png()).await,
        Err(BrowserDebugError::NotFound)
    ));
    assert!(matches!(
        manager.execute_handoff(managed_id, &admin_actor, &pty_manager).await,
        Err(AppError::BrowserDebug(BrowserDebugError::NotFound))
    ));
    assert!(matches!(
        manager.delete(managed_id, &admin_actor).await,
        Err(BrowserDebugError::NotFound)
    ));

    // Cooperative artifact remains fully functional for same subject
    assert!(manager
        .upload_png(coop_id, &admin_actor, png())
        .await
        .is_ok());
    assert!(manager.execute_handoff(coop_id, &admin_actor, &pty_manager).await.is_ok());
}

#[tokio::test]
async fn revoke_managed_by_principal_cleans_up_and_blocks_resurrection() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let authority = Arc::new(MockAdmissionAuthority {
        allowed_principals: std::sync::RwLock::new(
            vec!["admin".to_string(), "admin2".to_string()]
                .into_iter()
                .collect(),
        ),
    });
    manager.set_authority(authority);
    let admin = test_actor("admin");
    let admin2 = test_actor("admin2");
    let (pty_manager, term_id, term_inc) = test_pty_manager();

    let managed1 = manager
        .create(
            "admin".into(),
            ArtifactSource::ManagedBrowser {
                principal: "admin".into(),
                profile_epoch: 1,
                browser_incarnation: 1,
            },
            term_id.clone(),
            term_inc,
            selection(),
        )
        .await
        .unwrap();
    let id1 = uuid::Uuid::parse_str(&managed1.artifact_id).unwrap();

    let managed2 = manager
        .create(
            "admin2".into(),
            ArtifactSource::ManagedBrowser {
                principal: "admin2".into(),
                profile_epoch: 1,
                browser_incarnation: 1,
            },
            term_id.clone(),
            term_inc,
            selection(),
        )
        .await
        .unwrap();
    let id2 = uuid::Uuid::parse_str(&managed2.artifact_id).unwrap();

    let coop = manager
        .create(
            "admin".into(),
            ArtifactSource::Cooperative,
            term_id,
            term_inc,
            selection(),
        )
        .await
        .unwrap();
    let id_coop = uuid::Uuid::parse_str(&coop.artifact_id).unwrap();

    // Revoke managed artifacts for admin
    manager
        .revoke_managed_by_principal("admin", Some(1))
        .await;

    // id1 is gone and cannot be uploaded or handed off
    assert!(!std::path::Path::new(&managed1.json_path).exists());
    assert!(matches!(
        manager.upload_png(id1, &admin, png()).await,
        Err(BrowserDebugError::NotFound)
    ));
    assert!(matches!(
        manager.execute_handoff(id1, &admin, &pty_manager).await,
        Err(AppError::BrowserDebug(BrowserDebugError::NotFound))
    ));

    // id2 (admin2) is preserved
    assert!(std::path::Path::new(&managed2.json_path).exists());
    assert!(manager.upload_png(id2, &admin2, png()).await.is_ok());

    // id_coop (admin's cooperative artifact) is preserved
    assert!(std::path::Path::new(&coop.json_path).exists());
    assert!(manager.upload_png(id_coop, &admin, png()).await.is_ok());
}

#[tokio::test]
async fn bounded_artifact_storage_limits() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    assert_eq!(manager.reserved_bytes(), 0);

    let res = manager
        .create(
            "user".into(),
            ArtifactSource::Cooperative,
            "shell:test".into(),
            1,
            selection(),
        )
        .await
        .unwrap();
    assert!(manager.reserved_bytes() > 0);
    let id = uuid::Uuid::parse_str(&res.artifact_id).unwrap();
    let actor = test_actor("user");
    manager.delete(id, &actor).await.unwrap();
    assert_eq!(manager.reserved_bytes(), 0);
}

#[tokio::test]
async fn concurrent_create_enforces_64_record_ceiling_atomically() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let mut handles = Vec::new();
    for _ in 0..80 {
        let mgr = manager.clone();
        handles.push(tokio::spawn(async move {
            mgr.create(
                "alice".into(),
                ArtifactSource::Cooperative,
                "shell:1".into(),
                1,
                selection(),
            )
            .await
        }));
    }
    let mut ok_count = 0usize;
    let mut too_large_count = 0usize;
    for h in handles {
        match h.await.unwrap() {
            Ok(_) => ok_count += 1,
            Err(BrowserDebugError::TooLarge) => too_large_count += 1,
            Err(other) => panic!("unexpected error: {other:?}"),
        }
    }
    assert_eq!(ok_count, MAX_GLOBAL_ARTIFACT_RECORDS);
    assert_eq!(too_large_count, 80 - MAX_GLOBAL_ARTIFACT_RECORDS);
    assert_eq!(manager.len().await, MAX_GLOBAL_ARTIFACT_RECORDS);
    assert!(manager.reserved_bytes() <= MAX_GLOBAL_ARTIFACT_BYTES);
}

#[tokio::test]
async fn concurrent_png_uploads_enforce_64mib_byte_ceiling_atomically() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let actor = test_actor("alice");
    let big_png = axum::body::Bytes::from(make_valid_png_with_idat_padding(3 * 1024 * 1024));

    let mut ids = Vec::new();
    for _ in 0..24 {
        let created = manager
            .create(
                "alice".into(),
                ArtifactSource::Cooperative,
                "shell:1".into(),
                1,
                selection(),
            )
            .await
            .unwrap();
        ids.push(uuid::Uuid::parse_str(&created.artifact_id).unwrap());
    }

    let mut handles = Vec::new();
    for id in ids {
        let mgr = manager.clone();
        let act = actor.clone();
        let bytes = big_png.clone();
        handles.push(tokio::spawn(async move { mgr.upload_png(id, &act, bytes).await }));
    }
    let mut ok_count = 0usize;
    let mut too_large_count = 0usize;
    for h in handles {
        match h.await.unwrap() {
            Ok(_) => ok_count += 1,
            Err(BrowserDebugError::TooLarge) => too_large_count += 1,
            Err(other) => panic!("unexpected upload error: {other:?}"),
        }
    }
    assert!(ok_count <= 21);
    assert!(too_large_count >= 3);
    assert!(manager.reserved_bytes() <= MAX_GLOBAL_ARTIFACT_BYTES);
}

#[tokio::test]
async fn create_managed_checked_rejects_demoted_or_missing_terminal_and_leaves_no_orphan_files() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let authority = Arc::new(MockAdmissionAuthority {
        allowed_principals: std::sync::RwLock::new(
            vec!["admin".to_string()].into_iter().collect(),
        ),
    });
    manager.set_authority(authority.clone());
    let admin = test_actor("admin");
    let (event_sink, _) = crate::pty::BroadcastEventSink::new(16);
    let pty_manager = crate::pty::PtySessionManager::new(Arc::new(event_sink));

    // Terminal doesn't exist -> IncarnationMismatch / NotFound, 0 bytes reserved, 0 files left
    let res = manager
        .create_managed_checked(
            &admin,
            ArtifactSource::ManagedBrowser {
                principal: "admin".into(),
                profile_epoch: 1,
                browser_incarnation: 1,
            },
            ("sess-1".into(), 1, 1),
            "shell:missing".into(),
            1,
            selection(),
            &pty_manager,
        )
        .await;
    assert!(matches!(res, Err(BrowserDebugError::IncarnationMismatch)));
    assert_eq!(manager.reserved_bytes(), 0);
    assert!(std::fs::read_dir(manager.root.path()).unwrap().next().is_none());

    // Demoted admin -> NotFound, 0 bytes reserved, 0 files left
    authority.allowed_principals.write().unwrap().clear();
    let demoted = manager
        .create_managed_checked(
            &admin,
            ArtifactSource::ManagedBrowser {
                principal: "admin".into(),
                profile_epoch: 1,
                browser_incarnation: 1,
            },
            ("sess-1".into(), 1, 1),
            "shell:missing".into(),
            1,
            selection(),
            &pty_manager,
        )
        .await;
    assert!(matches!(demoted, Err(BrowserDebugError::NotFound)));
    assert_eq!(manager.reserved_bytes(), 0);
}

fn make_valid_png_with_idat_padding(min_size: usize) -> Vec<u8> {
    let mut png = valid_png();
    // Append harmless ancillary tEXt chunk to hit target size while remaining valid PNG
    let pad = min_size.saturating_sub(png.len());
    if pad > 12 {
        let iend = png.split_off(png.len() - 12);
        let payload = vec![b'a'; pad - 12];
        append_chunk(&mut png, b"tEXt", &payload);
        png.extend_from_slice(&iend);
    }
    png
}

#[tokio::test]
async fn abort_during_create_and_upload_writes_releases_quota_and_cleans_disk() {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let actor = test_actor("alice");

    // 1. Abort create WHILE blocking write is paused AFTER persist_noclobber
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let gate = Arc::new((std::sync::Mutex::new(false), std::sync::Condvar::new()));
    let gate_clone = gate.clone();
    *manager._after_persist_before_publish_hook.write().unwrap() = Some(Arc::new(move || {
        let _ = entered_tx.send(());
        let (lock, cvar) = &*gate_clone;
        let mut go = lock.lock().unwrap();
        while !*go {
            go = cvar.wait(go).unwrap();
        }
    }));

    let mgr_create = manager.clone();
    let create_handle = tokio::spawn(async move {
        mgr_create
            .create(
                "alice".into(),
                ArtifactSource::Cooperative,
                "shell:test".into(),
                1,
                selection(),
            )
            .await
    });

    tokio::task::spawn_blocking(move || {
        entered_rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
    })
    .await
    .unwrap();

    // Abort create future while blocking write is stalled post-persist
    create_handle.abort();
    let _ = create_handle.await;
    // Quota must remain held while blocking task has not yet cleaned up!
    assert!(manager.reserved_bytes() > 0);

    // Release blocking write -> must delete published file and drop quota to 0
    {
        let (lock, cvar) = &*gate;
        *lock.lock().unwrap() = true;
        cvar.notify_all();
    }
    *manager._after_persist_before_publish_hook.write().unwrap() = None;

    wait_until(|| manager.reserved_bytes() == 0).await;
    assert_eq!(manager.len().await, 0);
    assert!(std::fs::read_dir(manager.root.path()).unwrap().next().is_none());

    // 2. Create a clean artifact, then abort upload_png while paused BEFORE persist_noclobber
    let created = manager
        .create(
            "alice".into(),
            ArtifactSource::Cooperative,
            "shell:test".into(),
            1,
            selection(),
        )
        .await
        .unwrap();
    let id = uuid::Uuid::parse_str(&created.artifact_id).unwrap();
    let base_reserved = manager.reserved_bytes();

    let (up_tx, up_rx) = std::sync::mpsc::channel();
    let gate2 = Arc::new((std::sync::Mutex::new(false), std::sync::Condvar::new()));
    let gate2_clone = gate2.clone();
    *manager._before_write_hook.write().unwrap() = Some(Arc::new(move || {
        let _ = up_tx.send(());
        let (lock, cvar) = &*gate2_clone;
        let mut go = lock.lock().unwrap();
        while !*go {
            go = cvar.wait(go).unwrap();
        }
    }));

    let mgr_upload = manager.clone();
    let actor_clone = actor.clone();
    let upload_handle = tokio::spawn(async move {
        mgr_upload.upload_png(id, &actor_clone, png()).await
    });

    tokio::task::spawn_blocking(move || {
        up_rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
    })
    .await
    .unwrap();

    upload_handle.abort();
    let _ = upload_handle.await;
    {
        let (lock, cvar) = &*gate2;
        *lock.lock().unwrap() = true;
        cvar.notify_all();
    }
    *manager._before_write_hook.write().unwrap() = None;

    // Both extra bytes and png_uploading flag must recover cleanly so retry upload succeeds!
    wait_until(|| manager.reserved_bytes() == base_reserved).await;
    let retry = manager.upload_png(id, &actor, png()).await;
    assert!(retry.is_ok(), "PNG retry after aborted upload failed: {retry:?}");
}
