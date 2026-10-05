# API Reference

Endpoint and client-transport contracts are split by domain to keep each reference maintainable. Start with the current route details in the linked pages; implementation and typed client code remain authoritative.

Base URL depends on deployment. Local development commonly uses `http://127.0.0.1:4803`; systemd production serves the API on `http://localhost:4801`; legacy direct/Docker configurations may use `http://localhost:4800`.

## Current API references

| Page | Coverage |
| --- | --- |
| [Authentication](./api/authentication.md) | Login, MFA, session, development-mode behavior |
| [Advisor and workflow](./api/advisor-and-workflow.md) | Native Advisor and workflow REST routes |
| [System services](./api/system-services.md) | Diagnostics, browser-debug artifacts, native SSH forwarding, host resources |
| [Terminal idle suspend](./api/idle-suspend.md) | Status, timing, manual force, helper protocol and status events |
| [Agent status, usage, and sessions](./api/agent-usage-and-sessions.md) | Agent snapshot, Codex usage, and PTY session persistence |
| [Git API](./api/git.md) | Worktrees, branches, history search, commit rewrite/squash, leased publication |
| [Client transport and events](./api/transport-and-events.md) | Reconnection, PTY subscriptions, and client event methods |
| [REST endpoints](./api/rest-endpoints.md) | Global config, projects, terminal and Git routes, SSH credentials, profile client contract |
| [Filesystem and media](./api/filesystem-and-media.md) | File explorer/search, media tickets, stream authorization |
| [Workspace and settings](./api/workspace-settings.md) | Agent Store, workspace, settings, health |
| [WebSocket](./api/websocket.md) | WebSocket endpoint and event/message contract |

## Authentication

See the [authentication API reference](./api/authentication.md). `--no-auth` is a development bypass, not a production mode; bind it to loopback only. Native Advisor and privileged idle-suspend mutations remain denied in no-auth mode.

## Native Evcrate Advisor API

See the [Advisor endpoint reference](./api/advisor-and-workflow.md). Native Advisor is per-server, off by default, and requires an authenticated administrator. The former `/api/plugins/*` and `/api/plugins/admin*` routes are retired and no longer exist.

## Terminal idle suspend

See the [idle-suspend API reference](./api/idle-suspend.md). Automatic policy, timing, and manual force are separate contracts; current status is authoritative and does not prove an operation has completed.

## Git API

See the [Git endpoint reference](./api/git.md). Commit rewriting and squash are local CAS-protected operations; publication is a separate exact-OID leased action.

## Project Worktree Targets

The [Git API reference](./api/git.md) documents target validation, worktree
discovery, and use of `worktreePath` across Git, terminal, and filesystem
operations.

## Client-Side Profile Management

See the [REST endpoint reference](./api/rest-endpoints.md#client-side-profile-management) and [Multi-Server Profiles User Guide](./user-guide-multi-server-profiles.md).
## Commit history

The [Git API reference](./api/git.md#commit-history) documents full-message literal filtering and pagination.

## Git Operations

The [REST endpoint reference](./api/rest-endpoints.md#git-operations) documents ordinary fast-forward pushes and explicit leased publication.

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

## Retired plugin API anchors

### Trusted Plugin API

Retired. There are no current plugin routes; historical context is in the [Retired Plugin Platform Archive Record](./archive/retired-plugin-platform.md).

### Trusted Plugin Management API

Retired. There are no current plugin-management routes; historical context is in the [Retired Plugin Platform Archive Record](./archive/retired-plugin-platform.md).
