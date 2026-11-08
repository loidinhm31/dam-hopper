# Wave 06 — Cycle 2 code review

## Score: 5/10

Not technically acceptable yet. The fixes improve individual branches, but do not resolve all eight Cycle 1 findings end to end.

## Scope / evidence

- Reviewed the 35 changed Android source/test files identified by `git diff` (+3,899/-402), relevant production callers, Cycle 1 report, plan, P03/P06 task acceptance and C1–C10. Applied the loaded code-review skill and repository standards.
- Production scope: canonical editor registry/session/save/native document/surface, workspace factory, terminal screen/state/policy/accessory keyboard, Settings root/config/maintenance/diagnostics, Android notification sink/platform. Reviewed their changed JVM/Android instrumentation tests.
- Static review only. Main reports successful `:shared:compileKotlinJvm`, `:androidApp:compileDebugKotlin`, and 197/197 focused tests. Reviewer did not rerun checks: C9 assigns execution to Main/coordinator. No independent build/test/device success claimed.
- No product-code or plan/task-status changes. Plan updates remain Main-owned under this assignment. This report is the only authored artifact.
- Path abbreviations: `shared/` = `native/android-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/`; `platform/` = `native/android-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/`. Test references below are under `native/android-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/` unless otherwise stated.

## Cycle 1 disposition

| Original finding | Cycle 2 source assessment |
|---|---|
| C1 canonical tier replacement | Partial: `getOrCreateDocument` now protects dirty/registry-save-busy documents and notifies aliases; suspended reload transaction still unsafe. |
| C2 ghost aliases | Partial: ordinary `closeAll` unregisters aliases; route-key registration still leaves ghosts after rename/rekey. |
| C3 unauthorized editable baseline | Unresolved: preserving canonicalPath verbatim does not reject missing identity or populate native identity baselines. |
| C4 root confirmation | Partial: Set root now opens impact confirmation; full-config root edits still cannot confirm, and Set root omits the workspace dirty guard. |
| C5 hidden/reopen lifecycle | Partial: selectable predicate and fallback dialog mapping improved; memoization and input eligibility still disagree with qualified visibility. |
| C6 pinned exited Close View | Resolved in inspected source: both hide methods refuse pins; exited banner checks pins. No device-handler execution claimed. |
| C7 uncertain create UI | Partial: persisted records load on mount/successful inventory refresh, not on ambiguous create settlement; nonretained UI remains empty. |
| C8 refusal/pending termination | Partial: refusal clears transient exclusion before refresh, and a busy target avoids one fallback branch; missing-target refusal and persistent pending lifecycle remain unsafe. |

## Critical issues — MUST FIX [7]

### K1. Reload still replaces canonical authority during an in-flight save

**Evidence:** `shared/features/editor/EditorTabsState.kt:1142-1188,1190-1235`; direct save port `shared/features/editor/EditorRepository.kt:115-164`.

`reloadTab` checks save admission only before the suspended read. On return it checks edit revision/epoch, but not registry save admission, and never compares `res.fileIdentity` with the captured baseline. With explicit discard, a save started while the reload read is suspended can still have its document/session replaced. The listener already reconstructs every alias; the initiating holder then reconstructs those aliases a second time. Direct `saveDocument` also bypasses the new canonical save lock/native save counter.

**Impact:** stale identity adoption, replacement during save, stale save publication and broken canonical transaction guarantees (C4). **Confidence:** high.

**Correction:** one captured identity/revision/owner/save-admission transaction, revalidated after I/O; all save entrypoints join it. Publish each alias once and retain original on busy/stale/failure.

### K2. Rename/rekey recreates the ghost-alias dirty-close defect

**Evidence:** `shared/features/editor/EditorTabsState.kt:43-56,345,677-714,742-750,914-969`.

Registry aliases remain tab-key strings. `rekeyPath` changes the tab/session key but never migrates the registry entry or its lease alias identity. Closing the renamed tab unregisters its new key, leaving the old key alive in `activeAliases`. With another canonical alias B still open, closing B now sees that ghost and skips the final dirty prompt. Equal route keys in distinct holders also collapse into one set entry despite distinct native leases.

**Impact:** final dirty document can become unreachable despite the ordinary `closeAll` fix (C4). **Confidence:** high.

**Correction:** account for unique actual alias lease tokens/holder identities, independent of mutable routes; release the captured token on close and test rename A → close A → dirty/final-close B.

### K3. Missing/incomplete FileIdentity still creates editable authority

**Evidence:** `shared/features/editor/EditorTabsState.kt:320-359,373-405,578-609`; `platform/editor/AndroidEditorDocument.kt:69-70,494-503,624-639`.

Epoch is still guessed from owner state or `0`; absent/incomplete identity still yields a route/path pseudo-canonical key. `openTab` installs a normal editable session. The same-read identity is stored on tab metadata only: native `fileIdentity`/`canonicalPath` remain null, with no production assignment found. Saving continues from a baseline without that exact identity.

**Impact:** C4 fail-closed and same-response canonical identity requirements remain unmet. **Confidence:** high.

**Correction:** deny editable admission without complete authorized same-read identity; initialize and validate the canonical document's identity-bearing baseline on load/reload/save/rebind. Route-only identity may not grant edit authority.

### K4. Root confirmation remains incomplete across production workflows

**Evidence:** `shared/features/settings/GlobalSettingsView.kt:228-235`; `SettingsConfirmDialogs.kt:143-169`; `RemoteConfigEditor.kt:312-365,419-448`; `RemoteConfigScreen.kt:88-89,123-125`.

Set root now has a PTY-impact dialog, but invokes the editor without `departureGuard`; checking a config draft is not guarding dirty workspace documents. Raw full-config root edits still use production Save/Overwrite callers that never pass `confirmRootChange=true`, so that advertised editing path always refuses. The new dialog displays only a path, not captured Admin Target B identity/endpoint, and pending consent is an unqualified boolean.

**Impact:** incomplete destructive root workflow and dirty-document protection (C5/C8). **Confidence:** high.

**Correction:** route all root-changing entrypoints through captured target/path/draft consent and the workspace dirty guard, revalidate after suspension, and pass the consent only for that captured operation.

### K5. Qualified hidden state is not consistently used by selection, attachment and input

**Evidence:** `shared/ui/screens/ProjectTerminalScreen.kt:508-513,852-857,1103-1108,1837-1857`; `shared/ui/screens/ProjectTerminalState.kt:214-229,286-291`.

`eligibleSessions` now reads hidden state inside `remember`, but its keys omit both retained and fallback hidden state. After hide → inventory refresh (list excludes A) → explicit Reopen A, inventory and destruction keys are unchanged: the cached list still excludes A, leaving its selected view unattached/spinning until another inventory change. Conversely, hiding without refresh leaves the cached list including hidden sessions.

Input admission uses any hidden entry with the same raw terminal ID, not the qualified instance predicate. If hidden incarnation 1 is replaced by incarnation 2, the new row is selectable but remains input-blocked by the obsolete hidden key; Reopen of incarnation 1 cannot match incarnation 2.

**Impact:** hide/reopen and replacement-instance input fail in the real component (C6/C8). **Confidence:** high.

**Correction:** derive one reactive qualified visibility/selection/attachment/input policy; include all relevant state dependencies and retire stale-instance suppression only against authoritative inventory. Exercise the mounted component, not only state methods.

### K6. Ambiguous create settlement still does not publish uncertainty

**Evidence:** `shared/ui/screens/ProjectTerminalScreen.kt:349-354,680-724,1140-1143,1596-1623,1713-1729`; `shared/features/terminal/TerminalRepository.kt:109-145`.

Mount and successful inventory refresh now load persisted reservations. Both create handlers, however, only show a generic exception on a lost/failed reply and never synchronize the newly persisted pending record. Until some separate refresh/remount, there is no original-intent notice or Check status action. Start/New/Create controls remain available during uncertainty. With `retainedState == null`, loaded records are discarded and the notice list is always empty.

**Impact:** C6 uncertain-create presentation is still not end to end. Repository rejection alone is not blocked explanatory UI. **Confidence:** high.

**Correction:** publish reservation state from both creation paths on every settlement/cancellation and initial admission; retain presentation for both supported screen paths; disable replacement actions while unresolved without treating inventory absence as proof.

### K7. Refusal refresh can still retarget; acknowledged termination loses lifecycle state

**Evidence:** `shared/ui/screens/ProjectTerminalScreen.kt:744-759,1789-1820`; `shared/ui/screens/ProjectTerminalState.kt:214-222`; `shared/features/terminal/TerminalConnectionPresentation.kt:147-174`.

Clearing the busy flag before a 409 refresh fixes the reported simple exclusion case only. If the refused original is missing from current inventory (for example, an epoch-mismatch refusal after server restart), refresh selects `selectable.firstOrNull()`: the original selection is still replaced with a sibling. Separately, `presentation.isPending` is ignored; `finally` clears `destroyingSessionIds` regardless of 202/200/unknown outcome. Neither screen nor retained state consumes `terminationState`. If inventory still reports the process alive, input/End eligibility returns before observed exit. Generic status-0/5xx outcomes are also presented as definitive termination errors/refusals rather than uncertainty.

**Impact:** C6 no-retarget-on-refusal and acknowledged-versus-observed lifecycle remain violated. **Confidence:** high.

**Correction:** separate transient request busy from exact-target refused/pending/unknown lifecycle; preserve original logical selection even when unavailable, fence input while unresolved, and reconcile from authoritative process evidence rather than removing the lock in `finally`.

## Warnings — SHOULD FIX [8]

1. **Document disposal remains incomplete.** `EditorTabsState.kt:151-169,1188` ignores the replaced old document after aliases migrate. `AndroidEditorSurface.kt:99-105` releases the view directly, never invoking registry pruning. A clean tab closed before its view lease releases can stay retained; replaced old documents never receive owner disposal. `AndroidEditorDocument.beginSaveTracking` still has only a test caller. Use one owner-managed release/prune path and actual save/view-release ordering.
2. **Exact native view lease not enforced.** `AndroidEditorDocument.kt:533-547,559-580` stores but never validates the lease token; predecessor widget remains editable against shared content after successor attachment. Validate widget+token, fence old widget input before handoff, and keep late cleanup scoped to the old widget.
3. **Native surface modifier still dropped.** `AndroidEditorSurface.kt:91-96,114-162` accepts `modifier` but does not pass it into `AndroidView`. Restore `modifier.fillMaxSize()` propagation; actual layout remains unmeasured.
4. **Structured command delete/rename resurrects old entries.** `RemoteConfigEditor.kt:680-686` copies all original command names then overlays current rows. Delete one of several commands or rename one: removed/old names survive. Track known original names by stable row ID; remove explicitly deleted/renamed names while preserving genuinely unknown values.
5. **Mtime access allocates entire file bytes.** `EditorSession.kt:28-31` uses `snapshotForSave()` for a scalar getter; `EditorTabSaveCoordinator.kt:23-31` already captured a snapshot immediately before calling it. Android snapshot serializes the content (`AndroidEditorDocument.kt:494-503`). Use `snapshot.mtime` or a nonallocating canonical baseline property.
6. **Viewport collapse still uses guessed geometry.** `ProjectTerminalScreen.kt:1051-1074` budgets before child IME padding and subtracts fixed `104.dp`, not measured chrome/banners. The added measured-height helpers are not wired here. Use post-insets/IME constraints and actual measured heights (C8).
7. **Alias tab metadata still diverges from the shared buffer.** `EditorTabsState.kt:592-609,1307-1310,1323-1337` publishes server bytes and `isDirty=false` when adopting an existing dirty document; listeners update only one session's tab. Preview content/dirty indicators of other aliases can remain stale. Publish metadata from canonical document events for every alias, including initial adoption.
8. **Several regressions still reconstruct the claimed production logic.** `features/editor/EditorSaveRaceTest.kt:290-354` manually completes saves; `:391-426` never submits to its configured 409 handler. `features/terminal/ProjectTerminalVisibilityTest.kt:492-520` wraps hide with a test-local pin check; `TerminalScreenBindingTest.kt:258-280` increments a local request counter behind a copied condition. These do not prove the actual handlers. Add production-save/deferred-read/component action tests for the remaining failures; reported 197 passes do not cover these absent oracles.

## Suggestions — NICE TO HAVE [2]

1. After safety fixes, separate the 1,340-line `EditorTabsState.kt` and 2,528-line `ProjectTerminalScreen.kt` into focused transaction/presentation pieces. Resolve the new registry holder against C4/P06's existing-retained-owner requirement; avoid parallel lifetime conventions.
2. `SettingsDiagnostics.redact` remains production-unused and recompiles multiple regexes (`:52-60`). Remove dead code, or use a bounded real diagnostic-text caller with precompiled patterns. Preserve the stronger typed export allowlist.

## C1–C10 compliance assessment

| Contract | Assessment within W06 scope |
|---|---|
| C1 navigation | Terminal capability callbacks added; final Hub/default-login/root wiring belongs P07, not certified here. |
| C2 existing ownership | No added connection poller, background service or saved-profile auto-connect observed in reviewed changes; shared holder injection exists. Final retained-owner integration remains P07. |
| C3 exact API | Reviewed changes retain guarded POST termination/current raw config paths; no server modification. Existing accepted P02 residual risks are not newly certified. |
| C4 canonical editor | Fails K1–K3; disposal, exact view lease, metadata warnings also remain. |
| C5 Settings/root | Partial: unknown nested fields/raw TOML preservation improved; K4 and structured command mutation warning remain. |
| C6 terminal lifetime | Fails K5–K7. Pin refusal repaired in source. |
| C7 notifications/privacy | Inspected platform changes are sound: fixed generic public strings, private visibility, immutable explicit PendingIntents, socket identity round-trip, blocked-channel checks and profile-scoped cancellation. No new automatic permission prompt. Actual OS behavior still requires qualification. |
| C8 native UX/input | Partial: 48dp controls and Cancel focus added; viewport, surface modifier and lifecycle/input defects remain. Phone/tablet/IME/TalkBack not exercised here. |
| C9 barriers/ownership | Reviewer executed no builds/tests and changed no product/plan state. Main owns stopped-wave checks, smoke and dispositions. Supplied compilation/tests are not an independent passing review. |
| C10 readiness/evidence | No release-ready claim. Separate meaningful component/live smoke, instrumentation compilation/execution, real native editor lifetime and device/privacy evidence are not established by this review. |

## Positive observations

- Registry dirty/save-busy admission and ordinary `closeAll` cleanup address genuine parts of the original defects rather than removing safeguards.
- Pin refusal now lives in shared state, not only a dialog.
- Notification public content is fixed by the sink, independent of caller-provided strings; existing three channels, permission policy and per-profile cancellation remain intact.
- TOML import/export preserves raw bytes; sparse/unknown-field preservation and owner-qualified Settings outcomes remain conservative.

## Unresolved evidence / questions

No unresolved product-design question. Main-reported compilation/197 focused tests were not rerun; no reviewer lint/type/test-coverage metric, device, live PTY or OS smoke evidence. Do not mark W06 technically accepted until the remaining production-path defects and required stopped-wave smoke/review gates are resolved.
