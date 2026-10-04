# Native Advisor — frozen contract and migration architecture

Status: **Native implementation and Phase 09 qualification evidence recorded.** Durable completion receipts for Phases 01–05 remain parent-coordinated; Phases 06–08 have published receipts. (2026-10-02).
The native Advisor domain service, UI panel/provider, and settings toggle are integrated into Workspace; the plugin platform, runner daemon, SDK, and Evcrate plugin release assets are retired. See the [migration plan](../../plans/261002-0246-native-advisor-migration/plan.md), [progress overview](../../plans/261002-0246-native-advisor-migration/progress.md), and [qualification report](../../plans/261002-0246-native-advisor-migration/reports/qualification.md).

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

## Phase 03: policy and evaluation reads & routing editor

Native account policy routes expose current policy (`POST /api/advisor/policy/current`) and update its primary and backup routes (`PATCH /api/advisor/policy`); model discovery routes expose harness-catalog options and fallbacks (`POST /api/advisor/models`); evaluation routes provide discovery, revision-checked reads, and comparisons (`POST /api/advisor/evaluations/list`, `POST /api/advisor/evaluations/read`, `POST /api/advisor/evaluations/compare`).

### Account policy persistence and security invariants

- **Atomic same-directory replacement:** Updates write to an owner-only (`0600`) temporary file in the `.evcrate` directory with `O_NOFOLLOW` and replace the existing file atomically via `renameat`, followed by directory sync.
- **Strict CAS validation:** `PATCH /api/advisor/policy` requires a 64-character lowercase hexadecimal `expectedRevision` matching the SHA-256 digest of the current file bytes; conflicts return HTTP 409 (`POLICY_REVISION_CONFLICT`).
- **Preservation of non-route configuration:** The editor mutates only the `advisor.primary` and `advisor.backup` routes; `wait`, `history`, and any other valid non-route fields are strictly preserved.
- **Input and credential safety:** Policy bodies and files are capped at 16 KiB. Both disk contents and update payloads are recursively inspected; any presence of credential-like keys (e.g., tokens, secrets, cookies, apiKeys) triggers immediate rejection with `ROUTE_CREDENTIAL_FIELD`.
- **Harness model discovery:** `POST /api/advisor/models` executes read-only CLI discovery commands bounded by timeouts and output limits, falling back to normalized built-in catalogs if the harness CLI is missing, timed out, or unauthenticated.

## Phase 04: native React panel and provider

`packages/ui/src/advisor/AdvisorPanel.tsx` renders one reusable React subtree with four views:

- **Overview** — aggregate metrics, latency/outcomes, activity scope.
- **History Records** — filters, paging, consultation details.
- **Configuration** — current policy and historical route/build groupings.
- **Evaluations** — discovered descriptors, revision-bound detail reads, compatible comparisons and provenance.

`NativeAdvisorProvider` implements `AdvisorDataProvider` through the captured owner-bound `ApiClient.advisor`. It supports history, current-policy read/update, model listing, and evaluation operations. Each request ID is associated with an abort controller whose signal reaches REST; responses are checked again after awaits. Reusing an ID aborts the earlier request, and cleanup removes a controller only while it remains the active controller for that ID.

Advisor selectors, reset rules, variables, and theme fallbacks stay under `.native-advisor`; animation keyframes use Advisor-specific names. The panel path has **0 iframe/srcdoc, 0 MessagePort/plugin bridge, 0 plugin SDK, and 0 nested React root**. It imports no sibling Evcrate checkout code.

The panel/provider are implemented; Phase 05 wires them into Settings and persistent Workspace placement. `packages/ui/browser-tests/workspace-advisor.browser.tsx` covers DOM placement, not the full authenticated API/domain-parity or production-qualification gates. Implementation evidence is documented; durable completion receipt publication for Phases 04–05 remains parent-coordinated.

## Pre-migration source evidence

- Before Phase 05, `WorkspaceAdvisorHost.tsx` wrapped `PluginHost`; Phase 05 replaces it with the native panel.
- Before Phase 05, `SettingsPage.tsx` exposed Plugin Platform registration; it now mounts `AdvisorSettingsSection` in the Native Advisor accordion.
- The former `PluginAccessModal.tsx` generated the path SHA-256 that native Settings removes.
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
6. Phase 04's native React panel reuses Advisor views, selectors, reducer, and domain formatting through an owner-bound `ApiClient.advisor` adapter with abortable requests.
7. Phase 05 replaces the persistent host's former `PluginHost` child with `AdvisorPanel` in IDE, Terminal float, and compact placements; it does not use an iframe or nested React root.
8. Workspace surfaces and launchers use one current-owner connected + admin + enabled predicate. Owner/profile/generation-qualified queries isolate status and Advisor data. When the predicate is false, launchers/surfaces and the conditional host are removed; an inactive placement keeps the mounted host inert.

## API and authorization invariants

Phases 02–03 implement status, settings, history/evaluation operations, and account policy reads. The API also supports revision-checked route updates at `/api/advisor/policy`; Phase 04's native provider consumes these APIs, and Phase 05 connects them to Settings/Workspace without changing server-side authorization.

- Native status/settings routes work for admins even when disabled or history missing; enable toggle never requires folder creation or plugin registration.
- Data routes require enabled feature and current admin authorization. Status conveys availability; missing source is explicit empty/not-configured state where source contract defines it.
- Native routes use `require_auth` plus generalized `require_admin`; the enabled account's admin role is checked per request. Keep ordinary validated sessions and deny `--no-auth`; do not transplant plugin-only bearer admission or a static admin allowlist.
- No path hash utility or root-identity admission field.
- No custom root API. Require a real final history-root directory (root symlink rejected per user validation). Do not add canonical-equals-input, ancestor-symlink, UID or grant restrictions. Validate record/evaluation IDs within resolved source roots.
- History and evaluation sources remain read-only. Advisor configuration mutations are limited to the server enable toggle and primary/backup route updates; there is no history delete, policy import, or picker API. Refresh mutates in-memory snapshots only.
- Bound pages, comparison workload, source file sizes, and blocking scans; reuse source limits. Do not rebuild entire history for every summary/page/detail request.
- Snapshot/cursor ownership includes authenticated subject and server-side source/filter identity; never reuse snapshot from another owner or incompatible query.
- Preserve history format discrimination, provenance, stale/not-configured/error distinctions and comparison eligibility. Full port evidence belongs in plan research/contracts.

## Native Advisor REST API

The current native API uses camelCase JSON. Every route requires a normal validated session plus the current administrator role; Bearer tokens and the authentication cookie use the ordinary REST authentication layer. `--no-auth` is denied. Status and settings remain usable while Advisor is disabled; history, policy, evaluation, and model-discovery operations require `[server.advisor].enabled`. Policy updates and model-discovery requests are capped at 16 KiB; other Advisor JSON operation bodies are capped at 64 KiB.

| Method and path                     | Request                                              | Result                                                                                                                                      |
| ----------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/advisor/status`           | None                                                 | `{ enabled, available, path, sourceError }`; a final-root symlink is reported unavailable with `sourceError`.                               |
| `PATCH /api/advisor/settings`       | `{ enabled }`                                        | `{ enabled }`; persists the server setting and clears active snapshots when disabled.                                                       |
| `POST /api/advisor/policy/current`  | None                                                 | Current account policy (`PolicyReadCurrentResultDto`).                                                                                      |
| `PATCH /api/advisor/policy`         | `{ expectedRevision, advisor: { primary, backup } }` | Updated `PolicyReadCurrentResultDto`; stale revision returns HTTP 409.                                                                      |
| `POST /api/advisor/history/refresh` | Optional `{ projectId? }`                            | Scan summary and inventory; creates a user-owned snapshot when available.                                                                   |
| `POST /api/advisor/history/summary` | `{ snapshotId, query? }`                             | Filtered aggregate metrics and project inventory.                                                                                           |
| `POST /api/advisor/history/page`    | `{ snapshotId, query?, sort?, cursor?, limit? }`     | Page entries, next cursor, and returned byte count.                                                                                         |
| `POST /api/advisor/history/detail`  | `{ snapshotId, recordRef }`                          | Sanitized detail with status `ready`, `changed`, or `missing`.                                                                              |
| `POST /api/advisor/models`          | `{ backend }`                                        | `{ backend, source, models, efforts, defaultEffort, observedAt, issueCode? }`; discovers a harness catalog or returns its fallback catalog. |

### Frontend transport and provider

The typed frontend API exposes `updatePolicy` and `listModels` on `ApiClient.advisor`; `NativeAdvisorProvider` implements the corresponding `AdvisorDataProvider` methods `updatePolicy(requestId, params)` and `listModels(requestId, backend)`. The REST-backed `WsTransport` maps `advisor:policy:update` to `PATCH /api/advisor/policy` and `advisor:models:list` to `POST /api/advisor/models`. Both operations use the normal authenticated REST path, not a WebSocket message protocol, and accept the provider's abort signal.

Non-2xx REST responses become `ApiRequestError` values carrying the HTTP status and optional server code. The provider maps recognized codes/statuses to typed `AdvisorError` categories, including policy revision conflicts, route validation and policy-write errors, disabled/unauthorized/forbidden responses, and not-found conditions; unrecognized API failures retain their status under `UNKNOWN`.

History availability is separate from routing capability. When Advisor is enabled but the history root is unavailable, the provider reports no history or evaluation source and advertises `policy.readCurrent`, `policy.update`, and `models.list`; those operations still require the enabled feature and current administrator authorization. When Advisor is disabled or status probing fails, these capabilities are not advertised.

`query` contains optional `projectId`, `taskRunId`, and `filters`; `query.filters` supports `statuses`, `outcomeStates`, `outcomeResults`, `backends`, `models`, `efforts`, `promptIdentities`, `buildIdentities`, `startedAtFrom`, and `startedAtTo`. Page sorting defaults to `started_at_desc`; the page size defaults to 100 and is capped at 500. Continuation cursors are HMAC-signed and bound to the snapshot/query. The detail endpoint rechecks captured file fingerprints before returning content. The [Advisor configuration reference](../configuration/advisor.md) documents policy and model-discovery DTOs, fallback catalogs, limits, and persistence alongside the history behavior.

#### Inline routing editor (Phase 04)

`PolicySummaryCard` keeps the current owner policy read-only until **Edit Routing** is selected. In edit mode, the static primary/backup route summary is replaced by two `RouteFieldset`s for the primary and backup targets; the full-policy disclosure remains available. `ConfigurationView` and `AdvisorPanel` pass the catalog, save, cancel, and reload operations to the card.

`policy-routing-validation.ts` contains pure draft normalization and validation. It trims backend, model, and effort values before returning normalized routes and comparing them. The two routes are duplicates only when the normalized backend, model, **and** effort all match; same backend/model with different effort is valid.

| Validation            | Rule                                                                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model identifier      | Required; at most 256 UTF-8 bytes; after trimming, rejects remaining ASCII C0 and DEL control characters. `omp` and `pi` additionally require a slash with non-empty provider and model parts (`provider/model`). |
| Effort                | Required; at most 64 UTF-8 bytes; after trimming, rejects remaining ASCII C0 and DEL control characters.                                                                                                          |
| Backend effort set    | `codex`: `low`, `medium`, `high`, `xhigh`; `claude`: those values plus `max`; `omp` and `pi`: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.                                                          |
| Catalog compatibility | If a model advertises efforts, a mismatch is an advisory warning; it does not invalidate an effort that is allowed for the backend.                                                                               |

Model catalogs load lazily for the current primary and backup backends when editing begins, and for a newly selected backend after a backend change. The panel calls `activeProvider.listModels(requestId, backend)`. Each fieldset shows `Discovering…` while loading and a `source: harness` or `source: fallback` badge when a result arrives. The response's optional `issueCode` describes fallback/truncation diagnostics (see [model discovery](../configuration/advisor.md#model-catalog-discovery)); a rejected discovery request shows `Discovery unavailable`, with the error text in the badge tooltip.

An existing model absent from its backend catalog remains in the draft and is editable through the custom-model input. Changing backend also retains the current model identifier as a custom value; when the selected model came from the old backend's catalog, the editor warns that it is being retained as custom for the new backend.

Policy read, save, and reload commits are fenced by `policyOperationSeqRef`, the active provider, and context epoch. Starting a newer save advances the sequence, so a slower earlier policy read cannot overwrite the saved revision. Catalog request IDs are tracked, passed to `cancel()`, and cleared on editor cancellation, panel unmount, and provider replacement; results are also discarded if the panel is unmounted or the captured provider/context epoch is no longer current.

### Harness model discovery

`POST /api/advisor/models` runs discovery on the server for one of the four supported backend values: `omp`, `codex`, `claude`, or `pi`. The required `backend` string is trimmed; the resulting value must match one of those lowercase names. The request DTO rejects unknown fields. Discovery uses the corresponding local harness executable and a temporary working directory:

| Backend  | Discovery adapter                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `omp`    | `omp models ls --json --no-extensions`                                                                                   |
| `pi`     | `pi --offline --list-models --no-extensions`                                                                             |
| `codex`  | Starts `codex app-server --listen stdio://` and requests `model/list` with a 100-model limit and hidden models excluded. |
| `claude` | Uses the Claude stream-JSON control protocol; the model catalog is returned by its initialize response.                  |

A non-empty normalized harness catalog returns `source: "harness"`. A missing executable, timeout, output-limit failure, unsafe/failed execution, invalid output, or empty usable catalog returns HTTP 200 with `source: "fallback"` and its diagnostic `issueCode` (`HARNESS_NOT_FOUND`, `HARNESS_DISCOVERY_TIMEOUT`, `HARNESS_OUTPUT_LIMIT`, `HARNESS_DISCOVERY_UNSAFE`, `HARNESS_DISCOVERY_FAILED`, `HARNESS_OUTPUT_INVALID`, or `HARNESS_CATALOG_EMPTY`). A non-empty catalog that is truncated remains `source: "harness"` and carries `HARNESS_CATALOG_TRUNCATED`. A disabled feature returns HTTP 403 with `{ "code": "AdvisorDisabled", "error": "ADVISOR_DISABLED" }`; an unsupported backend returns HTTP 400 (`InvalidInput`).

`AdvisorModelsResultDto` uses camelCase JSON:

| Field           | Type             | Meaning                                                                                                           |
| --------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `backend`       | string           | Normalized supported backend name.                                                                                |
| `source`        | string           | `harness` for a discovered catalog or `fallback` for the built-in catalog.                                        |
| `models`        | array of objects | Each model has `id`, `label`, and model-specific `efforts`.                                                       |
| `efforts`       | string array     | Backend-level effort suggestions.                                                                                 |
| `defaultEffort` | string           | Always `medium`.                                                                                                  |
| `observedAt`    | number           | Observation time in Unix milliseconds.                                                                            |
| `issueCode`     | string, optional | Fallback reason, or `HARNESS_CATALOG_TRUNCATED` for a partial harness catalog; omitted when no issue is reported. |

Fallback catalogs and backend effort choices are listed in the [Advisor configuration reference](../configuration/advisor.md#model-catalog-discovery). Fallback catalogs are static suggestions, not a confirmation that the corresponding model is installed or available to the current account.

Discovery work is bounded in several ways, but the timeout stages are independent: at most two discoveries hold a semaphore permit; waiting for a permit is capped at five seconds, and the production runner has a separate five-second execution timeout. OMP and Pi stdout capture is capped at 5 MiB. Codex and Claude currently use line readers that do not enforce the declared 1 MiB `MAX_LINE_BYTES` constant, so a per-line byte limit is not guaranteed for those adapters.

Normalization caps catalogs at 500 models and the serialized `models` array at 256 KiB. It trims IDs and labels, drops empty values, control characters, credential-like substrings, and IDs or labels longer than 256 bytes, removes duplicate IDs, and sorts by label then ID. The 256 KiB bound is applied to the model array, not to the enclosing response object.

## Phase 05 Settings and Workspace cutover (implementation/finalization settled; durable completion pending)

The Settings target remains independent of the Workspace project/connection owner. The implemented UI and state wiring are:

| File                                                                        | Contract                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ui/src/hooks/use-advisor.ts`                                      | `useAdvisorAuth` checks the selected profile only when connected; `useAdvisorStatus` requires a current `ConnectionRef`; `useAdvisorVisibility` combines connected + admin + enabled (directory availability does not gate visibility); `useAdvisorToggle` captures owner/value and invalidates only that owner's keys. Status/data cache keys include profile and connection generation. |
| `packages/ui/src/components/pages/settings-page/AdvisorSettingsSection.tsx` | Admins toggle the Settings target server and refresh status. UI shows detected path, real-directory availability, and source errors, including the final-root symlink rejection notice. No root editor, registration, hash UI, grants, or bindings.                                                                                                                                       |
| `packages/ui/src/components/pages/SettingsPage.tsx`                         | Replaces the Plugin Platform accordion with Native Advisor backed by the selected Settings target profile.                                                                                                                                                                                                                                                                                |
| `packages/ui/src/components/pages/WorkspacePage.tsx`                        | Workspace owner comes from the selected project's profile/connection; with no project, only the explicitly selected active profile is used, and only while connected. One predicate gates IDE right tools, Terminal tools/shortcut, compact surface, and host. Compact selection normalizes to the editor/terminal default when Advisor is unavailable.                                   |
| `packages/ui/src/components/organisms/WorkspaceAdvisorHost.tsx`             | Replaces `PluginHost` with one direct `AdvisorPanel`; a single host measures the active slot across modes. Focus capture activates the slot, Escape closes it, and hiding restores focus to a live launcher or blurs.                                                                                                                                                                     |
| `packages/ui/browser-tests/workspace-advisor.browser.tsx`                   | Chromium harness mocks the panel and asserts the same panel DOM node across IDE → Terminal → compact → IDE, plus an inert/hidden/`aria-hidden` host while the slot is closed.                                                                                                                                                                                                             |

The placement test does not establish all eight domain operations or authenticated real-server parity. Broader integration qualification is recorded separately in the Phase 09 qualification report; durable completion receipts for Phases 01–05 remain parent-coordinated.

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

## Implementation and retirement status

Implementation and migration qualification evidence is recorded, but durable completion receipt status is not uniform:

- **Phases 01–05:** Contract, native history and policy/evaluation domains, React panel/provider, Settings toggle, and Workspace surfaces are implemented. Durable completion receipts remain parent-coordinated and must not be inferred from this architecture summary.
- **Phase 06:** Dam-Hopper plugin runtime, SDK, and bridge deleted; completion receipt published.
- **Phase 07:** Linux runner service retired, manager state schema 3 migrated, and safe manual uninstall script delivered (`deploy/remove-plugin-platform.sh`); completion receipt published.
- **Phase 08:** Evcrate plugin integration and CI release assets removed; core CLI/controller and shared viewer source remain; completion receipt published.
- **Phase 09:** Native-only cutover qualification and documentation reconciliation are recorded; parent coordinates final project status and receipt publication.
