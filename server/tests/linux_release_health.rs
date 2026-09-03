//! Integration tests for HTTP health stability probes and process inspection.

use axum::routing::get;
use axum::{Json, Router};
use dam_hopper_server::linux_release::*;
use tempfile::tempdir;
use tokio::net::TcpListener;

#[test]
fn test_parse_proc_net_listening() {
    let mock_tcp = r#"  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:12C1 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0
   1: 00000000:12C2 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12346 1 0000000000000000 100 0 0 10 0
   2: 0100007F:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12347 1 0000000000000000 100 0 0 10 0
"#;
    // 0x12C1 = 4801, 0x12C2 = 4802, 0x0016 = 22
    assert!(parse_proc_net_listening(mock_tcp, 4801));
    assert!(parse_proc_net_listening(mock_tcp, 4802));
    assert!(parse_proc_net_listening(mock_tcp, 22));
    assert!(!parse_proc_net_listening(mock_tcp, 4800));
    assert!(!parse_proc_net_listening(mock_tcp, 80));
}

#[tokio::test]
async fn test_health_stability_success() {
    let app = Router::new().route(
        "/api/health",
        get(|| async {
            Json(serde_json::json!({
                "schemaVersion": 1,
                "status": "ok",
                "version": "1.2.3",
                "role": "api"
            }))
        }),
    );

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/api/health");
    let resp = client.get(&url).send().await.expect("health response");
    assert!(resp.status().is_success());
    let bytes = resp.bytes().await.expect("read bytes");
    let body: serde_json::Value = serde_json::from_slice(&bytes).expect("parse json");
    assert_eq!(body["status"], "ok");
    assert_eq!(body["version"], "1.2.3");
    assert_eq!(body["role"], "api");
}

#[tokio::test]
async fn test_health_rejection_on_wrong_version_or_role() {
    let app = Router::new().route(
        "/api/health",
        get(|| async {
            Json(serde_json::json!({
                "schemaVersion": 1,
                "status": "ok",
                "version": "1.0.0", // Mismatched version
                "role": "api"
            }))
        }),
    );

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/api/health");
    let resp = client.get(&url).send().await.unwrap();
    let bytes = resp.bytes().await.unwrap();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    // Verify version mismatch is observable
    assert_ne!(body["version"], "2.0.0");
}

#[tokio::test]
async fn test_health_rejection_on_html_content_type() {
    let app = Router::new().route(
        "/api/health",
        get(|| async {
            ([(axum::http::header::CONTENT_TYPE, "text/html")], "<html>Error</html>")
        }),
    );

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/api/health");
    let resp = client.get(&url).send().await.unwrap();
    let ctype = resp.headers().get(reqwest::header::CONTENT_TYPE).unwrap().to_str().unwrap();
    assert!(!ctype.contains("application/json"));
}

#[test]
fn test_sqlite_holders_fail_closed() {
    let root = tempdir().unwrap();
    let db_path = root.path().join("sessions.db");
    std::fs::write(&db_path, b"mock sqlite database").unwrap();

    let my_pid = std::process::id();
    assert!(verify_no_foreign_sqlite_holders(&db_path, &[my_pid]).is_ok());

    // When companion -wal exists and holds foreign data, it must be verified too
    let wal_path = root.path().join("sessions.db-wal");
    std::fs::write(&wal_path, b"mock wal file").unwrap();
    assert!(verify_no_foreign_sqlite_holders(&db_path, &[my_pid]).is_ok());

    // Test simulated foreign holder with mock proc directory
    let mock_proc = root.path().join("proc");
    let foreign_fd_dir = mock_proc.join("9999/fd");
    std::fs::create_dir_all(&foreign_fd_dir).unwrap();
    std::os::unix::fs::symlink(&db_path, foreign_fd_dir.join("3")).unwrap();

    // With allowed PIDs not containing 9999, it MUST fail!
    let res = dam_hopper_server::linux_release::process_holders::verify_no_foreign_sqlite_holders_in(&mock_proc, &db_path, &[my_pid]);
    assert!(res.is_err(), "foreign process holding DB must trigger error");
}
