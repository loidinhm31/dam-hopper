# Native Advisor implementation contract

Status: Phase 01 contract/source-parity baseline frozen; durable completion pending. Native runtime implementation and qualification remain later-phase work. Original planning made no application changes, source deletions, builds/tests, or service stops.

**Validated contract:** [validated decisions](./validated-decisions.md), parent Validation Summary and all nine phase files are synchronized directly, including retirement integration inventory. No path-hash utility; root must be a real directory. No deferred override application is required.

## Requirement traceability

| User requirement | Decision | Implementation phases |
|---|---|---|
| Remove Advisor plugin; make native | Rust/Axum service and directly mounted React panel; no worker, iframe or SDK | 02–06 |
| No registration section | Remove Plugin Platform accordion/access modal; native Advisor toggle and folder status only | 05–06 |
| Enable/disable Workspace section | Persist `server.advisor.enabled` per server, default false; admin only; all IDE/Terminal/compact surfaces gated | 02,05 |
| HOME folder existence enough | `$HOME/.evcrate/advisor-history`; no `/home` scan, root registration, identity admission or owner UID/link-count prerequisite | 02 |
| Hash support clarified during validation | User explicitly removed hashing entirely from native settings: no path hash field, generation/copy button or prerequisite | 02,05 |
| No more restriction; keep admin | Current enabled-account admin role is the sole feature entitlement; normal auth, filesystem access and safe document bounds remain | 02–05 |
| Remove Linux plugin service and manual removal script | Full plugin service/runtime retirement; manual inspected dry-run/explicit apply script; shared API/helper IPC replacement | 07 |
| Reuse `/home/loidinh/WS/evcrate/plugin/` UI/logic | Trace imports into viewer/domain source; native-owned port of eight reads and four views | 01–05 |
| Remove completely from Evcrate, plugin + release script | Delete plugin tree, adapters/dependencies/tests and plugin portions of mixed release/CI scripts; keep core producer | 08 |
| Detailed lower-rank-agent plan; no implementation | Nine phase contracts, explicit ownership/gates/checklists/acceptance; pending statuses | All |

## Fixed decisions and non-goals

- Entire Dam-Hopper plugin platform removal was explicitly selected by user; do not retain generic plugin registration/runner/SDK “for later”.
- Toggle is server configuration, not local preference. Settings target and Workspace target remain independently owned.
- Producer writes durable V1 history; V2 checkpoint data and V2 viewer root inventory/query are different versions. Do not invent a second V2 directory layout.
- History project partition ID = source-compatible SHA-256 of canonical project root; preserve producer normalization. Existing document revision/checkpoint/cursor integrity hashes remain. User removed path-hash utility, not these domain identities.
- Preserve All/project scope and native root inventory as actual DTO behavior. No plugin history_identity field, grant, binding or frame generation required.
- Evcrate policy = current account-wide `$HOME/.evcrate/advisor-routing.json`; not a project policy or historical route source.
- Evaluations reader discovery: HOME `.evcrate/advisor-evaluations`, then `.evcrate/evaluations`, then `tests/fixtures/advisor-evaluations` below explicit selected registered project/worktree. No worker-CWD fallback. These are observed reader paths, not proof of a producer convention.
- No new evaluation writer/picker/upload feature; no history/policy edits/delete/prune in native feature. Only durable new mutation: enable/disable.
- Preserve core Evcrate `.evcrate/source/.evcrate/bin/lib/advisor/` writer/controller/prune and shared protocol/settings code. Removed historical standalone picker is not to be restored. Retain any actually supported non-plugin viewer behavior; plugin-only viewer build target may retire when no consumer remains.
- No production cleanup during implementation validation. Deliver script and run it only on disposable fixture hosts; operator manually applies after native deployment.
- New manager rejects plugin-bearing legacy rollback candidates before state/unit mutation. Old release files remain immutable; deliberately reverting entire legacy toolchain uses backed-up legacy manager/state, not a native compatibility shim.
- Published historical remote releases/assets are not deleted. Future builds/CI stop generating/requiring/uploading plugin assets.

## API and state contract

All routes under `/api/advisor`; validated normal auth + current admin guard. No plugin-only bearer/static admin prerequisites. All data operations require enabled; status/settings work when disabled/missing source. Errors native bounded JSON; not plugin error envelopes.

| Endpoint | Native method | Contract boundary |
|---|---|---|
| GET `/status` | `advisor.status()` | `{enabled,available,path,sourceError}`; admin only; missing path explicit; no pathSha256/rootIdentity field |
| PATCH `/settings` | `advisor.updateSettings({enabled})` | persist only boolean under `server.advisor.enabled`; unrelated config retained; publish success after atomic save |
| POST `/history/refresh` | `advisor.refreshHistory()` | fresh/stale/unavailable + snapshot/observed time/scan/root inventory |
| POST `/history/summary` | `advisor.historySummary({snapshotId,query})` | project/all filter, metric totals/denominators/provenance, inventory |
| POST `/history/page` | `advisor.historyPage({snapshotId,query,sort,cursor,limit})` | default100/max500; max1MiB page; startedAt descending, task/consultation IDs ascending ties |
| POST `/history/detail` | `advisor.historyDetail({snapshotId,recordRef})` | ready execution/outcome or changed/missing with revision |
| POST `/policy/current` | `advisor.readCurrentPolicy()` | account/current labels; ready/migrationRequired/unsupported/invalid/notConfigured statuses |
| POST `/evaluations/list` | `advisor.listEvaluations({target?,cursor,limit})` | server-resolved optional project target; discovered descriptor refs/digest/revision/counts; default32/max100 |
| POST `/evaluations/read` | `advisor.readEvaluation({target?,evaluationRef,expectedRevision})` | ready/changed/missing; no arbitrary filesystem path |
| POST `/evaluations/compare` | `advisor.compareEvaluations({target?,items,cursor,limit})` | max32 refs; compatible groups/provenance; max1MiB page |

Phase 01 writes field-complete typed DTOs from source authority; camelCase HTTP DTOs, existing snake_case files untouched. `query.projectId` is the durable partition hash, not host authorization. Snapshot ownership records current authenticated subject and source/query identity; native client captures profile+generation; profileId never sent as filesystem/server authority. Cancellation follows existing abortable HTTP transport; no fake cancel endpoint/no-op.

Real directory existence determines `available`; empty directory is available with zero records. Enable toggle can be on even when directory missing. Unset HOME unavailable, no CWD/other-user fallback. Permission errors visible. Reject final history-root symlink with explicit source issue, per user validation; no canonical-equals-input or ancestor-symlink admission rule. Validate internal record refs/source containment; reads bounded.

Source bounds to carry: scan 256MiB, 50,000 records, 500 projects, 256 tasks/project, 256 consultations/task, metadata64KiB, diagnostics4096; execution128KiB/outcome64KiB; policy16KiB; evaluation8MiB; history page/comparison1MiB. Native cache bounded; source snapshot TTL5min, max2 snapshots per owner, aggregate128MiB are reference budgets, not plugin context authority. Fair active scan handling should reuse source one-scan/max32-queue semantics where concurrent refresh exists; do not add unrelated retries/background telemetry.

## State transitions

- Disabled: settings/status allowed for admin; no data fetches; no Workspace launcher.
- Enabled + history missing: native section visible to admin with missing source; no registration prompt.
- Enabled + source available: native reads/refresh and four tabs. Optional policy/evaluations independently notConfigured only when actually absent.
- Disable/role loss/logout/disconnect: close inaccessible surface, abort operations, discard snapshots/source data. Settings status remains reachable only while admin-connected.
- Same owner, layout change: preserve one mounted panel and selected tab/filter/detail.
- Profile/connection owner change: retire provider/controllers; reset protected data; never commit late old-owner results.
- Settings A write while Workspace B: mutate A only; B visibility/cache unchanged.

## Agent wave/ownership contract

| Wave | Work | Shared-file rule |
|---|---|---|
| 0 | Phase01 baseline/contracts | Integration owner freezes contracts and gates |
| 1 | Phase02 history + Phase04 UI + Phase07 deployment design/implementation | Independent new module trees; shared router/client/state/manifests edited only by integration owner |
| 2 | Phase03 policy/evaluations; integrate 02+04 | Shared API wiring queued to integration owner; no mid-flight tests |
| 3 | Phase05 actual settings/Workspace parity, G1 | Integration owner performs smoke, before deletions |
| 4 | Phase06 platform deletion + Phase08 Evcrate retirement; finish07 | Different repos/trees; integration owner owns package/lockfile/shared entry points |
| 5 | Phase09 final checks/docs, G2/G3; manual script qualifies disposable hosts | All workers quiesced; run each check once after integration |

Every worker receives relevant phase, native contract, research reports and environment: Linux x64, Asia/Saigon, Dam-Hopper pnpm10+/React19/Rust Axum, branch main at planning, sibling Evcrate root, planning-only versus implementation instruction explicit. Recheck actual repo state at execution. No worker guesses unseen source or owns another worker's shared file. No build/lint/tests/formatters mid-flight.

## Acceptance matrix

| ID | Required observed behavior | Gate |
|---|---|---|
| A01 | Admin reads status/toggle; non-admin, missing/revoked/MFA-invalid session and no-auth denied | G1 |
| A02 | Toggle stored per server; restart/reload preserved; missing history does not block enable or create directories | G1 |
| A03 | HOME-only discovery, alternate/unset HOME, empty/missing/unreadable real directory; final root symlink explicitly rejected; no other /home scan | G1 |
| A04 | No path hash field/button/requirement; known history readable without registration/hash; producer partition and revision hashes preserved | G1 |
| A05 | Producer-shaped V1 execution/outcome + V2 checkpoint decoded; partition project_id compatible | G1 |
| A06 | Root inventory, project/all filters, metric denominators/provenance and current route histories match source | G1 |
| A07 | Deterministic history pagination, ties, boundary sizes, signed query/snapshot cursor mismatch/expiry rejected | G1 |
| A08 | Detail ready/changed/missing, incomplete producer write and invalid/unsupported record handled distinctly | G1 |
| A09 | Account/current policy and real statuses independent of project history filters; no writes | G1 |
| A10 | Evaluations HOME/project discovery, duplicate precedence, list/read revision change and comparison groups/values | G1 |
| A11 | Four native tabs/filters/details responsive; no iframe/port/worker; tab click never changes Workspace route | G1 |
| A12 | IDE/Terminal/compact/shortcuts/restored selection all gated; layout state/focus/Escape/zoom preserved | G1 |
| A13 | Scoped CSS leaves surrounding app/theme/layout unchanged at narrow/light/dark variants | G1 |
| A14 | Settings A/Workspace B + project/profile switch and delayed responses do not cross owners | G1 |
| A15 | Disable/logout/role downgrade aborts and clears protected data; reenabling uses new valid owner snapshot | G1 |
| A16 | Login/session/MFA watcher, PTY output, FS watch, git and idle-suspend remain without plugin WS epoch | G2 |
| A17 | Fresh install/legacy-state migration/native upgrade/rollback/recovery work without runner/Node worker; legacy rollback refused before mutation | G2 |
| A18 | Manual script dry-run/apply/twice, exact system/user scope, active runner, symlink trap; history unchanged/shared IPC preserved | G2 |
| A19 | Both release pipelines retain expected assets and exclude plugin assets/dependencies; core Evcrate writer still works | G3 |
| A20 | Native-only build dependency closure, retired APIs404, no registration/SDK/aliases; current docs/changelogs accurate | G3 |

## Evidence and unresolved questions

- Research inventory is source evidence, not native runtime qualification. Current system runner observed active by read-only research; planning leaves it untouched.
- External fact unknown: who produces evaluations in the accepted discovery directories? Not an implementation blocker; current reader behavior is known and preserved.
- No outstanding user scope decision. Hash utility removed, real directory required, default disabled and native-only automatic rollback explicitly confirmed.
- Implementation runtime prerequisites: authenticated MongoDB-backed fixture; disposable systemd host and user-manager session; supported native toolchain. Missing prerequisites must be reported as blocked qualification, not simulated success.
