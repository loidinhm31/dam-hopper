use std::fs;
use std::path::PathBuf;

use dam_hopper_server::plugins::{
    encode_frame, validate_json_rpc_message, validate_manifest, FrameDecoder,
    MAX_FRAME_PAYLOAD_BYTES,
};

fn fixture_path(relative: &str) -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .expect("workspace root")
        .join("packages/plugin-sdk/fixtures")
        .join(relative)
}

fn read_fixture(relative: &str) -> String {
    let path = fixture_path(relative);
    fs::read_to_string(&path)
        .unwrap_or_else(|err| panic!("Failed to read fixture at {:?}: {}", path, err))
}

#[test]
fn test_valid_manifest_fixture() {
    let raw = read_fixture("positive/manifest-valid.json");
    let manifest = validate_manifest(&raw).expect("Valid manifest should parse");
    assert_eq!(manifest.id, "evcrate.advisor");
    assert_eq!(manifest.version, "0.1.0");
    assert_eq!(manifest.manifest_version, 1);
    assert_eq!(manifest.contracts.manifest, 1);
    assert_eq!(manifest.entrypoints.backend.runtime, "node");
    assert_eq!(
        manifest.entrypoints.ui.as_ref().map(|u| u.mode.as_str()),
        Some("opaque-srcdoc")
    );
    assert!(manifest.capabilities.contains(&"history.refresh".to_string()));
}

#[test]
fn test_manifest_unknown_field_rejected() {
    let raw = read_fixture("negative/manifest-unknown-field.json");
    let err = validate_manifest(&raw).expect_err("Manifest with unknown fields must fail");
    assert!(
        err.message.contains("unknown field") || err.message.contains("validation failed"),
        "Unexpected error: {}",
        err.message
    );
}

#[test]
fn test_manifest_invalid_id_rejected() {
    let raw = read_fixture("negative/manifest-invalid-id.json");
    let err = validate_manifest(&raw).expect_err("Manifest with invalid id must fail");
    assert!(err.message.contains("Invalid plugin id"));
}

#[test]
fn test_manifest_bad_version_rejected() {
    let raw = read_fixture("negative/manifest-bad-version.json");
    let err = validate_manifest(&raw).expect_err("Manifest with bad version must fail");
    assert!(err.message.contains("Invalid plugin semver"));
}

#[test]
fn test_valid_jsonrpc_request_fixture() {
    let raw = read_fixture("positive/jsonrpc-request-valid.json");
    let val = validate_json_rpc_message(&raw).expect("Valid JSON-RPC request must parse");
    assert_eq!(val["jsonrpc"], "2.0");
    assert_eq!(val["method"], "context.open");
    assert_eq!(val["id"], "req-001");
}

#[test]
fn test_valid_jsonrpc_response_fixture() {
    let raw = read_fixture("positive/jsonrpc-response-valid.json");
    let val = validate_json_rpc_message(&raw).expect("Valid JSON-RPC response must parse");
    assert_eq!(val["jsonrpc"], "2.0");
    assert_eq!(val["id"], "req-001");
    assert_eq!(val["result"]["contextId"], "ctx-987");
}

#[test]
fn test_jsonrpc_both_result_and_error_rejected() {
    let raw = r#"{"jsonrpc":"2.0","id":"bad-1","result":{},"error":{"code":"ERR","message":"fail"}}"#;
    let err = validate_json_rpc_message(raw).expect_err("Both result and error must be rejected");
    assert!(err.message.contains("cannot include both result and error"));
}

#[test]
fn test_jsonrpc_batch_rejected() {
    let raw = read_fixture("negative/jsonrpc-batch-rejected.json");
    let err = validate_json_rpc_message(&raw).expect_err("Batch must be rejected");
    assert!(err.message.contains("batch payloads are rejected"));
}

#[test]
fn test_jsonrpc_numeric_id_rejected() {
    let raw = read_fixture("negative/jsonrpc-numeric-id.json");
    let err = validate_json_rpc_message(&raw).expect_err("Numeric ID must be rejected");
    assert!(err.message.contains("must be a string"));
}

#[test]
fn test_framing_single_frame() {
    let payload = r#"{"jsonrpc":"2.0","id":"1","method":"runner.hello"}"#;
    let encoded = encode_frame(payload.as_bytes()).expect("Encoding must succeed");
    let mut decoder = FrameDecoder::new();
    let frames = decoder.push(&encoded).expect("Decoding must succeed");
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0], payload);
}

#[test]
fn test_framing_fragmentation() {
    let payload = r#"{"jsonrpc":"2.0","id":"frag-1","method":"plugin.list"}"#;
    let encoded = encode_frame(payload.as_bytes()).expect("Encoding must succeed");
    let mut decoder = FrameDecoder::new();

    let chunk1 = &encoded[..3];
    let chunk2 = &encoded[3..10];
    let chunk3 = &encoded[10..];

    assert_eq!(decoder.push(chunk1).unwrap().len(), 0);
    assert_eq!(decoder.push(chunk2).unwrap().len(), 0);
    let frames = decoder.push(chunk3).unwrap();
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0], payload);
}

#[test]
fn test_framing_coalesced_frames() {
    let msg1 = r#"{"jsonrpc":"2.0","id":"1","method":"m1"}"#;
    let msg2 = r#"{"jsonrpc":"2.0","id":"2","method":"m2"}"#;
    let enc1 = encode_frame(msg1.as_bytes()).unwrap();
    let enc2 = encode_frame(msg2.as_bytes()).unwrap();

    let mut merged = Vec::new();
    merged.extend_from_slice(&enc1);
    merged.extend_from_slice(&enc2);

    let mut decoder = FrameDecoder::new();
    let frames = decoder.push(&merged).unwrap();
    assert_eq!(frames.len(), 2);
    assert_eq!(frames[0], msg1);
    assert_eq!(frames[1], msg2);
}

#[test]
fn test_framing_oversized_header_rejected_before_body() {
    let mut header_only = [0u8; 4];
    let oversized = (MAX_FRAME_PAYLOAD_BYTES + 1) as u32;
    header_only.copy_from_slice(&oversized.to_be_bytes());

    let mut decoder = FrameDecoder::new();
    let err = decoder
        .push(&header_only)
        .expect_err("Oversized frame header must be rejected immediately");
    assert!(err.message.contains("Oversized frame header"));
}

#[test]
fn test_framing_invalid_utf8_rejected() {
    let bad_bytes = [0xff, 0xff, 0xff];
    let mut frame = Vec::new();
    let len = bad_bytes.len() as u32;
    frame.extend_from_slice(&len.to_be_bytes());
    frame.extend_from_slice(&bad_bytes);

    let mut decoder = FrameDecoder::new();
    let err = decoder
        .push(&frame)
        .expect_err("Invalid UTF-8 frame must be rejected");
    assert!(err.message.contains("invalid UTF-8"));
}
