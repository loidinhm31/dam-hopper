# Phase 03 — Explorer browser playback and direct-download UX

## Context links

- [Browser video UX research](./research/researcher-02-browser-video-ux-report.md)
- [Explorer video playback and download architecture](../../docs/system-architecture.md#explorer-video-playback-and-download-planned)
- [Shared browser-host architecture](../../docs/codebase-summary.md#project-overview)
- [Frontend naming and component standards](../../docs/code-standards.md#typescript-frontend-appsweb-appsnative-packagesui)
- Existing seams: [editor store](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/editor.ts), [file tier](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/file-tier.ts), [EditorTabs](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/EditorTabs.tsx), [LargeFileViewer](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/LargeFileViewer.tsx), [filesystem ops hook](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/hooks/use-fs-ops.ts), [server profiles](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/server-config.ts), [FileTree](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/FileTree.tsx)

## Overview

- Date: 2026-08-10
- Description: Route recognized Explorer videos to one native browser player and stream downloads through a separate temporary-anchor ticket without Blob buffering.
- Priority: P2
- Effort: 10h
- Implementation status: Completed (2026-08-10)
- Review status: Completed; browser UX/accessibility implementation and focused validation complete

## Key Insights

- Current tiering sends large video to `LargeFileViewer`; smaller video can invoke `fsRead` and base64 materialization. Extension-first routing must guard open, hydration, reload, and Git reconciliation.
- Existing Explorer download fetches then calls `response.blob()`. Recognized video needs native download navigation so bytes save as they arrive.
- Playback/download must snapshot the issuing server profile. Page origin may differ from the backend even in the browser host.
- A temporary anchor has no reliable completion callback. Remove it after activation but keep the download ticket valid; server expiry owns cleanup.

## Requirements

### Exact candidate routing

- Pure case-insensitive map only: `.mp4` → `video/mp4`, `.m4v` → `video/x-m4v`, `.webm` → `video/webm`, `.ogv`/`.ogg` → `video/ogg`, `.mov` → `video/quicktime`.
- Extension is a routing/MIME hint, not codec proof. No extension, double-extension mismatch, or any other suffix stays on existing non-video behavior.
- Extend `FileTier` with `video`; call `fileTier(name, size, isBinary)` and check candidate extension before binary/large/degraded/normal.
- First open, persisted-tab hydration, reload, save/force-overwrite, and Git mutation/project reconciliation must never call `fsRead` or write transport for a video tier.
- Persist stable tab metadata/tier only. `previewRevision` may be session-only; ticket, URL, expiry, media state, playback position, and errors never persist.

### Focused purpose-aware ticket client

- Add `issueVideoTicket(project, path, purpose, signal)` with closed `playback | download` type. Snapshot profile ID, normalized server origin, and current auth at call start.
- Issue with `credentials: include`, profile Bearer header when present, JSON body, `AbortSignal`, and bounded timeout.
- Validate echoed purpose and require `streamPath` to be a relative `/api/fs/video/stream/{opaque}` path; resolve against snapshotted server URL, never `location.origin`.
- Playback handle exposes in-memory `{ purpose: "playback", url, expiresAt, revoke() }`; revoke uses original profile/server auth and best-effort `keepalive`.
- Download handle exposes in-memory `{ purpose: "download", url, expiresAt }`. No immediate revoke after anchor click; expiry/workspace switch is authoritative.
- Errors contain fixed status/code only. Never expose ticket, stream URL, auth, raw path, or response body text.

### Native player lifecycle and fallback download

- `VideoPreview.tsx` renders one `<video controls preload="metadata" playsInline>` with no autoplay and no Blob/object URL.
- On mount/file/retry: abort prior issue, increment generation, tear down old source, issue playback ticket, then set source only if generation/profile remain current.
- On switch/unmount: `pause()`, remove `src`, call `load()` to cancel fetch, best-effort revoke playback ticket, and invalidate generation. Revoke stale playback results immediately.
- Accept media events only for matching generation and `currentSrc`. Model loading metadata, ready, buffering, seeking, and actionable error without announcing progress/time noise.
- Map network errors to Retry; decode/source errors to container/codec guidance. Fallback includes a Download button that issues a new `download` ticket and activates a temporary anchor independently from playback.
- Download start must not pause, replace, await, or reuse playback ticket. Multiple clicks have explicit pending disable/debounce to avoid ticket bursts.

### Explorer download and non-video Blob guard

- FileTree Download receives the selected node/path/size. If extension is one of the six candidates, issue `download` ticket and click a temporary anchor; do not fetch stream bytes in JavaScript.
- Anchor uses only the capability URL and server attachment policy; append, activate, then remove it. Do not set disposition or a client-chosen filename query.
- Keep current Blob flow only for known-safe small non-video files. Preserve the 100 MiB guard: known size above it fails before `fetch()`/`response.blob()` with actionable text.
- Unknown-size or recognized video must not silently enter a large Blob path. This guard remains narrow; generalized large non-video streaming is deferred.
- VideoPreview fallback and FileTree use the same direct-download helper and purpose-aware client.

### Browser UX, accessibility, and host scope

- Native controls, visible filename heading, descriptive `aria-label`, polite load/error live region, keyboard access, focus-visible styles, no focus theft, no auto-audio.
- Contain media with stable dark surface, `max-width`, `max-height`, and `object-contain`; support 320/375 px without horizontal overflow. Respect reduced motion.
- Only active EditorTabs content mounts VideoPreview, limiting decoder/network work to one video while a download may continue in browser manager.
- V1 release/test scope is `apps/web` browser host. Do not modify packaged-native configuration, add native plugins/permissions, or claim packaged Tauri support; record it only as deferred follow-up.

## Architecture

```text
FileTree node -> extension classifier -> editor tier=video -> VideoPreview
                                               |             -> playback ticket -> <video Range>
                                               + Download ---\
VideoPreview fallback Download ------------------------------+-> new download ticket
                                                              -> temporary anchor -> browser manager

small non-video -> existing guarded Blob flow
known large unsupported non-video -> fail before fetch/blob
```

- Keep classifier, purpose-aware ticket client, direct-download helper, and player separate and under 200 lines where practical.
- URLs/handles live only in component/helper closures. Playback cleanup never reaches a separate download handle.
- Reuse the same download starter from FileTree and player fallback; do not duplicate anchor or ticket logic.

## Related code files

| Absolute path | Action | Change | Dependencies |
|---|---|---|---|
| [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/video-file.ts](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/video-file.ts) | Create | Exact six-extension classifier and MIME hints | Mirrored server contract |
| [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/file-tier.ts](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/file-tier.ts) | Modify | Accept filename and route `video` before binary/size tiers | Classifier |
| [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/editor.ts](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/stores/editor.ts) | Modify | Skip reads/writes for video across open/hydrate/reload/reconcile; session-only preview revision | Updated tier |
| [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/video-tickets.ts](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/api/video-tickets.ts) | Create | Profile-snapshot purpose-aware issue/revoke client, abort/timeout, safe URL/error validation | `server-config.ts`; Phase 01 API |
| [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/start-video-download.ts](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/lib/start-video-download.ts) | Create | Issue download ticket and activate/remove temporary anchor without revoke/Blob | Ticket client; browser DOM |
| [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/VideoPreview.tsx](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/VideoPreview.tsx) | Create | Native player lifecycle, stale guards, status/error/a11y, fallback Download | Ticket client; download helper |
| [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/EditorTabs.tsx](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/EditorTabs.tsx) | Modify | Render VideoPreview before binary/large and exclude video from editor/save overlays | Store; player |
| [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/hooks/use-fs-ops.ts](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/hooks/use-fs-ops.ts) | Modify | Route recognized video to direct download; guard known >100 MiB non-video before Blob fetch | Classifier; download helper |
| [/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/FileTree.tsx](/mnt/data/ws/sharing/dam-hopper/packages/ui/src/components/organisms/FileTree.tsx) | Modify | Pass node path/name/size to purpose-aware download and show safe errors | Updated hook |

## Implementation Steps

1. Add classifier and mirrored contract tests first; keep extension map explicit and independent of arbitrary client MIME.
2. Update `fileTier` signature/call sites. For candidate video placeholders, set loading false immediately and skip transport.
3. Add video guards to save, force overwrite, restored `loadContent`, `reloadTab`, and both reconciliation paths; use session-only revision for clean refresh.
4. Implement ticket client with closed purpose, profile snapshot, AbortSignal/timeout, safe response validation, and playback-only revoke handle.
5. Implement shared direct-download starter: issue download purpose, build no-persist URL, create/click/remove anchor, never fetch/blob/revoke on click.
6. Implement VideoPreview generation guard and source teardown in one effect; revoke stale playback result and never touch download lifecycle.
7. Render native player/status/error actions; wire Retry and separate Download without custom media controls or codec probes.
8. Render VideoPreview only for active video tab; hide Monaco, diff/conflict, stale-save, and LargeFileViewer surfaces for it.
9. Route FileTree video Download through the shared helper. Keep small non-video Blob flow; fail known >100 MiB unsupported non-video before network.
10. Add Phase 04 unit/Chromium/browser-host coverage, then run UI typecheck, tests, build, and lint. Make no Tauri config change.

## Todo list

- [x] Add exact extension/container classifier
- [x] Route video before binary/large in every editor path
- [x] Add purpose-aware profile-snapshot ticket client
- [x] Add shared temporary-anchor direct-download helper
- [x] Add VideoPreview lifecycle, native controls, stale guards, and fallback Download
- [x] Wire FileTree video Download to separate ticket
- [x] Preserve only safe small non-video Blob download
- [x] Fail known large unsupported non-video before Blob allocation
- [x] Keep URLs/tickets memory-only and v1 browser-host only

## Success Criteria

- Selecting any 1–3 GB candidate extension opens VideoPreview immediately with zero `fsRead`, base64, Blob, object URL, or LargeFileViewer use.
- Playback source uses a playback ticket; fallback/FileTree download each use a fresh download ticket and temporary anchor. Either operation continues independently.
- Recognized video download starts browser-native transfer without `response.blob()`; anchor removal does not revoke the ticket.
- Rapid selection, retry, close, profile change, unmount, and delayed results cannot replace the active player or leak a persisted capability.
- Unsupported/corrupt codecs reach visible Retry/Download/external-player guidance; no autoplay or unhandled `play()` rejection.
- Known >100 MiB unsupported non-video fails before fetch/blob while safe small non-video download remains unchanged.
- Browser host is validated at 320/375/desktop widths; no packaged Tauri behavior is claimed or configured.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Extension recognized but codec unsupported | Playback fails | Visible codec state with separate direct Download; no compatibility promise |
| Stale async result wins | Wrong source/capability leak | Abort + generation + profile/currentSrc checks + stale playback revoke |
| Immediate revoke aborts native download | Partial/cancelled file | Never revoke on anchor cleanup; expiry is authoritative |
| Repeated download clicks consume capacity | 429/capability churn | Pending-state disable/debounce, clear feedback, server hard cap |
| Large unsupported non-video reaches Blob | Memory failure | Require known size at FileTree boundary and guard before fetch |

## Security Considerations

- Validate stream path is same snapshotted server and exact relative ticket route before URL construction; reject absolute/foreign paths and purpose mismatch.
- Never place ticket/source/download URL, auth, raw project path, or response body into Zustand, storage, logs, diagnostics, DOM text, or thrown errors.
- Revoke playback through original profile snapshot. Never send an old ticket to a newly active server or let playback cleanup revoke download.
- Use server `Content-Disposition` for download naming; client cannot override purpose or disposition.
- Browser v1 adds no native filesystem, shell, opener, HTTP plugin, CSP change, or host permission.

## Next steps

- Phase 04 proves purpose isolation, direct download without buffering, Chromium player/download behavior, sparse 3 GiB resource safety, and advisory benchmark reporting.

## Unresolved Questions

- None.
