# Research Report: dev-hub File Write/Upload Performance Validation

**Date:** 2026-04-13
**Scope:** Validate current write/upload mechanism, identify performance characteristics and potential improvements

---

## Executive Summary

dam-hopper's FS write/upload subsystem is **well-architected**. It uses industry-standard patterns: atomic writes via `tempfile::NamedTempFile` + `persist()`, chunked WS protocols with backpressure, `spawn_blocking` for sync I/O, mtime-based OCC, and sandbox path validation. The implementation is production-grade with few issues. Three performance concerns identified: (1) write protocol uses base64 over WS text frames (33% overhead), while upload protocol correctly uses binary frames; (2) write chunks accumulate in memory before commit (no streaming-to-disk); (3) `fsync` is disabled by default for both protocols which trades durability for speed.

---

## Architecture Overview

```
Frontend (React/TS)                    Backend (Rust/Axum)
─────────────────                      ──────────────────
                                       
[Editor Tab]──fsWriteFile()──┐         
  ├─ write_begin             │         ┌──────────────────┐
  ├─ write_chunk* (base64)   ├─WS──►  │ Per-conn HashMap  │
  └─ write_commit            │         │ writes: HashMap   │
                             │         │   <write_id,      │
[UploadDropzone]──fsUpload() │         │    WriteInFlight>  │ ──commit──► atomic_write_with_check()
  ├─ upload_begin            │         │                    │              ├─ mtime guard
  ├─ upload_chunk (JSON hdr) │         │ uploads: HashMap   │              ├─ NamedTempFile::new_in()
  ├─ [binary frame]          │         │   <upload_id,      │              ├─ write_all()
  └─ upload_commit           ┘         │    UploadState>    │              ├─ optional fsync
                                       └──────────────────┘               └─ persist() (atomic rename)
```

Two distinct protocols:

| Protocol | Transport | Encoding | Commit | Streaming |
|----------|-----------|----------|--------|-----------|
| **Write** (editor save) | WS text frames | Base64 chunks | In-memory buf → `atomic_write_with_check()` | No — full buf in RAM |
| **Upload** (file upload) | WS binary frames | Raw bytes | `UploadState` → temp file → `persist()` | Yes — direct to temp file |

---

## Key Findings

### 1. Atomic Write Pattern — CORRECT

Both protocols use `tempfile::NamedTempFile::new_in(parent)` to ensure temp file lives on same FS partition as target. This guarantees `persist()` (which calls `rename(2)`) is an atomic, O(1) operation.

**Current code** ([ops.rs](../../server/src/fs/ops.rs)):
```rust
let mut tmp = tempfile::NamedTempFile::new_in(&parent)?;
tmp.write_all(&bytes)?;
if fsync { tmp.as_file().sync_data()?; }
tmp.persist(&abs)?;
```

**Verdict:** Textbook correct. Same-partition constraint avoided cross-device rename failures. `persist()` atomically replaces target.

### 2. Write Protocol (Editor Save) — GOOD, with caveats

**Flow:** `write_begin` → `write_chunk*` (base64 JSON) → `write_commit`

**Performance characteristics:**
- **Chunk size:** 128 KB (client-side `WRITE_CHUNK_SIZE`)
- **Encoding:** Base64 over text WS frames — **33% bandwidth overhead**
- **Buffering:** All chunks accumulated in `Vec<u8>` in `WriteInFlight.buf` before commit
- **Commit:** Offloaded to `spawn_blocking` for the sync `NamedTempFile` write + persist
- **mtime OCC:** Checked at commit time — rejects stale writes with `FsError::Conflict`

**Concerns:**
- **Memory pressure for large files:** A 100 MB write holds 100 MB in RAM per connection until commit. With concurrent writers, this multiplies. The `FS_WRITE_MAX = 100 MB` cap bounds this, but it's still significant.
- **Base64 encoding overhead:** ~33% bandwidth expansion. For a 100 MB file, this means ~133 MB over the wire. Not a problem for typical editor saves (< 1 MB) but suboptimal for large files.
- **Sequential chunk acks:** Each chunk waits for ack before sending next (write protocol). Latency-sensitive on high-RTT connections.

**Recommendation:** For files > 5 MB, consider reusing the upload protocol's binary frame approach. The current split makes semantic sense (text editing vs file upload) but the encoding overhead is unnecessary for large text files.

### 3. Upload Protocol (File Upload) — EXCELLENT

**Flow:** `upload_begin` → (`upload_chunk` JSON header + binary WS frame)* → `upload_commit`

**Performance characteristics:**
- **Chunk size:** 128 KB
- **Encoding:** Raw binary WS frames — zero encoding overhead
- **Streaming:** Chunks written directly to `NamedTempFile` via `UploadState::append_chunk()` — constant memory usage regardless of file size
- **Backpressure:** Client maintains in-flight window of 4 (`IN_FLIGHT = 4`) — up to 4 acks outstanding. Good balance between throughput and backpressure.
- **Commit:** `spawn_blocking(move || upload_state.commit(false))` — correctly offloaded

**This is the better protocol design.** It streams to disk, uses binary frames, and has proper windowed backpressure.

### 4. `spawn_blocking` Usage — CORRECT

All synchronous FS operations are properly offloaded:

| Operation | In `spawn_blocking`? | Notes |
|-----------|---------------------|-------|
| `atomic_write_with_check` (write commit) | Yes | Correct — sync I/O in blocking thread |
| `upload_state.commit()` | Yes | Correct |
| `list_dir` | Yes | Correct — avoids per-entry async overhead (code comment explains 3-5x win) |
| `tree_snapshot_sync` | Called from blocking context | Correct — sync `std::fs` |
| `sandbox.validate()` | `spawn_blocking` for `canonicalize` | Correct — canonicalize hits FS |

**No issues.** All blocking I/O is off the async executor.

### 5. mtime-Based Optimistic Concurrency — ADEQUATE

The write protocol uses Unix-second mtime for conflict detection:

```rust
if current_mtime != expected_mtime {
    return Err(FsError::Conflict);
}
```

**Known limitation:** 1-second granularity. Two rapid writes within the same second could silently overwrite. This is acceptable for a local development tool where the primary use case is a single user editing files.

**If higher fidelity is needed:** Use `modified()` with nanosecond precision (available on Linux/macOS) or hash-based ETags. Not needed for current use case.

### 6. File Watcher — CORRECT NonRecursive Choice

```rust
d.watch(root, notify::RecursiveMode::NonRecursive)?;
```

The code comment explains the tradeoff perfectly:
> Recursive mode traverses every subdirectory to set up inotify watches, which is catastrophically slow for large workspaces (e.g. Rust `target/` with millions of files). The client's delta logic only operates on depth-1 nodes anyway.

**Debounce interval:** 150 ms — appropriate for UI responsiveness without excessive event churn.

**Broadcast channel capacity:** 256 — adequate for debounced events; lagged receivers only lose events that would be superseded anyway.

### 7. Security Validation

| Concern | Status |
|---------|--------|
| Path traversal | **PROTECTED** — `WorkspaceSandbox` rejects `..` lexically AND canonicalizes |
| File size DoS | **PROTECTED** — 100 MB cap on both write and upload |
| .git mutation | **PROTECTED** — `assert_safe_mutation` blocks .git writes without `force_git` |
| Sequence attacks | **PROTECTED** — monotonic seq validation on both protocols |
| Auth | **PROTECTED** — Constant-time token comparison (`subtle::ConstantTimeEq`) |
| Temp file cleanup | **ADEQUATE** — `NamedTempFile` auto-cleans on drop; abort scenarios may leave orphans |

---

## Comparative Analysis: Write vs Upload Protocol

| Aspect | Write Protocol | Upload Protocol | Winner |
|--------|---------------|-----------------|--------|
| Memory usage | O(file_size) | O(chunk_size) | Upload |
| Wire efficiency | 33% base64 overhead | Zero overhead (binary frames) | Upload |
| Backpressure | Sequential ack per chunk | Windowed (4 in-flight) | Upload |
| Streaming to disk | No (buf in RAM) | Yes (direct to tempfile) | Upload |
| OCC | mtime check at commit | None (new file creation) | Write |
| Use case fit | Editor save (small files) | File upload (any size) | Tie |

---

## Performance Recommendations

### P1: No Action Required (Current State is Good)
- Atomic write via same-partition `NamedTempFile` + `persist()` — optimal
- `spawn_blocking` usage — correct everywhere
- NonRecursive watcher — correct tradeoff
- Upload protocol — excellent streaming design
- 128 KB chunk size — good balance (matches typical OS page cache flush granularity)

### P2: Consider for Large File Writes
- **If users edit large files (>5 MB) regularly:** Add binary frame path to write protocol, similar to upload. This would eliminate the base64 overhead and could stream to disk instead of accumulating in RAM.
- **Estimated impact:** 33% bandwidth reduction + constant memory for large saves

### P3: fsync Policy
Current: `fsync = false` for both protocols. This is correct for a dev tool — OS page cache provides sufficient durability for local development. `fsync` would add 5-50 ms latency per write on SSD (much more on HDD). No change recommended.

### P4: Low Priority / Future
- **Write protocol memory cap:** Consider streaming write chunks to a temp file (like upload does) instead of accumulating in `Vec<u8>` for writes > some threshold (e.g. 1 MB). Would reduce worst-case per-connection memory.
- **mtime granularity:** Adequate for single-user dev tool. If multi-user editing is added, switch to content hashing.

---

## Spec vs Implementation Gaps (phase-04-monaco-editor.md)

| Spec Claim | Actual Implementation | Impact |
|------------|----------------------|--------|
| "16 KB per chunk, configurable" | `WRITE_CHUNK_SIZE = 128 * 1024` (128 KB) in `ws-transport.ts` | Spec outdated. 128 KB is the better choice — fewer round-trips, better throughput |
| "Server checks mtime at fs:write_begin (advisory)" | `FsWriteBegin` handler only validates path + size cap. **No mtime check at begin.** | Spec describes a two-phase mtime guard (advisory at begin, definitive at commit). Implementation only does commit-time check via `atomic_write_with_check`. The advisory check was never implemented or was removed. |
| File tiering (normal/degraded/large/binary) | Tiering logic is client-side based on `fs:read_result` size + binary fields | Confirmed working as specified |
| ConflictDialog flow | `forceOverwrite()` fetches current mtime, retries with new mtime | Confirmed working as specified |

**Recommendation:** Update spec to match implementation (128 KB chunks, single mtime check at commit only). The commit-only mtime check is sufficient — an advisory begin-time check adds a round-trip to the FS for no real benefit since the definitive check at commit is what prevents data loss.

## Unresolved Questions

1. **Orphan temp files on crash/kill:** `NamedTempFile` destructor won't run on `SIGKILL`/`exit()`. Temp files would be left in project directories. A periodic cleanup on startup could address this, but it's very low priority for a dev tool.
2. **Upload to existing file:** The upload protocol creates new files (`validate_new_path`). Overwriting an existing file via upload would need a separate path. Currently this is likely handled by the write protocol, but for large binary files the upload protocol's streaming would be preferred.
3. **Concurrent uploads limit:** No per-connection or global limit on number of simultaneous upload sessions. A malicious or buggy client could open many uploads and exhaust temp file descriptors. Low risk for a local dev tool.
