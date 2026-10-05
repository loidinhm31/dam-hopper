# Filesystem and Media APIs

File explorer and session-bound media capability contracts moved from the [API reference index](../api-reference.md).
### IDE File Explorer

**GET /api/fs/list?project=NAME&path=REL[&worktreePath=PATH]**
List directory contents.

Response:

```json
{
  "entries": [
    {
      "name": "file.ts",
      "kind": "file",
      "size": 1024,
      "mtime": 1712577600,
      "isSymlink": false
    }
  ]
}
```

**GET /api/fs/read?project=NAME&path=REL[&worktreePath=PATH][&offset=N&len=M]**
Read file content (text or binary detection).

- Text: returns body with Content-Type: text/\*
- Binary: returns `{ binary: true, mime: "..." }`
- Reads enforce the server's configured bounds; use `offset` and `len` range requests for large files rather than relying on an old global size figure.

**GET /api/fs/stat?project=NAME&path=REL[&worktreePath=PATH]**
File metadata.

Response:

```json
{
  "kind": "file",
  "size": 1024,
  "mtime": 1712577600,
  "mime": "text/typescript",
  "isBinary": false
}
```

**GET /api/fs/search?q=QUERY[&project=NAME&worktreePath=PATH&case=true&max=N]**
Search text content and return `{ query, matches, truncated }`. Each match
contains a project-relative path, line, column, and text context. The browser
adds its originating profile and target reference before federating results.

**GET /api/fs/search-paths?q=QUERY[&project=NAME&worktreePath=PATH&case=true&max=N]**
Search file and directory names and return `{ query, matches, truncated }`.
`scope=workspace` is accepted by both search routes for compatibility with
workspace-aware transports; the browser's **All connected profiles** mode
performs one owner-bound request per eligible profile and applies a 500-match
aggregate cap.

### Session-Bound Media Capabilities (v2)

Image preview and video playback/download use opaque ticket URLs and a
namespaced, server-issued media-session cookie. Ticket issue and revocation
routes require Bearer authentication. A media stream URL never contains a
Bearer token. The complete lifecycle, cleanup, and encryption
contract is in the [Media Isolation and Encryption Architecture](../architecture/media-isolation-and-encryption.md).

#### Client binding and cookie

Every ticket issue, ticket revoke, and media-session logout request requires a
`mediaClientId` UUIDv4. The server stores its canonical lower-case,
hyphenated form and names the cookie:

```text
damhopper-media-session-<canonical-lowercase-uuidv4>
```

The media cookie is host-only `HttpOnly; SameSite=Lax; Path=/api/fs;
Max-Age=28800` and is deliberately non-`Secure` for HTTP compatibility. The
separate authentication cookie remains `HttpOnly; SameSite=Strict; Path=/`.
The old fixed v1 media-cookie name is ignored.

The parser scans all `Cookie` headers and semicolon-delimited pairs, but only
the exact namespace selected by the stored ticket binding. A duplicate
occurrence of that selected cookie fails closed. Invalid token encoding or
length is not accepted as another client's credential.

#### Endpoint summary

| Method and route               | Request                                                | Response/authorization                                                                                                                         |
| ------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `POST /api/fs/image/tickets`   | `{ project, worktreePath?, path, mediaClientId }`      | `201` with `ticket`, `streamPath`, `expiresAt`, `purpose: "preview"`, `authorizationMode: "session-cookie-v2"`, and a namespaced `Set-Cookie`. |
| `DELETE /api/fs/image/tickets` | `{ ticket, mediaClientId }`                            | `204`; actor and client namespace must match.                                                                                                  |
| `POST /api/fs/video/tickets`   | `{ project, worktreePath?, path, purpose: "playback"\\ | "download", mediaClientId }`                                                                                                                   | `201` with the selected purpose and v2 authorization mode, plus a namespaced `Set-Cookie`. |
| `DELETE /api/fs/video/tickets` | `{ ticket, mediaClientId }`                            | `204`; actor and client namespace must match.                                                                                                  |
| `DELETE /api/fs/media-session` | `{ mediaClientId }`                                    | `204` and a clearing `Set-Cookie` for only that namespace. A media cookie is not required.                                                     |
| `GET                           | HEAD /api/fs/{image,video}/stream/{ticket}`            | no body                                                                                                                                        | Native stream after ticket, binding, target, and file-version checks.                      |

JSON uses camelCase and rejects unknown fields. Ticket responses use
`Cache-Control: no-store`. Issue responses do not disclose project paths,
absolute filenames, or bearer tokens. Issue validates the selected project
target and regular file before recording its identity/version. Image tickets
allow final `png`, `jpg`, `jpeg`, `gif`, and `webp` extensions. Video tickets
allow final `mp4`, `m4v`, `webm`, `ogv`, `ogg`, and `mov` extensions.

#### Media-session logout

```http
DELETE /api/fs/media-session
Authorization: Bearer {token}
Content-Type: application/json

{ "mediaClientId": "550e8400-e29b-41d4-a716-446655440000" }
```

The authenticated actor and requested client namespace are the revocation
boundary. The endpoint removes that pair's sessions and tickets and clears
only the corresponding cookie; it does not revoke another profile/client
namespace. It is safe to call without a usable media cookie, including during
profile removal or exact-origin ticket-only cleanup. Remote cleanup is
best-effort and bounded by the client; server TTLs remain the safety net.

#### Stream authorization and freshness

Ticket records retain the actor subject, client ID, session digest, media kind,
purpose, target, and an incarnation. Stream authorization:

1. Looks up the ticket and expected kind. Unknown, expired, revoked,
   wrong-kind, or stale-generation capabilities are indistinguishable `404`.
2. Selects the cookie name from the ticket's stored client binding rather than
   an arbitrary namespace supplied by the stream caller.
3. Rejects a duplicate selected cookie. A present cookie must match the
   bound actor/client session digest. A missing cookie is accepted only when
   the request has the exact configured allowed origin for ticket-only
   fallback; untrusted or absent origins cannot use that fallback.
4. Revalidates the target and exact file identity/version after asynchronous
   checks, then verifies the ticket incarnation and binding again.
5. Touches idle deadlines only after all checks pass. Tickets have a
   15-minute idle and 8-hour absolute lifetime; sessions have a 30-minute idle
   and 8-hour absolute lifetime.

`GET` returns `200` for a full representation or `206` for one valid byte
range. `HEAD` returns metadata with an empty body. Malformed, multi-range, or
unsatisfiable ranges return `416` with `Content-Range: bytes */size`.
Responses include `Accept-Ranges`, `Content-Length`, `Content-Type`, `ETag`,
`Last-Modified`, and `Cache-Control: private, no-store`. Image and playback
responses are inline; download responses use the sanitized attachment name.
File identity/version changes return `410` and revoke the ticket.

The stream routes sit outside bearer middleware because native elements send
credentialed cookie requests. The browser client accepts only
`authorizationMode: "session-cookie-v2"`, resolves an opaque stream path on
the configured origin, performs a credentialed `HEAD`, and then assigns the
URL directly to a native image/video element or download anchor. Elements set
`crossOrigin="use-credentials"`. Probe failures are fixed, redacted errors;
there is no media-body, Blob, bearer-in-URL, or plaintext fallback.

#### Native image preview

**POST /api/fs/image/tickets**

```json
{
  "project": "NAME",
  "worktreePath": "optional/worktree",
  "path": "assets/cover.webp",
  "mediaClientId": "550e8400-e29b-41d4-a716-446655440000"
}
```

```json
{
  "ticket": "opaque-random-token",
  "streamPath": "/api/fs/image/stream/opaque-random-token",
  "expiresAt": 1800000000000,
  "purpose": "preview",
  "authorizationMode": "session-cookie-v2"
}
```

**DELETE /api/fs/image/tickets** accepts
`{ "ticket": "opaque-token", "mediaClientId": "..." }`. Revocation is
idempotent and returns `204`; foreign, unknown, or already revoked tickets do
not reveal prior state.

**GET|HEAD /api/fs/image/stream/{ticket}** uses the shared stream contract,
always serves image content inline, and cannot be upgraded to video or
download behavior.

#### Video playback and download

**POST /api/fs/video/tickets** accepts:

```json
{
  "project": "NAME",
  "worktreePath": "optional/worktree",
  "path": "media/clip.webm",
  "purpose": "playback",
  "mediaClientId": "550e8400-e29b-41d4-a716-446655440000"
}
```

`purpose` is the closed `playback | download` enum. Playback and download
always receive separate capabilities. **DELETE
/api/fs/video/tickets** accepts `{ "ticket": "opaque-token",
"mediaClientId": "..." }`. **GET|HEAD
/api/fs/video/stream/{ticket}** follows the same range, validator,
revalidation, private no-store, and indistinguishable `404` behavior as image
streams. Playback is inline; download uses a sanitized attachment filename.

Media session and ticket state is process-local. Multi-instance deployments
need sticky routing to the process holding the ticket/session until a shared
store exists.

#### Workbench media integration qualification

The workbench media live harness
[`scripts/qualify-phase09-workbench.mjs`](../../scripts/qualify-phase09-workbench.mjs)
checks the v2 media contract in an isolated two-server fixture: Server A and
Server B expose equal project/file names on `14801` and `14802`, A issues a
`session-cookie-v2` ticket, B rejects that ticket, and A revokes the selected
`mediaClientId`. The fixture uses `--no-auth` only for deterministic
remote-effect checks; normal-auth tests remain required for actor and
credential isolation.

The qualification test ledger records 209 UI browser tests, 1,416 Rust server
tests, 24 live harness assertions, and four embedded browser assertions within
3,504 passing tests (nine skipped/ignored). Web qualification passed. Native desktop remains
blocked pending real Windows S13 runtime, SSH, WebView2/DPAPI, and Browser relay
evidence. Do not re-enable a v1 media path during version skew: deploy or roll
back a matched frontend/backend pair with `workbenchProtocol: 2` and
`session-cookie-v2`.

**GET /api/fs/language-files?project=NAME[&worktreePath=PATH]**
Scan the selected project target for supported language files. The endpoint is
authenticated and target-scoped; it does not accept a caller-supplied root or
scan limit. The walk honors Git ignore/global-ignore/repository-exclude rules,
includes hidden paths, excludes `.git` metadata, and returns regular files only
(symlinks are not followed or returned).

Supported extensions are `.rs` (`rust`), `.js`, `.jsx`, `.ts`, and `.tsx`
(`javascript-typescript`), plus `.java` (`java`), matched case-insensitively.
Paths are relative to the project root and use forward slashes where the host
platform requires normalization. Results are sorted by path and capped at
20,000 files or 200,000 visited entries; `truncated` is true when either cap is
reached.

Response:

```json
{
  "files": [
    {
      "path": "src/main.rs",
      "size": 1024,
      "mtime": 1712577600,
      "language": "rust"
    }
  ],
  "truncated": false,
  "limit": 20000
}
```

**Error Responses:**

- 400: Invalid path (outside sandbox)
- 404: Project/path not found


