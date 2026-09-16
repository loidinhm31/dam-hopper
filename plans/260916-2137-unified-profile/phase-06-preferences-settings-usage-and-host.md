# Phase 06 — Preference source, Settings target, usage and host resources

### Context links

[Confirmed validation decisions](validation-decisions.md): fresh old-resource reset, mandatory new contracts, per-platform release.

[Overview](plan.md) · [Canonical plan](plan.md) · [Contracts](design-contracts.md) · [Coverage](coverage-and-decisions.md). Dependency: Phase 01–02 contracts.

### Overview

Date: 2026-09-16. Priority: P1. Implementation: pending (0%). Planning status: specified; runtime verification: not run. Scope: Settings and host.

### Key Insights

The source-backed boundary and exact files are recorded below; canonical contracts govern all cross-slice interfaces.

### Requirements

Separate preference source, Settings target and focused resource; host and usage remain server-local.

### Architecture

#### Exact semantics

- `preferencesProfileId` chooses the single source of workbench appearance, fonts, shortcuts, notification preferences, terminal suggestion/display preferences, explorer presentation and mobile keyboard settings already in `PersistedSettingsState`. It does not choose the backend for other actions.
- `settingsProfileId` chooses the server whose global/workspace configuration, setup, maintenance, usage integration and host policy are being edited. Changing it does not change loaded workbench preferences.
- Resource ordering (`projectOrder`, `terminalOrder`, `projectCommandOrder`, `runtimeGroupOrder`, `runtimeItemOrder`) and `hostResourcePinnedMount` remain stored in each owning server's existing UiConfig, using its existing local resource IDs. Read/apply each server's arrays only within that profile group; never copy them from preference source to all servers. Cross-profile group order stays browser-local presentation state. Dragging an item across profile groups cannot move a remote resource or rewrite another server's ordering.
- Usage is profile-targeted, not automatically summed across profiles; duplicate endpoints could double-count. Host status/alerts show one labelled host per profile or explicitly selected profile, never averaged CPU/memory/free space/fleet. Duplicate profiles may describe the same host.

### Related code files

#### Dependency, source and files

Depends on Phase 01/02 contracts. Settings owner edits `stores/settings.ts`, `components/pages/SettingsPage.tsx`, `components/pages/settings-page/*`, GlobalConfigEditor, ConfigEditor, SettingsAppearanceSection, SettingsKeyboardShortcutsSection, SettingsUsageInsightsSection/CodexRow, SettingsIdleSuspendTimingSection, `components/pages/UsagePage.tsx`, `components/usage/*`, HostResourcePopover/Glance/Diagnosis/StorageDetails/IncidentDetails, HostIdleSuspendStatus, ForceSleepDialog, `hooks/use-host-resource-alert-presentation.ts`, `lib/host-resource-state.ts`. Foundation owner updates corresponding query/API methods; shell owner integrates host selector/summary and per-owner ordering consumers.

Observed `stores/settings.ts:73–106,116–124,218–263,374–416` has a UI-preference allowlist but a global debounce/save chain that calls ambient API. Host pinned mount is written through `useUpdateUiConfig`; `UiConfig` also contains raw project/terminal/runtime orders. Settings file import awaits `file.text()` before mutation; confirmation currently names only active workspace. Usage page/query keys omit owner; host metrics/alerts/idle-suspend status do likewise. `ForceSleepDialog` is host-wide and carries fleet/revision semantics; no new process-management API is required.

### Implementation Steps

#### Executable work packages and integration order

| Package | Deliverable | Needs | Gate |
|---|---|---|---|
| 06A | Explicit preference source and captured debounce transaction | G0 selectors; Phase 01 query/API | A preference save never follows Settings B or project C |
| 06B | Targeted Settings/config/import/export/order/Codex | 06A allowlist boundary; Phase 02 selector | Delayed file reads and confirmations retain target |
| 06C | Usage/host availability and per-profile metrics/alerts | Owner event/query contracts | No cross-owner patches or duplicate-endpoint totals |
| 06D | Revision-fenced destructive host intent and safe checks | 06C; existing backend actor/fleet/revision rules | Fake executor only; no replay on unknown result |

Keep config editing usable for a healthy B when preference source A is unavailable. A source change cancels undispatched debounce; already-dispatched writes keep the original client and report their actual/unknown outcome without applying rollback to the new source.


#### Numbered implementation

1. Hydrate preference source through captured ConnectionRef with owner/generation fencing. Keep last successful allowlisted snapshot offline; first load without a chosen source uses local defaults with visible source-unset status. Disable remote preference saving while unavailable. Source change is explicit: flush an already-dispatched old-source save only to that source, cancel undispatched debounce, preserve unresolved draft/error, then load new source. Never reroute pending patches or use first healthy server.
2. Partition debounce timer, edit revision, pending patch and save chain by selected source transaction; capture the bound client at edit scheduling. Keep current clamp/merge/rollback behavior, but late rollback can alter only that source/revision. Persist source choice and last successful non-secret preference snapshot locally; no remote resource identifiers/secrets in shared snapshot. Do not let settings-target config fetch overwrite workbench preferences unless that target is the chosen source and the user edits its preference allowlist.
3. Add persistent labelled Settings target selector and separate preference-source control. Pass explicit owner to ConfigEditor, GlobalConfigEditor, server configuration selection/setup, workspace discover/init/known list/switch, project CRUD and environment/launch-profile editors. Display server URL/configuration name before write. Configuration switch may have existing server-local destructive effects; confirm them for the owning server and invalidate/revalidate only that profile. It is never invoked by project navigation.
4. Settings export binds request and filename context to target. Import captures target/generation before confirmation and `file.text()`, preserves 1 MiB limit and server backup/validation, rejects stale target before dispatch and labels result with original owner. Clear cache/reset actions operate on selected server only; frontend cache clearing filters that profile. Reset's kill/dispose behavior is explicit in confirmation and is not a connection-management action. Tests must delete obsolete wording-only assertions rather than re-pin them.
5. Usage health/settings/setup, summary/trends/coverage, sessions/detail/audit, pause/resume/configure, data/range deletion and Codex integration all take explicit profile owner. Deep links include profileId. Codex files/collector endpoints and telemetry retention are server-local; never apply preference-source configuration to another server. Destructive actions snapshot owner plus selected range and do not retry after uncertain completion.
6. Host metrics/resource snapshots/alerts/incident history/storage/pinned mount/presentation state key by profile and generation; events patch matching owner only. Keep metric-specific availability/staleness and Linux-deep-metric limitations. Pin a mount only on its server. Per-profile suspend status/timing/fleet refresh use existing capabilities and revisions, not aggregate fleet counts.
7. Force-sleep/power/process-affecting existing actions bind a complete intent before dialog: owner, endpoint label, host snapshot/revision/fleet and request ID. A generation/endpoint/auth change invalidates confirmation. Recheck server revision/conflict response and require refreshed confirmation; never retry ambiguous POST. Keep enabled database-backed actor requirement, no-auth rejection, exact origin policy and all backend inhibitors/executors. User may keep A's labelled dialog while navigating B, but submission still targets A; no implicit retargeting. No new reboot/shutdown/process-kill endpoints are added.
8. Logout/removal of preference source retains last known presentation and marks unavailable; removal of settings target clears target selection and requires explicit replacement. Local keyboard shortcuts route actions using focused resource owner, not preference source. Shared profile labels are safe metadata; credentials and host-sensitive configuration remain outside diagnostics unless existing consent/redaction allows them.

### Todo list

- [ ] Preference source A, Settings target B, project C coexist; each read/save goes to its intended server.
- [ ] Delayed preference save/import/config update cannot reroute after focus/source/target change; outages retain last snapshot and disable saves.
- [ ] Server-local ordering, pinned mount and Codex/usage settings never propagate from preference source.
- [ ] Host statuses/fleet/revisions remain distinct; duplicate profiles are not summed or presented as distinct physical machines.
- [ ] Destructive confirmation names original owner, rejects stale generation/revision, and has no automatic replay.

### Success Criteria

Also cover removal of selected preference source versus Settings target, old-source rollback after source switch, delayed import after endpoint replacement, and stale host fleet revision with no automatic re-confirmation or retry.

Phase 06 checklist and S09/S10/S11.

### Risk Assessment

Global debounce/import state can reroute saves; duplicate profiles must not produce false aggregate host/usage totals.

### Security Considerations

Power/process checks use fakes; existing actor/origin/fleet/revision/inhibitor guards remain intact.

### Next steps

#### Verification and safety

Live S09/S10 verifies preference/config/import/export/usage isolation using temporary servers. Existing settings, usage, host resource and ForceSleepDialog tests cover meaningful state/behavior; extend stale-owner/debounce/import races and per-profile alert isolation. Host suspend/power/process execution is tested only with existing fake executors/in-process test fixtures or a browser transport test adapter; never call a real machine power action, kill an unrelated process or mutate developer Codex/config files. No host permission/backend authorization relaxation is in scope.

#### Plan interpretation

Paths such as `api/`, `hooks/`, `stores/`, `components/`, `contexts/` and `lib/` in this phase are relative to `packages/ui/src/` unless an explicit `server/` or `apps/` prefix is shown. Existing tests mentioned here are updated only where their observable contract changes; proposed test files are not represented as existing. Shared API/shell files follow [execution-map.md](execution-map.md), not concurrent feature ownership.

Unresolved questions: no product decision deferred. Record unavailable qualification prerequisites or contract-relevant source drift before execution.
