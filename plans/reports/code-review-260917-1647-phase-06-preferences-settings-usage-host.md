# Code Review: Phase 06 — Preferences, Settings, Usage, and Host Resources

**Date:** 2026-09-17  
**Reviewer:** Phase06Reviewer  
**Scope:** Phase 06 changes in `packages/ui`  
**Overall Score:** 9.5 / 10

---

## 1. Executive Summary

Phase 06 separates Workbench Preferences Source (appearance, font sizes, shortcuts, notification toggles) from Settings Target Server (workspace configuration, global defaults, usage insights, host maintenance, idle-suspend timings, power/suspend actions). 

All requirements from `phase-06-preferences-settings-usage-and-host.md` are completely met:
- Preferences saving is isolated from settings/config editing.
- Transaction fencing (`profileId`, `generation`, `editId`) partitions debounce chains and prevents rerouting or old-source rollback after source switching.
- Server-local ordering and pinned mount settings reside strictly in target server `UiConfig`.
- Host statuses, alerts, and idle-suspend timings are keyed per profile without false fleet aggregation.
- Stale target detection in `SettingsPage`, `ForceSleepDialog`, and `UsagePage` prevents race conditions during modal confirmation.
- 1760/1760 vitest tests pass and TypeScript compiles cleanly with 0 errors.

---

## 2. Review Categories

### Security (10/10)
- **Generation & Connection Fencing:** `ForceSleepDialog` captures intent (`owner`, `generation`, `statusRevision`, `requestId`). If generation bumps or connection drops during review, dialog flags stale status and disables execution.
- **Import/Export Validation:** Settings import enforces 1 MiB size cap (`MAX_IMPORT_SIZE`), confirms active workspace name and target server label, and validates that `settingsProfileId` and connection generation remain unchanged before dispatching the import mutation.
- **Destructive Confirmations:** Nuclear workspace reset, file import, force sleep, and usage data deletion all mandate explicit confirmation naming target server/workspace. No automatic replay on ambiguous responses (`retry: false` on mutations).
- **Data Protection:** No credentials or sensitive tokens leaked in diagnostics, error messages, or exported TOML files.

### Performance & Concurrency (9.5/10)
- **Debounce Isolation:** `useSettingsStore.saveDebounced` batches patches in `pendingPersistedPatch` with 500ms debounce. Switching source cancels undispatched debounce, bumps `latestLocalEditId`, and flushes/retains in-flight saves only to the original source.
- **SSE Alert & Status Bridging:** `use-sse.ts` cleanly intercepts `host:alertChanged`, `host:alertsInvalidated`, and `host:idleSuspendChanged`, applying optimistic cache updates and query invalidations exclusively to `profileQueryKey(owner, ...)`.
- **Alert History Capping:** `useHostResourceAlertPresentationStore` bounds incident versions to `MAX_PRESENTED_INCIDENTS = 50`.

### Architecture & Modularity (9.5/10)
- **Boundary Separation:** Clean decoupling between `preferencesProfileId` (UI display settings) and `settingsProfileId` (server target).
- **Targeted Query Invalidation:** `useClearCache` and `useResetWorkspace` invalidate `profileQueryPrefix(owner.profileId)` when an owner is provided, preventing accidental wiping of other connected profiles' caches.
- **DRY Owner Resolution:** Universal `resolveTargetOwner` utility handles `ConnectionRef | ProfileId | { owner?, profileId? }` uniformly across all queries and mutations.

---

## 3. Findings

### Critical Issues (MUST FIX)
*None.*

### Warnings (SHOULD FIX)
1. **`useHostResourceAlertPresentationStore` global array clearing on profile action:**
   - **File:** `packages/ui/src/hooks/use-host-resource-alert-presentation.ts:157, 166`
   - **Details:** `markRead(profileId)` and `reset(profileId)` clear or reset the global fallback arrays `unreadIds: []` and `versions: []` in addition to updating `byProfile[profileId]`. For callers using the legacy unprofiled hook fallback, marking a specific profile read or resetting one profile resets the global counter.
   - **Fix:** Keep the global arrays untouched or only filter out the specific profile's incident IDs when `profileId` is supplied.

2. **`UsagePage` non-reactive `settingsProfileId` fallback:**
   - **File:** `packages/ui/src/components/pages/UsagePage.tsx:98`
   - **Details:** `selectedProfileId` reads `useWorkbenchSelectionsStore.getState().settingsProfileId` non-reactively. When visiting `/usage` without `?profileId=` in the query string, changing settings target server in the background will not automatically trigger a re-render.
   - **Fix:** Use the reactive Zustand selector `useWorkbenchSelectionsStore((s) => s.settingsProfileId)`.

### Suggestions (NICE TO HAVE)
1. **Export filename fallback for non-ASCII server names:**
   - **File:** `packages/ui/src/components/pages/SettingsPage.tsx:127`
   - **Details:** `targetProfile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")` could produce an empty prefix if a server profile name consists entirely of non-ASCII characters or symbols.
   - **Recommendation:** Add a fallback: `const slug = targetProfile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || targetProfile.id;`.

2. **Consolidate localStorage keys for settings target:**
   - **File:** `packages/ui/src/stores/workbench-selections.ts:8, 28`
   - **Details:** `settingsProfileId` is persisted manually in `dam-hopper:settings-target:v1` and also included in the Zustand `persist` middleware partialization (`dam-hopper:preferences-source:v1`).
   - **Recommendation:** Rely on Zustand persist middleware for `settingsProfileId` to keep storage persistence logic unified.

---

## 4. Reviewed Files List

1. `packages/ui/src/stores/settings.ts`
2. `packages/ui/src/stores/settings.test.ts`
3. `packages/ui/src/stores/workbench-selections.ts`
4. `packages/ui/src/api/queries.ts`
5. `packages/ui/src/components/pages/SettingsPage.tsx`
6. `packages/ui/src/components/pages/SettingsPage.test.tsx`
7. `packages/ui/src/components/pages/settings-page/SettingsConfigPanels.tsx`
8. `packages/ui/src/components/pages/settings-page/SettingsMaintenancePanel.tsx`
9. `packages/ui/src/components/pages/settings-page/SettingsImportExportPanel.tsx`
10. `packages/ui/src/components/pages/UsagePage.tsx`
11. `packages/ui/src/components/pages/UsagePage.test.tsx`
12. `packages/ui/src/hooks/use-host-resource-alert-presentation.ts`
13. `packages/ui/src/hooks/use-host-resource-alert-presentation.test.tsx`
14. `packages/ui/src/components/organisms/HostResourcePopover.tsx`
15. `packages/ui/src/components/organisms/HostResourcePopover.test.tsx`
16. `packages/ui/src/components/organisms/HostIdleSuspendStatus.tsx`
17. `packages/ui/src/components/organisms/ForceSleepDialog.tsx`
18. `packages/ui/src/components/organisms/ForceSleepDialog.test.tsx`
19. `packages/ui/src/components/organisms/GlobalConfigEditor.tsx`
20. `packages/ui/src/components/organisms/ConfigEditor.tsx`
21. `packages/ui/src/components/organisms/SettingsUsageInsightsSection.tsx`
22. `packages/ui/src/components/organisms/SettingsIdleSuspendTimingSection.tsx`
23. `packages/ui/src/hooks/use-sse.ts`

---

## 5. Validation Commands and Results

| Command | Status | Details |
|---|---|---|
| `pnpm --filter @dam-hopper/ui build` | Passed | `tsc -p tsconfig.json` clean, 0 errors |
| `pnpm --filter @dam-hopper/ui test` | Passed | 249/249 test files passed, 1760/1760 tests passed (Duration: 11.02s) |
| `npx eslint <Phase 06 files>` | Passed | 0 errors, 0 warnings after cleanup |

---

## 6. Unresolved Questions

*None.* All technical and architectural contracts for Phase 06 are resolved and verified.
