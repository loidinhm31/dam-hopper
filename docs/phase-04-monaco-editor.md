# Phase 04: Monaco Editor + File Save

Adds text editor with tab management, mtime-guarded atomic writes, and file tiering for large file handling.

## File Tiering Strategy

Files categorized by size + binary status to optimize editor performance:

| Tier | Criteria | Editor | Features |
|------|----------|--------|----------|
| **normal** | <1 MB, text | Monaco | Full features: minimap, code folding, IntelliSense |
| **degraded** | 1-5 MB, text | Monaco | Disabled: minimap, code folding (perf) |
| **large** | ≥5 MB, text | LargeFileViewer | IntersectionObserver-based range reads; click to load sections |
| **binary** | any | BinaryPreview | Hex dump (base64 decoded) |

Tier determined at open time via `fileTier(size, isBinary)` from server's fs:read_result.

## WS Write Protocol

Three-phase atomic write via WebSocket (Phase 04):

### Phase 1: Begin
Client sends:
```json
{
  "kind": "fs:write_begin",
  "req_id": 123,
  "project": "web",
  "path": "src/index.ts",
  "expected_mtime": 1712577600,
  "size": 2048
}
```

Server validates:
- Path sandbox check
- File exists + mtime matches `expected_mtime` (guards concurrent modification)
- Size ≤100 MB

Response:
```json
{
  "kind": "fs:write_ack",
  "req_id": 123,
  "write_id": 456
}
```

### Phase 2: Chunks
Client chunks content (16 KB per chunk, configurable) and sends base64-encoded:
```json
{
  "kind": "fs:write_chunk",
  "write_id": 456,
  "seq": 0,
  "eof": false,
  "data": "base64_encoded_chunk..."
}
```

Server acks each chunk:
```json
{
  "kind": "fs:write_chunk_ack",
  "write_id": 456,
  "seq": 0
}
```

Empty files send single chunk with `seq=0, eof=true, data=""`.

### Phase 3: Commit
Client finalizes:
```json
{
  "kind": "fs:write_commit",
  "write_id": 456
}
```

Server performs atomic write (`atomic_write_with_check`):
- Re-checks mtime (final guard against TOCTOU)
- Writes to temp file on same FS partition
- fsync() optional (for durability)
- Atomic rename to target

Response indicates success or conflict:
```json
{
  "kind": "fs:write_result",
  "write_id": 456,
  "ok": true,
  "new_mtime": 1712577700,
  "conflict": false
}
```

On conflict (`ok=false, conflict=true`): client shows ConflictDialog—user chooses overwrite or reload.

## Client-Side Editor Store

`useEditorStore` (Zustand) manages:
- **tabs:** open files keyed by `${project}::${path}`
- **activeKeys:** Record of currently active tab key per project (persisted)
- **Persistence:** Tabs are persisted per-project via `localStorage` (metadata only), and content is auto-hydrated upon activation.
- **Tab shape:**
  - `content`: decoded UTF-8 string (Monaco binding)
  - `savedContent`: last committed version (dirty = content !== savedContent)
  - `binaryBase64`: raw base64 for BinaryPreview (binary tier only)
  - `mtime`: Unix seconds for conflict guard
  - `tier`: FileTier ("normal" | "degraded" | "large" | "binary")
  - `conflicted`: boolean (ConflictDialog shown)
  - `saving`, `loading`: async state

Key methods:
- `open()` — loads file via fs:read, sets tier, decodes content
- `save()` — Ctrl+S handler, initiates write protocol
- `forceOverwrite()` — after conflict: fetch current mtime, retry save
- `reloadTab()` — after conflict: discard edits, reload from server
- `setContent()` — Monaco onChange handler, marks dirty

## Components

**EditorTabs** (organisms) — tab bar with close buttons, active indicator, dirty dot indicator.

**EditorTab** (molecules) — individual tab; click to activate, close button, shows tier icon.

**MonacoHost** (organisms) — Monaco editor container, mounting, view state persistence, Ctrl+S save binding.

**LargeFileViewer** (organisms) — for tier="large"; IntersectionObserver columns, click-to-load rows, displays range-read chunks.

**BinaryPreview** (organisms) — for tier="binary"; hex dump + ASCII column (read-only).

**ConflictDialog** (molecules) — modal on conflict; buttons: "Overwrite" (forceOverwrite), "Reload" (reloadTab), "Cancel".

## REST vs WS

| Operation | Protocol | Why |
|-----------|----------|-----|
| fs:list (tree) | WS subscription | Live updates via fs:event |
| fs:stat (single file) | REST or WS:read (0-byte range) | Query mtime before save |
| fs:read (full file) | WS:read (supports ranges) | Handles large files, stream-friendly |
| fs:write | WS protocol | Atomic, chunked, mtime-guarded |

## Conflict Detection & Resolution

**Scenario:** File modified externally between client's last read and save attempt.

1. Server checks mtime at fs:write_begin (advisory)
2. Server re-checks mtime at fs:write_commit (definitive)
3. If mtime differs: return `{ ok: false, conflict: true }`
4. Client shows ConflictDialog:
   - **Overwrite:** fetch fresh mtime, re-send write_begin with new mtime, retry
   - **Reload:** fs:read fresh content, discard edits
   - **Cancel:** close dialog, keep local edits

## Limits & Caps

- Max unrestricted read: 100 MB (hard cap in server/src/fs/ops.rs)
- Max write size: 100 MB
- Chunk size: 128 KB (configurable WRITE_CHUNK_SIZE in ws-transport.ts)
- WS request timeout: 15s (FS_REQ_TIMEOUT_MS)

## Integration Points

- **State:** useEditorStore (Zustand) + TanStack Query for fs:read
- **Transport:** WsTransport wraps WS protocol (fsRead, fsWriteFile methods)
- **UI:** react-resizable-panels (file tree | editor | terminal)
