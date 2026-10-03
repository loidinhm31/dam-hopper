# Native Advisor Configuration

The native Advisor is an opt-in, server-level feature. Configure it in the server's loaded `dam-hopper.toml` file:

```toml
[server.advisor]
enabled = false
```

`enabled` defaults to `false`, including when an existing configuration omits the section. Administrators can also read and change the setting through `GET /api/advisor/status` and `PATCH /api/advisor/settings` with `{ "enabled": true }` or `{ "enabled": false }`. The setting update is persisted to the loaded server configuration. Disabling Advisor clears active in-memory history snapshots. Status and settings remain available when the feature is disabled; history, policy, and evaluation operations return HTTP 403 (`code: "AdvisorDisabled"`, `error: "ADVISOR_DISABLED"`) until it is enabled.

## Account policy route update

`POST /api/advisor/policy/current` reads the account routing policy. `PATCH /api/advisor/policy` updates the primary and backup route targets in the existing `$HOME/.evcrate/advisor-routing.json` file. It preserves the policy's `wait` and `history` settings; it does not create a missing file. The file must contain a valid version 2 policy.

Send the revision returned by the current-policy read:

```json
{
  "expectedRevision": "<64-character lowercase SHA-256 hex>",
  "advisor": {
    "primary": {
      "backend": "codex",
      "model": "model-name",
      "effort": "high"
    },
    "backup": {
      "backend": "claude",
      "model": "model-name",
      "effort": "medium"
    }
  }
}
```

Each route target requires `backend`, `model`, and `effort`; supported backends are `claude`, `codex`, `pi`, and `omp`. The primary and backup targets cannot be identical. `expectedRevision` is the lowercase SHA-256 digest of the exact current policy-file bytes.

### Response

The endpoint returns `PolicyReadCurrentResultDto`, also used by `POST /api/advisor/policy/current`:

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | string | Successful update: `ready`. |
| `scope` | string | `account`. |
| `temporal` | string | `current`. |
| `observedAt` | number | Observation time in Unix milliseconds. |
| `revision` | string | SHA-256 digest of the persisted policy bytes. |
| `policy` | object, optional | Version 2 policy: `version`, `advisor` (`primary` and `backup` route targets), `wait` (`mode`, `warnAfterMs`, `warnEveryMs`), and `history` (`retentionDays`, `maxBytes`). |
| `issueCode` | string, optional | Present when the policy cannot be returned as ready; omitted when absent. |

The request body and stored policy file are each limited to 16 KiB. Oversize request bodies return HTTP 413. Updates are serialized by the server and use revision compare-and-swap; the secure file helper also checks that the target bytes still match before replacement. A stale revision returns HTTP 409 with `code: "POLICY_REVISION_CONFLICT"`; read the current policy again before submitting a new update.

Persistence uses a same-directory temporary file and atomic replacement. On Unix, the secure-path helper opens the directory and policy file with `O_NOFOLLOW`, creates an exclusive owner-only (`0600`) temporary file with `O_NOFOLLOW`, syncs the replacement, atomically renames it over the policy, and syncs the containing directory.

## History source and status

Advisor reads the server process's `$HOME/.evcrate/advisor-history` directory. There is no custom-root setting, `/home` scan, directory registration, or path-hash prerequisite. Status returns `enabled`, `available`, and, for an administrator, the detected `path` and optional `sourceError`.

The final history-root component must be a real directory. The server inspects it with `symlink_metadata`; if the final component is a symlink, status reports the source unavailable with `History root must be a real directory; symlink rejected`. Missing or unreadable history is reported as unavailable rather than requiring registration or creating a directory.

## Access control

All `/api/advisor/*` routes require an ordinary validated authenticated session and the current enabled account's administrator role. Both supported session credentials (Bearer token and authentication cookie) use the normal REST authentication layer. `--no-auth` mode is explicitly denied; it does not grant Advisor administrator access.

See the [native Advisor API and migration architecture](../architecture/native-advisor.md#phase-02-native-history-rest-api) for endpoint bodies, history paging, and snapshot behavior.