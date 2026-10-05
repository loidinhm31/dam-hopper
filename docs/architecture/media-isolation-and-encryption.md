# Media Isolation and Encryption Architecture

**Authority:** Media & Storage Subsystems (`packages/ui/src/`, `server/src/fs/`, `server/src/crypto/`)  
**Status:** Maintained Architecture Specification  

This specification defines the multi-profile workbench media sessions, media-ticket authorization, remote cleanup, and encrypted write protocols.

## Purpose and Invariants

Media capabilities and encrypted writes are prevented from crossing profile, connection-generation, project, or client boundaries. Media streams remain native browser streams rather than exposing file bytes to the UI. Encrypted writes maintain one owner-qualified session and one captured transport from authentication through the final write.

The implementation is fail-closed:

- Every media ticket is bound to an authenticated actor and a UUIDv4 `mediaClientId`;
- The ticket's stored client binding selects the cookie namespace used for stream authorization;
- Duplicate selected cookies, invalid UUIDs, stale generations, wrong ticket kinds, and mismatched owners do not fall back to a broader capability;
- Remote cleanup is narrow, bounded, and best effort, with server TTLs as the safety net;
- Encrypted writes reject stale ownership or connection changes and never retry as plaintext or replay on another transport.

## Media Session v2 Wire Contract

### Client Identifier and Cookie Namespace

`mediaClientId` is required on ticket issue, ticket revoke, and media-session logout. It must be a canonical UUIDv4. The server stores the lower-case hyphenated representation and rejects other UUID versions or malformed values.

The session cookie is namespaced by that identifier:

```text
damhopper-media-session-<canonical-lowercase-uuidv4>
```

The cookie is `HttpOnly; SameSite=Lax; Path=/api/fs; Max-Age=28800`. It is HTTP-compatible for deployments that use HTTP; the authenticated application cookie remains a separate, stricter concern. The old fixed v1 cookie name is not accepted.

The parser scans all `Cookie` headers and semicolon-delimited pairs. It considers only the exact expected name for the ticket's client binding. A second occurrence of that exact name returns a duplicate result and authorization fails closed. An invalid token encoding or invalid token length is treated as no usable cookie, not as a different client's credential.

### Endpoints

All ticket JSON uses camelCase and rejects unknown fields. Ticket responses use `Cache-Control: no-store` and include `authorizationMode: "session-cookie-v2"`.

| Method and Route | Request | Result |
| --- | --- | --- |
| `POST /api/fs/image/tickets` | `{ project, worktreePath?, path, mediaClientId }` | `201` with `{ ticket, streamPath, expiresAt, purpose: "preview", authorizationMode: "session-cookie-v2" }` and a namespaced `Set-Cookie`. |
| `DELETE /api/fs/image/tickets` | `{ ticket, mediaClientId }` | `204`; revokes only a matching actor/client/ticket binding. |
| `POST /api/fs/video/tickets` | `{ project, worktreePath?, path, purpose: "playback"\|"download", mediaClientId }` | `201` with the selected purpose, stream path, expiry, v2 authorization mode, and a namespaced `Set-Cookie`. |
| `DELETE /api/fs/video/tickets` | `{ ticket, mediaClientId }` | `204`; revocation is idempotent and actor/client scoped. |
| `DELETE /api/fs/media-session` | `{ mediaClientId }` | `204` and a clearing `Set-Cookie` for only that client namespace. |
| `GET` or `HEAD /api/fs/{image,video}/stream/{ticket}` | no JSON body | Streams only after ticket, target, file-version, actor/client, and cookie checks. |

Ticket issue requires an authenticated actor. The target is resolved and validated before a regular file is opened and its version recorded. Image tickets allow raster formats; video tickets allow supported video containers and codecs. Stream routes do not use bearer middleware. Cookie authentication is the normal same-origin path. A ticket-only fallback is allowed only when the request matches the exact configured allowed origin.

### Authorization, Freshness, and Revocation

A ticket stores its `MediaSessionBinding` (`actor_subject`, `client_id`, and a digest of the session token) plus an incarnation. Stream authorization proceeds as follows:

1. Look up the opaque ticket and expected media kind. Unknown, expired, revoked, wrong-kind, or stale-generation capabilities return `404`.
2. Select the cookie name from the ticket's stored `client_id`, never from an arbitrary client identifier supplied by the stream caller.
3. Reject duplicate selected cookies. If a cookie is present, its token digest must match the bound session and actor/client pair. If no cookie is present, continue only for the exact-origin ticket-only path.
4. Revalidate the target and exact file identity/version after asynchronous file checks, then verify the ticket incarnation and binding again before streaming bytes.
5. Touch session and ticket idle deadlines only after all checks pass. Media sessions have a 30-minute idle and 8-hour absolute bound; tickets have a 15-minute idle and 8-hour absolute bound.

Logout, profile removal, and connection retirement revoke by `(actor.subject, mediaClientId)`, so one profile/client namespace cannot revoke another. Workspace replacement clears the shared store generation. Media state is process-local.

## Remote Cleanup Lifecycle

`RemoteCleanupHandle` is the browser-side capability returned by image and video ticket APIs:

```ts
interface RemoteCleanupHandle {
  readonly owner: ConnectionRef;
  readonly resourceId: string;
  readonly cleanup: () => Promise<void>;
  readonly isRetired: () => boolean;
}
```

The handle captures the original owner/generation, endpoint, credentials, ticket or session identifier, and client namespace. It can invoke only the resource API's supplied revoke callback; it cannot create resources, perform arbitrary requests, write files, or access a general transport.

Lifecycle rules:

1. Capture the handle immediately after a ticket is issued. If a later setup step fails, revoke through this original snapshot rather than the current profile selection.
2. Detach the native image/video source before cleanup so the browser cannot retain an active stream while the capability is retired.
3. The first `cleanup()` creates an `AbortController` and a five-second deadline. Concurrent calls join the same in-flight promise; later calls are no-ops after retirement. Errors are swallowed because cleanup is best effort.
4. The handle is marked retired in `finally`, the timer is cleared, and no retry is scheduled. Server ticket/session TTLs bound failures or lost clients.
5. Profile change, connection replacement, logout, unmount, and stale asynchronous results all use the captured handle. A download handle is retained for a browser-managed download instead of being revoked immediately after an anchor click.

## Owned Encryption Context

### Project-Qualified State

Encryption state and OPAQUE sessions are keyed by project plus connection owner, not by a bare project name. The standard key shape is:

```text
<profileId>@<generation>:<project>
```

An ambient compatibility key (`ambient:<project>`) is used only when no owner exists. A bare project is qualified from the explicit target owner first, then the target profile, and never from whichever profile happens to become current later. Passphrases, OPAQUE session IDs, and AES key buffers remain in memory only.

Disabling encryption clears the passphrase, evicts the matching session, and zeroes the mutable AES key buffer. Connection retirement performs the same invalidation for every owner-qualified key belonging to the retired owner. Owner A and owner B may use the same project name without sharing state.

### Prompt Queue and OPAQUE Identifiers

Passphrase prompts are queued with explicit project, profile, and profile name labels. Requests for the exact same owner-qualified key join the existing promise without replacing its resolver. Resolving or rejecting advances the queue; disabling encryption rejects queued prompts for that key. No prompt or passphrase is persisted in local or session storage.

Each OPAQUE registration uses a collision-resistant identifier generated from a bounded project slug and random UUID material:

```text
enc-<sanitized-project-prefix>-<12 hex characters>
```

The identifier is not derived solely from the project name. OPAQUE registration and login derive the in-memory AES-256-GCM session key through HKDF; the passphrase is never sent as a file-write payload.

### One Transport and Freshness Fences

An encrypted upload or save captures one owner and one `WsTransport` before asynchronous work begins. The same transport is used for OPAQUE register/login, WebCrypto encryption, and the final `fsPutFile` or `fsPutSave` call. Before and after each asynchronous boundary, the operation verifies its revision, that the owner is still current, and that encryption remains enabled.

If a fence fails, mutable key material from a stale result is zeroed and the write is rejected. The operation does not recapture a transport, fall back to another profile, replay automatically, or retry with plaintext. Target errors mark only that target unavailable and clear only the same project/owner session.

## Source Map

| Concern | Primary Implementation |
| --- | --- |
| Media sessions and ticket store | `server/src/fs/media_session.rs`, `server/src/fs/media_ticket.rs` |
| Image/video issue and stream routes | `server/src/api/fs_image.rs`, `server/src/api/fs_video.rs`, `server/src/api/media_stream_response.rs` |
| Actor-bound session logout | `server/src/api/media_session.rs`, `server/src/api/auth.rs` |
| Client media identifiers and cleanup | `packages/ui/src/api/connections.ts`, `packages/ui/src/api/media-session.ts`, `packages/ui/src/api/image-tickets.ts`, `packages/ui/src/api/video-tickets.ts` |
| Native preview lifecycle | `packages/ui/src/components/organisms/ImagePreview.tsx`, `packages/ui/src/components/organisms/VideoPreview.tsx` |
| Owned encryption and writes | `packages/ui/src/contexts/EncryptContext.tsx`, `packages/ui/src/hooks/use-encrypted-write.ts`, `packages/ui/src/lib/opaque-session.ts` |

Related contracts: [API Reference](../api-reference.md), [Filesystem & Media API](../api/filesystem-and-media.md), [System Architecture](../system-architecture.md), and [Code Standards](../code-standards.md).
