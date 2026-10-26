# Baseline b031e6a Deterministic Failing-Before Reproduction Artifact (F3 & F9)

**Date:** 2026-10-26  
**Baseline Git Commit:** `b031e6a40123d8c5169012e0b736ac8c4f1f6091`  
**Execution Environment:** Disposable worktree at `/home/loidinh/.cache/dam-hopper-baseline-b031e6a` (disk-backed, 368 GB quota).

---

## 1. Reproduction Methodology & Step-by-Step Runbook

### Step 1: Provision Disposable Worktree at Baseline Commit
```bash
git worktree add --detach /home/loidinh/.cache/dam-hopper-baseline-b031e6a b031e6a40123d8c5169012e0b736ac8c4f1f6091
cd /home/loidinh/.cache/dam-hopper-baseline-b031e6a
```

### Step 2: Apply the Replayable Baseline Test Overlay Patch
Save the patch below as `failing-before.patch` and apply:
```bash
git apply failing-before.patch
```

### Step 3: Run the Deterministic Failing-Before Tests
```bash
cargo test --manifest-path server/Cargo.toml \
  --test semantic_websocket test_baseline_b031e6a -- --nocapture --test-threads=1
```

### Step 4: Observed Harness Execution Output (Exit Code 0)
```text
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.19s
     Running tests/semantic_websocket.rs (/home/loidinh/.cache/dam-hopper-baseline-b031e6a/server/target/debug/deps/semantic_websocket-da6d063b85587cdd)

running 2 tests
test test_baseline_b031e6a_f3_relabeling_defect ... [BASELINE REPRO F3] res is: Object {"jsonrpc": String("2.0"), "id": Number(101), "result": Array [Object {"targetUri": String("dam-hopper://semantic/root/src/unopened.ts"), "targetRange": Object {"start": Object {"line": Number(1), "character": Number(0)}, "end": Object {"line": Number(1), "character": Number(32)}}, "targetSelectionRange": Object {"start": Object {"line": Number(1), "character": Number(16)}, "end": Object {"line": Number(1), "character": Number(22)}}, "damHopperDestinationContentSha256": String("b891daa899e6e53d9f97505b392208ac64078f75242a78632649b07da0ce3017"), "damHopperDestinationVersion": Number(1), "damHopperDestinationIncarnation": Number(2)}]}
[BASELINE REPRO F3] Target range line: 1
[BASELINE REPRO F3] Provenance SHA: "b891daa899e6e53d9f97505b392208ac64078f75242a78632649b07da0ce3017"
[BASELINE REPRO F3] Expected SHA B: b891daa899e6e53d9f97505b392208ac64078f75242a78632649b07da0ce3017
ok
test test_baseline_b031e6a_f9_dropped_cancellation_and_duplicate_id ... [BASELINE REPRO F9] Response received: Object {"jsonrpc": String("2.0"), "id": Number(201), "result": Array [Object {"targetUri": String("dam-hopper://semantic/root/src/unopened.ts"), "targetRange": Object {"start": Object {"line": Number(1), "character": Number(0)}, "end": Object {"line": Number(1), "character": Number(32)}}, "targetSelectionRange": Object {"start": Object {"line": Number(1), "character": Number(16)}, "end": Object {"line": Number(1), "character": Number(22)}}, "damHopperDestinationContentSha256": String("567bff7bfe18cd5e7c8ebe47e54732af9bf6d29fb6b91073b332a80f3ad660af"), "damHopperDestinationVersion": Null, "damHopperDestinationIncarnation": Null}]}
ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 11 filtered out; finished in 35.69s
```

### Step 5: Teardown Disposable Worktree
```bash
cd /home/loidinh/WS/worktrees/dam-hopper-lsp-server-integration
git worktree remove --force /home/loidinh/.cache/dam-hopper-baseline-b031e6a
```

---

## 2. Replayable Baseline Test Overlay Patch

```diff
--- a/server/src/semantic/gateway.rs
+++ b/server/src/semantic/gateway.rs
@@ -50,6 +50,18 @@ use crate::workspace_target::ProjectTargetRef;
+pub mod test_barriers {
+    use tokio::sync::Notify;
+    use std::sync::LazyLock;
+
+    pub static F3_PAUSE_NOTIFY: LazyLock<Notify> = LazyLock::new(Notify::new);
+    pub static F3_RESUME_NOTIFY: LazyLock<Notify> = LazyLock::new(Notify::new);
+    pub static F3_ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
+
+    pub static F9_PAUSE_NOTIFY: LazyLock<Notify> = LazyLock::new(Notify::new);
+    pub static F9_RESUME_NOTIFY: LazyLock<Notify> = LazyLock::new(Notify::new);
+    pub static F9_ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
+}
+
 /// Method identifier for attaching a project target to the semantic gateway.
 pub const METHOD_ATTACH_TARGET: &str = "damHopper/attachTarget";
@@ -1553,6 +1565,10 @@ impl SemanticGateway {
                 client_map.lock().await.remove(&cid);
                 cid
             };
+            if test_barriers::F9_ENABLED.load(std::sync::atomic::Ordering::SeqCst) {
+                test_barriers::F9_PAUSE_NOTIFY.notify_waiters();
+                test_barriers::F9_RESUME_NOTIFY.notified().await;
+            }
 
             // Immediate revocation check at delayed completion boundary
@@ -1945,6 +1961,10 @@ impl SemanticGateway {
                                 return;
                             }
+                            if test_barriers::F3_ENABLED.load(std::sync::atomic::Ordering::SeqCst) {
+                                test_barriers::F3_PAUSE_NOTIFY.notify_waiters();
+                                test_barriers::F3_RESUME_NOTIFY.notified().await;
+                            }
                             if let Ok(Some(actor_snap)) =
                                 handle.get_overlay_snapshot(dest_file_uri).await
                             {
--- a/server/src/semantic/supervisor.rs
+++ b/server/src/semantic/supervisor.rs
@@ -891,6 +891,11 @@ impl SemanticSupervisor {
         guard.get(key).cloned()
     }
+    pub async fn get_all_sessions(&self) -> Vec<SemanticSessionHandle> {
+        let guard = self.inner.sessions.read().await;
+        guard.values().cloned().collect()
+    }
+
     /// Close and reap a specific session.
     pub async fn close_session(&self, key: &SessionKey) {
--- a/server/tests/semantic_websocket.rs
+++ b/server/tests/semantic_websocket.rs
@@ -1765,6 +1765,120 @@ async fn test_g5_destination_provenance_open_and_unopened_pin_and_requery() {
     supervisor.shutdown().await;
 }
+
+#[tokio::test]
+async fn test_baseline_b031e6a_f3_relabeling_defect() {
+    use dam_hopper_server::semantic::gateway::test_barriers;
+    test_barriers::F3_ENABLED.store(true, std::sync::atomic::Ordering::SeqCst);
+
+    let tmp = TempDir::new().unwrap();
+    let project_dir = tmp.path().join("f3-repro-project");
+    std::fs::create_dir_all(project_dir.join("src")).unwrap();
+
+    let main_text = "import { helper } from './unopened';\nexport const localVal = helper();\n";
+    let unopened_text_a = "// header line\nexport function helper(): number {\n  return 99;\n}\n";
+    let main_path = project_dir.join("src/main.ts");
+    let unopened_path = project_dir.join("src/unopened.ts");
+    std::fs::write(&main_path, main_text).unwrap();
+    std::fs::write(&unopened_path, unopened_text_a).unwrap();
+
+    let toolchain = common::semantic_fixtures::TestToolchain::new();
+    let profile = toolchain.tool_profile();
+    let (state, _temp) = common::semantic_fixtures::make_test_app(
+        &["f3-repro"],
+        project_dir.clone(),
+        Some(profile),
+    ).await;
+
+    let supervisor = Arc::new(dam_hopper_server::semantic::supervisor::SemanticSupervisor::new(Some(profile)).await);
+    state.semantic_supervisor.set_enabled(true).await;
+    let addr = start_server(state, supervisor.clone()).await;
+    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
+    let req = http::Request::builder()
+        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
+        .header("Host", addr.to_string())
+        .header("Connection", "Upgrade")
+        .header("Upgrade", "websocket")
+        .header("Sec-WebSocket-Version", "13")
+        .header("Sec-WebSocket-Key", generate_key())
+        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
+        .body(())
+        .unwrap();
+    let (mut ws, _) = connect_async(req).await.unwrap();
+
+    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "id": 1, "method": "damHopper/attachTarget", "params": { "target": { "project": "f3-repro" }, "descriptor": "typescript" } }).to_string().into())).await.unwrap();
+    let attach_res = read_next_json(&mut ws).await.unwrap();
+    let target_id = attach_res["result"]["targetId"].as_str().unwrap().to_string();
+    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {} }).to_string().into())).await.unwrap();
+    let _ = read_initialize_json(&mut ws, 2).await.unwrap();
+    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }).to_string().into())).await.unwrap();
+    let main_virt_uri = format!("dam-hopper://semantic/{target_id}/src/main.ts");
+    let unopened_virt_uri = format!("dam-hopper://semantic/{target_id}/src/unopened.ts");
+    let unopened_file_uri = url::Url::from_file_path(dunce::canonicalize(&unopened_path).unwrap()).unwrap().to_string();
+    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "method": "textDocument/didOpen", "params": { "textDocument": { "uri": main_virt_uri, "languageId": "typescript", "version": 1, "text": main_text } } }).to_string().into())).await.unwrap();
+
+    let barrier_paused = test_barriers::F3_PAUSE_NOTIFY.notified();
+    tokio::pin!(barrier_paused);
+    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "id": 101, "method": "textDocument/definition", "params": { "textDocument": { "uri": main_virt_uri }, "position": { "line": 0, "character": 10 }, "damHopperDocumentVersion": 1 } }).to_string().into())).await.unwrap();
+    barrier_paused.await;
+
+    let text_b = "// mutated B\n// second line has length 35 chars!\nexport function helperB(): number {\n  return 999;\n}\n";
+    let sha_b = dam_hopper_server::semantic::uri::compute_text_sha256(text_b);
+    let session = supervisor.get_all_sessions().await.into_iter().next().unwrap();
+    session.did_open(unopened_file_uri.clone(), "typescript".into(), 1, text_b.into()).await.unwrap();
+    test_barriers::F3_RESUME_NOTIFY.notify_waiters();
+
+    let res = read_next_json(&mut ws).await.unwrap();
+    println!("[BASELINE REPRO F3] res is: {:?}", res);
+    let locs = res["result"].as_array().unwrap();
+    assert_eq!(locs[0]["damHopperDestinationContentSha256"], sha_b);
+    test_barriers::F3_ENABLED.store(false, std::sync::atomic::Ordering::SeqCst);
+    supervisor.shutdown().await;
+}
+
+#[tokio::test]
+async fn test_baseline_b031e6a_f9_dropped_cancellation_and_duplicate_id() {
+    use dam_hopper_server::semantic::gateway::test_barriers;
+    test_barriers::F9_ENABLED.store(true, std::sync::atomic::Ordering::SeqCst);
+
+    let tmp = TempDir::new().unwrap();
+    let project_dir = tmp.path().join("f9-repro-project");
+    std::fs::create_dir_all(project_dir.join("src")).unwrap();
+    let main_text = "import { helper } from './unopened';\nexport const localVal = helper();\n";
+    let unopened_text = "// header line\nexport function helper(): number {\n  return 99;\n}\n";
+    let main_path = project_dir.join("src/main.ts");
+    let unopened_path = project_dir.join("src/unopened.ts");
+    std::fs::write(&main_path, main_text).unwrap();
+    std::fs::write(&unopened_path, unopened_text).unwrap();
+
+    let toolchain = common::semantic_fixtures::TestToolchain::new();
+    let profile = toolchain.tool_profile();
+    let (state, _temp) = common::semantic_fixtures::make_test_app(&["f9-repro"], project_dir.clone(), Some(profile)).await;
+    let supervisor = Arc::new(dam_hopper_server::semantic::supervisor::SemanticSupervisor::new(Some(profile)).await);
+    state.semantic_supervisor.set_enabled(true).await;
+    let addr = start_server(state, supervisor.clone()).await;
+    let token = make_valid_jwt(MOCK_USER, MOCK_SESSION_ID);
+    let req = http::Request::builder().uri(format!("ws://{addr}/ws/semantic/v1?token={token}")).header("Host", addr.to_string()).header("Connection", "Upgrade").header("Upgrade", "websocket").header("Sec-WebSocket-Version", "13").header("Sec-WebSocket-Key", generate_key()).header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL).body(()).unwrap();
+    let (mut ws, _) = connect_async(req).await.unwrap();
+    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "id": 1, "method": "damHopper/attachTarget", "params": { "target": { "project": "f9-repro" }, "descriptor": "typescript" } }).to_string().into())).await.unwrap();
+    let attach_res = read_next_json(&mut ws).await.unwrap();
+    let target_id = attach_res["result"]["targetId"].as_str().unwrap().to_string();
+    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {} }).to_string().into())).await.unwrap();
+    let _ = read_initialize_json(&mut ws, 2).await.unwrap();
+    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }).to_string().into())).await.unwrap();
+    let main_virt_uri = format!("dam-hopper://semantic/{target_id}/src/main.ts");
+    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "method": "textDocument/didOpen", "params": { "textDocument": { "uri": main_virt_uri, "languageId": "typescript", "version": 1, "text": main_text } } }).to_string().into())).await.unwrap();
+
+    let barrier_paused = test_barriers::F9_PAUSE_NOTIFY.notified();
+    tokio::pin!(barrier_paused);
+    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "id": 201, "method": "textDocument/definition", "params": { "textDocument": { "uri": main_virt_uri }, "position": { "line": 0, "character": 10 }, "damHopperDocumentVersion": 1 } }).to_string().into())).await.unwrap();
+    barrier_paused.await;
+
+    ws.send(Message::Text(json!({ "jsonrpc": "2.0", "method": "$/cancelRequest", "params": { "id": 201 } }).to_string().into())).await.unwrap();
+    test_barriers::F9_RESUME_NOTIFY.notify_waiters();
+
+    let res = read_next_json(&mut ws).await.unwrap();
+    println!("[BASELINE REPRO F9] Response received: {:?}", res);
+    assert_eq!(res["id"], 201);
+    assert!(res.get("result").is_some());
+    test_barriers::F9_ENABLED.store(false, std::sync::atomic::Ordering::SeqCst);
+    supervisor.shutdown().await;
+}
```

---

## 3. Finding F3: Destination Coordinate Relabeling Defect

### Defect Mechanism
In baseline `server/src/semantic/gateway.rs` lines 1944–1965:
```rust
if let Ok(Some(actor_snap)) = handle.get_overlay_snapshot(dest_file_uri).await {
    let is_user_overlay = actor_snap.version >= 1;
    provenance_map.insert(
        dest_file_uri.clone(),
        DestinationProvenance {
            content_sha256: actor_snap.content_sha256,
            version: if is_user_overlay { Some(actor_snap.version) } else { None },
            open_incarnation: if is_user_overlay { Some(actor_snap.open_incarnation) } else { None },
            text: actor_snap.text,
        },
    );
}
```
When an unopened destination was pinned and requeried, `gateway.rs` discarded the immutable `_damHopperProvenSnapshots` returned by the session actor for that requery. Instead, it queried `handle.get_overlay_snapshot(dest_file_uri).await` and inserted the live snapshot into `provenance_map`.
When the destination document was mutated between the requery input and this live capture (e.g. from text A to text B), `provenance_map` was overwritten with text B and SHA(B).
The emitted JSON-RPC response combined coordinates evaluated against text A with `damHopperDestinationContentSha256` computed from text B.

### Deterministic Test Execution
- **Test:** `test_baseline_b031e6a_f3_relabeling_defect` in `semantic_websocket.rs`
- **Synchronization:** `test_barriers::F3_PAUSE_NOTIFY` / `test_barriers::F3_RESUME_NOTIFY`
- **Interleaving:**
  1. Destination `unopened.ts` text A: `// header line\nexport function helper(): number {\n  return 99;\n}\n`
  2. Query evaluated against A: returns target coordinates on line 1, character 16..22 (`helper`).
  3. Gateway pauses after requery map capture via channel barrier.
  4. Test mutates destination in session actor to text B: `// mutated B\n// second line has length 35 chars!\nexport function helperB(): number {\n  return 999;\n}\n` with `SHA(B) = b891daa899e6e53d9f97505b392208ac64078f75242a78632649b07da0ce3017`.
  5. Gateway resumes and reads live snapshot from actor.
- **Observed Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 101,
  "result": [
    {
      "targetUri": "dam-hopper://semantic/root/src/unopened.ts",
      "targetRange": { "start": { "line": 1, "character": 0 }, "end": { "line": 1, "character": 32 } },
      "targetSelectionRange": { "start": { "line": 1, "character": 16 }, "end": { "line": 1, "character": 22 } },
      "damHopperDestinationContentSha256": "b891daa899e6e53d9f97505b392208ac64078f75242a78632649b07da0ce3017",
      "damHopperDestinationVersion": 1,
      "damHopperDestinationIncarnation": 2
    }
  ]
}
```
Coordinates evaluated against text A (character 16..22) were relabeled with SHA(B). In text B, character 16..22 on line 1 corresponds to `"has le"` rather than the definition symbol.

---

## 4. Finding F9: Dropped Cancellation Ownership and ID Tracking Defect

### Defect Mechanism
In baseline `server/src/semantic/gateway.rs` lines 1546–1554:
```rust
let c_id = {
    let mut map = internal_map.lock().await;
    let cid = match map.remove(&internal_id) {
        Some(id) => id,
        None => return,
    };
    client_map.lock().await.remove(&cid);
    cid
};
```
Upon completion of child stage 1, the gateway immediately removed `client_id` from `client_to_internal`.
During the subsequent inter-stage pin gap (disk reads, pin allocation) and during stage 2 requery:
1. `client_to_internal.get(client_id)` returns `None`, so any incoming `$/cancelRequest` for `client_id` was dropped.
2. `client_to_internal.contains_key(client_id)` returns `false`, allowing immediate duplicate ID reuse while the original request was still running.
3. Cancellation in the gap was never recorded, allowing stage 2 to execute and return a successful result instead of `-32800 Request cancelled`.

### Deterministic Test Execution
- **Test:** `test_baseline_b031e6a_f9_dropped_cancellation_and_duplicate_id` in `semantic_websocket.rs`
- **Synchronization:** `test_barriers::F9_PAUSE_NOTIFY` / `test_barriers::F9_RESUME_NOTIFY`
- **Interleaving:**
  1. Client sends navigation request with ID `201`.
  2. Stage 1 completes; gateway executes `client_map.remove(&201)` and pauses at pin gap barrier.
  3. Client sends `$/cancelRequest` with `{"id": 201}`.
  4. Gateway resumes, submits stage 2 without cancellation tracking.
- **Observed Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 201,
  "result": [
    {
      "targetUri": "dam-hopper://semantic/root/src/unopened.ts",
      "targetRange": { "start": { "line": 1, "character": 0 }, "end": { "line": 1, "character": 32 } },
      "targetSelectionRange": { "start": { "line": 1, "character": 16 }, "end": { "line": 1, "character": 22 } },
      "damHopperDestinationContentSha256": "567bff7bfe18cd5e7c8ebe47e54732af9bf6d29fb6b91073b332a80f3ad660af",
      "damHopperDestinationVersion": null,
      "damHopperDestinationIncarnation": null
    }
  ]
}
```
The request completed with success rather than returning JSON-RPC error `-32800 REQUEST_CANCELLED`.
