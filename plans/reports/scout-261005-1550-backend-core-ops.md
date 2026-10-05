# Backend Core Operations Technical Scout Report

**Target Modules:** `server/src/git/`, `server/src/pty/`, `server/src/fs/`, `server/src/tunnel/`, `server/src/port_forward/`, `server/src/commands/`  
**Date:** 2026-10-05  

---

## 1. Executive Summary & Architecture Overview

The backend core consists of five tightly synchronized operational subsystems designed around strict isolation, non-blocking asynchronous coordination, and fail-closed security invariants:
- **Git Subsystem:** Hybrid libgit2 in-memory ODB manipulation + CLI porcelain fallback; CAS commit history rewrites, squash with descendant rebasing, and exact-OID leased publication.
- **PTY Subsystem:** `portable-pty` process lifecycle with process group cleanup, monotonic incarnation tracking, generation-fenced respawns, scrollback buffering, and isolated broadcast event channels.
- **FS Subsystem:** Multi-tier sandboxing with lexical and canonical traversal rejection, TOCTOU-resistant directory file descriptor operations (`openat`/`O_NOFOLLOW`), ticketed media streaming with inode verification, and OPAQUE-keyed AES-256-GCM chunked file uploads.
- **Tunnel & Port Forwarding Subsystem:** Isolated Cloudflared ephemeral quick tunnels with single-authority supervisor lifecycles, dev-server host-header rewriting, and dual port discovery (ANSI-stripped stdout regex + Linux `/proc/net/tcp` inode polling) gated by PTY incarnation ownership.
- **Commands Subsystem:** In-memory BM25-ranked full-text command search engine with precompiled language/build tool presets (Cargo, npm, pnpm, Maven, Gradle).

---

## 2. Deep Dive: Module Architectures, Invariants & Workflows

### 2.1 Git Operations (`server/src/git/`)

#### Architectural Invariants
1. **Object-Only Manipulation:** Commit message edits and squashes operate directly against git ODB (`odb.write(git2::ObjectType::Commit, &payload)`), never checking out commits, touching the working tree, or mutating the index.
2. **Strict Ref CAS Fencing (`publish_checked_ref`):**
   - Ref updates require preflight verification: `snapshot_branch` captures branch name and tip OID under git transaction locks.
   - Active operations block rewrites (`repo.state() == Clean`, no active merge/rebase/revert/bisect).
   - Foreign worktrees containing the target branch block rewrites (`GitBlockReason::CheckedOutBranch`).
   - Grafts, shallow clones, and `refs/replace/*` refs are strictly rejected.
   - Commit tree invariant: Rewritten tip tree OID MUST strictly match original tip tree OID.
   - Ref update locks both `HEAD` and target branch for active branches, or target branch with HEAD-not-active assertion for inactive branches. Held alongside `IndexLockGuard` (`index.lock`) to prevent sequencers from entering.
3. **Leased Push Publication (`leased_push.rs`):**
   - Two-phase commit preview (`prepare_leased_push`) and execution (`publish_leased_push`).
   - Generates `PublishSnapshot` containing `repository_identity` (SHA256 of gitdir, commondir, root), `remote_identity` (SHA256 of push URL), `destination_ref`, `expected_remote_oid`, and `source_oid`.
   - Publication uses force-push refspec `+{source_oid}:{destination_ref}` but enforces exact-OID safety via libgit2 `push_negotiation` callback: verifies exactly 1 ref update, remote old OID matches `expected_remote_oid`, local new OID matches `expected_source_oid`. Rejects with `StaleRemote` if remote has moved.
4. **Squash Rules (`squash_commits.rs`):**
   - Requires linear history: merge commits in selected or descendant ranges are rejected.
   - Commits must be consecutive in exact oldest-first order (`selected.windows(2)` parent check).
   - Replacement commit synthesizes: newest tree, oldest author, current committer (`repo.signature()`), and oldest parent.
   - Descendants up to tip are rewritten in parent-first order.
   - GPG signatures on absorbed/descendant commits require explicit caller consent (`allow_signature_removal`).

#### Recent Changes (Commit `6f756b1b`)
- Added inactive branch commit message editing and squash: `snapshot_branch` distinguishes `was_active` (locks HEAD + branch) vs inactive (locks branch, asserts HEAD symbolic target != branch).
- Extended leased push preview and publication to accept an optional `target_branch`, removing the restriction that only checked-out branches could be published with leased fencing.

---

### 2.2 PTY Subsystem (`server/src/pty/`)

#### Architectural Invariants
1. **Incarnation Fencing:**
   - Public session IDs (e.g. `terminal:default`, `build:1`) are reusable across user restarts and reconnects.
   - Manager maintains monotonic `next_incarnation: u64` initialized from timestamp and persisted max.
   - Every `LiveSession`, reader thread, persistence command, WebSocket event, and port report carries concrete `incarnation`.
   - Stale readers from previous incarnations cannot emit exit events, overwrite newer scrollback buffers, or corrupt SQLite persistence.
2. **Lifecycle & Generation Fencing:**
   - `generation: u64` increments on global session disposal; prevents delayed respawn commands from older generations from spawning.
   - `killed: HashSet<String>` prevents auto-restart after user-initiated termination.
   - `suppress_exit_counts: HashMap<String, usize>` and `pending_replacements: HashMap<String, u64>` prevent races during rapid session recreation.
3. **Process Termination:**
   - On Unix, `LiveSession::terminate` targets process group leader first (`killpg(Pid, SIGKILL)`), preventing orphaned background child processes, before falling back to `ChildKiller::kill()`.
4. **Dead Session Tombstones:**
   - 60-second in-memory TTL (`DeadSession`) retains scrollback buffer so reattaching clients see terminal output immediately without waiting for async SQLite persistence.
5. **Broadcast Channel Isolation (`BroadcastEventSink`):**
   - Separate Tokio broadcast channels for general terminal events (`tx`), host resource alerts (`host_alert_tx`), and idle suspend revisions (`idle_suspend_tx`). Terminal output volume cannot starve or drop system alerts.

---

### 2.3 Filesystem Subsystem (`server/src/fs/`)

#### Architectural Invariants
1. **Sandbox Boundaries (`sandbox.rs`):**
   - Lexical fast-path rejection: any `Component::ParentDir` (`..`) immediately errors with `FsError::PathEscape` without disk I/O.
   - Canonical validation: paths canonicalized via `dunce::canonicalize` on blocking threads (stripping Windows UNC verbatim prefixes) and verified using `target_path_is_within`.
   - Target containment: worktrees outside configured project root require valid `ResolvedProjectTarget`.
2. **TOCTOU & Symlink Swap Defense (`secure_path.rs`):**
   - Delayed writes open target parent directory with `O_NOFOLLOW | O_DIRECTORY | O_CLOEXEC`.
   - Records `DirectoryIdentity` (device + inode on Unix; volume serial + file index on Windows).
   - Subsequent file creation and atomic rename use `openat`/`fstat` against the directory handle, preventing directory symlink replacement attacks during streaming uploads.
3. **Ticketed Media Streaming (`media_ticket.rs`, `image_ticket.rs`, `video_ticket.rs`):**
   - Tickets bound to client session (`MediaSessionBinding`) with idle TTL (15m) and absolute TTL (8h).
   - Inode & device pinning: `MediaFileVersion` stores `(device, inode, mtime, size)`. Revalidates inode on access to prevent TOCTOU file substitution.
4. **Chunked & OPAQUE Uploads (`upload.rs`, `enc_upload.rs`, `decrypt.rs`):**
   - `UploadState`: chunk staging via `NamedTempFile` co-located in target directory (guaranteeing same filesystem partition for atomic rename).
   - Monotonic sequence check (`next_seq`), size check (running bytes <= declared `expected_len` <= 100 MB cap). Atomic rename with optional fsync.
   - `EncUploadState`: client uploads encrypted blob with OPAQUE session ID. Server decrypts using AES-256-GCM via 32-byte key. Format: `IV(12) || ciphertext+tag`. Plaintext: `metadata_json + 0x00 + content`. Metadata capped at 4096 bytes.

---

### 2.4 Tunnel & Port Forwarding Subsystems (`server/src/tunnel/`, `server/src/port_forward/`)

#### Architectural Invariants
1. **Tunnel Lifecycle & Single-Authority Exit (`cloudflared.rs`, `manager.rs`):**
   - Ephemeral quick tunnels launch `cloudflared` with:
     - `--no-autoupdate`: prevents unexpected background updater activity.
     - `--config ""`: isolates subprocess from host/global config discovery (e.g. `/etc/cloudflared/config.yml`).
     - `--http-host-header localhost`: rewrites forwarded Host header for dev servers with DNS rebinding protection (e.g. Vite 6 `server.allowedHosts`).
     - `--url http://127.0.0.1:{port}`.
   - Single-Authority Exit (Commit `b1f0419c`): `child.wait()` in outer supervisor task is the sole authority for exit notifications (`Exited`/`Failed`). Stderr reader extracts trycloudflare URL within 30s timeout, then drains remaining stderr without firing duplicate exits. `terminal_reached: Arc<AtomicBool>` fences reader/supervisor races. Manager provides fallback transition from Starting/Ready to Stopped if driver channel closes without terminal event.
   - Pending stop races: `pending_stops: Arc<RwLock<HashSet<Uuid>>>` ensures stop requests during driver start cleanly terminate the resulting driver instead of leaking an orphaned tunnel.
2. **Port Forwarding Discovery & Incarnation Fencing (`detector.rs`, `manager.rs`):**
   - Danger Port Filter: rejects privileged ports (< 1024) and sensitive services (22, 25, 110, 143, 3306, 5432, 6379, 27017).
   - Dual Discovery Channels:
     1. PTY stdout scanner (`scan_chunk`): strips ANSI CSI/OSC escapes, regex matches localhost/0.0.0.0/listening patterns. Non-blocking; reports first match per chunk.
     2. Poller (`proc_poll_loop` on Linux): polls `/proc/net/tcp` and `/proc/net/tcp6`, traverses `/proc/[pid]/fd` to match sockets against PTY child PIDs.
   - Incarnation ownership validation: `PortForwardManager.active_sessions` tracks `(session_id -> incarnation)`. Only the current PTY incarnation can report stdout discoveries or trigger tunnel creation. Replaced/killed readers cannot leak ports or orphan tunnels.

---

### 2.5 Commands Subsystem (`server/src/commands/`)

#### Architectural Invariants
1. **In-Memory BM25 Search (`registry.rs`):**
   - Full-text search engine implementing BM25 ranking algorithm ($k_1 = 1.2, b = 0.75$).
   - Tokenizes names, commands, descriptions, and tags (alphanumeric >= 2 chars, lowercase).
   - Inverted index calculates term frequency, average doc length, and inverse document frequency.
2. **Compile-Time Presets (`presets.rs`):**
   - JSON definitions bundled via `include_str!` for `cargo`, `npm`, `pnpm`, `maven`, `gradle`.
   - Exposed via REST endpoints (`GET /api/commands`, `GET /api/commands/search`) for UI command runner integration.

---

## 3. Key Types Summary Table

| Subsystem | Key Type | Role / Responsibility | Synchronization / Invariant |
| :--- | :--- | :--- | :--- |
| **Git** | `CapturedBranch` | Snapshot of branch ref, tip OID, and active status | Captured under git transaction lock |
| **Git** | `CommitMessageSnapshot` | Full UTF-8 message + branch + tip OID | Lock-free ODB read, verified against branch tip |
| **Git** | `PublishSnapshot` | Leased push contract with repo & remote SHA256 hashes | Exact-OID fenced in `push_negotiation` callback |
| **Git** | `IndexLockGuard` | RAII guard for `.git/index.lock` | Held through CAS ref update to block external sequencers |
| **PTY** | `LiveSession` | Active PTY process, handles, writer, buffers | Master PTY mutex, child killer, shutdown `AtomicBool` |
| **PTY** | `DeadSession` | Process exit tombstone (60s TTL) | Stores `incarnation`, keeps scrollback buffer in RAM |
| **PTY** | `PtySessionManager` | Manages live/dead sessions, reader threads, supervisor | Arc Mutex Inner with `next_incarnation` & `generation` |
| **PTY** | `BroadcastEventSink` | WebSocket/SSE event publisher | Triple broadcast channels (events, alerts, suspend) |
| **FS** | `ProjectSandbox` | Multi-project sandbox directory boundary | Dunce canonicalization + `target_path_is_within` |
| **FS** | `DirectoryIdentity` | Stable OS directory identity (device + inode / volume + index) | Verified via `openat`/`fstat` with `O_NOFOLLOW` |
| **FS** | `MediaFileVersion` | Media file validation token & OS identity | Inode pinned; prevents TOCTOU replacement |
| **FS** | `UploadState` / `EncUploadState` | Chunked upload accumulator & AES-256-GCM decryptor | Colocated tempfile, sequential chunk check, 100 MB cap |
| **Tunnel** | `TunnelSessionManager` | Manages tunnel sessions, driver handles, stop races | `pending_stops` map, `in_flight_starts` counter |
| **Tunnel** | `CloudflaredDriver` | Manages ephemeral quick tunnel subprocess | `child.wait()` supervisor exit authority, `AtomicBool` race fence |
| **Port** | `PortForwardManager` | Tracks detected ports & PTY owners | `active_sessions` incarnation validation, danger port guard |
| **Commands** | `CommandRegistry` | BM25 index & preset database | In-memory inverted index, compile-time JSON presets |

---

## 4. Operational Invariant Interactions & Failure Modes

1. **PTY Incarnation Race vs Port Forwarding:**
   - When a user restarts a terminal session (`terminal:default`), `PtySessionManager` increments incarnation (e.g. 101 -> 102).
   - If old reader 101 emits stdout with a detected port, `PortForwardManager.report_stdout_hit` checks `active_sessions.get("terminal:default") == 102 != 101` and drops the report.
2. **Git Rewrite vs Worktree Concurrent Edit:**
   - If user attempts to edit a commit or squash while another worktree has the branch checked out, `mutation_preflight` detects the worktree path divergence and rejects with `GitBlockReason::CheckedOutBranch`.
   - If an external sequencer (rebase/merge) begins during calculation, `IndexLockGuard` and `publish_checked_ref` transaction checks detect non-clean repository state or tip divergence and block with `GitBlockReason::ActiveOperation` or `StaleRef`.
3. **Tunnel Exit vs Stderr Close:**
   - In quick tunnels, if cloudflared closes stderr before URL discovery, the reader task finishes without emitting `Exited`. The `child.wait()` task detects actual process termination and emits the single authoritative exit event.

---

## 5. Unresolved Questions

- *None.* All module architectures, invariants, synchronization primitives, and recent commits (`6f756b1b`, `b1f0419c`) are fully verified against repository source code.
