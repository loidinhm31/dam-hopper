# Advisor and Workflow APIs

Native Advisor and workflow route contracts moved from the [API reference index](../api-reference.md).
## Native Evcrate Advisor API

Native Advisor provides built-in Evcrate Advisor history, current account policy, and evaluation comparison inside Workspace. Routes are mounted under `/api/advisor/*` and require an authenticated administrator. `--no-auth` requests are denied with HTTP 403 (`NoAuthForbidden`). Status and settings remain available while the feature is disabled; history, policy, and evaluation data routes require `server.advisor.enabled`.

The history source is `$HOME/.evcrate/advisor-history` in the server process environment. The final path component must be a real directory; symlinks are rejected as unavailable (`History root must be a real directory; symlink rejected`).

### Advisor endpoints

| Method and path                         | Request                                                                      | Success result                                                                                        | Notes                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/advisor/status`               | none                                                                         | `{ enabled, available, path?, sourceError? }`                                                         | Available while disabled; a final-component history-root symlink is reported unavailable.                            |
| `PATCH /api/advisor/settings`           | `{ enabled: boolean }`                                                       | `{ enabled: boolean }`                                                                                | Persists `server.advisor.enabled`; disabling clears active snapshots.                                                |
| `POST /api/advisor/history/refresh`     | Optional `{ projectId? }`                                                    | `{ state, snapshotId?, observedAt, scan, staleReason?, inventory? }`                                  | Scans the history root; creates a user-owned snapshot when available.                                                |
| `POST /api/advisor/history/summary`     | `{ snapshotId, query? }`                                                     | `{ state, snapshotId, metrics, inventory }`                                                           | Filtered aggregate metrics and project inventory.                                                                    |
| `POST /api/advisor/history/page`        | `{ snapshotId, query?, sort?, cursor?, limit? }`                             | `{ state, snapshotId, entries, nextCursor, returnedBytes }`                                           | Page size defaults to 100 and is capped at 500; continuation cursor is HMAC-signed.                                  |
| `POST /api/advisor/history/detail`      | `{ snapshotId, recordRef }`                                                  | `{ status, snapshotId, recordRef, detailRevision?, observedRevision?, execution?, outcome? }`         | Rechecks captured file integrity; status is `ready`, `changed`, or `missing`.                                        |
| `POST /api/advisor/policy/current`      | Optional `{}`                                                                | `{ status, scope, temporal, observedAt, revision, policy?, issueCode? }`                              | Reads current account policy from `$HOME/.evcrate/advisor-routing.json`.                                             |
| `PATCH /api/advisor/policy`             | `{ expectedRevision, advisor: { primary, backup } }`                         | `{ status, scope, temporal, observedAt, revision, policy?, issueCode? }`                              | Atomically updates primary and backup routes in `$HOME/.evcrate/advisor-routing.json`. 16 KiB limit, CAS validation. |
| `POST /api/advisor/models`              | `{ backend: "claude" \| "codex" \| "pi" \| "omp" }`                          | `{ backend, models, efforts, defaultEffort, source, issueCode?, observedAt }`                         | Discovers available model options and effort levels for the harness, with fallback catalogs. 16 KiB limit.           |
| `POST /api/advisor/evaluations/list`    | Optional `{ target?, cursor?, limit? }`                                      | `{ status, observedAt, bindingRevision, items, nextCursor? }`                                         | Discovers available evaluation runs from project and global locations.                                               |
| `POST /api/advisor/evaluations/read`    | `{ evaluationRef, target?, expectedRevision? }`                              | `{ status, descriptor?, document?, evaluationRef?, observedRevision? }`                               | Status is `ready`, `changed`, or `missing`; revision is checked when supplied.                                       |
| `POST /api/advisor/evaluations/compare` | `{ items: [{ evaluationRef, expectedRevision }], target?, cursor?, limit? }` | `{ status, sourceRevisions, groups, nextCursor?, returnedBytes?, evaluationRef?, observedRevision? }` | Requires 1–32 items; groups compatible evaluation documents.                                                         |

### Query filters and pagination

`query.filters` supports arrays `statuses`, `outcomeStates`, `outcomeResults`, `backends`, `models`, `efforts`, `promptIdentities`, and `buildIdentities`, plus numeric `startedAtFrom` / `startedAtTo` bounds. Advisor history and evaluation JSON routes have a 64 KiB request-body limit; policy update and model discovery have a strict 16 KiB body limit.

### Policy update and model discovery errors

- **`400 Bad Request`**: `ROUTE_SCHEMA_INVALID` (malformed revision or missing fields), `ROUTE_ENTRY_INVALID` (unsupported backend, invalid effort, or missing provider prefix for OMP/Pi), `ROUTE_BACKUP_IDENTICAL` (primary and backup route triples are identical), `POLICY_NOT_EDITABLE` (missing policy file, migration required from V1, or non-ready status), `POLICY_FILE_UNSAFE` (symlink in target file or parent `.evcrate` directory, non-regular file, or stored policy file exceeding 16 KiB limit).
- **`409 Conflict`**: `POLICY_REVISION_CONFLICT` (submitted `expectedRevision` does not match the on-disk SHA-256 digest).
- **`413 Payload Too Large`**: Request body exceeds 16 KiB limit (`RequestBodyLimitLayer`).
- **`403 Forbidden`**: `NoAuthForbidden` (`--no-auth` mode active), `AdminRoleRequired` (non-admin account), or `ADVISOR_DISABLED` (feature toggle disabled).
- **`500 Internal Server Error`**: `POLICY_WRITE_FAILED` (replacement serialization or atomic rename failure).

When the Advisor feature is disabled via `PATCH /api/advisor/settings` or server configuration (`[server.advisor] enabled = false`), data routes return HTTP 403 (`code: "AdvisorDisabled"`, `error: "ADVISOR_DISABLED"`).

> **Historical Notice (Retired Plugin APIs):** The former `/api/plugins/*` and `/api/plugins/admin*` endpoints have been deleted as part of the complete plugin-platform retirement (2026-10-02).

## Workflow Tracking Service and REST API (Phase 03)

Workflow routes are protected by the normal `/api/*` authentication layer and
share the configured SQLite session database. The route group covers:

- `GET /api/workflow/overview`
- `GET /api/workflow/events`
- `POST /api/workflow/items`; `PATCH /api/workflow/items/{id}`; `DELETE /api/workflow/items/{id}`
- `POST /api/workflow/sessions`
- `POST /api/workflow/sessions/{id}/end`; `POST /api/workflow/sessions/{id}/abandon`
- `POST /api/workflow/sessions/{id}/links`; `DELETE /api/workflow/sessions/{id}/links`
- `POST /api/workflow/notes`; `DELETE /api/workflow/notes/{id}`
- `DELETE /api/workflow/history`

Requests use strict camelCase DTOs, UUID `requestId` replay keys, and
RFC3339 timestamps. Item and note/link deletes plus item updates use
optimistic `updatedAt` CAS. Terminal links are checked against the live PTY's
project, registered worktree, and incarnation. Agent links accept only the
bounded manual `harnessLabel` (64 characters) and `runId` (128 characters).
See the dedicated [Workflow API reference](../workflow-api.md) for complete
request/response fields, target rules, lifecycle states, retention, and
examples.

Phase 03 lifecycle facts stay on a server-internal bounded observation path:
the PTY manager uses `try_send` into `sync_channel(256)`, and a worker applies
allowlisted link-state updates in SQLite. The payload excludes command lines,
arguments, CWD, environment, prompts, and terminal output. There is no generic
observation-ingestion endpoint. `attached`, `stale`, `exited`, `crashed`, and
`detached` are observed terminal-link states; an observation can suggest an end
time but cannot end or abandon the manual workflow session.


