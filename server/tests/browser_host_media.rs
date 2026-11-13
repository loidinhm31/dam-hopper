use std::sync::Arc;
use std::time::Duration;

use dam_hopper_server::browser_host::diagnostics::{global_memory_controller, TrackedBhjfFrame};
use dam_hopper_server::browser_host::media::{ViewerCreditController, MAX_OUTSTANDING_PER_VIEWER};
use dam_hopper_server::browser_host::protocol::{
    pack_bhjf_frame, unpack_bhjf_frame, TargetFrameHeader, TargetGeometry,
};
use tokio::time::sleep;
use uuid::Uuid;

fn make_dummy_jpeg() -> Vec<u8> {
    // Minimal valid JPEG header with SOF0 (64x64) and EOI
    let mut data = vec![
        0xFF, 0xD8, // SOI
        0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x40, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11,
        0x01, 0x03, 0x11, 0x01, // SOF0 (64x64, 3 components)
        0xFF, 0xD9, // EOI
    ];
    // Pad to valid payload
    data.resize(64, 0);
    data[62] = 0xFF;
    data[63] = 0xD9;
    data
}

fn make_test_frame(run_id: &str, v_epoch: &str, seq: &str) -> TrackedBhjfFrame {
    let header = TargetFrameHeader {
        browser_session_id: Uuid::new_v4().to_string(),
        browser_incarnation: Uuid::new_v4().to_string(),
        profile_epoch: "1".to_string(),
        producer_run: run_id.to_string(),
        viewport_epoch: v_epoch.to_string(),
        frame_seq: seq.to_string(),
        width: 64,
        height: 64,
        capture_time_unix_ms: 1000,
        geometry: TargetGeometry {
            css_width: 64.0,
            css_height: 64.0,
            offset_top: 0.0,
            scroll_x: 0.0,
            scroll_y: 0.0,
            page_scale: 1.0,
            visual_offset_x: 0.0,
            visual_offset_y: 0.0,
            dpr: 1.0,
        },
        input_trusted: true,
    };
    let bytes = pack_bhjf_frame(&header, &make_dummy_jpeg()).expect("pack frame");
    let res = global_memory_controller()
        .try_reserve(bytes.len())
        .expect("reserve frame memory");
    TrackedBhjfFrame::new(bytes, res)
}

#[tokio::test]
async fn test_credit_controller_bounds_and_governor() {
    let sub = Uuid::new_v4().to_string();
    let run = Uuid::new_v4().to_string();
    let mut ctrl = ViewerCreditController::new(sub.clone());

    let frame1 = make_test_frame(&run, "1", "1");
    let frame2 = make_test_frame(&run, "1", "2");
    let frame3 = make_test_frame(&run, "1", "3");
    let frame4 = make_test_frame(&run, "1", "4");

    // 1. First frame sent immediately
    let res1 = ctrl.on_incoming_frame(frame1);
    assert!(res1.is_some(), "first frame should be dispatched");
    assert_eq!(ctrl.outstanding_count(), 1);

    // 2. Immediate second frame throttled by 100ms governor -> buffered in pending
    let res2 = ctrl.on_incoming_frame(frame2.clone());
    assert!(
        res2.is_none(),
        "frame within 100ms should be held in pending"
    );
    assert_eq!(ctrl.outstanding_count(), 1);
    assert!(ctrl.has_pending());

    // 3. Wait > 100ms -> incoming third frame replaces pending and dispatches since outstanding (1) < 2
    sleep(Duration::from_millis(110)).await;
    let res3 = ctrl.on_incoming_frame(frame3);
    assert!(
        res3.is_some(),
        "frame after 100ms with credit should be dispatched"
    );
    assert_eq!(ctrl.outstanding_count(), 2);

    // 4. Fourth frame arrives while outstanding == 2 -> must be held in pending (capacity capped at 2 outstanding)
    sleep(Duration::from_millis(110)).await;
    let res4 = ctrl.on_incoming_frame(frame4);
    assert!(
        res4.is_none(),
        "when outstanding == 2, incoming frame must be pending"
    );
    assert_eq!(ctrl.outstanding_count(), 2);
    assert!(ctrl.has_pending());

    // 5. ACK for frame 1 frees 1 credit and unblocks dispatch of pending frame 4!
    let unblocked = ctrl.on_credit_return(&sub, &run, "1", "1", false);
    assert!(
        unblocked.is_some(),
        "ACKing frame 1 should release pending frame"
    );
    assert_eq!(ctrl.outstanding_count(), 2); // Frame 3 + Frame 4 now outstanding
    assert!(!ctrl.has_pending());
    assert_eq!(ctrl.total_acked, 1);
}
#[tokio::test]
async fn test_settled_frame_governor_flush() {
    let sub = Uuid::new_v4().to_string();
    let run = Uuid::new_v4().to_string();
    let mut ctrl = ViewerCreditController::new(sub.clone());

    let frame1 = make_test_frame(&run, "1", "1");
    let frame2 = make_test_frame(&run, "1", "2");

    // 1. Frame 1 dispatched
    let res1 = ctrl.on_incoming_frame(frame1);
    assert!(res1.is_some());

    // 2. Immediate frame 2 buffered as pending
    let res2 = ctrl.on_incoming_frame(frame2);
    assert!(res2.is_none());
    assert!(ctrl.has_pending());

    // 3. ACK for frame 1 arrives immediately (< 100ms)
    let _ = ctrl.on_credit_return(&sub, &run, "1", "1", false);
    // Because last_delivery was < 100ms ago, pending frame is still held
    assert!(ctrl.has_pending());
    assert_eq!(ctrl.outstanding_count(), 0);

    // 4. Time passes (> 100ms), page settles and no new frames or ACKs arrive
    sleep(Duration::from_millis(110)).await;

    // 5. Governor flush ticker picks up pending settled frame!
    let flushed = ctrl.check_flush_pending();
    assert!(
        flushed.is_some(),
        "settled pending frame must be flushed by governor"
    );
    assert!(!ctrl.has_pending());
    assert_eq!(ctrl.outstanding_count(), 1);
}

#[tokio::test]
async fn test_credit_controller_foreign_socket_rejection() {
    let sub1 = Uuid::new_v4().to_string();
    let sub2 = Uuid::new_v4().to_string();
    let run = Uuid::new_v4().to_string();
    let mut ctrl = ViewerCreditController::new(sub1.clone());

    let frame1 = make_test_frame(&run, "1", "1");
    let _ = ctrl.on_incoming_frame(frame1);
    assert_eq!(ctrl.outstanding_count(), 1);

    // Attempt to ACK with foreign subscription sub2
    let res = ctrl.on_credit_return(&sub2, &run, "1", "1", false);
    assert!(res.is_none());
    // Credit is NOT freed
    assert_eq!(ctrl.outstanding_count(), 1);
    assert_eq!(ctrl.total_acked, 0);

    // Legitimate ACK with matching sub1 frees credit
    let res_ok = ctrl.on_credit_return(&sub1, &run, "1", "1", false);
    assert!(res_ok.is_none()); // No pending frame to unblock
    assert_eq!(ctrl.outstanding_count(), 0);
    assert_eq!(ctrl.total_acked, 1);
}

#[tokio::test]
async fn test_stalled_viewer_isolation_between_two_viewers() {
    let run = Uuid::new_v4().to_string();
    let sub_active = Uuid::new_v4().to_string();
    let sub_stalled = Uuid::new_v4().to_string();

    let mut ctrl_active = ViewerCreditController::new(sub_active.clone());
    let mut ctrl_stalled = ViewerCreditController::new(sub_stalled.clone());

    // Stream 10 frames
    for i in 1..=10 {
        sleep(Duration::from_millis(110)).await;
        let frame = make_test_frame(&run, "1", &i.to_string());

        // Stalled viewer never ACKs
        let _ = ctrl_stalled.on_incoming_frame(frame.clone());

        // Active viewer ACKs every frame it receives
        if let Some(delivered) = ctrl_active.on_incoming_frame(frame) {
            let (hdr, _) = unpack_bhjf_frame(delivered.data()).unwrap();
            let _ = ctrl_active.on_credit_return(
                &sub_active,
                &hdr.producer_run,
                &hdr.viewport_epoch,
                &hdr.frame_seq,
                false,
            );
        }
    }

    // Active viewer received all 10 frames because it ACKed promptly
    assert_eq!(ctrl_active.total_delivered, 10);
    assert_eq!(ctrl_active.total_acked, 10);
    assert_eq!(ctrl_active.outstanding_count(), 0);

    // Stalled viewer stopped at max 2 outstanding + 1 pending, and NEVER blocked active viewer!
    assert_eq!(ctrl_stalled.outstanding_count(), MAX_OUTSTANDING_PER_VIEWER);
    assert!(ctrl_stalled.has_pending());
    assert_eq!(ctrl_stalled.total_delivered, 2);
}

#[tokio::test]
async fn test_identical_full_bhjf_buffer_shared_without_app_copies() {
    let run = Uuid::new_v4().to_string();
    let frame = make_test_frame(&run, "1", "1");

    // Bytes clone is O(1) atomic refcount increment
    let clone1 = frame.clone();
    let clone2 = frame.clone();

    assert_eq!(frame.data().as_ptr(), clone1.data().as_ptr());
    assert_eq!(frame.data().as_ptr(), clone2.data().as_ptr());

    let (hdr1, _) = unpack_bhjf_frame(clone1.data()).unwrap();
    let (hdr2, _) = unpack_bhjf_frame(clone2.data()).unwrap();

    // Headers contain only target/process/producer values, zero per-viewer or subscription data
    assert_eq!(hdr1.producer_run, run);
    assert_eq!(hdr2.producer_run, run);
    assert_eq!(hdr1.frame_seq, "1");
}

#[tokio::test]
async fn test_full_ticket_pairing_and_lease_scoping_journey() {
    use dam_hopper_server::browser_host::attachments::{
        AttachmentManager, AttachmentPurpose, IssueTicketRequest,
    };
    use dam_hopper_server::browser_host::input::SessionInputManager;

    let att_manager = AttachmentManager::new();
    let input_manager = SessionInputManager::new();

    let session_id = Uuid::new_v4().to_string();
    let viewer_a = "viewer-a";
    let viewer_b = "viewer-b";
    let sub_a = Uuid::new_v4().to_string();
    let _sub_b = Uuid::new_v4().to_string();
    let inc = Uuid::new_v4().to_string();

    // 1. Issue media and control tickets for viewer A
    let media_req_a = IssueTicketRequest {
        purpose: AttachmentPurpose::Media,
        browser_session_id: Some(session_id.clone()),
        viewer_id: Some(viewer_a.to_string()),
        subscription_epoch: Some(sub_a.clone()),
        browser_incarnation: inc.clone(),
        profile_epoch: 1,
    };
    let control_req_a = IssueTicketRequest {
        purpose: AttachmentPurpose::Control,
        browser_session_id: Some(session_id.clone()),
        viewer_id: Some(viewer_a.to_string()),
        subscription_epoch: Some(sub_a.clone()),
        browser_incarnation: inc.clone(),
        profile_epoch: 1,
    };

    let admission = dam_hopper_server::browser_host::auth::BrowserAdmission {
        principal: "alice".to_string(),
        is_dev: false,
        session_id: Some("auth-sess-1".to_string()),
        auth_version: Some(1),
        credential_version: Some(1),
        effective_deadline: None,
    };
    let media_res_a = att_manager
        .issue_ticket(&admission, &media_req_a, None)
        .await
        .unwrap();
    let control_res_a = att_manager
        .issue_ticket(&admission, &control_req_a, None)
        .await
        .unwrap();

    // 2. Consume both tickets
    let admitted_media = att_manager
        .consume_ticket(&media_res_a.ticket, AttachmentPurpose::Media, None)
        .await
        .unwrap();
    let admitted_control = att_manager
        .consume_ticket(&control_res_a.ticket, AttachmentPurpose::Control, None)
        .await
        .unwrap();

    // 3. Register connections and verify pairing: the pair owns ONE global permit, taken by the
    //    first socket and shared by its mate.
    static PAIR_COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let permit = || {
        dam_hopper_server::browser_host::media::ViewerPermit::try_acquire_in(&PAIR_COUNTER, 2)
            .map_err(|_| dam_hopper_server::browser_host::attachments::AttachmentError::ViewerCapacityExceeded(2))
    };
    let media_reg = att_manager
        .register_pair_connection(&admitted_media, permit)
        .await
        .unwrap();
    let ctrl_reg = att_manager
        .register_pair_connection(&admitted_control, || panic!("the mate must join the pair's permit"))
        .await
        .unwrap();
    let (conn_media, conn_ctrl) = (media_reg.connection_id, ctrl_reg.connection_id);
    assert_eq!(PAIR_COUNTER.load(std::sync::atomic::Ordering::SeqCst), 1);

    // 4. Viewer A acquires lease
    let (lease_tok_a, _) = input_manager
        .acquire_lease(viewer_a, "human")
        .await
        .unwrap();
    assert!(input_manager.is_lease_holder(viewer_a).await);
    assert!(!input_manager.is_lease_holder(viewer_b).await);

    // 5. Viewer B tries to revoke lease on exit -> must NOT revoke viewer A's lease! (W6 invariant)
    if input_manager.is_lease_holder(viewer_b).await {
        let _ = input_manager.revoke_lease().await;
    }
    // Viewer A is still the active lease holder!
    assert!(input_manager.is_lease_holder(viewer_a).await);

    // 6. Viewer A releases lease
    let _ = input_manager.release_lease(&lease_tok_a).await.unwrap();
    assert!(!input_manager.is_lease_holder(viewer_a).await);

    // 7. Cleanup connections
    att_manager.unregister_connection(conn_media).await;
    att_manager.unregister_connection(conn_ctrl).await;
}

#[tokio::test]
async fn test_live_axum_media_and_control_websocket_journey() {
    let _live = pair_live::live_guard().await;
    use dam_hopper_server::agent_store::AgentStoreService;
    use dam_hopper_server::api::browser_host::global_attachment_manager;
    use dam_hopper_server::api::build_router;
    use dam_hopper_server::browser_host::attachments::{AttachmentPurpose, IssueTicketRequest};
    use dam_hopper_server::browser_host::auth::BrowserAdmission;
    use dam_hopper_server::config::{DamHopperConfig, FeaturesConfig, GlobalConfig, WorkspaceInfo};
    use dam_hopper_server::crypto::DamHopperOpaqueSuite;
    use dam_hopper_server::diagnostics::DiagnosticStore;
    use dam_hopper_server::fs::FsSubsystem;
    use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
    use dam_hopper_server::state::AppState;
    use dam_hopper_server::tunnel::{CloudflaredDriver, TunnelSessionManager};
    use futures_util::{SinkExt, StreamExt};
    use opaque_ke::ServerSetup;
    use rand::rngs::OsRng;
    use tempfile::tempdir;
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    let tmp = tempdir().unwrap();
    let workspace_root = tmp.path().to_path_buf();
    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));
    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test".into(),
            root: workspace_root.display().to_string(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
        projects: vec![],
        features: FeaturesConfig::default(),
        ui: None,
        workspaces: None,
        config_path: workspace_root.join("dam-hopper.toml"),
    };
    let global_config = GlobalConfig::default();
    let agent_store = AgentStoreService::new(workspace_root.join(".dam-hopper/agent-store"));
    let fs = FsSubsystem::new(vec![]);
    let tunnel_manager =
        TunnelSessionManager::new(Arc::new(event_sink.clone()), Arc::new(CloudflaredDriver));
    let diagnostics = DiagnosticStore::new(workspace_root.join("diagnostics.jsonl"));

    let state = AppState::new(
        workspace_root,
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        "test-secret-media".to_string(),
        fs,
        None,
        true, // no_auth = true (dev mode)
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
    )
    .expect("test AppState");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let local_addr = listener.local_addr().unwrap();
    state
        .record_bound_listener(local_addr)
        .expect("record listener");
    let router = build_router(state);
    tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap();
    });

    let inc = Uuid::new_v4().to_string();
    let (dto, _) = dam_hopper_server::api::browser_host::global_session_registry()
        .insert_running_for_test(
            "dev-user",
            true,
            &inc,
            1,
            &dam_hopper_server::browser_host::session::CreateSessionRequest {
                creation_key: Uuid::new_v4().to_string(),
                url: "about:blank".to_string(),
                viewport: dam_hopper_server::browser_host::session::ViewportRequest {
                    width: 1280,
                    height: 900,
                    dpr: 1.0,
                },
            },
            &[],
        )
        .await
        .unwrap();
    let session_id = dto.browser_session_id;
    pair_live::attach_mock_producer(&session_id, &inc).await;
    let viewer_id = "test-viewer-ws";
    let sub_epoch = Uuid::new_v4().to_string();

    let att_manager = global_attachment_manager();
    let admission = BrowserAdmission {
        principal: "dev-user".to_string(),
        is_dev: true,
        session_id: Some("dev-sess".to_string()),
        auth_version: Some(1),
        credential_version: Some(1),
        effective_deadline: None,
    };

    // 1. Issue media and control tickets
    let media_req = IssueTicketRequest {
        purpose: AttachmentPurpose::Media,
        browser_session_id: Some(session_id.clone()),
        viewer_id: Some(viewer_id.to_string()),
        subscription_epoch: Some(sub_epoch.clone()),
        browser_incarnation: inc.clone(),
        profile_epoch: 1,
    };
    let control_req = IssueTicketRequest {
        purpose: AttachmentPurpose::Control,
        browser_session_id: Some(session_id.clone()),
        viewer_id: Some(viewer_id.to_string()),
        subscription_epoch: Some(sub_epoch.clone()),
        browser_incarnation: inc.clone(),
        profile_epoch: 1,
    };
    let media_tkt = att_manager
        .issue_ticket(&admission, &media_req, None)
        .await
        .unwrap();
    let control_tkt = att_manager
        .issue_ticket(&admission, &control_req, None)
        .await
        .unwrap();

    // 2. Connect media WebSocket
    let media_url = format!("ws://{local_addr}/api/browser/media");
    let mut req = media_url.into_client_request().unwrap();
    req.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        format!(
            "damhopper.browser.media.v1, damhopper.ticket.{}",
            media_tkt.ticket
        )
        .parse()
        .unwrap(),
    );
    let (mut media_ws, media_resp) = connect_async(req).await.expect("media ws connect failed");
    // Verify subprotocol negotiated
    assert_eq!(
        media_resp
            .headers()
            .get("Sec-WebSocket-Protocol")
            .and_then(|v| v.to_str().ok()),
        Some("damhopper.browser.media.v1")
    );

    // 3. Connect control WebSocket
    let control_url = format!("ws://{local_addr}/api/browser/control");
    let mut ctrl_req = control_url.into_client_request().unwrap();
    ctrl_req.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        format!(
            "damhopper.browser.control.v1, damhopper.ticket.{}",
            control_tkt.ticket
        )
        .parse()
        .unwrap(),
    );
    let (mut ctrl_ws, ctrl_resp) = connect_async(ctrl_req)
        .await
        .expect("control ws connect failed");
    assert_eq!(
        ctrl_resp
            .headers()
            .get("Sec-WebSocket-Protocol")
            .and_then(|v| v.to_str().ok()),
        Some("damhopper.browser.control.v1")
    );

    // 4. Verify initial Status message on control WS and live media feedback on media WS
    let init_msg = tokio::time::timeout(Duration::from_secs(3), ctrl_ws.next())
        .await
        .expect("timeout on control ws initial status")
        .expect("control ws stream closed")
        .expect("control ws message error");
    let text = init_msg.into_text().expect("status text message");
    assert!(text.contains("\"status\"") || text.contains("\"inputAvailable\""));

    let hb_payload = serde_json::json!({
        "kind": "heartbeat",
        "subscriptionEpoch": sub_epoch,
        "visible": true,
        "telemetry": {
            "sampleMs": 5000,
            "decodedFrames": 12,
            "replacedFrames": 1,
            "decodeMsEwma": 4.25
        }
    })
    .to_string();
    media_ws
        .send(tokio_tungstenite::tungstenite::Message::Text(
            hb_payload.into(),
        ))
        .await
        .expect("send media heartbeat telemetry");

    let diag = dam_hopper_server::browser_host::diagnostics::global_stream_diagnostics();
    for _ in 0..20 {
        if let Some(snap) = diag.viewer_snapshot(&sub_epoch) {
            if snap.client_corroboration.decoded_frames_total == 12
                && snap.control_bytes_written > 0
            {
                break;
            }
        }
        sleep(Duration::from_millis(25)).await;
    }
    let live_snap = diag
        .viewer_snapshot(&sub_epoch)
        .expect("live viewer snapshot registered");
    assert_eq!(live_snap.browser_session_id, session_id);
    assert_eq!(live_snap.viewer_id, viewer_id);
    assert!(live_snap.control_bytes_written > 0);
    assert_eq!(live_snap.client_corroboration.decoded_frames_total, 12);
    assert_eq!(live_snap.client_corroboration.replaced_frames_total, 1);
    assert_eq!(live_snap.client_corroboration.decode_ms_ewma, Some(4.25));

    // 5. Clean close and verify diagnostic snapshot removal on teardown
    let _ = media_ws.close(None).await;
    let _ = ctrl_ws.close(None).await;
    for _ in 0..20 {
        if diag.viewer_snapshot(&sub_epoch).is_none() {
            break;
        }
        sleep(Duration::from_millis(25)).await;
    }
    assert!(diag.viewer_snapshot(&sub_epoch).is_none());
}

#[tokio::test]
async fn test_custom_min_interval_and_audio_chunk_validation() {
    use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
    use base64::Engine;
    use dam_hopper_server::browser_host::protocol::{
        BrowserAudioChunk, ProducerAudioChunk, AUDIO_CHANNELS, AUDIO_ENCODING_PCM16LE,
        AUDIO_SAMPLE_RATE, MAX_AUDIO_BASE64_BYTES, MAX_AUDIO_PCM_BYTES,
    };

    let sub = Uuid::new_v4().to_string();
    let run = Uuid::new_v4().to_string();
    let interval_24fps = Duration::from_secs_f64(1.0 / 24.0);
    let mut ctrl = ViewerCreditController::with_min_interval(sub.clone(), interval_24fps);
    assert_eq!(ctrl.min_delivery_interval(), interval_24fps);

    let frame1 = make_test_frame(&run, "1", "1");
    let frame2 = make_test_frame(&run, "1", "2");
    assert!(ctrl.on_incoming_frame(frame1).is_some());
    assert!(ctrl.on_incoming_frame(frame2).is_none());
    assert!(ctrl.has_pending());

    let _ = ctrl.on_credit_return(&sub, &run, "1", "1", false);
    sleep(Duration::from_millis(45)).await;
    assert!(
        ctrl.check_flush_pending().is_some(),
        "24 FPS controller must flush pending frame after ~42ms"
    );

    // Valid 24 kHz mono PCM16LE chunk (480 samples = 960 bytes)
    let pcm_bytes = vec![0u8; 960];
    let b64 = BASE64_STANDARD.encode(&pcm_bytes);
    let prod_chunk = ProducerAudioChunk {
        browser_session_id: Uuid::new_v4().to_string(),
        browser_incarnation: Uuid::new_v4().to_string(),
        profile_epoch: "1".to_string(),
        audio_run: run.clone(),
        doc_epoch: 1,
        audio_seq: "1".to_string(),
        sample_rate: AUDIO_SAMPLE_RATE,
        channels: AUDIO_CHANNELS,
        encoding: AUDIO_ENCODING_PCM16LE.to_string(),
        data: std::sync::Arc::<str>::from(b64),
        reservation: None,
    };
    let env = prod_chunk.to_viewer_envelope(&sub);
    assert!(env.validate().is_ok());
    let json = serde_json::to_string(&env).expect("serialize audioChunk");
    let roundtrip: BrowserAudioChunk = serde_json::from_str(&json).expect("deserialize audioChunk");
    assert_eq!(roundtrip, env);
    assert_eq!(roundtrip.kind, "audioChunk");

    // Reject invalid kind, rate, channels, encoding, odd decoded bytes, or oversized payload
    let mut bad_rate = env.clone();
    bad_rate.sample_rate = 48_000;
    assert!(bad_rate.validate().is_err());

    let mut bad_seq = env.clone();
    bad_seq.audio_seq = "0".to_string();
    assert!(bad_seq.validate().is_err());

    let mut odd_pcm = env.clone();
    odd_pcm.data = std::sync::Arc::<str>::from(BASE64_STANDARD.encode([1u8, 2, 3]));
    assert!(odd_pcm.validate().is_err());

    let mut oversized = env.clone();
    oversized.data = std::sync::Arc::<str>::from("A".repeat(MAX_AUDIO_BASE64_BYTES + 4));
    assert!(oversized.validate().is_err());
    assert_eq!(MAX_AUDIO_PCM_BYTES, 4_800);
}

#[tokio::test]
async fn test_real_chromium_media_stealth_and_pcm_audio_bridge() {
    use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
    use base64::Engine;
    use chromiumoxide_cdp::cdp::browser_protocol::target::CreateTargetParams;
    use dam_hopper_server::browser_host::cdp::CdpClient;
    use dam_hopper_server::browser_host::process::{
        find_browser_executable, BrowserLaunchConfig, BrowserProcess,
    };
    use dam_hopper_server::browser_host::screencast::ScreencastProducer;
    use serde_json::json;
    use tempfile::tempdir;

    let exec = find_browser_executable(None).ok().or_else(|| {
        ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
            .into_iter()
            .map(std::path::PathBuf::from)
            .find(|p| p.is_file())
    });
    let Some(exec) = exec else {
        if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") {
            panic!("Required Chrome/Chromium executable not found on host");
        }
        eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
        return;
    };

    let tmp = tempdir().unwrap();
    let mut config = BrowserLaunchConfig::new(tmp.path().join("media-stealth-test-data"));
    config.executable_path = Some(exec);
    config.headless = true;

    let mut process = BrowserProcess::launch(config)
        .await
        .expect("browser launch failed");
    let client = CdpClient::connect(process.ws_endpoint())
        .await
        .expect("CDP connect failed");
    let target_res = client
        .send_typed(CreateTargetParams::builder().url("about:blank").build().unwrap(), None)
        .await
        .expect("Target.createTarget failed");

    let producer = ScreencastProducer::new(
        Uuid::new_v4().to_string(),
        Uuid::new_v4().to_string(),
        1,
        1,
        client.clone(),
        target_res.target_id.into(),
        TargetGeometry {
            css_width: 1280.0,
            css_height: 720.0,
            offset_top: 0.0,
            scroll_x: 0.0,
            scroll_y: 0.0,
            page_scale: 1.0,
            visual_offset_x: 0.0,
            visual_offset_y: 0.0,
            dpr: 1.0,
        },
    )
    .with_capture_policy(24, 75);

    let page_sid = producer.ensure_page_session().await.expect("page session");
    producer
        .apply_stealth_and_focus(&page_sid)
        .await
        .expect("apply stealth");

    let probe = client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    const v = document.createElement('video');
                    const a = document.createElement('audio');
                    const sym = Symbol.for('dh.a');
                    const fn = EventTarget.prototype[sym];
                    const desc = Object.getOwnPropertyDescriptor(EventTarget.prototype, sym);
                    const run = '11111111-2222-4333-8444-555555555555:1';

                    // Install a same-origin child iframe; accessing contentWindow installs the stealth bridge on it
                    const iframe = document.createElement('iframe');
                    document.body.appendChild(iframe);
                    const cw = iframe.contentWindow;

                    // Hook createScriptProcessor on parent and child to capture the real processors created by AudioNode.prototype.connect
                    const procs = [];
                    const hookAC = (win, label) => {
                        const AC = win.AudioContext || win.webkitAudioContext;
                        if (!AC) return null;
                        const origCreateSP = AC.prototype.createScriptProcessor;
                        AC.prototype.createScriptProcessor = function() {
                            const p = origCreateSP.apply(this, arguments);
                            procs.push({ ctx: this, proc: p, win: label });
                            return p;
                        };
                        return AC;
                    };
                    const AC = hookAC(window, 'parent');
                    const ChildAC = cw ? hookAC(cw, 'child') : null;

                    // 1. Connect ctx1 BEFORE fn('start', run) to prove pre-existing WebAudio graphs are activated by start/drain
                    const ctx1 = new AC({ sampleRate: 24000 });
                    const g1 = ctx1.createGain();
                    g1.connect(ctx1.destination);

                    fn('start', run);

                    // 2. Connect ctx2 in parent + cctx in child iframe AFTER start
                    const ctx2 = new AC({ sampleRate: 24000 });
                    const g2 = ctx2.createGain();
                    g2.connect(ctx2.destination);

                    const cctx = new ChildAC({ sampleRate: 24000 });
                    const cg = cctx.createGain();
                    cg.connect(cctx.destination);
                    fn('drain', run); // ensures child bridge is started and its pre/post nodes are tapped

                    // Feed 1200 samples (+0.20 each) simultaneously into all 3 tapped contexts (2 parent + 1 child)
                    const ch = new Float32Array(1200).fill(0.20);
                    const fakeEv = { inputBuffer: { numberOfChannels: 1, getChannelData: () => ch } };
                    for (const item of procs) {
                        if (typeof item.proc.onaudioprocess === 'function') {
                            item.proc.onaudioprocess(fakeEv);
                        }
                    }

                    const drained = fn('drain', run);

                    // 3. Stop run, then start a second run WITHOUT reconnecting graphs -> proves restart recovery
                    fn('stop', run);
                    const afterStop = fn('drain', run);
                    const run2 = '11111111-2222-4333-8444-555555555555:2';
                    fn('start', run2);
                    fn('drain', run2);
                    for (const item of procs) {
                        if (typeof item.proc.onaudioprocess === 'function') {
                            item.proc.onaudioprocess(fakeEv);
                        }
                    }
                    const drainedAfterRestart = fn('drain', run2);

                    // 4. Test AudioNode.prototype.disconnect cleanup
                    g1.disconnect();
                    g2.disconnect();
                    cg.disconnect();
                    fn('stop', run2);

                    return {
                        h264: v.canPlayType('video/mp4; codecs="avc1.42E01E"'),
                        webm: v.canPlayType('video/webm; codecs="vp9"'),
                        aac: a.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
                        mp3: a.canPlayType('audio/mpeg'),
                        unrelatedMime: v.canPlayType('application/x-not-mp4'),
                        unknownCodec: v.canPlayType('video/webm; codecs="unknown123"'),
                        crossedCodec: v.canPlayType('video/mp4; codecs="vp8"'),
                        crossedAudioCodec: v.canPlayType('audio/mpeg; codecs="avc1.42E01E"'),
                        mseH264: typeof MediaSource !== 'undefined' ? MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"') : true,
                        mseUnrelated: typeof MediaSource !== 'undefined' ? MediaSource.isTypeSupported('application/x-not-mp4') : false,
                        mseUnknownCodec: typeof MediaSource !== 'undefined' ? MediaSource.isTypeSupported('video/webm; codecs="unknown123"') : false,
                        mseWav: typeof MediaSource !== 'undefined' ? MediaSource.isTypeSupported('audio/wav') : false,
                        nonEnumerable: Boolean(desc && desc.enumerable === false),
                        parentProcCount: procs.filter((p) => p.win === 'parent').length,
                        childProcCount: procs.filter((p) => p.win === 'child').length,
                        drainedCount: drained.length,
                        firstChunkB64: drained[0] || '',
                        afterStopCount: afterStop.length,
                        restartedCount: drainedAfterRestart.length,
                    };
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("probe media stealth and bridge");

    let val = &probe["result"]["value"];
    assert_eq!(val["h264"], "probably");
    assert_eq!(val["webm"], "probably");
    assert_eq!(val["aac"], "probably");
    assert!(matches!(val["mp3"].as_str(), Some("probably" | "maybe")));
    assert_eq!(val["unrelatedMime"], "");
    assert_eq!(val["unknownCodec"], "");
    assert_eq!(val["crossedCodec"], "");
    assert_eq!(val["crossedAudioCodec"], "");
    assert_eq!(val["mseH264"], true);
    assert_eq!(val["mseUnrelated"], false);
    assert_eq!(val["mseUnknownCodec"], false);
    assert_eq!(val["mseWav"], false);
    assert_eq!(val["nonEnumerable"], true);
    assert!(val["parentProcCount"].as_u64().unwrap_or(0) >= 2, "both parent contexts (including pre-start ctx1) must be tapped");
    assert!(val["childProcCount"].as_u64().unwrap_or(0) >= 1, "child iframe context must be tapped");
    assert_eq!(
        val["drainedCount"], 1,
        "3 simultaneous 1200-sample sources (2 parent + 1 child) must mix into 1 chunk, not concatenate"
    );
    assert_eq!(val["afterStopCount"], 0);
    assert_eq!(val["restartedCount"], 1, "existing WebAudio graphs must recover after stop + start");
    let proc_count = 3u64;

    let b64 = val["firstChunkB64"].as_str().expect("first chunk base64");
    let decoded = BASE64_STANDARD.decode(b64).expect("decode PCM16 base64");
    // 1200 mixed samples * 2 bytes = 2400 bytes (NOT concatenated!)
    assert_eq!(decoded.len(), 2400);
    let expected_sample = (0.20f64 * (proc_count as f64) * 32767.0).round() as i16;
    let first_sample = i16::from_le_bytes([decoded[0], decoded[1]]);
    assert!(
        (first_sample - expected_sample).abs() <= 6,
        "expected summed sample ~{expected_sample} across {proc_count} sources, got {first_sample}"
    );

    // 5. Verify >16 sequential WebAudio contexts reclaim capacity on disconnect (C3-H4) and cross-origin postMessage relay fencing (C3-H2)
    let relay_probe = client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    const sym = Symbol.for('dh.a');
                    const fn = EventTarget.prototype[sym];
                    const run = '33333333-4444-4555-8666-777777777777:1';
                    const AC = window.AudioContext || window.webkitAudioContext;
                    fn('start', run);

                    // Connect and disconnect 17 contexts sequentially -> 18th must still tap and produce samples
                    const c18Procs = [];
                    const origSP = AC.prototype.createScriptProcessor;
                    for (let i = 0; i < 17; i++) {
                        const c = new AC({ sampleRate: 24000 });
                        const g = c.createGain();
                        g.connect(c.destination);
                        g.disconnect();
                        c.close().catch(() => {});
                    }
                    AC.prototype.createScriptProcessor = function() {
                        const p = origSP.apply(this, arguments);
                        c18Procs.push(p);
                        return p;
                    };
                    const c18 = new AC({ sampleRate: 24000 });
                    const g18 = c18.createGain();
                    g18.connect(c18.destination);
                    AC.prototype.createScriptProcessor = origSP;
                    const ch18 = new Float32Array(1200).fill(0.25);
                    for (const p of c18Procs) {
                        if (typeof p.onaudioprocess === 'function') {
                            p.onaudioprocess({ inputBuffer: { numberOfChannels: 1, getChannelData: () => ch18 } });
                        }
                    }
                    const c18Drained = fn('drain', run);
                    g18.disconnect();
                    c18.close().catch(() => {});

                    // Dispatch MessageEvents to verify cross-origin relay fencing and captureAt freshness:
                    // a) Foreign source (window itself, not a child frame) -> rejected
                    window.dispatchEvent(new MessageEvent('message', {
                        data: { __dhAudio: run, docId: 'foreign-doc', seq: 1, captureAt: Date.now(), pcm: new Array(600).fill(10000) },
                        source: window,
                    }));
                    const afterForeign = fn('drain', run);

                    // b) Seconds-old packet (captureAt 2000ms ago) when ring is idle -> rejected (NOT clamped to 500ms)
                    const cw = document.querySelector('iframe').contentWindow;
                    window.dispatchEvent(new MessageEvent('message', {
                        data: { __dhAudio: run, docId: 'child-doc-1', seq: 1, captureAt: Date.now() - 2000, pcm: new Array(600).fill(10000) },
                        source: cw,
                    }));
                    const afterStaleAge = fn('drain', run);

                    // c) Registered child iframe source with fresh captureAt + monotonic seq -> accepted
                    window.dispatchEvent(new MessageEvent('message', {
                        data: { __dhAudio: run, docId: 'child-doc-1', seq: 2, captureAt: Date.now(), pcm: new Array(600).fill(10000) },
                        source: cw,
                    }));
                    // Duplicate seq 2 -> rejected
                    window.dispatchEvent(new MessageEvent('message', {
                        data: { __dhAudio: run, docId: 'child-doc-1', seq: 2, captureAt: Date.now(), pcm: new Array(600).fill(10000) },
                        source: cw,
                    }));
                    const afterChildRelay = fn('drain', run);

                    // d) Rotate child docId with seq 1 -> retires child-doc-1; late child-doc-1 packet is rejected
                    window.dispatchEvent(new MessageEvent('message', {
                        data: { __dhAudio: run, docId: 'child-doc-2', seq: 1, captureAt: Date.now(), pcm: new Array(600).fill(8000) },
                        source: cw,
                    }));
                    const afterDoc2 = fn('drain', run);
                    window.dispatchEvent(new MessageEvent('message', {
                        data: { __dhAudio: run, docId: 'child-doc-1', seq: 3, captureAt: Date.now(), pcm: new Array(600).fill(8000) },
                        source: cw,
                    }));
                    const afterRetiredDoc1 = fn('drain', run);
                    fn('stop', run);
                    return {
                        c18DrainedCount: c18Drained.length,
                        foreignCount: afterForeign.length,
                        staleAgeCount: afterStaleAge.length,
                        childRelayCount: afterChildRelay.length,
                        doc2Count: afterDoc2.length,
                        retiredDoc1Count: afterRetiredDoc1.length,
                    };
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("probe relay and capacity reclamation");
    let rval = &relay_probe["result"]["value"];
    assert_eq!(rval["c18DrainedCount"], 1, "18th AudioContext must produce samples after prior 17 disconnected");
    assert_eq!(rval["foreignCount"], 0, "foreign window relay message must be rejected");
    assert_eq!(rval["staleAgeCount"], 0, "seconds-old relay packet must be rejected when horizon is idle");
    assert_eq!(rval["childRelayCount"], 1, "valid child frame relay message must be accepted");
    assert_eq!(rval["doc2Count"], 1, "new child document with seq 1 must be accepted");
    assert_eq!(rval["retiredDoc1Count"], 0, "late message from retired child document must be rejected");

    // 6. Real Chromium rendering end-to-end:
    //    Phase A: Isolated child-iframe OscillatorNode -> non-silent chunk -> disconnect -> silence
    let mut audio_rx = producer.subscribe_audio();
    client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    const iframe = document.querySelector('iframe');
                    const cw = iframe.contentWindow;
                    const ChildAC = cw.AudioContext || cw.webkitAudioContext;
                    const childCtx = new ChildAC({ sampleRate: 24000 });
                    const childOsc = childCtx.createOscillator();
                    const childGain = childCtx.createGain();
                    childGain.gain.value = 0.35;
                    childOsc.frequency.value = 660;
                    childOsc.connect(childGain);
                    childGain.connect(childCtx.destination);
                    childOsc.start();
                    if (childCtx.state === 'suspended') childCtx.resume();
                    window.__childLive = { childCtx, childOsc, childGain };
                    return true;
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("start real child iframe oscillator");

    producer
        .register_viewer_demand("viewer-live", "sub-live-1", true)
        .await;
    let child_chunk = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
        .await
        .expect("ScreencastProducer must emit real child-iframe OscillatorNode audio chunk within 2s")
        .expect("receive child ProducerAudioChunk");
    assert_eq!(child_chunk.audio_seq, "1");
    assert!(child_chunk.reservation.is_some(), "admitted ProducerAudioChunk must retain RAII MemoryReservation");
    let child_pcm = BASE64_STANDARD
        .decode(child_chunk.data.as_ref())
        .expect("decode child PCM");
    assert!(
        child_pcm.chunks_exact(2).any(|b| i16::from_le_bytes([b[0], b[1]]).abs() > 100),
        "real child-iframe OscillatorNode must produce non-silent PCM"
    );

    // Disconnect child oscillator and verify silence BEFORE starting parent <audio> element
    client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    window.__childLive.childGain.disconnect();
                    window.__childLive.childOsc.stop();
                    return true;
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("disconnect child oscillator");
    tokio::time::sleep(std::time::Duration::from_millis(120)).await;
    while audio_rx.try_recv().is_ok() {}
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(160), audio_rx.recv()).await.is_err(),
        "stream must be silent after disconnecting child oscillator"
    );

    // Phase B: Isolated real playing <audio> element (synthesized 24 kHz WAV Blob URL, zero oscillators) -> non-silent chunk -> pause -> silence
    let play_res = client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(async () => {
                    const numSamples = 24000;
                    const wavBuf = new ArrayBuffer(44 + numSamples * 2);
                    const view = new DataView(wavBuf);
                    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
                    writeStr(0, 'RIFF'); view.setUint32(4, 36 + numSamples * 2, true); writeStr(8, 'WAVE');
                    writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
                    view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
                    writeStr(36, 'data'); view.setUint32(40, numSamples * 2, true);
                    for (let i = 0; i < numSamples; i++) {
                        view.setInt16(44 + i * 2, Math.round(Math.sin(i * 0.15) * 14000), true);
                    }
                    const blob = new Blob([wavBuf], { type: 'audio/wav' });
                    const audioEl = document.createElement('audio');
                    audioEl.src = URL.createObjectURL(blob);
                    audioEl.loop = true;
                    document.body.appendChild(audioEl);
                    await audioEl.play();
                    window.__parentAudioEl = audioEl;
                    return !audioEl.paused;
                })()"#,
                "awaitPromise": true,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("start real <audio> element");
    assert_eq!(play_res["result"]["value"], true, "ordinary <audio> element must play without user gesture");

    let media_el_chunk = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
        .await
        .expect("ScreencastProducer must emit real <audio> element chunk via captureStream")
        .expect("receive <audio> ProducerAudioChunk");
    let media_el_pcm = BASE64_STANDARD
        .decode(media_el_chunk.data.as_ref())
        .expect("decode <audio> PCM");
    assert!(
        media_el_pcm.chunks_exact(2).any(|b| i16::from_le_bytes([b[0], b[1]]).abs() > 100),
        "isolated <audio> element captureStream must produce non-silent PCM"
    );
    // Verify dynamic element volume and mute without page reload (e.g. YouTube in-page controls)
    client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    window.__parentAudioEl.muted = true;
                    return true;
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("mute <audio> element");

    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    while audio_rx.try_recv().is_ok() {}
    let muted_recv = tokio::time::timeout(std::time::Duration::from_millis(250), audio_rx.recv()).await;
    assert!(
        muted_recv.is_err(),
        "muting playing media element must immediately silence stream without reload"
    );

    // Unmute <audio> element and set volume = 0.5
    client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    window.__parentAudioEl.muted = false;
                    window.__parentAudioEl.volume = 0.5;
                    return true;
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("unmute <audio> element with volume 0.5");

    let unmuted_chunk = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
        .await
        .expect("unmuting media element must immediately resume stream without reload")
        .expect("receive unmuted ProducerAudioChunk");
    let unmuted_pcm = BASE64_STANDARD
        .decode(unmuted_chunk.data.as_ref())
        .expect("decode unmuted PCM");
    assert!(
        unmuted_pcm.chunks_exact(2).any(|b| i16::from_le_bytes([b[0], b[1]]).abs() > 50),
        "unmuted media element must produce non-silent PCM at volume 0.5"
    );

    // Pause and remove <audio> element -> verify stream goes silent
    client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    window.__parentAudioEl.pause();
                    window.__parentAudioEl.remove();
                    return true;
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("pause <audio> element");

    tokio::time::sleep(std::time::Duration::from_millis(120)).await;
    while audio_rx.try_recv().is_ok() {}
    let post_disconnect = tokio::time::timeout(std::time::Duration::from_millis(180), audio_rx.recv()).await;
    assert!(
        post_disconnect.is_err(),
        "no audio chunks should be emitted after pausing and removing <audio> element"
    );

    // Phase C: Real nested cross-origin HTTP iframes (top about:blank -> http://localhost:{port}/child -> http://127.0.0.1:{port}/grandchild)
    // `localhost` and `127.0.0.1` are distinct origins from each other and from `about:blank`, exercising
    // real OOPIF Target.attachedToTarget stealth injection and 2-hop cross-origin `postMessage` audio relay.
    let xo_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let xo_port = xo_listener.local_addr().unwrap().port();
    let page_a_hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let coalesce_hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let page_a_hits_srv = page_a_hits.clone();
    let coalesce_hits_srv = coalesce_hits.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = xo_listener.accept().await else { break };
            let page_a_hits = page_a_hits_srv.clone();
            let coalesce_hits = coalesce_hits_srv.clone();
            tokio::spawn(async move {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                let mut buf = [0u8; 1024];
                let n = stream.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                if req.starts_with("GET /login") {
                    let loc = format!("http://127.0.0.1:{xo_port}/grandchild");
                    let resp = format!(
                        "HTTP/1.1 302 Found\r\nLocation: {loc}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    );
                    let _ = stream.write_all(resp.as_bytes()).await;
                    return;
                }
                if req.starts_with("GET /page-a") {
                    let hit = page_a_hits.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    if hit == 0 {
                        // First request to /page-a is delayed 220ms so Request B and Request A2
                        // are published AFTER A1 started (navStartMs < A2.requested_at_unix_ms)
                        tokio::time::sleep(std::time::Duration::from_millis(220)).await;
                    }
                } else if req.starts_with("GET /coalesce") {
                    let hit = coalesce_hits.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    if hit == 0 {
                        // First request to /coalesce is delayed 400ms so the second request to /coalesce
                        // cancels it in Chromium before it can commit
                        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                    }
                }
                let body = if req.starts_with("GET /grandchild")
                    || req.starts_with("GET /page-a")
                    || req.starts_with("GET /coalesce")
                {
                    r#"<!doctype html><html><body><script>
                        setTimeout(() => {
                            const AC = window.AudioContext || window.webkitAudioContext;
                            const ctx = new AC({ sampleRate: 24000 });
                            const osc = ctx.createOscillator();
                            const gain = ctx.createGain();
                            gain.gain.value = 0.4;
                            osc.frequency.value = 520;
                            osc.connect(gain);
                            gain.connect(ctx.destination);
                            osc.start();
                            if (ctx.state === 'suspended') ctx.resume();
                            window.__xoGrandchild = { ctx, osc, gain };
                        }, 40);
                    </script></body></html>"#
                        .to_string()
                } else {
                    format!(
                        r#"<!doctype html><html><body><iframe src="http://127.0.0.1:{xo_port}/grandchild"></iframe></body></html>"#
                    )
                };
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes()).await;
            });
        }
    });

    let xo_res = client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": format!(r#"(async () => {{
                    const outer = document.createElement('iframe');
                    outer.src = 'http://localhost:{xo_port}/child';
                    document.body.appendChild(outer);
                    await new Promise((r) => {{ outer.onload = r; setTimeout(r, 500); }});
                    await new Promise((r) => setTimeout(r, 150));
                    let isCrossOrigin = false;
                    try {{
                        void outer.contentWindow.EventTarget;
                    }} catch (_) {{
                        isCrossOrigin = true;
                    }}
                    window.__xoOuter = outer;
                    return isCrossOrigin;
                }})()"#),
                "awaitPromise": true,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("mount nested cross-origin HTTP iframes");
    assert_eq!(
        xo_res["result"]["value"], true,
        "http://localhost child iframe must be genuinely cross-origin (SecurityError on property access)"
    );

    let xo_chunk = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
        .await
        .expect("ScreencastProducer must emit nested cross-origin grandchild audio via 2-hop postMessage relay")
        .expect("receive nested cross-origin ProducerAudioChunk");
    let xo_pcm = BASE64_STANDARD
        .decode(xo_chunk.data.as_ref())
        .expect("decode nested cross-origin PCM");
    assert!(
        xo_pcm.chunks_exact(2).any(|b| i16::from_le_bytes([b[0], b[1]]).abs() > 100),
        "nested cross-origin grandchild oscillator must produce non-silent PCM across 2-hop relay"
    );

    // Remove outer cross-origin iframe -> verify stream goes silent
    client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    window.__xoOuter.remove();
                    return true;
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("remove nested cross-origin iframe");
    tokio::time::sleep(std::time::Duration::from_millis(120)).await;
    while audio_rx.try_recv().is_ok() {}
    let post_xo_remove = tokio::time::timeout(std::time::Duration::from_millis(180), audio_rx.recv()).await;
    assert!(
        post_xo_remove.is_err(),
        "no audio chunks should be emitted after removing nested cross-origin iframe"
    );

    // Phase D: Two superseding API navigation requests + delayed first native commit (C6-H6 & C7-H6)
    // 1. Start a live oscillator on the old page (epoch 1) and confirm it emits epoch 1 chunks
    client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    const AC = window.AudioContext || window.webkitAudioContext;
                    const ctx = new AC({ sampleRate: 24000 });
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    gain.gain.value = 0.35;
                    osc.frequency.value = 440;
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start();
                    if (ctx.state === 'suspended') ctx.resume();
                    window.__preNavOsc = { ctx, osc, gain };
                    return true;
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("start pre-navigation oscillator");
    let pre_nav_chunk = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
        .await
        .expect("receive pre-navigation chunk")
        .expect("pre-nav chunk");
    assert_eq!(pre_nav_chunk.doc_epoch, 1);

    // 2. Case 1 (C8-H6 & C10-H6): A -> B -> A supersession where API A1 requests epoch 2,
    //    pauses before CDP dispatch while API B (epoch 3) and API A2 (epoch 4) supersede,
    //    and then A1 dispatches with `dispatch_navigation_for_epoch(2, ...)` and commits!
    let url_a = format!("http://127.0.0.1:{xo_port}/page-a");
    producer.request_audio_doc_epoch(2);
    producer.request_audio_doc_epoch(3);
    producer.request_audio_doc_epoch(4);
    while audio_rx.try_recv().is_ok() {}
    // API A1 now dispatches late (after epoch 4 was already requested!) using its captured epoch 2:
    producer
        .dispatch_navigation_for_epoch(
            2,
            "Page.navigate",
            Some(json!({ "url": url_a.clone() })),
            &page_sid,
        )
        .await
        .expect("dispatch delayed API A1 at captured epoch 2");
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    while let Ok(c) = audio_rx.try_recv() {
        panic!(
            "delayed first-A commit in A -> B -> A must NOT emit audio under epoch 4: {:?}",
            c
        );
    }
    assert_eq!(
        producer.audio_doc_authority().committed_epoch,
        2,
        "API A1 commit must only advance committed_epoch to 2, never 4"
    );
    assert_eq!(
        producer.audio_doc_authority().active_committed_epoch(),
        None,
        "delayed first-A commit in A -> B -> A must keep epoch 4 fenced"
    );

    // 3. Now dispatch Request A2 (`dispatch_navigation_for_epoch(4, ...)` to the EXACT SAME URL `/page-a`, hit #2):
    //    verify fresh A2 commit recovers at `doc_epoch == 4`!
    producer
        .dispatch_navigation_for_epoch(
            4,
            "Page.navigate",
            Some(json!({ "url": url_a })),
            &page_sid,
        )
        .await
        .expect("commit second Request A2 in A -> B -> A");
    let a2_chunk = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
        .await
        .expect("Request A2 to /page-a must recover after its own commit")
        .expect("A2 chunk");
    assert_eq!(a2_chunk.doc_epoch, 4, "A2 audio must carry committed doc_epoch 4");

    // 4. Case 2 (C8-H6): Normal HTTP 302 redirect (`/login` -> 302 -> `/grandchild`) + same-revision update!
    producer.request_audio_doc_epoch(5);
    client
        .send_command(
            "Page.navigate",
            Some(json!({ "url": format!("http://127.0.0.1:{xo_port}/login") })),
            Some(&page_sid),
        )
        .await
        .expect("navigate /login -> 302 -> /grandchild");
    // Same-revision session update with final redirected URL must not re-fence epoch 5
    producer.request_audio_doc_epoch(5);
    let mut redirect_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("HTTP 302 redirect (/login -> /grandchild) must recover audio")
            .expect("redirect chunk");
        if c.doc_epoch == 5 {
            break c;
        }
    };
    assert_eq!(redirect_chunk.doc_epoch, 5);

    // 5. Case 3 (C8-H6): Repeated same-URL requests (`/coalesce`) where first request is canceled by second!
    let url_coalesce = format!("http://127.0.0.1:{xo_port}/coalesce");
    producer.request_audio_doc_epoch(6);
    let nav_client2 = client.clone();
    let nav_sid2 = page_sid.clone();
    let url_c1 = url_coalesce.clone();
    let _c1_task = tokio::spawn(async move {
        let _ = nav_client2
            .send_command(
                "Page.navigate",
                Some(json!({ "url": url_c1 })),
                Some(&nav_sid2),
            )
            .await;
    });
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    // Cancel the first in-flight /coalesce load without committing, then issue second request to the same URL /coalesce (epoch 7)
    let _ = client.send_command("Page.stopLoading", None, Some(&page_sid)).await;
    producer.request_audio_doc_epoch(7);
    client
        .send_command(
            "Page.navigate",
            Some(json!({ "url": url_coalesce })),
            Some(&page_sid),
        )
        .await
        .expect("commit coalesced second request to /coalesce");
    redirect_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("coalesced same-URL navigation must recover audio on single final commit")
            .expect("coalesced chunk");
        if c.doc_epoch == 7 {
            break c;
        }
    };
    assert_eq!(redirect_chunk.doc_epoch, 7);

    // 6. Case 4 (C9-H6): Real History API `history.pushState` and `history.replaceState` with ongoing WebAudio!
    client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    history.pushState({ step: 1 }, '', '/coalesce-pushed');
                    history.replaceState({ step: 2 }, '', '/coalesce-replaced');
                    return location.pathname;
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("execute History API pushState and replaceState");
    let history_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("ongoing WebAudio must survive history.pushState and history.replaceState without retiring document")
            .expect("post-pushState chunk");
        if c.doc_epoch >= 9 {
            break c;
        }
    };
    assert_eq!(
        history_chunk.doc_epoch, 9,
        "pushState + replaceState must advance doc_epoch to 9 and continue streaming ongoing WebAudio"
    );

    // 7. Case 5 (C9-H6): Delayed session-update observer consumption (native navigation dispatches and commits
    //    BEFORE the asynchronous session-update consumer calls `request_audio_doc_epoch`)!
    client
        .send_command(
            "Page.navigate",
            Some(json!({ "url": format!("http://127.0.0.1:{xo_port}/grandchild") })),
            Some(&page_sid),
        )
        .await
        .expect("navigate to /grandchild before delayed session observer runs");
    // Now the delayed session-update consumer runs AFTER native navigation has already committed:
    producer.request_audio_doc_epoch(10);
    let delayed_obs_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("delayed session-update consumer must not falsely reject valid committed native document")
            .expect("delayed observer chunk");
        if c.doc_epoch == 10 {
            break c;
        }
    };
    assert_eq!(delayed_obs_chunk.doc_epoch, 10);

    // 8. Case 6 (C10-H2): Out-of-bounds Back/Forward after session watcher already fenced epoch 11!
    producer.request_audio_doc_epoch(11);
    assert_eq!(producer.audio_doc_authority().active_committed_epoch(), None);
    producer.resolve_noop_audio_doc_epoch(11);
    assert_eq!(producer.audio_doc_authority().active_committed_epoch(), Some(11));
    let noop_hist_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("out-of-bounds no-op history resolution must keep same-page audio streaming")
            .expect("no-op history chunk");
        if c.doc_epoch == 11 {
            break c;
        }
    };
    assert_eq!(noop_hist_chunk.doc_epoch, 11);

    // 9. Case 7 (C10-H6): `Page.reload` (`expects_loader_id = false`) single in-flight transition!
    producer.request_audio_doc_epoch(12);
    producer
        .dispatch_navigation_for_epoch(12, "Page.reload", None, &page_sid)
        .await
        .expect("reload /grandchild at epoch 12");
    let reload_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("Page.reload must recover audio at epoch 12")
            .expect("reload chunk");
        if c.doc_epoch == 12 {
            break c;
        }
    };
    assert_eq!(reload_chunk.doc_epoch, 12);

    // 10. Case 8 (C10-H2): Zero-demand navigation + initial `build_producer` navigation before viewer demand!
    producer.remove_viewer_demand("sub-live-1").await;
    // Navigate while zero viewers are attached (`run_producer_tasks` stopped):
    producer.init_audio_doc_epoch(1);
    producer
        .dispatch_navigation_for_epoch(
            1,
            "Page.navigate",
            Some(json!({ "url": format!("http://127.0.0.1:{xo_port}/grandchild") })),
            &page_sid,
        )
        .await
        .expect("initial/zero-demand managed navigation at epoch 1");
    let mut zero_demand_auth_rx = producer.subscribe_audio_doc_authority();
    tokio::time::timeout(
        std::time::Duration::from_millis(500),
        zero_demand_auth_rx.wait_for(|a| a.active_committed_epoch() == Some(1)),
    )
    .await
    .expect("zero-demand/initial navigation must commit epoch 1 via CdpActor listener with 0 viewers")
    .expect("watch open");
    // Attach viewer without a second navigation and verify PCM arrives immediately at doc_epoch == 1:
    producer.register_viewer_demand("v1", "sub-live-2", true).await;
    let first_attach_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("first viewer attachment after initial navigation must receive PCM without a second navigation")
            .expect("first attach chunk");
        if c.doc_epoch == 1 {
            break c;
        }
    };
    assert_eq!(first_attach_chunk.doc_epoch, 1);

    // 11. Case 9 (C11-H2): Managed API fragment navigation (`Page.navigate` to `#frag`) and managed
    //     same-document `Page.navigateToHistoryEntry` back traversal restore the surviving document!
    producer.request_audio_doc_epoch(2);
    producer
        .dispatch_navigation_for_epoch(
            2,
            "Page.navigate",
            Some(json!({ "url": format!("http://127.0.0.1:{xo_port}/grandchild#section-frag") })),
            &page_sid,
        )
        .await
        .expect("managed API fragment navigation at epoch 2");
    let frag_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("managed API fragment navigation must restore surviving document and continue PCM (C11-H2)")
            .expect("frag chunk");
        if c.doc_epoch == 2 {
            break c;
        }
    };
    assert_eq!(frag_chunk.doc_epoch, 2);

    // C12-H2: Managed API fragment removal (`Page.navigate` from `/grandchild#section-frag` -> `/grandchild`, NO `#` in target URL!)
    // must also be recognized as same-document via native `loaderId: None` + `NavigatedWithinDocument`, restoring the surviving document!
    producer.request_audio_doc_epoch(3);
    producer
        .dispatch_navigation_for_epoch(
            3,
            "Page.navigate",
            Some(json!({ "url": format!("http://127.0.0.1:{xo_port}/grandchild") })),
            &page_sid,
        )
        .await
        .expect("managed API fragment removal (/grandchild#section-frag -> /grandchild) at epoch 3");
    let frag_removed_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("managed API fragment removal must restore surviving document and continue PCM (C12-H2)")
            .expect("frag-removed chunk");
        if c.doc_epoch == 3 {
            break c;
        }
    };
    assert_eq!(frag_removed_chunk.doc_epoch, 3);

    // Same-document history back via `Page.navigateToHistoryEntry` (back to `/grandchild#section-frag`) at epoch 4:
    let hist = client
        .send_command("Page.getNavigationHistory", None, Some(&page_sid))
        .await
        .expect("getNavigationHistory");
    let cur_idx = hist.get("currentIndex").and_then(|v| v.as_i64()).unwrap() as usize;
    let prev_entry = &hist.get("entries").and_then(|v| v.as_array()).unwrap()[cur_idx - 1];
    let prev_entry_id = prev_entry.get("id").and_then(|v| v.as_i64()).unwrap();
    let prev_entry_url = prev_entry.get("url").and_then(|v| v.as_str());
    producer.request_audio_doc_epoch(4);
    producer
        .dispatch_navigation_for_epoch_with_url(
            4,
            "Page.navigateToHistoryEntry",
            Some(json!({ "entryId": prev_entry_id })),
            &page_sid,
            prev_entry_url,
        )
        .await
        .expect("managed same-document history back at epoch 4");
    let same_doc_back_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("managed same-document history back must restore surviving document and continue PCM (C11-H2)")
            .expect("same-doc back chunk");
        if c.doc_epoch == 4 {
            break c;
        }
    };
    assert_eq!(same_doc_back_chunk.doc_epoch, 4);
    let surviving_grandchild_doc = producer
        .audio_doc_authority()
        .committed_doc_id
        .expect("surviving grandchild docId");

    // 12. Case 10 (C11-H6 & C12-H6): API A captures epoch 5 and pauses before dispatch; API B supersedes with epoch 6
    //     (a cross-document navigation to `/coalesce#anchor` containing `#`), dispatches, fully commits a new document,
    //     and admits PCM; API A then resumes with stale epoch 5 and is rejected!
    producer.request_audio_doc_epoch(5);
    producer.request_audio_doc_epoch(6);
    producer
        .dispatch_navigation_for_epoch(
            6,
            "Page.navigate",
            Some(json!({ "url": format!("http://127.0.0.1:{xo_port}/coalesce#anchor") })),
            &page_sid,
        )
        .await
        .expect("API B dispatches and commits cross-document /coalesce#anchor at epoch 6");
    let b6_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("API B must commit and emit PCM at epoch 6")
            .expect("B6 chunk");
        if c.doc_epoch == 6 {
            break c;
        }
    };
    assert_eq!(b6_chunk.doc_epoch, 6);
    let doc_b6 = producer
        .audio_doc_authority()
        .committed_doc_id
        .expect("committed_doc_id for B6");
    assert_ne!(
        doc_b6, surviving_grandchild_doc,
        "cross-document /coalesce#anchor navigation must bind a new document, not restore old grandchild doc (C12-H6)"
    );
    // Now API A resumes and tries to dispatch stale epoch 5 AFTER B6 has already committed:
    let stale_a_res = producer
        .dispatch_navigation_for_epoch(
            5,
            "Page.navigate",
            Some(json!({ "url": format!("http://127.0.0.1:{xo_port}/grandchild") })),
            &page_sid,
        )
        .await;
    assert!(
        stale_a_res.is_err(),
        "stale explicit dispatch (epoch 5 <= committed 6) must be rejected before native queue exposure (C11-H6)"
    );
    assert_eq!(
        producer.audio_doc_authority().committed_doc_id,
        Some(doc_b6),
        "rejected stale API A must not replace Document B6"
    );
    assert_eq!(producer.audio_doc_authority().active_committed_epoch(), Some(6));

    producer.remove_viewer_demand("sub-live-2").await;
    let _ = process.terminate().await;
}

#[test]
fn viewer_delivery_estimator_overlapping_credits_and_busy_window_rate() {
    use dam_hopper_server::browser_host::protocol::{DiscardReason, HeartbeatTelemetry};
    use dam_hopper_server::browser_host::viewer_delivery_estimator::SampleProvenance;
    use std::time::Instant;

    let sub = Uuid::new_v4().to_string();
    let run = Uuid::new_v4().to_string();
    let t0 = Instant::now();
    let interval_24fps = Duration::from_secs_f64(1.0 / 24.0);
    let mut ctrl = ViewerCreditController::with_min_interval_at(sub.clone(), interval_24fps, t0);

    let frame1 = make_test_frame(&run, "1", "1");
    let frame2 = make_test_frame(&run, "1", "2");
    let frame3 = make_test_frame(&run, "1", "3");
    let f_bytes = frame1.byte_length() as u64;

    // Admit frame 1 at t=0ms and frame 2 at t=50ms -> both in flight concurrently (overlapping credits!)
    assert!(ctrl.on_incoming_frame_at(frame1, t0).is_some());
    ctrl.record_frame_write(f_bytes as usize, Duration::from_millis(4), 1700000000010);
    assert!(
        ctrl.on_incoming_frame_at(frame2, t0 + Duration::from_millis(50))
            .is_some()
    );
    ctrl.record_frame_write(f_bytes as usize, Duration::from_millis(8), 1700000000060);
    assert_eq!(ctrl.outstanding_count(), 2);
    assert_eq!(ctrl.outstanding_bytes(), (f_bytes * 2) as usize);

    // Both overlapping frames complete at t=850ms (service times: 850ms and 800ms).
    // Windowed accounting must compute (2 * f_bytes) over the 1.0s window, NEVER sum(bytes / frameRTT)!
    let _ = ctrl.on_credit_return_with_feedback_at(
        &sub,
        &run,
        "1",
        "1",
        false,
        None,
        Some(6.5),
        t0 + Duration::from_millis(850),
    );
    // Frame 2 is discarded due to client replacement (still consumed wire bytes, but not useful drawn)
    let _ = ctrl.on_credit_return_with_feedback_at(
        &sub,
        &run,
        "1",
        "2",
        true,
        Some(DiscardReason::Replaced),
        None,
        t0 + Duration::from_millis(850),
    );

    // Frame 3 admitted at t=900ms and discarded due to privacy/hidden -> excluded from congestion window
    assert!(
        ctrl.on_incoming_frame_at(frame3, t0 + Duration::from_millis(900))
            .is_some()
    );
    let _ = ctrl.on_credit_return_with_feedback_at(
        &sub,
        &run,
        "1",
        "3",
        true,
        Some(DiscardReason::Hidden),
        None,
        t0 + Duration::from_millis(920),
    );

    ctrl.record_audio_write(1200, Duration::from_millis(2));
    ctrl.record_control_write(128, Duration::from_millis(1));
    ctrl.record_heartbeat_telemetry(HeartbeatTelemetry {
        sample_ms: 1000,
        decoded_frames: 1,
        replaced_frames: 1,
        decode_ms_ewma: Some(6.5),
    });

    let snap = ctrl.snapshot_at("sess-1", "viewer-1", t0 + Duration::from_secs(1));
    assert_eq!(snap.sample_provenance, SampleProvenance::Busy);
    assert!(!snap.application_limited);
    assert!(!snap.ack_starved_pressure);
    assert!(!snap.warming);
    assert_eq!(snap.window_acked_drawn_bytes, f_bytes);
    assert_eq!(snap.window_discarded_bytes, f_bytes);
    assert_eq!(snap.total_acked_drawn_bytes, f_bytes);
    assert_eq!(snap.total_discarded_bytes, f_bytes * 2);

    let expected_delivered_kbps = ((f_bytes * 2) as f64 * 8.0) / 1000.0;
    let expected_useful_kbps = (f_bytes as f64 * 8.0) / 1000.0;
    let sum_over_rtt_kbps =
        ((f_bytes as f64 * 8.0) / 850.0) + ((f_bytes as f64 * 8.0) / 800.0);
    let actual_delivered = snap.estimated_delivered_kbps.expect("busy delivered kbps");
    let actual_useful = snap.useful_drawn_kbps.expect("busy useful kbps");
    assert!((actual_delivered - expected_delivered_kbps).abs() < 1e-6);
    assert!((actual_useful - expected_useful_kbps).abs() < 1e-6);
    assert!(
        actual_delivered < sum_over_rtt_kbps,
        "must not double-count overlapping credits via sum(bytes/frameRTT)"
    );
    assert_eq!(snap.min_service_baseline_ms, Some(800.0));
    assert!(snap.service_ewma_ms.unwrap() >= 800.0 && snap.service_ewma_ms.unwrap() <= 850.0);
    assert_eq!(snap.video_bytes_written, f_bytes * 2);
    assert_eq!(snap.audio_bytes_written, 1200);
    assert_eq!(snap.control_bytes_written, 128);
    assert_eq!(snap.last_local_send_unix_ms, Some(1700000000060));
    assert_eq!(snap.client_corroboration.decoded_frames_total, 1);
    assert_eq!(snap.client_corroboration.replaced_frames_total, 1);
    assert_eq!(snap.client_corroboration.last_decode_ms, Some(6.5));
}

#[test]
fn viewer_delivery_estimator_sparse_idle_and_ack_starvation_pressure() {
    use dam_hopper_server::browser_host::viewer_delivery_estimator::SampleProvenance;
    use std::time::Instant;

    let sub = Uuid::new_v4().to_string();
    let run = Uuid::new_v4().to_string();
    let t0 = Instant::now();
    let mut ctrl =
        ViewerCreditController::with_min_interval_at(sub.clone(), Duration::from_millis(100), t0);

    // 1. Two sparse frames in one 1s window (each ACKed promptly before next arrives, never saturating credits)
    //    plus 30s of idle windows must remain ApplicationLimited/Idle with unknown capacity (None, never 0).
    let f1 = make_test_frame(&run, "1", "1").with_receipt_time(1_731_050_000_010, t0);
    let f1_second = make_test_frame(&run, "1", "2")
        .with_receipt_time(1_731_050_000_410, t0 + Duration::from_millis(400));
    assert!(ctrl.on_incoming_frame_at(f1, t0).is_some());
    let _ = ctrl.on_credit_return_with_feedback_at(
        &sub,
        &run,
        "1",
        "1",
        false,
        None,
        Some(4.0),
        t0 + Duration::from_millis(20),
    );
    assert!(
        ctrl.on_incoming_frame_at(f1_second, t0 + Duration::from_millis(400))
            .is_some()
    );
    let _ = ctrl.on_credit_return_with_feedback_at(
        &sub,
        &run,
        "1",
        "2",
        false,
        None,
        Some(4.0),
        t0 + Duration::from_millis(420),
    );
    // Even if global receipt atomic is overwritten by another session, viewer retains its frame-local receipt time!
    dam_hopper_server::browser_host::diagnostics::global_stream_diagnostics()
        .last_server_receipt_unix_ms
        .store(9_999_999_999_999, std::sync::atomic::Ordering::Relaxed);
    let snap_sparse = ctrl.snapshot_at("sess-static", "v1", t0 + Duration::from_secs(1));
    assert_eq!(
        snap_sparse.sample_provenance,
        SampleProvenance::ApplicationLimited
    );
    assert!(snap_sparse.application_limited);
    assert_eq!(
        snap_sparse.estimated_delivered_kbps, None,
        "sparse two-update window without credit saturation must retain unknown capacity rather than Busy/0"
    );
    assert_eq!(
        snap_sparse.last_server_receipt_unix_ms,
        Some(1_731_050_000_410),
        "viewer estimator must record frame-local receipt time, not global atomic"
    );

    for sec in 2..=30 {
        let snap_idle = ctrl.snapshot_at("sess-static", "v1", t0 + Duration::from_secs(sec));
        assert_eq!(snap_idle.sample_provenance, SampleProvenance::Idle);
        assert!(snap_idle.application_limited);
        assert!(!snap_idle.ack_starved_pressure);
        assert_eq!(snap_idle.estimated_delivered_kbps, None);
    }
    // 2. Intentional governor pacing with prompt ACK and a pacing-held pending frame at the 1s boundary
    //    must still report ApplicationLimited and unknown capacity (None), never Busy!
    let t_pace = t0 + Duration::from_secs(31);
    let f2 = make_test_frame(&run, "1", "2");
    let f3 = make_test_frame(&run, "1", "3");
    assert!(ctrl.on_incoming_frame_at(f2, t_pace).is_some());
    let _ = ctrl.on_credit_return_with_feedback_at(
        &sub,
        &run,
        "1",
        "2",
        false,
        None,
        Some(3.0),
        t_pace + Duration::from_millis(5),
    );
    // f3 arrives at +10ms while credits are free (0 outstanding), so it is held ONLY for 100ms governor pacing
    assert!(
        ctrl.on_incoming_frame_at(f3.clone(), t_pace + Duration::from_millis(10))
            .is_none()
    );
    assert!(ctrl.has_pending());
    // Sample across the 1s window boundary while f3 is still pending solely due to pacing:
    let snap_paced = ctrl.snapshot_at("sess-static", "v1", t_pace + Duration::from_secs(1));
    assert_eq!(snap_paced.intentional_pacing_holds, 1);
    assert_eq!(snap_paced.pending_replacements, 0);
    assert_eq!(
        snap_paced.sample_provenance,
        SampleProvenance::ApplicationLimited,
        "pacing-held pending frame at 1s boundary without credit saturation must remain ApplicationLimited"
    );
    assert_eq!(snap_paced.estimated_delivered_kbps, None);

    // Now admit a new frame at t_sat = t_pace + 1s and flush pending to reach 2 outstanding credits (credit saturated)
    let t_sat = t_pace + Duration::from_secs(1);
    let f2_sat = make_test_frame(&run, "1", "20");
    assert!(ctrl.on_incoming_frame_at(f2_sat, t_sat).is_some());
    assert!(
        ctrl.on_incoming_frame_at(f3, t_sat + Duration::from_millis(10))
            .is_none()
    );
    // Flush pending f3 at t_sat + 100ms -> now 2 credits are outstanding (credit saturated)
    let flushed = ctrl
        .check_flush_pending_at(t_sat + Duration::from_millis(100))
        .expect("flush f3");
    assert_eq!(ctrl.outstanding_count(), 2);
    let _ = flushed;

    // Arrival of f4 and f5 while 2 credits remain unACKed triggers pending hold + replacement
    let f4 = make_test_frame(&run, "1", "4");
    let f5 = make_test_frame(&run, "1", "5");
    assert!(
        ctrl.on_incoming_frame_at(f4, t_sat + Duration::from_millis(200))
            .is_none()
    );
    assert!(
        ctrl.on_incoming_frame_at(f5, t_sat + Duration::from_millis(250))
            .is_none()
    );
    ctrl.record_broadcast_lag(3);

    // Advance >1s with zero ACKs while 2 frames remain outstanding -> ACK starvation pressure!
    let snap_starved = ctrl.snapshot_at("sess-static", "v1", t_sat + Duration::from_millis(1200));
    assert_eq!(snap_starved.sample_provenance, SampleProvenance::AckStarved);
    assert!(snap_starved.ack_starved_pressure);
    assert!(!snap_starved.application_limited);
    assert_eq!(snap_starved.pending_replacements, 1);
    assert_eq!(snap_starved.broadcast_lagged_frames, 3);
    assert!(snap_starved.oldest_outstanding_age_ms >= 1200);
    // Control-only pending write buffer is cleaned on control teardown
    let diag = dam_hopper_server::browser_host::diagnostics::global_stream_diagnostics();
    diag.record_control_write("ctrl-only-sub", 256, Duration::from_millis(2));
    diag.clear_pending_control_write("ctrl-only-sub");
    assert!(diag.take_pending_control_write("ctrl-only-sub").is_none());
}

#[test]
fn viewer_delivery_estimator_duplicate_foreign_and_run_rotation_fences() {
    use dam_hopper_server::browser_host::diagnostics::MAX_ADMITTED_VIEWER_SNAPSHOTS;
    use dam_hopper_server::browser_host::protocol::{
        HeartbeatTelemetry, MediaClientControl, MediaClientControlWire, MAX_CLIENT_DECODE_MS,
        MAX_HEARTBEAT_FRAME_COUNT, MAX_HEARTBEAT_SAMPLE_MS,
    };
    use dam_hopper_server::browser_host::viewer_delivery_estimator::SampleProvenance;
    use std::time::Instant;

    let sub = Uuid::new_v4().to_string();
    let run1 = Uuid::new_v4().to_string();
    let run2 = Uuid::new_v4().to_string();
    let t0 = Instant::now();
    let mut ctrl =
        ViewerCreditController::with_min_interval_at(sub.clone(), Duration::from_millis(10), t0);

    let f1 = make_test_frame(&run1, "1", "1");
    let f2 = make_test_frame(&run1, "1", "2");
    let f_bytes = f1.byte_length() as u64;
    assert!(ctrl.on_incoming_frame_at(f1, t0).is_some());
    assert!(
        ctrl.on_incoming_frame_at(f2, t0 + Duration::from_millis(20))
            .is_some()
    );

    // Foreign subscription ACK is rejected and changes neither occupancy nor estimate
    assert!(
        ctrl.on_credit_return_with_feedback_at(
            "foreign-sub",
            &run1,
            "1",
            "1",
            false,
            None,
            Some(5.0),
            t0 + Duration::from_millis(30),
        )
        .is_none()
    );
    assert_eq!(ctrl.outstanding_count(), 2);

    // Valid first ACK for f1
    let _ = ctrl.on_credit_return_with_feedback_at(
        &sub,
        &run1,
        "1",
        "1",
        false,
        None,
        Some(5.0),
        t0 + Duration::from_millis(35),
    );
    // Duplicate ACK for f1 is a complete no-op
    let _ = ctrl.on_credit_return_with_feedback_at(
        &sub,
        &run1,
        "1",
        "1",
        false,
        None,
        Some(999.0),
        t0 + Duration::from_millis(40),
    );
    let snap1 = ctrl.snapshot_at("sess-1", "v1", t0 + Duration::from_millis(50));
    assert_eq!(snap1.total_acked_drawn_bytes, f_bytes);
    assert_eq!(snap1.min_service_baseline_ms, Some(35.0));
    assert_eq!(snap1.client_corroboration.last_decode_ms, Some(5.0));

    // Rotate to run2 while f2 (from run1) is still outstanding
    let f_run2 = make_test_frame(&run2, "1", "1");
    assert!(
        ctrl.on_incoming_frame_at(f_run2, t0 + Duration::from_millis(100))
            .is_some()
    );
    // Old-run completion frees credit for f2, but cannot enter run2's window or service estimate
    let _ = ctrl.on_credit_return_with_feedback_at(
        &sub,
        &run1,
        "1",
        "2",
        false,
        None,
        Some(500.0),
        t0 + Duration::from_millis(150),
    );
    let snap_run2 = ctrl.snapshot_at("sess-1", "v1", t0 + Duration::from_millis(200));
    assert_eq!(snap_run2.producer_run.as_deref(), Some(run2.as_str()));
    assert!(snap_run2.warming);
    assert_eq!(snap_run2.sample_provenance, SampleProvenance::Warming);
    assert_eq!(snap_run2.window_acked_drawn_bytes, 0);
    assert_eq!(
        snap_run2.min_service_baseline_ms,
        Some(35.0),
        "subscription-local min baseline survives run rotation while old-run completion is ignored"
    );
    assert_eq!(snap_run2.service_ewma_ms, None);
    assert_eq!(snap_run2.client_corroboration.last_decode_ms, None);

    // Diagnostics registry bounds and forged-update protection
    let diag = dam_hopper_server::browser_host::diagnostics::global_stream_diagnostics();
    let forged_sub = format!("forged-{}", Uuid::new_v4());
    let mut forged_snap = snap_run2.clone();
    forged_snap.subscription_epoch = forged_sub.clone();
    assert!(
        !diag.update_viewer_snapshot(forged_snap),
        "unregistered subscription must not create diagnostic registry entry"
    );
    assert!(diag.register_viewer_snapshot(snap_run2.clone()));
    assert_eq!(
        diag.viewer_snapshot(&sub).unwrap().producer_run,
        Some(run2.clone())
    );
    assert_eq!(diag.viewer_snapshots_for_session("sess-1").len(), 1);
    assert!(diag.remove_viewer_snapshot(&sub).is_some());
    assert!(diag.viewer_snapshot(&sub).is_none());
    assert!(MAX_ADMITTED_VIEWER_SNAPSHOTS <= 16);

    // Wire validation bounds parity
    let valid_ack = format!(
        r#"{{"kind":"frameAck","subscriptionEpoch":"{sub}","producerRun":"{run2}","viewportEpoch":"1","frameSeq":"1","decodeMs":{MAX_CLIENT_DECODE_MS}}}"#
    );
    assert!(MediaClientControlWire::parse_and_validate(&valid_ack).is_ok());
    assert!(serde_json::from_str::<MediaClientControl>(&valid_ack).is_ok());

    let bad_ack_neg = format!(
        r#"{{"kind":"frameAck","subscriptionEpoch":"{sub}","producerRun":"{run2}","viewportEpoch":"1","frameSeq":"1","decodeMs":-0.1}}"#
    );
    assert!(MediaClientControlWire::parse_and_validate(&bad_ack_neg).is_err());
    assert!(serde_json::from_str::<MediaClientControl>(&bad_ack_neg).is_err());

    let bad_ack_over = format!(
        r#"{{"kind":"frameAck","subscriptionEpoch":"{sub}","producerRun":"{run2}","viewportEpoch":"1","frameSeq":"1","decodeMs":60000.01}}"#
    );
    assert!(MediaClientControlWire::parse_and_validate(&bad_ack_over).is_err());

    let valid_hb = serde_json::to_string(&MediaClientControl::Heartbeat {
        subscription_epoch: sub.clone(),
        visible: true,
        telemetry: Some(HeartbeatTelemetry {
            sample_ms: MAX_HEARTBEAT_SAMPLE_MS,
            decoded_frames: MAX_HEARTBEAT_FRAME_COUNT,
            replaced_frames: MAX_HEARTBEAT_FRAME_COUNT,
            decode_ms_ewma: Some(MAX_CLIENT_DECODE_MS),
        }),
    })
    .unwrap();
    assert!(valid_hb.len() <= 1024);
    assert!(MediaClientControlWire::parse_and_validate(&valid_hb).is_ok());

    let bad_hb = format!(
        r#"{{"kind":"heartbeat","subscriptionEpoch":"{sub}","visible":true,"telemetry":{{"sampleMs":60001,"decodedFrames":1,"replacedFrames":0}}}}"#
    );
    assert!(MediaClientControlWire::parse_and_validate(&bad_hb).is_err());
}

#[test]
fn test_viewer_credit_controller_admits_and_flushes_validated_frame_without_reunpack() {
    use dam_hopper_server::browser_host::protocol::pack_validated_bhjf_frame;
    use std::time::Instant;

    let sub = Uuid::new_v4().to_string();
    let run = Uuid::new_v4().to_string();
    let t0 = Instant::now();
    let mut ctrl = ViewerCreditController::with_min_interval_at(sub.clone(), Duration::from_millis(100), t0);

    let make_validated = |seq: &str| {
        let header = TargetFrameHeader {
            browser_session_id: Uuid::new_v4().to_string(),
            browser_incarnation: Uuid::new_v4().to_string(),
            profile_epoch: "1".to_string(),
            producer_run: run.clone(),
            viewport_epoch: "1".to_string(),
            frame_seq: seq.to_string(),
            width: 64,
            height: 64,
            capture_time_unix_ms: 1000,
            geometry: TargetGeometry {
                css_width: 64.0,
                css_height: 64.0,
                offset_top: 0.0,
                scroll_x: 0.0,
                scroll_y: 0.0,
                page_scale: 1.0,
                visual_offset_x: 0.0,
                visual_offset_y: 0.0,
                dpr: 1.0,
            },
            input_trusted: true,
        };
        let validated = pack_validated_bhjf_frame(header, &make_dummy_jpeg()).unwrap();
        let res = global_memory_controller()
            .try_reserve(validated.data().len())
            .unwrap();
        TrackedBhjfFrame::from_validated(validated, res)
    };

    let f1 = make_validated("1");
    let f2 = make_validated("2");
    let f1_hdr_ptr = f1.header_arc().unwrap().clone();
    let f2_hdr_ptr = f2.header_arc().unwrap().clone();

    let sent1 = ctrl.on_incoming_frame_at(f1, t0).expect("f1 admitted");
    assert!(Arc::ptr_eq(sent1.header_arc().unwrap(), &f1_hdr_ptr));

    // Immediate f2 held as pending
    assert!(ctrl.on_incoming_frame_at(f2, t0 + Duration::from_millis(10)).is_none());
    assert!(ctrl.has_pending());

    // Flush pending f2 after interval -> retains exact Arc<TargetFrameHeader> without re-parsing
    let sent2 = ctrl
        .check_flush_pending_at(t0 + Duration::from_millis(110))
        .expect("f2 flushed");
    assert!(Arc::ptr_eq(sent2.header_arc().unwrap(), &f2_hdr_ptr));
}

#[tokio::test]
async fn test_decoupled_media_writer_blocked_sink_reservation_audio_drop_and_cancel() {
    use dam_hopper_server::browser_host::diagnostics::MemoryAdmissionController;
    use dam_hopper_server::browser_host::media_writer::{
        spawn_media_writer, MediaPacketSink, MediaWriterEvent, OutboundMediaPacket,
    };
    use dam_hopper_server::browser_host::protocol::{
        pack_validated_bhjf_frame, ProducerAudioChunk, AUDIO_CHANNELS, AUDIO_ENCODING_PCM16LE,
        AUDIO_SAMPLE_RATE,
    };
    use std::future::Future;
    use std::pin::Pin;
    use std::time::Instant;
    use tokio::sync::Notify;
    use tokio_util::sync::CancellationToken;

    struct BlockedSink {
        started: Arc<Notify>,
        release: Arc<Notify>,
        sent_packets: Arc<parking_lot::Mutex<Vec<OutboundMediaPacket>>>,
    }

    impl MediaPacketSink for BlockedSink {
        fn send_packet(
            &mut self,
            packet: OutboundMediaPacket,
        ) -> Pin<Box<dyn Future<Output = Result<(), &'static str>> + Send + '_>> {
            let started = self.started.clone();
            let release = self.release.clone();
            let sent_packets = self.sent_packets.clone();
            Box::pin(async move {
                started.notify_one();
                release.notified().await;
                sent_packets.lock().push(packet);
                Ok(())
            })
        }
    }

    let mem_ctrl = MemoryAdmissionController::new(1024 * 1024);
    let sub = Uuid::new_v4().to_string();
    let run = Uuid::new_v4().to_string();
    let t0 = Instant::now();
    let mut ctrl = ViewerCreditController::with_min_interval_at(
        sub.clone(),
        Duration::from_millis(10),
        t0,
    );

    let make_tracked = |seq: &str| {
        let header = TargetFrameHeader {
            browser_session_id: Uuid::new_v4().to_string(),
            browser_incarnation: Uuid::new_v4().to_string(),
            profile_epoch: "1".to_string(),
            producer_run: run.clone(),
            viewport_epoch: "1".to_string(),
            frame_seq: seq.to_string(),
            width: 64,
            height: 64,
            capture_time_unix_ms: 1000,
            geometry: TargetGeometry {
                css_width: 64.0,
                css_height: 64.0,
                offset_top: 0.0,
                scroll_x: 0.0,
                scroll_y: 0.0,
                page_scale: 1.0,
                visual_offset_x: 0.0,
                visual_offset_y: 0.0,
                dpr: 1.0,
            },
            input_trusted: true,
        };
        let validated = pack_validated_bhjf_frame(header, &make_dummy_jpeg()).unwrap();
        let res = mem_ctrl.try_reserve(validated.data().len()).unwrap();
        TrackedBhjfFrame::from_validated(validated, res)
    };

    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let sent_packets = Arc::new(parking_lot::Mutex::new(Vec::new()));
    let cancel = CancellationToken::new();

    let (writer, mut events, join) = spawn_media_writer(
        BlockedSink {
            started: started.clone(),
            release: release.clone(),
            sent_packets: sent_packets.clone(),
        },
        cancel.clone(),
        None,
        |_, _, _, _| true,
    );

    let f1 = make_tracked("1");
    let f1_bytes = f1.byte_length();
    let admitted1 = ctrl
        .on_incoming_frame_with_writer_state_at(f1, writer.is_frame_busy(), t0)
        .expect("f1 admitted");
    assert!(writer.enqueue_admitted_frame(admitted1));

    // Wait for writer to enter blocked send of f1
    started.notified().await;
    assert!(writer.is_frame_busy());

    // While sink is blocked on f1:
    // 1. Reader processes ACK for f1 immediately without blocking!
    //    Because writer_frame_busy is true, freeing credit does NOT admit a second frame into writer.
    let f2 = make_tracked("2");
    let f3 = make_tracked("3");
    assert!(
        ctrl.on_incoming_frame_with_writer_state_at(
            f2,
            writer.is_frame_busy(),
            t0 + Duration::from_millis(20),
        )
        .is_none(),
        "writer busy prevents admitting f2 into outstanding; f2 stays in pending_frame"
    );
    assert!(
        ctrl.on_incoming_frame_with_writer_state_at(
            f3,
            writer.is_frame_busy(),
            t0 + Duration::from_millis(30),
        )
        .is_none(),
        "f3 replaces f2 in pending_frame without creating a second FIFO"
    );
    // Even after ACK for f1 arrives while writer is still flushing f1's tail bytes,
    // f1's MemoryReservation remains held by the writer until physical send completes!
    let flushed_on_ack = ctrl.on_credit_return_with_writer_state_at(
        &sub,
        &run,
        "1",
        "1",
        false,
        None,
        Some(4.0),
        writer.is_frame_busy(),
        t0 + Duration::from_millis(35),
    );
    assert!(flushed_on_ack.is_none(), "pending f3 stays in controller while writer is busy");
    assert_eq!(ctrl.total_acked, 1);
    assert_eq!(
        mem_ctrl.current_reserved_bytes(),
        f1_bytes * 2,
        "both in-flight writer frame f1 and pending frame f3 hold reservations; f2 was dropped"
    );

    // 2. Enqueue 3 audio chunks while sink is blocked -> only latest audio chunk (seq 3) is retained
    use base64::Engine as _;
    let valid_audio_b64: Arc<str> = Arc::from(base64::engine::general_purpose::STANDARD.encode(&[0u8; 960]));
    for seq in ["1", "2", "3"] {
        let chunk = ProducerAudioChunk {
            browser_session_id: Uuid::new_v4().to_string(),
            browser_incarnation: Uuid::new_v4().to_string(),
            profile_epoch: "1".to_string(),
            audio_run: run.clone(),
            doc_epoch: 1,
            audio_seq: seq.to_string(),
            sample_rate: AUDIO_SAMPLE_RATE,
            channels: AUDIO_CHANNELS,
            encoding: AUDIO_ENCODING_PCM16LE.to_string(),
            data: valid_audio_b64.clone(),
            reservation: None,
        };
        assert!(writer.enqueue_latest_audio(&sub, chunk, 1, 1));
    }

    // Release blocked sink for f1
    release.notify_one();
    let ev1 = events.recv().await.expect("frame sent event");
    assert!(matches!(ev1, MediaWriterEvent::FrameSent { byte_len, .. } if byte_len == f1_bytes));

    // Wait for writer to start sending the single latest audio chunk (seq 3) and release it
    started.notified().await;
    release.notify_one();
    let ev_audio = events.recv().await.expect("audio sent event");
    assert!(matches!(ev_audio, MediaWriterEvent::AudioSent { .. }));

    // Verify only 1 binary frame and 1 audio text message (audioSeq "3") were sent
    {
        let sent = sent_packets.lock();
        assert_eq!(sent.len(), 2);
        match &sent[1] {
            OutboundMediaPacket::Text(json) => {
                assert!(json.contains(r#""audioSeq":"3""#), "stale audio 1 & 2 must be dropped");
            }
            _ => panic!("expected text audio packet"),
        }
    }

    // Cancel writer and drop controller -> all reservations return to 0
    cancel.cancel();
    let _ = join.await;
    drop(ctrl);
    assert_eq!(mem_ctrl.current_reserved_bytes(), 0);
}

#[test]
fn test_viewer_permit_respects_configured_max_viewers() {
    // Private counter: the global ACTIVE_VIEWERS is held by concurrently running live handler tests.
    static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    use dam_hopper_server::browser_host::media::ViewerPermit;

    // max_viewers = 1 rejects second viewer permit, max_viewers = 3 admits up to 3
    {
        let p1 = ViewerPermit::try_acquire_in(&COUNTER, 1).expect("first viewer admitted at cap=1");
        assert!(
            ViewerPermit::try_acquire_in(&COUNTER, 1).is_err(),
            "second viewer must be rejected when max_viewers=1"
        );
        drop(p1);
    }
    {
        let p1 = ViewerPermit::try_acquire_in(&COUNTER, 3).expect("viewer 1 at cap=3");
        let p2 = ViewerPermit::try_acquire_in(&COUNTER, 3).expect("viewer 2 at cap=3");
        let p3 = ViewerPermit::try_acquire_in(&COUNTER, 3).expect("viewer 3 at cap=3");
        assert!(
            ViewerPermit::try_acquire_in(&COUNTER, 3).is_err(),
            "viewer 4 rejected at cap=3"
        );
        drop(p1);
        drop(p2);
        drop(p3);
    }
    assert_eq!(COUNTER.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[tokio::test]
async fn test_media_writer_lifecycle_channel_saturation_lossless_flush() {
    use dam_hopper_server::browser_host::media_writer::{
        spawn_media_writer, MediaPacketSink, MediaWriterEvent, OutboundMediaPacket,
    };
    use std::pin::Pin;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio_util::sync::CancellationToken;

    struct FastRecordingSink {
        sent_count: Arc<AtomicUsize>,
    }
    impl MediaPacketSink for FastRecordingSink {
        fn send_packet(
            &mut self,
            _packet: OutboundMediaPacket,
        ) -> Pin<Box<dyn std::future::Future<Output = Result<(), &'static str>> + Send + '_>> {
            self.sent_count.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok(()) })
        }
    }

    let sent_count = Arc::new(AtomicUsize::new(0));
    let cancel = CancellationToken::new();
    let (writer, mut events, join) = spawn_media_writer(
        FastRecordingSink {
            sent_count: sent_count.clone(),
        },
        cancel.clone(),
        None,
        |_, _, _, _| true,
    );

    // Consumer is STALLED: we do not read from `events` channel.
    // Channel capacity is 16. We send 25 control messages sequentially.
    let mut expected_control_bytes = 0usize;
    for i in 0..25 {
        let text = format!("control-message-{:03}", i);
        expected_control_bytes += text.len();
        writer.enqueue_control_text(text);
        // Small yield so writer task has time to process and write each item to sink
        tokio::time::sleep(Duration::from_millis(5)).await;
    }

    // Give writer a moment to settle to idle with pending aggregates
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Now consumer drains `events`: capacity returns, idle writer flushes pending aggregates
    let mut drained_control_bytes = 0usize;
    let mut events_count = 0usize;
    while let Ok(Some(ev)) = tokio::time::timeout(Duration::from_millis(100), events.recv()).await {
        events_count += 1;
        if let MediaWriterEvent::ControlSent { byte_len, .. } = ev {
            drained_control_bytes += byte_len;
        }
    }

    assert_eq!(
        drained_control_bytes, expected_control_bytes,
        "exact total control bytes must be delivered losslessly across saturation and aggregation"
    );
    assert!(events_count > 0);

    cancel.cancel();
    let _ = join.await;
}

#[tokio::test]
async fn test_media_writer_audio_cancellation_retires_sink_without_stale_leak() {
    use base64::Engine as _;
    use dam_hopper_server::browser_host::diagnostics::MemoryAdmissionController;
    use dam_hopper_server::browser_host::media_writer::{
        spawn_media_writer, MediaPacketSink, MediaWriterEvent, OutboundMediaPacket,
    };
    use dam_hopper_server::browser_host::protocol::{
        ProducerAudioChunk, AUDIO_CHANNELS, AUDIO_ENCODING_PCM16LE, AUDIO_SAMPLE_RATE,
    };
    use dam_hopper_server::browser_host::screencast::AudioDocAuthority;
    use std::pin::Pin;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::Notify;
    use tokio_util::sync::CancellationToken;

    struct AcceptThenBlockFlushSink {
        started: Arc<Notify>,
        release: Arc<Notify>,
        send_count: Arc<AtomicUsize>,
    }
    impl MediaPacketSink for AcceptThenBlockFlushSink {
        fn send_packet(
            &mut self,
            _packet: OutboundMediaPacket,
        ) -> Pin<Box<dyn std::future::Future<Output = Result<(), &'static str>> + Send + '_>> {
            let started = self.started.clone();
            let release = self.release.clone();
            let send_count = self.send_count.clone();
            Box::pin(async move {
                send_count.fetch_add(1, Ordering::SeqCst);
                started.notify_one();
                release.notified().await;
                Ok(())
            })
        }
    }

    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let send_count = Arc::new(AtomicUsize::new(0));
    let cancel = CancellationToken::new();

    let (doc_tx, doc_rx) = tokio::sync::watch::channel(AudioDocAuthority::for_epoch(1));
    let mem_ctrl = MemoryAdmissionController::new(1024 * 1024);
    let reservation = mem_ctrl.try_reserve(2048).expect("reserve 2048 bytes");
    assert_eq!(mem_ctrl.current_reserved_bytes(), 2048);

    let (writer, mut events, join) = spawn_media_writer(
        AcceptThenBlockFlushSink {
            started: started.clone(),
            release: release.clone(),
            send_count: send_count.clone(),
        },
        cancel.clone(),
        Some(doc_rx),
        |_, _, _, _| true,
    );

    let valid_b64: Arc<str> = Arc::from(base64::engine::general_purpose::STANDARD.encode(&[0u8; 960]));
    let chunk = ProducerAudioChunk {
        browser_session_id: Uuid::new_v4().to_string(),
        browser_incarnation: Uuid::new_v4().to_string(),
        profile_epoch: "1".to_string(),
        audio_run: Uuid::new_v4().to_string(),
        doc_epoch: 1,
        audio_seq: "1".to_string(),
        sample_rate: AUDIO_SAMPLE_RATE,
        channels: AUDIO_CHANNELS,
        encoding: AUDIO_ENCODING_PCM16LE.to_string(),
        data: valid_b64,
        reservation: Some(Arc::new(reservation)),
    };

    assert!(writer.enqueue_latest_audio("sub-1", chunk, 1, 1));

    // Wait until sink accepts payload and enters blocked flush
    started.notified().await;
    assert_eq!(send_count.load(Ordering::SeqCst), 1);
    assert_eq!(mem_ctrl.current_reserved_bytes(), 2048, "reservation must be held while sink is flushing");

    // Change document authority to epoch 2 mid-flush
    doc_tx.send(AudioDocAuthority::for_epoch(2)).unwrap();

    // Writer must detect interrupt after sink accepted item:
    // Transport is retired (cancel token cancelled), reservation released only after retirement, and task exits.
    let _ = join.await;

    assert!(cancel.is_cancelled(), "media transport must be retired/cancelled on doc change mid-flush");
    assert_eq!(
        mem_ctrl.current_reserved_bytes(),
        0,
        "memory reservation must be released after transport retirement"
    );

    // Verify TransportFailed was emitted
    let ev = events.recv().await.expect("transport failed event");
    assert!(
        matches!(ev, MediaWriterEvent::TransportFailed(_)),
        "expected TransportFailed, got: {:?}",
        ev
    );

    // Sink is NEVER reused: send_count remains 1
    assert_eq!(send_count.load(Ordering::SeqCst), 1, "sink must not be reused after retirement");
}

#[test]
fn credit_controller_runtime_pacing_and_stall_suspension_keep_credits_and_bounded_pending() {
    use std::time::Instant;
    let sub = Uuid::new_v4().to_string();
    let run = Uuid::new_v4().to_string();
    let now = Instant::now();
    let mut c = ViewerCreditController::with_min_interval_at(sub.clone(), Duration::from_millis(40), now);

    assert!(c.on_incoming_frame_at(make_test_frame(&run, "1", "1"), now).is_some());
    // Adaptive pacing slows this viewer only; the held frame stays the single bounded pending slot.
    c.set_min_delivery_interval(Duration::from_millis(500));
    assert!(c.on_incoming_frame_at(make_test_frame(&run, "1", "2"), now + Duration::from_millis(100)).is_none());
    assert!(c.has_pending());
    assert!(c.check_flush_pending_at(now + Duration::from_millis(499)).is_none());
    let f2 = c.check_flush_pending_at(now + Duration::from_millis(501)).expect("flushes after the new interval");
    assert_eq!(f2.header().unwrap().frame_seq, "2");
    assert_eq!(c.outstanding_count(), MAX_OUTSTANDING_PER_VIEWER);

    let t = now + Duration::from_secs(1);
    assert!(c.on_credit_return_with_feedback_at(&sub, &run, "1", "1", false, None, None, t).is_none());
    assert!(c.on_credit_return_with_feedback_at(&sub, &run, "1", "2", false, None, None, t).is_none());
    assert_eq!(c.outstanding_count(), 0);

    // Stalled viewer: no new sends, newest frame replaces the pending slot, resume sends the newest.
    c.set_send_suspended(true);
    let t2 = t + Duration::from_secs(2);
    assert!(c.on_incoming_frame_at(make_test_frame(&run, "1", "3"), t2).is_none());
    assert!(c.on_incoming_frame_at(make_test_frame(&run, "1", "4"), t2 + Duration::from_millis(10)).is_none());
    assert!(c.check_flush_pending_at(t2 + Duration::from_secs(5)).is_none(), "suspended viewer gets no sends");
    assert_eq!(c.outstanding_count(), 0);
    c.set_send_suspended(false);
    let resumed = c.check_flush_pending_at(t2 + Duration::from_secs(5)).expect("resume");
    assert_eq!(resumed.header().unwrap().frame_seq, "4", "only the newest frame survives suspension");
}

async fn collect_audio_seqs<S>(ws: &mut S, window: Duration) -> Vec<String>
where
    S: futures_util::Stream<
            Item = Result<
                tokio_tungstenite::tungstenite::Message,
                tokio_tungstenite::tungstenite::Error,
            >,
        > + Unpin,
{
    use futures_util::StreamExt;
    let end = tokio::time::Instant::now() + window;
    let mut seqs = Vec::new();
    while let Ok(Some(Ok(msg))) = tokio::time::timeout_at(end, ws.next()).await {
        if let tokio_tungstenite::tungstenite::Message::Text(text) = msg {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if v["kind"] == "audioChunk" {
                    seqs.push(v["audioSeq"].as_str().unwrap().to_string());
                }
            }
        }
    }
    seqs
}

#[tokio::test]
async fn test_live_media_session_withholds_muted_viewer_audio_server_side_and_resumes_fresh() {
    let _live = pair_live::live_guard().await;
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine as _;
    use dam_hopper_server::agent_store::AgentStoreService;
    use dam_hopper_server::api::browser_host::global_attachment_manager;
    use dam_hopper_server::api::build_router;
    use dam_hopper_server::browser_host::attachments::{AttachmentPurpose, IssueTicketRequest};
    use dam_hopper_server::browser_host::auth::BrowserAdmission;
    use dam_hopper_server::browser_host::cdp::CdpClient;
    use dam_hopper_server::browser_host::media::get_or_register_producer;
    use dam_hopper_server::browser_host::screencast::ScreencastProducer;
    use dam_hopper_server::config::{DamHopperConfig, FeaturesConfig, GlobalConfig, WorkspaceInfo};
    use dam_hopper_server::crypto::DamHopperOpaqueSuite;
    use dam_hopper_server::diagnostics::DiagnosticStore;
    use dam_hopper_server::fs::FsSubsystem;
    use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
    use dam_hopper_server::state::AppState;
    use dam_hopper_server::tunnel::{CloudflaredDriver, TunnelSessionManager};
    use futures_util::{SinkExt, StreamExt};
    use opaque_ke::ServerSetup;
    use rand::rngs::OsRng;
    use tempfile::tempdir;
    use tokio::time::timeout;
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    // Mock CDP: replies success to every command (enough for page session + screencast start).
    let cdp_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let cdp_addr = cdp_listener.local_addr().unwrap();
    tokio::spawn(async move {
        let Ok((stream, _)) = cdp_listener.accept().await else { return };
        let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
        while let Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) = ws.next().await {
            let cmd: serde_json::Value = serde_json::from_str(&text).unwrap();
            let reply = if cmd["method"] == "Target.attachToTarget" {
                serde_json::json!({"id": cmd["id"], "result": {"sessionId": "MOCK-PAGE-SESSION"}})
            } else {
                serde_json::json!({"id": cmd["id"], "result": {}})
            };
            if ws
                .send(tokio_tungstenite::tungstenite::Message::Text(reply.to_string().into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });
    let client = CdpClient::connect(&format!("ws://{cdp_addr}")).await.expect("mock cdp");

    let tmp = tempdir().unwrap();
    let workspace_root = tmp.path().to_path_buf();
    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));
    let config = DamHopperConfig {
        workspace: WorkspaceInfo { name: "test".into(), root: workspace_root.display().to_string() },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
        projects: vec![],
        features: FeaturesConfig::default(),
        ui: None,
        workspaces: None,
        config_path: workspace_root.join("dam-hopper.toml"),
    };
    let state = AppState::new(
        workspace_root.clone(),
        config,
        GlobalConfig::default(),
        pty_manager,
        AgentStoreService::new(workspace_root.join(".dam-hopper/agent-store")),
        event_sink.clone(),
        "test-secret-audio-gate".to_string(),
        FsSubsystem::new(vec![]),
        None,
        true,
        TunnelSessionManager::new(Arc::new(event_sink), Arc::new(CloudflaredDriver)),
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        DiagnosticStore::new(workspace_root.join("diagnostics.jsonl")),
    )
    .expect("test AppState");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let local_addr = listener.local_addr().unwrap();
    state.record_bound_listener(local_addr).expect("record listener");
    let router = build_router(state);
    tokio::spawn(async move {
        axum::serve(listener, router.into_make_service_with_connect_info::<std::net::SocketAddr>())
            .await
            .unwrap();
    });

    let inc = Uuid::new_v4().to_string();
    let (dto, _) = dam_hopper_server::api::browser_host::global_session_registry()
        .insert_running_for_test(
            "dev-user",
            true,
            &inc,
            1,
            &dam_hopper_server::browser_host::session::CreateSessionRequest {
                creation_key: Uuid::new_v4().to_string(),
                url: "about:blank".to_string(),
                viewport: dam_hopper_server::browser_host::session::ViewportRequest { width: 1280, height: 900, dpr: 1.0 },
            },
            &[],
        )
        .await
        .unwrap();
    let session_id = dto.browser_session_id;
    let producer = Arc::new(
        ScreencastProducer::new(
            session_id.clone(),
            inc.clone(),
            1,
            1,
            client,
            "PAGE-AUDIO-GATE".to_string(),
            TargetGeometry {
                css_width: 1280.0, css_height: 900.0, offset_top: 0.0, scroll_x: 0.0, scroll_y: 0.0,
                page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0, dpr: 1.0,
            },
        )
        .with_capture_policy(24, 75),
    );
    producer.ensure_page_session().await.expect("page session");
    producer.start_screencast_run().await.expect("start run");
    get_or_register_producer(&session_id, producer.clone()).await;

    let viewer_id = "audio-gate-viewer";
    let sub_epoch = Uuid::new_v4().to_string();
    let admission = BrowserAdmission {
        principal: "dev-user".to_string(),
        is_dev: true,
        session_id: Some("dev-sess".to_string()),
        auth_version: Some(1),
        credential_version: Some(1),
        effective_deadline: None,
    };
    let ticket = global_attachment_manager()
        .issue_ticket(
            &admission,
            &IssueTicketRequest {
                purpose: AttachmentPurpose::Media,
                browser_session_id: Some(session_id.clone()),
                viewer_id: Some(viewer_id.to_string()),
                subscription_epoch: Some(sub_epoch.clone()),
                browser_incarnation: inc.clone(),
                profile_epoch: 1,
            },
            None,
        )
        .await
        .unwrap();
    let mut req = format!("ws://{local_addr}/api/browser/media").into_client_request().unwrap();
    req.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        format!("damhopper.browser.media.v1, damhopper.ticket.{}", ticket.ticket).parse().unwrap(),
    );
    let (mut media_ws, _) = connect_async(req).await.expect("media ws connect");
    for _ in 0..80 {
        if producer.viewer_audio_gate(&sub_epoch).is_some() {
            break;
        }
        sleep(Duration::from_millis(25)).await;
    }
    assert!(producer.viewer_audio_gate(&sub_epoch).is_some(), "media session registered its subscription");

    let pcm = B64.encode([0x12u8, 0x34, 0x56, 0x78]);
    // Attach can race the run's first zero-demand tick: wait until the producer is settled.
    for _ in 0..120 {
        if producer.state().await == dam_hopper_server::browser_host::screencast::ScreencastState::Streaming
            && producer.audio_source_run().is_some()
        {
            break;
        }
        sleep(Duration::from_millis(25)).await;
    }
    let run = producer.audio_source_run().expect("audio source");
    let doc = producer.audio_doc_epoch();

    // A new subscription starts audio-suppressed (muted=true default) until explicit muteState.
    assert_eq!(
        producer.viewer_audio_gate(&sub_epoch),
        Some(dam_hopper_server::browser_host::adaptive_stream_controller::AudioGate::Suppressed(
            dam_hopper_server::browser_host::adaptive_stream_controller::AudioSuppression::Muted
        ))
    );
    media_ws
        .send(tokio_tungstenite::tungstenite::Message::Text(
            serde_json::json!({
                "kind": "muteState",
                "subscriptionEpoch": sub_epoch,
                "muted": false,
            })
            .to_string()
            .into(),
        ))
        .await
        .expect("send muteState unmute");
    for _ in 0..40 {
        if producer.viewer_audio_gate(&sub_epoch).is_some_and(|g| g.is_allowed()) {
            break;
        }
        sleep(Duration::from_millis(25)).await;
    }
    assert_eq!(
        producer.viewer_audio_gate(&sub_epoch),
        Some(dam_hopper_server::browser_host::adaptive_stream_controller::AudioGate::Allowed)
    );

    // 1. Allowed viewer receives audio.
    producer.admit_and_broadcast_audio_chunk(run, doc, &pcm).await.expect("chunk 1");
    assert_eq!(collect_audio_seqs(&mut media_ws, Duration::from_millis(900)).await, vec!["1"]);

    // 2. Consumed wire mute acknowledgement: client sends muteState over wire and waits
    // until server acknowledges via streamQuality event (audioSuppressed: true, audioReason: "muted").
    media_ws
        .send(tokio_tungstenite::tungstenite::Message::Text(
            serde_json::json!({
                "kind": "muteState",
                "subscriptionEpoch": sub_epoch,
                "muted": true,
            })
            .to_string()
            .into(),
        ))
        .await
        .expect("send wire mute");
    let mut mute_ack_seen = false;
    for _ in 0..40 {
        if let Ok(Some(Ok(tokio_tungstenite::tungstenite::Message::Text(t)))) =
            timeout(Duration::from_millis(50), media_ws.next()).await
        {
            if let Ok(dam_hopper_server::browser_host::protocol::ServerMediaEvent::Quality(q)) =
                dam_hopper_server::browser_host::protocol::ServerMediaEvent::parse_and_validate(&t)
            {
                if q.subscription_epoch == sub_epoch
                    && q.audio_suppressed
                    && q.audio_reason
                        == Some(dam_hopper_server::browser_host::protocol::StreamAudioReason::Muted)
                {
                    mute_ack_seen = true;
                    break;
                }
            }
        }
    }
    assert!(
        mute_ack_seen,
        "consumed matching wire mute ack must be actually observed before no-audio window"
    );
    assert_eq!(
        producer.viewer_audio_gate(&sub_epoch),
        Some(dam_hopper_server::browser_host::adaptive_stream_controller::AudioGate::Suppressed(
            dam_hopper_server::browser_host::adaptive_stream_controller::AudioSuppression::Muted
        ))
    );
    producer.admit_and_broadcast_audio_chunk(run, doc, &pcm).await.expect("chunk 2 admitted by producer");
    producer.admit_and_broadcast_audio_chunk(run, doc, &pcm).await.expect("chunk 3 admitted by producer");
    assert!(
        collect_audio_seqs(&mut media_ws, Duration::from_millis(700)).await.is_empty(),
        "muted viewer must receive zero newly sent audio chunks"
    );
    // 3. Unmute resumes with fresh chunks only; suppressed chunks are never replayed.
    assert!(producer.set_viewer_muted(&sub_epoch, false));
    producer.admit_and_broadcast_audio_chunk(run, doc, &pcm).await.expect("chunk 4");
    assert_eq!(collect_audio_seqs(&mut media_ws, Duration::from_millis(900)).await, vec!["4"]);

    // 4. A removed/expired subscription fails closed even while another viewer keeps the source alive.
    producer
        .register_viewer_demand("keepalive-viewer", &Uuid::new_v4().to_string(), true)
        .await;
    producer.remove_viewer_demand(&sub_epoch).await;
    assert!(producer.viewer_audio_gate(&sub_epoch).is_none());
    producer.admit_and_broadcast_audio_chunk(run, doc, &pcm).await.expect("chunk 5 admitted by producer");
    assert!(
        collect_audio_seqs(&mut media_ws, Duration::from_millis(700)).await.is_empty(),
        "a subscription unknown to the controller receives no audio"
    );
    // 4b. Admission watermark (C2-W3): deliberately held broadcast backlog is rejected on
    // both asynchronous controller recovery (Allowed -> Suppressed -> Allowed) and wire unmute.
    let sub_wm = Uuid::new_v4().to_string();
    let ticket_wm = global_attachment_manager()
        .issue_ticket(
            &admission,
            &IssueTicketRequest {
                purpose: AttachmentPurpose::Media,
                browser_session_id: Some(session_id.clone()),
                viewer_id: Some("watermark-viewer".to_string()),
                subscription_epoch: Some(sub_wm.clone()),
                browser_incarnation: inc.clone(),
                profile_epoch: 1,
            },
            None,
        )
        .await
        .unwrap();
    let mut req_wm = format!("ws://{local_addr}/api/browser/media").into_client_request().unwrap();
    req_wm.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        format!("damhopper.browser.media.v1, damhopper.ticket.{}", ticket_wm.ticket).parse().unwrap(),
    );
    let (mut wm_ws, _) = connect_async(req_wm).await.expect("wm ws connect");
    for _ in 0..80 {
        if producer.viewer_audio_gate(&sub_wm).is_some() {
            break;
        }
        sleep(Duration::from_millis(25)).await;
    }

    // Unmute sub_wm via wire control so gate becomes Allowed
    wm_ws.send(tokio_tungstenite::tungstenite::Message::Text(
        serde_json::json!({
            "kind": "muteState",
            "subscriptionEpoch": sub_wm,
            "muted": false,
        }).to_string().into()
    )).await.expect("send unmute");
    for _ in 0..40 {
        if producer.viewer_audio_gate(&sub_wm).is_some_and(|g| g.is_allowed()) {
            break;
        }
        sleep(Duration::from_millis(25)).await;
    }

    // Asynchronous controller gate suppression (e.g. Hidden / Constrained)
    let sample = dam_hopper_server::browser_host::adaptive_stream_controller::ViewerSample {
        provenance: dam_hopper_server::browser_host::viewer_delivery_estimator::SampleProvenance::Idle,
        ack_starved: false,
        service_ewma_ms: Some(10.0),
        baseline_ms: Some(10.0),
        outstanding_frames: 0,
        oldest_age_ms: 0,
        has_pending: false,
        decode_ms_ewma: None,
        frame_bytes_ewma: Some(10_000.0),
        audio_kbps_ewma: 0.0,
        delivered_kbps_ewma: Some(10_000.0),
        progress_counter: 100,
        motion_counter: 100,
    };
    // Deterministic barrier: hold audio drain so broadcast chunks are queued unread
    // in the receiver while the gate is suppressed.
    let dropped_before = producer.ledger.audio_dropped_by_boundary.load(std::sync::atomic::Ordering::SeqCst);
    producer.hold_audio_drain();

    // 4b.1: Recovery via tier/stall (Hidden report)
    let d_supp = producer.adaptive_report(&sub_wm, false, sample).expect("report hidden");
    assert!(matches!(d_supp.audio, dam_hopper_server::browser_host::adaptive_stream_controller::AudioGate::Suppressed(_)));

    // Broadcast chunks 6 & 7 into backlog while gate is suppressed; receiver is blocked from draining.
    producer.admit_and_broadcast_audio_chunk(run, doc, &pcm).await.expect("chunk 6");
    producer.admit_and_broadcast_audio_chunk(run, doc, &pcm).await.expect("chunk 7");

    // Asynchronous controller gate recovery (visible=true -> Allowed); records watermark = 7.
    let d_rec = producer.adaptive_report(&sub_wm, true, sample).expect("report visible");
    assert!(d_rec.audio.is_allowed());

    // Broadcast chunk 8 after recovery.
    producer.admit_and_broadcast_audio_chunk(run, doc, &pcm).await.expect("chunk 8");

    // Release audio drain: media.rs drains queued chunks 6 and 7 while gate is Allowed,
    // but the admission watermark (7) drops them, delivering ONLY chunk 8!
    // The barrier parks the media receiver BEFORE it takes anything off the broadcast channel, so
    // nothing was consumed while the gate was closed or at the instant it reopened.
    assert_eq!(
        producer.ledger.audio_dropped_by_boundary.load(std::sync::atomic::Ordering::SeqCst),
        dropped_before,
        "held backlog (chunks 6, 7) must still be unread before release"
    );
    producer.release_audio_drain();
    assert_eq!(collect_audio_seqs(&mut wm_ws, Duration::from_millis(900)).await, vec!["8"]);
    assert_eq!(
        producer.ledger.audio_dropped_by_boundary.load(std::sync::atomic::Ordering::SeqCst),
        dropped_before + 2,
        "exactly the two pre-recovery chunks were dequeued after reopening and dropped by the boundary"
    );

    // 4b.2: Recovery via explicit wire unmute
    let dropped_before_wire = producer.ledger.audio_dropped_by_boundary.load(std::sync::atomic::Ordering::SeqCst);
    producer.hold_audio_drain();
    wm_ws.send(tokio_tungstenite::tungstenite::Message::Text(
        serde_json::json!({
            "kind": "muteState",
            "subscriptionEpoch": sub_wm,
            "muted": true,
        }).to_string().into()
    )).await.expect("send wire mute");
    let mut wm_mute_ack = false;
    for _ in 0..40 {
        if let Ok(Some(Ok(tokio_tungstenite::tungstenite::Message::Text(t)))) =
            timeout(Duration::from_millis(50), wm_ws.next()).await
        {
            if let Ok(dam_hopper_server::browser_host::protocol::ServerMediaEvent::Quality(q)) =
                dam_hopper_server::browser_host::protocol::ServerMediaEvent::parse_and_validate(&t)
            {
                if q.subscription_epoch == sub_wm && q.audio_suppressed && q.audio_reason == Some(dam_hopper_server::browser_host::protocol::StreamAudioReason::Muted) {
                    wm_mute_ack = true;
                    break;
                }
            }
        }
    }
    assert!(wm_mute_ack, "must observe consumed wire mute ack");

    // Broadcast chunks 9 & 10 into backlog while muted and held
    producer.admit_and_broadcast_audio_chunk(run, doc, &pcm).await.expect("chunk 9");
    producer.admit_and_broadcast_audio_chunk(run, doc, &pcm).await.expect("chunk 10");

    // Explicit wire unmute recovery -> gate transitions to Allowed, watermark recorded as 10
    wm_ws.send(tokio_tungstenite::tungstenite::Message::Text(
        serde_json::json!({
            "kind": "muteState",
            "subscriptionEpoch": sub_wm,
            "muted": false,
        }).to_string().into()
    )).await.expect("send wire unmute");
    for _ in 0..40 {
        if producer.viewer_audio_gate(&sub_wm).is_some_and(|g| g.is_allowed()) {
            break;
        }
        sleep(Duration::from_millis(25)).await;
    }
    assert_eq!(producer.viewer_audio_gate(&sub_wm), Some(dam_hopper_server::browser_host::adaptive_stream_controller::AudioGate::Allowed));

    // Broadcast chunk 11 after wire unmute recovery
    producer.admit_and_broadcast_audio_chunk(run, doc, &pcm).await.expect("chunk 11");

    // Release audio drain: chunks 9 and 10 were queued in backlog; admission watermark (10) drops them!
    assert_eq!(
        producer.ledger.audio_dropped_by_boundary.load(std::sync::atomic::Ordering::SeqCst),
        dropped_before_wire,
        "held backlog (chunks 9, 10) must still be unread before release"
    );
    producer.release_audio_drain();
    assert_eq!(collect_audio_seqs(&mut wm_ws, Duration::from_millis(900)).await, vec!["11"]);
    assert_eq!(
        producer.ledger.audio_dropped_by_boundary.load(std::sync::atomic::Ordering::SeqCst),
        dropped_before_wire + 2,
        "chunks 9 and 10 were dequeued after the wire unmute and dropped by the boundary"
    );
    // 4c. Source-scoped admission watermark (C3-W1d): audio source restart resets audio_seq to 0
    // and creates a new audio_source_run. The retained subscription keeps watermark (10 under run1),
    // but because watermark is source-scoped, first chunks from the new source (seq 1, 2 <= 10)
    // are NOT suppressed and are delivered to the retained subscription.
    let run1 = run;
    let (_, _, wm1) = producer.viewer_audio_gate_info(&sub_wm).unwrap();
    assert_eq!(wm1.seq, 10); // recorded at wire unmute

    producer.stop_screencast().await.expect("stop screencast");
    producer.start_screencast_run().await.expect("start run2");
    let run2 = producer.audio_source_run().expect("run2 audio source");
    assert_ne!(run1, run2, "restarted source must have distinct run id");
    // First chunks from the new source have sequences 1, 2 <= watermark 10 from old source!
    // Because watermark is source-scoped, they MUST be delivered to the retained subscription!
    producer.admit_and_broadcast_audio_chunk(run2, doc, &pcm).await.expect("chunk 1 on run2");
    let seqs2_1 = collect_audio_seqs(&mut wm_ws, Duration::from_millis(900)).await;
    assert_eq!(
        seqs2_1,
        vec!["1"],
        "first chunk of restarted audio source must be delivered to retained subscription"
    );

    producer.admit_and_broadcast_audio_chunk(run2, doc, &pcm).await.expect("chunk 2 on run2");
    let seqs2_2 = collect_audio_seqs(&mut wm_ws, Duration::from_millis(900)).await;
    assert_eq!(
        seqs2_2,
        vec!["2"],
        "subsequent chunks of restarted audio source must be delivered to retained subscription"
    );
    let _ = wm_ws.close(None).await;
    // 5. Cross-subscription control is ignored with no effect on live subscription.
    media_ws
        .send(tokio_tungstenite::tungstenite::Message::Text(
            serde_json::json!({
                "kind": "qualityPreference",
                "subscriptionEpoch": "wrong-cross-sub",
                "preference": "low",
            })
            .to_string()
            .into(),
        ))
        .await
        .expect("send cross-subscription control");
    sleep(Duration::from_millis(50)).await;
    // Still none because removed
    assert!(producer.viewer_audio_gate(&sub_epoch).is_none());

    // 6. Malformed client control message disconnects the socket.
    media_ws
        .send(tokio_tungstenite::tungstenite::Message::Text(
            "{\"kind\":\"invalidControlKind\"}".to_string().into(),
        ))
        .await
        .expect("send malformed control");
    let closed = timeout(Duration::from_secs(2), async {
        while let Some(msg) = media_ws.next().await {
            if let Ok(tokio_tungstenite::tungstenite::Message::Close(_)) = msg {
                return true;
            }
        }
        true
    })
    .await;
    assert!(closed.is_ok(), "malformed client control message disconnects socket");

    // 7. Producer-less media session emits unavailable once.
    let (dto2, _) = dam_hopper_server::api::browser_host::global_session_registry()
        .insert_running_for_test(
            "dev-user",
            true,
            &inc,
            1,
            &dam_hopper_server::browser_host::session::CreateSessionRequest {
                creation_key: Uuid::new_v4().to_string(),
                url: "about:blank".to_string(),
                viewport: dam_hopper_server::browser_host::session::ViewportRequest { width: 1280, height: 900, dpr: 1.0 },
            },
            &[],
        )
        .await
        .unwrap();
    let unavail_sub = Uuid::new_v4().to_string();
    let unavail_ticket = global_attachment_manager()
        .issue_ticket(
            &admission,
            &IssueTicketRequest {
                purpose: AttachmentPurpose::Media,
                browser_session_id: Some(dto2.browser_session_id),
                viewer_id: Some("unavail-viewer".to_string()),
                subscription_epoch: Some(unavail_sub.clone()),
                browser_incarnation: inc.clone(),
                profile_epoch: 1,
            },
            None,
        )
        .await
        .unwrap();
    let mut unavail_req = format!("ws://{local_addr}/api/browser/media").into_client_request().unwrap();
    unavail_req.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        format!("damhopper.browser.media.v1, damhopper.ticket.{}", unavail_ticket.ticket).parse().unwrap(),
    );
    let (mut unavail_ws, _) = connect_async(unavail_req).await.expect("unavail ws connect");
    let unavail_msg = timeout(Duration::from_secs(2), unavail_ws.next()).await.unwrap().unwrap().unwrap();
    let unavail_text = match unavail_msg {
        tokio_tungstenite::tungstenite::Message::Text(t) => t,
        other => panic!("expected text, got {other:?}"),
    };
    let unavail_ev = dam_hopper_server::browser_host::protocol::ServerMediaEvent::parse_and_validate(&unavail_text).unwrap();
    match unavail_ev {
        dam_hopper_server::browser_host::protocol::ServerMediaEvent::Quality(q) => {
            assert_eq!(q.status, dam_hopper_server::browser_host::protocol::StreamQualityStatus::Unavailable);
            assert_eq!(q.preference, dam_hopper_server::browser_host::capture_tier::QualityPreference::Auto);
            assert!(q.audio_suppressed);
            assert_eq!(q.audio_reason, Some(dam_hopper_server::browser_host::protocol::StreamAudioReason::Muted));
        }
        other => panic!("expected quality event, got {other:?}"),
    }
    assert!(timeout(Duration::from_millis(300), unavail_ws.next()).await.is_err(), "unavailable emitted once");
    let _ = unavail_ws.close(None).await;
}

#[tokio::test]
async fn test_media_writer_drops_queued_audio_when_gate_closes_before_the_write() {
    use dam_hopper_server::browser_host::media_writer::{
        spawn_media_writer, MediaPacketSink, MediaWriterEvent, OutboundMediaPacket,
    };
    use dam_hopper_server::browser_host::protocol::{
        ProducerAudioChunk, AUDIO_CHANNELS, AUDIO_ENCODING_PCM16LE, AUDIO_SAMPLE_RATE,
    };
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::atomic::{AtomicBool, Ordering};
    use tokio::sync::Notify;
    use tokio_util::sync::CancellationToken;

    struct BlockedSink {
        started: Arc<Notify>,
        release: Arc<Notify>,
        sent: Arc<parking_lot::Mutex<Vec<OutboundMediaPacket>>>,
    }
    impl MediaPacketSink for BlockedSink {
        fn send_packet(
            &mut self,
            packet: OutboundMediaPacket,
        ) -> Pin<Box<dyn Future<Output = Result<(), &'static str>> + Send + '_>> {
            let (started, release, sent) = (self.started.clone(), self.release.clone(), self.sent.clone());
            Box::pin(async move {
                started.notify_one();
                release.notified().await;
                sent.lock().push(packet);
                Ok(())
            })
        }
    }

    let (started, release) = (Arc::new(Notify::new()), Arc::new(Notify::new()));
    let sent = Arc::new(parking_lot::Mutex::new(Vec::new()));
    let gate_open = Arc::new(AtomicBool::new(true));
    let gate = gate_open.clone();
    let cancel = CancellationToken::new();
    let (writer, mut events, join) = spawn_media_writer(
        BlockedSink { started: started.clone(), release: release.clone(), sent: sent.clone() },
        cancel.clone(),
        None,
        move |_run, _doc, _gen, _seq| gate.load(Ordering::SeqCst),
    );
    let sub = Uuid::new_v4().to_string();
    let chunk = |seq: &str| {
        use base64::Engine as _;
        ProducerAudioChunk {
            browser_session_id: Uuid::new_v4().to_string(),
            browser_incarnation: Uuid::new_v4().to_string(),
            profile_epoch: "1".to_string(),
            audio_run: Uuid::new_v4().to_string(),
            doc_epoch: 1,
            audio_seq: seq.to_string(),
            sample_rate: AUDIO_SAMPLE_RATE,
            channels: AUDIO_CHANNELS,
            encoding: AUDIO_ENCODING_PCM16LE.to_string(),
            data: Arc::from(base64::engine::general_purpose::STANDARD.encode([0u8; 960])),
            reservation: None,
        }
    };

    // Block the writer on a control write, queue audio behind it, then close the gate.
    writer.enqueue_control_text("{\"kind\":\"status\"}".to_string());
    started.notified().await;
    assert!(writer.enqueue_latest_audio(&sub, chunk("1"), 1, 1));
    gate_open.store(false, Ordering::SeqCst);
    release.notify_one();
    assert!(matches!(events.recv().await, Some(MediaWriterEvent::ControlSent { .. })));
    sleep(Duration::from_millis(150)).await;
    assert_eq!(sent.lock().len(), 1, "queued audio never crosses the closed gate; only the control packet was written");

    // Reopened gate: a fresh chunk is written; the dropped one is never replayed.
    gate_open.store(true, Ordering::SeqCst);
    assert!(writer.enqueue_latest_audio(&sub, chunk("2"), 2, 2));
    started.notified().await;
    release.notify_one();
    assert!(matches!(events.recv().await, Some(MediaWriterEvent::AudioSent { .. })));
    let packets = sent.lock();
    assert_eq!(packets.len(), 2);
    match &packets[1] {
        OutboundMediaPacket::Text(t) => assert!(t.contains("\"audioSeq\":\"2\""), "{t}"),
        other => panic!("unexpected packet {other:?}"),
    }
    drop(packets);
    cancel.cancel();
    let _ = join.await;
}

/// Live pair lifecycle over real sockets: pair-owned global capacity, timer reaping of half
/// pairs, producer-attach failure and closed/stale session tickets (dev-mode server, mock CDP).
mod pair_live {
    use super::*;
    use dam_hopper_server::agent_store::AgentStoreService;
    use dam_hopper_server::api::browser_host::{get_or_register_producer, global_session_registry};
    use dam_hopper_server::browser_host::attachments::PAIR_WAIT_TIMEOUT;
    use dam_hopper_server::browser_host::cdp::CdpClient;
    use dam_hopper_server::browser_host::screencast::ScreencastProducer;
    use dam_hopper_server::config::{DamHopperConfig, FeaturesConfig, GlobalConfig, WorkspaceInfo};
    use dam_hopper_server::crypto::DamHopperOpaqueSuite;
    use dam_hopper_server::diagnostics::DiagnosticStore;
    use dam_hopper_server::fs::FsSubsystem;
    use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
    use dam_hopper_server::state::AppState;
    use dam_hopper_server::tunnel::{CloudflaredDriver, TunnelSessionManager};
    use futures_util::{SinkExt, StreamExt};
    use opaque_ke::ServerSetup;
    use rand::rngs::OsRng;
    use serde_json::{json, Value};
    use std::net::SocketAddr;
    use tokio::time::timeout;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::Message;

    type Ws = tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >;

    /// ACTIVE_VIEWERS is process-global: every live-socket test of this file takes this guard.
    static LIVE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    /// Serializes live-socket tests and waits until the previous test's server-side pairs have
    /// finished tearing down (their permits are released asynchronously after the socket drops).
    pub async fn live_guard() -> tokio::sync::MutexGuard<'static, ()> {
        let guard = LIVE_LOCK.lock().await;
        for _ in 0..200 {
            if dam_hopper_server::browser_host::media::ACTIVE_VIEWERS
                .load(std::sync::atomic::Ordering::SeqCst)
                == 0
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        guard
    }

    pub struct Server {
        pub addr: SocketAddr,
        pub inc: String,
        http: reqwest::Client,
        _tmp: tempfile::TempDir,
    }

    pub async fn start(max_viewers: usize) -> Server {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        let (event_sink, _rx) = BroadcastEventSink::new(512);
        let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));
        let config = DamHopperConfig {
            workspace: WorkspaceInfo { name: "test".into(), root: root.display().to_string() },
            agent_store: None,
            server: dam_hopper_server::config::ServerConfig::default(),
            projects: vec![],
            features: FeaturesConfig::default(),
            ui: None,
            workspaces: None,
            config_path: root.join("dam-hopper.toml"),
        };
        let state = AppState::new(
            root.clone(),
            config,
            GlobalConfig::default(),
            pty_manager,
            AgentStoreService::new(root.join(".dam-hopper/agent-store")),
            event_sink.clone(),
            "test-secret-pair-live".to_string(),
            FsSubsystem::new(vec![]),
            None,
            true,
            TunnelSessionManager::new(Arc::new(event_sink), Arc::new(CloudflaredDriver)),
            None,
            ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
            DiagnosticStore::new(root.join("diagnostics.jsonl")),
        )
        .expect("test AppState");
        state.config.write().await.server.browser.budgets.max_viewers = max_viewers;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        state.record_bound_listener(addr).expect("record listener");
        let router = dam_hopper_server::api::build_router(state);
        tokio::spawn(async move {
            axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>())
                .await
                .unwrap();
        });
        Server { addr, inc: Uuid::new_v4().to_string(), http: reqwest::Client::new(), _tmp: tmp }
    }

    /// A Running session; `with_producer` also registers a producer over a mock CDP browser.
    pub async fn session(server: &Server, with_producer: bool) -> String {
        let (dto, _) = global_session_registry()
            .insert_running_for_test(
                "dev-user",
                true,
                &server.inc,
                1,
                &dam_hopper_server::browser_host::session::CreateSessionRequest {
                    creation_key: Uuid::new_v4().to_string(),
                    url: "about:blank".to_string(),
                    viewport: dam_hopper_server::browser_host::session::ViewportRequest {
                        width: 1280,
                        height: 900,
                        dpr: 1.0,
                    },
                },
                &[],
            )
            .await
            .unwrap();
        let session_id = dto.browser_session_id;
        if with_producer {
            attach_mock_producer(&session_id, &server.inc).await;
        }
        session_id
    }

    /// Registers a producer for `session_id` over a mock CDP browser (replies success to
    /// every command), so the media upgrade's producer attach succeeds.
    pub async fn attach_mock_producer(session_id: &str, inc: &str) {
        let cdp = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let cdp_addr = cdp.local_addr().unwrap();
        tokio::spawn(async move {
            let Ok((stream, _)) = cdp.accept().await else { return };
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            while let Some(Ok(Message::Text(text))) = ws.next().await {
                let cmd: Value = serde_json::from_str(&text).unwrap();
                let result = if cmd["method"] == "Target.attachToTarget" {
                    json!({"sessionId": "MOCK-PAGE-SESSION"})
                } else {
                    json!({})
                };
                let reply = json!({"id": cmd["id"], "result": result});
                if ws.send(Message::Text(reply.to_string().into())).await.is_err() {
                    break;
                }
            }
        });
        let client = CdpClient::connect(&format!("ws://{cdp_addr}")).await.expect("mock cdp");
        let producer = Arc::new(ScreencastProducer::new(
            session_id.to_string(),
            inc.to_string(),
            1,
            1,
            client,
            "PAGE-PAIR-LIVE".to_string(),
            TargetGeometry {
                css_width: 1280.0, css_height: 900.0, offset_top: 0.0, scroll_x: 0.0,
                scroll_y: 0.0, page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0,
                dpr: 1.0,
            },
        ));
        producer.ensure_page_session().await.expect("page session");
        get_or_register_producer(session_id, producer).await;
    }

    impl Server {
        pub async fn rest(&self, method: &str, path: &str, body: Value) -> (u16, Value) {
            let url = format!("http://{}{path}", self.addr);
            let req = match method {
                "DELETE" => self.http.delete(url),
                _ => self.http.post(url).header("content-type", "application/json").body(body.to_string()),
            };
            let resp = req.send().await.expect("rest request");
            let status = resp.status().as_u16();
            let bytes = resp.bytes().await.unwrap();
            (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
        }

        pub async fn ticket_for(&self, purpose: &str, session: &str, viewer: &str, sub: &str, inc: &str, epoch: &str) -> (u16, Value) {
            self.rest(
                "POST",
                "/api/browser/attachments",
                json!({
                    "purpose": purpose, "browserSessionId": session, "viewerId": viewer,
                    "subscriptionEpoch": sub, "browserIncarnation": inc, "profileEpoch": epoch,
                }),
            )
            .await
        }

        pub async fn upgrade(&self, kind: &str, ticket: &str) -> Result<Ws, u16> {
            let mut req = format!("ws://{}/api/browser/{kind}", self.addr).into_client_request().unwrap();
            req.headers_mut().insert(
                "Sec-WebSocket-Protocol",
                format!("damhopper.browser.{kind}.v1, damhopper.ticket.{ticket}").parse().unwrap(),
            );
            match tokio_tungstenite::connect_async(req).await {
                Ok((ws, _)) => Ok(ws),
                Err(tokio_tungstenite::tungstenite::Error::Http(resp)) => Err(resp.status().as_u16()),
                Err(other) => panic!("ws connect failed: {other}"),
            }
        }

        /// Issues a ticket (must succeed) and attempts the upgrade.
        pub async fn connect(&self, kind: &str, session: &str, viewer: &str) -> Result<Ws, u16> {
            let sub = Uuid::new_v4().to_string();
            self.connect_sub(kind, session, viewer, &sub).await
        }

        pub async fn connect_sub(&self, kind: &str, session: &str, viewer: &str, sub: &str) -> Result<Ws, u16> {
            let (status, body) = self.ticket_for(kind, session, viewer, sub, &self.inc, "1").await;
            assert_eq!(status, 200, "ticket issue: {body}");
            self.upgrade(kind, body["ticket"].as_str().unwrap()).await
        }
    }

    async fn first_text(ws: &mut Ws) -> String {
        loop {
            match timeout(Duration::from_secs(5), ws.next()).await.expect("ws message") {
                Some(Ok(Message::Text(text))) => return text.to_string(),
                Some(Ok(_)) => continue,
                other => panic!("socket ended early: {other:?}"),
            }
        }
    }

    /// True once the server closed the socket (Close frame or end of stream) within `within`.
    async fn closed_within(ws: &mut Ws, within: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + Duration::from_millis(within.as_millis() as u64);
        loop {
            let Ok(next) = timeout(deadline.saturating_duration_since(tokio::time::Instant::now()), ws.next()).await else {
                return false;
            };
            match next {
                None | Some(Err(_)) | Some(Ok(Message::Close(_))) => return true,
                Some(Ok(_)) => continue,
            }
        }
    }

    /// Fires every pending pair deadline timer without waiting 15s of wall clock.
    async fn pass_pair_deadline() {
        tokio::time::pause();
        tokio::time::advance(PAIR_WAIT_TIMEOUT + Duration::from_secs(1)).await;
        tokio::time::resume();
    }

    async fn retry_connect(server: &Server, kind: &str, session: &str, viewer: &str) -> Result<Ws, u16> {
        let mut last = 0;
        for _ in 0..60 {
            match server.connect(kind, session, viewer).await {
                Ok(ws) => return Ok(ws),
                Err(status) => last = status,
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Err(last)
    }

    #[tokio::test]
    async fn control_only_socket_is_reaped_at_the_pair_deadline_without_traffic() {
        let _live = live_guard().await;
        let server = start(4).await;
        let session = session(&server, true).await;
        let mut control = server.connect("control", &session, "viewer-solo").await.expect("control upgrade");
        let status = first_text(&mut control).await;
        assert!(status.contains("\"inputAvailable\":false"), "unpaired control must not advertise input: {status}");
        assert!(!closed_within(&mut control, Duration::from_millis(300)).await, "half pair must survive until its deadline");

        pass_pair_deadline().await;
        assert!(
            closed_within(&mut control, Duration::from_secs(5)).await,
            "control-only socket still open after the pair deadline, with no traffic to trigger pruning"
        );
    }

    #[tokio::test]
    async fn half_pairs_hold_global_capacity_until_reaped() {
        let _live = live_guard().await;
        let server = start(1).await;
        let with_producer = session(&server, true).await;
        let mut solo = server.connect("control", &with_producer, "viewer-1").await.expect("first half pair admitted");
        first_text(&mut solo).await;

        assert_eq!(server.connect("control", &with_producer, "viewer-2").await.err(), Some(429), "control-only socket bypassed capacity");
        assert_eq!(server.connect("media", &with_producer, "viewer-3").await.err(), Some(429), "capacity must be held by the half pair");

        pass_pair_deadline().await;
        assert!(closed_within(&mut solo, Duration::from_secs(5)).await);
        retry_connect(&server, "control", &with_producer, "viewer-2")
            .await
            .expect("capacity returns once the half pair is reaped");
    }

    #[tokio::test]
    async fn media_and_control_of_one_pair_share_a_single_global_permit() {
        let _live = live_guard().await;
        let server = start(2).await;
        let session_a = session(&server, true).await;
        let session_b = session(&server, true).await;
        let session_c = session(&server, true).await;
        let sub_a = Uuid::new_v4().to_string();

        let _media_a = server.connect_sub("media", &session_a, "viewer-a", &sub_a).await.expect("media A");
        let mut control_a = server.connect_sub("control", &session_a, "viewer-a", &sub_a).await.expect("A's control joins A's permit");
        let status = first_text(&mut control_a).await;
        assert!(status.contains("\"inputAvailable\":true"), "complete pair is input-ready: {status}");
        let _media_b = server.connect("media", &session_b, "viewer-b").await.expect("pair B takes the second permit");

        assert_eq!(
            server.connect("control", &session_c, "viewer-c").await.err(),
            Some(429),
            "two pairs fill capacity 2; a third viewer's control must be refused"
        );
    }

    #[tokio::test]
    async fn failed_producer_attach_holds_no_capacity_and_never_readies_control() {
        let _live = live_guard().await;
        let server = start(1).await;
        let without_producer = session(&server, false).await;
        let sub = Uuid::new_v4().to_string();
        let mut media = server.connect_sub("media", &without_producer, "viewer-1", &sub).await.expect("media upgrade");
        let quality = first_text(&mut media).await;
        assert!(quality.contains("unavailable"), "producer-less media reports unavailable: {quality}");

        let with_producer = session(&server, true).await;
        let _healthy = server
            .connect("media", &with_producer, "viewer-2")
            .await
            .expect("failed attach must not keep the only capacity slot");
        assert_eq!(
            server.connect_sub("control", &without_producer, "viewer-1", &sub).await.err(),
            Some(403),
            "control must not pair with a media socket whose producer attach failed"
        );
    }

    #[tokio::test]
    async fn closed_and_stale_sessions_refuse_ticket_issue_and_consumption() {
        let _live = live_guard().await;
        let server = start(4).await;
        let session = session(&server, true).await;

        // Stale identity at issue: wrong incarnation / wrong profile epoch.
        let sub = Uuid::new_v4().to_string();
        let (stale_inc, _) = server.ticket_for("media", &session, "viewer-1", &sub, "other-incarnation", "1").await;
        assert_eq!(stale_inc, 404, "stale incarnation must not receive a ticket");
        let (stale_epoch, _) = server.ticket_for("media", &session, "viewer-1", &sub, &server.inc, "2").await;
        assert_eq!(stale_epoch, 404, "stale profile epoch must not receive a ticket");

        // Ticket issued before close, consumed after close.
        let (status, body) = server.ticket_for("control", &session, "viewer-1", &sub, &server.inc, "1").await;
        assert_eq!(status, 200);
        let early_ticket = body["ticket"].as_str().unwrap().to_string();
        let (status, body) = server.ticket_for("media", &session, "viewer-1", &sub, &server.inc, "1").await;
        assert_eq!(status, 200);
        let early_media_ticket = body["ticket"].as_str().unwrap().to_string();
        let _ = server.rest("DELETE", &format!("/api/browser/sessions/{session}"), Value::Null).await;

        assert!(server.upgrade("control", &early_ticket).await.is_err(), "ticket issued before close must not upgrade after it");
        assert!(server.upgrade("media", &early_media_ticket).await.is_err(), "ticket issued before close must not upgrade after it");

        // Issue on a closed/closing session.
        let (late, _) = server.ticket_for("control", &session, "viewer-1", &sub, &server.inc, "1").await;
        assert!(late == 404 || late == 409, "closed session must not receive a ticket, got {late}");
    }

    /// The consume-time identity check stands on its own: no DELETE/revoke ran, the session is
    /// merely no longer `Running` when the pre-issued ticket is presented.
    #[tokio::test]
    async fn ticket_issued_before_close_is_refused_at_consume_without_any_revoke() {
        let _live = live_guard().await;
        let server = start(4).await;
        let session = session(&server, true).await;
        let sub = Uuid::new_v4().to_string();
        let (status, body) = server.ticket_for("control", &session, "viewer-1", &sub, &server.inc, "1").await;
        assert_eq!(status, 200);
        let ticket = body["ticket"].as_str().unwrap().to_string();
        global_session_registry()
            .begin_close(&session, "dev-user")
            .await
            .expect("session begins closing");
        assert_eq!(server.upgrade("control", &ticket).await.err(), Some(409));
    }

    #[tokio::test]
    async fn simultaneous_half_pair_flood_admits_at_most_capacity_and_the_timer_reaps_all() {
        let _live = live_guard().await;
        let server = start(2).await;
        let session = session(&server, true).await;
        let attempts = (0..8).map(|n| {
            let (server, session) = (&server, &session);
            async move { server.connect("control", session, &format!("flood-viewer-{n}")).await }
        });
        let results = futures_util::future::join_all(attempts).await;
        let (ok, refused): (Vec<_>, Vec<_>) = results.into_iter().partition(Result::is_ok);
        let mut admitted: Vec<Ws> = ok.into_iter().map(Result::unwrap).collect();
        let refused: Vec<u16> = refused.into_iter().map(|r| r.err().unwrap()).collect();
        assert_eq!(admitted.len(), 2, "capacity 2 admits exactly two half pairs");
        assert_eq!(refused.len(), 6, "{refused:?}");
        assert!(refused.iter().all(|s| *s == 429), "{refused:?}");

        pass_pair_deadline().await;
        for ws in &mut admitted {
            assert!(closed_within(ws, Duration::from_secs(5)).await, "flooded half pair outlived its deadline");
        }
        retry_connect(&server, "control", &session, "after-flood")
            .await
            .expect("capacity returns after the flood is reaped");
    }

    /// Scriptable mock CDP browser for a recovering producer: a distinct Page session per attach,
    /// switchable ACK and attach failures, and frames pushed on the live connection.
    struct RecoveryPeer {
        fail_acks: Arc<std::sync::atomic::AtomicBool>,
        fail_attach: Arc<std::sync::atomic::AtomicBool>,
        push: tokio::sync::mpsc::UnboundedSender<Value>,
    }

    impl RecoveryPeer {
        fn frame(&self, session: &str, native_id: i64) {
            use base64::engine::general_purpose::STANDARD as B64;
            use base64::Engine as _;
            let _ = self.push.send(json!({"method": "Page.screencastFrame", "sessionId": session, "params": {
                "sessionId": native_id, "data": B64.encode(make_dummy_jpeg()),
                "metadata": {"offsetTop": 0.0, "pageScaleFactor": 1.0, "deviceWidth": 1280.0, "deviceHeight": 900.0,
                             "scrollOffsetX": 0.0, "scrollOffsetY": 0.0, "timestamp": 1.0}
            }}));
        }
    }

    async fn attach_recovering_producer(session_id: &str, inc: &str) -> RecoveryPeer {
        use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}", listener.local_addr().unwrap());
        let (fail_acks, fail_attach) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)));
        let (push, mut push_rx) = tokio::sync::mpsc::unbounded_channel::<Value>();
        let (acks, attach_failures) = (fail_acks.clone(), fail_attach.clone());
        tokio::spawn(async move {
            let attaches = AtomicUsize::new(0);
            let Ok((stream, _)) = listener.accept().await else { return };
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            loop {
                tokio::select! {
                    ev = push_rx.recv() => {
                        let Some(ev) = ev else { break };
                        if ws.send(Message::Text(ev.to_string().into())).await.is_err() { break; }
                    }
                    incoming = ws.next() => {
                        let Some(Ok(Message::Text(text))) = incoming else { break };
                        let cmd: Value = serde_json::from_str(&text).unwrap();
                        let reply = match cmd["method"].as_str().unwrap_or("") {
                            "Page.screencastFrameAck" if acks.load(Ordering::SeqCst) => {
                                json!({"id": cmd["id"], "error": {"code": -32000, "message": "ack failed"}})
                            }
                            "Target.attachToTarget" => {
                                let n = attaches.fetch_add(1, Ordering::SeqCst);
                                if n > 0 && attach_failures.load(Ordering::SeqCst) {
                                    json!({"id": cmd["id"], "error": {"code": -32000, "message": "attach failed"}})
                                } else {
                                    json!({"id": cmd["id"], "result": {"sessionId": format!("SESSION-{n}")}})
                                }
                            }
                            _ => json!({"id": cmd["id"], "result": {}}),
                        };
                        if ws.send(Message::Text(reply.to_string().into())).await.is_err() { break; }
                    }
                }
            }
        });
        let client = CdpClient::connect(&url).await.expect("scripted cdp");
        let producer = Arc::new(
            ScreencastProducer::new(
                session_id.to_string(),
                inc.to_string(),
                1,
                1,
                client,
                "PAGE-RECOVERY-LIVE".to_string(),
                TargetGeometry {
                    css_width: 1280.0, css_height: 900.0, offset_top: 0.0, scroll_x: 0.0,
                    scroll_y: 0.0, page_scale: 1.0, visual_offset_x: 0.0, visual_offset_y: 0.0,
                    dpr: 1.0,
                },
            )
            .with_recovery_policy(dam_hopper_server::browser_host::screencast::RecoveryPolicy {
                max_attempts: 2,
                base_backoff: Duration::from_millis(30),
                max_backoff: Duration::from_millis(60),
                ack_timeout: Duration::from_millis(400),
                stable_run: Duration::from_secs(60),
            }),
        );
        assert_eq!(producer.ensure_page_session().await.expect("page session"), "SESSION-0");
        get_or_register_producer(session_id, producer).await;
        RecoveryPeer { fail_acks, fail_attach, push }
    }

    /// Next `streamQuality` text event (other text messages are skipped).
    async fn next_quality(ws: &mut Ws) -> Value {
        loop {
            let v: Value = serde_json::from_str(&first_text(ws).await).unwrap();
            if v["kind"] == "streamQuality" {
                return v;
            }
        }
    }

    /// Waits for a streamQuality event satisfying `pred`, acknowledging nothing.
    async fn quality_where(ws: &mut Ws, pred: impl Fn(&Value) -> bool) -> Value {
        for _ in 0..40 {
            let q = next_quality(ws).await;
            if pred(&q) {
                return q;
            }
        }
        panic!("no matching streamQuality event");
    }

    /// Next delivered frame header whose run is `run`; every frame seen is acknowledged so the
    /// viewer's credit never starves.
    async fn frame_of_run(ws: &mut Ws, sub: &str, run: &str) -> dam_hopper_server::browser_host::protocol::TargetFrameHeader {
        for _ in 0..60 {
            let msg = timeout(Duration::from_secs(5), ws.next()).await.expect("media message").expect("media open").expect("ws ok");
            if let Message::Binary(bytes) = msg {
                let (header, _) = unpack_bhjf_frame(&bytes).expect("valid BHJF frame");
                let ack = json!({"kind": "frameAck", "subscriptionEpoch": sub, "producerRun": header.producer_run,
                    "viewportEpoch": header.viewport_epoch, "frameSeq": header.frame_seq, "decodeMs": 1.0});
                ws.send(Message::Text(ack.to_string().into())).await.expect("ack send");
                if header.producer_run == run {
                    return header;
                }
            }
        }
        panic!("no frame of run {run}");
    }

    #[tokio::test]
    async fn producer_recovery_keeps_the_viewer_socket_and_serves_the_fresh_run_then_reports_unavailable() {
        use std::sync::atomic::Ordering;
        let _live = live_guard().await;
        let server = start(2).await;
        let session = session(&server, false).await;
        let peer = attach_recovering_producer(&session, &server.inc).await;
        let sub = Uuid::new_v4().to_string();
        let mut media = server.connect_sub("media", &session, "viewer-recovery", &sub).await.expect("media upgrade");

        // Demand-driven start: the first run is announced by the stream quality event.
        let nil = Uuid::nil().to_string();
        let run1 = quality_where(&mut media, |q| q["producerRun"] != json!(nil)).await["producerRun"].as_str().unwrap().to_string();
        peer.frame("SESSION-0", 1);
        assert_eq!(frame_of_run(&mut media, &sub, &run1).await.producer_run, run1);

        // The next ACK fails: the run is ambiguous, the SAME socket is told about a fresh run
        // and receives its frames from the fresh Page session.
        peer.fail_acks.store(true, Ordering::SeqCst);
        peer.frame("SESSION-0", 1);
        let run2 = quality_where(&mut media, |q| q["producerRun"] != json!(nil) && q["producerRun"] != json!(run1)).await["producerRun"]
            .as_str()
            .unwrap()
            .to_string();
        peer.fail_acks.store(false, Ordering::SeqCst);
        peer.frame("SESSION-1", 1);
        assert_eq!(frame_of_run(&mut media, &sub, &run2).await.producer_run, run2, "same viewer, fresh run");

        // A persistently failing page ends visibly unavailable instead of spinning.
        peer.fail_acks.store(true, Ordering::SeqCst);
        peer.fail_attach.store(true, Ordering::SeqCst);
        peer.frame("SESSION-1", 1);
        let q = quality_where(&mut media, |q| q["status"] == "unavailable").await;
        assert_eq!(q["subscriptionEpoch"], json!(sub));
    }
}
