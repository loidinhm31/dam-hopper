use super::{dispatch_input_event_to_cdp, CdpClient, InputEvent, TargetGeometry};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;

#[tokio::test]
async fn aborted_control_task_retires_unclaimed_input_and_lease() {
    use crate::browser_host::input::{InputMessage, SessionInputManager};
    use std::sync::Arc;
    use uuid::Uuid;

    let manager = Arc::new(SessionInputManager::new());
    let (token, _) = manager.acquire_lease("viewer", "human").await.unwrap();
    let conn_id = Uuid::new_v4();
    manager.enqueue_socket_input("viewer", conn_id, InputMessage {
        browser_session_id: "s".into(), browser_incarnation: "i".into(),
        profile_epoch: 1, subscription_epoch: "sub".into(), lease_token: token.clone(),
        input_seq: 1, viewport_epoch: 1,
        event: InputEvent::InsertText { text: "x".into() },
    }).await.unwrap();
    let (started, ready) = tokio::sync::oneshot::channel();
    let task = {
        let manager = manager.clone();
        tokio::spawn(async move {
            let _cleanup = super::ControlSessionCleanup {
                manager: Some(manager),
                session_id: "s".into(),
                viewer_id: "viewer".into(),
                conn_id,
                armed: true,
                fence_holder: true,
            };
            started.send(()).unwrap();
            std::future::pending::<()>().await;
        })
    };
    ready.await.unwrap();
    task.abort();
    let _ = task.await;
    tokio::time::timeout(Duration::from_secs(2), async {
        while manager.validate_lease(&token).await.is_ok()
            || manager.has_queued_from(Some(conn_id)).await
        {
            tokio::task::yield_now().await;
        }
    }).await.expect("aborted connection must fence and discard its input");
}

#[tokio::test]
async fn pre_upgrade_control_cleanup_guard_unregisters_connection_and_pair() {
    use crate::api::browser_host::global_attachment_manager;
    use crate::browser_host::attachments::{AdmittedAttachment, AttachmentPurpose};
    use crate::browser_host::input::SessionInputManager;
    use crate::browser_host::media::ViewerPermit;
    use std::sync::Arc;

    let att = global_attachment_manager();
    let session_id = uuid::Uuid::new_v4().to_string();
    let sub_epoch = uuid::Uuid::new_v4().to_string();
    let admitted = AdmittedAttachment {
        purpose: AttachmentPurpose::Control,
        principal: "pre-upgrade-user".into(),
        is_dev: true,
        auth_session_id: None,
        auth_version: None,
        credential_version: None,
        effective_deadline: None,
        browser_session_id: Some(session_id.clone()),
        browser_incarnation: "inc-1".into(),
        profile_epoch: 1,
        viewer_id: Some("viewer-upgrade".into()),
        subscription_epoch: Some(sub_epoch),
    };
    static PERMIT_COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let reg = att
        .register_pair_connection(&admitted, || Ok(ViewerPermit::try_acquire_in(&PERMIT_COUNTER, 16).unwrap()))
        .await
        .unwrap();
    assert!(att.subscribe_pair(reg.connection_id).await.is_some());

    let manager = Arc::new(SessionInputManager::new());
    let (live_token, _) = manager.acquire_lease("viewer-upgrade", "human").await.unwrap();
    let cleanup = super::ControlSessionCleanup {
        manager: Some(manager.clone()),
        session_id: session_id.clone(),
        viewer_id: "viewer-upgrade".into(),
        conn_id: reg.connection_id,
        armed: true,
        fence_holder: false,
    };
    drop(cleanup);
    tokio::time::timeout(Duration::from_secs(2), async {
        while att.subscribe_pair(reg.connection_id).await.is_some() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("pre-upgrade cleanup must unregister connection and pair");
    assert!(reg.cancel_token.is_cancelled());
    assert!(
        manager.validate_lease(&live_token).await.is_ok(),
        "pre-upgrade drop before run_control_session must not revoke an active lease"
    );
}

fn geometry() -> TargetGeometry {
    TargetGeometry {
        css_width: 800.0,
        css_height: 600.0,
        offset_top: 0.0,
        scroll_x: 0.0,
        scroll_y: 0.0,
        page_scale: 1.0,
        visual_offset_x: 0.0,
        visual_offset_y: 0.0,
        dpr: 1.0,
    }
}

#[tokio::test]
async fn keyboard_dispatch_preserves_cdp_payload_and_text_separation() {
    // Assert the actual WebSocket boundary, not just the payload-building helper.
    let cases = [
        ("Backspace", "Backspace", 0, 8),
        ("Delete", "Delete", 0, 46),
        ("Enter", "Enter", 0, 13),
        ("Enter", "Enter", 8, 13),
        ("Enter", "Enter", 2, 13),
        ("Tab", "Tab", 0, 9),
        ("Tab", "Tab", 8, 9),
        ("ArrowLeft", "ArrowLeft", 0, 37),
        ("ArrowUp", "ArrowUp", 0, 38),
        ("ArrowRight", "ArrowRight", 0, 39),
        ("ArrowDown", "ArrowDown", 0, 40),
        ("Home", "Home", 0, 36),
        ("End", "End", 0, 35),
        ("a", "KeyA", 2, 65),
        ("c", "KeyC", 2, 67),
        ("v", "KeyV", 2, 86),
        ("x", "KeyX", 2, 88),
        ("z", "KeyZ", 2, 90),
        ("y", "KeyY", 2, 89),
        ("Z", "KeyZ", 10, 90),
        ("a", "KeyQ", 2, 65), // Layout-resolved Ctrl+A, not physical Q.
        ("+", "Equal", 2, 187),
        ("a", "KeyA", 0, 65), // A raw event must never duplicate insertText.
        ("Dead", "Quote", 0, 0),
        ("Process", "KeyA", 0, 0),
        ("Unidentified", "", 0, 0),
    ];
    let mut events = Vec::new();
    let mut expected = Vec::new();
    for (key, code, modifiers, virtual_code) in cases {
        for down in [true, false] {
            events.push(if down {
                InputEvent::KeyDown { key: key.into(), code: code.into(), modifiers }
            } else {
                InputEvent::KeyUp { key: key.into(), code: code.into(), modifiers }
            });
            let mut params = json!({
                "type": if down { "rawKeyDown" } else { "keyUp" },
                "key": key,
                "code": code,
                "modifiers": modifiers,
                "windowsVirtualKeyCode": virtual_code,
            });
            if down && key == "Enter" && modifiers != 2 {
                params["type"] = json!("keyDown");
                params["text"] = json!("\r");
                params["unmodifiedText"] = json!("\r");
            }
            expected.push(("Input.dispatchKeyEvent", params));
        }
    }
    events.push(InputEvent::InsertText { text: "hé🙂你好".into() });
    expected.push(("Input.insertText", json!({ "text": "hé🙂你好" })));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
        for (method, params) in expected {
            let message = tokio::time::timeout(Duration::from_secs(5), socket.next())
                .await.expect("CDP command deadline").unwrap().unwrap();
            let command: Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
            assert_eq!(command["method"], method);
            assert_eq!(command["sessionId"], "keyboard-page");
            assert_eq!(command["params"], params);
            socket.send(tokio_tungstenite::tungstenite::Message::Text(
                json!({ "id": command["id"], "result": {} }).to_string().into(),
            )).await.unwrap();
        }
    });
    let client = CdpClient::connect(&format!("ws://{address}")).await.unwrap();
    for event in events {
        dispatch_input_event_to_cdp(&client, "keyboard-page", &geometry(), &event).await;
    }
    server.await.unwrap();
    client.close().await;
}

#[test]
fn keyboard_location_and_release_metadata() {
    assert_eq!(super::keyboard_event_params("Enter", "NumpadEnter", 0, true), json!({
        "type": "keyDown", "key": "Enter", "code": "NumpadEnter", "modifiers": 0,
        "windowsVirtualKeyCode": 13, "text": "\r", "unmodifiedText": "\r",
        "isKeypad": true, "location": 3,
    }));
    assert_eq!(super::keyboard_event_params("Control", "ControlRight", 2, false), json!({
        "type": "keyUp", "key": "Control", "code": "ControlRight", "modifiers": 2,
        "windowsVirtualKeyCode": 17, "location": 2,
    }));
    // Lease-revocation releases carry a physical code in both key and code.
    assert_eq!(super::keyboard_virtual_key_code("KeyA", "KeyA"), 65);
    assert_eq!(super::keyboard_virtual_key_code("ShiftLeft", "ShiftLeft"), 16);
}
