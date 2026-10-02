# Native Advisor Configuration

The native Advisor history reader is an opt-in, server-level feature. Configure it in the server's loaded `dam-hopper.toml` file:

```toml
[server.advisor]
enabled = false
```

`enabled` defaults to `false`, including when an existing configuration omits the section. Administrators can also read and change the setting through `GET /api/advisor/status` and `PATCH /api/advisor/settings` with `{ "enabled": true }` or `{ "enabled": false }`. The setting update is persisted to the loaded server configuration. Disabling Advisor clears active in-memory history snapshots. Status and settings remain available when the feature is disabled; history operations return HTTP 403 (`code: "AdvisorDisabled"`, `error: "ADVISOR_DISABLED"`) until it is enabled.

## History source and status

Advisor reads the server process's `$HOME/.evcrate/advisor-history` directory. There is no custom-root setting, `/home` scan, directory registration, or path-hash prerequisite. Status returns `enabled`, `available`, and, for an administrator, the detected `path` and optional `sourceError`.

The final history-root component must be a real directory. The server inspects it with `symlink_metadata`; if the final component is a symlink, status reports the source unavailable with `History root must be a real directory; symlink rejected`. Missing or unreadable history is reported as unavailable rather than requiring registration or creating a directory.

## Access control

All `/api/advisor/*` routes require an ordinary validated authenticated session and the current enabled account's administrator role. Both supported session credentials (Bearer token and authentication cookie) use the normal REST authentication layer. `--no-auth` mode is explicitly denied; it does not grant Advisor administrator access.

See the [native Advisor API and migration architecture](../architecture/native-advisor.md#phase-02-native-history-rest-api) for endpoint bodies, history paging, and snapshot behavior.