# Phase 01 — Purpose-bound ticket store and issuance

## Context links

- [HTTP range research](./research/researcher-01-http-range-streaming-report.md)
- [Browser video UX research](./research/researcher-02-browser-video-ux-report.md)
- [Codebase summary](../../docs/codebase-summary.md)
- [Code standards](../../docs/code-standards.md)
- [Explorer video playback and download architecture](../../docs/system-architecture.md#explorer-video-playback-and-download-planned)
- [Project PDR: filesystem sandbox](../../docs/project-overview-pdr.md#pr-004-ide-file-explorer-phase-01)
- Existing seams: [filesystem API](/mnt/data/ws/sharing/dam-hopper/server/src/api/fs.rs), [router](/mnt/data/ws/sharing/dam-hopper/server/src/api/router.rs), [state](/mnt/data/ws/sharing/dam-hopper/server/src/state.rs), [filesystem subsystem](/mnt/data/ws/sharing/dam-hopper/server/src/fs/mod.rs), [workspace switch](/mnt/data/ws/sharing/dam-hopper/server/src/api/workspace.rs)

## Overview

- Date: 2026-08-10
- Description: Add authenticated issuance and lifecycle management for immutable playback/download capabilities bound to one versioned sandbox resource.
- Priority: P2
- Effort: 7h
- Implementation status: Completed — 2026-08-10
- Review status: Approved — 9.5/10 final review; no critical issues

## Key Insights

- Native media and browser download navigation cannot safely attach a profile Bearer header, so authenticated issuance must exchange credentials for a narrow opaque capability.
- Playback and download need separate tickets because response disposition is authorization policy, not a client-selected query option.
- Browser download completion has no reliable page callback. Do not revoke immediately after clicking the anchor; idle/absolute expiry is authoritative.
- Full-file hashing delays 1–3 GB opens. Bind canonical identity plus handle metadata and revalidate on every stream request.

## Requirements

### Ticket API and purpose

- `POST /api/fs/video/tickets` remains behind `require_auth`; camelCase body is exactly `{ project, path, purpose }`, where purpose deserializes only as `playback | download`.
- Purpose is immutable, stored server-side, and absent from stream query parameters. A playback ticket can only produce `inline`; a download ticket can only produce `attachment`.
- Resolve configured project + relative path through `ProjectSandbox`; require a regular file and one case-insensitive extension from `.mp4`, `.m4v`, `.webm`, `.ogv`, `.ogg`, `.mov`.
- Generate 32 random bytes with existing `OsRng`, encode URL-safe without padding, retry a collision, and never derive the capability from JWT/profile data.
- Return `201` JSON `{ ticket, streamPath, expiresAt, purpose }` plus `Cache-Control: no-store`. `streamPath` contains only the opaque ticket; echoed purpose is the parsed server enum.
- Authenticated `DELETE /api/fs/video/tickets` accepts `{ ticket }`, is idempotent, returns `204`, and never places a ticket in a revoke URL.

### Store lifecycle and capacity

- One memory-only store holds both purposes; restart/shutdown revokes all tickets.
- Hard cap: 256 live tickets total. Prune expired entries before issue; when still full return `429 VIDEO_TICKET_CAPACITY` and `Retry-After: 1`. Never evict a live ticket.
- Idle expiry is 30 minutes; absolute lifetime is 8 hours from issuance. Successful `GET`/`HEAD` lookup refreshes idle expiry, capped by absolute expiry.
- Playback cleanup and explicit user cancellation may best-effort revoke only that playback ticket. Download navigation does not revoke on anchor cleanup because the response may still be active.
- Playback and download for the same file can coexist, touch, expire, and revoke independently. One purpose's lifecycle cannot mutate the other's record.
- Workspace init/switch revokes all tickets before replacing sandbox/config state. Resource or canonical-path drift revokes only the affected ticket during Phase 02 lookup.

### Resource binding and privacy

- `VideoTicketRecord` stores purpose, project identifier, project-relative path, canonical path, media MIME, original filename, size, exact modified time, opaque validator, and platform file identity when available.
- Filename and MIME are server-derived hints. Record is never serialized wholesale; canonical/project-relative paths never appear in responses, diagnostics, metrics, or logs.
- Unknown, expired, and revoked tickets use the same generic lookup result. Capacity and prune behavior must be deterministic under an injected clock.

## Architecture

```text
authenticated POST(project,path,purpose)
  -> existing sandbox resolver -> regular allowlisted file metadata
  -> VideoStreamTicketStore[opaque id] = { immutable purpose, resource version }

playback ticket ----\
                     +-> independent lookup/touch/revoke -> Phase 02 shared stream
download ticket ----/
```

- `VideoStreamTicketStore` is a cheap-clone `Arc<Mutex<Inner>>`; lock sections only insert, prune, lookup/touch, revoke, or revoke-all and never cross `.await`.
- `fs_video.rs` owns wire types and handlers; `video_ticket.rs` owns purpose, record, capacity, and clock-driven lifecycle. Keep modules under 200 lines where practical.
- `AppState::new` initializes the store internally so existing construction sites need no new external dependency.

## Related code files

| Absolute path | Action | Change | Dependencies |
|---|---|---|---|
| [/mnt/data/ws/sharing/dam-hopper/server/src/fs/video_ticket.rs](/mnt/data/ws/sharing/dam-hopper/server/src/fs/video_ticket.rs) | Create | Purpose enum, resource/version record, random token, 256-cap store, 30m/8h expiry, independent revoke/prune | Existing `rand`, `base64`; Phase 02 lookup |
| [/mnt/data/ws/sharing/dam-hopper/server/src/fs/mod.rs](/mnt/data/ws/sharing/dam-hopper/server/src/fs/mod.rs) | Modify | Export focused ticket types without coupling generic reads to streaming | `video_ticket.rs` |
| [/mnt/data/ws/sharing/dam-hopper/server/src/state.rs](/mnt/data/ws/sharing/dam-hopper/server/src/state.rs) | Modify | Add and internally initialize `video_stream_tickets` | FS export |
| [/mnt/data/ws/sharing/dam-hopper/server/src/api/fs.rs](/mnt/data/ws/sharing/dam-hopper/server/src/api/fs.rs) | Modify | Expose sandbox resolver narrowly to sibling FS handlers | Existing `ProjectSandbox` behavior |
| [/mnt/data/ws/sharing/dam-hopper/server/src/api/fs_video.rs](/mnt/data/ws/sharing/dam-hopper/server/src/api/fs_video.rs) | Create | Purpose-aware issue/revoke shapes, extension checks, opaque responses | Store, shared resolver |
| [/mnt/data/ws/sharing/dam-hopper/server/src/api/mod.rs](/mnt/data/ws/sharing/dam-hopper/server/src/api/mod.rs) | Modify | Register focused video API module | `fs_video.rs` |
| [/mnt/data/ws/sharing/dam-hopper/server/src/api/router.rs](/mnt/data/ws/sharing/dam-hopper/server/src/api/router.rs) | Modify | Add authenticated ticket issue/revoke routes; reserve capability stream route | Existing auth middleware; Phase 02 |
| [/mnt/data/ws/sharing/dam-hopper/server/src/api/workspace.rs](/mnt/data/ws/sharing/dam-hopper/server/src/api/workspace.rs) | Modify | Revoke all tickets before workspace init/switch commits new state | AppState store |

## Implementation Steps

1. Define closed `VideoTicketPurpose` and constants for six extensions, 256 capacity, 30-minute idle, and 8-hour absolute lifetime.
2. Implement clock-injected store using `Instant` for decisions; use epoch milliseconds only for response `expiresAt`.
3. Implement prune-before-issue, collision retry, lookup-and-touch, purpose-preserving clone, idempotent revoke, and revoke-all under short mutex sections.
4. Build `VideoFileVersion` from open-handle metadata: size, exact `SystemTime`, and Unix `dev`/`ino` when available. Never hash media content.
5. Make current resolver `pub(super)` only; do not introduce arbitrary absolute-path input.
6. Implement issue validation in order: auth middleware, purpose parse, sandbox resolve, allowlisted extension, open/stat regular file, capture identity, insert.
7. Return only opaque fields and generic structured errors. Add authenticated body-based revoke.
8. Revoke all tickets before both workspace init and switch replace filesystem context.
9. Add store/API tests for both purposes, independent lifecycle, capacity, expiry boundaries, unsupported purpose/extension, and privacy.

## Todo list

- [x] Add immutable playback/download purpose enum
- [x] Add memory-only 256-entry store with fixed expiry policy
- [x] Add cross-platform resource version record
- [x] Add authenticated purpose-aware issue/revoke API
- [x] Reuse sandbox resolver and exact six-extension contract
- [x] Revoke all before workspace context changes
- [x] Prove independent lifecycle and generic unknown behavior
- [x] Verify ticket/path/auth data never reaches persistence or diagnostics

## Success Criteria

- Authenticated issuance for each purpose returns a distinct opaque capability bound to one allowlisted regular workspace file and exact server-parsed purpose.
- Playback and download tickets for the same resource coexist and revoke/expire independently; no API can change their purpose or disposition.
- Store never exceeds 256 live records, never evicts a live record, and applies exactly 30-minute idle plus 8-hour absolute expiry.
- Unknown, expired, and revoked lookups are indistinguishable; workspace switch invalidates all prior tickets.
- Traversal, symlink escape, directory, missing file, unsupported purpose, and any extension outside the six candidates create no ticket.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Capability leaks via DOM/devtools | Scoped file access until expiry | 256-bit random token, one resource/purpose, no persistence/logging, fixed lifetime |
| Download tickets linger after completion | Capacity pressure | 30-minute idle prune is authoritative; 256 cap returns explicit retry; no unsafe early revoke |
| Same-size/same-mtime replacement evades portable version | Wrong bytes under old ticket | Exact time + canonical identity + Unix file identity; document residual without 3 GB hash |
| Workspace change races issuance | Old-context access | Revoke-all before state replacement; Phase 02 always revalidates current sandbox |

## Security Considerations

- Treat ticket as bearer capability. Never trace ticket values, request bodies, stream URLs, JWTs, project-relative paths, canonical paths, or filenames from rejected input.
- Authentication precedes issue/revoke filesystem work. Stream authorization begins with opaque lookup before revealing resource metadata.
- Purpose is an enum inside the record, not a query/header chosen at stream time; a leaked playback URL cannot request attachment behavior.
- MIME/extension only choose candidate handling. Sandboxed regular-file identity remains the authorization boundary.
- Keep tickets and URLs out of Zustand persistence, local/session storage, diagnostic snapshots, server files, and test snapshots.

## Next steps

- Phase 02 consumes a cloned purpose-bound record, revalidates it, and applies exact inline/attachment policy over one bounded Range implementation.

## Unresolved Questions

- None.
