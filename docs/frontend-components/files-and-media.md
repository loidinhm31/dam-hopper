# File and Media Components

Explorer decorations, image/video previews, and HTML preview details moved from the [component index](../frontend-components.md).
## Shared File Decorations

**Location:** `packages/ui/src/lib/file-decoration.ts`

**Purpose:** Central source of truth for file icons, badge text, display language, and Monaco language.

**Visible consumers:**

- `FileTree`
- `EditorTab`
- `SearchPanel`
- `FilePathLabel`

**Notes:**

- Exact filename lookup takes priority, then extension, then MIME, then neutral fallback.
- `file-decoration-icon.tsx` only renders the shared lookup result.
- Git change rows can reuse the same lookup for file identity while keeping VCS badges separate.

### Explorer Image Preview

**Locations:** `packages/ui/src/components/organisms/ImagePreview.tsx`,
`packages/ui/src/components/organisms/EditorTabs.tsx`,
`packages/ui/src/api/image-tickets.ts`, and `packages/ui/src/lib/image-file.ts`

The Explorer and editor route final, case-insensitive `png`, `jpg`, `jpeg`, `gif`,
and `webp` files to the native image preview tier before generic binary or large
file handling. SVG, AVIF, BMP, TIFF, dotfiles, diff tabs, and video tabs remain
outside this route; the dedicated diff viewer and video preview keep precedence.

`ImagePreview` issues a protected, preview-only capability using the captured
profile/generation owner and its UUIDv4 media client namespace. It assigns the
opaque stream URL directly to one native `<img>` with
`alt="Image preview: {fileName}"` after a credentialed `HEAD` probe and
`crossOrigin="use-credentials"`.
It does not call `fsRead`, `Response.blob()`, `URL.createObjectURL`, canvas APIs,
or a download action. Loading, ready, error, retry, stale-ticket, profile-change,
and unmount cleanup are visible lifecycle states. Cleanup removes the image
source before best-effort `RemoteCleanupHandle` revocation; stale async results
use the original owner/ticket handle rather than the current profile.

### Explorer Video Preview and Direct Download

**Locations:** `packages/ui/src/components/organisms/VideoPreview.tsx`,
`packages/ui/src/api/video-tickets.ts`, and
`packages/ui/src/lib/start-video-download.ts`

`VideoPreview` issues a playback-only media ticket for the captured
profile/generation owner and assigns its opaque URL directly to one native
`<video>` after a credentialed `HEAD` probe. It sets
`crossOrigin="use-credentials"` before assigning `src`; it does not read bytes
through `fsRead`, `Blob`, or `URL.createObjectURL`.

Playback and download are separate capabilities. The download action requests a
fresh `purpose: "download"` ticket, clicks a temporary hidden anchor, and
removes the anchor. It does not immediately revoke that ticket because the
browser owns the download lifecycle; normal ticket/session TTL and explicit
logout cleanup remain the safety boundary.

On teardown or profile/connection replacement, playback pauses, removes `src`,
calls `load()` to cancel the native request, and then invokes its captured
`RemoteCleanupHandle`. Concurrent cleanup is bounded and deduplicated; stale
async playback results are revoked through the owner that issued them. Browser
coverage exercises profile isolation, mount/unmount, delayed stale streams, and
direct playback/download behavior.

Editor open, hydration, save, force-overwrite, reload, and Git reconciliation
preserve image tabs as preview-only. Legacy persisted image tabs are normalized
before they can enter a text/binary read path, and status overlays report
capability or stream failures without materializing image bytes.

### Explorer HTML Preview

**Locations:** `packages/ui/src/components/organisms/HtmlHost.tsx`,
`packages/ui/src/components/organisms/HtmlPreview.tsx`,
`packages/ui/src/components/organisms/EditorTabs.tsx`,
`packages/ui/src/components/organisms/TreeContextMenu.tsx`,
`packages/ui/src/components/organisms/FileTree.tsx`,
`packages/ui/src/lib/html-file.ts`,
`packages/ui/src/lib/html-preview-transform.ts`, and
`packages/ui/src/lib/html-view-mode-persistence.ts`.

Provides file detection, presentation persistence, editor host routing, context menu preview actions, and sandboxed preview rendering for HTML documents:

- **Detection (`html-file.ts`):** Identifies `.html`, `.htm`, and `.xhtml` case-insensitively, maps to standard HTML/XHTML MIME types (`text/html`, `application/xhtml+xml`), and checks preview candidate suitability (excluding diff, large, and binary tabs). Dotfiles without a base name (e.g. `.html`) are excluded.
- **View Mode Persistence (`html-view-mode-persistence.ts`):** Manages user view mode selection (`"edit" | "split" | "preview"`) via browser `localStorage` key `dam-hopper:html-view-mode:v1`, defaulting to `"edit"`. Storage access is safe and resilient to exceptions or unavailable storage environments. Dispatches the `dam-hopper:html-view-mode-changed` (`HTML_VIEW_MODE_CHANGED_EVENT`) window event on save, enabling live synchronization across mounted tabs without requiring a remount or page reload.
- **Sandboxed Rendering (`HtmlPreview.tsx` & `html-preview-transform.ts`):**
  Renders HTML content inside a sandboxed `<iframe>` with
  `sandbox="allow-scripts allow-modals allow-forms allow-popups allow-pointer-lock"`.
  Omission of `allow-same-origin` gives the document an opaque origin (`"null"`),
  preventing access to parent cookies and storage; network requests remain
  subject to browser/CORS policy. Updates to editor content are debounced by
  200ms to avoid DOM thrashing, and an explicit reload control enables forced
  remounting of the iframe. To ensure embedded `<script>` tags and standard
  interactions work reliably in the sandboxed preview without fatal security
  exceptions, `prepareHtmlPreviewContent` injects non-invasive shims:
  - **In-Memory Storage Shim:** Provides an in-memory `localStorage` and
    `sessionStorage` fallback when native access throws `SecurityError` under
    the `null` origin, allowing scripts with storage calls to execute smoothly.
  - **In-Frame Visual Alert Modal:** Intercepts `window.alert()` to render an
    in-frame visual dismissible modal dialog, overcoming modern browser
    suppression of native dialogs in cross-origin sandboxed frames.
- **Editor Host (`HtmlHost.tsx`):** Split-view HTML editor component offering an **Edit | Split | Preview** top toggle bar. Lazily imports `MonacoHost` to keep initial bundle size lean. Listens to `HTML_VIEW_MODE_CHANGED_EVENT` to react dynamically to external mode changes, while supporting an optional `initialMode` prop override (e.g., when launched into preview mode from an Explorer context menu action) and defaulting to user preference loaded from `dam-hopper:html-view-mode:v1`.
  - **Edit Mode:** 100% width Monaco code editor.
  - **Split Mode:** 50% left Monaco editor with divider border, 50% right `HtmlPreview`.
  - **Preview Mode:** 100% width sandboxed `HtmlPreview`.
  - Seamlessly forwards editor lifecycle properties (`tabKey`, `path`, `content`, `tier`, `mime`, `viewState`, `readOnly`, `onChange`, `onSave`, `onViewStateChange`, `lineChanges`, `onGitIndicatorClick`).
- **EditorTabs Routing (`EditorTabs.tsx`):** Detects HTML files via `isHtmlFile(activeTab.name)` before fallback MonacoHost, dynamically loading `HtmlHost` inside a `Suspense` boundary with a centered loading spinner fallback.
- **Explorer Context Menu Integration (`TreeContextMenu.tsx` & `FileTree.tsx`):** Exposes a dedicated "Preview" action with an `Eye` icon in the right-click context menu for HTML files.
  - **5 MiB Size Threshold:** Restricted strictly to files smaller than 5 MiB
    (`node.size < 5 * 1024 * 1024`). Files at or above 5 MiB, directories, and
    non-HTML files omit the preview item to avoid memory and performance
    degradation in the iframe.
  - **Action Flow:** Clicking "Preview" calls `saveHtmlViewMode("preview")`, which emits `HTML_VIEW_MODE_CHANGED_EVENT` and invokes `onFileOpen(node)`, opening the document directly into Preview mode or live-switching an existing active tab.


