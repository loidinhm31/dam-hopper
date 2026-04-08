# Researcher 01 — Server-side FS subsystem (Rust)

Stack: axum 0.8 + tokio + portable-pty (existing PTY broadcast pattern in `server/src/pty/`).

## 1. notify + debouncing

- Use **`notify-debouncer-full`** (NOT `mini`). Correlates rename From/To, rewrites paths on rename, tracks FS IDs (FSEvents/Windows). https://docs.rs/notify-debouncer-full
- One recursive watcher per workspace root. On Linux every subdir = 1 inotify watch regardless of recursive vs per-dir registration; `notify` walks at registration time.
- Linux: each dir consumes `fs.inotify.max_user_watches` (modern systemd default 65536+; Manjaro typically 1048576; older kernels 8192). Read `/proc/sys/fs/inotify/max_user_watches` at startup. On `notify::ErrorKind::MaxFilesWatch` surface actionable error and optionally fall back to `PollWatcher` (interval ≥ 2s). https://docs.rs/notify/latest/notify/enum.ErrorKind.html
- macOS FSEvents quirks: OS coalesces events, paths may canonicalize differently (`/private/var` vs `/var`), no per-file granularity pre-10.13, rename correlation requires the FileId tracking `debouncer-full` enables.
- Debouncer callback runs on a **std thread** (not tokio). Bridge with `tokio::sync::mpsc::UnboundedSender` (non-blocking `send`); re-broadcast from a tokio task. Mirrors existing PTY pattern.

```rust
// server/src/fs/watcher.rs
use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult};
use tokio::sync::{broadcast, mpsc};

pub fn spawn(root: PathBuf) -> broadcast::Receiver<FsEvent> {
    let (tx_raw, mut rx_raw) = mpsc::unbounded_channel();
    let (tx_bcast, rx_bcast) = broadcast::channel(1024);

    std::thread::spawn(move || {
        let mut deb = new_debouncer(
            Duration::from_millis(150), None,
            move |res: DebounceEventResult| { let _ = tx_raw.send(res); },
        ).unwrap();
        deb.watch(&root, RecursiveMode::Recursive).unwrap();
        std::thread::park();
    });

    tokio::spawn(async move {
        while let Some(res) = rx_raw.recv().await {
            for ev in normalize(res) { let _ = tx_bcast.send(ev); }
        }
    });
    rx_bcast
}
```

## 2. Path sandboxing — recommend canonicalize + prefix-check (not cap-std)

- `cap-std` is theoretically nicer (capability handles, no TOCTOU) but forces a parallel FS API (`Dir::open_at`) and doesn't compose with `git2`, `tokio::fs`, `portable-pty`. YAGNI for an authed single-user IDE.
- Pattern: `tokio::fs::canonicalize(req).await?`, then `path.starts_with(&workspace_root_canonical)`. Reject if not. Canonicalize root once at startup, cache.
- Windows: wrap with **`dunce::canonicalize`** to strip `\\?\` UNC prefix that breaks `starts_with`. https://docs.rs/dunce
- TOCTOU between canonicalize and open is out of scope — only writer is the authenticated user. Document assumption in CLAUDE.md.
- Symlinks outside root → reject post-canonicalize. Symlinks inside root → allow.

## 3. Atomic writes

- `tempfile::NamedTempFile::persist` = `rename(2)`. Same-FS only; on `EXDEV` returns the temp file in error so you can fall back to copy+rename.
- Always `NamedTempFile::new_in(parent_of_target)` so temp file is on same FS and dir as target — sidesteps cross-device entirely.
- `persist` does NOT fsync. For an IDE: fsync the file before rename and (optional) fsync parent dir after. Make it a config knob; per-save fsync tanks SSD throughput on big repos.
- Skip `atomicwrites` crate — wraps the same primitives, no value.

## 4. Binary detection / MIME

- Use **`infer`** (magic-byte sniff, no deps, sync, fast). https://docs.rs/infer. `mime_guess` is extension-only — useless for "is this binary?".
- Layered heuristic on first 8 KB: (1) `infer::get` known binary type → binary. (2) NUL byte present → binary. (3) `std::str::from_utf8` fails → binary. Else text. Same logic as VS Code and `git`.
- Cap probe at 8 KB. Don't ship file content unless text or explicitly requested.

## 5. Axum WS multiplexing

- One WS per client. Envelope: `{ id: u64, channel: "fs|term|git|...", kind, payload }`.
- Avoid HOL blocking: spawn one **writer task** per WS owning the `SplitSink`, draining a per-connection `mpsc::channel(N)`. Each subsystem holds an `mpsc::Sender` clone — fan-in, not fan-out, on the write side.
- Slow client: bounded mpsc cap ~512. On `try_send` Full → **drop the connection** for fs/git (clients lose tree consistency if events skipped). Drop-oldest only for high-volume PTY output — keep that policy isolated to PTY.
- Subscription lifecycle: client `subscribe {channel, params}` → server allocates `sub_id`, spawns pump task `broadcast::Receiver` → per-conn mpsc. `unsubscribe` aborts task.

```rust
let (out_tx, mut out_rx) = mpsc::channel::<ServerMsg>(512);
let (mut ws_tx, mut ws_rx) = socket.split();
tokio::spawn(async move {
    while let Some(m) = out_rx.recv().await {
        if ws_tx.send(m.into()).await.is_err() { break; }
    }
});
// per subscribe:
let mut fs_rx = fs_watcher.subscribe(root);
let tx = out_tx.clone();
tokio::spawn(async move {
    while let Ok(ev) = fs_rx.recv().await {
        if tx.send(ServerMsg::Fs{sub_id, ev}).await.is_err() { break; }
    }
});
```

## 6. Streaming file transfer over WS

- **Binary frames**, not base64. axum/tungstenite `Message::Binary(Vec<u8>)` is native; base64 is +33% for nothing.
- Framing: small JSON header `{op:"file_chunk", id, seq, eof}` followed by a binary frame. Simpler vs length-prefixed CBOR/postcard.
- Chunk size: **64–256 KB**. Smaller = overhead; larger = HOL stalls + memory spikes.
- Backpressure: rely on per-conn bounded mpsc. Reader uses `tx.send(...).await`. For uploads, require client `ack {seq}` before next chunk.
- Range reads: `read {path, offset, len}`. Don't auto-stream entire repos.

## Unresolved questions

1. Single shared workspace watcher vs per-subscription server-side filtering?
2. `.gitignore` honoring: server-side `ignore` crate, or client filter?
3. Max watched-tree policy when `max_user_watches` small: hard cap (refuse) vs soft cap (poll fallback)?
4. fsync-on-save default on or off?
5. Client→server uploads in v1 scope, or only edits to existing files?
6. Linux without FS-ID source — does `debouncer-full` still correlate renames via inotify cookie? Smoke test before committing.
