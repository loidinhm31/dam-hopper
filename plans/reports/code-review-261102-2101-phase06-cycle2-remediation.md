# Phase 06 — Cycle 2 Remediation Review

## Score

**6/10 — changes required.** Substantial progress; not all Cycle 1 critical issues/warnings closed.

## Summary

Implemented/confirmed by source inspection:
- Monitor now adopts `useAggregatedTerminalSessions()`; session row actions pass profile ID and use the owner-bound API.
- Confirmation checks connection generation and owner-qualified cached incarnation. Standard Radix-backed Dialog replaces custom modal; nested kill-button keyboard propagation stopped.
- Tray/profile/session/confirmation labels gain partial Cognito masking.
- Existing Monitor singleton switches desktops before reveal. Storage mutation wired to selected owner. Force-sleep target freezes status and owner together.
- OsShell owns activity subscription lifecycle; host alert/idle event names corrected.
- Shared coordinator remains canonical telemetry transport; source tracing shows one coordinator per `(QueryClient, profileId, generation)`, reference-counted cleanup, document-hidden pause and Monitor body unmount when hidden/minimized. No new per-component SSE implementation found. Mounted tray+Monitor lease/backpressure behavior still lacks direct integration assertions.

Validation receipt from `agent://Tester-2`: **79 scoped unit/integration tests, 43 browser tests passed; full suite 3,160 passed; TypeScript compile passed.** Not rerun by reviewer. Passing tests do not close source-backed defects below.

### Cycle 1 critical disposition

| Item | Cycle 2 status |
|---|---|
| C1 aggregate sessions / owner-qualified targeting | Primary defect fixed; unsafe cache fallback remains under C2 |
| C2 stale generation / replacement incarnation | Partial; cached comparison is not authoritative |
| C3 comprehensive Cognito redaction | Partial; host identities/detail/error paths still exposed |
| C4 standard Dialog / focus / input containment | Primitive and row containment fixed; shell shortcut containment incomplete |
| C5 exact incident reveal / read policy | Partial; ID banners added, actual incident selection and cross-host read state broken |
| C6 lifecycle-owned typed activity ingestion | Lifecycle placement fixed; actual channel coverage and safe projection incomplete |

## Critical issues — MUST FIX

### C2 — High: replacement protection still relies on stale cache; mutation remains ID-only

**Evidence:** `packages/ui/src/os/apps/SystemMonitorApp.tsx:225-244,255-296`; `packages/ui/src/hooks/use-aggregated-terminal-sessions.ts:20,54-82`; `packages/ui/src/api/client.ts:3263`; `packages/ui/src/api/ws-transport.ts:630-634`; `server/src/api/terminal.rs:305-310`.

Generation is captured from the current connection at click, not carried by displayed row data. Confirmation reads cache without checking invalidation/refetch state, falls back to ambient `["terminal-sessions"]` and then rendered aggregate data, and skips incarnation comparison if the live record lacks incarnation. DELETE still carries only ID; server kills whatever incarnation currently owns that ID.

**Failure/impact:** A same-ID restart before its push/refetch arrives leaves the old cache intact; confirmation accepts the old incarnation and kills the replacement. Ambient fallback can validate against another owner's same-ID record. The new tests prove changed-cache rejection, not replacement safety.

**Correction:** Carry row owner generation; fail closed on missing/stale qualified identity; remove ambient/rendered-data fallback. Fresh owner-bound revalidation must recheck ownership after await. To guarantee replacement safety, enforce expected incarnation atomically in the mutation/server manager; frontend-only cache checks cannot close this race. Requires approved ownership/API scope expansion, already identified in Cycle 1. **Confidence: high; source-backed, not runtime-reproduced.**

### C3 — High: Cognito still exposes host/detail identities and kill errors

**Evidence:** `HostResourceFleetDeck.tsx:70-84` only replaces profile name/URL; `HostResourceFleetCard.tsx:41-43,119-124` still renders snapshot hostname/OS identity. `SystemMonitorApp.tsx:479-487` passes raw snapshot/metrics into diagnosis; `HostResourceDiagnosis.tsx:153-155,169-198` renders mount path, process name/PID and cgroup path. `SystemMonitorApp.tsx:257-268,657-660` renders profile-bearing error messages unchanged. All component paths under `packages/ui/src/components/organisms/` unless otherwise qualified.

**Failure/impact:** Loaded fleet snapshots reveal real hostname while profile says Protected; loaded drilldowns reveal private paths/processes. A failed confirmation can expose its raw profile identity despite protected labels.

**Correction:** Apply a consistent identity-safe presentation boundary to loaded snapshots/detail children and error text, including tooltips/ARIA. Add negative assertions with populated telemetry and errors; existing privacy test checks commands/projects only. This concerns the requested Phase06 masking contract, not a claim that Cognito provides authentication or OS-wide secrecy. **Confidence: high; source-backed.**

### C4 — High: destructive Dialog does not suppress shell shortcuts

**Evidence:** `SystemMonitorApp.tsx:612-683` uses Dialog but installs no modal shortcut boundary. `packages/ui/src/os/OsShell.tsx:168-219` opens palette/cycles focus without checking modal state. `packages/ui/src/os/WindowFrame.tsx:209-245,303` handles key capture in the React ancestor; Dialog portal events remain in that React tree.

**Failure/impact:** Ctrl+Alt+K can open CommandPalette during destructive confirmation; focus-cycle chord can change focused window while the modal remains open. Radix Tab trapping is not OS shortcut containment. New browser test only asserts a dialog exists.

**Correction:** Make shell/frame shortcut arbitration modal-aware, including portaled content; preserve Cognito/IME precedence and modal Escape handling. Add keyboard-open, Tab/Shift+Tab, Escape, opener-focus restoration and palette/focus-cycle suppression assertions with a sibling terminal. Nested row activation is fixed. **Confidence: high for missing guards; behavioral failure inferred from event routing, not runtime-reproduced.**

### C5 — High: exact incident remains a banner; acknowledging A hides B's attention

**Evidence:** `SystemMonitorApp.tsx:106-122,414-431,479-487`; `HostResourceDiagnosis.tsx:56-68`; `HostResourceIncidentDetails.tsx:61-118`; `packages/ui/src/hooks/use-host-resource-alert-presentation.ts:153-165`; `packages/ui/src/os/MonitorTray.tsx:40-52`.

`highlightIncidentId` only creates another ID banner; it is never passed into actual incident details, which still slice to five items. No exact incident lookup, selected evidence, scroll or unavailable/resolved state. `markRead(profileA)` clears global `unreadIds` for every host; tray immediately returns no alert target when global list is empty, even if `byProfile.B.unreadIds` remains nonempty. Changing inspected host also retains the old `selectedIncidentId` (`SystemMonitorApp.tsx:108-114`; `OsShell.tsx:632-637`).

**Failure/impact:** User can acknowledge an unseen/missing incident, dismiss another host's alert dot, or see A's incident ID attached to B's telemetry.

**Correction:** Reveal the exact `(profileId, incidentId)` incident/evidence, including targets outside the first five; show honest not-found/resolved state. Keep selection tuple atomic. Acknowledgment must preserve unrelated incidents/owners and derive global attention consistently from the same authority. Test two hosts with simultaneous unread incidents. **Confidence: high; source-backed.**

### C6 — High: ingestion placement fixed, but terminal/agent activity still disconnected and projection unsafe

**Evidence:** `OsShell.tsx:77-80`; `packages/ui/src/os/notifications.ts:113-168`; `packages/ui/src/hooks/use-sse.ts:198-219,529-532`; `packages/ui/src/api/ws-transport.ts:2495-2533`.

Allowlist names terminal exit/crash/spawn/restart and agent status/attention, but IPC bridge does not forward those channels. Terminal frames go through dedicated callbacks; restart produces `terminal:changed`, which ingestion excludes. Git status uses `status:changed`, also excluded. Host alert/idle channels now match correctly. Arbitrary `data.message` is still copied into notification body; a string allowlist is not typed, content-safe projection. Ingestion also defaults missing owner identity to default/generation 0 instead of requiring authoritative ownership.

**Failure/impact:** Normal OS terminal/agent activity cannot reach this new ingestion path; accepted progress messages can persist private content in notification history.

**Correction:** Connect lifecycle-owned ingestion to actual typed event/store contracts; project explicit bounded safe fields into fixed summaries, reject stale/unqualified owners, and avoid duplicate ingestion while legacy Dashboard remains. Add production-channel delivery/cleanup and sensitive-payload exclusion tests. `notifications.test.ts` currently tests FIFO/redaction/filter helpers, not `ingestIpcActivityEvent`. **Confidence: high; source-backed.**

## Warnings — SHOULD FIX

1. **W1 partial — canonical source/status still bypassed.** `MonitorTray.tsx:78-108` uses query `isStale` before canonical status and defaults unhandled `terminal-unavailable`/`unavailable` to Live. Connecting connections display Offline. Query staleness is not stream freshness; REST_ONLY is not live SSE. `SystemMonitorApp.tsx:147-148,434-458` now uses canonical label, but dot/glance stale flags still use query staleness. Consume canonical freshness/source/status consistently.
2. **W2 closed by source — cross-desktop singleton reveal.** `OsShell.tsx:625-631,670-676` switches desktop before restore/focus; browser case added at `os-system-monitor.browser.tsx:459-494`.
3. **W3 mostly closed — storage pin mutation real; glance omits pin.** Owner-qualified config/mutation props now reach diagnosis (`SystemMonitorApp.tsx:165-167,479-486`), but Glance at lines 454-459 omits `pinnedMount`. Legacy popover passes it to both (`HostResourcePopover.tsx:519-524,559-565`). Pinned selection can disagree with summary mount. Wire the same selected-owner preference into Glance.
4. **W4 open — idle tray requirement absent.** `MonitorTray.tsx:126-214` still contains only metrics/alert controls. No idle timing/status or correct-host action affordance. `system:monitor.tab`/persisted `activeTab` never consumed by Monitor.
5. **W5 partial — broader tests, material gaps remain.** Seven new OS scenarios now cover jump, owner-qualified rows, updated generation/cache incarnation, desktop reveal and negative command/project masking. Missing fresh/stale displayed-owner/restart race, populated snapshot hostname/error masking, exact incident evidence/read isolation, kill-modal keyboard arbitration, mounted tray+Monitor SSE sharing/release and event ingestion. Existing popover focus tests do not validate the new destructive Dialog; coordinator unit tests do not validate this composition.
6. **W6 closed by source — frozen force-sleep owner.** `SystemMonitorApp.tsx:134-139,595-601,686-693` captures owner with status and keeps both for the dialog. No privileged sleep exercised.

## Suggestions — NICE TO HAVE

- Extract SessionRow into a leaf module rather than importing Dashboard's hooks/activity/route dependencies.
- Consolidate duplicated Monitor reveal handlers; remove unused `useId`, `FolderGit2`, `AggregatedSessionInfo`, `dirtyProjects` and similar dead weight.
- Persist real session profile/type filters instead of unused activeTab/transient incident selection. Clear stale incident selection on ordinary host navigation.
- Update product/changelog docs after behavior is corrected. Phase plan intentionally left unchanged: review assignment forbids TODO/task-state tracking.

## Reviewed files

Changed/new:
- `packages/ui/src/os/apps/SystemMonitorApp.tsx`
- `packages/ui/src/os/MonitorTray.tsx`
- `packages/ui/browser-tests/os-system-monitor.browser.tsx`
- `packages/ui/src/os/{OsShell,TopBar,Dock}.tsx`
- `packages/ui/src/os/{app-registry,app-registry.test,intents,notifications,persistence,types}.ts`
- `packages/ui/src/components/pages/DashboardPage.tsx`
- `packages/ui/src/components/organisms/{HostResourceFleetDeck,HostResourceDiagnosis,HostResourceGlance,HostIdleSuspendStatus}.tsx` (diff/selected implementation sections)

Supporting contracts/sections:
- `hooks/{use-aggregated-terminal-sessions,use-multi-host-resources,use-host-resource-alert-presentation,use-sse,use-sse-events}.ts`
- `api/{queries,client,ws-transport,host-resource-stream-coordinator}.ts`
- `lib/{host-resource-state,terminal-incarnation-state}.ts`
- `components/organisms/{HostResourceFleetCard,HostResourceIncidentDetails,HostResourcePopover,ForceSleepDialog}.tsx`
- `components/ui/Dialog.tsx`; `os/{DesktopCanvas,WindowFrame,NotificationCenter}.tsx`; `os/{input-arbiter,notifications.test}.ts`
- `server/src/api/terminal.rs`; `server/src/pty/event_sink.rs` excerpts
- Phase06 plan; README; PDR; code standards; Cycle1 receipt `agent://CodeReviewer`; Cycle2 validation receipt `agent://Tester-2`.

Paths in supporting list are relative to `packages/ui/src/` unless prefixed `server/`.

## Validation commands and results

Evidence: Tester-2 terminal receipt (`agent://Tester-2:12-102`), not reviewer execution.

| Command | Result |
|---|---|
| `pnpm --filter @dam-hopper/ui test -- src/os src/api/host-resource-stream-coordinator.test.ts src/components/organisms/HostResourceFleetDeck.test.tsx` | Expanded to full UI suite: 337 files, **3,160 passed**, two non-fatal jsdom navigation diagnostics |
| Same command without forwarded `--` | Scoped: 11 files, **79 passed**, 0 failed |
| `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/os-system-monitor.browser.tsx browser-tests/host-resource-monitoring.browser.tsx browser-tests/idle-suspend-settings-status.browser.tsx` | 3 files, **43 passed**, 0 failed |
| `pnpm --filter @dam-hopper/ui build` | Exit 0; **`tsc -p tsconfig.json`**, zero diagnostics; not a bundle build |

No separate lint, coverage percentage, live-server SSE lease exercise, physical PTY-input isolation or privileged sleep exercise claimed. Runtime failure scenarios in findings not independently reproduced; static evidence and tester results kept distinct. Source/test/plan files not edited by reviewer; only this report written.

## Unresolved questions

- Who owns the required expected-incarnation mutation/server contract expansion? Existing Phase06 frontend-only scope cannot satisfy authoritative replacement-process safety. This remains an acceptance blocker, not permission to implement outside ownership.
