# Native Advisor — frozen contract and migration architecture

Status: **Phase 01 native contract/parity and Phase 02 history/API implementation and finalization settled; durable completion remains pending (neither phase is DONE).** (2026-10-02).
Native Workspace UI cutover, policy/evaluation endpoints, plugin/service/release retirement, and production qualification remain later-phase work. See the [Phase 01 parity baseline](../../plans/261002-0246-native-advisor-migration/reports/native-contract-and-parity.md), [Phase 02 plan](../../plans/261002-0246-native-advisor-migration/phase-02-native-history-domain-and-api.md), and [migration plan](../../plans/261002-0246-native-advisor-migration/plan.md).

## Frozen decisions

- User confirmed entire Dam-Hopper plugin platform retirement, not merely Advisor extraction.
- User confirmed per-server persisted admin setting for feature enablement.
- Native means Rust/Axum domain service plus React components inside the existing Workspace; not a separate native desktop application.
- Preserve Evcrate core Advisor execution, policy/settings producers and history format. Retain only currently supported non-plugin viewer behavior; do not restore removed historical standalone picker. Remove Dam-Hopper plugin integration and its packaging/release artifacts.
- History root: server process `HOME` joined with `.evcrate/advisor-history`. Producer spelling is `advisor-history`; request's `avisor-history` treated as typo.
- No `/home` scan, registered paths, root-identity admission, grant matrix, project bindings, plugin package, runner, Node worker, or iframe.
- Validation removed hashing UI entirely. No path SHA-256 generation/copy/field or admission check. Keep producer project_id/checkpoint/document revision/cursor hashes, which are independent domain identities.

## Phase 01: frozen contract and parity baseline

The linked report is the detailed contract and acceptance record; this page summarizes the architecture. It freezes native endpoints and DTOs, authorization and ownership, source discovery, resource bounds, UI cutover, and plugin-retirement/rollback boundaries.

Synthetic fixtures under `__fixtures__/native-advisor/` are checked by `scripts/test-native-advisor-parity.mjs` against canonical Evcrate providers. The observed baseline run passed **16/16 checks**, covering history diagnostics and inventory, pagination and cursor integrity, detail reread, policy statuses, evaluation list/read/compare, and root-symlink/status invariants. This records source-observable parity; it does not prove native API/UI implementation or production qualification.

## Phase 02: native history domain and API

The Rust implementation in `server/src/advisor/` owns history scanning, diagnostics and metrics, root status, and per-authenticated-user snapshots used by summary, paging, and detail requests. `server/src/api/advisor.rs` exposes this domain; `AppState` captures the source HOME and serializes setting updates.

The source is the server process's `$HOME/.evcrate/advisor-history`. Status uses `symlink_metadata` on the final root and reports a final-component symlink as unavailable. There is no custom root, `/home` scan, or path-hash admission. `[server.advisor].enabled` defaults to `false`; disabling the feature clears active snapshots.

## Pre-migration source evidence

- `packages/ui/src/components/organisms/WorkspaceAdvisorHost.tsx`: persistent workspace placement currently wraps `PluginHost`.
- `packages/ui/src/components/pages/SettingsPage.tsx`: Plugin Platform registration section.
- `packages/ui/src/components/pages/settings-page/PluginAccessModal.tsx`: current path SHA-256 generation.
- `server/src/api/plugin_admin.rs::advisor_history_probe_handler`: HOME plus `/home` scan and canonical/symlink admission.
- `server/src/api/auth.rs::require_plugin_admin`: the pre-migration live enabled-user admin check; Phase 02 generalizes it as `require_admin` for native Advisor routes.
- Evcrate `plugin/ui/plugin-main.tsx`: imports `viewer/src/app.tsx`, port provider, global CSS.
- Evcrate `plugin/manifest.json`: eight read/refresh capabilities; no history/policy/evaluation write operation.
- `server/src/linux_release/state_record.rs`: strict records contain runner/plugin metadata; raw field deletion breaks existing state.
- `deploy/systemd/dam-hopper-api.service.in`, `server/src/linux_release/unit_policy.rs`: API/helper share plugin-named runtime directory setup; must preserve non-plugin IPC.

## Native ownership and dataflow

1. Settings target profile resolves a captured `ConnectionRef`; admin reads/updates that server's Advisor setting.
2. Persist `server.advisor.enabled` in the server config file currently loaded by the process; it defaults false. Narrow native setting endpoint; preserve unrelated TOML and atomic write behavior.
3. Workspace uses selected project's profile/connection as data owner, independently of Settings/preference selectors. Without a project, use explicitly selected connected profile; no arbitrary first-connected fallback.
4. Native status returns configured `enabled`, real-directory `available`, admin-only detected path and explicit source errors; no hash fields.
5. Native typed client → `/api/advisor/*` → current auth/admin guard → native service → HOME-root history, HOME account policy and current reader evaluation discovery.
6. Native React panel reuses Evcrate views/selectors/reducer/domain formatting; replace MessagePort provider with captured owner-bound API adapter and abortable operations.
7. Preserve one mounted panel across IDE, Terminal float, compact placement; retain source view/filter/snapshot state without an iframe or nested React root.
8. Disabled, role-lost, disconnected, or owner-replaced panel clears inaccessible data and stops requests; late responses cannot resurrect previous owner data.

## API and authorization invariants

- Phase 02 implements status, toggle, and the four history operations (refresh, summary, page, detail). Current policy and evaluation list/read/compare are Phase 03 work.
- Native status/settings routes work for admins even when disabled or history missing; enable toggle never requires folder creation or plugin registration.
- Data routes require enabled feature and current admin authorization. Status conveys availability; missing source is explicit empty/not-configured state where source contract defines it.
- Native routes use `require_auth` plus generalized `require_admin`; the enabled account's admin role is checked per request. Keep ordinary validated sessions and deny `--no-auth`; do not transplant plugin-only bearer admission or a static admin allowlist.
- No path hash utility or root-identity admission field.
- No custom root API. Require a real final history-root directory (root symlink rejected per user validation). Do not add canonical-equals-input, ancestor-symlink, UID or grant restrictions. Validate record/evaluation IDs within resolved source roots.
- Source is read-only: no new delete/import/policy edit API. Refresh mutates in-memory snapshots only. Only requested configuration mutation is enable/disable.
- Bound pages, comparison workload, source file sizes, and blocking scans; reuse source limits. Do not rebuild entire history for every summary/page/detail request.
- Snapshot/cursor ownership includes authenticated subject and server-side source/filter identity; never reuse snapshot from another owner or incompatible query.
- Preserve history format discrimination, provenance, stale/not-configured/error distinctions and comparison eligibility. Full port evidence belongs in plan research/contracts.

## Phase 02 native history REST API

The current native API uses camelCase JSON. Every route requires a normal validated session plus the current administrator role; Bearer tokens and the authentication cookie use the ordinary REST authentication layer. `--no-auth` is denied. Status and settings remain usable while disabled or while the history root is unavailable; history operations require `server.advisor.enabled`. JSON mutation/history bodies are capped at 64 KiB.

| Method and path | Request | Result |
| --- | --- | --- |
| `GET /api/advisor/status` | None | `{ enabled, available, path, sourceError }`; a final-root symlink is reported unavailable with `sourceError`. |
| `PATCH /api/advisor/settings` | `{ enabled }` | `{ enabled }`; persists the server setting and clears active snapshots when disabled. |
| `POST /api/advisor/history/refresh` | Optional `{ projectId? }` | Scan summary and inventory; creates a user-owned snapshot when available. |
| `POST /api/advisor/history/summary` | `{ snapshotId, query? }` | Filtered aggregate metrics and project inventory. |
| `POST /api/advisor/history/page` | `{ snapshotId, query?, sort?, cursor?, limit? }` | Page entries, next cursor, and returned byte count. |
| `POST /api/advisor/history/detail` | `{ snapshotId, recordRef }` | Sanitized detail with status `ready`, `changed`, or `missing`. |

`query` contains optional `projectId`, `taskRunId`, and `filters`; `query.filters` supports `statuses`, `outcomeStates`, `outcomeResults`, `backends`, `models`, `efforts`, `promptIdentities`, `buildIdentities`, `startedAtFrom`, and `startedAtTo`. Page sorting defaults to `started_at_desc`; the page size defaults to 100 and is capped at 500. Continuation cursors are HMAC-signed and bound to the snapshot/query. The detail endpoint rechecks captured file fingerprints before returning content. The [Advisor configuration reference](../configuration/advisor.md) documents the default and source-discovery boundary.

## UI cutover invariants

- One admin settings toggle and detected directory status. No hashing field/button, registration, grant editor or project binding modal.
- All Workspace launchers and tool arrays use the same enable/admin visibility predicate, including terminal shortcuts and restored compact/right-tool state.
- Tabs remain panel-local; copied `hash-view.ts` must not overwrite Dam-Hopper route hash or navigate away from Workspace.
- Scope copied `:root`, `body`, `*`, responsive rules, variables, and class names under the Advisor root; preserve app theme and neighboring controls.
- Native direct callbacks replace activate/dismiss MessagePort events. Escape/focus return continue to use Workspace placement.
- No runtime imports or build-time dependencies into sibling Evcrate checkout.

## Plugin/deployment cutover

- Prove native read/UI parity before deleting Evcrate source integration or Dam-Hopper platform consumers.
- Remove SDK/runtime/worker binaries, API/plugin WS messages and epochs, host iframe bridge, registration UI, tests/fixtures, package scripts, plugin archives and upload/install requirements.
- Preserve auth session/MFA watchers, general connection generations, PTY/filesystem websocket pumps, and non-plugin Vite/extension/agent plugins.
- Replace plugin-named shared runtime tmpfiles/group with native API/helper runtime ownership. Preserve `/run/dam-hopper/server.pid` and idle-suspend socket semantics.
- Migrate strict manager state and host config before removing plugin metadata types; back up, normalize once, preserve unrelated release records, reject corrupt/unknown state.
- Native manager rejects plugin-bearing legacy rollback before mutation. Preserve immutable old releases and backup old manager/state for explicit manual legacy recovery; new rollback/recovery never restarts obsolete runner.
- Manual cleanup script: inspect/dry-run by default; explicit apply; stop/disable verified system or selected user's runner unit, kill only verified runner-owned descendants, remove verified obsolete files. Never broad `pkill`, home removal, account deletion, history deletion, or deletion of current/retained immutable release contents.
- Fully purge only proven plugin registry/runtime artifacts. Custom users/groups and unrelated `/run/dam-hopper` resources survive. Coordinate cleanup with release manager's lock/state migration and updated API/helper unit provisioning.

## Verification gates

- Real temporary HOME with durable V1 producer history/V2 checkpoints, account policy and discovered evaluation documents; authenticated native server and real browser.
- Admin/non-admin/no-auth/role downgrade, missing/unreadable/empty real history directory and root-symlink rejection, multi-project filters, stale snapshot/cursor, corrupt/unsupported record, captured-owner switching/cancellation.
- IDE/Terminal/compact, keyboard/focus/resize, theme/CSS isolation, reload-persisted toggle, independent Settings versus Workspace profiles, no iframe or plugin/network-worker traffic.
- Fresh install, upgrade from plugin-bearing manager state, repeated uninstall, rollback and crash recovery; API/PTYS/filesystem/idle-suspend still work without runner or bundled Node.
- Release assembly and inventories succeed in both repositories without plugin assets; core Evcrate Advisor still produces history readable by native viewer.

## Unresolved questions

- No open user scope decisions. Evaluation-writer convention remains unverified; Phase 03 policy/evaluation implementation, native UI cutover, platform retirement, and full production qualification remain later-phase work.
