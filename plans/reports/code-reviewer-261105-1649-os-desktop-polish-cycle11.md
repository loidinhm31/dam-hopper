# OS Desktop Polish — Cycle 11 Code Review

- **score: 6.5/10**
- **critical_count: 0** (no demonstrated destructive or cross-tenant consequence; several High findings block release)
- Disposition: **changes required**. Remediations 1–3 landed; remediation 4 is **not applied** in window state; remediation 5 is **partial**. New High in deep-link qualification.

## Scope / evidence
- Reviewed: `TerminalsApp.tsx` (full), `persistence.ts:900-1300` (journal), `window-store.ts` diff, `action-executor.ts:120-479`, `OsShell.tsx:81-296,352-432,1489-1522`, `deep-links.ts` diff, `action-dispatch.ts:177-362`, `BrowserApp.tsx` URL validation, `client.ts` diff, `window-ops.ts:279-303,900-945`, docs diffs, server `api/terminal.rs:87-232`, `pty/manager.rs:1600-1861`, `error.rs:160-221`, `api/settings.rs:166-248`, `config/schema.rs:1421-1450`, `config/parser.rs`, plan + C1–C14 contracts.
- Checks run (observed): `tsc --noEmit` (ui) exit 0 · `vitest run src/os src/lib src/stores src/hooks src/components` 313 files / 2822 passed · eslint on all changed/new UI TS/TSX: 0 errors, 72 warnings (same set as cycle 10) · `cargo test --lib config` 134 passed.
- Not run: browser tests, Playwright E2E, full cargo suite.

## Verified this cycle
- **requestSent** (`TerminalsApp.tsx:97,123,216-219`): pre-dispatch throws (getApi/toServerFsTarget) → `confirmed-not-created`. Correct per C3 rule 4.
- **Classifier**: dispatched errors only `ApiRequestError` 400/401/403/404/413/422 → not-created; rest `uncertain`. Within inspected paths the allowlist holds: `create_session` 4xx arise before `pty_manager.create`; post-effect manager failures are `PtyError`/`Unavailable` (5xx) or 409 `UnavailableTarget` after `mark_target_unavailable` (`terminal.rs:192-218`, `manager.rs:1687-1843`). Fresh IDs make `kill_internal_impl` (`manager.rs:1636`) a no-op. Not audited: middleware/response-serialization paths.
- **Orphan success ordering**: `confirmed-success` settled before the owner-change throw (`TerminalsApp.tsx:167-185`). Ordering fixed; persistence-failure handling still open (H3).
- **Unmount cleanup removed**; `window-store.closeWindow:133-145` is the sole undispatched settlement (sync store read; `dispatched:true` set synchronously before any await at `:95`).
- **8 KiB/record** enforced via `TextEncoder` (`persistence.ts:1192-1198`); `typeof localStorage` guards throw.
- Receipt incarnation: `rawIncarnation` uses `isCanonicalPositiveU64` or safe-int > 0 (`:150-158`).

## Critical
None.

## High
1. **H1 — Remediation 4 not applied to window state (C3 L80).** `TerminalsApp.tsx:204-205` still writes `incarnation: sessionRes.incarnation, incarnationExact: rawIncarnation ?? String(sessionRes.incarnation)` → `"undefined"` when missing, `String(unsafe)` when unsafe. Also written when `createdTarget` is undefined (epoch missing) while journal is `uncertain`; `isRemoteAttached` (`:82`, `Boolean(target?.incarnation || appState.incarnation)`) then hides the inactive/retry overlay. Downstream `terminal-session-contract` rejects (fail-closed), so not critical. Fix: publish identity fields only when `createdTarget` exists:
   ```ts
   ...(createdTarget ? { target: createdTarget, incarnation: Number(createdTarget.incarnation), incarnationExact: createdTarget.incarnation, serverEpoch } : {}),
   ```
   (or omit numeric `incarnation` entirely). Redundant `(sessionRes as {incarnationExact?})` casts (`:139-141`) — `SessionInfo` declares it (`client.ts:209`).
2. **H2 — Journal still fails open without Web Locks (C3 L64); remediation 5 partial.** `withLaunchJournalLock` (`persistence.ts:1012-1025`) falls back to an in-process chain. Plain-HTTP LAN (insecure context) has no `navigator.locks` → two tabs reserve/create concurrently. Same condition removes `crypto.randomUUID`; reserve falls back to `Date.now()+Math.random` IDs (`:1137-1140,1168-1171`), violating C12 "cryptographic ID" (`crypto.getRandomValues` is available in insecure contexts). Records cast without shape validation (`:1051-1054`): a record missing `state` stops blocking. Doc size checks use UTF-16 `.length`, not bytes (`:1035,1062`). No tests for no-locks/no-storage/record-cap. Fix: return `blocked` when locks missing (or record explicit waiver), generate IDs via `getRandomValues`, validate each record, add tests.
3. **H3 — Settlement result ignored; success published without durable receipt (C3 rule 3).** `settleTerminalLaunch` returns `{status:"uncertain"}` on write failure (`persistence.ts:1283-1288`); `TerminalsApp.tsx:169-180` ignores it and publishes target at `:198-209`. Record stays `reserved` (blocks forever) while window shows live terminal. Fix: check result; on non-`settled` for success, do not publish, surface "receipt not durable".
4. **H4 — New deep-link qualification adopts ambient state and mixes profiles (C11).** `OsShell.tsx:217-233`: when link omits project, target = `normalizeFsTarget({ profileId /* shell */, project: activeProject })` and `projectId = activeProject`; owner = link profile (`explicitProfile`). Link to profile B while A has active project → B owner with A-profile target/A project name. `qualifyOsDeepLink` checks only `owner.profileId` vs link profile, not `target.profileId`. Impact beyond wrong-target search/reveal not demonstrated. Fix: no `activeProject` fallback; workspace target for `explicitProfile`; reject when `target.profileId !== owner.profileId`.
5. **H5 — Silent indefinite block persists (C3 L82).** `blocked` results still discarded: `Dock.tsx:74`, `dock-context-menu.tsx:138,147`, `AppLauncher.tsx:110`, `CommandPalette.tsx:152`, `action-dispatch.ts:258,338`. Reserve copy "…already in progress" for `uncertain` (`persistence.ts:1112-1116`). Retry button shown on uncertain/orphan states (`TerminalsApp.tsx:395-410`); after an orphan success Retry creates a second PTY for the same destination. Docs claim "durable fail-closed" with no indefinite-block/operator note.

## Warnings (Medium)
6. **Executor terminal New lacks post-await recheck (C2).** `action-executor.ts:131,265-304`: `activeDesktopId` captured pre-await, no desktop/owner-generation recheck after `reserveTerminalLaunch`; `openWindow` falls back to `desktops[0]` (`window-ops.ts:285`) → retarget. If open fails the reservation leaks. Fabricated `generation ?? 1` (`:236,317,397`), `profileId "default"` (`:316,396`), `OsShell.tsx:1507` `{profileId, generation:1}` owner.
7. **Multi-instance Open/Focus matches profile only** (`action-executor.ts:434-438`) — ignores project/worktree/target (C2 "exact required profile/project/worktree/target"). Terminal Open for project X focuses project Y's terminal; may focus chooser windows.
8. **`terminal:open` / `?open=terminals` still bypass journal** (`OsShell.tsx:357-432`; producers FilesApp/GitApp/ProjectInfoApp/`deep-links.ts:230`); honors caller `terminalId` (C12) and writes `incarnationExact: String(incarnation)` (`:419`). Migrate or record C3 waiver.
9. **Settings import skips UI validators.** `settings.rs:229-233` → only `validate_protected_config_replacement`; `parse_config_str_at_path` has no UI validation. Imported out-of-range `dock_padding`/`cursor_theme` later fails every UI PATCH. Add `UiConfig::validate_all()` used by both paths.
10. **No tests for the safety logic.** No test references the classifier, `requestSent`, `closeWindow` settlement, or TerminalsApp lifecycle; journal tests lack cap/no-locks/no-storage cases.
11. **Dead code / lint.** 72 warnings unchanged (`OsShell.tsx` 5 unused, `dam-hopper-app.tsx` 7, `action-executor.ts:3,7`, `action-dispatch.ts:11,13`, `WindowFrame.tsx:15,79,81`, `GitApp.tsx:28,49`, `FilesApp.tsx:6,19,34`, `dock-pins.ts:9`…). `get/registerInFlightLaunchPromise` zero callers (`persistence.ts:1068-1086`); `validate_window_placement` no-op (`schema.rs:1421`); `parseOsDeepLink` emits `file:reveal` with fabricated `generation: 1` that qualification discards.

## Suggestions (Low)
- Ref-based re-entrancy guard in `handleLaunchSession` (closure `isLaunching`/`isDispatched` would double-dispatch under StrictMode effect replay; app currently not in StrictMode).
- DRY: extract `buildTerminalLaunchIdentity` (`action-executor.ts:248-263` ≈ `TerminalsApp.tsx:274-287`); share http(s) URL policy between `BrowserApp.tsx:35-43` and `deep-links.ts` (prefix-only check) and `runtime-config.validateAndNormalizeApiUrl`.
- `window-store.ts:40-51`: statements between imports; `windowFocusTimestamps` never pruned on close.
- Orphan-success UI: show "created on previous connection" + no Retry, instead of generic error.
- `endpointBinding: "default-endpoint"` hard-coded (C3 L78 aliases) — bind to normalized profile endpoint or document.
- Perf (carried): `handleLaunchSession` deps on whole `window.appState`; per-window re-attach on every registry change.
- Security: no new XSS/injection/auth issues found; browser chooser validates scheme + `new URL`; server `appShortcuts` allowlist on PATCH holds.

## Metrics
- Type check: 0 errors · Tests: vitest 2822/2822, cargo config 134/134 · Lint: 0 errors / 72 warnings.

## Recommended actions (priority)
1. H1 publish-only-on-`createdTarget`; H3 honor settle result.
2. H2 block without Web Locks (or waiver), `getRandomValues` IDs, record shape validation, tests.
3. H4 remove ambient project/profile fallback in deep-link capture.
4. H5 surface `blocked`/uncertain to user; hide Retry on uncertain/orphan; doc indefinite block.
5. Regression tests: missing/unsafe incarnation → no publish; settle-write failure → no publish; no-locks two tabs; desktop deleted during reserve; deep link profile B with A active project; classifier 5xx/TypeError/404; closeWindow pre-dispatch.
6. Medium items 6–11.

## Unresolved questions
- Plain-HTTP LAN: block terminal New without Web Locks, or accept a written C3 waiver?
- Should `terminal:open` migrate to the journal in this plan or be waived?
- Does any server middleware/serializer return 4xx after `pty_manager.create` succeeds? (not audited)
