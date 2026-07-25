# Research: artifact → terminal handoff

## Existing patterns

- Server is Axum + Tokio; `AppState` owns shared managers and `DiagnosticStore`. REST routes are authenticated by bearer middleware; WS uses a strict Serde `#[serde(tag = "kind")]` envelope. Existing request/response identifiers (`req_id`) and push events provide the project’s typed handoff convention (`server/src/api/ws_protocol.rs`, `server/src/api/ws.rs`).
- `TunnelSessionManager` stores sessions/driver handles in `Arc<RwLock<HashMap<Uuid, ...>>>`, atomically checks duplicate ports while holding the write lock, broadcasts lifecycle events, and reaps children in `dispose_all()`. Cloudflared is launched against `http://127.0.0.1:{port}` and only accepts `https://<slug>.trycloudflare.com` URLs via a regex (`server/src/tunnel/{manager,cloudflared}.rs`).
- Terminal writes are deliberately fire-and-forget (`Transport.terminalWrite`) and the panel forwards xterm `onData` to PTY. Suggestion acceptance invalidates its snapshot, derives a suffix, rejects CR/LF, then writes only that suffix; history insertion similarly rejects multiline commands and never sends Enter (`packages/ui/src/lib/terminal-suggestion-acceptance.ts`, `TerminalHistoryList.tsx`, `TerminalPanel.tsx`).
- Diagnostics are persistent JSONL plus export endpoints and terminal tails. Treat browser-debug artifacts as separate, explicitly excluded data; do not let screenshot/HTML payloads enter diagnostic records or terminal scrollback by default.

## Recommended artifact design

1. Generate artifacts server-side in a dedicated per-session directory under the configured runtime/cache directory (not project roots, `.claude`, or diagnostics JSONL). Use random UUID filenames, `create_new`, restrictive mode `0600`, and atomic tempfile+rename. Store metadata (kind, byte length, MIME, created/expiry, owner/session) in an in-memory map.
2. Make artifacts ephemeral: short default TTL (e.g. 5–15 minutes), hard max size (PNG and JSON separately), one-shot or bounded download count, and cleanup on expiry, session disconnect, and server shutdown. Run a periodic Tokio sweep; also unlink before/after successful retrieval. Never trust client-supplied paths.
3. Expose a typed REST/WS handoff, not a raw filesystem path: `artifact:create`/`artifact:ready` carries `{artifactId, kind, mime, size, expiresAt, sha256}`; `GET /api/artifacts/:id` authenticates, checks owner/session and expiry, validates `Accept`/content type, then streams with `Content-Disposition: inline` and `X-Content-Type-Options: nosniff`. Return 404 for expired/unknown IDs (avoid oracle detail). Add explicit delete/revoke.
4. If a PTY must consume JSON, write a bounded, escaped JSON envelope through `terminal:write` only after user confirmation. Prefer an id/reference over embedding arbitrary payload; terminal-side helper can fetch authenticated artifact. Never auto-submit. For direct insertion, normalize to a single line, reject `\r`, `\n`, C0 controls, and ANSI/OSC escape bytes; cap bytes and append no Enter. Preserve current suggestion controller’s “invalidate then suffix write” ordering.

## Tunnel/origin security

- Reuse the active `TunnelSessionManager`; do not spawn an independent cloudflared process. Require session status `Ready`, verify requested port matches the session, and authorize the caller against the session owner/connection. Validate returned origins with the existing allowlist regex; reject user-provided destination URLs, redirects, non-HTTPS, localhost/private-network origins, and unexpected hosts. Keep tunnel labels opaque and length-bounded.
- Browser fetch/WS handoff must use the configured server base URL and bearer token; do not put long-lived tokens in artifact URLs. Apply existing CORS policy and same auth middleware to artifact routes.

## Hostile payload / DOM guidance

- Render captured HTML/text as text (`textContent`/React text nodes), never `innerHTML`; sanitize or omit `<script>`, event attributes, URLs, and CSS if a preview is required. Escape JSON for display, including `<`, `>`, `&`, U+2028/U+2029. Treat terminal output as hostile: strip or visibly encode CSI/OSC/DCS and control bytes before any DOM/debug panel rendering.
- Bound DOM preview length, line count, nesting, and decoded URL size. Use `rel="noreferrer noopener"` for links and a restrictive CSP/sandboxed iframe for optional HTML preview; default to download/raw text.

## Diagnostics exclusion and tests

- Mark artifact IDs/paths as `sensitive_ephemeral`; diagnostics export should redact them and never include raw PNG/HTML/JSON or terminal-inserted payloads. Log only event kind, size, hash, and outcome. Ensure cleanup errors are warning-level and non-fatal.
- Tests should cover: traversal/ID guessing, auth and owner mismatch, expired/one-shot retrieval, size/MIME caps, atomic permissions, concurrent retrieval/delete, disconnect cleanup, malformed WS envelopes, hostile control sequences/newlines, no implicit Enter, and tunnel URL/port/origin mismatch. Add property/fuzz tests for ANSI/DOM escaping and JSON framing.

## Unresolved questions

- Is artifact ownership per authenticated user, WS connection, or terminal session, and should reconnect preserve access?
- Should retrieval be one-shot (stronger secrecy) or allow a small download count for browser refresh/debug workflows?
- Does the browser-debug feature require raw HTML preview, or can it use text/PNG only (prefer the latter)?
