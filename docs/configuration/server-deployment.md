# Server Deployment and Transport

Server launch modes, deployment, browser origin/CORS, media compatibility, and host-resource SSE operations moved from the [server configuration index](./server-configuration.md).
## Running the Server

### Development Mode

```bash
cd server
cargo run -- --config /path/to/dam-hopper.toml --port 4800 \
  --host 127.0.0.1
# Or omit --config to use ~/.config/dam-hopper/dam-hopper.toml
```

### With Logging

```bash
RUST_LOG=dam_hopper=debug cargo run -- --config /path/to/dam-hopper.toml \
  --host 127.0.0.1
```

### Release Build

```bash
cargo build --release
./target/release/dam-hopper-server --config /path/to/dam-hopper.toml --port 4800 \
  --host 127.0.0.1
```

### Authenticated SQLite Lite Mode Launch

To run without a MongoDB service, opt into SQLite lite mode via environment variables:

```bash
DAM_HOPPER_LITE_MODE=true \
DAM_HOPPER_AUTH_SQLITE_PATH=/var/lib/dam-hopper/auth.db \
DAM_HOPPER_MFA_KEY_FILE=/etc/dam-hopper/mfa-encryption.key \
./target/release/dam-hopper-server --config /path/to/dam-hopper.toml --port 4801 \
  --host 127.0.0.1
```

**Storage, Isolation & First-Account Invariants:**
- **Authenticated Mode (Not `--no-auth`)**: `DAM_HOPPER_LITE_MODE=true` (or `1`, case-insensitive) selects authenticated SQLite storage with no automatic fallback to MongoDB and fatal startup on SQLite initialization failure. `--no-auth` is a separate loopback-only development bypass, never SQLite lite mode.
- **Private Persistent Directory**: Ensure the directory containing `auth.db` (e.g. `/var/lib/dam-hopper`) is strictly owned by the server process user with mode `0700`, and provide a valid dedicated 32-byte owner-only `DAM_HOPPER_MFA_KEY_FILE` in production.
- **Single Process Constraint**: Exactly **one server process per local auth file**. Do not run multiple DamHopper server processes pointing to the same SQLite auth file. Network filesystems (NFS, SMB, CIFS) are not supported.
- **First Account Approval & Promotion**: `POST /api/auth/register` creates a disabled `user` account (`auth_version = 0`) and never grants automatic first-user `admin` rights (`POST /api/auth/login` returns `401 ACCOUNT_DISABLED` until approved). After starting the server, follow the **Development profile** or **Deployment profile** in the canonical [Operator Account Approval and Role Promotion Runbook](./server-environment-auth.md#operator-account-approval-and-role-promotion-runbook) to register against `http://127.0.0.1:4801`, approve/promote the account in SQLite, and complete TOTP MFA enrollment ([Authentication API](../api/authentication.md)).
### Dedicated release web host (`dam-hopper-web`)

Build and run the second Cargo binary with a selected immutable web root:

```bash
cargo build --release --manifest-path server/Cargo.toml
./server/target/release/dam-hopper-web \
  --root /path/to/immutable/web-dist \
  --host 0.0.0.0 \
  --port 4802 \
  --runtime-config /etc/dam-hopper/runtime-config.json
```

`--root` (or `DAM_HOPPER_WEB_ROOT`) is required. The host rejects missing,
non-directory, or symlink roots. `--runtime-config` is optional; without it the
reserved endpoint returns `404`. Runtime config is public but startup-validated,
contains `schemaVersion`, `releaseVersion`, `profileId`, and optional `apiUrl` (omitted
when unset), and is capped at 4 KiB. When present, `apiUrl` must be an exact HTTP(S)
origin without credentials, path, query, or fragment.

The host serves only GET/HEAD. Health and runtime config are reserved
`/__dam-hopper/*` routes with JSON and `Cache-Control: no-store`; static files
stream with MIME detection. Hashed Vite assets are immutable for one year,
`index.html` is `no-cache`, and other assets use a bounded one-hour cache.
Extensionless HTML navigation may fall back to `index.html`; asset-like,
reserved, traversal, encoded-separator, symlink, and directory requests return
`404`. SIGTERM and CTRL-C perform graceful shutdown.

### API-only and Docker combined mode

`dam-hopper-server` is API-only by default: omit `--web-dir` for no static
filesystem access. Docker intentionally opts in to the legacy combined topology:

```bash
dam-hopper-server --port 4800 --web-dir /opt/dam-hopper/web
```

The repository `Dockerfile` supplies this explicit flag in its `CMD`. Do not
infer that systemd or direct API startup serves browser assets; systemd uses
backend port `4801`, while the dedicated web host uses `4802`.

### Linux systemd release manager

Use the published bootstrap or packaged `dam-hopper` manager; checkout-built
production/reset scripts are not supported:

```bash
bash dam-hopper-install.sh --version v0.2.0 --role server
sudo dam-hopper start
```

For an already downloaded bundle, `fetch` runs as the non-root caller and
`install`/`role set` run as root:

```bash
dam-hopper fetch --latest --output "$HOME/.cache/dam-hopper/latest"
sudo dam-hopper install --bundle "$HOME/.cache/dam-hopper/latest" --role server
sudo dam-hopper start
```

`install` and `role set` stop at `PENDING`; `start` is the sole activation
entrypoint. If the canonical root is a verified legacy format-2 installation,
the manager performs the one-time side-staged migration and retires the old
runner. Exact invariants, exchange, rollback, and recovery are documented in
[Linux systemd](../linux-systemd.md).

Current systemd-owned paths are:

- `/opt/dam-hopper/` — canonical release root and current/previous views
- `/etc/systemd/system/dam-hopper-api.service`
- `/etc/systemd/system/dam-hopper-web.service`
- `/etc/systemd/system/dam-hopper-recovery.service`
- `/var/lib/dam-hopper-manager/state.json` — durable manager state

## Browser origin and transport

The API server is API-only by default. A separate `dam-hopper-web` deployment
normally listens on `4802` and fetches its API origin from runtime config, so
the API must allow the exact web origin through credentialed CORS. Wildcard and
credentialed allow-all CORS are forbidden:

```bash
# API allows a dedicated web host
DAM_HOPPER_CORS_ORIGINS=https://web.example.com \
  dam-hopper-server --host 0.0.0.0 --port 4801

# Docker's explicit combined mode is same-origin on 4800
dam-hopper-server --host 0.0.0.0 --port 4800 \
  --web-dir /opt/dam-hopper/web
```

The equivalent API CLI option is `--cors-origins
"https://first.example,https://second.example"`. Each value must be an exact
`http://` or `https://` origin with no path, query, fragment, credentials, or
wildcard. Values are trimmed; duplicate or ambiguous origins are rejected at
startup. Restart the API after changing the setting.

Each allowlisted origin may call authenticated APIs with credentials. CORS does
not make media public: media ticket issuance still requires the authenticated
actor, and each stream URL is a short-lived actor/session-bound capability with
expiry, logout/session revocation, and file revalidation. Windows native desktop
uses this same browser transport for separate-origin profiles; Android, iOS, and
unsupported native hosts continue to require same-origin profiles.

Authenticated HTTP binds, including the default `0.0.0.0`, are supported. HTTP
media and bearer credentials remain exposed to interception, replay, and modification;
use HTTPS, a VPN/Tailscale network, or another trusted encrypted network when that
risk is unacceptable.

### Media compatibility and workbench qualification

The current media contract is v2 only: issue/revoke/logout require a UUIDv4
`mediaClientId`, responses advertise `session-cookie-v2`, and the stream path
never accepts a bearer token. The deterministic server/media tests and the
browser suite cover namespaced cookies, ticket binding, exact-origin fallback,
credentialed `HEAD`, Range/HEAD behavior, lifecycle cleanup, file-version
revocation, and old/v1 rejection.

Workbench integration qualification reconciled **3,504 passed / 9 skipped or ignored** across the release
ledger, including 1,416 Rust server tests, 209 UI browser tests, 24 live
two-server assertions, and four embedded browser assertions. The live harness
(`scripts/qualify-phase09-workbench.mjs`) creates isolated roots and repositories
for Server A (`127.0.0.1:14801`) and Server B (`127.0.0.1:14802`) and serves the
browser fixture on `127.0.0.1:15173`. It checks equal project/file names,
cross-server ticket rejection, selected-client revocation, and owner-specific
remote effects. The harness uses `--no-auth` only for deterministic fixture
checks; normal-auth suites remain required for actor isolation.

`packages/ui/vitest.browser.config.ts` binds the fixture/API server to port
`15173` with `strictPort: true` and accepts exactly one of `BROWSER_CHANNEL` or
`BROWSER_EXECUTABLE_PATH`. Reserve all fixture ports before launch and never
terminate an unrelated listener. Disable idle suspend and external telemetry in
fixtures; retain only sanitized evidence and delete temporary credentials/roots.

Deploy and roll back matching frontend/backend versions. A version-skewed
client must fail closed rather than revive capability-only URLs or a v1 cookie.
G2-Web is qualified; G2-Native remains blocked until real Windows S13 runtime,
SSH, WebView2/DPAPI, and Browser relay evidence is recorded. Old browser
layouts/history discarded by the fresh reset cannot be restored by rollback.

## Host resources SSE delivery and reverse proxy operations
The authenticated `GET /api/system/resources/v1/events` stream serves an eligible connected, visible profile. While a paired stream is LIVE it updates snapshot and metrics together; the existing REST endpoints remain the gated fallback. Operational runbooks and documentation do not replace target release qualification.
### Reverse proxy requirements
Buffering, caching, compression, and body transformation must be disabled for the SSE route at every proxy/CDN hop. Preserve `X-Accel-Buffering: no`; on Nginx use `proxy_buffering off`, `proxy_cache off`, `gzip off`, and `proxy_set_header Accept-Encoding ""` (the last disables upstream compression only; also disable downstream gzip/Brotli).
Set the upstream idle-read timeout to at least 45 s; status/keepalive bytes arrive at least every 15 s. HTTP/1.1 browsers commonly cap connections per origin and multiple SSE tabs can delay REST/WS traffic; HTTP/2 multiplexing mitigates this, but stage-test the actual deployed chain with HTTP/2 enabled and concurrent REST/WS requests.
**Nginx example** (4801 is the documented systemd API port; direct/Docker defaults to 4800. Match the actual `DAM_HOPPER_PORT`):
```nginx
location /api/system/resources/v1/events {
    proxy_pass http://127.0.0.1:4801;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Accept-Encoding "";
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 60s;
}
```

### Admission, capacity, and qualification gates
Each server process admits at most 32 live response bodies globally and 4 per authenticated subject. Rejections return HTTP `429` with `code: "HOST_RESOURCE_STREAM_LIMIT"` and `Retry-After: 30`; auth admission timeout/store failure returns `503 AUTH_UNAVAILABLE` after 2 s.
Independent auth supervision checks each body every 5 s (2 persisted reads/check): about 12.8 persisted reads/s at N=32 is a model, not observed load. No SSE setting is added; existing server-owned monitor cadences remain unchanged, REST fallback is 15 s snapshot/5 s visible-detail metrics, and history remains 30 s/coalesced.
The process inventory deadline is 150 ms; the 500 ms snapshot deadline is a wait, not a CPU or blocked-syscall bound. The default-cadence whole-monitor ≤2% one-core target requires the separate baseline monitor profiler; ten collector-only scans do not qualify it.
Before any target rollout, identify reference/weak Linux hosts and the deployed proxy, then close the applicable operational qualification gates: same-run optimized harness evidence vs separately attributed authenticated release-PID CPU/RSS, 30-minute soak, live Chromium/browser, and deployed-proxy verification. Active auth revocation and active backpressured HTTP/WS shutdown remain runtime gates. Missing metric producer/population is null+reason and blocked, never zero/green. Unsupported native targets stay on owner-bound REST and do not block a qualified Linux-web release. See [Host-Resource SSE Architecture](../architecture/host-resource-sse.md).
### Rollout and rollback
Roll forward only after applicable target gates pass: deploy the backend first so old clients continue REST snapshot/metrics and WS; then deploy the web bundle. A new client on an older backend treats `/events` 404/405 as REST-only. Verify the deployed proxy's buffering, compression, idle timeout, and HTTP version during staging.
Roll back artifacts, not a runtime flag: restore the prior REST/WS UI first, and refresh/close tabs running the new client so their active SSE bodies can close; then, only if needed, replace the backend with its prior artifact. New clients left loaded after backend rollback fall back to REST on 404/405.
Keep `/api/system/resources/v1/snapshot`, `/api/system/metrics`, host-alert/history and unread behavior, the non-resource WS bridge, monitor cadence/configuration, and separately authorized Force Machine to Sleep/idle-suspend behavior intact. On an auth/security violation stop the affected rollout and revert the client and/or backend artifact; never log bearer tokens or raw resource payloads.
### Shutdown bounds
On OS signal the server revokes SSE admission/emission immediately, bounds feature cleanup to ≤2 s, and forces accepted HTTP/WS I/O cancellation at signal+10 s. This bounds HTTP drain, not total process exit if a collector syscall blocks; later PTY cleanup remains ordered.

