# Diagnostic Report: Video Playback Ticket Failure in Editor View

**Date:** 2026-09-19  
**Investigator:** VideoPlaybackDebugger  
**Report File:** `plans/reports/debugger-260919-0152-video-playback-ticket-failure.md`  

---

## 1. Executive Summary

### Issue Description
User curl command to `http://100.91.26.60:4803/api/git/clickstream/diff/file?path=WORKING+HARD+IS+DEFINITELY+A+TALENT+-+SIR+ALEX.mp4` succeeds with `{"path": "WORKING HARD IS DEFINITELY A TALENT - SIR ALEX.mp4", "isBinary": true}`.
However, in Editor view UI, video component fails with:
`"A playback ticket could not be issued. Retry or download it directly."`

### Root Cause Identification
Two distinct root causes explain the discrepancy:

1. **Primary Root Cause (Suspect A - Vite Proxy Misdirection to Release v0.3.1 on Port 4801):**
   - User accessed UI via Vite dev server at `http://100.91.26.60:5173`.
   - `apps/web/vite.config.ts:20` proxies `/api` and `/ws` to `http://127.0.0.1:4801` by default when `VITE_DAM_HOPPER_SERVER_URL` unset.
   - Server on 4801 is release `v0.3.1` (PID 1671) with `/var/lib/dam-hopper/dam-hopper.toml`.
   - Server on 4801 fails `POST /api/fs/video/tickets` across 4 distinct layers:
     a. Requires authentication -> returns `HTTP 401 Unauthorized`.
     b. Rejects request payload with `HTTP 422 Unprocessable Entity` because v0.3.1 has `#[serde(deny_unknown_fields)]` and frontend sends new Phase 07 `mediaClientId` field.
     c. `/var/lib/dam-hopper/dam-hopper.toml` does not contain `clickstream` project -> returns `HTTP 404 Project Not Found`.
     d. v0.3.1 returns `authorizationMode: "session-cookie-v1"`, rejected by frontend `assertMediaSessionAuthorizationMode` expecting `session-cookie-v2`.
   - User curl succeeded because curl was pointed directly to **port 4803** (debug server running with `--no-auth` and `clickstream` configured in `~/.config/dam-hopper/dam-hopper.toml`).

2. **Secondary Contributing Cause (Suspect B - Query String vs JSON Body Path Encoding):**
   - User's curl targeted `/api/git/clickstream/diff/file?path=WORKING+HARD+IS+DEFINITELY+A+TALENT+-+SIR+ALEX.mp4`.
   - Axum's `Query` extractor parses URL query string via `serde_urlencoded`, which decodes `+` into literal space `' '`. Hence `get_file_diff` found the file on disk.
   - `POST /api/fs/video/tickets` consumes a JSON body. JSON string parsers do **not** convert `+` to space.
   - If tab path or ticket request passes `WORKING+HARD+IS+DEFINITELY+A+TALENT+-+SIR+ALEX.mp4` with `+`, `server/src/api/fs.rs:resolve` attempts to open a file with literal `+` in filename, failing with `HTTP 404 Not Found: FS error: not found`.

3. **Suspect C (CORS / Probe Failure) Disproved:**
   - Server on 4803 has `http://100.91.26.60:5173` in allowed CORS origins.
   - CORS preflight and `HEAD /api/fs/video/stream/{ticket}` both succeed without cookie because `AllowedMediaOrigin` extension enables `allow_ticket_only: true`.
   - If Suspect C failed, frontend error would be `"Browser media access is unavailable"`, not `"A playback ticket could not be issued. Retry or download it directly."`.

---

## 2. Technical Analysis

### 2.1 UI Error Propagation Pipeline
In `packages/ui/src/components/organisms/VideoPreview.tsx`:
```ts
void issueVideoTicket(requestTarget, path, "playback", controller.signal)
  .catch((error: unknown) => {
    setMediaState("error");
    const mediaCode = mediaTicketErrorCode(error);
    setTicketErrorCode(mediaCode);
    setTicketErrorAction(mediaCode ? "playback" : null);
    setErrorMessage(
      mediaCode
        ? mediaTicketErrorCopy[mediaCode].title
        : "A playback ticket could not be issued. Retry or download it directly.",
    );
  });
```
In `VideoPreview.tsx:67-70`:
```ts
function mediaTicketErrorCode(error: unknown): MediaTicketErrorCode | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const { code } = error as { code?: unknown };
  return code === "MEDIA_SESSION_UNSUPPORTED" ? code : null;
}
```
Observation:
- If `error.code === "MEDIA_SESSION_UNSUPPORTED"`, message is `"Browser media access is unavailable"` (`mediaTicketErrorCopy.MEDIA_SESSION_UNSUPPORTED.title`).
- Any other error (`HTTP_401`, `HTTP_422`, `HTTP_404`, `INVALID_RESPONSE`, `NETWORK`, `TIMEOUT`) produces `mediaCode = null`.
- `errorMessage` is therefore set to `"A playback ticket could not be issued. Retry or download it directly."`.

### 2.2 Suspect A: Port 4801 vs Port 4803 Routing Split
Running process inspection:
- Port 4801 (PID 1671): `/opt/dam-hopper/releases/v0.3.1/both/bin/dam-hopper-server --config /var/lib/dam-hopper/dam-hopper.toml --host 0.0.0.0 --port 4801`
- Port 4803 (PID 804587): `target/debug/dam-hopper-server --host 0.0.0.0 --port 4803 --no-auth`
- Port 5173 (PID 326582): `node .../vite.js --host 0.0.0.0`

Vite dev proxy (`apps/web/vite.config.ts:13-21`):
```ts
const env = loadEnv(mode, process.cwd(), "");
const configuredBackend = env.VITE_DAM_HOPPER_SERVER_URL?.replace(/\/$/, "");
const backend = configuredBackend || "http://127.0.0.1:4801";
```
Because `VITE_DAM_HOPPER_SERVER_URL` was not passed to Vite dev server, Vite proxies all `/api` requests to `127.0.0.1:4801`.

Comparing Port 4801 vs 4803 capabilities:
| Feature / Check | Port 4801 (Release v0.3.1) | Port 4803 (Debug build) |
|---|---|---|
| Project `clickstream` | Missing in `/var/lib/dam-hopper/dam-hopper.toml` | Present in `~/.config/dam-hopper/dam-hopper.toml` |
| Auth required | Yes (`HTTP 401 Unauthorized`) | No (`--no-auth` flag) |
| `mediaClientId` in `IssueVideoTicketRequest` | Rejected (`422 Unprocessable Entity`, `deny_unknown_fields`) | Accepted (`UUIDv4`) |
| `authorizationMode` | `"session-cookie-v1"` | `"session-cookie-v2"` |

Experimental verification via curl:
```bash
# Request to Vite proxy on 5173 (proxied to 4801):
curl -i -s -X POST "http://127.0.0.1:5173/api/fs/video/tickets" \
  -H "Content-Type: application/json" \
  -d '{"project":"clickstream","path":"WORKING HARD IS DEFINITELY A TALENT - SIR ALEX.mp4","purpose":"playback","mediaClientId":"a0000000-0000-4000-8000-000000000000"}'
# Response: HTTP/1.1 401 Unauthorized {"error":"Unauthorized"}

# Direct request to 4803:
curl -i -s -X POST "http://127.0.0.1:4803/api/fs/video/tickets" \
  -H "Content-Type: application/json" \
  -d '{"project":"clickstream","path":"WORKING HARD IS DEFINITELY A TALENT - SIR ALEX.mp4","purpose":"playback","mediaClientId":"a0000000-0000-4000-8000-000000000000"}'
# Response: HTTP/1.1 201 Created {"ticket":"...","streamPath":"...","authorizationMode":"session-cookie-v2"}
```

In frontend, `readMediaErrorCode` receives `{"error": "Unauthorized"}`, finds no `code` property, and returns fallback `"HTTP_401"`. `VideoPreview` displays `"A playback ticket could not be issued. Retry or download it directly."`.

### 2.3 Suspect B: URL Query Parameter Encoding (`+`) vs JSON Body
The user's curl command was:
```bash
curl --url 'http://100.91.26.60:4803/api/git/clickstream/diff/file?path=WORKING+HARD+IS+DEFINITELY+A+TALENT+-+SIR+ALEX.mp4'
```
Why this succeeded on 4803:
- In `server/src/api/git_diff.rs:103`:
  `pub async fn get_file_diff(State(state), Path(project), Query(q): Query<FilePathQuery>)`
- Axum `Query` extractor parses URL query string with `serde_urlencoded`. Under `x-www-form-urlencoded` spec, `+` represents space `' '`.
- Axum decoded `q.path` to `"WORKING HARD IS DEFINITELY A TALENT - SIR ALEX.mp4"`.
- Backend opened the file, confirmed binary status, and returned:
  `{"path":"WORKING HARD IS DEFINITELY A TALENT - SIR ALEX.mp4","language":"plaintext","hunks":[],"lineChanges":[],"isBinary":true}`.

Contrast with `POST /api/fs/video/tickets`:
- Endpoint uses `Json(request): Json<IssueVideoTicketRequest>`.
- JSON string values preserve `+` verbatim.
- In `server/src/api/fs.rs:resolve`:
  `let proposed = target.target_path().join(rel_path);`
- If `rel_path` is `"WORKING+HARD+IS+DEFINITELY+A+TALENT+-+SIR+ALEX.mp4"`, `proposed` is `/home/loidinh/WS/clickstream/WORKING+HARD+IS+DEFINITELY+A+TALENT+-+SIR+ALEX.mp4`.
- File does not exist on disk with literal `+`.
- Returns `HTTP 404 Not Found` with `{"error": "FS error: not found"}`.

Experimental verification via curl on 4803:
```bash
curl -i -s -X POST "http://127.0.0.1:4803/api/fs/video/tickets" \
  -H "Content-Type: application/json" \
  -d '{"project":"clickstream","path":"WORKING+HARD+IS+DEFINITELY+A+TALENT+-+SIR+ALEX.mp4","purpose":"playback","mediaClientId":"a0000000-0000-4000-8000-000000000000"}'
# Response: HTTP/1.1 404 Not Found {"error":"FS error: not found"}
```
In frontend, `readMediaErrorCode` returns fallback `"HTTP_404"`. `VideoPreview` displays `"A playback ticket could not be issued. Retry or download it directly."`.

### 2.4 Suspect C: Cross-Origin CORS / Cookie / Probe Evaluation
Tested CORS configuration on port 4803:
- Origin `http://100.91.26.60:5173` is explicitly allowed by port 4803 (`access-control-allow-origin: http://100.91.26.60:5173`).
- In `server/src/api/router.rs:509-518`, `mark_allowed_media_origin` inspects `state.origin_is_allowed(headers)`.
- Because origin matches `cors_origins`, `AllowedMediaOrigin` extension is inserted.
- In `server/src/api/fs_video.rs:167`, `allowed_origin.is_some()` sets `allow_ticket_only: true`.
- In `server/src/fs/media_ticket.rs:480-483`, when `allow_ticket_only` is true, ticket authorization succeeds even if cookie is absent.

Experimental verification on 4803:
```bash
curl -i -s -I "http://127.0.0.1:4803/api/fs/video/stream/<TICKET>" \
  -H "Origin: http://100.91.26.60:5173"
# Response: HTTP/1.1 200 OK
# accept-ranges: bytes
# content-type: video/mp4
# content-length: 5264301
# access-control-allow-origin: http://100.91.26.60:5173
```
Probe succeeds cross-origin when origin is `http://100.91.26.60:5173`. Suspect C is not the cause of the failure.

---

## 3. Actionable Recommendations

### Recommendation 1: Point Vite Dev Proxy to Active Backend
When running Vite dev server alongside debug backend:
- Start Vite with `VITE_DAM_HOPPER_SERVER_URL=http://127.0.0.1:4803 pnpm dev` or configure in `.env.local`:
  ```bash
  VITE_DAM_HOPPER_SERVER_URL=http://127.0.0.1:4803
  ```
- Alternatively, update `apps/web/vite.config.ts` fallback port to match active development backend if port 4801 is reserved strictly for installed release service.

### Recommendation 2: Add or Switch Server Profile in UI
If accessing UI via port 5173 without changing Vite proxy:
- Open UI Server Profiles (`TopNav` -> `Server Profiles`).
- Add profile for `http://100.91.26.60:4803` with auth type `none`.
- Set profile active. Frontend will route API and media ticket requests directly to `http://100.91.26.60:4803`.

### Recommendation 3: Sanitize Path Decoding on Tab Creation
Ensure paths coming from URL search parameters, diff parameters, or git status are decoded before being stored in tab state:
- If a path originates from `URLSearchParams.get("path")`, it is already decoded; however, if extracted from raw query string or encoded paths, ensure `decodeURIComponent(path.replace(/\+/g, " "))` is applied before passing to `useEditorStore.open` or `issueVideoTicket`.

---

## 4. Supporting Evidence

### Evidence 1: Running Server Port Mismatch
```
Port 4801 (PID 1671): release v0.3.1 binary running under systemd with /var/lib/dam-hopper/dam-hopper.toml
Port 4803 (PID 804587): debug build running from source with ~/.config/dam-hopper/dam-hopper.toml --no-auth
Port 5173 (PID 326582): vite dev server proxying /api -> http://127.0.0.1:4801 (hardcoded default in apps/web/vite.config.ts)
```

### Evidence 2: Workspace Project Inventory Divergence
`/var/lib/dam-hopper/dam-hopper.toml` (Port 4801):
- Projects: `dam-hopper`, `evcrate`, `robo-fleet-dora-rs`, `glean-hub`, `aicoworker`, `eigen-air`, `host-configure`, `oh-my-pi`.
- `clickstream` is absent.

`~/.config/dam-hopper/dam-hopper.toml` (Port 4803):
- Projects: `clickstream` (`/home/loidinh/WS/clickstream`), `dam-hopper`, `glean-hub`, `nonclaw`, `robo-fleet-dora-rs`.
- `clickstream` is present.

### Evidence 3: Path `+` vs Spaces on Port 4803
```
POST /api/fs/video/tickets with "path": "WORKING HARD IS DEFINITELY A TALENT - SIR ALEX.mp4"
=> HTTP 201 Created (valid ticket returned)

POST /api/fs/video/tickets with "path": "WORKING+HARD+IS+DEFINITELY+A+TALENT+-+SIR+ALEX.mp4"
=> HTTP 404 Not Found: {"error":"FS error: not found"}

GET /api/git/clickstream/diff/file?path=WORKING+HARD+IS+DEFINITELY+A+TALENT+-+SIR+ALEX.mp4
=> HTTP 200 OK: {"path":"WORKING HARD IS DEFINITELY A TALENT - SIR ALEX.mp4","isBinary":true}
```

---

## 5. Unresolved Questions

1. Was the Editor tab opened via the Explorer tree (which populates unencoded spaces from `/api/fs/list`), or via a URL/deep-link containing `+` encoded parameters?
2. Is port 4801 intended to remain running as a systemd service while local frontend development is pointing to port 4803, or should `dam-hopper-api.service` be stopped during local development?
