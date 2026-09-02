# Research Report: Workflow-tracking domain and repository architecture

- **Research date:** 2026-09-01 (Asia/Saigon)
- **Scope:** one-developer, many-project workflow tracking inside the existing WorkspacePage; planning only.
- **Recommendation:** snapshot-first relational records plus a small append-only activity log. Do not introduce full event sourcing.

## Executive summary

DamHopper already centralizes a global project registry, git/worktree operations, interactive PTYs, workspace switching, agent configuration distribution, and a React UI backed by Rust/Axum. The missing product is continuity: after several terminals/projects/tasks are open, the developer cannot quickly answer “what am I doing, where is it checked out, which session owns it, and what was the last decision?”

Make the existing workspace overview the durable index. Store current project/task/session state for fast reads and user correction; append lightweight activity events for provenance and timeline display. Capture reliable lifecycle facts automatically (server timestamps, terminal/process start/exit, known worktree/path), while leaving semantic metadata (task title, plan/phase, status correction, note) explicit and editable. This is useful without pretending process telemetry is project truth.

## Repository evidence and constraints

- `README.md` describes the product as a multi-project development environment with global projects, bulk git, PTY terminals, git worktrees, workspace switching, multi-server profiles, and an agent store (Features section).
- `README.md` places all backend logic in `server/` (Rust Axum/Tokio) and the shared browser UI in `packages/ui`; `apps/web` is a thin host. The feature therefore belongs in the existing server/API and shared UI, not a new route/service.
- `packages/ui/src/components/pages/WorkspacePage.tsx` already composes `IdeShell`, `MobileWorkspaceShell`, `TerminalWorkspaceShell`, React Query, `api/client`, workspace/settings stores, terminal manager/registry, and project-target hooks. A workflow surface should reuse these boundaries and existing responsive shells.
- The page imports `terminal-registry`, `terminal-title`, traditional/active terminal displays, and lazy-loaded panels: terminal correlation can start from existing opaque runtime identifiers rather than inventing a second terminal model.

## Pain points and jobs-to-be-done

1. **Orient:** see every active project, branch/worktree, open terminal, current task/phase, and last note in one glance.
2. **Resume:** reopen the right project/worktree/terminal and recover the last decision without searching chat or shell scrollback.
3. **Switch safely:** park one project, mark its blocker, and move to another without losing status or timing.
4. **Measure lightly:** know when a session started/ended and distinguish active, stale, crashed, and manually abandoned work.
5. **Trust the record:** tell what was observed by DamHopper versus entered/corrected by the developer.

## Minimum useful information model

All IDs are stable opaque UUIDs; all server times are UTC/RFC3339 and rendered in the user locale.

- **WorkflowProject:** `id`, `workspace_id`, display `name`, repository/root path (or existing project ID), optional default branch, `status` (`active|paused|archived`), created/updated timestamps.
- **WorkItem:** `id`, `project_id`, optional `parent_id`, `kind` (`task|plan|phase`), title, short note, `status`, ordering, created/updated/completed timestamps. Keep hierarchy shallow; do not require a DAG.
- **WorkSession:** `id`, `project_id`, optional `work_item_id`, `started_at`, `ended_at`, `status` (`running|ended|abandoned`), source, and opaque terminal/worktree references. `ended_at` is nullable; a server restart must not erase it.
- **ResourceLink:** session-to-terminal and session-to-worktree links: opaque terminal ID, normalized worktree/repository path or existing worktree ID, first/last seen, link source. Permit `unknown` and explicit unlink; never identify solely by a mutable terminal title or CWD.
- **ActivityEvent:** `event_id` (idempotency key), `occurred_at`, `recorded_at`, actor/source (`manual|terminal|git|agent|system`), event type, target IDs, correlation/session ID, and allowlisted JSON payload. Events explain history; snapshots remain authoritative.
- **Note:** short durable text attached to project, item, or session, with author/source and timestamps. Do not store raw terminal output, prompts, environment, or credentials.

## Event vs snapshot decision

Use normalized current-state tables (projects, items, sessions, links, notes) for ordinary reads and edits. Append only small, typed activity events for start/end/status/link/note changes. A transaction updates the snapshot and inserts its event together where possible; API retries use `event_id`/idempotency keys. Rebuildable timeline projections are optional later.

Full event sourcing would make correction, querying the overview, migrations, retention, and privacy deletion harder; a snapshot-only design loses provenance and makes “why is this status?” opaque. The hybrid preserves auditability without requiring CQRS, replay infrastructure, or immutable user mistakes.

## Capture and lifecycle semantics

- **Automatic:** server-owned timestamps; terminal/process creation and exit; selected project/target; known worktree/repository identity; app disconnect/heartbeat where already available. Agent-harness capture is only an explicit adapter and allowlisted lifecycle metadata.
- **Manual:** project/item title, plan/phase hierarchy, semantic status, note/decision, session association correction, abandon/restore/archive. Always show source and permit correction rather than silently overwriting user intent.
- **Transitions:** project `active -> paused -> archived` (archive is soft and reversible); item `backlog|next -> in_progress -> blocked|done|canceled` with reopen to `in_progress`; session `running -> ended|abandoned`, where `abandoned` means no trustworthy exit was observed. Repeated start/end commands are idempotent.
- **Correlation:** create/start session with explicit project and optional item; attach existing terminal/worktree IDs when known. Do not infer a task from command text or agent prompts. A missing link is valid state, not an error.

## Preferred repository architecture and API

Add migrations/models/handlers to the existing Rust server persistence and Axum router; do not add a second database, service, websocket, or queue. Follow the repository’s current DB/migration and auth/profile conventions (the exact adapter should be confirmed during implementation). Keep events bounded and indexed by workspace/project/time.

Expose resource-shaped REST endpoints under the existing API prefix, e.g. `GET /workflows/overview?workspace_id=...`, CRUD for `/workflows/projects` and `/workflows/items`, `POST /workflows/sessions/start`, `POST /workflows/sessions/{id}/end`, and `POST /workflows/events` for already-observed server events. Return one overview DTO shaped for the panel; paginate older events/notes. Use React Query for server state and mutations; keep only filters/expanded panels in client stores. Mount a collapsible workflow panel/tab in `WorkspacePage` and feed both desktop and mobile shells; no route or navigation entry.

## Retention, privacy, and security boundaries

Treat paths, branch/worktree names, task notes, and agent metadata as potentially sensitive. Apply the existing server-profile/workspace authorization boundary to every read/write. Validate workspace/project ownership; never accept arbitrary filesystem paths for execution. Payload schemas are allowlists; redact env vars, tokens, command arguments, terminal transcripts, prompts, and file contents. Prefer local retention by default, soft-delete plus purge for notes/events, bounded event payload size, and configurable history duration. Record provenance, not hidden surveillance. Use parameterized DB queries and structured error responses; avoid exposing absolute paths across remote profile boundaries unless policy permits.

## Staged scope

**MVP:** overview panel in `WorkspacePage`; project/item/plan/phase CRUD; current status and short notes; manual session start/end; optional links to already-known terminal/worktree IDs; automatic timestamps; source labels; one overview query plus focused mutations; responsive desktop/mobile presentation.

**Next:** process exit/heartbeat reconciliation, stale-session/abandoned marking, git worktree attach/detach events, filters/search, event timeline pagination, and offline retry with idempotency keys.

**Later (explicitly gated):** harness-specific adapters, import/export, cross-device sync, reminders, aggregate time analytics, and richer dependency visualization.

**Non-goals:** new route/navigation, replacing the project registry or terminal manager, full issue tracker/calendar, arbitrary workflow DAG, raw telemetry/log warehouse, automatic task inference, AI summaries, or cross-user collaboration.

## Failure modes and mitigations

- Terminal/process crashes: leave session `running` until heartbeat timeout, then mark `abandoned`; never fabricate an end time.
- Duplicate/retried events: client/server idempotency key and unique constraint; snapshot transition must be safe to repeat.
- Stale or reused terminal/worktree IDs: attach by stable runtime ID plus observed timestamps; show “unknown/stale” and allow unlink.
- Offline UI or server restart: optimistic UI only for presentation; retry mutations with idempotency; server remains authority.
- Clock skew/time-zone confusion: record server UTC, display locale, and distinguish `occurred_at` from `recorded_at`.
- Deletion/privacy request: cascade or tombstone links/events and purge payloads without retaining secret-bearing history.

## Rejected over-engineering

Full event-sourced/CQRS architecture; microservices or a separate telemetry pipeline; background agent prompt scraping; filesystem-wide watcher; automatic semantic task classification; mandatory perfect terminal/worktree matching; time-tracking billing reports; and a bespoke client-side database. Each adds operational/privacy cost before the orientation and resume jobs are proven.

## Sources

- Repository: `README.md`; `packages/ui/src/components/pages/WorkspacePage.tsx` (observed imports/composition).
- Git worktree reference: <https://git-scm.com/docs/git-worktree>.
- SQLite transaction semantics (relevant if the existing adapter is SQLite): <https://sqlite.org/lang_transaction.html>.
- OWASP Logging Cheat Sheet (data minimization, sensitive-data handling): <https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html>.
- W3C Trace Context (correlation-ID concepts): <https://www.w3.org/TR/trace-context/>.

## Unresolved questions

1. Which existing server DB adapter and migration mechanism should own these tables, and what auth/profile key is authoritative for workspace isolation?
2. Are terminal runtime IDs and worktree IDs stable across reloads/restarts, or must the server mint durable link IDs?
3. What existing process-exit/heartbeat events are exposed to the Axum layer, and can they be reused without adding polling?
4. Should notes/events sync across configured remote server profiles, or remain profile-local by default?
5. What retention/purge controls and path-redaction policy does the product owner require for shared/remote profiles?
