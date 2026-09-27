# Diagnostic Report: Media Preview Failure on Project Target Mismatch & Status Endpoint Analysis

**Date:** 2026-09-19  
**Investigator:** MediaPreviewDebugger  
**Report File:** `plans/reports/debugger-260919-0054-media-preview-status-root-cause.md`

---

## 1. Executive Summary

### Issue Description
Opening or viewing media files (MP4 video or image files) in the editor fails when the project target is `dam-hopper1` (or after implementing/querying `GET /api/projects/dam-hopper1/status`). Video preview enters `Playback unavailable` accompanied by an amber `Unavailable target recovery` banner, while image preview enters `Image preview unavailable`.

### Root Cause
1. **Target Identity Mismatch:** The workspace project configured in `dam-hopper.toml` is registered as `dam-hopper` (derived from the repo root directory or workspace config). When queries or editor tabs use `dam-hopper1`, backend target resolution fails at `server/src/state.rs:workspace_target_project_path` with `AppError::WorkspaceTarget(WorkspaceTargetError::UnknownProject)`.
2. **Backend Error Code Emission Divergence:**
   - In `server/src/api/config.rs:get_project_status` and `server/src/api/fs_video.rs:issue_ticket`, resolution errors propagate via `ApiError::from_app` / `ApiError::from`, producing HTTP 404 with structured JSON:
     ```json
     { "error": "Workspace target error: Project not found", "code": "WORKSPACE_PROJECT_NOT_FOUND" }
     ```
   - In `server/src/api/fs_image.rs:issue_ticket`, resolution errors pass through `safe_resolution_error` (`fs_image.rs:197`), which coerces all 404 errors into `AppError::Fs(FsError::NotFound)`. This yields HTTP 404 with `{ "error": "File not found" }` stripped of any `code` property.
3. **Frontend Target Error Cascade (`VideoPreview`):**
   - `packages/ui/src/api/video-tickets.ts` parses the 404 payload and extracts `code: "WORKSPACE_PROJECT_NOT_FOUND"`.
   - In `packages/ui/src/components/organisms/VideoPreview.tsx:216`, `isProjectTargetError(code)` evaluates to `true` because `"WORKSPACE_PROJECT_NOT_FOUND"` is explicitly listed in `PROJECT_TARGET_ERROR_CODES` (`packages/ui/src/api/client.ts:105`).
   - `VideoPreview.tsx` fires `onTargetUnavailableRef.current?.()`, triggering `EditorTabs.tsx:handleActiveTargetUnavailable`.
   - `EditorTabs.tsx` executes `markTargetUnavailable` on `useEditorStore`, mutating the tab state to `targetAvailable: false`.
   - `EditorTabs.tsx:390` renders the alert banner: *"Unavailable target recovery: local edits from missing worktrees are preserved and writes stay disabled until the target returns"*, and the video preview displays `"Playback unavailable"`.
4. **Frontend Error Handling Divergence (`ImagePreview`):**
   - Because `fs_image.rs` strips the `code` field, `packages/ui/src/api/image-tickets.ts` falls back to `code: "HTTP_404"`.
   - In `ImagePreview.tsx:199`, `isProjectTargetError("HTTP_404")` returns `false`.
   - `onTargetUnavailableRef` is NOT called; however, `imageState` transitions to `"error"`, rendering `"Image preview unavailable"`.
5. **Role of `GET /api/projects/{name}/status`:**
   - Commit `8417c5f` updated `get_project_status` to use `state.resolve_project_target`. For `dam-hopper1`, it returns HTTP 404 with `code: "WORKSPACE_PROJECT_NOT_FOUND"`.
   - `useProjectStatus` in `packages/ui/src/api/queries.ts:480` does **not** call `markTargetUnavailable` or mutate editor stores. It fails silently in consumer components (`GitBranchControl`, `TerminalCommitStatusChip`, `ProjectInfoPanel`).
   - The media failure is directly caused by the same invalid project target name (`dam-hopper1`) being passed to the media ticket endpoints (`/api/fs/video/tickets` and `/api/fs/image/tickets`).

---

## 2. Architectural Analysis of Candidate Areas

### A. Route Collisions & Axum 0.8 Routing (`server/src/api/router.rs`)
- **Route Definitions:**
  - `GET /api/projects/{name}` (3 segments)
  - `GET /api/projects/{name}/status` (4 segments)
  - `POST/DELETE /api/fs/video/tickets` (4 segments)
  - `POST/DELETE /api/fs/image/tickets` (4 segments)
  - `GET/HEAD /api/fs/video/stream/{ticket}` (5 segments)
  - `GET/HEAD /api/fs/image/stream/{ticket}` (5 segments)
- **Evaluation:** Axum 0.8 segment-based match tree disambiguates route segment counts and exact match tokens cleanly. Adding `/api/projects/{name}/status` does not collide with or shadow `/api/fs/...` routes or `/api/projects/{name}`.
- **Verdict:** No route collision.

### B. Middleware Interference & Auth Boundaries
- `GET /api/projects/{name}/status` and `/api/fs/{video,image}/tickets` reside within protected router blocks guarded by `auth::require_auth`.
- Media streaming routes (`/api/fs/video/stream/{ticket}` and `/api/fs/image/stream/{ticket}`) bypass `require_auth` to support native browser `<img>` and `<video>` elements, using `mark_allowed_media_origin` middleware and cookie-based authorization within `media_stream_response::respond`.
- **Verdict:** No middleware interference between project status and stream routing.

### C. Media Session Cookies & Paths (`server/src/fs/media_session.rs`)
- Cookie path is strictly scoped: `pub(crate) const MEDIA_SESSION_PATH: &str = "/api/fs"`.
- Attributes: `HttpOnly; SameSite=Lax; Path=/api/fs; Max-Age=28800`.
- Cookie prefix: `damhopper-media-session-<client-id>`.
- Client requests to `/api/fs/video/tickets` and `/api/fs/image/tickets` receive `Set-Cookie` with `Path=/api/fs`. Subsequent streaming requests to `/api/fs/video/stream/{ticket}` match `/api/fs` and send the cookie.
- `GET /api/projects/{name}/status` does not touch or set any cookies.
- **Verdict:** No cookie path or duplicate cookie collision caused by project status.

### D. Concurrency & Lock Hierarchy (`workspace_context_guard`)
- `workspace_context_guard` is an `Arc<RwLock<()>>` protecting workspace reconfiguration / sandbox re-initialization.
- `fs_image::issue_ticket`, `fs_video::issue_ticket`, and `media_stream_response::respond` acquire a read lock (`.read().await`).
- `get_project_status` in `server/src/api/config.rs` calls `state.resolve_project_target` and `crate::git::get_status`. It acquires **no** lock on `workspace_context_guard`.
- **Verdict:** No lock contention or deadlock on `workspace_context_guard`.

### E. Frontend Target Error Cascades & Store Mutation
- **`useEditorStore.open` (`packages/ui/src/stores/editor.ts:569`):**
  - Media files are recognized by `fileTier` as `"video"` or `"image"`.
  - `isPreviewOnlyFile(optimisticTier, node.name)` evaluates to `true`.
  - The tab is created with `loading: false`, `targetAvailable: true`, and `tier: "video" | "image"`. No `fsRead` is dispatched.
- **`EditorTabs.tsx:206-212`:**
  - `activeIsVideo` and `activeIsImage` evaluate to `true`.
  - `<VideoPreview>` or `<ImagePreview>` is mounted with `onTargetUnavailable={handleActiveTargetUnavailable}`.
- **`VideoPreview.tsx:177` & Error Handling:**
  - Dispatches `issueVideoTicket(requestTarget, path, "playback")`.
  - On receiving HTTP 404 with `code: "WORKSPACE_PROJECT_NOT_FOUND"`, `isProjectTargetError(code)` matches.
  - Calls `onTargetUnavailableRef.current?.()`.
- **`EditorTabs.tsx:194` (`handleActiveTargetUnavailable`):**
  - Calls `markProjectTargetUnavailable(unavailableTarget)`.
  - Calls `useEditorStore.getState().markTargetUnavailable(unavailableTarget)`.
  - Mutates `tabs`: sets `targetAvailable: false` on matching target scope.
  - Triggers the alert banner at line 390.
  - Video preview sets `mediaState = "error"`, rendering `"Playback unavailable"`.

---

## 3. End-to-End Flow Comparison: `dam-hopper` vs `dam-hopper1`

| Step | Project `dam-hopper` (Configured) | Project `dam-hopper1` (Unconfigured / Mismatched) |
|---|---|---|
| **1. UI Tab Open** | Tab created for `dam-hopper`, `targetAvailable: true`, `loading: false` | Tab created for `dam-hopper1`, `targetAvailable: true`, `loading: false` |
| **2. Preview Mount** | `<VideoPreview>` / `<ImagePreview>` mounts with project `dam-hopper` | `<VideoPreview>` / `<ImagePreview>` mounts with project `dam-hopper1` |
| **3. Ticket Request** | `POST /api/fs/video/tickets` with `{"project": "dam-hopper", ...}` | `POST /api/fs/video/tickets` with `{"project": "dam-hopper1", ...}` |
| **4. Server Lookup** | `workspace_target_project_path("dam-hopper")` matches `cfg.projects` | `workspace_target_project_path("dam-hopper1")` fails -> `UnknownProject` |
| **5. Ticket Response (Video)** | HTTP 201 Created with `{ streamPath, ticket, ... }` + session cookie | HTTP 404 Not Found with `code: "WORKSPACE_PROJECT_NOT_FOUND"` |
| **6. Ticket Response (Image)** | HTTP 201 Created with `{ streamPath, ticket, ... }` + session cookie | HTTP 404 Not Found with `{"error":"File not found"}` (`safe_resolution_error` masks code) |
| **7. UI Error Catch (Video)** | N/A (proceeds to HEAD probe -> 200 OK -> playback) | `isProjectTargetError` matches -> `onTargetUnavailable` called |
| **8. UI Error Catch (Image)** | N/A (proceeds to HEAD probe -> 200 OK -> render) | `isProjectTargetError("HTTP_404")` false -> `imageState: "error"` |
| **9. Editor Tab State** | Tab remains available; media plays/renders | Tab marked `targetAvailable: false`; banner displayed; playback blocked |
| **10. Status Endpoint** | `GET /api/projects/dam-hopper/status` -> 200 OK (`GitStatus`) | `GET /api/projects/dam-hopper1/status` -> 404 (`WORKSPACE_PROJECT_NOT_FOUND`) |

---

## 4. Inconsistency in Backend Ticket Issuance

### Code Comparison

**Video Ticket Handler (`server/src/api/fs_video.rs:66-68`):**
```rust
let resolved = resolve(&state, &target_ref, &request.path)
    .await
    .map_err(ApiError::from)?;
```
- Retains original `AppError::WorkspaceTarget(WorkspaceTargetError::UnknownProject)`.
- HTTP Status: `404`.
- JSON Response Body:
  ```json
  {
    "error": "Workspace target error: Project not found",
    "code": "WORKSPACE_PROJECT_NOT_FOUND"
  }
  ```

**Image Ticket Handler (`server/src/api/fs_image.rs:169-203`):**
```rust
let resolved = resolve(state, target_ref, relative_path)
    .await
    .map_err(safe_resolution_error)?;

fn safe_resolution_error(error: AppError) -> ApiError {
    match error.status_code() {
        403 => ApiError::from(AppError::Fs(crate::fs::FsError::PathEscape)),
        503 => ApiError::from(AppError::Fs(crate::fs::FsError::Unavailable)),
        _ => ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)),
    }
}
```
- `error.status_code()` is `404`, hitting wildcard `_ => ApiError::from(AppError::Fs(FsError::NotFound))`.
- `AppError::Fs(FsError::NotFound)` has `api_code() == None`.
- HTTP Status: `404`.
- JSON Response Body:
  ```json
  {
    "error": "File not found"
  }
  ```

### Impact of Discrepancy
- For video, the backend exposes `WORKSPACE_PROJECT_NOT_FOUND`, allowing the frontend to identify target loss and engage editor tab recovery.
- For image, the backend sanitizes the error into a generic file 404, preventing the frontend from recognizing target loss. The image preview remains stuck in an unrecoverable error state without indicating that the target project itself is missing.

---

## 5. Verification & Code Traces

### Trace 1: Target Resolution Failure
```
GET /api/projects/dam-hopper1/status
  └─ config::get_project_status(name = "dam-hopper1")
       └─ state.resolve_project_target("dam-hopper1")
            └─ state.workspace_target_project_path("dam-hopper1")
                 └─ cfg.projects.iter().find(|p| p.name == "dam-hopper1") => None
                      └─ Err(AppError::WorkspaceTarget(WorkspaceTargetError::UnknownProject))
                           └─ ApiError::into_response => HTTP 404 { code: "WORKSPACE_PROJECT_NOT_FOUND" }
```

### Trace 2: Video Preview Cascade
```
User selects "clip.mp4" in project "dam-hopper1"
  └─ EditorTabs renders <VideoPreview project="dam-hopper1" ... />
       └─ issueVideoTicket({ project: "dam-hopper1" }, "clip.mp4", "playback")
            └─ POST /api/fs/video/tickets => HTTP 404 { code: "WORKSPACE_PROJECT_NOT_FOUND" }
                 └─ readMediaErrorCode => "WORKSPACE_PROJECT_NOT_FOUND"
                      └─ throws VideoTicketError("WORKSPACE_PROJECT_NOT_FOUND")
                           └─ VideoPreview.catch => isProjectTargetError("WORKSPACE_PROJECT_NOT_FOUND") == true
                                ├─ onTargetUnavailableRef() => EditorTabs.handleActiveTargetUnavailable()
                                │    ├─ markProjectTargetUnavailable({ project: "dam-hopper1" })
                                │    └─ useEditorStore.markTargetUnavailable({ project: "dam-hopper1" })
                                │         └─ tab.targetAvailable = false
                                │         └─ renders "Unavailable target recovery" banner
                                └─ setMediaState("error") => renders "Playback unavailable"
```

### Trace 3: Image Preview Cascade
```
User selects "image.png" in project "dam-hopper1"
  └─ EditorTabs renders <ImagePreview project="dam-hopper1" ... />
       └─ issueImageTicket({ project: "dam-hopper1" }, "image.png")
            └─ POST /api/fs/image/tickets
                 └─ fs_image::resolve_image_path => safe_resolution_error(UnknownProject)
                      └─ ApiError(AppError::Fs(FsError::NotFound)) => HTTP 404 { error: "File not found" }
                           └─ readMediaErrorCode => fallback "HTTP_404"
                                └─ throws ImageTicketError("HTTP_404")
                                     └─ ImagePreview.catch => isProjectTargetError("HTTP_404") == false
                                          └─ setImageState("error") => renders "Image preview unavailable"
```

---

## 6. Recommended Fixes (No Code Changes Applied)

1. **Align Project Identity Across Workspace & UI:**
   - Verify project registration in `dam-hopper.toml`. If the workspace project is named `dam-hopper`, UI selectors and status queries must use `dam-hopper`, not `dam-hopper1`.
   - When projects are discovered dynamically (e.g., directory renaming or cloning into `dam-hopper1`), update `dam-hopper.toml` or trigger workspace project discovery (`/api/workspace/discover`).

2. **Harmonize Ticket Resolution Error Handling:**
   - Update `server/src/api/fs_image.rs:safe_resolution_error` to preserve target errors (`AppError::WorkspaceTarget`) rather than collapsing them into generic `FsError::NotFound`:
     ```rust
     fn safe_resolution_error(error: AppError) -> ApiError {
         match &error {
             AppError::WorkspaceTarget(_) => ApiError::from_app(error),
             _ => match error.status_code() {
                 403 => ApiError::from(AppError::Fs(crate::fs::FsError::PathEscape)),
                 503 => ApiError::from(AppError::Fs(crate::fs::FsError::Unavailable)),
                 _ => ApiError::from(AppError::Fs(crate::fs::FsError::NotFound)),
             },
         }
     }
     ```
   - This ensures both image and video previews consistently emit `WORKSPACE_PROJECT_NOT_FOUND` when target projects disappear.

3. **Frontend Target Error Handling Consistency:**
   - In `packages/ui/src/components/organisms/ImagePreview.tsx`, ensure any structured project target error triggers `onTargetUnavailableRef` in the same manner as `VideoPreview.tsx`.

---

## 7. Unresolved Questions

1. **Origin of `dam-hopper1` Name:** Was `dam-hopper1` introduced through manual URL navigation, an out-of-sync multi-profile workbench state, or a directory rename on disk without updating `dam-hopper.toml`?
2. **Intentionality of `safe_resolution_error` in `fs_image.rs`:** Was `safe_resolution_error` designed to hide workspace target details for image tickets specifically (information leakage prevention), or was its omission in `fs_video.rs` an oversight during the worktree routing implementation (commit `8417c5f`)?
