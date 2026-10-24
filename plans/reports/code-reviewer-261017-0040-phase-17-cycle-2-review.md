# Code Review — Phase 17 (Cycle 2): Preferences, Privacy, Notifications, Lifecycle

Plan: `plans/261015-1647-android-native-app/phase-17-preferences-privacy-notifications-and-lifecycle.md`
Scope: 10 modified + ~25 new files under `native-app/` (~4.4k new LOC), uncommitted working tree. Tester retest report 261017-0028 read; claims spot-checked against code.

## Score: 6/10

Cycle-1 criticals (input gating at terminal/editor dispatch, IME/focus clear, profile retirement wiring, Settings nav) are fixed and verified in code. Remaining gap = plan acceptance: most preferences inert, lifecycle pause only partly wired, SAF + permission request missing, docs/plan unupdated.

## Verified fixed (cycle-1 criticals)
- `TerminalInputController`: `isInputAllowed()` gates hw key, IME commit, IME delete, paste, ctrl-chord path. `TerminalSessionController.sendInput/getSelectedText/copySelection/pasteText` gated too (defense in depth, below overlay).
- `EditorSession` + `AndroidEditorSurface` + `EditorTabsState`: setText/applyEdit/undo/redo/save-edit gated; propagated to new sessions (`EditorTabsState.kt:90`).
- `WorkbenchScreen`: mask → `keyboardController.hide()` + `clearFocus(force)`; overlay consumes pointers, `invisibleToUser()` on content, `clearAndSetSemantics` on mask; mask reset on background/destroy.
- Profile delete → `lifecycleCoordinator.onProfileRetired(id)` → cancel profile notifications, `settingsRepository.onProfileRemoved`, close terminal controllers.
- Manifest `configChanges` covers rotation → no activity recreation on rotate → mask survives rotate; fold/density recreation resets mask via onStop (acceptable: "ephemeral").
- PendingIntent `FLAG_IMMUTABLE`; VISIBILITY_PRIVATE + public version redacted; channels lockscreen private; `allowBackup=false`.

## Critical issues
None security-blocking. (Scope gaps below are plan-acceptance blockers for marking Phase 17 done, listed under High.)

## High
1. **Preferences are inert.** Only `cognitoModeShortcut/Style` are consumed (`WorkbenchScreen.kt:895-897`). `theme`, `systemFontSize`, `editorFontSize`, `terminalFontSize`, `soundEnabled`, `hapticFeedbackEnabled`, `statusFilter`, `explorer*`, `terminal*Enabled`, `terminalAgentNotifications` have no consumer outside Settings UI (grep over commonMain + androidApp/main). Plan step 3 + Success Criteria ("system font changes do not alter independent terminal/editor fonts") unprovable. Settings write/persist/sync values nobody reads.
2. **No notification producers / no runtime permission request.** Only caller of `postNotification` = "Send Test Alert" button. Agent-attention/transfer/idle-suspend never post. `POST_NOTIFICATIONS` declared but no `RequestPermission` launcher / system settings deep link (grep: none) → API33+ users can never grant from app. Agent notif toggles do nothing. Plan step 4 incomplete. Test notification hard-codes `profileId="test-target"`, id 9999.
3. **Lifecycle demand-pause only wired for host-resource coordinator** (`WorkbenchScreen.kt:838-844`). SSE/usage/watchers/media/workflow not paused/rebaselined on background; no `LifecycleAware` implemented by any other feature. Plan step 6 incomplete. `onOwnerRetired` covers only notifications/settings/terminal controllers — not editor tabs, transfers, media, workflow, cache, import state (plan step 7). Endpoint-change retirement not wired (only `deleteProfile`). `lastExportedToml` / `lastImportResult` in `SettingsRepository` never cleared on retire/background.
4. **SAF import/export absent.** `SettingsImportExport.kt` (planned) missing; no `OpenDocument/CreateDocument`. Import = paste into `OutlinedTextField`; export = copy to clipboard (clipboard retained, not cleared). Plan step 2 says SAF + 1 MiB boundary. 1 MiB check runs after full-string `encodeToByteArray` (alloc of whole paste).
5. **Deep-link handling weak** (`MainActivity.handleDeepLink`):
   - Replayed from `onCreate(intent)` on every recreation (fold/dark-mode/process recreate keep original intent) → silently re-selects the notification's profile, overriding user's current profile.
   - Generation check skipped when `getCurrentConnection == null` or `generation <= 0` → stale notification still activates profile. `terminalId/incarnation/serverEpoch/attentionRevision` extras are put but never validated or used (not "exact-target").
   - Activity is `exported=true` (launcher) → any app can send `EXTRA_TARGET_PROFILE_ID` and switch selected profile. Needs consumed-once marker (e.g. clear extras / `setIntent` after handling) and validation.
6. **Docs/plan not updated.** No change under `docs/` or phase plan (status still pending, todo unchecked, no evidence ledger/limitations). Plan Todo #4 and Security ("screenshots/recents policy accurately documented") unmet. No FLAG_SECURE/recents policy documented; HEAVY_BLUR is a 95%-alpha tint (not blur) — text states "blur-capable"; document.

## Medium
- **Remote-controlled Cognito shortcut**, unvalidated: `applyTo` accepts any string from server; arbitrary typed text via `OutlinedTextField` (every keystroke persisted + remote-synced). Chord builder only knows P/L/K/C/D/Z/Esc, else numeric keyCode → most user-typed shortcuts never fire; a remote value like `ctrl+c` hijacks terminal copy/SIGINT chord (`onPreviewKeyEvent` returns true). Validate/allowlist + capture-chord UI.
- **Preference source ACTIVE before hydration** (`switchPreferenceSource`): status set ACTIVE and saved, then `clientProvider` null/hydrate failure returns false but stays ACTIVE → next `updatePreferences` pushes local values over remote without ever reading remote (silent overwrite). Roll back status or mark PENDING_HYDRATION.
- **Data races** in `SettingsRepository`: `latestEditRevision`, `debounceJob`, `lastSavedSnapshot` plain vars touched from UI thread and `Dispatchers.Default` job. Use single-thread scope / Mutex / `@Volatile`+atomic.
- `scheduleDebouncedRemoteSave` cancels prior job then returns if client null → pending sync dropped, no retry/diagnostic; `catch Throwable` swallows failure with no surfaced state.
- File sizes: `PreferencesPrivacyView.kt` 845 (> docs.maxLoc 800), `MaintenanceView.kt` 674, `NotificationsView.kt` 532, `WorkbenchScreen.kt` 1453 and growing (+142). Extract `PrivacyKeyDispatcher` (chord building/dispatch, 40 lines inlined in Composable) + lifecycle listener out of `WorkbenchScreen`.
- `LifecycleCoordinator`/`NotificationSink` use `synchronized` in commonMain (JVM-only; fine today because targets = Android+JVM, breaks if iOS added). Swallow-all `catch (_: Throwable)` in coordinator hides listener faults — log at least.
- `PrivacyController.deactivate()` sets `ignoreNextRelease` but `consumeTrailingRelease()` has no callers outside tests (grep) → documented invariant "consumes trailing releases" not enforced in UI.
- `clearFocus(force)` does not necessarily clear native focus on `AndroidView` (Termux/Sora); correctness then relies solely on the dispatch gates + overlay. Device proof pending (Phase 18).

## Low / suggestions
- Tester report misstatements: lists channels `SESSION_ALERTS`, `SYSTEM_HEALTH` and `PROCESS_RECREATION` / `BACKGROUND_RETAINED` states; code has `TERMINAL_ATTENTION/TRANSFERS/IDLE_SUSPEND` and `INITIALIZED/FOREGROUND/BACKGROUND/DESTROYED`. Counts pass but descriptions are unreliable; re-verify against code.
- `AndroidNotificationSink`: `channel` creation during `init` ok; two `Notification.Builder` per post, fine. `cancelNotification` loops all sets (ok, small). Sink reads `context.checkSelfPermission` correctly.
- `gradle.properties` `kotlin.daemon.jvmargs=-Xmx2048m` environment tweak bundled in feature change; keep or split.
- `InMemoryNotificationSink` in commonMain production source solely for tests → move to commonTest (YAGNI).
- `statusFilter: String` free-form, unclamped/unvalidated.

## Positive
- Input blocked at three layers (overlay, session/controller, surface) rather than overlay only — matches plan "dispatch boundary" requirement.
- Generation/ownership checks on import/clear-cache/reset (`expectedGeneration`), debounced remote save re-verifies owner + edit revision.
- Import 1 MiB constant + `postToml` honors `assertActiveOwner`.
- Preferences clamped on load/save/hydrate; corrupt JSON falls back to defaults.
- UI invariants preserved: zero FAB/WebView in settings UI, single content area, no new nav chrome.

## Validation (observed this cycle; not re-run — per tester evidence)
- Source review of all new/changed Phase 17 files and diffs: done.
- Tester retest 261017-0028: phase suites 16/16 (1,332 assertions), cargo 7/7, `:shared:jvmTest` 302, debug/release unit 76 each, `assembleDebug` OK, 0 failures. Not re-executed by me; no new code changed by this review.
- Not proven: device behavior (AndroidView focus/IME with mask, lock-screen redaction, POST_NOTIFICATIONS flow, SAF, process death). Compile/tests don't satisfy plan's native-surface acceptance.

## Recommended actions (priority)
1. Wire preferences to real consumers (theme, 3 independent font sizes, haptic/sound, status filter) or explicitly descope with user approval.
2. Add runtime POST_NOTIFICATIONS request + settings deep link; connect agent-attention/transfer/idle events to sink honoring `terminalAgentNotifications`; drop hardcoded test target or mark debug-only.
3. Implement `LifecycleAware` in streaming features (SSE/usage/watch/media) + extend `onOwnerRetired` to editor/transfers/media/workflow/import state; wire endpoint-change.
4. SAF OpenDocument/CreateDocument for TOML with streamed 1 MiB bound.
5. Deep link: consume-once, validate generation even when conn absent, validate terminal/incarnation or drop unused extras.
6. Validate/capture-chord Cognito shortcut; reject remote values outside allowlist; avoid conflict with terminal chords.
7. Fix hydration-before-ACTIVE and SettingsRepository concurrency.
8. Split oversized files; update docs + plan evidence ledger incl. screenshot/recents policy and device limitations.

## Unresolved questions
- Is full per-preference runtime integration + notification producers expected in Phase 17, or accepted as Phase 18 follow-up? (Plan says no deferrals.)
- Should plan status be flipped to review-complete given High items 1–4, or kept pending?
- Is FLAG_SECURE/recents blanking intentionally out of scope (plan: "no OS screenshot guarantee")? Needs documented policy.
