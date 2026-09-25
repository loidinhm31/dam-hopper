# Trusted Plugin Platform — Phase D05

**Status:** DONE — 2026-09-22 (100%; review approved 9.8/10).

D05 adds the authenticated plugin-management REST façade and the runner-side
transaction coordinator for installation, update, rollback, enable, disable,
remove, grant, and binding operations. It remains trusted same-identity
execution, not a malicious-code sandbox.

- [D00 contract candidate](../plugin-platform-d00.md)
- [D01 registry and trust staging](./plugin-platform-d01.md)
- [D02 owner runner and supervision](./plugin-platform-d02.md)
- [D03 authorized plugin API](./plugin-platform-d03.md)
- [D05 implementation plan](../../plans/260920-1603-plugin-platform/phase-05-management-and-lifecycle.md)
- [API Reference](../api-reference.md#trusted-plugin-management-api-phase-d05)
- [Configuration Guide](../configuration-guide.md#plugin-management-administrator-allowlist)
- [D05 verification](../../plans/reports/tester-260922-2049-phase-d05-plugin-suite-verification.md)
- [D05 review](../../plans/reports/code-review-260922-2050-phase-d05-cycle3-management-lifecycle.md)

## Boundary and data flow

```text
Settings → owner-bound ApiClient/WsTransport → bearer-only REST
                                              │ AuthenticatedActor.subject
                                              ▼
Axum require_auth → require_bearer_auth → plugin_admin handlers
                                              │ bounded JSON / streaming gzip
                                              ▼
RunnerClient → AF_UNIX JSON-RPC → RunnerServer
                                  ├─ PluginRegistry (D01 durable state)
                                  ├─ SupervisorManager (worker drain/health)
                                  └─ LifecycleCoordinator (D05 transaction)
```

The API never accepts an administrator subject in a request body. `require_auth`
validates the JWT and installs `AuthenticatedActor`; the handler passes that
subject through the local RPC request. The runner rechecks the subject against
its immutable, host-seeded `AdminSubjectList`, so route middleware is not the
only authorization boundary.

## Administrator allowlist

The plugin runner loads administrator subjects at startup. Configuration is
host-seeded, not a MongoDB role, login result, browser profile, or `--no-auth`
identity. Missing configuration is an empty list (deny all).

Priority for `dam-hopper-plugin-runner`:

1. `--admin-config <path>` when supplied.
2. `DAM_HOPPER_PLUGIN_ADMINS_FILE`.
3. `/etc/dam-hopper/plugin-admins.json`.
4. Empty list when no file exists.

Accepted JSON forms:

```json
{"adminSubjects":["alice","ops@example.test"]}
```

or:

```json
["alice","ops@example.test"]
```

Values are trimmed, empty values removed, duplicates removed, then sorted for a
stable SHA-256 `adminConfigDigest`. The digest is recorded in a new
`registry-v1.json`; it does not itself grant access. On Unix, any group- or
world-writable admin file (`mode & 0o022`) is rejected. An unreadable or invalid
environment/default file logs a warning and falls back to deny-all; an explicit
`--admin-config` load error stops runner startup.

The runner CLI option is:

```text
--admin-config <PATH>    optional root-seeded administrator JSON
```

Keep the file outside the registry staging tree and provision it through the
host/deployment owner. Login and `--no-auth` never add an administrator.

## Bearer-only management guard

Management routes are composed with both middleware layers:

1. `require_auth` validates a bearer token or normal auth cookie and installs
   `AuthenticatedActor` plus `CredentialMechanism`.
2. `require_bearer_auth` rejects every credential except `Bearer`.

Cookie-only requests receive `403` with `code: "BearerRequired"`. In the develop
environment (`--no-auth`), plugin management operations are permitted for the
synthetic `dev-user` identity. In authenticated environments, a valid bearer for
a subject outside the runner allowlist reaches the runner but receives `401`/`UNAUTHORIZED`
from the admin check. Error bodies remain bounded `{ error, code }`.

This stricter guard is limited to `/api/plugins/admin*`; D03 public plugin
routes retain their documented actor/epoch rules.

## Management REST API

All request and response fields are camelCase. Lifecycle and authority
mutations carry the current `expectedSecurityRevision`, obtained from the
list response; stage upload is the input-stream exception. A stale revision is
rejected, and callers must refetch instead of merging or retrying blindly.

| Method and path | Request | Success |
| --- | --- | --- |
| `GET /api/plugins/admin` | none | `200 AdminInstallationListResult` with `installations` and `securityRevision` |
| `GET /api/plugins/admin/installations/{id}` | none | `200 AdminInstallationDto` |
| `POST /api/plugins/admin/stages` | streamed `application/gzip` or `application/octet-stream`; `Content-Length` and `X-Expected-SHA256` (64 hex) headers | `201 StageReviewDto` |
| `POST /api/plugins/admin/stages/{stageId}/approve` | `{ expectedSha256, expectedSecurityRevision, initialBindings?, initialGrants? }` | `200 AdminInstallationDto` |
| `POST /api/plugins/admin/installations/{id}/rollback` | `{ expectedSecurityRevision }` | `200 AdminInstallationDto` |
| `POST /api/plugins/admin/installations/{id}/enable` | `{ expectedSecurityRevision }` | `200 AdminInstallationDto` |
| `POST /api/plugins/admin/installations/{id}/disable` | `{ expectedSecurityRevision }` | `200 AdminInstallationDto` |
| `DELETE /api/plugins/admin/installations/{id}` | query `expectedSecurityRevision`; `X-Expected-Security-Revision` is accepted as fallback | `200 AdminRemoveResult` |
| `PUT /api/plugins/admin/installations/{id}/grants` | `{ expectedSecurityRevision, grants }` | `200 AdminInstallationDto` |
| `PUT /api/plugins/admin/installations/{id}/bindings` | `{ expectedSecurityRevision, bindings }` | `200 AdminInstallationDto` |

`POST /stages` requires a non-empty body and a declared length no greater than
the D01 compressed package limit (32 MiB). The API streams body chunks with
backpressure to `management.stage.begin/chunk/finish`; it does not buffer a
whole package in one request object. Stage finish verifies the runner-computed
SHA-256 and returns an expiring immutable review. Approval rechecks the actor,
digest, review expiry, and security revision before lifecycle work starts.

`AdminInstallationDto` exposes installation ID/plugin/version, active digest,
activation generation, enabled intent, bindings, grants, UI presence, worker
status, optional previous-package rollback snapshot, rollback availability,
security revision, and timestamps. `AdminRemoveResult` reports the installation,
`removed`, and package digests cleaned because they are no longer referenced.

The runner RPC namespace behind these routes is:

```text
management.stage.begin / stage.chunk / stage.finish
management.approve / rollback / enable / disable / remove
management.grants.replace / management.bindings.replace
management.installations.list / management.installations.get
```

## Transactional lifecycle coordinator

`LifecycleCoordinator` owns the per-installation mutex and composes
`PluginRegistry` with `SupervisorManager`. It journals lifecycle records under
`<registry-root>/journal/lifecycle-<transaction-id>.json` using strict
`deny_unknown_fields` JSON and atomic mode-0600 writes with directory sync.
Each record includes actor, operation, phase, security revision before, old/new
generation, optional candidate package, timestamps, and bounded error text.

Operations and durable phases:

```text
Operations: INSTALL UPDATE ROLLBACK ENABLE DISABLE REMOVE
            REPLACE_GRANTS REPLACE_BINDINGS
Phases:     INITIATED → DRAINING → STOPPED → ACTIVATING → HEALTHY
            → PUBLISHED → COMMITTED
Failure:    FAILED or ABORTED
```

### Install and update

1. Require an allowlisted actor; load the stage review and current registry.
2. Lock the installation and recheck the expected security revision.
3. Create a transaction journal record and inspect/extract the archive.
4. For an update, drain and stop the current worker.
5. Publish the immutable candidate package and verify the optional UI digest.
6. Activate the candidate at the next generation and require worker health.
7. Under the registry state lock, re-read security state, write the package and
   installation pair atomically, preserve the previous package snapshot, and
   advance the registry revision.
8. Mark `PUBLISHED` then `COMMITTED`, clean stage bytes/review memory, and emit
   a redacted admin audit record.

Candidate activation precedes durable publication. If activation or the final
CAS check fails, the candidate is stopped and the previous durable installation
remains active. An update with empty initial grants/bindings preserves the
existing values; explicit non-empty values replace them.

### Rollback, enable, disable, remove, and intent changes

- **Rollback** activates the matched previous backend/UI package pair before
  publication, advances generation (never rewinds), consumes the snapshot, and
  preserves current enabled/grant/binding intent. A disabled installation stays
  disabled; revoked grants are not restored.
- **Disable** drains/stops the worker, persists `enabled: false`, and returns
  `workerStatus: "stopped"`.
- **Enable** checks the active package on disk, persists enabled intent and the
  next generation, then activates and health-checks the worker.
- **Remove** drains/stops the worker, removes the installation, and deletes only
  package roots no longer referenced by another active or rollback snapshot.
- **Replace grants/bindings** validates installation ownership and replaces the
  durable set under the state lock. Both operations advance security and registry
  revisions, invalidating D03 contexts through the API service.

All lifecycle and authority methods recheck the allowlist and expected
security revision under the relevant locks. Approval invalidates all plugin
contexts; lifecycle and grant/binding mutations invalidate the affected
installation metadata/context caches. Stage upload remains a reviewable input
until approval.

### Recovery and failure boundaries

`run_crash_recovery` scans non-terminal lifecycle records. It marks
`INITIATED`, `DRAINING`, and `STOPPED` work `ABORTED`; interrupted
`ACTIVATING`/`HEALTHY` work `FAILED`; and `PUBLISHED` work `COMMITTED`.
Terminal records remain durable evidence. D01 registry construction still runs
its own staging/journal recovery before the coordinator is created.

Lifecycle recovery does not infer approval, restore a worker, or resurrect old
security intent. Worker activation failures leave the durable registry untouched
for a new installation and preserve the prior pair for failed updates/rollback.

## UI and client contract

Settings adds a **Plugin Platform** section. `PluginManagementSection` lists
installations, shows security revision and worker status, streams a `.tar.gz`
with progress, displays immutable review data, and requires confirmation for
rollback/removal. Enable/disable and approval submit the revision read from the
list. Non-admin responses show an administrator-required message that names the
root-seeded bearer requirement.

`packages/ui/src/api/plugin-types.ts` defines `StageReviewDto`,
`AdminInstallationDto`, `AdminInstallationListResult`, lifecycle requests,
grant/binding requests, and `AdminRemoveResult`. `ApiClient.plugins` exposes the
admin methods; `WsTransport` maps them to the REST paths above. The settings
client also registers an optional `plugin:lifecycle_revision` listener to
refresh its list when the transport supplies a push event.

## Source map and evidence

| Area | Source of truth |
| --- | --- |
| Allowlist/config digest | `server/src/plugins/admin.rs`, `trust.rs`, `registry_state.rs` |
| Bearer guard/routes | `server/src/api/auth.rs`, `plugin_admin.rs`, `router.rs` |
| Transaction journal/coordinator | `server/src/plugins/lifecycle_journal.rs`, `lifecycle.rs` |
| Runner RPC bridge | `server/src/plugins/runner_client.rs`, `runner_server.rs` |
| Durable package/worker state | `registry_install.rs`, `registry_layout.rs`, `worker_supervisor.rs` |
| UI DTO/client/mapping | `packages/ui/src/api/plugin-types.ts`, `client.ts`, `ws-transport.ts` |
| Settings surface | `packages/ui/src/components/pages/SettingsPage.tsx`, `settings-page/PluginManagementSection.tsx` |
| Focused evidence | `server/tests/plugin_admin_api.rs`, `server/tests/plugin_lifecycle.rs`, `PluginManagementSection.test.tsx` |

The D05 review and verification reports are linked at the top of this page.
They are phase evidence, not a claim of Linux deployment qualification or a
malicious-plugin sandbox.

## Unresolved questions

- `RunnerServer::new` constructs `LifecycleCoordinator`, but the current runner
  startup path does not call `run_crash_recovery`; should startup invoke it
  before accepting management RPC?
- The UI/client defines `plugin:lifecycle_revision`, but no server emission was
  found in the D05 source map; should mutations publish this event or should the
  Settings surface rely on explicit refresh only?
- Deployment ownership/rotation policy for `/etc/dam-hopper/plugin-admins.json`
  and the D06 systemd unit remains an operator/release concern.
