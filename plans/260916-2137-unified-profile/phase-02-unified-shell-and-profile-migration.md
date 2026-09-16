# Phase 02 — Independent connections and unified navigation

### Context links

[Confirmed validation decisions](validation-decisions.md): fresh old-resource reset, mandatory new contracts, per-platform release.

[Overview](plan.md) · [Canonical plan](plan.md) · [Contracts](design-contracts.md) · [Coverage](coverage-and-decisions.md). Dependency: Phase 01 contracts.

### Overview

Date: 2026-09-16. Priority: P1. Implementation: pending (0%). Planning status: specified; runtime verification: not run. Scope: Shell and connections.

### Key Insights

#### Source evidence

`embed/dam-hopper-app.tsx:193–424` blocks routes behind one profile/auth/workspace and reinitializes transport on active selection. `ServerSettingsDialog.tsx:207–352` persists metadata/token separately, activates new profiles and reloads the page; `ServerProfilesDialog.tsx:34–61` revokes previous profile media on switch. `stores/workspace.ts` persists only a project name. `ProjectSwitcher.tsx` falls back to first project; `TopNavUtilityStrip.tsx` embeds the backend `WorkspaceSwitcher`. Web and native main initialize one transport and ambient query hashing.

### Requirements

Independent login/connection controls and one profile→project navigation hierarchy without remount/reconnect on focus.

### Architecture

Use the shared canonical qualified refs, captured ConnectionRef, owner-bound API/query/event contracts and per-profile lifecycle. Server identifiers remain server-local; feature state never resolves an ambient active profile.

### Related code files

#### Context and dependency

Depends on Phase 01 contracts. Integration owner owns shell, bootstrap and profile settings; feature teams do not concurrently edit these shared files.

### Implementation Steps

#### Executable work packages and integration order

| Package | Deliverable | Needs | Gate |
|---|---|---|---|
| 02A | `autoConnect`, endpoint-bound auth v2, storage availability/revision handling | G0 | Verified migration; old bearer never reaches edited endpoint |
| 02B | Always-mounted shell and explicit connection actions | Phase 01 runtime interfaces; 02A | Partial startup, zero profiles/projects, no reload |
| 02C | Qualified project navigation and independent selectors | G0 refs; 02B | Focus emits no connection/config mutation |
| 02D | Fresh resource reset and host bootstrap cutover | Feature key/version inventories; target platform support | No legacy restore or remote mutation; target G1 |

02A may be developed alongside Phase 01; land profile/auth helpers before runtime startup consumes them. Keep the old active-profile key private and migration-only. Preserve public same-origin host bootstrap configuration, but never use it as a fallback for an explicitly invalid/unsupported profile.


#### Numbered implementation steps

1. Extend `api/server-config.ts` `ServerProfile` with required `autoConnect: boolean`; read legacy records with missing property as true and persist idempotently after successful storage validation. Update `createProfile`, `migrateToProfiles`, `reconcileManagedProfile`, profile forms and fixtures; preserve an explicit false. Keep storage-unavailable distinct from no profiles and preserve native aliases/tombstones.
2. Implement endpoint-bound credential records exactly as canonical contract. Public token/header helpers require profileId, legacy optional helpers become private migration-only operations. Profile form edits stage URL/auth/token and commit coherent records; invalidate runtime before replacement, and fail closed on partial storage/cross-tab events. Abort late login/test responses after edit/removal. Do not transmit old bearer to an edited URL.
3. Replace app-wide `ServerProfileGuard`, `AuthGuard`, `WorkspaceGuard` with always-available shell and per-profile status/setup/login rows. Keep existing no-auth login request `{}` and credential form behavior bound to each profile; authType basic without token is login-required. Bootstrap auto-connect each enabled supported profile independently. Healthy profiles render while others load/fail; zero projects or zero profiles shows empty-state Connections/Settings, never an unclosable modal.
4. `ServerProfilesDialog.tsx` exposes Connect, Disconnect, Login, Logout, Edit, Remove and Auto-connect on each row with profile URL/status. All handlers take profileId. Disconnect invalidates runtime/aborts client work without clearing token or killing PTYs; Logout additionally clears its credentials/secrets and revokes only its media session. Remove confirms local profile/resource impact, invalidates before deletion, preserves recoverable drafts and scoped native cleanup. Editing inactive B does not reload A; remove page reloads and old Switch action entirely.
5. `stores/workspace.ts` stores qualified `ProjectRef | null` and navigation revision. Aggregate per-profile projects in `ProjectSwitcher`, TopNav and Dashboard; group `Profile → Project` (label may say Workspace/Profile, no additional level), expose sanitized server URL plus configured project path. Encode select values with tuple keys. No missing-name fallback; unavailable selected project stays explicitly unavailable. User selects resource owner through picker, not a connection action.
6. Move backend registry selection (`WorkspaceSwitcher`, known-workspace controls, setup wizard) into selected-profile Settings as “Server configuration”. Keep its existing API terminology/behavior; do not rename backend workspace APIs or make this a workbench hierarchy. TopNav brand is unified workbench; connection summary links to all profile statuses. Dashboard aggregates project/session references, owner-labels activity, and sends kill/export/navigation through row owner.
7. Separate preferencesProfileId, settingsProfileId, selected project and Browser target; start unset after fresh resource cutover and require explicit selection. Never seed from old active profile or first healthy server. Add independent controls in Connections/Settings. Removing a new-version preference source retains its cached snapshot with source-removed status until explicit replacement.
8. Update `apps/web/src/main.tsx` and `apps/native/src/main.tsx`: perform profile migration (and web managed runtime reconciliation), create ordinary QueryClient and shared connection orchestration, then render once. No profile-specific root key. Keep web runtime-config validation/bounds and native Browser/SSH provider/platform detection. Convert `native-server-url.ts` to explicit per-profile support check or remove its now-obsolete active-profile accessor. Browser/Windows allow current HTTP(S) remote transport; non-Windows native stays exact same-origin-only. Unsupported profiles remain editable/listed and produce no fallback traffic.
9. Implement the validated fresh-state reset: discard enumerated legacy selected-project/editor/tree/target/search/layout/pin/history/Browser-history records and associated old quarantine backups. Start empty new-version stores; no backup, archive, owner assignment or restore UI. Preserve saved profiles/auth conversion, native aliases/vault/trust, presentation-only settings and all server data. Never localStorage.clear(). Verify per-store reset, retain already-valid new-version entries across retries, ignore old records in memory if storage fails and report failure. Show an informational fresh-start/data-loss notice. Reject unqualified legacy links with fresh-navigation guidance; new links require profileId. No reset-triggered remote writes or PTY creation/deletion.

### Todo list

- [ ] A/B/C boot independently with A healthy, B login-required, C unsupported/offline; Connections/Settings remain accessible.
- [ ] Existing profiles migrate autoConnect=true; explicit false remains false, including managed-profile reconciliation.
- [ ] A project selection never changes socket count, credentials, server config, Browser target or preference source.
- [ ] Equal project names have distinct grouped rows, URL/path disambiguation and qualified deep links.
- [ ] Profile edit/removal/cross-tab credential changes cannot dispatch old token to new endpoint.
- [ ] Legacy browser resources are dropped once without touching saved profiles/server resources; valid new-schema records survive retries and reloads.

### Success Criteria

Also cover storage quota/read denial, malformed persisted JSON, interrupted auth migration, cross-tab endpoint/auth changes, delayed login after remove, and edit A→B→A before login completion. Verify reset is idempotent, deliberately does not recover old resources, and never deletes valid new-schema entries or unrelated keys.

Phase 02 acceptance checklist and S01/S02/S12.

### Risk Assessment

Fresh reset intentionally loses old browser resource state. Explain this in the upgrade notice; no rollback restoration claim. Narrow allowlist and schema checks prevent accidental profile/native/server data deletion.

### Security Considerations

No old-token/new-endpoint traffic; preserve native origin restrictions and storage-unavailable handling.

### Next steps

#### Verification and security notes

Focused existing tests: `src/api/server-config.test.ts`, `src/components/organisms/ServerProfilesDialog.test.tsx`, `ServerSettingsDialog.test.tsx`, `TopNav.test.tsx`; add shell regression for one blocked profile not gating another. Delete tests whose only purpose is old switching/reload wording, replace only observable ownership behavior. Live two-server scenario must prove socket continuity and no workspace-switch request on navigation. Read connection URLs without embedded credentials; retain exact CORS/origin policy. Profile tokens remain frontend-readable as before; no new secret persistence except endpoint metadata around existing token.

#### Plan interpretation

Paths such as `api/`, `hooks/`, `stores/`, `components/`, `contexts/` and `lib/` in this phase are relative to `packages/ui/src/` unless an explicit `server/` or `apps/` prefix is shown. Existing tests mentioned here are updated only where their observable contract changes; proposed test files are not represented as existing. Shared API/shell files follow [execution-map.md](execution-map.md), not concurrent feature ownership.

Unresolved questions: no product decision deferred. Record unavailable qualification prerequisites or contract-relevant source drift before execution.
