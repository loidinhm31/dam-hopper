# Multi-Server Profiles User Guide

## Overview

Phase 02 turns the app into a unified workbench: the shell and navigation stay
available while each saved server profile owns an independent connection
runtime. Profiles can be connected, disconnected, logged in, or logged out
without switching the whole app or reloading the page.

Browser hosts and Windows desktop native hosts may connect to approved HTTP(S)
origins. Non-Windows native hosts accept only a profile whose origin exactly
matches the native webview origin. An unsupported remote profile is reported as
`Unsupported`; it is not silently routed through a fallback transport.

The server must advertise `workbenchProtocol: 2` from `GET /api/auth/status`.
Older or incomplete servers remain visible in the shell but cannot become a
connected profile.

## Create or migrate a profile

### Automatic migration

On first startup, `migrateToProfiles()` converts a valid legacy
`damhopper_server_url` configuration into a **Default Server** profile. A legacy
token is copied only when its URL matches the destination profile; an
unrelated token is discarded rather than bound to a different endpoint.

Existing profiles without `autoConnect` are migrated with `autoConnect: true`.
An explicit `autoConnect: false` value is preserved. Migration also retains an
existing profile selection as compatibility state, but that selection is not a
global connection switch.

### Manual creation

1. Open **Server Connections** from the top-nav connection button.
2. Select **Add Server Connection**.
3. Enter a display name, normalized HTTP(S) URL, and authentication type.
4. For Basic authentication, enter the username and login credentials when
   prompted. Passwords are never stored.
5. Choose **Auto-connect** if this profile should connect during startup.
6. Save the profile, then select **Connect** or **Login** as needed.

Each profile receives a stable ID. Profile names are labels only; two profiles
with the same name remain distinct when their IDs or endpoints differ.

## Connect profiles

The **Server Connections** dialog shows one row per saved profile with its URL,
authentication type, auto-connect setting, and current status:

| Status           | Meaning                                                                  |
| ---------------- | ------------------------------------------------------------------------ |
| `Disconnected`   | No runtime is currently attempting this profile.                         |
| `Connecting`     | The profile runtime is checking the endpoint or opening its WebSocket.   |
| `Connected`      | Auth status and workbench protocol checks passed.                        |
| `Login required` | Basic authentication needs a token or fresh login.                       |
| `Offline`        | The endpoint could not be reached after a bounded retry cycle.           |
| `Unsupported`    | Native platform/origin or `workbenchProtocol` rules reject the endpoint. |

Actions are profile-scoped:

- **Connect** starts only that profile's runtime.
- **Disconnect** stops that runtime but keeps the saved profile and token.
- **Login** opens the credentials flow for that profile.
- **Logout** sends the profile's authenticated actor and generation-bound
  `mediaClientId` to media-session logout, clears only that namespaced media
  session/tickets, then clears the profile's token and disconnects it.
- **Edit** updates metadata, URL, authentication, or auto-connect. A changed
  endpoint or authentication type invalidates the old endpoint-bound token and
  retires the old media client namespace.
- **Remove** revokes that profile's media when possible, removes the local
  profile and connection state, and does not delete data from the remote server.

The top-nav connection button summarizes all profile runtimes. It shows
`No connections` when none are configured, the profile name when exactly one
profile is configured, and a connected/total count when multiple profiles are
present. Focus, route changes, and project selection do not reconnect or
disconnect profiles.

## Navigate from profile to project

The **Project Switcher** groups discovered projects as:

```text
Profile name — server URL
  project path/name
```

Navigation uses the qualified tuple `{ profileId, project }`. Identical project
names on different profiles are therefore separate targets. If the selected
project disappears, the switcher marks it **(unavailable)** rather than
silently selecting a project from another profile.

Settings are also profile-qualified:

- Preferences retain their source profile and snapshot. Removing that profile
  marks the source `source-removed` until a replacement is selected.
- Server settings target one profile at a time.
- Browser Debug target selection is independent of preferences and settings.
- The **Server configuration** section inside Settings uses the same
  profile/project switcher; it is not a second project hierarchy.

## Phase 03: Files, editor, search, and Git

Phase 03 extends the `Profile → Project` selection to a target-qualified IDE
resource. Every file, editor tab, watcher, search match, replacement, preview,
and Git operation carries the owning `profileId`, project, and optional
`worktreePath`. A missing worktree path means the configured project root.

The profile ID selects the browser connection; it is not sent in the server
target payload. The client captures the profile's connection generation before
an asynchronous request and ignores stale results after disconnect, endpoint
replacement, or reconnect. A missing worktree is shown as unavailable instead
of silently falling back to the root or another profile.

### Files and editor

- File list/read/stat, create/delete, rename/move, upload, download, and tree
  watchers stay on the selected profile and target.
- Clean tabs reload after filesystem or Git changes. Dirty tabs retain local
  edits and show a stale/conflict state; remote bytes never overwrite unsaved
  content.
- Monaco model and tab keys include profile and worktree scope. Equal paths on
  two profiles are separate tabs.
- Files at least 5 MiB open in the read-only range viewer. Image and video
  previews use Phase 07's UUIDv4-namespaced, short-lived ticket capabilities
  rather than bearer URLs or whole-file Blob reads. See the
  [Phase 07 media guide](./phase-07-media-isolation-and-encryption.md) for
  cookie binding, cleanup, and exact-origin fallback rules.

See the [Phase 03 workbench contract](./phase-03-files-editor-search-git.md)
for transport messages, invalidation rules, and source locations.

### Federated search and replace

Search offers **Project target** and **All connected profiles** scopes. The
workspace scope keeps each profile's status visible, aggregates matches with
profile/project identity, and caps the combined result set at 500. A server
truncation or aggregate cap displays a warning that results may be incomplete.

`Replace Next` and `Replace All` capture the target from each match, including
its originating profile. A dirty tab blocks only the matching
profile/project/worktree/path; it never blocks an identical path on another
target. Replace All reports replaced, skipped-dirty, and failed files and
reloads only clean tabs.

### Git and SSH retry

Fetch and pull preserve independent results for each selected root/worktree
target. The shared SSH passphrase flow prompts only for recognized SSH
authentication failures. After the key loads, only failed targets are retried;
successful targets are retained and are not replayed. A changed connection
generation cancels the retry.

## Persistence and security

| Record                                  | Storage and scope                      | Behavior                                                                         |
| --------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------- |
| `damhopper_server_profiles`             | `localStorage`, shared by browser tabs | Saved profile metadata and `autoConnect`.                                        |
| `damhopper_profile_auth_v2_<profileId>` | `localStorage`, per profile            | Version 2 token record bound to normalized URL and auth type.                    |
| `damhopper_active_profile_id`           | `localStorage`, compatibility state    | Used by legacy/default endpoint helpers; not a runtime-wide connection selector. |
| `dam-hopper:workspace-state`            | Zustand persistence                    | Qualified `selectedProject` only.                                                |
| `dam-hopper:preferences-source:v1`      | Zustand persistence                    | Independent preference, settings, and Browser Debug profile IDs.                 |
| Query and connection runtime state      | Memory only                            | Owner/generation-qualified; not persisted as a cache.                            |

Tokens are readable by JavaScript. Use trusted HTTPS frontend assets and do not
store passwords. HTTP can expose credentials, cookies, ticket URLs, API
requests, and media bytes to interception or modification.

Profile token records are endpoint-bound. Changing a normalized URL or auth type
requires fresh authentication; a trailing-slash-only normalization does not
create a different endpoint. Storage-unavailable is distinct from an empty
profile list, so the app must not treat a persistence failure as permission to
overwrite profiles.

### Fresh browser-resource reset

Phase 02 performs an idempotent reset of legacy browser resource records, such
as unqualified active-project state, old terminal layouts, editor/tree state,
Browser Debug address history, command history, pins, and quarantine records.
It preserves saved profiles, endpoint-bound auth records, native scope aliases,
presentation-only settings, and server data.

The reset never calls `localStorage.clear()`. When records are removed, the
shell displays an informational notice. Deep links that include `project` or
`session` without `profileId` are rejected as unqualified legacy links; select
the target through unified navigation or add the profile-qualified fields.

## Native platform rules

- Browser and Windows desktop native hosts may use approved cross-origin
  profiles, subject to server CORS and authentication policy.
- Non-Windows native hosts require exact same-origin profiles.
- A rejected remote profile remains editable and visible. It receives no
  auto-login or connection traffic until its origin/platform is supported.

## Troubleshooting

### The profile list is empty

Check whether browser storage is unavailable before recreating profiles.
Private browsing, disabled storage, quota errors, or a browser policy can
prevent reads and writes. Storage failure is not the same as a genuinely empty
list.

### The row says `Login required`

Log in for that profile. Confirm its URL and auth type, then retry. A token
from another profile or endpoint is not accepted.

### The row says `Unsupported`

On non-Windows native, make the profile URL match the native origin exactly.
On any host, verify the server returns `workbenchProtocol: 2` from
`GET /api/auth/status`. Do not work around the status by forcing a fallback
transport.

### The row says `Offline`

Check the URL, server availability, HTTPS/CORS policy, and credentials. The
runtime uses bounded retries; use **Connect** after restoring the endpoint.

### A project or deep link is unavailable

Confirm that the profile is connected and that the project still exists on that
profile. An unqualified legacy `project` or `session` URL must be reopened
through the Project Switcher with its `profileId`.

## Developer reference

The verified client boundary is in
[`packages/ui/src/api/server-config.ts`](../packages/ui/src/api/server-config.ts)
and [`packages/ui/src/api/connections.ts`](../packages/ui/src/api/connections.ts).
The public concepts are:

```typescript
interface ServerProfile {
  id: string;
  name: string;
  url: string;
  authType: "basic" | "none";
  username?: string;
  createdAt: number;
  autoConnect: boolean;
}

getProfiles(): ServerProfile[];
createProfile(data): ServerProfile;
updateProfile(id, data): boolean;
deleteProfile(id): boolean;
migrateToProfiles(): void;
getAuthToken(profileId): string | null;
setAuthToken(token, profileId): boolean;
clearAuthToken(profileId): boolean;
```

Use `connectProfile(profileId)`, `disconnectProfile(profileId)`, and
`removeProfileConnection(profileId)` from `connections.ts`; do not reintroduce a
singleton transport or a focus-triggered profile switch. See the
[API reference](./api-reference.md) and [system architecture](./system-architecture.md)
for implementation contracts.

## Unresolved questions

None for the Phase 02 profile and unified-shell behavior. Later phase release
gates remain tracked in the unified-profile plan rather than this user guide.
