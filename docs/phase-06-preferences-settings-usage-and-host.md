# Phase 06 — Preferences, Settings, Usage, and Host Resources

**Status:** DONE — 2026-09-17  
**Scope:** Unified multi-profile preference source, Settings target, profile-local
usage, host-resource presentation, and revision-fenced host actions.  
**Evidence:** 87/87 targeted tests, 1,760/1,760 full Vitest suite, clean
TypeScript compilation, clean ESLint on modified files, and 9.5/10 code review.

This guide is the implementation contract for the Phase 06 frontend slice. The
server remains authoritative for workspace configuration, usage storage, host
metrics, idle-suspend policy, fleet state, revisions, authentication, and host
action admission. The browser supplies an explicit owner whenever work crosses
an async boundary:

```ts
type ConnectionRef = { profileId: string; generation: number };
```

## Ownership model

Phase 06 keeps three selections independent:

| Selection | Meaning | Persistence and removal |
| --- | --- | --- |
| `preferencesProfileId` | Source for shared workbench appearance, fonts, shortcuts, terminal suggestion/display options, explorer presentation, notifications, and mobile keyboard settings. | `dam-hopper:preferences-source:v1` stores the selection and last successful allowlisted snapshot. Removing the source retains the snapshot with `preferencesStatus: "source-removed"`. |
| `settingsProfileId` | Server whose global/workspace config, maintenance, usage setup, and host policy are inspected or changed. | `dam-hopper:settings-target:v1` stores the target. Removing the profile clears the target and requires an explicit replacement. |
| `browserTargetProfileId` | Browser Debug owner. | Removal clears the target; it does not change the preference source or Settings target. |

Project navigation does not change any of these selections. Usage totals and
host values are profile-targeted; equal endpoints may describe one physical
host, so the UI does not sum, average, or deduplicate them.

## Preference source transaction

`packages/ui/src/stores/settings.ts` is the only store boundary for the
allowlisted `PersistedSettingsState`. It hydrates through a captured owner and
uses `withUiConfigDefaults` plus existing clamps for font, keyboard, scroll,
volume, and language-filter values. A missing source uses local defaults or the
last safe snapshot and marks the source unset; an unavailable source keeps the
last snapshot and disables remote saving.

`saveDebounced` captures the bound API client, profile, generation, and edit ID
when an edit is scheduled. The 500 ms debounce coalesces only allowlisted fields;
the serialized save chain never resolves through a later active profile. A
source switch cancels an undispatched timer and clears its pending patch. A
write already dispatched continues only to its captured source. Success or
rollback can update the store only when the source and edit revision still
match; late failures are recorded as client diagnostics rather than rerouted or
replayed against a new server.

`workbench-selections.ts` subscribes to profile deletion. It also resets the
removed profile's host-alert presentation state, preventing retained incident
badges from appearing under another owner.

## Settings target and configuration UI

`SettingsPage` renders separate **Settings Target Server** and **Workbench
Preferences Source** selectors. Target labels include the profile name and
server URL. Every config, workspace, known-workspace, maintenance, import,
export, usage, and idle-suspend hook receives the target owner; an absent target
uses the existing compatibility/default-server path only when no explicit
profile is selected.

- `GlobalConfigEditor` and `ConfigEditor` pass `OwnerInput` to their queries and
  mutations; server-local defaults, projects, commands, and terminal profiles
  are never copied to the preference source or another profile.
- Maintenance cache clearing invalidates only the target profile's query prefix.
  Nuclear reset is target-labelled and explicit about terminal disposal; it is
  not a connection-management operation.
- Export requests target the selected server and download raw TOML through a
  Blob with a server-labelled filename. Import accepts `.toml` only, keeps the
  1 MiB client limit, confirms the workspace and target, reads the file after
  confirmation, and rejects a changed target or connection generation before
  dispatch. The server remains responsible for validation, backup, atomic
  publication, and rollback.
- `SettingsUsageInsightsSection` sends setup/configuration mutations to the
  target owner and redacts bearer tokens and local endpoints from displayed
  errors.
- `SettingsIdleSuspendTimingSection` edits the complete bounded quiet/wake pair
  for the target server. Handoff conflicts, no-auth rejection, disabled actors,
  and capability errors remain visible; the UI never widens backend bounds.

## Owner-qualified usage

`UsagePage` selects a profile from the `profileId` URL parameter, then the
Settings target, then the first configured profile. The selected owner is used
for summary, settings, session list/detail, pause/resume, and deletion queries.
Deep links preserve `profileId`, `view`, `session`, and opaque `cursor` values.

`api/queries.ts` builds `profileQueryKey(owner, "usage", ...)` keys for summary,
sessions, details, health, settings, setup, and mutations. Session list/detail
polling runs every 15 seconds only while the document is visible. Destructive
usage actions confirm the selected owner and UTC range before dispatch and do
not silently switch to another profile; successful mutations invalidate only
that owner's usage cache.

## Host resources and idle suspend

In single-profile mode the host popover resolves an effective owner in this
order: explicit `owner`, `settingsProfileId`, then the active profile.
Snapshot, alert history, legacy metrics, idle-suspend status, and UiConfig
updates all use that owner. When no `owner` is supplied and more than one
profile is configured, the top-nav popover enters Fleet mode instead: it opens
the read-only fleet deck, and a connected profile selection supplies the exact
owner for the shared drilldown. The optional `hostResourcePinnedMount` remains
a presentation preference in the owning server's UiConfig. A missing saved
mount stays visibly missing rather than silently binding to another filesystem.

Fleet mode is documented in the architecture's
[Fleet Deck & Drilldown Popover](./system-architecture.md#fleet-deck--drilldown-popover-phase-03-2026-09-20)
section: its toolbar keeps a Fleet toggle and profile pills, 1-second
compatibility metrics run only for the visible connected drilldown, and a
removed/disconnected selection returns to Fleet without ambient fallback.

`use-host-resource-alert-presentation.ts` tracks unread incident versions both
in a compatibility aggregate and in `byProfile`. Resource incidents are keyed
by `incidentId`; a `resolvedAt` value (including `0`) removes only that
incident. Presentation is capped at 50 incidents. Opening Fleet marks no
profile read; entering a connected drilldown marks only that profile read.

`use-sse.ts` installs one transport bridge per `ConnectionRef`. It validates
`host:alertChanged` payloads, patches only the matching profile's snapshot
incident, and invalidates that owner's snapshot/history queries. It similarly
validates `host:idleSuspendChanged` revision hints and invalidates only the
owner's status query. Invalid evidence is ignored; REST snapshots remain the
repair authority after reconnect or missed events.

`HostIdleSuspendStatus` displays server state, fleet counts, timing, capability,
measurement state, bounded warning identities, and the `agent-activity`
heuristic notice. Null measurement values remain unknown, not zero or quiet.
`ForceSleepDialog` captures owner, connection generation, endpoint label, status
revision, fleet snapshot, and request ID when opened. It blocks stale
connections, requires confirmation for active managed sessions, rechecks fleet
conflicts, and uses `retry: false`; an ambiguous POST is never replayed.
Existing actor, origin, no-auth, inhibitor, helper, and server revision guards
remain authoritative. Tests use fake executors and never suspend a real host.

## Source map

| Boundary | Implementation |
| --- | --- |
| Preferences and selector persistence | `packages/ui/src/stores/settings.ts`, `stores/workbench-selections.ts` |
| Owner-qualified query/mutation routing | `packages/ui/src/api/queries.ts`, `api/client.ts`, `hooks/use-sse.ts` |
| Settings composition and delayed import/export | `components/pages/SettingsPage.tsx`, `components/pages/settings-page/*`, `components/organisms/{GlobalConfigEditor,ConfigEditor}.tsx` |
| Usage UI and deep links | `components/pages/UsagePage.tsx`, `components/usage/*` |
| Host status, incidents, and manual action | `HostResourcePopover.tsx`, `HostIdleSuspendStatus.tsx`, `ForceSleepDialog.tsx`, `use-host-resource-alert-presentation.ts` |
| Related server contracts | [API Reference](./api-reference.md), [Protected Idle-Suspend Status](./idle-suspend-status-ui.md), [Frontend Components](./frontend-components.md) |

The phase planning record remains [Phase 06 — Preference source, Settings target,
usage and host resources](../plans/260916-2137-unified-profile/phase-06-preferences-settings-usage-and-host.md).

## Unresolved questions

None deferred by the Phase 06 implementation contract.
