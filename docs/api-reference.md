# API Reference

Endpoint and client-transport contracts are split by domain to keep each reference maintainable. Start with the current route details in the linked pages; implementation and typed client code remain authoritative.

Base URL depends on deployment. Local development commonly uses `http://127.0.0.1:4803`; systemd production serves the API on `http://localhost:4801`; legacy direct/Docker configurations may use `http://localhost:4800`.

## Current API references

| Page | Coverage |
| --- | --- |
| [Authentication](./api/authentication.md) | Login, MFA, login session inventory and revocation, development-mode behavior |
| [Workflow tracking](./api/workflow.md) | Workflow REST routes |
| [System services](./api/system-services.md) | Diagnostics, browser-debug artifacts, native SSH forwarding, host resources |
| [Terminal idle suspend](./api/idle-suspend.md) | Status, timing, manual force, helper protocol and status events |
| [Agent status, usage, and sessions](./api/agent-usage-and-sessions.md) | Agent snapshot, Codex usage, and PTY session persistence |
| [Git API](./api/git.md) | Worktrees, branches, history search, commit rewrite/squash, leased publication |
| [Client transport and events](./api/transport-and-events.md) | Reconnection, PTY subscriptions, and client event methods |
| [REST endpoints](./api/rest-endpoints.md) | Global config, projects, terminal, Git conflict/operation routes, SSH credentials |
| [Git operation lifecycle](./api/git-operation-lifecycle.md) | Sequencer state machine, operation continuation/abort, stage role labels, and truthful outcomes |
| [Client-side profiles](./api/client-side-profiles.md) | Profile metadata, connection contracts, and client-side persistence breakdown |
| [Filesystem and media](./api/filesystem-and-media.md) | File explorer/search, media tickets, stream authorization |
| [Workspace and settings](./api/workspace-settings.md) | Agent Store, workspace, settings, health, semantic navigation settings |
| [WebSocket](./api/websocket.md) | Core multiplexed WebSocket (`/ws`) and dedicated semantic gateway (`/ws/semantic/v1`) |

## Authentication

See the [authentication API reference](./api/authentication.md). Covers registration, TOTP MFA enrollment and verification, session status, account-wide device login sessions inventory (`GET /api/auth/sessions`), and bearer-only session revocation (`DELETE /api/auth/sessions/{id}`). `--no-auth` is a development bypass, not a production mode; bind it to loopback only. Privileged idle-suspend mutations and login device sessions remain denied in no-auth mode (`409 DEVICE_SESSIONS_UNAVAILABLE`).

## Terminal idle suspend

See the [idle-suspend API reference](./api/idle-suspend.md). Automatic policy, timing, and manual force are separate contracts; current status is authoritative and does not prove an operation has completed.

## Git API

See the [Git endpoint reference](./api/git.md). Commit rewriting and squash are local CAS-protected operations; publication is a separate exact-OID leased action. For unmerged index summaries, on-demand conflict snapshots, safe resolution contracts (`ResolveOutcome`), `GitMutationCoordinator`, and CUT1 generic stage preflight, see [Git Conflict Discovery, Snapshots & Resolution](./api/rest-endpoints.md#git-conflict-discovery--snapshots). For authoritative active operation inspection, preconditioned continue/abort lifecycle mutations, stage role semantics, and truthful execution outcomes, see the [Git Operation Lifecycle API](./api/git-operation-lifecycle.md) and [REST Endpoints](./api/rest-endpoints.md#git-operation-lifecycle).

## Project Worktree Targets

The [Git API reference](./api/git.md) documents target validation, worktree
discovery, and use of `worktreePath` across Git, terminal, and filesystem
operations.

## Client-Side Profile Management

See the [Client-side profile reference](./api/client-side-profiles.md), [REST endpoint reference](./api/rest-endpoints.md#client-side-profile-management), and [Multi-Server Profiles User Guide](./user-guide-multi-server-profiles.md).
## Commit history

The [Git API reference](./api/git.md#commit-history) documents full-message literal filtering and pagination.

## Git Operations

The [REST endpoint reference](./api/rest-endpoints.md#git-operations) documents ordinary fast-forward pushes, explicit leased publication, [Git conflict discovery, snapshots & resolution](./api/rest-endpoints.md#git-conflict-discovery--snapshots), [Git operation lifecycle](./api/rest-endpoints.md#git-operation-lifecycle) (see also [Git Operation Lifecycle API](./api/git-operation-lifecycle.md)), and CUT1 generic stage preflight.
## IDE File Explorer

See [filesystem and media APIs](./api/filesystem-and-media.md).

## Session-Bound Media Capabilities (v2)

See the [filesystem and media API reference](./api/filesystem-and-media.md#session-bound-media-capabilities-v2).

## Agent Store

See [workspace and settings APIs](./api/workspace-settings.md#agent-store).

## Workspace Management

See [workspace and settings APIs](./api/workspace-settings.md#workspace-management).

## Settings & Health

See [workspace and settings APIs](./api/workspace-settings.md#settings-health).

## WebSocket Endpoint

See the [WebSocket API reference](./api/websocket.md).
## Semantic Navigation Settings

See [Semantic Navigation Settings](./api/workspace-settings.md#semantic-navigation-settings). Covers `GET /api/semantic/settings` (safe inspection of configured intent, runtime admission, integrity status, and caller mutation authority) and `PATCH /api/semantic/settings` (server-global hot toggle without daemon restart, requiring fresh current-admin authorization and rejecting `--no-auth`).


## Retired plugin API anchors

### Trusted Plugin API

Retired. There are no current plugin routes; historical context is in the [Retired Plugin Platform Archive Record](./archive/retired-plugin-platform.md).

### Trusted Plugin Management API

Retired. There are no current plugin-management routes; historical context is in the [Retired Plugin Platform Archive Record](./archive/retired-plugin-platform.md).
