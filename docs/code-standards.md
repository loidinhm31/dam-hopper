# Code Standards

## Rust Backend (server/)

### Project Structure

```
server/src/
├── main.rs           # Bootstrap, router setup
├── lib.rs            # Crate root
├── state.rs          # AppState definition
├── error.rs          # Top-level AppError
├── api/              # HTTP handlers + WebSocket
│   ├── mod.rs
│   ├── router.rs     # Route registration
│   ├── error.rs      # ApiError mapping
│   ├── fs.rs         # File explorer (list, read, stat)
│   └── ...
├── config/           # TOML parsing
│   ├── mod.rs
│   └── schema.rs     # Type definitions
├── fs/               # Filesystem sandbox + operations
│   ├── mod.rs        # FsSubsystem
│   ├── error.rs
│   ├── sandbox.rs    # Path validation
│   └── ops.rs        # Directory/file operations
├── pty/              # Terminal sessions
├── git/              # Git operations
├── agent_store/      # Item distribution
└── commands/         # Command registry
```

### Error Handling Pattern

Each module defines `thiserror` enum:

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum FsError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Path outside workspace")]
    OutOfBounds,
    #[error("Feature unavailable")]
    Unavailable,
}
```

Top-level `AppError` wraps module errors:

```rust
pub enum AppError {
    Fs(FsError),
    Git(GitError),
    NotFound(String),
}
```

API handlers map to HTTP status via `ApiError::from(AppError)`.

### Async Patterns

**Never hold locks across `.await`:**

❌ Bad:
```rust
let fs = state.fs.sandbox()?;  // holds lock
let result = async_op(&fs).await;  // lock held!
```

✅ Good:
```rust
let fs = state.fs.sandbox()?;  // clone fields out
let sandbox_root = fs.root().to_path_buf();  // release lock
let result = async_op(&sandbox_root).await;  // safe
```

**Clone-cheap types:**
- Arc<T> (includes PtySessionManager, FsSubsystem, AgentStoreService)
- Pass clones into async tasks

### Testing

Integration tests use real filesystems via `tempfile` crate:

```rust
#[tokio::test]
async fn test_list_dir() {
    let temp = TempDir::new().unwrap();
    let result = ops::list_dir(temp.path()).await;
    assert!(result.is_ok());
}
```

No mocking of filesystem or git.

### PTY Session Manager Patterns (Phase 04+)

**Restart Policies** — `RestartPolicy` enum:

```rust
pub enum RestartPolicy {
    Never,          // Don't restart on any exit
    OnFailure,      // Restart on non-zero exit (see limitation below)
    Always,         // Restart on any exit (including 0)
}
```

**Creating with Restart Policy:**

```rust
let opts = PtyCreateOpts {
    id: "build:test".into(),
    command: "npm run build".into(),
    restart_policy: RestartPolicy::OnFailure,
    restart_max_retries: 3,
    // ... other fields
};
let meta = manager.create(opts)?;
```

**Supervisor Pattern** — how restarts work:

1. **Reader Thread** (std::thread blocking I/O)
   - Reads PTY output in 4KB chunks
   - On EOF: infer exit code, check if killed, send RespawnCmd
   - Immediately exits (don't block supervisor waiting for response)

2. **Superviser Task** (async tokio)
   - Receives RespawnCmd from bounded channel (256 slots)
   - Waits for backoff delay (exponential: 1s → 30s max)
   - Checks killed flag (TOCTOU-safe, reader released lock)
   - Calls `create()` with same session ID (no network changes)
   - Updates restart_count, resets on clean exit

3. **Bounded Channel Defense**
   - Prevents unbounded respawn queue if supervisor hangs
   - 256 slots = ~5× typical max sessions (50)
   - If full, reader tries_send fails, respawn dropped (session in dead map)
   - Supervisor dead/slow → next reader will also fail → cascading drop

**Exit Code Inference Limitation** (Phase 04):

```rust
fn infer_exit_code(id: &str, inner: &Arc<Mutex<Inner>>) -> i32 {
    let guard = inner.lock().unwrap();
    // portable-pty signals EOF but not waitpid status
    if guard.live.contains_key(id) {
        0  // Process still in live map (shouldn't happen — reader just exited)
    } else {
        -1  // Process removed from live (assumed natural exit/eof)
    }
    // Cannot distinguish: exit 0, exit 1, exit 127, etc.
    // All EOF = -1 or 0 (depending on timing of removal)
}
```

**Workaround:** OnFailure policy currently indistinguishable from Always. To fix:
- Future work: wrap child in `std::process::Command`
- Call `waitpid()` before EOF to capture actual status
- Requires architecture change (not Phase 04 scope)

**Session ID Reuse** (Important):

When respawning, the same session ID is used. Frontend **does not** need to navigate or reconnect:
- Session ID remains stable across respawns
- WebSocket subscribers notified via `send_terminal_change()`
- Buffer optionally retained (clearing old content on restart optional)
- User continues typing as if session never died

**Tombstone Lifecycle:**

```
LiveSession
    ↓ (EOF)
DeadSession (will_restart=true, restart_in_ms=1000)
    ↓ (backoff delay)
    ↓ (supervisor create)
LiveSession (restart_count=1)
    ↓ (EOF again, but exit==0 — clean)
DeadSession (will_restart=false) — restart_count reset to 0
    ↓ (60s TTL sweeps)
<removed from map>
```

**Tests for Restart Engine:**

- `test_restart_decision_never` — Never policy rejects restart
- `test_restart_decision_on_failure` — OnFailure on exit≠0 approves restart
- `test_restart_decision_always` — Always approves any exit
- `test_restart_count_increments` — Each respawn increments counter
- `test_restart_count_resets_on_clean_exit` — Clean exit resets counter
- `test_backoff_exponential_growth` — 1s → 2s → 4s → ... → 30s max
- `test_killed_session_no_restart` — Killed sessions don't restart
- `test_bounded_channel_prevents_dos` — Queue full drops respawn (safe)

## TypeScript Frontend (packages/web/)

### Profile Management Pattern

Multi-server profile management lives in `packages/web/src/api/server-config.ts` with a client-side-only architecture.

**Data Model:**

```typescript
export interface ServerProfile {
  id: string;                    // UUID v4 via crypto.randomUUID()
  name: string;                  // User-friendly name
  url: string;                   // Server endpoint (auto-normalized: strip trailing slash, prepend http:// if no scheme)
  authType: "basic" | "none";    // Authentication type
  username?: string;             // Display name (password never stored)
  createdAt: number;             // Unix timestamp from Date.now()
}
```

**CRUD Functions:**

```typescript
// Retrieval
export function getProfiles(): ServerProfile[] { /* parse localStorage */ }
export function getActiveProfileId(): string | null { /* from localStorage */ }
export function getActiveProfile(): ServerProfile | null { /* find active */ }

// Mutation
export function createProfile(data: Omit<ServerProfile, "id" | "createdAt">): ServerProfile {
  // auto-generate id + timestamp, append to profiles list, persist
}

export function updateProfile(id: string, data: Partial<Omit<ServerProfile, "id" | "createdAt">>): void {
  // merge fields, persist
}

export function deleteProfile(id: string): void {
  // remove from list, clear active if deleted profile is active, persist
}

export function setActiveProfile(id: string): void { /* localStorage.setItem(KEY_ACTIVE_PROFILE, id) */ }

// Persistence
export function saveProfiles(profiles: ServerProfile[]): void {
  // Wrapper around JSON.stringify + localStorage.setItem(KEY_PROFILES, ...)
  // Always wrap in try/catch (localStorage may be unavailable)
}

// Backward Compatibility
export function migrateToProfiles(): void {
  // If profiles already exist → no-op
  // If legacy damhopper_server_url exists and not same-origin → create "Default Server" profile
  // Called in App.tsx at startup
}
```

**localStorage Keys:**
- `damhopper_server_profiles` — JSON stringified array of `ServerProfile[]`
- `damhopper_active_profile_id` — active profile UUID
- `damhopper_server_url` — *(legacy, migrated away)* single server URL
- `damhopper_auth_token` — *(sessionStorage, not localStorage)* Bearer token (cleared on tab close)
- `damhopper_auth_username` — *(sessionStorage, not localStorage)* username (cleared on tab close)

**Error Handling:**

All localStorage operations wrapped in `try/catch`. Failures silently return defaults (empty array, null). localStorage may be unavailable in private browsing or sandboxed contexts.

**Component Integration:**

- `ServerProfilesDialog.tsx` — modal list for switching/deleting profiles
  - calls `getProfiles()` + `getActiveProfileId()` on open
  - calls `setActiveProfile(id)` on switch
  - calls `deleteProfile(id)` on delete (with confirmation)
  - exports profile to parent via `onEditProfile`, `onSwitchProfile` callbacks (for page reload if needed)

- `ServerSettingsDialog.tsx` — form for creating/editing profile
  - calls `createProfile(data)` or `updateProfile(id, data)`
  - accepts profile object (or null for new)
  - auto-normalizes URL (strips trailing slash, prepends http:// if no scheme)

- `Sidebar.tsx` — active profile pill + "Change Server" button
  - displays `getActiveProfile()?.name` or "Not Connected"
  - opens `ServerProfilesDialog` on click

**Testing Notes:**

- localStorage is mocked in test environments (jsdom default). Manually mock localStorage if testing profile persistence.
- No server call involved — all operations are synchronous (except JSON parse/stringify).

### Build & Type Checking

```bash
pnpm build       # Vite build
pnpm dev         # Watch + HMR
pnpm lint        # ESLint
pnpm format      # Prettier
```

**TypeScript:** `strict: true`, `target: ES2022`, `moduleResolution: bundler`.

### Naming Conventions

| Location | Convention | Example |
|---|---|---|
| React component files (`.tsx`) | **PascalCase** | `FileTree.tsx`, `SearchPanel.tsx` |
| Hook files (`hooks/`) | **camelCase** | `useFileSearch.ts`, `useFsOps.ts` |
| Non-component TS files | **kebab-case** | `ws-transport.ts`, `fs-types.ts`, `server-config.ts` |
| Rust source files | **snake_case** | `fs_subsystem.rs`, `sandbox.rs` |
| Docs / command `.md` files | **kebab-case** | `code-standards.md`, `api-reference.md` |

> **Rule of thumb:** if the file exports a JSX component → PascalCase; if it exports a React hook → camelCase; everything else → kebab-case.

### Component Structure

```
src/
├── api/
│   ├── client.ts          # Type definitions (mirrors Rust API)
│   ├── fs-types.ts        # Filesystem-specific types
│   ├── transport.ts       # Fetch transport
│   ├── ws-transport.ts    # WebSocket client
│   └── queries.ts         # TanStack Query hooks
├── components/
│   ├── atoms/             # Smallest reusable primitives (Button, Badge)
│   ├── molecules/         # Composed atoms (EditorTab, SidebarTabSwitcher)
│   ├── organisms/         # Feature-complete components (FileTree, TerminalPanel)
│   ├── pages/             # Full-screen route pages
│   ├── templates/         # Page-level layout shells (IdeShell, AppLayout)
│   └── ui/                # Low-level headless UI primitives (Select)
├── hooks/                 # Custom React hooks (camelCase filenames)
├── lib/                   # Pure utilities, no React
├── stores/                # Zustand stores
└── types/                 # Shared TypeScript type declarations
```

### Client Types

Types in `src/api/client.ts` **intentionally duplicate** Rust API shapes. This keeps the web package independent — no shared TypeScript lib.

Update client types when API changes (camelCase on wire, snake_case in Rust):

```typescript
// Rest API
export interface DirEntry {
  name: string;
  kind: 'file' | 'dir';
  size: number;
  mtime: number;
  isSymlink: boolean;
}

// WS protocol (Phase 04+)
export interface FsReadResponse {
  ok: boolean;
  binary: boolean;
  mime?: string;
  mtime?: number;
  size?: number;
  data?: string;  // base64-encoded
  code?: string;
}

export interface FsWriteResponse {
  ok: boolean;
  newMtime?: number;
  conflict: boolean;
  error?: string;
}
```

### API Client Pattern

```typescript
// REST via fetch
const entries = await transport.invoke('GET /api/fs/list', {
  project: 'web',
  path: 'src'
});

// WS protocol (Phase 04+)
const content = await transport.fsRead(project, path);
await transport.fsWriteFile(project, path, content, mtime);
```

## Authentication & Security Patterns (Phase 01+)

### No-Auth Dev Mode

The `--no-auth` flag enables local development without MongoDB authentication:

```bash
# Command-line flag
cd server && cargo run -- --no-auth --workspace /path/to/workspace

# Environment variable
DAM_HOPPER_NO_AUTH=1 cargo run -- --workspace /path/to/workspace
```

**Implementation Pattern** (auth.rs):

```rust
pub async fn require_auth(
    State(state): State<AppState>,
    jar: CookieJar,
    request: Request,
    next: Next,
) -> Response {
    // Dev mode: bypass all auth checks
    if state.no_auth {
        return next.run(request).await;
    }

    // Normal JWT validation...
}
```

**Production Safety**:
- Panics if MongoDB configured while no-auth enabled
- Panics if RUST_ENV or ENVIRONMENT set to "production"
- Multi-line warning banner on startup
- ERROR-level logging for visibility

See [Phase 01 documentation](./phase-01-server-auth-bypass/index.md) for complete security considerations.

### JWT Pattern

- **Token Storage**: `~/.config/dam-hopper/server-token` (hex UUID)
- **Signing Algorithm**: HS256 (HMAC-SHA256)
- **Cookie Transport**: httpOnly, Secure, SameSite=Strict
- **Validation**: Constant-time comparison via `subtle` crate
- **Expiry**: 30 days for production, 30 days for dev mode

## Configuration (dam-hopper.toml)

```toml
[workspace]
name = "my-workspace"

[[projects]]
name = "project-name"
path = "./relative/path"
type = "npm"  # npm | pnpm | cargo | maven | gradle | custom
build_command = "npm run build"
run_command = "npm start"
tags = ["backend", "critical"]

[features]
ide_explorer = true
```

On-disk uses snake_case; serde `#[serde(rename = "...")]` handles mapping.

## Code Style Guidelines

### Rust

- Module-level error types (no top-level catch-all)
- Arc<Mutex<T>> for shared mutable state, RwLock<T> for mostly-read
- `Result<T, E>` everywhere; no unwrap in library code
- Explicit `await` — don't hide async with wrapper functions
- Single-line docs for public items

### TypeScript

- Functional components with hooks
- Explicit prop typing (no `any`)
- Handle loading/error states in components
- One component per file (unless very small atoms)
- CSS class names via Tailwind utilities
- **File naming**: component files → PascalCase; hook files → camelCase; all other `.ts` files → kebab-case

### Commit Messages

Format: `type(scope): description`

```
feat(fs): add read endpoint with range support
fix(pty): handle SIGTERM gracefully
refactor(api): extract fs handlers to module
test(fs): add sandbox validation tests
docs: update architecture diagram
```

Types: feat, fix, refactor, test, docs, perf, ci, chore.

## Build Artifacts

**Rust:**
- Release: `server/target/release/dam-hopper-server`
- Binary includes all dependencies (musl-libc for portability)

**Web:**
- Vite output: `packages/web/dist/`
- Served by Rust binary via `tower-http::ServeDir`

## Dependency Policy

**Rust:**
- Core: axum, tokio, serde
- Optional: git2 (git ops), portable-pty (terminals), notify (file watching)
- Security: subtle (constant-time comparison), walkdir (path safety)

**Web:**
- Core: react, vite, tailwind, typescript
- API: TanStack Query (data fetching)
- Terminal: xterm.js for PTY rendering

No additional heavy dependencies without discussion.

## Feature Flags

Conditional compilation gates feature-specific code.

```rust
#[cfg(feature = "ide_explorer")]
fn my_handler() { ... }
```

Routes registered conditionally at router construction time.

## Documentation

- Public items must have doc comments (`/// ...`)
- Complex algorithms explain the "why"
- Link to related modules/types
- Examples in docs for non-obvious APIs

## Security Checklist

- [ ] Path validation (workspace sandbox)
- [ ] Bearer token authentication
- [ ] No shell injection (avoid shlex parsing for commands)
- [ ] No symlink traversal (validate all path operations)
- [ ] CORS configured (default: localhost:5173)
- [ ] Error messages don't leak paths/credentials
