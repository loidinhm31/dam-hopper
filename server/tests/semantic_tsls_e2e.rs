#![cfg(target_os = "linux")]

mod common;

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use common::semantic_fixtures::{PackagedToolchain, TestToolchain};
use dam_hopper_server::semantic::protocol::{
    ConnectionId, NavigationParams, Position, Range, TextDocumentContentChangeEvent,
    TextDocumentIdentifier,
};
use dam_hopper_server::semantic::reaper::{
    get_all_descendants, is_pgid_empty, merge_descendants, sample_tree_resources, verify_pids_dead,
};
use dam_hopper_server::semantic::resources::ADAPTIVE_SYNC_THRESHOLD_BYTES;
use dam_hopper_server::semantic::session::path_to_file_uri;
use dam_hopper_server::semantic::supervisor::SemanticSupervisor;
use dam_hopper_server::semantic::tool_profile::{SemanticToolProfile, ToolIntegrityStatus};
use serde_json::{json, Value};

struct ProbeProcess(std::process::Child);

impl ProbeProcess {
    fn cleanup(&mut self) {
        let pgid = self.0.id();
        let mut descendants = get_all_descendants(pgid);
        unsafe {
            libc::kill(-(pgid as i32), libc::SIGKILL);
        }
        for dpid in &descendants {
            unsafe {
                libc::kill(*dpid as i32, libc::SIGKILL);
            }
        }
        let deadline = std::time::Instant::now() + Duration::from_millis(500);
        let mut child_reaped = false;
        while std::time::Instant::now() < deadline {
            if !child_reaped {
                match self.0.try_wait() {
                    Ok(Some(_)) => child_reaped = true,
                    Ok(None) => {}
                    Err(_) => child_reaped = true,
                }
            }
            merge_descendants(pgid, &mut descendants);
            if child_reaped
                && is_pgid_empty(pgid)
                && (descendants.is_empty() || verify_pids_dead(&descendants))
            {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        if !child_reaped {
            let _ = self.0.wait();
        }
    }
}

impl Drop for ProbeProcess {
    fn drop(&mut self) {
        self.cleanup();
    }
}

fn set_fd_nonblocking(fd: std::os::fd::RawFd) -> std::io::Result<()> {
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 {
        return Err(std::io::Error::last_os_error());
    }
    if unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

struct DeadlineReader {
    stdout: std::process::ChildStdout,
    deadline: std::time::Instant,
}

impl DeadlineReader {
    fn new(
        stdout: std::process::ChildStdout,
        deadline: std::time::Instant,
    ) -> std::io::Result<Self> {
        use std::os::fd::AsRawFd;
        set_fd_nonblocking(stdout.as_raw_fd())?;
        Ok(Self { stdout, deadline })
    }
}

impl Read for DeadlineReader {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        use std::os::fd::AsRawFd;
        loop {
            let remaining = self
                .deadline
                .saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return Err(std::io::ErrorKind::TimedOut.into());
            }
            let mut fd = libc::pollfd {
                fd: self.stdout.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            let ready = unsafe {
                libc::poll(
                    &mut fd,
                    1,
                    remaining.as_millis().min(i32::MAX as u128) as i32,
                )
            };
            if ready > 0 {
                match self.stdout.read(buffer) {
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => continue,
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    other => return other,
                }
            }
            if ready == 0 {
                return Err(std::io::ErrorKind::TimedOut.into());
            }
            let error = std::io::Error::last_os_error();
            if error.kind() != std::io::ErrorKind::Interrupted {
                return Err(error);
            }
        }
    }
}

struct DeadlineWriter {
    stdin: std::process::ChildStdin,
    deadline: std::time::Instant,
}

impl DeadlineWriter {
    fn new(stdin: std::process::ChildStdin, deadline: std::time::Instant) -> std::io::Result<Self> {
        use std::os::fd::AsRawFd;
        set_fd_nonblocking(stdin.as_raw_fd())?;
        Ok(Self { stdin, deadline })
    }
}

impl Write for DeadlineWriter {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        use std::os::fd::AsRawFd;
        loop {
            let remaining = self
                .deadline
                .saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return Err(std::io::ErrorKind::TimedOut.into());
            }
            let mut fd = libc::pollfd {
                fd: self.stdin.as_raw_fd(),
                events: libc::POLLOUT,
                revents: 0,
            };
            let ready = unsafe {
                libc::poll(
                    &mut fd,
                    1,
                    remaining.as_millis().min(i32::MAX as u128) as i32,
                )
            };
            if ready > 0 {
                if (fd.revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL)) != 0
                    && (fd.revents & libc::POLLOUT) == 0
                {
                    return Err(std::io::ErrorKind::BrokenPipe.into());
                }
                match self.stdin.write(buffer) {
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => continue,
                    Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    other => return other,
                }
            }
            if ready == 0 {
                return Err(std::io::ErrorKind::TimedOut.into());
            }
            let error = std::io::Error::last_os_error();
            if error.kind() != std::io::ErrorKind::Interrupted {
                return Err(error);
            }
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.stdin.flush()
    }
}

static ENV_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

struct ScopedEnvVars {
    _lock: std::sync::MutexGuard<'static, ()>,
    previous: Vec<(std::ffi::OsString, Option<std::ffi::OsString>)>,
}

impl ScopedEnvVars {
    fn set(vars: &[(&str, &str)]) -> Self {
        let lock = ENV_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        let mut previous = Vec::with_capacity(vars.len());
        for &(key, val) in vars {
            let key_os = std::ffi::OsString::from(key);
            let prev = std::env::var_os(&key_os);
            previous.push((key_os, prev));
            std::env::set_var(key, val);
        }
        Self {
            _lock: lock,
            previous,
        }
    }
}

impl Drop for ScopedEnvVars {
    fn drop(&mut self) {
        for (key, prev) in self.previous.drain(..).rev() {
            match prev {
                Some(val) => std::env::set_var(&key, val),
                None => std::env::remove_var(&key),
            }
        }
    }
}

fn send_lsp_msg(stdin: &mut impl Write, msg: &Value) -> std::io::Result<()> {
    let body = serde_json::to_string(msg).expect("serialize json");
    let frame = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
    stdin.write_all(frame.as_bytes())?;
    stdin.flush()
}

fn read_lsp_msg(reader: &mut BufReader<impl Read>) -> Option<Value> {
    let mut content_len: Option<usize> = None;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).ok()?;
        if n == 0 {
            return None;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some(rest) = trimmed.strip_prefix("Content-Length:") {
            content_len = rest.trim().parse::<usize>().ok();
        }
    }
    let len = content_len?;
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).ok()?;
    serde_json::from_slice(&buf).ok()
}

fn extract_result_array(envelope: &Value) -> &Vec<Value> {
    envelope
        .get("result")
        .unwrap_or(envelope)
        .as_array()
        .unwrap_or_else(|| panic!("expected JSON-RPC result array in envelope: {envelope}"))
}

fn extract_first_line(envelope: &Value) -> u32 {
    let arr = extract_result_array(envelope);
    assert!(
        !arr.is_empty(),
        "expected non-empty navigation result: {envelope}"
    );
    let first = &arr[0];
    first
        .get("targetSelectionRange")
        .or_else(|| first.get("range"))
        .and_then(|r| r.get("start"))
        .and_then(|s| s.get("line"))
        .and_then(|l| l.as_u64())
        .expect("start.line") as u32
}

fn extract_first_char(envelope: &Value) -> u32 {
    let arr = extract_result_array(envelope);
    assert!(
        !arr.is_empty(),
        "expected non-empty navigation result: {envelope}"
    );
    let first = &arr[0];
    first
        .get("targetSelectionRange")
        .or_else(|| first.get("range"))
        .and_then(|r| r.get("start"))
        .and_then(|s| s.get("character"))
        .and_then(|c| c.as_u64())
        .expect("start.character") as u32
}

#[test]
fn test_packaged_tuple_transitive_integrity_and_tamper_rejection() {
    let packaged = PackagedToolchain::new();
    let profile = packaged.tool_profile();
    assert_eq!(profile.verify_integrity(), ToolIntegrityStatus::Valid);
    assert_eq!(
        profile.verify_packaged_tuple_integrity(),
        ToolIntegrityStatus::Valid
    );
    assert!(profile.is_packaged_tuple_verified());

    // Synthetic TestToolchain must NEVER qualify as packaged tuple proof
    let synthetic = TestToolchain::new();
    assert!(!synthetic.tool_profile().is_packaged_tuple_verified());
    assert_ne!(
        synthetic.tool_profile().verify_packaged_tuple_integrity(),
        ToolIntegrityStatus::Valid
    );

    // Tampering with transitive _tsserver.js, typescript.js, lockfile, or LICENSES.txt must fail closed
    for rel_tamper in [
        "lib/semantic-engine/tsls/node_modules/typescript/lib/_tsserver.js",
        "lib/semantic-engine/tsls/node_modules/typescript/lib/typescript.js",
        "lib/semantic-engine/tsls/node_modules/typescript/lib/typingsInstaller.js",
        "lib/semantic-engine/tsls/node_modules/typescript/lib/watchGuard.js",
        "lib/semantic-engine/tsls/pnpm-lock.yaml",
        "lib/semantic-engine/tsls/LICENSES.txt",
    ] {
        let target_file = packaged.root.join(rel_tamper);
        let original = fs::read(&target_file).expect("read original");
        let mut corrupted = original.clone();
        corrupted.extend_from_slice(b"\n// tampered");
        fs::write(&target_file, &corrupted).expect("write tampered");
        let checked = SemanticToolProfile::from_release_root(&packaged.root);
        assert!(
            matches!(
                checked.verify_integrity(),
                ToolIntegrityStatus::DigestMismatch { .. }
            ),
            "Tampered transitive file {rel_tamper} must be rejected by verify_integrity"
        );
        assert!(checked
            .create_launch_spec(&packaged.root, &packaged.root)
            .is_err());

        fs::write(&target_file, &original).expect("restore original");
    }

    // Injecting a symlink inside the transitive engine directory must fail closed
    let symlink_path = packaged
        .root
        .join("lib/semantic-engine/tsls/node_modules/typescript/lib/injected-link.js");
    std::os::unix::fs::symlink(profile.tsserver_path(), &symlink_path).expect("create symlink");
    let checked = SemanticToolProfile::from_release_root(&packaged.root);
    assert!(matches!(
        checked.verify_integrity(),
        ToolIntegrityStatus::InvalidFileType { .. }
    ));
    fs::remove_file(&symlink_path).expect("remove symlink");
    assert_eq!(checked.verify_integrity(), ToolIntegrityStatus::Valid);
}

#[tokio::test]
async fn test_packaged_tsls_four_extensions_nested_refs_multiple_and_empty_results() {
    let packaged = PackagedToolchain::new();
    let supervisor = SemanticSupervisor::new(Some(packaged.tool_profile()));
    supervisor.set_enabled(true).await;

    let ws_tmp = tempfile::tempdir().expect("ws tempdir");
    let ws = ws_tmp.path();
    fs::create_dir_all(ws.join("packages/core")).unwrap();
    fs::create_dir_all(ws.join("packages/app")).unwrap();

    fs::write(
        ws.join("tsconfig.json"),
        r#"{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler","allowJs":true,"jsx":"preserve","strict":true,"composite":true},"references":[{"path":"./packages/core"},{"path":"./packages/app"}]}"#,
    ).unwrap();
    fs::write(
        ws.join("packages/core/tsconfig.json"),
        r#"{"extends":"../../tsconfig.json","compilerOptions":{"composite":true},"include":["./**/*"]}"#,
    ).unwrap();
    fs::write(
        ws.join("packages/app/tsconfig.json"),
        r#"{"extends":"../../tsconfig.json","compilerOptions":{"composite":true},"references":[{"path":"../core"}],"include":["./**/*"]}"#,
    ).unwrap();

    let core_ts = ws.join("packages/core/contracts.ts");
    let core_js = ws.join("packages/core/helper.js");
    let app_tsx = ws.join("packages/app/widget.tsx");
    let app_jsx = ws.join("packages/app/legacy.jsx");

    let core_ts_text = "export interface DataPort {\n  fetchValue(key: string): number;\n}\nexport class MemoryPort implements DataPort {\n  fetchValue(key: string): number { return key.length; }\n}\nexport class DiskPort implements DataPort {\n  fetchValue(key: string): number { return key.length + 1; }\n}\n";
    let core_js_text = "export function jsFormatLabel(prefix) {\n  return String(prefix) + '_ok';\n}\nexport const jsFormatRef = jsFormatLabel('seed');\n";
    let app_tsx_text = "import { DataPort, MemoryPort } from '../core/contracts';\nexport function renderWidget(port: DataPort): number {\n  const local: DataPort = new MemoryPort();\n  return port.fetchValue('a') + local.fetchValue('b');\n}\n// comment line for empty definition\n";
    let app_jsx_text = "import { jsFormatLabel } from '../core/helper.js';\nexport function renderLegacy() {\n  return jsFormatLabel('jsx');\n}\n";

    fs::write(&core_ts, core_ts_text).unwrap();
    fs::write(&core_js, core_js_text).unwrap();
    fs::write(&app_tsx, app_tsx_text).unwrap();
    fs::write(&app_jsx, app_jsx_text).unwrap();

    let conn = ConnectionId("conn-e2e-ext".into());
    let epoch = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(conn, "proj-ext", None, ws.to_path_buf(), epoch)
        .await
        .expect("create session");
    session.initialize().await.expect("initialize session");
    let core_ts_uri = path_to_file_uri(&core_ts);
    let core_js_uri = path_to_file_uri(&core_js);
    let app_tsx_uri = path_to_file_uri(&app_tsx);
    let app_jsx_uri = path_to_file_uri(&app_jsx);

    // Open .tsx, .js, .jsx; keep core_ts unopened first to verify unopened cross-package resolution
    session
        .did_open(
            app_tsx_uri.clone(),
            "typescriptreact".into(),
            1,
            app_tsx_text.into(),
        )
        .await
        .unwrap();
    session
        .did_open(
            core_js_uri.clone(),
            "javascript".into(),
            1,
            core_js_text.into(),
        )
        .await
        .unwrap();
    session
        .did_open(
            app_jsx_uri.clone(),
            "javascriptreact".into(),
            1,
            app_jsx_text.into(),
        )
        .await
        .unwrap();

    // 1. Cross-package .tsx -> unopened .ts definition
    let def_tsx = session
        .navigation(
            "textDocument/definition",
            NavigationParams {
                text_document: TextDocumentIdentifier {
                    uri: app_tsx_uri.clone(),
                },
                position: Position {
                    line: 2,
                    character: 31,
                }, // MemoryPort
                dam_hopper_document_version: 1,
                dam_hopper_model_generation: None,
            },
        )
        .await
        .expect("tsx definition");
    let def_tsx_str = serde_json::to_string(&def_tsx).unwrap();
    assert!(
        def_tsx_str.contains("contracts.ts"),
        "Must resolve unopened contracts.ts: {def_tsx_str}"
    );
    assert_eq!(extract_first_line(&def_tsx), 3);

    // 2. Open .ts and verify multiple implementations on DataPort interface (MemoryPort + DiskPort)
    session
        .did_open(
            core_ts_uri.clone(),
            "typescript".into(),
            1,
            core_ts_text.into(),
        )
        .await
        .unwrap();
    let impl_ts = session
        .navigation(
            "textDocument/implementation",
            NavigationParams {
                text_document: TextDocumentIdentifier {
                    uri: core_ts_uri.clone(),
                },
                position: Position {
                    line: 0,
                    character: 19,
                }, // DataPort
                dam_hopper_document_version: 1,
                dam_hopper_model_generation: None,
            },
        )
        .await
        .expect("ts implementation");
    let impl_arr = extract_result_array(&impl_ts);
    assert!(
        impl_arr.len() >= 2,
        "Expected >=2 implementations for DataPort, got: {impl_ts}"
    );

    // 3. .js definition
    let def_js = session
        .navigation(
            "textDocument/definition",
            NavigationParams {
                text_document: TextDocumentIdentifier { uri: core_js_uri },
                position: Position {
                    line: 3,
                    character: 29,
                }, // jsFormatLabel
                dam_hopper_document_version: 1,
                dam_hopper_model_generation: None,
            },
        )
        .await
        .expect("js definition");
    assert_eq!(extract_first_line(&def_js), 0);

    // 4. .jsx cross-package definition to .js
    let def_jsx = session
        .navigation(
            "textDocument/definition",
            NavigationParams {
                text_document: TextDocumentIdentifier { uri: app_jsx_uri },
                position: Position {
                    line: 2,
                    character: 12,
                }, // jsFormatLabel
                dam_hopper_document_version: 1,
                dam_hopper_model_generation: None,
            },
        )
        .await
        .expect("jsx definition");
    assert!(serde_json::to_string(&def_jsx)
        .unwrap()
        .contains("helper.js"));

    // 5. Empty result on comment line
    let empty_def = session
        .navigation(
            "textDocument/definition",
            NavigationParams {
                text_document: TextDocumentIdentifier { uri: app_tsx_uri },
                position: Position {
                    line: 5,
                    character: 5,
                },
                dam_hopper_document_version: 1,
                dam_hopper_model_generation: None,
            },
        )
        .await
        .expect("empty definition");
    assert!(extract_result_array(&empty_def).is_empty());

    // Verify active process tree has tsserver descendant, then reap cleanly
    let pgid = session.get_pgid().await.expect("active pgid");
    let sample = sample_tree_resources(pgid);
    assert!(
        sample.process_count >= 2,
        "Expected TSLS + tsserver processes in tree"
    );

    supervisor.shutdown().await;
    assert!(
        verify_pids_dead(&sample.pids),
        "All semantic PIDs must be dead after shutdown"
    );
    assert!(
        is_pgid_empty(pgid),
        "Process group must be empty after shutdown"
    );
}

#[tokio::test]
async fn test_packaged_tsls_unsaved_overlays_unicode_and_bidirectional_threshold_crossing() {
    let packaged = PackagedToolchain::new();
    let supervisor = SemanticSupervisor::new(Some(packaged.tool_profile()));
    supervisor.set_enabled(true).await;

    let ws_tmp = tempfile::tempdir().expect("ws tempdir");
    let ws = ws_tmp.path();
    let shared_ts = ws.join("shared.ts");
    fs::write(&shared_ts, "export const diskOnly = 1;\n").unwrap();
    let shared_uri = path_to_file_uri(&shared_ts);

    let conn_a = ConnectionId("conn-overlay-a".into());
    let conn_b = ConnectionId("conn-overlay-b".into());
    let ep_a = supervisor.register_connection(&conn_a).await;
    let ep_b = supervisor.register_connection(&conn_b).await;

    let sess_a = supervisor
        .get_or_create_session(conn_a, "proj-ov", None, ws.to_path_buf(), ep_a)
        .await
        .unwrap();
    let sess_b = supervisor
        .get_or_create_session(conn_b, "proj-ov", None, ws.to_path_buf(), ep_b)
        .await
        .unwrap();
    sess_a.initialize().await.expect("initialize sess_a");
    sess_b.initialize().await.expect("initialize sess_b");
    // Independent unsaved overlays for the same file URI across two sessions
    sess_a
        .did_open(
            shared_uri.clone(),
            "typescript".into(),
            1,
            "export const unsavedSymbol = 10;\nexport const refSym = unsavedSymbol;\n".into(),
        )
        .await
        .unwrap();
    sess_b
        .did_open(
            shared_uri.clone(),
            "typescript".into(),
            1,
            "// header1\n// header2\nexport const unsavedSymbol = 20;\nexport const refSym = unsavedSymbol;\n".into(),
        )
        .await
        .unwrap();

    let def_a = sess_a
        .navigation(
            "textDocument/definition",
            NavigationParams {
                text_document: TextDocumentIdentifier {
                    uri: shared_uri.clone(),
                },
                position: Position {
                    line: 1,
                    character: 24,
                },
                dam_hopper_document_version: 1,
                dam_hopper_model_generation: None,
            },
        )
        .await
        .unwrap();
    let def_b = sess_b
        .navigation(
            "textDocument/definition",
            NavigationParams {
                text_document: TextDocumentIdentifier {
                    uri: shared_uri.clone(),
                },
                position: Position {
                    line: 3,
                    character: 24,
                },
                dam_hopper_document_version: 1,
                dam_hopper_model_generation: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        extract_first_line(&def_a),
        0,
        "Session A must resolve unsaved line 0"
    );
    assert_eq!(
        extract_first_line(&def_b),
        2,
        "Session B must resolve unsaved line 2"
    );

    // Empty document open -> edit -> close -> reopen lifecycle + Unicode + threshold crossing on sess_a
    let boundary_ts = ws.join("boundary.ts");
    fs::write(&boundary_ts, "").unwrap();
    let boundary_uri = path_to_file_uri(&boundary_ts);

    sess_a
        .did_open(boundary_uri.clone(), "typescript".into(), 1, "".into())
        .await
        .unwrap();
    let unicode_line = "/* 🚀 Café Cafe\u{0301} */ export const astralTarget = 123; export const astralRef = astralTarget;\n";
    let declaration_column = unicode_line[..unicode_line.find("astralTarget").unwrap()]
        .encode_utf16()
        .count() as u32;
    sess_a
        .did_change(
            boundary_uri.clone(),
            2,
            vec![TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: unicode_line.into(),
            }],
        )
        .await
        .unwrap();
    sess_a.did_close(boundary_uri.clone()).await.unwrap();
    sess_a
        .did_open(
            boundary_uri.clone(),
            "typescript".into(),
            1,
            unicode_line.into(),
        )
        .await
        .unwrap();

    let def_unicode = sess_a
        .navigation(
            "textDocument/definition",
            NavigationParams {
                text_document: TextDocumentIdentifier {
                    uri: boundary_uri.clone(),
                },
                position: Position {
                    line: 0,
                    character: 82,
                }, // inside second astralTarget
                dam_hopper_document_version: 1,
                dam_hopper_model_generation: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(extract_first_char(&def_unicode), declaration_column);

    // Bidirectional threshold crossing: <64 KiB -> >=64 KiB -> <64 KiB
    let pad_line = format!("//{}\n", "x".repeat(61));
    let lines_for_64k = ADAPTIVE_SYNC_THRESHOLD_BYTES / pad_line.len();
    let exact_64k_prefix = pad_line.repeat(lines_for_64k);
    assert_eq!(exact_64k_prefix.len(), ADAPTIVE_SYNC_THRESHOLD_BYTES);

    sess_a
        .did_change(
            boundary_uri.clone(),
            2,
            vec![TextDocumentContentChangeEvent {
                range: Some(Range {
                    start: Position {
                        line: 0,
                        character: 0,
                    },
                    end: Position {
                        line: 0,
                        character: 0,
                    },
                }),
                range_length: None,
                text: exact_64k_prefix,
            }],
        )
        .await
        .unwrap();
    let (_, bytes_large) = sess_a.get_overlay_stats().await;
    assert!(bytes_large > ADAPTIVE_SYNC_THRESHOLD_BYTES);

    let def_large = sess_a
        .navigation(
            "textDocument/definition",
            NavigationParams {
                text_document: TextDocumentIdentifier {
                    uri: boundary_uri.clone(),
                },
                position: Position {
                    line: lines_for_64k as u32,
                    character: 82,
                },
                dam_hopper_document_version: 2,
                dam_hopper_model_generation: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(extract_first_line(&def_large), lines_for_64k as u32);
    assert_eq!(extract_first_char(&def_large), declaration_column);

    // Shrink back below 64 KiB
    sess_a
        .did_change(
            boundary_uri.clone(),
            3,
            vec![TextDocumentContentChangeEvent {
                range: None,
                range_length: None,
                text: unicode_line.into(),
            }],
        )
        .await
        .unwrap();
    let def_shrunk = sess_a
        .navigation(
            "textDocument/definition",
            NavigationParams {
                text_document: TextDocumentIdentifier { uri: boundary_uri },
                position: Position {
                    line: 0,
                    character: 82,
                },
                dam_hopper_document_version: 3,
                dam_hopper_model_generation: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(extract_first_line(&def_shrunk), 0);
    assert_eq!(extract_first_char(&def_shrunk), declaration_column);

    supervisor.shutdown().await;
}

fn canaries_populated(canaries: &[&Path]) -> bool {
    !canaries.is_empty()
        && canaries
            .iter()
            .all(|p| fs::metadata(p).map(|m| m.len() > 0).unwrap_or(false))
}

fn run_raw_tsls_probe(
    node_bin: &Path,
    cli_mjs: &Path,
    workspace: &Path,
    extra_env: &[(&str, &str)],
    init_options: Value,
    expected_canaries: &[&Path],
) -> Option<u32> {
    use std::os::fd::AsRawFd;

    let mut cmd = Command::new(node_bin);
    cmd.arg("--max-old-space-size=256")
        .arg(cli_mjs)
        .arg("--stdio")
        .current_dir(workspace)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    for &(k, v) in extra_env {
        cmd.env(k, v);
    }
    unsafe {
        cmd.pre_exec(|| {
            libc::setpgid(0, 0);
            Ok(())
        });
    }
    let mut child = ProbeProcess(cmd.spawn().ok()?);
    let pid = child.0.id();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    let mut writer = DeadlineWriter::new(child.0.stdin.take()?, deadline).ok()?;
    let mut reader = BufReader::new(DeadlineReader::new(child.0.stdout.take()?, deadline).ok()?);

    let root_uri = path_to_file_uri(workspace);
    let main_uri = path_to_file_uri(&workspace.join("src/index.ts"));
    let _ = send_lsp_msg(
        &mut writer,
        &json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "processId": std::process::id(),
                "rootUri": root_uri,
                "capabilities": {},
                "initializationOptions": init_options
            }
        }),
    );

    let mut initialized_ok = false;
    let mut stdout_eof = false;
    while std::time::Instant::now() < deadline {
        if canaries_populated(expected_canaries) {
            return Some(pid);
        }
        let Some(msg) = read_lsp_msg(&mut reader) else {
            stdout_eof = true;
            break;
        };
        if msg.get("id") == Some(&json!(1)) {
            initialized_ok = true;
            break;
        }
        if msg.get("method") == Some(&json!("workspace/configuration")) {
            if let Some(id) = msg.get("id") {
                let _ = send_lsp_msg(
                    &mut writer,
                    &json!({ "jsonrpc": "2.0", "id": id, "result": [{}] }),
                );
            }
        }
    }

    if initialized_ok {
        let _ = send_lsp_msg(
            &mut writer,
            &json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }),
        );
        let _ = send_lsp_msg(
            &mut writer,
            &json!({
                "jsonrpc": "2.0",
                "method": "textDocument/didOpen",
                "params": {
                    "textDocument": {
                        "uri": main_uri,
                        "languageId": "typescript",
                        "version": 1,
                        "text": "import 'untyped-package-triggering-ata-probe';\nexport const x = 1;\n"
                    }
                }
            }),
        );
    }

    while std::time::Instant::now() < deadline {
        if canaries_populated(expected_canaries) {
            break;
        }
        if stdout_eof {
            if let Ok(Some(_)) = child.0.try_wait() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
            continue;
        }
        let has_buffered = !reader.buffer().is_empty();
        let ready = if has_buffered {
            1
        } else {
            let poll_ms = deadline
                .saturating_duration_since(std::time::Instant::now())
                .min(Duration::from_millis(25))
                .as_millis() as i32;
            if poll_ms <= 0 {
                break;
            }
            let mut fd = libc::pollfd {
                fd: reader.get_ref().stdout.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            };
            unsafe { libc::poll(&mut fd, 1, poll_ms) }
        };
        if ready > 0 {
            match read_lsp_msg(&mut reader) {
                Some(msg) => {
                    if msg.get("method") == Some(&json!("workspace/configuration")) {
                        if let Some(id) = msg.get("id") {
                            let _ = send_lsp_msg(
                                &mut writer,
                                &json!({ "jsonrpc": "2.0", "id": id, "result": [{}] }),
                            );
                        }
                    }
                }
                None => {
                    stdout_eof = true;
                }
            }
        }
    }
    child.cleanup();
    Some(pid)
}

#[tokio::test]
async fn test_adversarial_code_loading_vectors_with_tuple_specific_positive_controls() {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::PermissionsExt;

    let packaged = PackagedToolchain::new();
    let profile = packaged.tool_profile();

    let sandbox_tmp = tempfile::tempdir().expect("hostile tempdir");
    let ws_dir = sandbox_tmp.path().join("workspace");
    let ws = ws_dir.as_path();
    let outside_dir = sandbox_tmp.path().join("outside-target-root");
    fs::create_dir_all(ws.join("src")).unwrap();
    fs::create_dir_all(ws.join("bin")).unwrap();
    fs::create_dir_all(ws.join("node_modules/malicious-ts-plugin")).unwrap();
    fs::create_dir_all(ws.join("node_modules/typescript/lib")).unwrap();
    fs::create_dir_all(&outside_dir).unwrap();

    let v1_canary = ws.join("v1-plugin-canary.txt");
    let v2_canary = ws.join("v2-sdk-canary.txt");
    let v3_canary = ws.join("v3-preload-canary.txt");
    let v3_loader_canary = ws.join("v3-loader-canary.txt");
    let v4_canary = ws.join("v4-ata-canary.txt");

    // V1 hostile plugin package in <workspace>/node_modules/malicious-ts-plugin
    fs::write(
        ws.join("node_modules/malicious-ts-plugin/package.json"),
        r#"{"name":"malicious-ts-plugin","version":"1.0.0","main":"index.js"}"#,
    )
    .unwrap();
    fs::write(
        ws.join("node_modules/malicious-ts-plugin/index.js"),
        format!(
            "const fs = require('fs'); fs.writeFileSync({:?}, 'V1_PLUGIN_FIRED'); module.exports = () => ({{ create: (info) => info.languageService }});\n",
            v1_canary.to_string_lossy()
        ),
    )
    .unwrap();

    // V2 hostile workspace TypeScript SDK decoy in <workspace>/node_modules/typescript
    fs::write(
        ws.join("node_modules/typescript/package.json"),
        r#"{"name":"typescript","version":"99.0.0","main":"./lib/typescript.js"}"#,
    )
    .unwrap();
    fs::write(
        ws.join("node_modules/typescript/lib/tsserver.js"),
        format!(
            "const fs = require('fs'); fs.writeFileSync({:?}, 'V2_SDK_DECOY_FIRED');\n",
            v2_canary.to_string_lossy()
        ),
    )
    .unwrap();

    // V3a hostile CommonJS preload hook (--require) and V3b ESM loader hook (--import / module.register)
    let preload_script = ws.join("preload-canary.cjs");
    fs::write(
        &preload_script,
        format!(
            "require('fs').writeFileSync({:?}, 'V3_PRELOAD_FIRED');\n",
            v3_canary.to_string_lossy()
        ),
    )
    .unwrap();

    let loader_script = ws.join("loader-canary.mjs");
    fs::write(
        &loader_script,
        format!(
            "import fs from 'node:fs';\nimport {{ register }} from 'node:module';\nfs.writeFileSync({:?}, 'V3_LOADER_FIRED');\ntry {{ register('data:text/javascript,export async function resolve(s, c, n) {{ return n(s, c); }}'); }} catch {{}}\n",
            v3_loader_canary.to_string_lossy()
        ),
    )
    .unwrap();

    // V4 hostile ATA / npm hook script + executable PATH/npmLocation shim
    let ata_script = ws.join("npm-hook-canary.cjs");
    fs::write(
        &ata_script,
        format!(
            "require('fs').writeFileSync({:?}, 'V4_ATA_FIRED');\n",
            v4_canary.to_string_lossy()
        ),
    )
    .unwrap();
    let npm_shim = ws.join("bin/npm");
    fs::write(
        &npm_shim,
        format!(
            "#!/bin/sh\nexec {:?} {:?} \"$@\"\n",
            profile.node_path().to_string_lossy(),
            ata_script.to_string_lossy()
        ),
    )
    .unwrap();
    fs::set_permissions(&npm_shim, fs::Permissions::from_mode(0o755)).unwrap();

    let adv_fixture_dir =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/semantic-adversarial");
    let mut tsconfig_val: Value =
        serde_json::from_str(&fs::read_to_string(adv_fixture_dir.join("tsconfig.json")).unwrap())
            .unwrap();
    tsconfig_val["typeAcquisition"] = json!({
        "enable": true,
        "include": ["untyped-package-triggering-ata-probe"]
    });
    fs::write(
        ws.join("tsconfig.json"),
        serde_json::to_string_pretty(&tsconfig_val).unwrap(),
    )
    .unwrap();
    fs::copy(
        adv_fixture_dir.join("package.json"),
        ws.join("package.json"),
    )
    .unwrap();
    let index_ts_content = fs::read_to_string(adv_fixture_dir.join("src/index.ts")).unwrap();
    fs::write(ws.join("src/index.ts"), &index_ts_content).unwrap();

    // --- POSITIVE CONTROL 1: TSLS/tsserver plugin loading when plugin probe is enabled ---
    run_raw_tsls_probe(
        profile.node_path(),
        profile.tsls_entrypoint(),
        ws,
        &[],
        json!({
            "disableAutomaticTypingAcquisition": true,
            "plugins": [{ "name": "malicious-ts-plugin", "location": ws.to_string_lossy() }],
            "tsserver": {
                "path": profile.tsserver_path().to_string_lossy(),
                "useSyntaxServer": "never"
            }
        }),
        &[&v1_canary],
    );
    assert_eq!(
        fs::read_to_string(&v1_canary).expect("plugin canary must exist"),
        "V1_PLUGIN_FIRED",
        "Tuple-specific V1 positive control must execute plugin when probed"
    );
    fs::remove_file(&v1_canary).unwrap();

    // --- POSITIVE CONTROL 2: TSLS workspace TypeScript SDK fallback when tsserver.path omitted ---
    run_raw_tsls_probe(
        profile.node_path(),
        profile.tsls_entrypoint(),
        ws,
        &[],
        json!({}),
        &[&v2_canary],
    );
    assert_eq!(
        fs::read_to_string(&v2_canary).expect("SDK canary must exist"),
        "V2_SDK_DECOY_FIRED",
        "Tuple-specific V2 positive control must execute workspace tsserver decoy when tsserver.path omitted"
    );
    fs::remove_file(&v2_canary).unwrap();

    // --- POSITIVE CONTROL 3: Node preload (--require) and ESM loader (--import) hooks when NODE_OPTIONS is inherited ---
    let poisoned_node_options = format!(
        "--require {} --import {}",
        preload_script.display(),
        path_to_file_uri(&loader_script)
    );
    let poisoned_node_path = ws.join("node_modules").to_string_lossy().into_owned();
    run_raw_tsls_probe(
        profile.node_path(),
        profile.tsls_entrypoint(),
        ws,
        &[
            ("NODE_OPTIONS", &poisoned_node_options),
            ("NODE_PATH", &poisoned_node_path),
        ],
        json!({
            "disableAutomaticTypingAcquisition": true,
            "plugins": [],
            "tsserver": {
                "path": profile.tsserver_path().to_string_lossy(),
                "useSyntaxServer": "never"
            }
        }),
        &[&v3_canary, &v3_loader_canary],
    );
    assert_eq!(
        fs::read_to_string(&v3_canary).expect("preload canary must exist"),
        "V3_PRELOAD_FIRED",
        "V3 positive control must fire CommonJS --require preload canary"
    );
    assert_eq!(
        fs::read_to_string(&v3_loader_canary).expect("loader canary must exist"),
        "V3_LOADER_FIRED",
        "V3 positive control must fire ESM --import loader canary"
    );
    fs::remove_file(&v3_canary).unwrap();
    fs::remove_file(&v3_loader_canary).unwrap();

    // --- POSITIVE CONTROL 4: Automatic Type Acquisition (typingsInstaller.js -> npm hook) when ATA is enabled ---
    let poisoned_path = format!("{}:/usr/bin:/bin", ws.join("bin").display());
    run_raw_tsls_probe(
        profile.node_path(),
        profile.tsls_entrypoint(),
        ws,
        &[("PATH", &poisoned_path)],
        json!({
            "disableAutomaticTypingAcquisition": false,
            "npmLocation": npm_shim.to_string_lossy(),
            "plugins": [],
            "tsserver": {
                "path": profile.tsserver_path().to_string_lossy(),
                "useSyntaxServer": "never"
            }
        }),
        &[&v4_canary],
    );
    assert_eq!(
        fs::read_to_string(&v4_canary).expect("ATA canary must exist"),
        "V4_ATA_FIRED",
        "Tuple-specific V4 positive control must execute ATA npm hook via typingsInstaller.js when ATA is enabled"
    );
    fs::remove_file(&v4_canary).unwrap();

    // --- PRODUCTION NEGATIVE VERIFICATION: SemanticSupervisor + BundledLaunchSpec ---
    let env_guard = ScopedEnvVars::set(&[
        ("NODE_OPTIONS", &poisoned_node_options),
        ("NODE_PATH", &poisoned_node_path),
        ("PATH", &poisoned_path),
    ]);

    let supervisor = SemanticSupervisor::new(Some(profile.clone()));
    supervisor.set_enabled(true).await;
    let conn = ConnectionId("conn-hostile-prod".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(conn, "proj-hostile", None, ws.to_path_buf(), ep)
        .await
        .expect("create session on hostile workspace");
    session
        .initialize()
        .await
        .expect("initialize hostile session");
    let index_uri = path_to_file_uri(&ws.join("src/index.ts"));
    session
        .did_open(index_uri.clone(), "typescript".into(), 1, index_ts_content)
        .await
        .unwrap();

    let def = session
        .navigation(
            "textDocument/definition",
            NavigationParams {
                text_document: TextDocumentIdentifier { uri: index_uri },
                position: Position {
                    line: 11,
                    character: 48,
                }, // VerifiedSafeEngine
                dam_hopper_document_version: 1,
                dam_hopper_model_generation: None,
            },
        )
        .await
        .expect("navigation must succeed on hostile workspace");
    assert_eq!(extract_first_line(&def), 4);

    // Inspect live child & descendant process /proc/<pid>/cmdline, /proc/<pid>/environ, and /proc/<pid>/status
    let pgid = session.get_pgid().await.expect("pgid");
    let descendants = get_all_descendants(pgid);
    assert!(!descendants.is_empty(), "tsserver child must be running");

    // TSLS 6.0.2 NodeTsServerProcessFactory.fork passes version.tsServerPath to
    // generatePatchedEnv, which sets NODE_PATH = path.join(modulePath, '..', '..', '..').
    // For the verified .../node_modules/typescript/lib/tsserver.js file this is
    // .../node_modules, derived independently here from the packaged manifest layout.
    let expected_node_path = profile
        .package_json_path()
        .parent()
        .expect("bundled TSLS manifest directory")
        .join("node_modules");
    assert_eq!(
        profile.tsserver_path(),
        expected_node_path.join("typescript/lib/tsserver.js"),
        "Verified profile must use the bundled TypeScript layout"
    );
    let assert_process_environment = |pid: u32, is_root: bool| {
        let environ = fs::read(format!("/proc/{pid}/environ"))
            .unwrap_or_else(|err| panic!("Read live /proc/{pid}/environ: {err}"));
        assert!(
            !environ.is_empty() && environ.ends_with(&[0]),
            "Live /proc/{pid}/environ must contain NUL-terminated entries"
        );
        let mut observed_path = false;
        for entry in environ
            .split(|byte| *byte == 0)
            .filter(|entry| !entry.is_empty())
        {
            let mut fields = entry.splitn(2, |byte| *byte == b'=');
            let key = fields.next().expect("nonempty environment entry");
            let value = fields
                .next()
                .unwrap_or_else(|| panic!("Malformed environment entry in /proc/{pid}/environ"));
            match key {
                b"NODE_OPTIONS" => panic!("NODE_OPTIONS must be absent from /proc/{pid}/environ"),
                b"NODE_PATH" => {
                    assert!(!is_root, "Root TSLS must not inherit NODE_PATH");
                    assert_eq!(
                        value,
                        expected_node_path.as_os_str().as_bytes(),
                        "Descendant {pid} NODE_PATH must equal the single bundled node_modules directory, never workspace paths or path lists"
                    );
                }
                b"PATH" => {
                    assert_eq!(
                        value, b"/usr/bin:/bin",
                        "Process {pid} must pin PATH=/usr/bin:/bin"
                    );
                    observed_path = true;
                }
                _ => {}
            }
        }
        assert!(
            observed_path,
            "Process {pid} environ must contain the pinned PATH"
        );
    };

    let tsls_cmdline = fs::read_to_string(format!("/proc/{pgid}/cmdline"))
        .unwrap_or_else(|err| panic!("Read live /proc/{pgid}/cmdline: {err}"));
    assert_eq!(
        tsls_cmdline.split('\0').next(),
        profile.node_path().to_str(),
        "Root TSLS must execute bundled Node"
    );
    assert!(
        tsls_cmdline
            .split('\0')
            .any(|arg| Some(arg) == profile.tsls_entrypoint().to_str()),
        "Root TSLS must execute the bundled CLI entrypoint"
    );
    assert_process_environment(pgid, true);
    assert!(
        !tsls_cmdline.contains("--tsserver-path"),
        "TSLS CLI must not pass --tsserver-path"
    );

    let expected_uid = unsafe { libc::getuid() };
    let mut verified_tsserver_proc = false;
    for dpid in &descendants {
        let cmdline = fs::read_to_string(format!("/proc/{dpid}/cmdline"))
            .unwrap_or_else(|err| panic!("Read live /proc/{dpid}/cmdline: {err}"));
        assert!(
            !cmdline.is_empty(),
            "Live descendant {dpid} command line must not be empty"
        );
        let status_txt = fs::read_to_string(format!("/proc/{dpid}/status"))
            .unwrap_or_else(|err| panic!("Read live /proc/{dpid}/status: {err}"));
        assert_process_environment(*dpid, false);
        assert!(
            !cmdline.contains("typingsInstaller.js"),
            "typingsInstaller.js must never be spawned when ATA is disabled"
        );
        if cmdline.contains("tsserver.js") {
            verified_tsserver_proc = true;
            assert!(
                cmdline
                    .split('\0')
                    .any(|arg| Some(arg) == profile.tsserver_path().to_str()),
                "tsserver must execute bundled tsserver.js path, got: {cmdline}"
            );
            assert!(cmdline.contains("--disableAutomaticTypingAcquisition"));
            assert!(!cmdline.contains("--allowLocalPluginLoads"));
            assert!(!cmdline.contains("--globalPlugins"));
            assert!(!cmdline.contains("--pluginProbeLocations"));
            assert!(!cmdline.contains("--npmLocation"));
            assert!(
                status_txt.contains(&format!("Uid:\t{expected_uid}\t")),
                "Child runs under server account UID (trusted-workspace code-loading restriction, not OS sandbox)"
            );
        }
    }
    assert!(
        verified_tsserver_proc,
        "Must observe bundled tsserver.js process in /proc"
    );

    drop(env_guard);

    // Exercise trusted-workspace boundary: child retains server-account filesystem read authority
    // (non-sandbox); target URI containment is enforced at SemanticGateway, not via OS sandboxing.
    let outside_file = outside_dir.join("outside-authority.ts");
    fs::write(
        &outside_file,
        "export const serverAccountReadableSymbol = 777;\n",
    )
    .unwrap();
    let authority_probe_path = ws.join("src/authority-probe.ts");
    let authority_probe_text = "import { serverAccountReadableSymbol } from '../../outside-target-root/outside-authority';\nexport const authorityCheck = serverAccountReadableSymbol;\n";
    fs::write(&authority_probe_path, authority_probe_text).unwrap();
    let authority_probe_uri = path_to_file_uri(&authority_probe_path);
    session
        .did_open(
            authority_probe_uri.clone(),
            "typescript".into(),
            1,
            authority_probe_text.into(),
        )
        .await
        .unwrap();
    let raw_outside_def = session
        .navigation(
            "textDocument/definition",
            NavigationParams {
                text_document: TextDocumentIdentifier {
                    uri: authority_probe_uri,
                },
                position: Position {
                    line: 1,
                    character: 35,
                }, // serverAccountReadableSymbol
                dam_hopper_document_version: 1,
                dam_hopper_model_generation: None,
            },
        )
        .await
        .expect("raw session navigation on outside import");
    assert!(
        serde_json::to_string(&raw_outside_def)
            .unwrap()
            .contains("outside-authority.ts"),
        "Raw child tsserver retains server-account filesystem read authority (trusted workspace, not OS sandbox): {raw_outside_def}"
    );

    assert!(
        !v1_canary.exists(),
        "V1 plugin canary must NEVER execute in production"
    );
    assert!(
        !v2_canary.exists(),
        "V2 workspace SDK canary must NEVER execute in production"
    );
    assert!(
        !v3_canary.exists(),
        "V3 NODE_OPTIONS preload canary must NEVER execute in production"
    );
    assert!(
        !v3_loader_canary.exists(),
        "V3 NODE_OPTIONS ESM loader canary must NEVER execute in production"
    );
    assert!(
        !v4_canary.exists(),
        "V4 ATA npm hook canary must NEVER execute in production"
    );

    supervisor.shutdown().await;
    assert!(
        verify_pids_dead(&descendants),
        "All hostile session descendants must be dead after shutdown"
    );
    assert!(
        is_pgid_empty(pgid),
        "Hostile session process group must be empty after shutdown"
    );
}
