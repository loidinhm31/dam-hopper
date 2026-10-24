# Extended Workbench Contract Research

Status: completed static source inspection (`ExtendedWorkbenchContracts`), parent reviewed. Baseline d897a91; no runtime acceptance claimed.

## Authority and scope

All these feature families are included in the first Android release. Data and execution remain on the selected remote server; Android is an owner-bound client. Server-unavailable capability is not a native omission, but an implemented API cannot be dropped silently.

| Family | Source / route surface | Acceptance hazard |
| --- | --- | --- |
| Manual workflow | `docs/api/workflow.md`; `/api/workflow/overview`, events, items, sessions, links, notes, history | Strict requestId replay identity and updatedAt CAS; link exact terminal/worktree/incarnation; no invented observation ingestion or automatic session completion |
| Project plans | `docs/api/filesystem-and-media.md:59–76`; `/api/plans/folders`, `/api/plans` | Folder-first selection; reported administrative status only; strict 64KiB plan-document reads/watch identity; read-only routes |
| Agent Store | `router.rs:402–425`; matrix, scan, health, list/item/content, ship/unship/absorb/bulk-ship | Server-local catalogs/distribution; exact owner, remote target confirmations and partial-failure results |
| Agent memory/import | `router.rs:426–459`; templates/apply/project memory; scan/scan-local/confirm | Server-local “local” path, not Android storage; review import drafts and selections; no cross-profile propagation |
| Host resources | `docs/architecture/host-resource-sse.md`; snapshot/metrics/alerts/events | Epoch + decimal-string revisions; paired data; 32 global/4 per-user admission; one per-owner coordinator, visible-demand updates and documented REST fallback |
| Usage/telemetry | `docs/api/agent-usage-and-sessions.md`; summary/sessions/health/settings/setup/delete | Aggregate-only, opaque cursor scoping, HMAC IDs; explicit delete/confirmation; no prompts/commands/transcript display |
| Ports/tunnels | `docs/api/system-services.md`; `/api/ports`, `/api/tunnels`, install/status | Remote listener vs explicit forward; survives PTY/origin loss; REST re-list after reconnect; 3h reminder not expiry; public exposure until Stop |
| Preferences/config | `router.rs:110–139`; workspace/known/discover/init/switch, projects, global config/defaults/ui, config/project patch | Settings owner independent of preference source; workspace switch disposes PTYs; capture target and label destructive consequences |
| Maintenance | `router.rs:397–400,471–481`; diagnostics, cache-clear/reset, TOML import/export | No updater/general server restart route established; reset disposes terminals; import max1MiB and server atomic validation/backup semantics |
| Idle suspend | `docs/api/idle-suspend.md`; status/timing/force-suspend/consent decision | Startup policy immutable; complete timing pair; no automatic retry of uncertain force suspend; exact live-socket connection capability and request revision |
| Host actions | `router.rs:343–379`; capabilities/intents/approval/executions/audit | Deferred/fail-closed capability path; no privileged executor implemented in native client |
| Remote SSH credentials | `router.rs:460–467`; keys/agent/load/status/forget | Operates on server credentials; not native Android SSH forwarding; never surface private key material in logs/UI |
| Agent integrations | `router.rs:281–303`; snapshot, OMP extension, native hook integration status/install | Operates on server; no direct Android connection to private reporter ingress; stale/unknown status stays explicit |

## Cross-cutting invariants

- Profile and generation capture before async work; no ambient root/server fallback.
- Respect CAS/revisions and request identity; never replay destructive or possibly accepted requests generically.
- Cancellation/unsubscribe/revoke uses original owner and resource handle.
- Preserve empty/loading/error/disconnected/unsupported/degraded/stale states; unavailable is not zero/fresh data.
- Workspace switch and reset are server-wide operations; navigation/profile disconnect is not equivalent.
- Host fleet, usage and tunnel data can outlive a selected project; never scope them accidentally to ambient project state.
- Account registration creates disabled users; no public approval/promotion or general user/session-admin API established. Do not invent one.
- Remote host functionality varies by OS/helper deployment; preserve explicit capability denial.

## Source anchors

- `server/src/api/router.rs:64–155,268–303,326–511,540–544`.
- `docs/api/workflow.md:1–30` and `docs/workflow-api.md`.
- `docs/api/workspace-settings.md:1–47`.
- `docs/api/rest-endpoints.md:5–50`.
- `docs/api/agent-usage-and-sessions.md:1–145`.
- `docs/api/system-services.md:28–40,347–376`.
- `docs/api/idle-suspend.md:1–90,170–290`.
- `docs/architecture/agent-store-ports-and-browser.md:8–50`.
- `docs/architecture/preferences-settings-and-host-resources.md:8–42`.
- `docs/architecture/host-resource-sse.md:1–30,52–78`.

## Unresolved questions

- Exact minimum server-version/route compatibility is to be frozen in Phase01 against baseline0.13.2/protocol2; do not claim broad backwards compatibility.
- Native authenticated SSE support must pass actual streaming/proxy proof; retain documented REST fallback.
- Host actions remain unavailable wherever server capability denies them; extending server executor is not part of Android parity.
