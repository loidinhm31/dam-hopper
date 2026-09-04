//! Integration tests for the dedicated Linux release static web host (`dam-hopper-web`).

use axum::{
    body::Body,
    http::{header, Method, Request, StatusCode},
};
use std::sync::Arc;
use tempfile::TempDir;
use tower::ServiceExt;

use dam_hopper_server::web_host::{
    cache_policy::{CACHE_BOUNDED_ONE_HOUR, CACHE_IMMUTABLE_HASHED, CACHE_NO_CACHE, CACHE_NO_STORE},
    router::{build_web_router, WebHostState},
    runtime_config::WebRuntimeConfig,
};

struct TestFixture {
    _tmp: TempDir,
    root: std::path::PathBuf,
    state: WebHostState,
}

impl TestFixture {
    fn new(with_runtime_config: bool) -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("dist");
        std::fs::create_dir_all(root.join("assets")).unwrap();

        std::fs::write(root.join("index.html"), b"<!doctype html><html><body>Root</body></html>")
            .unwrap();
        std::fs::write(
            root.join("assets/index-D8xK2l1P.js"),
            b"console.log('dam-hopper');",
        )
        .unwrap();
        std::fs::write(
            root.join("assets/style-C9x0Ab12.css"),
            b"body { color: black; }",
        )
        .unwrap();
        std::fs::write(root.join("favicon.ico"), b"ICON_DATA").unwrap();

        let runtime_config = if with_runtime_config {
            Some(Arc::new(WebRuntimeConfig {
                schema_version: 1,
                release_version: "1.0.0".to_string(),
                profile_id: "c7325e68-07e1-4e44-8d96-b333a4658cf9".to_string(),
                api_url: Some("http://127.0.0.1:4801".to_string()),
            }))
        } else {
            None
        };

        let state = WebHostState {
            root: root.clone(),
            release_version: "1.0.0".to_string(),
            runtime_config,
        };

        Self {
            _tmp: tmp,
            root,
            state,
        }
    }
}

#[tokio::test]
async fn test_health_get_and_head() {
    let fixture = TestFixture::new(false);
    let app = build_web_router(fixture.state);

    // GET
    let req = Request::builder()
        .uri("/__dam-hopper/health")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers().get(header::CONTENT_TYPE).unwrap(),
        "application/json"
    );
    assert_eq!(
        res.headers().get(header::CACHE_CONTROL).unwrap(),
        CACHE_NO_STORE
    );

    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["status"], "ok");
    assert_eq!(json["version"], "1.0.0");
    assert_eq!(json["role"], "web");

    // HEAD
    let head_req = Request::builder()
        .method(Method::HEAD)
        .uri("/__dam-hopper/health")
        .body(Body::empty())
        .unwrap();
    let head_res = app.oneshot(head_req).await.unwrap();
    assert_eq!(head_res.status(), StatusCode::OK);
    assert_eq!(
        head_res.headers().get(header::CONTENT_TYPE).unwrap(),
        "application/json"
    );
    assert_eq!(
        head_res.headers().get(header::CONTENT_LENGTH).unwrap(),
        &bytes.len().to_string()
    );
    let head_body = axum::body::to_bytes(head_res.into_body(), usize::MAX).await.unwrap();
    assert!(head_body.is_empty(), "HEAD body must be empty");
}

#[tokio::test]
async fn test_runtime_config_present_and_absent() {
    // Present
    let fixture = TestFixture::new(true);
    let app = build_web_router(fixture.state);

    let req = Request::builder()
        .uri("/__dam-hopper/runtime-config.json")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers().get(header::CACHE_CONTROL).unwrap(),
        CACHE_NO_STORE
    );
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["releaseVersion"], "1.0.0");
    assert_eq!(json["apiUrl"], "http://127.0.0.1:4801");

    // Absent
    let absent_fixture = TestFixture::new(false);
    let absent_app = build_web_router(absent_fixture.state);
    let req = Request::builder()
        .uri("/__dam-hopper/runtime-config.json")
        .body(Body::empty())
        .unwrap();
    let res = absent_app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        res.headers().get(header::CACHE_CONTROL).unwrap(),
        CACHE_NO_STORE
    );
}

#[tokio::test]
async fn test_reserved_namespace_does_not_fall_through() {
    let fixture = TestFixture::new(true);
    let app = build_web_router(fixture.state);

    for path in [
        "/__dam-hopper/nonexistent",
        "/__dam-hopper/sub/path",
        "/__dam-hopper/health.html",
    ] {
        let req = Request::builder()
            .uri(path)
            .header(header::ACCEPT, "text/html")
            .body(Body::empty())
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "failed for {path}");
        let body = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
        assert!(body.is_empty(), "reserved 404 should have empty body");
    }
}

#[tokio::test]
async fn test_static_files_and_cache_headers() {
    let fixture = TestFixture::new(false);
    let app = build_web_router(fixture.state);

    // Root index.html -> no-cache
    let req = Request::builder().uri("/").body(Body::empty()).unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers().get(header::CACHE_CONTROL).unwrap(),
        CACHE_NO_CACHE
    );

    // Hashed JS asset -> immutable
    let req = Request::builder()
        .uri("/assets/index-D8xK2l1P.js")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers().get(header::CACHE_CONTROL).unwrap(),
        CACHE_IMMUTABLE_HASHED
    );
    assert!(res
        .headers()
        .get(header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("javascript"));

    // Other unhashed asset -> 1 hour
    let req = Request::builder()
        .uri("/favicon.ico")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers().get(header::CACHE_CONTROL).unwrap(),
        CACHE_BOUNDED_ONE_HOUR
    );
}

#[tokio::test]
async fn test_spa_fallback_and_missing_assets() {
    let fixture = TestFixture::new(false);
    let app = build_web_router(fixture.state);

    // Browser navigation without extension falls back to index.html
    let req = Request::builder()
        .uri("/dashboard/projects")
        .header(header::ACCEPT, "text/html,application/xhtml+xml")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers().get(header::CACHE_CONTROL).unwrap(),
        CACHE_NO_CACHE
    );
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX).await.unwrap();
    assert!(bytes.starts_with(b"<!doctype html>"));

    // Missing asset with extension returns 404, NOT index.html
    let req = Request::builder()
        .uri("/assets/missing-chunk-ABCD1234.js")
        .header(header::ACCEPT, "*/*")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // Missing asset with image accept returns 404
    let req = Request::builder()
        .uri("/missing-avatar.png")
        .header(header::ACCEPT, "image/*")
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // API route path on web host returns 404
    let req = Request::builder()
        .uri("/api/status")
        .header(header::ACCEPT, "text/html")
        .body(Body::empty())
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_method_rejection() {
    let fixture = TestFixture::new(true);
    let app = build_web_router(fixture.state);

    for method in [Method::POST, Method::PUT, Method::DELETE, Method::PATCH] {
        for path in ["/", "/__dam-hopper/health", "/dashboard"] {
            let req = Request::builder()
                .method(method.clone())
                .uri(path)
                .body(Body::empty())
                .unwrap();
            let res = app.clone().oneshot(req).await.unwrap();
            assert_eq!(
                res.status(),
                StatusCode::METHOD_NOT_ALLOWED,
                "failed for {method} {path}"
            );
            let allow = res
                .headers()
                .get(header::ALLOW)
                .unwrap()
                .to_str()
                .unwrap();
            assert!(
                allow.contains("GET") && allow.contains("HEAD"),
                "Allow header missing or incorrect for {method} {path}: {allow}"
            );
        }
    }
}

#[tokio::test]
async fn test_path_traversal_and_symlinks() {
    let fixture = TestFixture::new(false);

    // Symlink inside dist pointing outside
    #[cfg(unix)]
    {
        let secret = fixture._tmp.path().join("secret.txt");
        std::fs::write(&secret, b"SECRET_PASSWORD").unwrap();
        let symlink_path = fixture.root.join("leak.txt");
        std::os::unix::fs::symlink(&secret, &symlink_path).unwrap();

        let app = build_web_router(fixture.state.clone());
        let req = Request::builder()
            .uri("/leak.txt")
            .body(Body::empty())
            .unwrap();
        let res = app.oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }

    // Traversal and encoded sequence attempts
    let app = build_web_router(fixture.state);
    for path in ["/../etc/passwd", "/%2e%2e/etc/passwd", "/%2e%2e/dashboard", "/foo%2fbar", "/foo%5cbar"] {
        let req = Request::builder()
            .uri(path)
            .header(header::ACCEPT, "text/html")
            .body(Body::empty())
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "path {path} should be 404");
    }

    // Directory requests without index.html must return 404 and NOT fall back to SPA
    for dir in ["/assets", "/assets/"] {
        let req = Request::builder()
            .uri(dir)
            .header(header::ACCEPT, "text/html")
            .body(Body::empty())
            .unwrap();
        let res = app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "directory {dir} should be 404");
    }
}
#[tokio::test]
async fn test_run_web_host_lifecycle() {
    let fixture = TestFixture::new(true);
    // Find an open port
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);

    let opts = dam_hopper_server::web_host::WebHostOptions {
        root: fixture.root.clone(),
        host: std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST),
        port,
        runtime_config: None,
        release_version: Some("1.2.3".to_string()),
    };

    let handle = tokio::spawn(async move {
        dam_hopper_server::web_host::run_web_host(opts).await
    });

    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let client = reqwest::Client::new();
    let res = client
        .get(format!("http://127.0.0.1:{port}/__dam-hopper/health"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let text = res.text().await.unwrap();
    let body: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(body["version"], "1.2.3");
    assert_eq!(body["role"], "web");

    handle.abort();
}
