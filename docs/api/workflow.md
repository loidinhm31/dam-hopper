# Workflow Tracking Service and REST API

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

Workflow lifecycle facts stay on a server-internal bounded observation path:
the PTY manager uses `try_send` into `sync_channel(256)`, and a worker applies
allowlisted link-state updates in SQLite. The payload excludes command lines,
arguments, CWD, environment, prompts, and terminal output. There is no generic
observation-ingestion endpoint. `attached`, `stale`, `exited`, `crashed`, and
`detached` are observed terminal-link states; an observation can suggest an end
time but cannot end or abandon the manual workflow session.
