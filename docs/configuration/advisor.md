# Native Advisor Configuration

The native Advisor is an opt-in, server-level feature. Configure it in the server's loaded `dam-hopper.toml` file:

```toml
[server.advisor]
enabled = false
```

`enabled` defaults to `false`, including when an existing configuration omits the section. Administrators can also read and change the setting through `GET /api/advisor/status` and `PATCH /api/advisor/settings` with `{ "enabled": true }` or `{ "enabled": false }`. The setting update is persisted to the loaded server configuration. Disabling Advisor clears active in-memory history snapshots. Status and settings remain available when the feature is disabled; history, policy, evaluation, and model-discovery operations return HTTP 403 (`code: "AdvisorDisabled"`, `error: "ADVISOR_DISABLED"`) until it is enabled.

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

## Model catalog discovery

Administrators can query the server's backend harness for its model catalog with `POST /api/advisor/models`. The feature must be enabled. The required JSON body contains only `backend`:

```json
{ "backend": "codex" }
```

Supported backend values are the lowercase strings `omp`, `codex`, `claude`, and `pi`. The server trims whitespace around the value; unsupported values return HTTP 400. Unknown request fields are rejected. The route uses the authenticated administrator access described below.

### Response

The camelCase `AdvisorModelsResultDto` contains:

| Field | Type | Meaning |
| --- | --- | --- |
| `backend` | string | Normalized supported backend name. |
| `source` | string | `harness` for a discovered catalog; `fallback` for the built-in catalog. |
| `models` | array | Each item has `id`, `label`, and `efforts` fields. |
| `efforts` | string array | Backend-level effort suggestions. |
| `defaultEffort` | string | Always `medium`. |
| `observedAt` | number | Observation time in Unix milliseconds. |
| `issueCode` | string, optional | A fallback reason or `HARNESS_CATALOG_TRUNCATED`; omitted when no issue is reported. |

A discovery failure or empty catalog still returns HTTP 200 with `source: "fallback"` and an `issueCode`; a non-empty truncated catalog returns `source: "harness"` with `HARNESS_CATALOG_TRUNCATED`. The fixed fallback entries are:

| Backend | Fallback model IDs (labels match IDs) | Backend effort suggestions |
| --- | --- | --- |
| `codex` | `gpt-6.1-sol` | `low`, `medium`, `high`, `xhigh` |
| `claude` | `sonnet`, `opus`, `haiku` | `low`, `medium`, `high`, `xhigh`, `max` |
| `omp` | `openai/gpt-6.1-sol`, `anthropic/claude-sonnet-5-5` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `pi` | `openai/gpt-6.1-sol`, `anthropic/claude-sonnet-5-5` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |

The service emits these `issueCode` values:

| Code | Meaning |
| --- | --- |
| `HARNESS_NOT_FOUND` | Backend executable was not found. |
| `HARNESS_DISCOVERY_TIMEOUT` | Waiting for a discovery slot or running discovery timed out. |
| `HARNESS_OUTPUT_LIMIT` | The runner reported an output-limit failure. |
| `HARNESS_DISCOVERY_UNSAFE` | The runner rejected execution as unsafe. |
| `HARNESS_DISCOVERY_FAILED` | Discovery execution failed. |
| `HARNESS_OUTPUT_INVALID` | Harness output could not be parsed. |
| `HARNESS_CATALOG_EMPTY` | No usable models were discovered. |
| `HARNESS_CATALOG_TRUNCATED` | The harness catalog was non-empty but truncated; `source` remains `harness`. |

Fallback model entries always use the listed backend effort suggestions for their `efforts`; discovered entries use model-specific efforts when present, otherwise backend-level suggestions. These fallback values are suggestions, not proof that a model is installed or usable by the server's account.

The request body is limited to 16 KiB; larger bodies return HTTP 413. Discovery permits at most two concurrent operations, with a five-second semaphore wait and a separate five-second runner timeout. Normalized catalogs are capped at 500 models; IDs and labels over 256 bytes are discarded, and the serialized model array is capped at 256 KiB. The [architecture reference](../architecture/native-advisor.md#harness-model-discovery) describes discovery adapters, diagnostics, stdout bounds, and normalization behavior.

## History source and status

Advisor reads the server process's `$HOME/.evcrate/advisor-history` directory. There is no custom-root setting, `/home` scan, directory registration, or path-hash prerequisite. Status returns `enabled`, `available`, and, for an administrator, the detected `path` and optional `sourceError`.

The final history-root component must be a real directory. The server inspects it with `symlink_metadata`; if the final component is a symlink, status reports the source unavailable with `History root must be a real directory; symlink rejected`. Missing or unreadable history is reported as unavailable rather than requiring registration or creating a directory.

## Access control

All `/api/advisor/*` routes require an ordinary validated authenticated session and the current enabled account's administrator role. Both supported session credentials (Bearer token and authentication cookie) use the normal REST authentication layer. `--no-auth` mode is explicitly denied; it does not grant Advisor administrator access.

See the [native Advisor API and migration architecture](../architecture/native-advisor.md#native-advisor-rest-api) for history endpoint bodies, paging, snapshots, and detailed model-discovery behavior.