# Phase 06 — Cycle 3 Final Review

## Score

**6.5/10 — changes required.** Named small edits mostly present; broader Cycle 2 defects remain. Not final acceptance.

## Summary

Source-confirmed remediation:

| Requested check | Disposition |
|---|---|
| C3 fleet hostname -> `protected-host` | Present: `HostResourceFleetDeck.tsx:71-87` |
| C3 kill error / terminal option masking | Present: `SystemMonitorApp.tsx:200-208,664-667` |
| C4 Dialog marker / keyboard propagation stop | Present: `SystemMonitorApp.tsx:620-624`; capture-phase containment still broken |
| C5 profile selection clears incident | Present: `SystemMonitorApp.tsx:108-117` |
| C5 acknowledgment marks read and clears selection | Present: `SystemMonitorApp.tsx:119-126`; cross-host read-state bug remains |
| C6 actual terminal/status event names | Both present, with fixed titles: `notifications.ts:119-120,175-176` |
| C6 ingestion unit test | Direct-function test added in **browser** suite at `os-system-monitor.browser.tsx:536-549`; `notifications.test.ts` unchanged; no status-event assertion |
| W1 MonitorTray status mapping updated | Not satisfactorily remediated: unsupported/auth-blocked/stale modes can still become Live |
| W3 Glance pinnedMount | Present: `SystemMonitorApp.tsx:458-464` |
| W4 expanded browser coverage | One direct ingestion case added; material keyboard, populated privacy, acknowledgment, source-state and lease-lifecycle oracles remain absent |

Architecture positive: tray/app reuse `useMultiHostResources`, `useHostMetrics` and canonical `HostResourceStreamCoordinator`; no new component-owned SSE implementation found. Coordinator keyed by exact QueryClient plus owner, interest cleanup reference-counted, no-interest/hidden-document paths stop streams. Monitor body unmounts on minimize/desktop removal while tray remains mounted. This is source tracing, **not** runtime proof of zero duplicate leases/backpressure release.

Tests: independently inspected **Cycle 2** receipt at `agent://Tester-2:12-102`: 79 scoped tests, 43 browser tests, 3,160 full-suite tests passed; TypeScript compile exit 0. These precede current remediation and do not certify Cycle 3. No review-owned commands rerun: phase contract reserves validation to main integration owner.

## Critical issues — MUST FIX

All findings below high confidence from inspected source; runtime failure scenarios not reproduced by reviewer.

### C4 — High: modal bubble stop cannot prevent frame capture shortcuts

- Evidence: `SystemMonitorApp.tsx:620-624`; `WindowFrame.tsx:209-245,303`; `input-arbiter.ts:117-124`. Repository search finds no consumer of `data-os-modal`.
- Failure: React portal key events traverse the logical ancestor frame. Frame `onKeyDownCapture` processes Ctrl+Alt+Escape **before** Dialog's `onKeyDown` can stop propagation, changes focused window and suppresses the modal's event. Palette window-bubble handling is improved; focus-cycle containment is not fixed.
- Correction: make frame/shell shortcut arbitration explicitly modal-aware, preserving Cognito/IME precedence and modal Escape. Exercise actual keyboard opening, Tab/Shift+Tab, Escape/focus return and focus-cycle/palette suppression with a sibling terminal.

### C5 — High: acknowledgment still hides other hosts; incident reveal remains ID-only

- Evidence: `SystemMonitorApp.tsx:119-126,419-435,484-493`; `use-host-resource-alert-presentation.ts:153-165`; `MonitorTray.tsx:40-52`; `HostResourceDiagnosis.tsx:56-68`; `HostResourceIncidentDetails.tsx:61-118`.
- Failure: `markRead(profileA)` returns global `unreadIds: []` even with unread profile B. Tray immediately returns no target when the global list is empty. Acknowledging A hides B's attention. `highlightIncidentId` still renders only a banner; actual incident details ignore selection and slice to five. A user can acknowledge an incident whose evidence was never revealed.
- Also: `OsShell.tsx:632-637` merges a new profile without clearing an old incident when a normal tray/system-monitor intent carries no incident; the new local profile handler does not cover this path.
- Correction: derive attention from one owner-qualified authority, preserve unrelated hosts/incidents, update selection tuple atomically across all entry points, resolve the exact incident/evidence or display an honest missing/resolved state. Test two simultaneous unread hosts and selection outside the first five incidents.

### C3 — High: narrow privacy patches land; loaded drilldowns remain unmasked

- Evidence: `SystemMonitorApp.tsx:458-493` passes raw telemetry into Glance/Diagnosis; `HostResourceGlance.tsx:146-161` renders saved/selected mount paths; `HostResourceDiagnosis.tsx:153-155,169-198` renders mount, process name/PID and cgroup path. No Cognito boundary in those components.
- Failure: hostname and kill text are now protected, but populated details still expose requested identities through rendered text. Existing privacy test never populates snapshots/metrics/error fixtures, so cannot detect this.
- Correction: consistently mask identity-bearing detail presentation, including child storage/incident/temperature labels, ARIA/tooltips and error paths. Add populated negative assertions. This is Phase06's requested masking contract, **not** a claim Cognito is authentication or OS-wide redaction.

### C6 — High: allowlist extension does not establish safe typed activity projection

- Evidence: `notifications.ts:163-170,183-191`; `use-sse.ts:198-219,529-532`; `OsShell.tsx:78-80`; `DashboardPage.tsx:181-182`.
- Failure: arbitrary `data.message` is still copied into the persistent-in-memory notification history (truncation is not content safety). Missing owner fields become default/generation 0; ingestion itself accepts stale/unqualified events. Terminal/agent lifecycle entries remain listed without corresponding generic bridge channels; adding `terminal:changed` restores session-change summaries, not agent/crash/exit delivery. Legacy Dashboard also calls the same ingestion path if mounted concurrently.
- Correction: use actual typed owner-qualified producer contracts and explicit safe bounded summaries, reject invalid ownership, establish one ingestion owner; test production delivery/cleanup and sensitive-payload exclusion rather than only calling the helper directly.

### C2 carryover — High: replacement-process kill safety remains unsatisfied

- Evidence: `SystemMonitorApp.tsx:236-247,276-300`; `use-aggregated-terminal-sessions.ts:20,54-82`; `api/client.ts:3263,4024`; `server/src/api/terminal.rs:305-310`.
- Failure: generation comes from current connection at click rather than displayed row; confirmation trusts cached sessions, falls back to ambient/rendered data, skips comparison when current incarnation is absent. Mutation carries ID only; server kills current occupant. A replacement arriving before cache refresh can still be killed.
- Correction: fail closed on missing/stale owner-qualified identity, carry displayed owner generation, freshly revalidate and recheck owner after await. Authoritative replacement safety requires an atomic expected-incarnation mutation/server contract. Scope expansion or explicit acceptance of reduced guarantees is a coordinator decision, not silently closed by this review. C2 was not among this cycle's specifically requested small edits; it remains a phase acceptance blocker.

## Warnings — SHOULD FIX

1. **W1 still open — dishonest tray status.** `MonitorTray.tsx:78-108` checks query `isStale` before canonical status, omits canonical `stale`, `terminal-unavailable` and `unavailable`, defaults to Live, and calls connecting connections Offline. An auth-blocked connected owner can appear Live; REST-only is indistinguishable from live SSE. Compare `host-resource-state.ts:394-465` and architecture docs `docs/architecture/host-resource-sse.md:131-142`. Consume source freshness/mode and canonical presentation, not query-cache staleness. Monitor's dot/Glance stale props also still use `isSelectedStale` (`SystemMonitorApp.tsx:151-152,442,462`).
2. **Idle tray requirement absent.** Entire `MonitorTray.tsx:126-214` contains only alert and metric controls. No idle timing/status/correct-host action affordance. `system:monitor.tab` is written by shell but never consumed by Monitor. Original Cycle 2 W4 remains open despite the current checklist using W4 for browser expansion.
3. **Regression evidence incomplete.** `os-system-monitor.browser.tsx:285-289` merely checks Dialog existence, not focus trapping or shortcut containment; `407-457` checks ID banner rather than evidence/read isolation; `497-534` has no populated host telemetry or kill errors; `536-549` directly invokes ingestion, proving neither bridge delivery nor cleanup. No tray+Monitor SSE lease counter/release oracle, REST-only/auth-blocked status assertions, pinned mount behavior or new profile/acknowledge-handler tests.
4. **`status:changed` misclassified.** `notifications.ts:144-147,175` titles it Repository Status Changed but assigns source `system`, not `git`. Git notification filtering can omit newly connected repository activity. Add unit assertions for both newly accepted event types and unknown/stale/sensitive inputs.

## Suggestions — NICE TO HAVE

- Extract `SessionRow` to a leaf module rather than importing Dashboard page hooks/router/activity dependencies into Monitor.
- Remove unused `useId`, `FolderGit2`, `AggregatedSessionInfo`, `dirtyProjects`, tray `Activity` import and unused `statusDisplay.live`; no abstraction expansion needed.
- Consolidate duplicate monitor reveal handlers and duplicate incident banners.
- Update durable product/changelog docs only after actual behavior/acceptance disposition settles. No plan/TODO status edited: assignment prohibits tracking changes.

## Reviewed files

All UI source paths relative to `packages/ui/src/` unless otherwise stated. Selected relevant sections, approximately 3,000 source/test lines.

- `os/apps/SystemMonitorApp.tsx` — owner capture, kill, profile/incident handlers, detail projection, confirmation.
- `os/MonitorTray.tsx` — complete implementation.
- `os/notifications.ts`, `os/notifications.test.ts` — complete implementation/tests.
- `os/{OsShell,WindowFrame,DesktopCanvas}.tsx`, `os/input-arbiter.ts` — lifecycle, intent reveal, capture/bubble arbitration.
- `components/organisms/{HostResourceFleetDeck,HostResourceFleetCard,HostResourceGlance,HostResourceDiagnosis,HostResourceIncidentDetails}.tsx` — relevant composition/presentation.
- `components/ui/Dialog.tsx`; `components/pages/DashboardPage.tsx` — primitive, extracted row, duplicate ingestion.
- `hooks/{use-multi-host-resources,use-aggregated-terminal-sessions,use-host-resource-alert-presentation,use-sse,use-sse-events}.ts` — relevant ownership/demand/read/event contracts.
- `api/{queries,host-resource-stream-coordinator,client}.ts`; `lib/host-resource-state.ts` — relevant transport lifecycle/status and kill interface.
- `packages/ui/browser-tests/os-system-monitor.browser.tsx` — complete test scenarios; `packages/ui/package.json` scripts.
- `server/src/api/terminal.rs:295-325` — kill endpoint contract.
- Phase06 plan; previous Cycle2 report; README; PDR/code standards/architecture relevant sections; `docs/architecture/host-resource-sse.md:1-147`; installed code-review skill and required workflows.

## Validation commands and results

Reviewer executed only inventory commands (`git diff --stat`, `git status --short`), source reads and searches; no build/test/lint/formatter or privileged host action. Phase plan lines 86 and 92-95 delegate checks to main after join.

**Inspected prior Cycle2 receipt:** `agent://Tester-2:12-102` (not fresh Cycle3 evidence).

| Command | Observed receipt result |
|---|---|
| `pnpm --filter @dam-hopper/ui test -- src/os src/api/host-resource-stream-coordinator.test.ts src/components/organisms/HostResourceFleetDeck.test.tsx` | Full UI suite accidentally selected by forwarded `--`: 337 files / 3,160 passed; two non-fatal jsdom navigation diagnostics |
| Same command without forwarded `--` | Scoped 11 files / 79 passed |
| `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/os-system-monitor.browser.tsx browser-tests/host-resource-monitoring.browser.tsx browser-tests/idle-suspend-settings-status.browser.tsx` | 3 files / 43 passed |
| `pnpm --filter @dam-hopper/ui build` | Exit 0, `tsc -p tsconfig.json`; not bundle build |

Fresh Cycle3 validation receipt not supplied at report writing. No lint count, type/test coverage percentage, physical PTY-input isolation, live-server SSE lease exercise or privileged sleep qualification claimed.

## Unresolved questions

- Who owns expected-incarnation atomic kill API/server expansion, or where is explicit approval to reduce that phase acceptance guarantee?
- Fresh Cycle3 build/browser/unit result receipt needed from integration owner; Cycle2 results cannot certify current edits.
