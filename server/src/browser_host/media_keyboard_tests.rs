use super::{dispatch_input_event_to_cdp, CdpClient, InputEvent, TargetGeometry};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;

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
