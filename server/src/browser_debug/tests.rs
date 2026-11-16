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
    let handoff = manager
        .execute_handoff(id, &alice, &pty_manager)
        .await
        .unwrap();
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
        allowed_principals: std::sync::RwLock::new(vec!["admin".to_string()].into_iter().collect()),
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
                browser_incarnation: "inc-1".into(),
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
        manager
            .execute_handoff(managed_id, &admin_actor, &pty_manager)
            .await,
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
    assert!(manager
        .execute_handoff(coop_id, &admin_actor, &pty_manager)
        .await
        .is_ok());
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
                browser_incarnation: "inc-1".into(),
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
                browser_incarnation: "inc-1".into(),
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
        .await
        .unwrap();

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
        handles.push(tokio::spawn(async move {
            mgr.upload_png(id, &act, bytes).await
        }));
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
        allowed_principals: std::sync::RwLock::new(vec!["admin".to_string()].into_iter().collect()),
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
                browser_incarnation: "inc-1".into(),
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
    assert!(std::fs::read_dir(manager.root.path())
        .unwrap()
        .next()
        .is_none());

    // Demoted admin -> NotFound, 0 bytes reserved, 0 files left
    authority.allowed_principals.write().unwrap().clear();
    let demoted = manager
        .create_managed_checked(
            &admin,
            ArtifactSource::ManagedBrowser {
                principal: "admin".into(),
                profile_epoch: 1,
                browser_incarnation: "inc-1".into(),
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
        entered_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
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
    assert!(std::fs::read_dir(manager.root.path())
        .unwrap()
        .next()
        .is_none());

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
    let upload_handle =
        tokio::spawn(async move { mgr_upload.upload_png(id, &actor_clone, png()).await });

    tokio::task::spawn_blocking(move || {
        up_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
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
    assert!(
        retry.is_ok(),
        "PNG retry after aborted upload failed: {retry:?}"
    );
}

/// Parks `artifact_retired` after it announced itself, until the test releases it.
#[derive(Default)]
struct RetireGate {
    entered: tokio::sync::Notify,
    release: tokio::sync::Notify,
}

/// Authority whose live state can be flipped while a handoff waits for its locks.
struct FinalFenceAuthority {
    admitted: std::sync::atomic::AtomicBool,
    deadline_passed: std::sync::atomic::AtomicBool,
    epoch_live: std::sync::atomic::AtomicBool,
    /// The browser incarnation that is currently live (what `is_instance_live_sync` compares).
    live_incarnation: std::sync::Mutex<String>,
    fence_current: Arc<std::sync::atomic::AtomicBool>,
    current_navigation: std::sync::atomic::AtomicU64,
    retired: std::sync::Mutex<Vec<(String, uuid::Uuid)>>,
    /// When set, `artifact_retired` parks until released (a slow registration removal).
    retire_gate: std::sync::Mutex<Option<Arc<RetireGate>>>,
}

impl FinalFenceAuthority {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            admitted: true.into(),
            deadline_passed: false.into(),
            epoch_live: true.into(),
            live_incarnation: std::sync::Mutex::new("inc-1".to_string()),
            fence_current: Arc::new(true.into()),
            current_navigation: 1.into(),
            retired: Default::default(),
            retire_gate: Default::default(),
        })
    }
}

/// Selection fence whose published "no navigation observed" state can be flipped by a test.
struct TestFence(Arc<std::sync::atomic::AtomicBool>);

impl HandoffFence for TestFence {
    fn is_current(&self) -> bool {
        self.0.load(std::sync::atomic::Ordering::SeqCst)
    }
}

impl BrowserAdmissionAuthority for FinalFenceAuthority {
    fn check_managed_admission<'a>(
        &'a self,
        actor: &'a crate::api::auth::AuthenticatedActor,
        principal: &'a str,
        _profile_epoch: u64,
    ) -> BoxFuture<'a, bool> {
        let ok =
            actor.subject == principal && self.admitted.load(std::sync::atomic::Ordering::SeqCst);
        Box::pin(async move { ok })
    }

    fn revalidate_managed_handoff<'a>(
        &'a self,
        actor: &'a crate::api::auth::AuthenticatedActor,
        principal: &'a str,
        _profile_epoch: u64,
        _session_id: &'a str,
        navigation_revision: u64,
    ) -> BoxFuture<'a, bool> {
        let ok = actor.subject == principal
            && self.admitted.load(std::sync::atomic::Ordering::SeqCst)
            && self
                .current_navigation
                .load(std::sync::atomic::Ordering::SeqCst)
                == navigation_revision;
        Box::pin(async move { ok })
    }

    fn acquire_managed_selection_fence<'a>(
        &'a self,
        _principal: &'a str,
        _profile_epoch: u64,
        _session_id: &'a str,
        _navigation_revision: u64,
        _selection_revision: u64,
        _artifact_id: uuid::Uuid,
    ) -> BoxFuture<'a, Option<Box<dyn HandoffFence>>> {
        let fence = Box::new(TestFence(self.fence_current.clone())) as Box<dyn HandoffFence>;
        Box::pin(async move { Some(fence) })
    }

    fn final_handoff_sync_check(
        &self,
        _actor: &crate::api::auth::AuthenticatedActor,
        _principal: &str,
        _profile_epoch: u64,
        browser_incarnation: &str,
    ) -> bool {
        !self
            .deadline_passed
            .load(std::sync::atomic::Ordering::SeqCst)
            && self.epoch_live.load(std::sync::atomic::Ordering::SeqCst)
            && self.live_incarnation.lock().unwrap().as_str() == browser_incarnation
    }

    fn artifact_retired<'a>(
        &'a self,
        session_id: &'a str,
        artifact_id: uuid::Uuid,
    ) -> BoxFuture<'a, ()> {
        let gate = self.retire_gate.lock().unwrap().clone();
        Box::pin(async move {
            if let Some(gate) = gate {
                gate.entered.notify_one();
                gate.release.notified().await;
            }
            self.retired
                .lock()
                .unwrap()
                .push((session_id.to_string(), artifact_id));
        })
    }
}

async fn managed_artifact_for_final_fence() -> (
    BrowserDebugArtifactManager,
    Arc<FinalFenceAuthority>,
    crate::pty::PtySessionManager,
    crate::api::auth::AuthenticatedActor,
    uuid::Uuid,
    BrowserDebugArtifactResponse,
) {
    let manager = BrowserDebugArtifactManager::new().unwrap();
    let authority = FinalFenceAuthority::new();
    manager.set_authority(authority.clone());
    let (pty_manager, term_id, term_inc) = test_pty_manager();
    let actor = test_actor("admin");
    let created = manager
        .create_managed_checked(
            &actor,
            ArtifactSource::ManagedBrowser {
                principal: "admin".into(),
                profile_epoch: 1,
                browser_incarnation: "inc-1".into(),
            },
            ("sess".into(), 1, 1),
            term_id,
            term_inc,
            selection(),
            &pty_manager,
        )
        .await
        .unwrap();
    let id = uuid::Uuid::parse_str(&created.artifact_id).unwrap();
    (manager, authority, pty_manager, actor, id, created)
}

fn final_validation_hook(
    manager: &BrowserDebugArtifactManager,
    mutate: impl Fn() + Send + Sync + 'static,
) {
    let entries = manager.entries.clone();
    let mutate = Arc::new(mutate);
    *manager
        ._before_handoff_final_validation_hook
        .write()
        .unwrap() = Some(Arc::new(move || {
        let entries = entries.clone();
        let mutate = mutate.clone();
        Box::pin(async move {
            // The entry lock was acquired BEFORE final validation, so the lock wait can no
            // longer sit between validation and the PTY write.
            assert!(
                entries.try_read().is_err(),
                "entry lock must be held at final validation"
            );
            mutate();
        })
    }));
}

#[tokio::test]
async fn revocation_or_demotion_during_final_lock_waits_prevents_pty_write() {
    let (manager, authority, pty_manager, actor, id, _) = managed_artifact_for_final_fence().await;
    let flip = authority.clone();
    final_validation_hook(&manager, move || {
        flip.admitted
            .store(false, std::sync::atomic::Ordering::SeqCst);
    });
    assert!(matches!(
        manager.execute_handoff(id, &actor, &pty_manager).await,
        Err(AppError::BrowserDebug(BrowserDebugError::NotFound))
    ));

    // The artifact was never claimed: it can still be handed off once authority is current.
    *manager
        ._before_handoff_final_validation_hook
        .write()
        .unwrap() = None;
    authority
        .admitted
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(manager
        .execute_handoff(id, &actor, &pty_manager)
        .await
        .is_ok());
}

#[tokio::test]
async fn deadline_expiry_during_final_lock_waits_prevents_pty_write() {
    let (manager, authority, pty_manager, actor, id, _) = managed_artifact_for_final_fence().await;
    let flip = authority.clone();
    final_validation_hook(&manager, move || {
        flip.deadline_passed
            .store(true, std::sync::atomic::Ordering::SeqCst);
    });
    assert!(matches!(
        manager.execute_handoff(id, &actor, &pty_manager).await,
        Err(AppError::BrowserDebug(BrowserDebugError::NotFound))
    ));

    *manager
        ._before_handoff_final_validation_hook
        .write()
        .unwrap() = None;
    authority
        .deadline_passed
        .store(false, std::sync::atomic::Ordering::SeqCst);
    assert!(manager
        .execute_handoff(id, &actor, &pty_manager)
        .await
        .is_ok());
}

#[tokio::test]
async fn navigation_recorded_after_fence_snapshot_prevents_pty_write() {
    let (manager, authority, pty_manager, actor, id, _) = managed_artifact_for_final_fence().await;
    let flip = authority.clone();
    final_validation_hook(&manager, move || {
        flip.current_navigation
            .store(2, std::sync::atomic::Ordering::SeqCst);
    });
    assert!(matches!(
        manager.execute_handoff(id, &actor, &pty_manager).await,
        Err(AppError::BrowserDebug(BrowserDebugError::NotFound))
    ));

    *manager
        ._before_handoff_final_validation_hook
        .write()
        .unwrap() = None;
    authority
        .current_navigation
        .store(1, std::sync::atomic::Ordering::SeqCst);
    assert!(manager
        .execute_handoff(id, &actor, &pty_manager)
        .await
        .is_ok());
}

#[cfg(unix)]
#[tokio::test]
async fn ttl_expiry_retires_entry_into_charged_pending_cleanup_and_registration_once() {
    use std::os::unix::fs::PermissionsExt;
    let (manager, authority, _pty, _actor, id, created) = managed_artifact_for_final_fence().await;
    let charged = manager.reserved_bytes();
    manager
        .entries
        .write()
        .await
        .get_mut(&id)
        .unwrap()
        .expires_at = 0;

    let dir = std::path::Path::new(&created.json_path)
        .parent()
        .unwrap()
        .to_path_buf();
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o500)).unwrap();
    assert!(std::fs::File::create(dir.join("probe-denied")).is_err());
    manager.sweep_expired().await;
    assert_eq!(
        manager.len().await,
        0,
        "an expired entry is unreachable the moment it is retired"
    );
    assert_eq!(manager.pending_cleanup_count(), 1);
    assert_eq!(manager.reserved_bytes(), charged, "quota stays charged");
    assert!(std::path::Path::new(&created.json_path).exists());
    manager.sweep_expired().await;
    assert_eq!(manager.pending_cleanup_count(), 1);

    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    manager.sweep_expired().await;
    assert_eq!(manager.pending_cleanup_count(), 0);
    assert_eq!(manager.reserved_bytes(), 0);
    assert!(!std::path::Path::new(&created.json_path).exists());
    assert_eq!(
        *authority.retired.lock().unwrap(),
        vec![("sess".to_string(), id)],
        "the selection registration is retired exactly once"
    );
}

/// Holds the PTY mutex on a blocking thread until the returned sender fires (or drops).
async fn hold_pty_lock(pty: &crate::pty::PtySessionManager) -> std::sync::mpsc::Sender<()> {
    let (locked_tx, locked_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
    let pty = pty.clone();
    tokio::task::spawn_blocking(move || {
        pty.with_fleet_for_test(|_| {
            locked_tx.send(()).unwrap();
            let _ = release_rx.recv();
        })
    });
    tokio::task::spawn_blocking(move || {
        locked_rx
            .recv_timeout(std::time::Duration::from_secs(3))
            .expect("PTY lock was never taken")
    })
    .await
    .unwrap();
    release_tx
}

type HandoffTask = tokio::task::JoinHandle<Result<BrowserDebugHandoffResponse, AppError>>;

/// Starts a handoff and returns once its blocking worker is about to wait for the PTY lock
/// that the test holds. All async validations have completed by then, so only the check made
/// under the PTY lock can still observe what the test changes before releasing it.
async fn handoff_waiting_on_pty_lock(
    manager: &BrowserDebugArtifactManager,
    pty: &crate::pty::PtySessionManager,
    actor: &crate::api::auth::AuthenticatedActor,
    id: uuid::Uuid,
) -> (HandoffTask, std::sync::mpsc::Sender<()>) {
    let release = hold_pty_lock(pty).await;
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    *manager._before_pty_mutation_hook.write().unwrap() = Some(Arc::new(move || {
        let _ = entered_tx.send(());
    }));
    let task = {
        let (manager, pty, actor) = (manager.clone(), pty.clone(), actor.clone());
        tokio::spawn(async move { manager.execute_handoff(id, &actor, &pty).await })
    };
    tokio::task::spawn_blocking(move || {
        entered_rx
            .recv_timeout(std::time::Duration::from_secs(3))
            .expect("handoff never reached the PTY mutation boundary")
    })
    .await
    .unwrap();
    (task, release)
}

fn pty_has_reference(pty: &crate::pty::PtySessionManager, term_id: &str) -> bool {
    pty.get_buffer(term_id)
        .unwrap_or_default()
        .contains("browser-debug artifact")
}

/// Runs a handoff parked on the PTY lock, applies `change`, releases the lock and expects the
/// write to be denied; then restores authority and expects the unclaimed artifact to succeed.
async fn assert_pty_lock_wait_denies_write_via(
    change: impl FnOnce(&BrowserDebugArtifactManager, &FinalFenceAuthority),
    restore: impl FnOnce(&BrowserDebugArtifactManager, &FinalFenceAuthority),
) {
    let (manager, authority, pty, actor, id, _) = managed_artifact_for_final_fence().await;
    let (task, release) = handoff_waiting_on_pty_lock(&manager, &pty, &actor, id).await;
    change(&manager, &authority);
    release.send(()).unwrap();
    assert!(matches!(
        task.await.unwrap(),
        Err(AppError::BrowserDebug(BrowserDebugError::NotFound))
    ));
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    assert!(
        !pty_has_reference(&pty, "shell:test"),
        "a handoff denied under the PTY lock must not write"
    );

    *manager._before_pty_mutation_hook.write().unwrap() = None;
    restore(&manager, &authority);
    assert!(manager.execute_handoff(id, &actor, &pty).await.is_ok());
    wait_until(|| pty_has_reference(&pty, "shell:test")).await;
}

async fn assert_pty_lock_wait_change_denies_write(
    change: impl FnOnce(&FinalFenceAuthority),
    restore: impl FnOnce(&FinalFenceAuthority),
) {
    assert_pty_lock_wait_denies_write_via(|_, auth| change(auth), |_, auth| restore(auth)).await;
}

#[tokio::test]
async fn handoff_waiting_for_the_pty_lock_still_writes_when_nothing_changed() {
    let (manager, _authority, pty, actor, id, _) = managed_artifact_for_final_fence().await;
    let (task, release) = handoff_waiting_on_pty_lock(&manager, &pty, &actor, id).await;
    assert!(!task.is_finished(), "the worker is blocked on the PTY lock");
    release.send(()).unwrap();
    assert!(task.await.unwrap().is_ok());
    wait_until(|| pty_has_reference(&pty, "shell:test")).await;
}

#[tokio::test]
async fn deadline_passing_during_the_pty_lock_wait_denies_the_write() {
    assert_pty_lock_wait_change_denies_write(
        |auth| {
            auth.deadline_passed
                .store(true, std::sync::atomic::Ordering::SeqCst)
        },
        |auth| {
            auth.deadline_passed
                .store(false, std::sync::atomic::Ordering::SeqCst)
        },
    )
    .await;
}

#[tokio::test]
async fn reset_epoch_advancing_during_the_pty_lock_wait_denies_the_write() {
    assert_pty_lock_wait_change_denies_write(
        |auth| {
            auth.epoch_live
                .store(false, std::sync::atomic::Ordering::SeqCst)
        },
        |auth| {
            auth.epoch_live
                .store(true, std::sync::atomic::Ordering::SeqCst)
        },
    )
    .await;
}

#[tokio::test]
async fn navigation_observed_during_the_pty_lock_wait_denies_the_write() {
    assert_pty_lock_wait_change_denies_write(
        |auth| {
            auth.fence_current
                .store(false, std::sync::atomic::Ordering::SeqCst)
        },
        |auth| {
            auth.fence_current
                .store(true, std::sync::atomic::Ordering::SeqCst)
        },
    )
    .await;
}

#[tokio::test]
async fn artifact_expiring_during_the_pty_lock_wait_denies_the_write() {
    let (manager, _authority, pty, actor, id, _) = managed_artifact_for_final_fence().await;
    manager
        .entries
        .write()
        .await
        .get_mut(&id)
        .unwrap()
        .expires_at = chrono::Utc::now().timestamp_millis() + 800;
    let (task, release) = handoff_waiting_on_pty_lock(&manager, &pty, &actor, id).await;
    tokio::time::sleep(std::time::Duration::from_millis(900)).await;
    release.send(()).unwrap();
    assert!(matches!(
        task.await.unwrap(),
        Err(AppError::BrowserDebug(BrowserDebugError::NotFound))
    ));
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    assert!(!pty_has_reference(&pty, "shell:test"));
}

#[tokio::test]
async fn login_revocation_published_during_the_pty_lock_wait_denies_the_write() {
    assert_pty_lock_wait_denies_write_via(
        |manager, _| manager.publish_revocation("admin"),
        // A handoff that starts after the revocation captures the new epoch.
        |_, _| {},
    )
    .await;
}

#[tokio::test]
async fn retired_browser_incarnation_during_the_pty_lock_wait_denies_the_write() {
    assert_pty_lock_wait_denies_write_via(
        |_, auth| *auth.live_incarnation.lock().unwrap() = "inc-2".to_string(),
        |_, auth| *auth.live_incarnation.lock().unwrap() = "inc-1".to_string(),
    )
    .await;
}

#[tokio::test]
async fn principal_fence_during_the_pty_lock_wait_denies_the_write() {
    let (manager, _authority, pty, actor, id, _) = managed_artifact_for_final_fence().await;
    let (task, release) = handoff_waiting_on_pty_lock(&manager, &pty, &actor, id).await;

    // Demotion / reset fence: the revoker queues on the entry lock the parked handoff owns, yet
    // its revocation is already published and must deny the write the handoff makes later.
    let revoker = {
        let manager = manager.clone();
        tokio::spawn(async move { manager.revoke_managed_by_principal("admin", None).await })
    };
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    assert!(
        !revoker.is_finished(),
        "the revoker waits for the entry lock"
    );

    release.send(()).unwrap();
    assert!(matches!(
        task.await.unwrap(),
        Err(AppError::BrowserDebug(BrowserDebugError::NotFound))
    ));
    revoker.await.unwrap().unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    assert!(
        !pty_has_reference(&pty, "shell:test"),
        "a revoked principal's handoff must not write"
    );
    assert_eq!(manager.len().await, 0);
}

#[tokio::test]
async fn abandoned_handoff_never_writes_and_releases_its_guards() {
    let (manager, _authority, pty, actor, id, _) = managed_artifact_for_final_fence().await;
    let (task, release) = handoff_waiting_on_pty_lock(&manager, &pty, &actor, id).await;

    // The caller disappears while the worker is parked on the PTY lock; nothing else changed.
    task.abort();
    let _ = task.await;
    assert!(
        manager.entries.try_write().is_err(),
        "the parked worker still owns the entry lock"
    );

    release.send(()).unwrap();
    wait_until(|| manager.entries.try_write().is_ok()).await;
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    assert!(
        !pty_has_reference(&pty, "shell:test"),
        "a handoff whose caller is gone must not write"
    );

    // The artifact was never claimed.
    *manager._before_pty_mutation_hook.write().unwrap() = None;
    assert!(manager.execute_handoff(id, &actor, &pty).await.is_ok());
    wait_until(|| pty_has_reference(&pty, "shell:test")).await;
}

#[tokio::test]
async fn cancelled_retirement_still_drops_the_selection_registration_exactly_once() {
    let (manager, authority, _pty, actor, id, _) = managed_artifact_for_final_fence().await;
    let gate = Arc::new(RetireGate::default());
    *authority.retire_gate.lock().unwrap() = Some(gate.clone());

    let deleter = {
        let (manager, actor) = (manager.clone(), actor.clone());
        tokio::spawn(async move { manager.delete(id, &actor).await })
    };
    gate.entered.notified().await;
    deleter.abort();
    let _ = deleter.await;
    assert_eq!(manager.pending_cleanup_count(), 1, "files stay owned");
    assert!(authority.retired.lock().unwrap().is_empty());

    // The removal runs on a detached task, so cancelling its caller cannot skip it.
    gate.release.notify_one();
    wait_until(|| authority.retired.lock().unwrap().len() == 1).await;

    manager.retry_pending_cleanups(Some("admin")).await.unwrap();
    assert_eq!(manager.pending_cleanup_count(), 0);
    assert_eq!(manager.reserved_bytes(), 0);
    assert_eq!(
        *authority.retired.lock().unwrap(),
        vec![("sess".to_string(), id)],
        "the registration is dropped exactly once across the retry"
    );
}
