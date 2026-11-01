# Lightweight Tool-Event Session Changes & Managed Extension Toggle

Status: **Approved design; not implemented.** User explicitly selected "Approve this design" after choosing Option 3 (Pure Tool-Event Tracking), Default OFF (`false`), and Approach 1 (Physical Add on ON / Remove on OFF of a separate `dam-hopper-session-changes.ts` extension file).

## Problem and Final Artifact

PR #81 (`plans/261030-1215-session-changes-panel/plan.md`) implemented Session Changes using whole-repository directory walks (`capture_inventory`), eager reading of all eligible repository files into RAM at session start and on every settled turn, and a 100k-node `AbsenceTrie` (`absence.rs`). Because DamHopper's primary mission is hosting persistent PTYs for AI agent harnesses (`omp`, `claude`, `codex`)—often with zero connected browser clients—background full-repo scans and eager diffing impose unnecessary server CPU, I/O, and memory load.

Approved artifact (in-place refactor on `feat/session-changes-omp`):
1. **Default-OFF Server Setting & Physical Extension Lifecycle:** Server-scoped ON/OFF toggle on `SettingsPage` (`session_changes_enabled`, default `false`). Toggling **ON** installs a dedicated managed extension `~/.omp/agent/extensions/dam-hopper-session-changes.ts` and enables the server tracking service. Toggling **OFF** removes `dam-hopper-session-changes.ts` from disk, disables private tracking routes, and purges all retained session-changes RAM/TempDir data. `dam-hopper-agent-status.ts` reverts to pure Agent Status / Notification reporting.
2. **Event-Driven Per-File Baseline Capture:** `dam-hopper-session-changes.ts` hooks OMP `tool_call` and `tool_result` across main and rebound in-process `task` subagents. Before the first supported edit (`write`, `edit`, concrete-path `ast_edit`) to a path, it calls `/private/session-changes/v1/capture` so the server snapshots only that file's pre-edit bytes (or `Absent` if `ENOENT`).
3. **Zero Background Diffing on Settled Turns:** `POST /settled` and `GET /status` perform zero file reads and zero diff calculations. Diffs and current-file reads execute lazily only when a browser client opens the panel (`GET /files`, `POST /refresh`, `GET /files/{fileId}`).

## Scope and Constraints

In scope:
- Separate managed OMP extension asset `server/src/agent_status/assets/omp-session-changes.ts` installed to `extensions/dam-hopper-session-changes.ts` when enabled and removed when disabled.
- Revert `server/src/agent_status/assets/omp-agent-status.ts` to status-only reporting (no session-changes barrier/hooks).
- Delete `server/src/session_changes/absence.rs`, `absence_tests.rs`, and recursive directory traversal in `inventory.rs`.
- Per-file pre-edit snapshot capture (`write`, Hashline `edit` including `MV`/`REM`, concrete-path `ast_edit`) across root and in-process `task` subagents.
- Lazy comparison and line-stat calculation only on explicit viewer queries (`GET /files`, `POST /refresh`, `GET /files/{fileId}`).
- Server-owned setting (`session_changes_enabled`, default `false`) in `SettingsPage` scoped to `targetOwner` (**Settings Target Server**).

Out of scope:
- Whole-repository scanning or directory-tree absence proofs.
- Capturing arbitrary `bash` / `eval` script mutations (covered by existing `GitLocalChanges` panel).
- Retroactive capture of edits made while the setting was OFF or before the extension was loaded by OMP.

Constraints:
- **Harness safety (fail-open):** Pre-edit capture in `tool_call` enforces a strict $\le 1.5\text{ s}$ timeout; any timeout/error allows the tool to run immediately and marks the path `originalPresence: 'unknown'` (`unproven`).
- **Bounds:** Max $2\text{ MiB}$ per captured file, max $64\text{ MiB}$ global retained baseline storage across up to 32 sessions, max 500 tracked files per session.
- **Restart requirement on OFF $\rightarrow$ ON:** Because OMP loads `~/.omp/agent/extensions/*.ts` at session startup, turning the setting ON installs the file immediately for new/restarted OMP sessions; turning OFF takes effect immediately for both running and future sessions (server rejects producer requests and purges memory, plus deletes the extension file).

## Options and Decision Rationale

| Option | Pros | Cons | Decision |
| :--- | :--- | :--- | :--- |
| PR #81 Whole-Repo Snapshot + `AbsenceTrie` | Catches `bash` edits without Git | High server RAM/I/O; rescans repo on every turn even with no viewer | Rejected (replace) |
| Option 1: Git-Assisted Hybrid Baseline | 0 clean file reads; catches `bash` | Still runs `git2` status/diff and tracks workspace-wide changes | Rejected |
| Option 2: Git-Assisted + Tool Attribution | Distinguishes tool vs shell edits | Higher complexity than pure tool tracking | Rejected |
| Option 3: Pure Tool-Event Tracking + Physical Extension Toggle | Zero scan; zero work when OFF or unviewed; clean separation from `omp-agent-status.ts` | Requires OMP restart on OFF $\rightarrow$ ON; `bash` edits reviewed in Git Changes panel | **Approved** |

## Touchpoints and Behavior

- `server/src/config/schema.rs` & `server/src/api/config.rs`: add server-owned `session_changes_enabled: bool` (default `false`); on toggle ON/OFF, invoke managed install/uninstall for `dam-hopper-session-changes.ts` and clear `SessionChangesService` state when disabled.
- `server/src/agent_status/integration.rs`: add managed install/uninstall/status helpers for `extensions/dam-hopper-session-changes.ts` with SHA-256 ownership header verification (never overwrite/delete user-modified files).
- `server/src/agent_status/assets/omp-session-changes.ts` (new) & `omp-agent-status.ts`: move session-changes registration and `tool_call`/`tool_result` hooks into `omp-session-changes.ts`; correlate in-process `sub` (`task`) agents to the root `ompSessionId` fenced by `(serverEpoch, terminalIncarnation, ompSessionId)`.
- `server/src/session_changes/`:
  - Delete `absence.rs` and `absence_tests.rs`.
  - Refactor `capture.rs`, `inventory.rs`, `comparison.rs`, `control.rs`, `store.rs`, `types.rs` to per-file `capture` (pre-edit snapshot once per path), metadata-only `settled` / `status`, and lazy `files` / `file_detail` evaluation.
- `packages/ui/src/components/pages/SettingsPage.tsx` & `packages/ui/src/components/organisms/SessionChangesPanel.tsx`: target-server-scoped ON/OFF toggle (with notice that enabling requires restarting active OMP sessions); hide/disable terminal Session Changes trigger when disabled; update panel copy to describe tool-observed edits.

## Feasibility and Stakeholders

- **Users / Operators:** Zero background server tax by default; when enabled, server only snapshots files actually edited by OMP tools and only computes diffs when a user opens the panel.
- **Developers / Maintainers:** Removes `AbsenceTrie`, full-repo walkers, and complex 3-phase scan barriers; isolates Session Changes from Agent Status extension stability.

## Acceptance Criteria and Validation

1. **Default OFF & Physical Toggle Lifecycle:** Server starts with `session_changes_enabled = false` and `dam-hopper-session-changes.ts` absent. Toggling ON writes `~/.omp/agent/extensions/dam-hopper-session-changes.ts` with managed headers; toggling OFF deletes the file, rejects private producer calls, and frees all retained `SessionChangesService` bytes.
2. **Agent Status Isolation:** Toggling Session Changes ON/OFF leaves `dam-hopper-agent-status.ts` intact and does not disrupt OMP agent status or notifications.
3. **Zero Unviewed Comparison Work:** With Session Changes ON and no client calling `GET /files` or `POST /refresh`, `session_start`, `POST /settled`, and `GET /status` perform zero file content reads and zero line-diff calculations.
4. **Accurate Per-File Capture & Subagent Coverage:** First edit via `write`, multi-file Hashline `edit` (`PUT`, `CUT`, `MV`, `REM`), concrete-path `ast_edit`, or in-process `task` subagent captures exact pre-edit bytes (or `Absent` for new files); subsequent edits to the same file do not overwrite the baseline; reverting a file removes it from the changed list.
5. **Fail-Open & Unknown Provenance:** Simulated `/capture` timeout or glob `ast_edit` path discovered only at `tool_result` does not block tool execution and records `originalPresence: 'unknown'` (`unproven`), never fabricated `Absent`.

## Risks and Dependencies

- **Active OMP sessions on OFF $\rightarrow$ ON:** OMP loads extensions at startup; UI toggle feedback must explicitly state "Restart active OMP sessions to load the Session Changes extension."
- **Locally modified extension file:** Managed installer/uninstaller must refuse to overwrite or delete a locally modified `dam-hopper-session-changes.ts` and surface the conflict in Settings.

## Evidence

- `server/src/session_changes/inventory.rs:36-327`, `comparison.rs:15-145`, `absence.rs`: confirmed whole-repo byte reads and `AbsenceTrie` overhead in PR #81.
- `server/src/agent_status/integration.rs:17-86`, `api/agent_status.rs:385-418`: confirmed existing managed OMP extension install/uninstall pattern and hash ownership checks.
- `/home/loidinh/WS/oh-my-pi/packages/coding-agent/src/extensibility/extensions/wrapper.ts:281-310,520-543`, `types.ts:546-568,1500-1602`, `edit/index.ts:255-282`, `tools/ast-edit.ts:46-53`: verified OMP `tool_call` (awaited pre-execution) and `tool_result` lifecycle hooks, `EditToolDetails`, and child-agent extension rebinding.

## Unresolved Questions

None.
